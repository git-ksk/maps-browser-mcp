import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackBind, loadConfig } from "../src/config.js";

const KEYS = [
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "PORT",
  "MCP_ALLOW_NONLOOPBACK",
  "MCP_AUTH_PROVIDER",
  "MCP_AUTH_PROVIDER_MODULE",
  "MCP_BEARER_TOKEN",
  "MCP_ALLOWED_HOSTS",
  "MCP_ALLOWED_ORIGINS",
  "MAPS_CDP_PORT",
  "MAPS_ALLOW_EXTERNAL_CDP",
  "MAPS_ALLOW_UNSANDBOXED_CHROMIUM",
  "MAPS_OPERATION_TIMEOUT_MS",
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

test("uses PORT as a generic fallback when MCP_HTTP_PORT is unset", async () => {
  await withEnv({ PORT: "9090" }, () => {
    assert.equal(loadConfig().http.port, 9090);
  });
});

test("MCP_HTTP_PORT takes precedence over PORT", async () => {
  await withEnv({ MCP_HTTP_PORT: "8788", PORT: "9090" }, () => {
    assert.equal(loadConfig().http.port, 8788);
  });
});

test("validates the generic PORT fallback", async () => {
  await withEnv({ PORT: "70000" }, () => {
    assert.throws(() => loadConfig(), /PORT must be an integer between 1 and 65535/);
  });
});

test("keeps legacy bearer configuration backward compatible", async () => {
  await withEnv({ MCP_BEARER_TOKEN: "0123456789abcdefghijklmn" }, () => {
    assert.equal(loadConfig().auth.provider, "static-bearer");
  });
});

test("refuses non-loopback binding without explicit opt-in", async () => {
  await withEnv({
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn"
  }, () => {
    assert.throws(() => loadConfig(), /MCP_ALLOW_NONLOOPBACK=true/);
  });
});

test("refuses unauthenticated non-loopback binding even after opt-in", async () => {
  await withEnv({ MCP_HTTP_HOST: "0.0.0.0", MCP_ALLOW_NONLOOPBACK: "true" }, () => {
    assert.throws(() => loadConfig(), /requires an HTTP auth provider/);
  });
});

test("allows non-loopback binding with explicit opt-in and a static bearer transport guard", async () => {
  await withEnv({
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_ALLOW_NONLOOPBACK: "true",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn"
  }, () => {
    const config = loadConfig();
    assert.equal(config.http.host, "0.0.0.0");
    assert.equal(config.auth.provider, "static-bearer");
  });
});

test("allows non-loopback binding with an explicit auth provider module", async () => {
  await withEnv({
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_ALLOW_NONLOOPBACK: "true",
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "@example/maps-auth"
  }, () => {
    const config = loadConfig();
    assert.equal(config.auth.provider, "module");
    assert.equal(config.auth.module, "@example/maps-auth");
  });
});

test("requires a module specifier for module auth", async () => {
  await withEnv({ MCP_AUTH_PROVIDER: "module" }, () => {
    assert.throws(() => loadConfig(), /requires MCP_AUTH_PROVIDER_MODULE/);
  });
});

test("rejects module configuration outside module auth mode", async () => {
  await withEnv({ MCP_AUTH_PROVIDER_MODULE: "@example/maps-auth" }, () => {
    assert.throws(() => loadConfig(), /requires MCP_AUTH_PROVIDER=module/);
  });
});

test("rejects combining static bearer and module auth", async () => {
  await withEnv({
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "@example/maps-auth",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn"
  }, () => {
    assert.throws(() => loadConfig(), /cannot be combined/);
  });
});

test("rejects weak configured bearer tokens", async () => {
  await withEnv({ MCP_BEARER_TOKEN: "short" }, () => {
    assert.throws(() => loadConfig(), /at least 24 characters/);
  });
});

test("rejects whitespace in configured bearer transport tokens", async () => {
  await withEnv({ MCP_BEARER_TOKEN: "0123456789abc defghijklmn" }, () => {
    assert.throws(() => loadConfig(), /must not contain whitespace/);
  });
});

test("requires explicit opt-in before attaching to an existing CDP endpoint", async () => {
  await withEnv({ MAPS_CDP_PORT: "9222" }, () => {
    assert.throws(() => loadConfig(), /MAPS_ALLOW_EXTERNAL_CDP=true/);
  });

  await withEnv({ MAPS_CDP_PORT: "9222", MAPS_ALLOW_EXTERNAL_CDP: "true" }, () => {
    const config = loadConfig();
    assert.equal(config.browser.externalCdpPort, 9222);
    assert.equal(config.browser.allowExternalCdp, true);
  });
});

test("keeps Chromium sandboxing enabled unless explicitly opted out", async () => {
  await withEnv({}, () => {
    assert.equal(loadConfig().browser.allowUnsandboxedChromium, false);
  });
  await withEnv({ MAPS_ALLOW_UNSANDBOXED_CHROMIUM: "true" }, () => {
    assert.equal(loadConfig().browser.allowUnsandboxedChromium, true);
  });
});

test("validates operation watchdog bounds", async () => {
  await withEnv({ MAPS_OPERATION_TIMEOUT_MS: "4999" }, () => {
    assert.throws(() => loadConfig(), /between 5000 and 120000/);
  });
  await withEnv({ MAPS_OPERATION_TIMEOUT_MS: "45000" }, () => {
    assert.equal(loadConfig().policy.operationTimeoutMs, 45_000);
  });
});

test("rejects malformed boolean environment values", async () => {
  await withEnv({ MAPS_HEADLESS: "maybe" }, () => {
    assert.throws(() => loadConfig(), /must be a boolean/);
  });
});
