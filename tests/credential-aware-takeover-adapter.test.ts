import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverBrowserAdapter } from "mcp-execution-handoff/browser-takeover";
import { CredentialAwareTakeoverAdapter } from "../src/browser/credential-aware-takeover-adapter.js";
import { CuaHumanTakeoverAdapter } from "../src/browser/cua-human-takeover-adapter.js";
import type { CuaToolClient, CuaToolResult } from "../src/browser/cua-mcp-client.js";

class TinyCua implements CuaToolClient {
  async callTool(name: string): Promise<CuaToolResult> {
    if (name === "list_windows") return { structuredContent: { windows: [{ pid: 7, window_id: 8, is_on_screen: true, bounds: { width: 500, height: 400 } }] } };
    if (name === "get_window_state") {
      const bytes = Buffer.alloc(24); bytes[0] = 0x89; bytes.write("PNG", 1); bytes.writeUInt32BE(500, 16); bytes.writeUInt32BE(400, 20);
      return { content: [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }], structuredContent: { screenshot_width: 500, screenshot_height: 400 } };
    }
    return { structuredContent: { ok: true } };
  }
  async close() {}
}

test("takeover router uses standard CDP adapter except for the exact credential-safe intervention", async () => {
  let standardFrames = 0;
  let streamed = 0;
  const standard: TakeoverBrowserAdapter = {
    async captureHumanTakeoverFrame() { standardFrames += 1; return { data: Buffer.from("jpeg").toString("base64"), width: 10, height: 10, hostname: "maps.google.com" }; },
    async *streamHumanTakeoverFrames() { streamed += 1; yield { data: Buffer.from("stream").toString("base64"), width: 10, height: 10, hostname: "maps.google.com" }; },
    async tapHumanTakeover() {}, async scrollHumanTakeover() {}, async insertHumanTakeoverText() {}, async pressHumanTakeoverKey() {}
  };
  const cua = new CuaHumanTakeoverAdapter(() => new TinyCua());
  const router = new CredentialAwareTakeoverAdapter(standard, cua);
  const standardFrame = await router.captureHumanTakeoverFrame("normal", 1);
  assert.equal(standardFrame.hostname, "maps.google.com");
  assert.equal(standardFrames, 1);
  const stream = router.streamHumanTakeoverFrames("normal", 1, new AbortController().signal);
  assert.ok(stream);
  const streamedFrame = await stream[Symbol.asyncIterator]().next();
  assert.equal(streamedFrame.value?.hostname, "maps.google.com");
  assert.equal(streamed, 1);

  await cua.begin("credential", 2, 7);
  const credentialFrame = await router.captureHumanTakeoverFrame("credential", 2);
  assert.equal(credentialFrame.hostname, "Normal Chrome");
  assert.equal(standardFrames, 1);
  assert.equal(router.streamHumanTakeoverFrames("credential", 2, new AbortController().signal), undefined);
  await cua.end("credential", 2);
});
