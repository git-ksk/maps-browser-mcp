import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackBind, loadConfig, validateWebRtcPlatformDisplay } from "../src/config.js";

const KEYS = [
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "PORT",
  "MCP_ALLOW_NONLOOPBACK",
  "MCP_BEARER_TOKEN",
  "MCP_AUTH_PROVIDER",
  "MCP_AUTH_PROVIDER_MODULE",
  "MCP_ALLOWED_HOSTS",
  "MCP_ALLOWED_ORIGINS",
  "MAPS_BROWSER_BACKEND",
  "MAPS_CDP_PORT",
  "MAPS_ALLOW_EXTERNAL_CDP",
  "MAPS_ALLOW_UNSANDBOXED_CHROMIUM",
  "MAPS_OPERATION_TIMEOUT_MS",
  "MAPS_HEADLESS",
  "MAPS_REMOTE_TAKEOVER",
  "MAPS_TAKEOVER_PUBLIC_BASE_URL",
  "MAPS_TAKEOVER_TTL_SECONDS",
  "MAPS_CREDENTIAL_SAFE_HANDOFF",
  "MAPS_CREDENTIAL_SAFE_TRANSPORT",
  "MAPS_CREDENTIAL_SAFE_OPERATOR_URL",
  "MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE",
  "MAPS_CUA_DRIVER_COMMAND",
  "MAPS_NATIVE_TAKEOVER_ADVERTISED_HOST",
  "MAPS_NATIVE_TAKEOVER_INPUT_BIND_HOST",
  "MAPS_NATIVE_TAKEOVER_FEEDBACK_BIND_HOST",
  "MAPS_NATIVE_TAKEOVER_CONTROL_BIND_HOST",
  "MAPS_NATIVE_TAKEOVER_INPUT_PORT",
  "MAPS_NATIVE_TAKEOVER_CONTROL_PORT",
  "MAPS_NATIVE_TAKEOVER_VIDEO_FEEDBACK_PORT",
  "MAPS_NATIVE_TAKEOVER_DISPLAY_ID",
  "MAPS_NATIVE_TAKEOVER_HOST_EXECUTABLE",
  "MAPS_NATIVE_TAKEOVER_REVOKE_EXECUTABLE",
  "MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE",
  "MAPS_WEBRTC_TAKEOVER_DISPLAY_ID",
  "MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME",
  "STEEL_API_KEY",
  "STEEL_BASE_URL",
  "MAPS_STEEL_PROFILE_ID",
  "MAPS_STEEL_SESSION_TIMEOUT_SECONDS",
  "MAPS_HANDOFF_CHECKPOINT_FILE",
  "MAPS_HANDOFF_CHECKPOINT_KEY",
  "MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS",
  "GOOGLE_MAPS_EMBED_API_KEY",
  "INTERACTIVE_ASSIST_MODE",
  "MAPS_V5_AUTHENTICATED_WORKFLOWS",
  "MAPS_CHROME_PROFILE_DIR"
] as const;

const CHECKPOINT_KEY = Buffer.alloc(32, 6).toString("base64url");

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

test("defaults to no auth locally and preserves bearer compatibility", async () => {
  await withEnv({}, () => {
    assert.equal(loadConfig().auth.provider, "none");
  });
  await withEnv({ MCP_BEARER_TOKEN: "0123456789abcdefghijklmn" }, () => {
    assert.equal(loadConfig().auth.provider, "static-bearer");
  });
});

