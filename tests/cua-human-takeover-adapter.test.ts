import assert from "node:assert/strict";
import test from "node:test";
import { CuaHumanTakeoverAdapter } from "../src/browser/cua-human-takeover-adapter.js";
import type { CuaToolClient, CuaToolResult } from "../src/browser/cua-mcp-client.js";

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  bytes[0] = 0x89;
  bytes.write("PNG", 1, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

class FakeCua implements CuaToolClient {
  readonly calls: Array<[string, Record<string, unknown>]> = [];
  windowId = 44;
  closed = 0;

  async callTool(name: string, args: Record<string, unknown>): Promise<CuaToolResult> {
    this.calls.push([name, args]);
    if (name === "bring_to_front") return { structuredContent: { ok: true } };
    if (name === "list_windows") {
      return {
        structuredContent: {
          windows: [
            { pid: 1234, window_id: 1, is_on_screen: false, bounds: { width: 1200, height: 900 } },
            { pid: 1234, window_id: this.windowId, is_on_screen: true, bounds: { width: 1200, height: 900 } },
            { pid: 9999, window_id: 99, is_on_screen: true, bounds: { width: 1200, height: 900 } }
          ]
        }
      };
    }
    if (name === "get_window_state") {
      return {
        content: [{ type: "image", data: png(1200, 900), mimeType: "image/png" }],
        structuredContent: { screenshot_width: 1200, screenshot_height: 900 }
      };
    }
    return { structuredContent: { ok: true } };
  }

  async close(): Promise<void> { this.closed += 1; }
}

test("Cua credential takeover binds one exact visible window and carries PNG frames", async () => {
  const cua = new FakeCua();
  const adapter = new CuaHumanTakeoverAdapter(() => cua);
  await adapter.begin("intervention-1", 7, 1234);
  assert.equal(adapter.owns("intervention-1", 7), true);
  const bringToFront = cua.calls.find(([name]) => name === "bring_to_front");
  assert.deepEqual(bringToFront, ["bring_to_front", { pid: 1234, window_id: 44 }]);

  const frame = await adapter.captureHumanTakeoverFrame("intervention-1", 7);
  assert.equal(frame.mimeType, "image/png");
  assert.equal(frame.width, 1200);
  assert.equal(frame.height, 900);
  assert.equal(frame.hostname, "Normal Chrome");

  await adapter.tapHumanTakeover("intervention-1", 7, 300, 200);
  await adapter.scrollHumanTakeover("intervention-1", 7, 240);
  await adapter.insertHumanTakeoverText("intervention-1", 7, "benign-probe");
  await adapter.pressHumanTakeoverKey("intervention-1", 7, "Enter");

  const click = cua.calls.find(([name]) => name === "click")?.[1];
  assert.deepEqual(click, { pid: 1234, window_id: 44, x: 300, y: 200, delivery_mode: "foreground" });
  const text = cua.calls.find(([name]) => name === "type_text")?.[1];
  assert.deepEqual(text, { pid: 1234, window_id: 44, text: "benign-probe", delivery_mode: "foreground" });
  const scroll = cua.calls.find(([name]) => name === "scroll")?.[1];
  assert.equal(scroll?.direction, "down");
  assert.equal(scroll?.x, 600);
  assert.equal(scroll?.y, 450);
  const key = cua.calls.find(([name]) => name === "press_key")?.[1];
  assert.equal(key?.key, "return");

  await adapter.end("intervention-1", 7);
  assert.equal(cua.closed, 1);
});

test("Cua credential input rejects stale window identity and out-of-frame coordinates", async () => {
  const cua = new FakeCua();
  const adapter = new CuaHumanTakeoverAdapter(() => cua);
  await adapter.begin("intervention-1", 7, 1234);
  await adapter.captureHumanTakeoverFrame("intervention-1", 7);

  await assert.rejects(() => adapter.tapHumanTakeover("intervention-1", 7, 1400, 20), /outside the last delivered frame/);
  cua.windowId = 45;
  await assert.rejects(() => adapter.insertHumanTakeoverText("intervention-1", 7, "benign"), /window changed/);
});

test("Cua credential takeover fails closed when the dedicated PID has multiple visible windows", async () => {
  const cua = new FakeCua();
  const original = cua.callTool.bind(cua);
  cua.callTool = async (name, args) => {
    if (name === "list_windows") {
      return { structuredContent: { windows: [
        { pid: 1234, window_id: 44, is_on_screen: true, bounds: { width: 1200, height: 900 } },
        { pid: 1234, window_id: 45, is_on_screen: true, bounds: { width: 800, height: 600 } }
      ] } };
    }
    return original(name, args);
  };
  const adapter = new CuaHumanTakeoverAdapter(() => cua);
  await assert.rejects(() => adapter.begin("intervention-1", 7, 1234), /exactly one visible dedicated Chrome window/);
  assert.equal(cua.closed, 1);
});
