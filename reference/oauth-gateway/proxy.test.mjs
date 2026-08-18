import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateBearer,
  buildCoreRequestHeaders,
  buildPublicResponseHeaders,
  proxyMcpRequest,
  safeCoreUrl
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
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.1"
  });
  const headers = buildCoreRequestHeaders(inbound, "0123456789abcdefghijklmn");
  assert.equal(headers.get("authorization"), "Bearer 0123456789abcdefghijklmn");
  assert.equal(headers.get("mcp-session-id"), "session-1");
  assert.equal(headers.get("mcp-protocol-version"), "2026-07-28");
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
  assert.equal(headers.get("x-internal-debug"), null);
});

test("proxy replaces the public token with the private core bearer", async () => {
  let seen;
  const response = await proxyMcpRequest(new Request("https://gateway.example/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer public-oauth-token",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
  }), {
    coreUrl: "https://core.example.internal/mcp",
    privateBearer: "0123456789abcdefghijklmn",
    fetchImpl: async (url, init) => {
      seen = { url, authorization: init.headers.get("authorization"), body: await new Response(init.body).text() };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "server-session" }
      });
    }
  });
  assert.equal(seen.url, "https://core.example.internal/mcp");
  assert.equal(seen.authorization, "Bearer 0123456789abcdefghijklmn");
  assert.equal(seen.body.includes("public-oauth-token"), false);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-session-id"), "server-session");
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