test("validates module auth configuration", async () => {
  await withEnv({ MCP_AUTH_PROVIDER: "module" }, () => {
    assert.throws(() => loadConfig(), /requires MCP_AUTH_PROVIDER_MODULE/);
  });
  await withEnv({ MCP_AUTH_PROVIDER_MODULE: "./auth.mjs" }, () => {
    assert.throws(() => loadConfig(), /requires MCP_AUTH_PROVIDER=module/);
  });
  await withEnv({
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "./auth.mjs",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn"
  }, () => {
    assert.throws(() => loadConfig(), /cannot be combined/);
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

test("allows non-loopback binding with explicit opt-in and static bearer", async () => {
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

test("allows non-loopback binding with an explicit module auth provider", async () => {
  await withEnv({
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_ALLOW_NONLOOPBACK: "true",
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "./auth.mjs"
  }, () => {
    const config = loadConfig();
    assert.equal(config.auth.provider, "module");
    assert.equal(config.auth.module, "./auth.mjs");
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

test("V5 authenticated workflows are disabled by default", async () => {
  await withEnv({}, () => {
    assert.equal(loadConfig().v5.authenticatedWorkflows, false);
  });
});

test("V5 authenticated workflows require Interactive Assist", async () => {
  await withEnv({ MAPS_V5_AUTHENTICATED_WORKFLOWS: "true" }, () => {
    assert.throws(() => loadConfig(), /requires INTERACTIVE_ASSIST_MODE=true/);
  });
});

test("V5 authenticated workflows reject external CDP attachment", async () => {
  await withEnv({
    MAPS_V5_AUTHENTICATED_WORKFLOWS: "true",
    INTERACTIVE_ASSIST_MODE: "true",
    MAPS_ALLOW_EXTERNAL_CDP: "true",
    MAPS_CDP_PORT: "9222"
  }, () => {
    assert.throws(() => loadConfig(), /cannot be combined with MAPS_ALLOW_EXTERNAL_CDP=true/);
  });
});

test("V5 authenticated workflows reject multi-principal-capable module auth until profile isolation exists", async () => {
  await withEnv({
    MAPS_V5_AUTHENTICATED_WORKFLOWS: "true",
    INTERACTIVE_ASSIST_MODE: "true",
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "./auth.mjs"
  }, () => {
    assert.throws(() => loadConfig(), /does not yet allow MCP_AUTH_PROVIDER=module/);
  });
});

test("V5 authenticated workflows accept the current single-user local and static-bearer shapes", async () => {
  await withEnv({
    MAPS_V5_AUTHENTICATED_WORKFLOWS: "true",
    INTERACTIVE_ASSIST_MODE: "true"
  }, () => {
    const config = loadConfig();
    assert.equal(config.v5.authenticatedWorkflows, true);
    assert.equal(config.auth.provider, "none");
  });

  await withEnv({
    MAPS_V5_AUTHENTICATED_WORKFLOWS: "true",
    INTERACTIVE_ASSIST_MODE: "true",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn"
  }, () => {
    const config = loadConfig();
    assert.equal(config.v5.authenticatedWorkflows, true);
    assert.equal(config.auth.provider, "static-bearer");
  });
});

test("V5 authenticated workflows require an absolute dedicated profile path when overridden", async () => {
  await withEnv({
    MAPS_V5_AUTHENTICATED_WORKFLOWS: "true",
    INTERACTIVE_ASSIST_MODE: "true",
    MAPS_CHROME_PROFILE_DIR: "relative-profile"
  }, () => {
    assert.throws(() => loadConfig(), /absolute dedicated profile path/);
  });
});

test("rejects malformed boolean environment values", async () => {
  await withEnv({ MAPS_HEADLESS: "maybe" }, () => {
    assert.throws(() => loadConfig(), /must be a boolean/);
  });
});

test("remote takeover is disabled by default", async () => {
  await withEnv({}, () => {
    const config = loadConfig();
    assert.equal(config.takeover.enabled, false);
    assert.equal(config.takeover.ttlMs, 300_000);
  });
});

test("remote takeover requires loopback Node bind, HTTPS origin and authenticated principal provider", async () => {
  await withEnv({ MAPS_REMOTE_TAKEOVER: "true" }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_TAKEOVER_PUBLIC_BASE_URL/);
  });

  await withEnv({
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "http://takeover.example"
  }, () => {
    assert.throws(() => loadConfig(), /must use HTTPS/);
  });

  await withEnv({
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example"
  }, () => {
    assert.throws(() => loadConfig(), /requires MCP_AUTH_PROVIDER/);
  });

  await withEnv({
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_ALLOW_NONLOOPBACK: "true",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example"
  }, () => {
    assert.throws(() => loadConfig(), /requires a loopback MCP_HTTP_HOST/);
  });
});

test("remote takeover accepts authenticated principal provider and bounded TTL on loopback", async () => {
  await withEnv({
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "./auth.mjs",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MAPS_TAKEOVER_TTL_SECONDS: "180"
  }, () => {
    const config = loadConfig();
    assert.equal(config.takeover.enabled, true);
    assert.equal(config.takeover.publicBaseUrl, "https://takeover.example");
    assert.equal(config.takeover.ttlMs, 180_000);
    assert.equal(config.http.host, "127.0.0.1");
    assert.equal(config.auth.provider, "module");
  });

  await withEnv({
    MCP_AUTH_PROVIDER: "module",
    MCP_AUTH_PROVIDER_MODULE: "./auth.mjs",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MAPS_TAKEOVER_TTL_SECONDS: "601"
  }, () => {
    assert.throws(() => loadConfig(), /between 60 and 600/);
  });
});

test("takeover public origin cannot be configured accidentally while feature is off", async () => {
  await withEnv({ MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example" }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_REMOTE_TAKEOVER=true/);
  });
});

test("credential-safe Human handoff is opt-in and keeps external remote access optional", async () => {
  await withEnv({}, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.enabled, false);
    assert.equal(config.credentialSafeHandoff.transport, "external");
    assert.equal(config.credentialSafeHandoff.operatorUrl, undefined);
    assert.equal(config.credentialSafeHandoff.cuaCommand, "cua-driver");
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile"
  }, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.enabled, true);
    assert.equal(config.credentialSafeHandoff.operatorUrl, undefined);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_CREDENTIAL_SAFE_OPERATOR_URL: "https://remote.example.test/access/path"
  }, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.operatorUrl, "https://remote.example.test/access/path");
  });
});

test("credential-safe Cua takeover is explicit and reuses the authenticated takeover gateway", async () => {
  await withEnv({ MAPS_CREDENTIAL_SAFE_TRANSPORT: "cua_takeover" }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_CREDENTIAL_SAFE_HANDOFF=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "cua_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile"
  }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_REMOTE_TAKEOVER=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "cua_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_CUA_DRIVER_COMMAND: "/opt/local/bin/cua-driver"
  }, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.transport, "cua_takeover");
    assert.equal(config.credentialSafeHandoff.cuaCommand, "/opt/local/bin/cua-driver");
    assert.equal(config.takeover.enabled, true);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "cua_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_CREDENTIAL_SAFE_OPERATOR_URL: "https://other.example/access"
  }, () => {
    assert.throws(() => loadConfig(), /cannot be combined with MAPS_CREDENTIAL_SAFE_TRANSPORT=cua_takeover/);
  });

  await withEnv({ MAPS_CREDENTIAL_SAFE_TRANSPORT: "unknown" }, () => {
    assert.throws(() => loadConfig(), /must be one of: external, cua_takeover, thin_takeover, webrtc_takeover, hosted_cdp/);
  });
});


