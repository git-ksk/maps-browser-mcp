import type { TakeoverBrowserAdapter } from "mcp-execution-handoff/browser-takeover";
import { CuaMcpClient, type CuaToolClient, type CuaToolResult } from "./cua-mcp-client.js";

interface BoundWindow { windowId: number; width: number; height: number; }
interface ActiveCredentialTakeover {
  interventionId: string;
  epoch: number;
  pid: number;
  client: CuaToolClient;
  lastFrame?: BoundWindow;
}
interface CuaWindowRecord {
  pid?: unknown;
  window_id?: unknown;
  is_on_screen?: unknown;
  bounds?: { width?: unknown; height?: unknown };
}
const MIN_WINDOW_DIMENSION = 100;

export class CuaHumanTakeoverAdapter implements TakeoverBrowserAdapter {
  private active?: ActiveCredentialTakeover;

  constructor(private readonly createClient: () => CuaToolClient = () => new CuaMcpClient()) {}

  owns(interventionId: string, epoch: number): boolean {
    return Boolean(this.active && this.active.interventionId === interventionId && this.active.epoch === epoch);
  }

  async begin(interventionId: string, epoch: number, pid: number): Promise<void> {
    if (!interventionId || !Number.isInteger(epoch) || epoch < 0 || !Number.isInteger(pid) || pid <= 0) {
      throw new Error("Invalid credential-safe Cua takeover binding");
    }
    if (this.active) {
      if (this.owns(interventionId, epoch) && this.active.pid === pid) return;
      throw new Error("Another credential-safe Cua takeover is already active");
    }
    const client = this.createClient();
    try {
      this.active = { interventionId, epoch, pid, client };
      const bound = await this.resolveWindow(this.active, true);
      await client.callTool("bring_to_front", { pid, window_id: bound.windowId });
      const confirmed = await this.resolveWindow(this.active, true);
      if (confirmed.windowId !== bound.windowId) {
        throw new Error("Credential-safe Chrome window changed while acquiring Human control");
      }
    } catch (error) {
      this.active = undefined;
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async end(interventionId: string, epoch: number): Promise<void> {
    const active = this.requireActive(interventionId, epoch);
    this.active = undefined;
    await active.client.close();
  }

  async close(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    await active?.client.close().catch(() => undefined);
  }

  async captureHumanTakeoverFrame(interventionId: string, epoch: number): Promise<{
    data: string;
    width: number;
    height: number;
    hostname: string;
    mimeType: "image/png" | "image/jpeg";
  }> {
    const active = this.requireActive(interventionId, epoch);
    const window = await this.resolveWindow(active);
    const result = await active.client.callTool("get_window_state", {
      pid: active.pid,
      window_id: window.windowId,
      max_elements: 1,
      max_depth: 1,
      include_screenshot: true
    });
    const image = this.imageContent(result);
    const structured = result.structuredContent ?? {};
    const dimensions = this.imageDimensions(image.data, image.mimeType);
    const width = this.positiveInt(structured.screenshot_width) ?? dimensions.width;
    const height = this.positiveInt(structured.screenshot_height) ?? dimensions.height;
    if (width < 1 || height < 1 || width > 20_000 || height > 20_000) {
      throw new Error("Cua Driver returned invalid credential-safe frame dimensions");
    }
    active.lastFrame = { windowId: window.windowId, width, height };
    return { data: image.data, width, height, hostname: "Normal Chrome", mimeType: image.mimeType };
  }

  async tapHumanTakeover(interventionId: string, epoch: number, x: number, y: number): Promise<void> {
    const { active, frame } = await this.requireCurrentFrame(interventionId, epoch);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > frame.width || y > frame.height) {
      throw new Error("Credential-safe tap is outside the last delivered frame");
    }
    await active.client.callTool("click", {
      pid: active.pid,
      window_id: frame.windowId,
      x,
      y,
      delivery_mode: "foreground"
    });
  }

  async scrollHumanTakeover(interventionId: string, epoch: number, deltaY: number): Promise<void> {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const { active, frame } = await this.requireCurrentFrame(interventionId, epoch);
    const amount = Math.max(1, Math.min(12, Math.ceil(Math.abs(deltaY) / 120)));
    await active.client.callTool("scroll", {
      pid: active.pid,
      window_id: frame.windowId,
      x: Math.floor(frame.width / 2),
      y: Math.floor(frame.height / 2),
      direction: deltaY > 0 ? "down" : "up",
      amount,
      by: "line",
      delivery_mode: "foreground"
    });
  }

  async insertHumanTakeoverText(interventionId: string, epoch: number, text: string): Promise<void> {
    if (!text || text.length > 2_048) throw new Error("Invalid credential-safe text input");
    const { active, frame } = await this.requireCurrentFrame(interventionId, epoch);
    // Never log tool args/results here: credential text stays broker -> local Cua MCP stdin -> normal Chrome.
    await active.client.callTool("type_text", {
      pid: active.pid,
      window_id: frame.windowId,
      text,
      delivery_mode: "foreground"
    });
  }

  async pressHumanTakeoverKey(interventionId: string, epoch: number, key: string): Promise<void> {
    const cuaKey = this.cuaKey(key);
    if (!cuaKey) throw new Error("Unsupported credential-safe key");
    const { active, frame } = await this.requireCurrentFrame(interventionId, epoch);
    await active.client.callTool("press_key", {
      pid: active.pid,
      window_id: frame.windowId,
      key: cuaKey,
      delivery_mode: "foreground"
    });
  }

  private requireActive(interventionId: string, epoch: number): ActiveCredentialTakeover {
    const active = this.active;
    if (!active || active.interventionId !== interventionId || active.epoch !== epoch) {
      throw new Error("Credential-safe Cua takeover no longer matches the active intervention");
    }
    return active;
  }

  private async requireCurrentFrame(interventionId: string, epoch: number): Promise<{
    active: ActiveCredentialTakeover;
    frame: BoundWindow;
  }> {
    const active = this.requireActive(interventionId, epoch);
    const frame = active.lastFrame;
    if (!frame) throw new Error("Credential-safe input requires a fresh delivered frame");
    const current = await this.resolveWindow(active);
    if (current.windowId !== frame.windowId) {
      active.lastFrame = undefined;
      throw new Error("Credential-safe browser window changed after the last delivered frame");
    }
    return { active, frame };
  }

  private async resolveWindow(active: ActiveCredentialTakeover, waitForWindow = false): Promise<BoundWindow> {
    const attempts = waitForWindow ? 20 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await active.client.callTool("list_windows", { pid: active.pid, on_screen_only: false });
      const structured = result.structuredContent ?? {};
      const raw = Array.isArray(structured.windows) ? structured.windows as CuaWindowRecord[] : [];
      const candidates = raw.filter((window) => {
        const width = Number(window.bounds?.width);
        const height = Number(window.bounds?.height);
        return Number(window.pid) === active.pid && window.is_on_screen === true &&
          Number.isFinite(width) && width > MIN_WINDOW_DIMENSION &&
          Number.isFinite(height) && height > MIN_WINDOW_DIMENSION &&
          Number.isInteger(Number(window.window_id));
      });
      if (candidates.length === 1) {
        const chosen = candidates[0]!;
        return { windowId: Number(chosen.window_id), width: Number(chosen.bounds!.width), height: Number(chosen.bounds!.height) };
      }
      if (candidates.length > 1) break;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    active.lastFrame = undefined;
    throw new Error("Credential-safe Cua takeover requires exactly one visible dedicated Chrome window");
  }

  private imageContent(result: CuaToolResult): { data: string; mimeType: "image/png" | "image/jpeg" } {
    const item = result.content?.find((entry) => entry.type === "image" && typeof entry.data === "string");
    if (!item || typeof item.data !== "string") throw new Error("Cua Driver did not return a credential-safe frame");
    if (item.mimeType !== "image/png" && item.mimeType !== "image/jpeg") {
      throw new Error("Cua Driver returned an unsupported credential-safe frame type");
    }
    return { data: item.data, mimeType: item.mimeType };
  }

  private positiveInt(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private imageDimensions(data: string, mimeType: "image/png" | "image/jpeg"): { width: number; height: number } {
    const bytes = Buffer.from(data, "base64");
    if (mimeType === "image/png" && bytes.length >= 24 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG") {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1]!;
        if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
        }
        offset += 2 + length;
      }
    }
    throw new Error("Credential-safe frame dimensions could not be verified");
  }

  private cuaKey(key: string): string | undefined {
    return ({ Enter: "return", Tab: "tab", Escape: "escape", Backspace: "delete", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as Record<string, string>)[key];
  }
}
