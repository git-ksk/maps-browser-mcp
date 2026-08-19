import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const TAKEOVER_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "content-length",
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-mcp-takeover-capability",
  "x-mcp-takeover-reconnect",
  "x-takeover-client",
  "x-takeover-native-client"
]);

const TAKEOVER_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-security-policy",
  "content-type",
  "permissions-policy",
  "pragma",
  "referrer-policy",
  "x-content-type-options",
  "x-takeover-height",
  "x-takeover-host",
  "x-takeover-stream",
  "x-takeover-width"
]);

const TAKEOVER_PATH_PATTERN = /^\/takeover\/[A-Za-z0-9._~-]{1,512}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Unable to allocate a loopback port");
  return port;
}

async function waitForHealth(baseUrl, stderr) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HTTP server did not become ready. stderr: ${stderr()}`);
}

function modernMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "maps-browser-mcp-local-google-sign-in-acceptance",
      version: "1"
    },
    "io.modelcontextprotocol/clientCapabilities": {
      elicitation: { form: {} }
    }
  };
}

function modernHeaders(method, name, bearer) {
  return {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {}),
    authorization: `Bearer ${bearer}`
  };
}

async function parseMcpResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error("Missing SSE data in MCP response");
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(text);
}

async function postMcp(baseUrl, bearer, id, name, args, extra = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...modernHeaders("tools/call", name, bearer)
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        ...extra,
        _meta: modernMeta()
      }
    })
  });
  if (!response.ok) {
    throw new Error(`MCP POST failed for ${name}: ${response.status} ${await response.text()}`);
  }
  const parsed = await parseMcpResponse(response);
  if (parsed?.error) throw new Error(`MCP error for ${name}: ${parsed.error.message || "unknown error"}`);
  return parsed;
}

function toolJson(response, name) {
  if (response?.result?.isError) {
    const text = response?.result?.content?.[0]?.text || "unknown tool error";
    throw new Error(`${name} returned an error: ${text}`);
  }
  const text = response?.result?.content?.[0]?.text;
  assert(typeof text === "string", `${name} did not return text content`);
  return JSON.parse(text);
}

function takeoverLocatorFromInputRequired(response, expectedOrigin) {
  assert(response?.result?.resultType === "input_required", "Expected input_required from maps_request_human_sign_in");
  const request = response.result.inputRequests?.human_intervention;
  assert(request?.method === "elicitation/create", "Expected human_intervention elicitation request");
  const message = request?.params?.message;
  assert(typeof message === "string", "Handoff elicitation did not include a Human message");
  const match = message.match(/https?:\/\/[^\s]+/);
  assert(match, "Handoff message did not contain a local Thin Takeover URL");
  const url = new URL(match[0]);
  assert(url.origin === expectedOrigin, "Thin Takeover URL escaped the local acceptance gateway");
  assert(!url.search && !url.hash, "Thin Takeover URL unexpectedly included query or fragment data");
  assert(TAKEOVER_PATH_PATTERN.test(url.pathname), "Thin Takeover URL used an unexpected path");
  return {
    openUrl: url.toString(),
    pathname: url.pathname
  };
}

function startLoopbackTakeoverGateway(port, coreBaseUrl, bearer) {
  const server = createServer((req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    } catch {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end("Not Found");
      return;
    }
    if (
      !TAKEOVER_PATH_PATTERN.test(requestUrl.pathname) ||
      requestUrl.search ||
      requestUrl.hash ||
      !["GET", "HEAD", "POST"].includes(req.method || "")
    ) {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end("Not Found");
      return;
    }

    const upstream = new URL(requestUrl.pathname, coreBaseUrl);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (TAKEOVER_REQUEST_HEADERS.has(name.toLowerCase()) && value !== undefined) {
        headers[name] = value;
      }
    }
    headers.authorization = `Bearer ${bearer}`;

    const proxy = httpRequest(upstream, {
      method: req.method,
      headers
    }, (upstreamRes) => {
      const responseHeaders = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (TAKEOVER_RESPONSE_HEADERS.has(name.toLowerCase()) && value !== undefined) {
          responseHeaders[name] = value;
        }
      }
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      if (req.method === "HEAD") {
        res.end();
        upstreamRes.resume();
      } else {
        upstreamRes.pipe(res);
      }
    });

    proxy.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "cache-control": "no-store" });
      res.end("Bad Gateway");
    });
    req.pipe(proxy);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function openMacUrlWithoutArgv(url) {
  const child = spawn("osascript", [], { stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(`open location ${JSON.stringify(url)}\n`);
  child.unref();
}

async function assertTakeoverRevoked(gatewayPort, pathname) {
  assert(TAKEOVER_PATH_PATTERN.test(pathname), "Refusing to probe an invalid Thin Takeover path");
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: gatewayPort,
      path: pathname,
      method: "HEAD",
      headers: { accept: "text/html" }
    }, (response) => {
      const responseStatus = response.statusCode || 0;
      response.resume();
      resolve(responseStatus);
    });
    request.once("error", reject);
    request.end();
  });
  assert(status < 200 || status >= 300, `Revoked Thin Takeover locator remained usable: HTTP ${status}`);
}

if (process.platform !== "darwin") {
  throw new Error("This local acceptance harness currently supports macOS only");
}
if (process.env.MAPS_ACCEPT_REAL_GOOGLE_SIGN_IN !== "YES") {
  throw new Error("Set MAPS_ACCEPT_REAL_GOOGLE_SIGN_IN=YES to confirm this is an intentional real Google sign-in acceptance run");
}

const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), "maps-browser-mcp-google-signin-"));
const corePort = await freePort();
const gatewayPort = await freePort();
const coreBaseUrl = `http://127.0.0.1:${corePort}`;
const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
const bearer = randomBytes(32).toString("base64url");
let stderr = "";
let gateway;
let child;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