test("hosted CDP takeover requires the authenticated broker and keeps deployment checkpoint optional", async () => {
  await withEnv({ MAPS_CREDENTIAL_SAFE_TRANSPORT: "hosted_cdp" }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_CREDENTIAL_SAFE_HANDOFF=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "hosted_cdp",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-hosted-profile"
  }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_REMOTE_TAKEOVER=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "hosted_cdp",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-hosted-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE: "/app/reference/oauth-gateway/profile-checkpoint-provider.mjs"
  }, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.transport, "hosted_cdp");
    assert.equal(config.browserProfileCheckpoint.module, "/app/reference/oauth-gateway/profile-checkpoint-provider.mjs");
    assert.equal(config.takeover.enabled, true);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "hosted_cdp",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-hosted-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_CREDENTIAL_SAFE_OPERATOR_URL: "https://other.example/access"
  }, () => {
    assert.throws(() => loadConfig(), /cannot be combined with MAPS_CREDENTIAL_SAFE_TRANSPORT=hosted_cdp/);
  });
});

test("stopped browser profile checkpoint module is deployment-only and absolute", async () => {
  await withEnv({
    MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE: "/app/profile-provider.mjs"
  }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_CREDENTIAL_SAFE_HANDOFF=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-profile",
    MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE: "relative-provider.mjs"
  }, () => {
    assert.throws(() => loadConfig(), /must be an absolute local module path/);
  });
});

