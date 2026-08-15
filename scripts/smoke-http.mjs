import { spawn } from "node:child_process";
import net from "node:net";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Unable to allocate a test port");
  return port;
}

async function waitForHealth(baseUrl, stderr) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        if (response.headers.get("cache-control") !== "no-store") {
          throw new Error("health response must use Cache-Control: no-store");
        }
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`HTTP server did not become ready. stderr: ${stderr()}`);
}

async function parseMcpResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error(`Missing SSE data: ${text}`);
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(text);
}

async function postMcp(baseUrl, message, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders
    },
    body: JSON.stringify(message)
  });
  if (!response.ok) {
    throw new Error(`MCP POST failed: ${response.status} ${await response.text()}`);
  }
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error("MCP response must use Cache-Control: no-store");
  }
  return parseMcpResponse(response);
}

function modernMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "maps-browser-mcp-ci-modern",
      version: "1"
    },
    "io.modelcontextprotocol/clientCapabilities": {}
  };
}

function modernHeaders(method, name) {
  return {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {})
  };
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
let stderr = "";
const child = spawn(process.execPath, ["dist/index.js", "--http"], {
  env: {
    ...process.env,
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: String(port),
    MCP_ALLOWED_HOSTS: "localhost,127.0.0.1",
    MCP_MAX_BODY_BYTES: "4096"
  },
  stdio: ["ignore", "ignore", "pipe"]
});
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  await waitForHealth(baseUrl, () => stderr);

  const initialized = await postMcp(baseUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "maps-browser-mcp-ci-legacy", version: "1" }
    }
  });
  if (initialized?.result?.serverInfo?.name !== "maps-browser-mcp") {
    throw new Error(`Unexpected initialize response: ${JSON.stringify(initialized)}`);
  }

  const discovered = await postMcp(baseUrl, {
    jsonrpc: "2.0",
    id: "discover-1",
    method: "server/discover",
    params: { _meta: modernMeta() }
  }, modernHeaders("server/discover"));
  if (!Array.isArray(discovered?.result?.supportedVersions) ||
      !discovered.result.supportedVersions.includes("2026-07-28")) {
    throw new Error(`Unexpected server/discover response: ${JSON.stringify(discovered)}`);
  }

  const modernTools = await postMcp(baseUrl, {
    jsonrpc: "2.0",
    id: "tools-modern-1",
    method: "tools/list",
    params: { _meta: modernMeta() }
  }, modernHeaders("tools/list"));
  const toolNames = new Set(
    Array.isArray(modernTools?.result?.tools)
      ? modernTools.result.tools.map((tool) => tool?.name).filter(Boolean)
      : []
  );
  if (
    toolNames.size !== 23 ||
    !toolNames.has("maps_search") ||
    !toolNames.has("maps_read_search_suggestions") ||
    !toolNames.has("maps_select_search_suggestion") ||
    !toolNames.has("maps_get_search_share_link") ||
    !toolNames.has("maps_set_search_rating") ||
    !toolNames.has("maps_zoom_search") ||
    !toolNames.has("maps_set_transit_time") ||
    !toolNames.has("maps_set_recommended_travel_mode") ||
    !toolNames.has("maps_swap_route_endpoints") ||
    !toolNames.has("maps_get_route_share_link") ||
    !toolNames.has("maps_get_place_share_link") ||
    !toolNames.has("maps_search_nearby") ||
    !toolNames.has("maps_open_place_photos") ||
    !toolNames.has("maps_select_place_tab") ||
    !toolNames.has("maps_expand_opening_hours") ||
    !toolNames.has("maps_read_route_summary")
  ) {
    throw new Error(`Unexpected modern tools/list response: ${JSON.stringify(modernTools)}`);
  }

  const modernToolCall = await postMcp(baseUrl, {
    jsonrpc: "2.0",
    id: "tool-modern-1",
    method: "tools/call",
    params: {
      name: "maps_read_place_summary",
      arguments: {},
      _meta: modernMeta()
    }
  }, modernHeaders("tools/call", "maps_read_place_summary"));
  if (modernToolCall?.result?.isError !== true) {
    throw new Error(`Expected safe-mode tool execution error: ${JSON.stringify(modernToolCall)}`);
  }

  const missingMethodHeader = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "bad-modern-1",
      method: "tools/list",
      params: { _meta: modernMeta() }
    })
  });
  if (missingMethodHeader.status !== 400) {
    throw new Error(`Expected missing Mcp-Method = 400, got ${missingMethodHeader.status}`);
  }

  const getResponse = await fetch(`${baseUrl}/mcp`);
  if (getResponse.status !== 405) throw new Error(`Expected GET /mcp = 405, got ${getResponse.status}`);
  if (getResponse.headers.get("cache-control") !== "no-store") {
    throw new Error("error responses must use Cache-Control: no-store");
  }

  const badOrigin = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: "{}"
  });
  if (badOrigin.status !== 403) throw new Error(`Expected invalid Origin = 403, got ${badOrigin.status}`);

  const tooLarge = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: "x".repeat(5000)
  });
  if (tooLarge.status !== 413) throw new Error(`Expected oversized body = 413, got ${tooLarge.status}`);

  console.log("HTTP/MCP smoke test passed for legacy and modern protocol eras");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
