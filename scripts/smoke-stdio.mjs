import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"]
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let parseError;

lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    parseError = new Error(`Non-JSON stdout corrupted the MCP stdio channel: ${line}`, { cause: error });
    return;
  }
  if (message && (typeof message.id === "number" || typeof message.id === "string")) {
    const waiter = pending.get(String(message.id));
    if (waiter) {
      pending.delete(String(message.id));
      waiter.resolve(message);
    }
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = String(id);
    const timer = setTimeout(() => {
      pending.delete(key);
      reject(new Error(`Timed out waiting for stdio response to ${method}. stderr: ${stderr}`));
    }, 5_000);
    pending.set(key, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      }
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

try {
  // Exercise the supported 2025-era stdio handshake. serveStdio also negotiates the
  // 2026 era; the important process-level checks here are clean stdout, tool
  // registration, and an actual round trip over stdin/stdout.
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "maps-browser-mcp-stdio-ci", version: "1" }
  });
  if (initialized?.result?.serverInfo?.name !== "maps-browser-mcp") {
    throw new Error(`Unexpected stdio initialize response: ${JSON.stringify(initialized)}`);
  }

  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const listed = await request(2, "tools/list", {});
  const tools = listed?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`Unexpected stdio tools/list response: ${JSON.stringify(listed)}`);
  }
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  const expected = [
    "maps_search",
    "maps_directions",
    "maps_show",
    "maps_streetview",
    "maps_select_result",
    "maps_select_route",
    "maps_set_travel_mode",
    "maps_read_place_summary",
    "maps_read_route_summary"
  ];
  for (const name of expected) {
    if (!names.has(name)) throw new Error(`Missing stdio MCP tool: ${name}`);
  }
  if (parseError) throw parseError;

  console.log("stdio MCP smoke test passed");
} finally {
  lines.close();
  child.stdin.end();
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
