import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateBearer,
  buildCoreRequestHeaders,
  buildPublicResponseHeaders,
  buildTakeoverCoreRequestHeaders,
  buildTakeoverPublicResponseHeaders,
  proxyMcpRequest,
  proxyTakeoverRequest,
  safeCoreUrl,
  takeoverCoreUrl
} from "./proxy.mjs";

test("core URL is exact and private-hop shaped", () => {
  assert.equal(safeCoreUrl("https://core.example.internal/mcp"), "https://core.example.internal/mcp");
  assert.equal(safeCoreUrl("http://127.0.0.1:3000/mcp"), "http://127.0.0.1:3000/mcp");
  assert.throws(() => safeCoreUrl("https://core.example.internal/other"));
  assert.throws(() => safeCoreUrl("http://core.example.internal/mcp"));
});

test("private bearer must satisfy the core static-bearer floor", () => {
  assert.equal(assertPrivateBearer("0123456789abcdefghijklmn"), "0123456789abcdefghijklmn");
  assert.throws(() => assertPrivateBearer("short"));
  assert.throws(() => assertPrivateBearer("0123456789abc defghijklmn"));
});

test("public OAuth credentials are never forwarded to the core", () => {
  const inbound = new Headers({
    authorization: "Bearer public-oauth-token",
    cookie: "session=private",
    "mcp-session-id": "session-1",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/list",
    "mcp-name": "maps_search",
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.1"
  });
  const headers = buildCoreRequestHeaders(inbound, "0123456789abcdefghijklmn");
  assert.equal(headers.get("authorization"), "Bearer 0123456789abcdefghijklmn");
  assert.equal(headers.get("mcp-session-id"), "session-1");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("x-forwarded-for"), null);
  assert.equal([...headers.values()].some((value) => value.includes("public-oauth-token")), false);
});

test("core response exposes only transport-safe MCP headers", () => {
  const headers = buildPublicResponseHeaders(new Headers({
    "content-type": "text/event-stream",
    "mcp-session-id": "session-2",
    "set-cookie": "private=1",
    "www-authenticate": "Bearer realm=core",
    "x-internal-debug": "secret"
  }));
  assert.equal(headers.get("content-type"), "text/event-stream");
  assert.equal(headers.get("mcp-session-id"), "session-2");
  assert.equal(headers.get("set-cookie"), null);
  assert.equal(headers.get("www-authenticate"), null);
});

test("takeover proxy derives only a same-core /takeover path", () => {
  assert.equal(
    takeoverCoreUrl("http://127.0.0.1:8081/mcp", "https://public.example/takeover/abc12345"),
    "http://127.0.0.1:8081/takeover/abc12345"
  );
  assert.throws(() => takeoverCoreUrl("http://127.0.0.1:8081/mcp", "https://public.example/other"));
  assert.throws(() => takeoverCoreUrl("http://127.0.0.1:8081/mcp", "https://public.example/takeover/abc12345?secret=x"));
});

test("takeover proxy strips public cookie/auth and preserves bounded broker headers", () => {
  const headers = buildTakeoverCoreRequestHeaders(new Headers({
    authorization: "Bearer public-oauth-token",
    cookie: "mbm_takeover_operator=private",
    origin: "https://public.example",
    "sec-fetch-site": "same-origin",
    "x-takeover-client": "abcdefghijklmnopqrstuvwxyz123456",
    "x-mcp-takeover-capability": "abcdefghijklmnopqrstuvwxyz1234567890ABCDEF",
    "x-forwarded-for": "203.0.113.4"
  }), "0123456789abcdefghijklmn");
  assert.equal(headers.get("authorization"), "Bearer 0123456789abcdefghijklmn");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("origin"), "https://public.example");
  assert.equal(headers.get("sec-fetch-site"), "same-origin");
  assert.equal(headers.get("x-takeover-client"), "abcdefghijklmnopqrstuvwxyz123456");
  assert.equal(headers.get("x-forwarded-for"), null);
});

test("takeover response exposes frame/stream/CSP headers but no core secrets", () => {
  const headers = buildTakeoverPublicResponseHeaders(new Headers({
    "content-type": "application/octet-stream",
    "content-security-policy": "default-src 'none'",
    "x-takeover-stream": "1",
    "x-takeover-width": "1280",
    "x-takeover-height": "720",
    "x-takeover-host": "accounts.google.com",
    "set-cookie": "core=secret",
    "www-authenticate": "Bearer realm=core",
    "x-internal-debug": "secret"
  }));
  assert.equal(headers.get("x-takeover-stream"), "1");
  assert.equal(headers.get("x-takeover-width"), "1280");
  assert.equal(headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(headers.get("set-cookie"), null);
  assert.equal(headers.get("www-authenticate"), null);
});

test("proxy replaces the public token with the private core bearer", async () => {
  let seen;
  const response = await proxyMcpRequest(new Request("https://gateway.example/mcp", {
    method: "POST",
    headers: { authorization: "Bearer public-oauth-token", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
  }), {
    coreUrl: "https://core.example.internal/mcp",
    privateBearer: "0123456789abcdefghijklmn",
    fetchImpl: async (url, init) => {
      seen = { url, authorization: init.headers.get("authorization"), body: await new Response(init.body).text() };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(seen.url, "https://core.example.internal/mcp");
  assert.equal(seen.authorization, "Bearer 0123456789abcdefghijklmn");
  assert.equal(seen.body.includes("public-oauth-token"), false);
  assert.equal(response.status, 200);
});

test("takeover streaming body is forwarded without buffering or credential reflection", async () => {
  let seen;
  const source = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
  const response = await proxyTakeoverRequest(new Request("https://gateway.example/takeover/api/stream/abc12345", {
    headers: {
      cookie: "mbm_takeover_operator=secret",
      "x-takeover-client": "abcdefghijklmnopqrstuvwxyz123456",
      "x-mcp-takeover-capability": "abcdefghijklmnopqrstuvwxyz1234567890ABCDEF"
    }
  }), {
    coreUrl: "http://127.0.0.1:8081/mcp",
    privateBearer: "0123456789abcdefghijklmn",
    fetchImpl: async (url, init) => {
      seen = { url, authorization: init.headers.get("authorization"), cookie: init.headers.get("cookie") };
      return new Response(source, { status: 200, headers: { "content-type": "application/octet-stream", "x-takeover-stream": "1" } });
    }
  });
  assert.equal(seen.url, "http://127.0.0.1:8081/takeover/api/stream/abc12345");
  assert.equal(seen.authorization, "Bearer 0123456789abcdefghijklmn");
  assert.equal(seen.cookie, null);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(response.headers.get("x-takeover-stream"), "1");
});

test("private core auth failures are not reflected as public OAuth challenges", async () => {
  const response = await proxyMcpRequest(new Request("https://gateway.example/mcp"), {
    coreUrl: "https://core.example.internal/mcp",
    privateBearer: "0123456789abcdefghijklmn",
    fetchImpl: async () => new Response("no", { status: 401, headers: { "www-authenticate": "Bearer realm=core" } })
  });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("www-authenticate"), null);
});
