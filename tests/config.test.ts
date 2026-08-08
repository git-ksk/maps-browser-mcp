import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackBind, loadConfig } from "../src/config.js";

const KEYS = [
  "MCP_HTTP_HOST",
  "MCP_BEARER_TOKEN",
  "MCP_TRUST_EXTERNAL_AUTH",
  "MCP_ALLOWED_HOSTS",
  "MCP_ALLOWED_ORIGINS",
  "MAPS_HEADLESS"
] as const;

async function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void | Promise<void>) {
  const before = new Map<string, string | undefined>();
  for (const key of KEYS) before.set(key, process.env[key]);
  try {
    for (const key of KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("recognizes loopback bind addresses", () => {
  assert.equal(isLoopbackBind("localhost"), true);
  assert.equal(isLoopbackBind("127.0.0.1"), true);
  assert.equal(isLoopbackBind("::1"), true);
  assert.equal(isLoopbackBind("0.0.0.0"), false);
});

test("refuses unauthenticated non-loopback binding", async () => {
  await withEnv({ MCP_HTTP_HOST: "0.0.0.0" }, () => {
    assert.throws(() => loadConfig(), /requires MCP_BEARER_TOKEN or MCP_TRUST_EXTERNAL_AUTH/);
  });
});

test("allows non-loopback binding with explicit external-auth trust", async () => {
  await withEnv({ MCP_HTTP_HOST: "0.0.0.0", MCP_TRUST_EXTERNAL_AUTH: "true" }, () => {
    assert.equal(loadConfig().http.trustExternalAuth, true);
  });
});

test("rejects weak configured bearer tokens", async () => {
  await withEnv({ MCP_BEARER_TOKEN: "short" }, () => {
    assert.throws(() => loadConfig(), /at least 24 characters/);
  });
});

test("rejects malformed boolean environment values", async () => {
  await withEnv({ MAPS_HEADLESS: "maybe" }, () => {
    assert.throws(() => loadConfig(), /must be a boolean/);
  });
});
