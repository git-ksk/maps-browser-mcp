import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import https from "node:https";
import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 10_000;

export function parseHttpsOrigin(value, name) {
  assert(typeof value === "string" && value.trim(), `${name} is required`);
  const url = new URL(value.trim());
  assert(!url.username && !url.password, `${name} must not contain credentials`);
  assert(!url.search && !url.hash, `${name} must not contain query or fragment`);
  assert(url.pathname === "/" || url.pathname === "", `${name} must be an origin without a path`);
  assert(url.protocol === "https:", `${name} must use HTTPS`);
  return url.origin;
}

export function validatePublicOrigins(env = process.env) {
  const mcpOrigin = parseHttpsOrigin(env.MCP_PUBLIC_BASE_URL, "MCP_PUBLIC_BASE_URL");
  const takeoverOrigin = parseHttpsOrigin(env.MAPS_TAKEOVER_PUBLIC_BASE_URL, "MAPS_TAKEOVER_PUBLIC_BASE_URL");
  assert.equal(
    takeoverOrigin,
    mcpOrigin,
    "MAPS_TAKEOVER_PUBLIC_BASE_URL must equal MCP_PUBLIC_BASE_URL for the managed public gateway"
  );
  return mcpOrigin;
}

function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

export async function probePublicMcpBoundary(requestOrigin, advertisedOrigin = requestOrigin, fetchImpl = fetch) {
  const response = await fetchImpl(`${requestOrigin}/mcp`, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: timeoutSignal()
  });
  assert.equal(response.status, 401, "public /mcp probe must reach the OAuth gateway and fail closed with HTTP 401");
  assert.equal(response.headers.get("cache-control"), "no-store", "public /mcp rejection must be non-cacheable");
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/i, "public /mcp rejection must be JSON");
  const body = await response.json();
  assert.equal(body?.error, "invalid_token", "public /mcp probe did not reach the expected OAuth token boundary");
  const challenge = response.headers.get("www-authenticate") || "";
  const expectedMetadata = `${advertisedOrigin}/.well-known/oauth-protected-resource/mcp`;
  assert.match(challenge, /^Bearer\b/i, "public /mcp rejection must emit a Bearer challenge");
  assert.ok(challenge.includes(`resource_metadata="${expectedMetadata}"`), "OAuth resource metadata must use the canonical public origin");
  return true;
}

export async function probeFreshTakeoverOperatorSurface(origin, takeoverUrlValue, fetchImpl = fetch) {
  assert(typeof takeoverUrlValue === "string" && takeoverUrlValue.trim(), "MAPS_PREFLIGHT_TAKEOVER_URL is required for the fresh takeover probe");
  const takeoverUrl = new URL(takeoverUrlValue.trim());
  assert.equal(takeoverUrl.origin, origin, "fresh takeover URL must use the canonical public origin");
  assert(!takeoverUrl.username && !takeoverUrl.password && !takeoverUrl.search && !takeoverUrl.hash, "fresh takeover URL must not contain credentials, query, or fragment");
  assert(/^\/takeover\/[A-Za-z0-9-]{8,100}$/.test(takeoverUrl.pathname), "fresh takeover URL must contain only a bounded locator path");

  const response = await fetchImpl(takeoverUrl, {
    method: "HEAD",
    redirect: "manual",
    signal: timeoutSignal()
  });
  assert.equal(response.status, 200, "fresh takeover locator must reach the operator-auth surface before transport negotiation");
  assert.equal(response.headers.get("cache-control"), "no-store", "takeover operator surface must be non-cacheable");
  return true;
}

export async function probeUnauthenticatedTakeoverUpgradeBoundary(requestOrigin, advertisedOrigin = requestOrigin, requestImpl = https.request) {
  const url = new URL("/takeover/ws/preflight", requestOrigin);
  const key = randomBytes(16).toString("base64");
  const status = await new Promise((resolve, reject) => {
    const req = requestImpl(url, {
      method: "GET",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        origin: advertisedOrigin,
        "sec-websocket-key": key,
        "sec-websocket-version": "13",
        "sec-websocket-protocol": "mcp-handoff-wss.v1"
      },
      timeout: REQUEST_TIMEOUT_MS
    });
    req.once("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.once("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("unauthenticated WebSocket preflight unexpectedly upgraded"));
    });
    req.once("timeout", () => req.destroy(new Error("WebSocket preflight timed out")));
    req.once("error", reject);
    req.end();
  });
  assert.equal(status, 401, "unauthenticated takeover WebSocket upgrade must reach the same gateway and fail closed with HTTP 401");
  return true;
}

export async function runPublicOriginPreflight(env = process.env) {
  const advertisedOrigin = validatePublicOrigins(env);
  const requestOrigin = env.MCP_PREFLIGHT_REQUEST_ORIGIN?.trim()
    ? parseHttpsOrigin(env.MCP_PREFLIGHT_REQUEST_ORIGIN, "MCP_PREFLIGHT_REQUEST_ORIGIN")
    : advertisedOrigin;
  await probePublicMcpBoundary(requestOrigin, advertisedOrigin);
  console.log("Public MCP OAuth boundary: ok");
  await probeUnauthenticatedTakeoverUpgradeBoundary(requestOrigin, advertisedOrigin);
  console.log("Public takeover WebSocket boundary: fail-closed ok");

  const freshTakeoverUrl = env.MAPS_PREFLIGHT_TAKEOVER_URL?.trim();
  if (freshTakeoverUrl) {
    await probeFreshTakeoverOperatorSurface(advertisedOrigin, freshTakeoverUrl);
    console.log("Fresh takeover operator-auth surface: ok");
  } else {
    console.log("Fresh takeover operator-auth surface: skipped (no fresh locator supplied)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPublicOriginPreflight();
}