test("WebRTC Takeover requires the authenticated broker and a Handoff-owned platform helper", async () => {
  const platformDisplayEnv = process.platform === "linux"
    ? { MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME: ":99" }
    : { MAPS_WEBRTC_TAKEOVER_DISPLAY_ID: "7" };

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "webrtc_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE: "/opt/thin/takeover-webrtc-host"
  }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_REMOTE_TAKEOVER=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "webrtc_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE: "/opt/thin/takeover-webrtc-host",
    ...platformDisplayEnv
  }, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.transport, "webrtc_takeover");
    assert.equal(config.credentialSafeHandoff.webRtcRuntime?.hostExecutable, "/opt/thin/takeover-webrtc-host");
    if (process.platform === "linux") {
      assert.equal(config.credentialSafeHandoff.webRtcRuntime?.displayName, ":99");
      assert.equal(config.credentialSafeHandoff.webRtcRuntime?.displayId, undefined);
    } else {
      assert.equal(config.credentialSafeHandoff.webRtcRuntime?.displayId, 7);
      assert.equal(config.credentialSafeHandoff.webRtcRuntime?.displayName, undefined);
    }
    assert.equal(config.takeover.enabled, true);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "webrtc_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE: "relative/takeover-webrtc-host",
    ...platformDisplayEnv
  }, () => {
    assert.throws(() => loadConfig(), /must be an absolute path/);
  });
});


test("WebRTC platform display config supports macOS display ids and Linux X11 display names only", () => {
  assert.deepEqual(validateWebRtcPlatformDisplay("darwin", 7, undefined), { displayId: 7 });
  assert.deepEqual(validateWebRtcPlatformDisplay("linux", undefined, ":99"), { displayName: ":99" });
  assert.deepEqual(validateWebRtcPlatformDisplay("linux", undefined, ":99.0"), { displayName: ":99.0" });
  assert.throws(() => validateWebRtcPlatformDisplay("linux", undefined, undefined), /DISPLAY_NAME is required/);
  assert.throws(() => validateWebRtcPlatformDisplay("linux", 7, ":99"), /DISPLAY_ID is macOS-only/);
  assert.throws(() => validateWebRtcPlatformDisplay("darwin", undefined, ":99"), /DISPLAY_NAME is Linux-only/);
  assert.throws(() => validateWebRtcPlatformDisplay("linux", undefined, "tcp:99"), /local X11 display/);
  assert.throws(() => validateWebRtcPlatformDisplay("win32", undefined, undefined), /only on macOS or Linux/);
});

test("keyless Thin Takeover requires the authenticated broker and rejects Steel provider settings", async () => {
  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "thin_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile"
  }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_REMOTE_TAKEOVER=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "thin_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn",
    MAPS_NATIVE_TAKEOVER_ADVERTISED_HOST: "192.0.2.10",
    MAPS_NATIVE_TAKEOVER_HOST_EXECUTABLE: "/opt/thin/takeover-macos-host",
    MAPS_NATIVE_TAKEOVER_REVOKE_EXECUTABLE: "/opt/thin/takeover-control-send"
  }, () => {
    const config = loadConfig();
    assert.equal(config.credentialSafeHandoff.transport, "thin_takeover");
    assert.equal(config.takeover.enabled, true);
    assert.equal(config.credentialSafeHandoff.nativeRuntime?.advertisedHost, "192.0.2.10");
    assert.equal(config.credentialSafeHandoff.nativeRuntime?.controlBindHost, "127.0.0.1");
    assert.equal(config.credentialSafeHandoff.nativeRuntime?.hostExecutable, "/opt/thin/takeover-macos-host");
  });

  await withEnv({
    MAPS_BROWSER_BACKEND: "steel",
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CREDENTIAL_SAFE_TRANSPORT: "thin_takeover",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_REMOTE_TAKEOVER: "true",
    MAPS_TAKEOVER_PUBLIC_BASE_URL: "https://takeover.example",
    MCP_BEARER_TOKEN: "0123456789abcdefghijklmn"
  }, () => {
    assert.throws(() => loadConfig(), /MAPS_BROWSER_BACKEND=steel was removed/);
  });

  await withEnv({ STEEL_API_KEY: "unused-provider-key" }, () => {
    assert.throws(() => loadConfig(), /STEEL_API_KEY is no longer used/);
  });
});

