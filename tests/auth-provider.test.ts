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
    takeover: {
      enabled: false,
      ttlMs: 300000
    },
    handoffCheckpoint: {
      enabled: false,
      ttlMs: 900000
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
  const decision = await provider.authorize(request());
  assert.equal(decision.allowed, true);
  if (decision.allowed) assert.equal(decision.principal.subject, "local");
});

test("static bearer provider returns a stable single-user principal", async () => {
  const provider = await createHttpAuthProvider(config("static-bearer", "0123456789abcdefghijklmn"));
  const allowed = await provider.authorize(request("bearer 0123456789abcdefghijklmn"));
  assert.equal(allowed.allowed, true);
  if (allowed.allowed) assert.equal(allowed.principal.subject, "static-bearer");

  const denied = await provider.authorize(request("Bearer wrong"));
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.status, 401);
    assert.match(denied.headers?.["www-authenticate"] ?? "", /^Bearer /);
  }
});
