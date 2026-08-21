import assert from "node:assert/strict";
import test from "node:test";
import { proxyTakeoverRequest } from "./proxy.mjs";

const PRIVATE_BEARER = "0123456789abcdefghijklmn";
const CLIENT_BINDING = "native-client-binding-aaaaaaaa";
const RECONNECT_HANDLE = "native-reconnect-handle-abcdefghijklmnopqrstuvwxyz012345";

async function proxyAndCapture(path, headers, body) {
  let seen;
  const response = await proxyTakeoverRequest(new Request(`https://gateway.example${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer public-oauth-token",
      cookie: "mbm_takeover_operator=operator-secret",
      "content-type": "application/json",
      "x-takeover-native-client": "1",
      "x-takeover-client": CLIENT_BINDING,
      ...headers
    },
    body: JSON.stringify(body)
  }), {
    coreUrl: "http://127.0.0.1:8081/mcp",
    privateBearer: PRIVATE_BEARER,
    fetchImpl: async (url, init) => {
      seen = {
        url,
        method: init.method,
        authorization: init.headers.get("authorization"),
        cookie: init.headers.get("cookie"),
        nativeClient: init.headers.get("x-takeover-native-client"),
        client: init.headers.get("x-takeover-client"),
        reconnect: init.headers.get("x-mcp-takeover-reconnect"),
        contentType: init.headers.get("content-type"),
        body: JSON.parse(await new Response(init.body).text())
      };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
  });
  return { response, seen };
}

test("Native claim preserves only bounded broker headers and JSON endpoint body", async () => {
  const endpoint = {
    clientHost: "192.0.2.20",
    videoPort: 46_000,
    inputFeedbackPort: 46_001
  };
  const { response, seen } = await proxyAndCapture(
    "/takeover/api/claim/abc12345",
    {},
    endpoint
  );

  assert.equal(response.status, 200);
  assert.equal(seen.url, "http://127.0.0.1:8081/takeover/api/claim/abc12345");
  assert.equal(seen.method, "POST");
  assert.equal(seen.authorization, `Bearer ${PRIVATE_BEARER}`);
  assert.equal(seen.cookie, null);
  assert.equal(seen.nativeClient, "1");
  assert.equal(seen.client, CLIENT_BINDING);
  assert.equal(seen.reconnect, null);
  assert.equal(seen.contentType, "application/json");
  assert.deepEqual(seen.body, endpoint);
});

test("Native reconnect forwards the reconnect handle but never the operator cookie/public bearer", async () => {
  const endpoint = {
    clientHost: "192.0.2.21",
    videoPort: 46_000,
    inputFeedbackPort: 46_001
  };
  const { response, seen } = await proxyAndCapture(
    "/takeover/api/reconnect/abc12345",
    { "x-mcp-takeover-reconnect": RECONNECT_HANDLE },
    endpoint
  );

  assert.equal(response.status, 200);
  assert.equal(seen.authorization, `Bearer ${PRIVATE_BEARER}`);
  assert.equal(seen.cookie, null);
  assert.equal(seen.nativeClient, "1");
  assert.equal(seen.client, CLIENT_BINDING);
  assert.equal(seen.reconnect, RECONNECT_HANDLE);
  assert.deepEqual(seen.body, endpoint);
});