test("credential-safe Human handoff fails closed for unsafe browser ownership or URL configuration", async () => {
  await withEnv({ MAPS_CREDENTIAL_SAFE_OPERATOR_URL: "https://remote.example.test/access" }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_CREDENTIAL_SAFE_HANDOFF=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_ALLOW_EXTERNAL_CDP: "true",
    MAPS_CDP_PORT: "9222"
  }, () => {
    assert.throws(() => loadConfig(), /cannot be combined with MAPS_ALLOW_EXTERNAL_CDP=true/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "relative-profile"
  }, () => {
    assert.throws(() => loadConfig(), /requires MAPS_CHROME_PROFILE_DIR to resolve to an absolute dedicated profile path/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_CREDENTIAL_SAFE_OPERATOR_URL: "https://user:pass@remote.example.test/access"
  }, () => {
    assert.throws(() => loadConfig(), /must not contain URL credentials/);
  });

  await withEnv({
    MAPS_CREDENTIAL_SAFE_HANDOFF: "true",
    MAPS_CHROME_PROFILE_DIR: "/tmp/maps-credential-profile",
    MAPS_CREDENTIAL_SAFE_OPERATOR_URL: "https://remote.example.test/access?session=secret-like"
  }, () => {
    assert.throws(() => loadConfig(), /must not contain URL credentials, query, or fragment/);
  });
});

test("durable handoff checkpoint is disabled by default", async () => {
  await withEnv({}, () => {
    const config = loadConfig();
    assert.equal(config.handoffCheckpoint.enabled, false);
    assert.equal(config.handoffCheckpoint.ttlMs, 900_000);
  });
});

test("durable handoff checkpoint requires an absolute file and stable 32-byte key together", async () => {
  await withEnv({ MAPS_HANDOFF_CHECKPOINT_FILE: "/tmp/maps-handoff.json" }, () => {
    assert.throws(() => loadConfig(), /must be configured together/);
  });
  await withEnv({ MAPS_HANDOFF_CHECKPOINT_KEY: CHECKPOINT_KEY }, () => {
    assert.throws(() => loadConfig(), /must be configured together/);
  });
  await withEnv({
    MAPS_HANDOFF_CHECKPOINT_FILE: "relative.json",
    MAPS_HANDOFF_CHECKPOINT_KEY: CHECKPOINT_KEY
  }, () => {
    assert.throws(() => loadConfig(), /must be an absolute path/);
  });
  await withEnv({
    MAPS_HANDOFF_CHECKPOINT_FILE: "/tmp/maps-handoff.json",
    MAPS_HANDOFF_CHECKPOINT_KEY: "not-a-32-byte-key"
  }, () => {
    assert.throws(() => loadConfig(), /exactly 32 random bytes/);
  });
});

test("durable handoff checkpoint accepts a stable key and bounded TTL", async () => {
  await withEnv({
    MAPS_HANDOFF_CHECKPOINT_FILE: "/tmp/maps-handoff.json",
    MAPS_HANDOFF_CHECKPOINT_KEY: CHECKPOINT_KEY,
    MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS: "1200"
  }, () => {
    const config = loadConfig();
    assert.equal(config.handoffCheckpoint.enabled, true);
    assert.equal(config.handoffCheckpoint.filePath, "/tmp/maps-handoff.json");
    assert.equal(config.handoffCheckpoint.signingKey?.equals(Buffer.alloc(32, 6)), true);
    assert.equal(config.handoffCheckpoint.ttlMs, 1_200_000);
  });

  await withEnv({
    MAPS_HANDOFF_CHECKPOINT_FILE: "/tmp/maps-handoff.json",
    MAPS_HANDOFF_CHECKPOINT_KEY: CHECKPOINT_KEY,
    MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS: "86401"
  }, () => {
    assert.throws(() => loadConfig(), /between 60 and 86400/);
  });
});

test("MCP Apps map embed is disabled unless an API key is configured", async () => {
  await withEnv({}, () => {
    assert.equal(loadConfig().mcpApps.googleMapsEmbedApiKey, undefined);
  });

  await withEnv({ GOOGLE_MAPS_EMBED_API_KEY: "  test-embed-key  " }, () => {
    assert.equal(loadConfig().mcpApps.googleMapsEmbedApiKey, "test-embed-key");
  });

  await withEnv({ GOOGLE_MAPS_EMBED_API_KEY: "   " }, () => {
    assert.equal(loadConfig().mcpApps.googleMapsEmbedApiKey, undefined);
  });
});
