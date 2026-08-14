import { spawn } from "node:child_process";
import readline from "node:readline";

const EXPECTED_TOOLS = [
  "maps_search",
  "maps_set_search_rating",
  "maps_directions",
  "maps_show",
  "maps_streetview",
  "maps_select_result",
  "maps_get_place_share_link",
  "maps_search_nearby",
  "maps_open_place_photos",
  "maps_select_place_tab",
  "maps_expand_opening_hours",
  "maps_select_route",
  "maps_set_travel_mode",
  "maps_read_place_summary",
  "maps_read_route_summary"
];
const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

function assertTools(listed, era) {
  const tools = listed?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`Unexpected ${era} stdio tools/list response: ${JSON.stringify(listed)}`);
  }
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  for (const name of EXPECTED_TOOLS) {
    if (!names.has(name)) throw new Error(`Missing ${era} stdio MCP tool: ${name}`);
  }
}

function assertMcpAppsServerCapability(initialized, expected) {
  const ui = initialized?.result?.capabilities?.extensions?.[MCP_APPS_EXTENSION_ID];
  const supported = Array.isArray(ui?.mimeTypes) && ui.mimeTypes.includes(MCP_APP_MIME_TYPE);
  if (supported !== expected) {
    throw new Error(`Unexpected MCP Apps server capability: ${JSON.stringify(initialized)}`);
  }
}

function assertRenderFallback(called) {
  if (called?.result?.structuredContent?.origin !== "Tokyo Station" ||
      called?.result?.structuredContent?.destination !== "Shibuya Station" ||
      called?.result?.structuredContent?.mode !== "transit" ||
      !called?.result?.content?.[0]?.text?.includes("Tokyo Station")) {
    throw new Error(`Unexpected MCP Apps fallback result: ${JSON.stringify(called)}`);
  }
}

async function withStdioSession(run, extraEnv = {}) {
  const child = spawn(process.execPath, ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv }
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

  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
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

  try {
    await run({ request, send });
    if (parseError) throw parseError;
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
}

await withStdioSession(async ({ request, send }) => {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "maps-browser-mcp-stdio-legacy", version: "1" }
  });
  if (initialized?.result?.serverInfo?.name !== "maps-browser-mcp") {
    throw new Error(`Unexpected legacy stdio initialize response: ${JSON.stringify(initialized)}`);
  }
  assertMcpAppsServerCapability(initialized, false);
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const listed = await request(2, "tools/list", {});
  assertTools(listed, "legacy");
  if (listed?.result?.tools?.some((tool) => tool?.name === "maps_render_directions")) {
    throw new Error(`MCP Apps tool exposed without API key: ${JSON.stringify(listed)}`);
  }
}, { GOOGLE_MAPS_EMBED_API_KEY: "" });

await withStdioSession(async ({ request }) => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "maps-browser-mcp-stdio-modern",
      version: "1"
    },
    "io.modelcontextprotocol/clientCapabilities": {}
  };
  const discovered = await request("discover-modern", "server/discover", { _meta: meta });
  if (!Array.isArray(discovered?.result?.supportedVersions) ||
      !discovered.result.supportedVersions.includes("2026-07-28")) {
    throw new Error(`Unexpected modern stdio server/discover response: ${JSON.stringify(discovered)}`);
  }
  assertTools(await request("tools-modern", "tools/list", { _meta: meta }), "modern");
}, { GOOGLE_MAPS_EMBED_API_KEY: "" });

await withStdioSession(async ({ request, send }) => {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "maps-browser-mcp-text-fallback-smoke", version: "1" }
  });
  assertMcpAppsServerCapability(initialized, true);
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const listed = await request(2, "tools/list", {});
  assertTools(listed, "MCP Apps text fallback");
  const renderTool = listed?.result?.tools?.find((tool) => tool?.name === "maps_render_directions");
  if (!renderTool) {
    throw new Error(`Missing display-only fallback tool: ${JSON.stringify(listed)}`);
  }

  const called = await request(3, "tools/call", {
    name: "maps_render_directions",
    arguments: {
      origin: "Tokyo Station",
      destination: "Shibuya Station",
      mode: "transit"
    }
  });
  assertRenderFallback(called);
}, { GOOGLE_MAPS_EMBED_API_KEY: "smoke-test-key" });

await withStdioSession(async ({ request, send }) => {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {
      extensions: {
        [MCP_APPS_EXTENSION_ID]: {
          mimeTypes: [MCP_APP_MIME_TYPE]
        }
      }
    },
    clientInfo: { name: "maps-browser-mcp-app-smoke", version: "1" }
  });
  if (initialized?.result?.serverInfo?.name !== "maps-browser-mcp") {
    throw new Error(`Unexpected MCP Apps smoke initialize response: ${JSON.stringify(initialized)}`);
  }
  assertMcpAppsServerCapability(initialized, true);
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const listed = await request(2, "tools/list", {});
  assertTools(listed, "MCP Apps-enabled");
  const renderTool = listed?.result?.tools?.find((tool) => tool?.name === "maps_render_directions");
  if (renderTool?._meta?.ui?.resourceUri !== "ui://maps-browser-mcp/directions.html") {
    throw new Error(`Missing MCP Apps tool linkage: ${JSON.stringify(renderTool)}`);
  }

  const resource = await request(3, "resources/read", {
    uri: "ui://maps-browser-mcp/directions.html"
  });
  const content = resource?.result?.contents?.[0];
  if (content?.mimeType !== MCP_APP_MIME_TYPE ||
      content?._meta?.ui?.csp?.frameDomains?.[0] !== "https://www.google.com" ||
      !content?.text?.includes("ui/notifications/tool-result")) {
    throw new Error(`Unexpected MCP Apps resource: ${JSON.stringify(resource)}`);
  }

  const called = await request(4, "tools/call", {
    name: "maps_render_directions",
    arguments: {
      origin: "Tokyo Station",
      destination: "Shibuya Station",
      mode: "transit"
    }
  });
  assertRenderFallback(called);
}, { GOOGLE_MAPS_EMBED_API_KEY: "smoke-test-key" });

console.log("stdio MCP smoke test passed for legacy, modern, MCP Apps text fallback, and negotiated UI paths");