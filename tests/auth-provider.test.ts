import assert from "node:assert/strict";
import test from "node:test";
import { createHttpAuthProvider } from "../src/auth-provider.js";
import type { AppConfig } from "../src/config.js";

function config(provider: AppConfig["auth"]["provider"], bearerToken?: string): AppConfig {
  return {
    auth: { provider },
    http: {
      host: "127.0.0.1",
      port: 8787,
      allowedHosts: ["localhost"],
      allowedOrigins: [],
      bearerToken,
      maxBodyBytes: 262144
    },
    browser: {
      profileDir: "/tmp/maps-browser-mcp-test",
      allowExternalCdp: false,
      headless: true,
      allowUnsandboxedChromium: false
    },
    policy: {
      interactiveAssist: false,
      maxActionsPerMinute: 30,
      maxVisibleReadsPerHour: 30,
      maxPendingActions: 8,
      operationTimeoutMs: 25000,
      maxAxNodes: 120,
      maxReadChars: 1800
    }
  };
}

const request = (authorization?: string) => ({
  method: "POST",
  url: new URL("https://example.invalid/mcp"),
  headers: authorization ? { authorization } : {}
});

test("none provider preserves local unauthenticated behavior", async () => {
  const provider = await createHttpAuthProvider(config("none"));
  assert.equal(provider.kind, "none");
  assert.equal((await provider.authorize(request())).allowed, true);
});

test("static bearer provider preserves case-insensitive Bearer semantics", async () => {
  const provider = await createHttpAuthProvider(config("static-bearer", "0123456789abcdefghijklmn"));
  assert.equal((await provider.authorize(request("bearer 0123456789abcdefghijklmn"))).allowed, true);
  const denied = await provider.authorize(request("Bearer wrong"));
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.status, 401);
    assert.match(denied.headers?.["www-authenticate"] ?? "", /^Bearer /);
  }
});
