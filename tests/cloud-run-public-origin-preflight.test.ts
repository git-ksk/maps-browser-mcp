import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHttpsOrigin,
  probeFreshTakeoverOperatorSurface,
  probePublicMcpBoundary,
  validatePublicOrigins
} from "../scripts/cloud-run-public-origin-preflight.mjs";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers
  });
}

test("managed public origin requires one exact credential-free HTTPS origin", () => {
  assert.equal(parseHttpsOrigin("https://maps.example", "TEST"), "https://maps.example");
  assert.throws(() => parseHttpsOrigin("http://maps.example", "TEST"), /HTTPS/);
  assert.throws(() => parseHttpsOrigin("https://user:pass@maps.example", "TEST"), /credentials/);
  assert.throws(() => parseHttpsOrigin("https://maps.example/path", "TEST"), /origin without a path/);
  assert.throws(() => validatePublicOrigins({
    MCP_PUBLIC_BASE_URL: "https://maps.example",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example"
  }), /must equal MCP_PUBLIC_BASE_URL/);
});

test("public MCP preflight recognizes only the expected fail-closed OAuth boundary", async () => {
  const origin = "https://maps.example";
  const goodFetch = async () => response(401, { error: "invalid_token" }, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="maps:use"`
  });
  await probePublicMcpBoundary(origin, origin, goodFetch as typeof fetch);

  const wrongBoundary = async () => response(404, { error: "not_found" }, {
    "cache-control": "no-store",
    "content-type": "application/json"
  });
  await assert.rejects(() => probePublicMcpBoundary(origin, origin, wrongBoundary as typeof fetch), /HTTP 401/);
});



test("candidate tag request origin may differ while OAuth metadata stays canonical", async () => {
  const advertisedOrigin = "https://maps.example";
  const requestOrigin = "https://candidate---maps.example";
  let requestedUrl = "";
  const goodFetch = async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return response(401, { error: "invalid_token" }, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": `Bearer resource_metadata="${advertisedOrigin}/.well-known/oauth-protected-resource/mcp", scope="maps:use"`
    });
  };
  await probePublicMcpBoundary(requestOrigin, advertisedOrigin, goodFetch as typeof fetch);
  assert.equal(requestedUrl, `${requestOrigin}/mcp`);
});

test("fresh takeover preflight keeps the locator out of output and requires the same public origin", async () => {
  const origin = "https://maps.example";
  const fresh = `${origin}/takeover/12345678-abcd`;
  const goodFetch = async () => new Response(null, {
    status: 200,
    headers: { "cache-control": "no-store" }
  });
  await probeFreshTakeoverOperatorSurface(origin, fresh, goodFetch as typeof fetch);
  await assert.rejects(
    () => probeFreshTakeoverOperatorSurface(origin, "https://other.example/takeover/12345678-abcd", goodFetch as typeof fetch),
    /canonical public origin/
  );
  await assert.rejects(
    () => probeFreshTakeoverOperatorSurface(origin, `${fresh}?token=secret`, goodFetch as typeof fetch),
    /query, or fragment/
  );
});
