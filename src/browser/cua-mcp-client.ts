import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import readline from "node:readline";

const CUA_MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_CUA_JSON_LINE_CHARS = 8_000_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const CUA_HUMAN_TOOL_NAMES = new Set([
  "bring_to_front",
  "list_windows",
  "get_window_state",
  "click",
  "scroll",
  "type_text",
  "press_key"
] as const);

export type CuaHumanToolName = "bring_to_front" | "list_windows" | "get_window_state" | "click" | "scroll" | "type_text" | "press_key";

export interface CuaToolResult {
  content?: Array<{ type?: unknown; data?: unknown; mimeType?: unknown; text?: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface CuaToolClient {
  callTool(name: CuaHumanToolName, args: Record<string, unknown>): Promise<CuaToolResult>;
  close(): Promise<void>;
}

interface JsonRpcResponse { id?: number; result?: unknown; error?: unknown; }
type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class CuaMcpClient implements CuaToolClient {
  private child?: ChildProcessByStdio<Writable, Readable, null>;
  private reader?: readline.Interface;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private initialized = false;

  constructor(private readonly command = "cua-driver", private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async start(): Promise<void> {
    if (this.initialized && this.child?.exitCode === null) return;
    await this.close();
    const child = spawn(this.command, ["mcp"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    this.child = child;
    child.once("exit", () => this.failPending("Cua Driver MCP transport closed"));
    child.once("error", () => this.failPending("Cua Driver MCP transport failed"));
    const reader = readline.createInterface({ input: child.stdout });
    this.reader = reader;
    reader.on("line", (line) => this.handleLine(line));

    const response = await this.request("initialize", {
      protocolVersion: CUA_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "maps-browser-mcp-credential-human", version: "1" }
    });
    if (!response.result || typeof response.result !== "object") throw new Error("Cua Driver MCP initialization failed");
    this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async callTool(name: CuaHumanToolName, args: Record<string, unknown>): Promise<CuaToolResult> {
    if (!CUA_HUMAN_TOOL_NAMES.has(name)) throw new Error("Cua Driver tool is outside the credential-safe Human transport allowlist");
    await this.start();
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error || !response.result || typeof response.result !== "object") throw new Error("Cua Driver tool call failed");
    const result = response.result as CuaToolResult;
    if (result.isError) throw new Error("Cua Driver tool call failed");
    return result;
  }

  async close(): Promise<void> {
    this.initialized = false;
    this.reader?.close();
    this.reader = undefined;
    this.failPending("Cua Driver MCP transport closed");
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 800))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  private handleLine(line: string): void {
    if (!line || line.length > MAX_CUA_JSON_LINE_CHARS) return;
    let response: JsonRpcResponse;
    try { response = JSON.parse(line) as JsonRpcResponse; } catch { return; }
    if (!Number.isInteger(response.id)) return;
    const id = response.id!;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  private request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const child = this.child;
    if (!child || child.exitCode !== null) return Promise.reject(new Error("Cua Driver MCP transport is unavailable"));
    const id = this.nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Cua Driver MCP request timed out"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(new Error("Cua Driver MCP request write failed"));
      });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private failPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