try {
  gateway = await startLoopbackTakeoverGateway(gatewayPort, coreBaseUrl, bearer);
  child = spawn(process.execPath, ["dist/index.js", "--http"], {
    env: {
      ...process.env,
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: String(corePort),
      MCP_ALLOWED_HOSTS: "localhost,127.0.0.1",
      MCP_ALLOWED_ORIGINS: gatewayBaseUrl,
      MCP_AUTH_PROVIDER: "static-bearer",
      MCP_BEARER_TOKEN: bearer,
      MAPS_REMOTE_TAKEOVER: "true",
      MAPS_TAKEOVER_PUBLIC_BASE_URL: gatewayBaseUrl,
      MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
      MAPS_CREDENTIAL_SAFE_TRANSPORT: "thin_takeover",
      MAPS_CHROME_PROFILE_DIR: profileDir,
      MAPS_HEADLESS: "false",
      INTERACTIVE_ASSIST_MODE: "true",
      MAPS_V5_AUTHENTICATED_WORKFLOWS: "true"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  await waitForHealth(coreBaseUrl, () => stderr);

  const search = await postMcp(coreBaseUrl, bearer, "search-1", "maps_search", { query: "Tokyo Station" });
  toolJson(search, "maps_search");

  const before = toolJson(
    await postMcp(coreBaseUrl, bearer, "readiness-before", "maps_read_authenticated_readiness", {}),
    "maps_read_authenticated_readiness"
  );
  assert(before.state === "signed_out", `Disposable profile must start signed_out; got ${before.state}`);
  console.log("Precondition passed: disposable dedicated profile is signed_out.");

  const handoff = await postMcp(coreBaseUrl, bearer, "sign-in-1", "maps_request_human_sign_in", {});
  const takeover = takeoverLocatorFromInputRequired(handoff, gatewayBaseUrl);
  const requestState = handoff.result.requestState;
  assert(typeof requestState === "string" && requestState.length > 0, "Handoff did not return requestState");

  openMacUrlWithoutArgv(takeover.openUrl);
  console.log("Local Thin Takeover opened. Complete Google sign-in there. No credential values are read or logged by this harness.");
  await rl.question("After sign-in is visibly complete and you have pressed Done in Takeover, press Enter here to continue: ");

  const resumed = await postMcp(coreBaseUrl, bearer, "sign-in-2", "maps_request_human_sign_in", {}, {
    inputResponses: {
      human_intervention: {
        action: "accept",
        content: { decision: "continue" }
      }
    },
    requestState
  });
  const resumedJson = toolJson(resumed, "maps_request_human_sign_in");
  assert(
    resumedJson?.humanStepCompleted === true && resumedJson?.authenticatedReadiness === "must_recheck",
    "Handoff did not require a fresh post-Human readiness check"
  );
  await assertTakeoverRevoked(gatewayPort, takeover.pathname);
  console.log("Revocation passed: the completed Thin Takeover locator is no longer usable.");

  const after = toolJson(
    await postMcp(coreBaseUrl, bearer, "readiness-after", "maps_read_authenticated_readiness", {}),
    "maps_read_authenticated_readiness"
  );
  assert(after.state === "signed_in", `Fresh post-Handoff readiness must be signed_in; got ${after.state}`);
  console.log("Core #104 sign-in recovery passed: fresh post-Handoff readiness is signed_in.");

  const postSearch = toolJson(
    await postMcp(coreBaseUrl, bearer, "search-2", "maps_search", { query: "Tokyo Station" }),
    "maps_search"
  );
  void postSearch;
  const summary = toolJson(
    await postMcp(coreBaseUrl, bearer, "summary-1", "maps_read_place_summary", {}),
    "maps_read_place_summary"
  );
  assert(Array.isArray(summary.items) && summary.items.length > 0, "No bounded place result available for V5-B read");
  const first = summary.items[0];
  assert(Number.isInteger(first?.index) && typeof first?.label === "string", "Invalid bounded place identity");

  const selected = toolJson(
    await postMcp(coreBaseUrl, bearer, "select-1", "maps_select_result", {
      index: first.index,
      expectedLabel: first.label
    }),
    "maps_select_result"
  );
  assert(typeof selected.selected === "string" && selected.selected.length > 0, "Place selection did not return a verified label");

  const saveState = await postMcp(coreBaseUrl, bearer, "v5b-read-1", "maps_read_place_save_state", {
    expectedLabel: selected.selected
  });
  toolJson(saveState, "maps_read_place_save_state");
  console.log("Bounded authenticated V5-B read passed without printing account-backed list content.");
  console.log("Acceptance harness intentionally performs no account mutation or cross-device send without a separate explicit approval run.");
} finally {
  rl.close();
  if (child) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (gateway) {
    await new Promise((resolve) => gateway.close(resolve));
  }
  await fsp.rm(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 150
  }).catch(() => undefined);
}
