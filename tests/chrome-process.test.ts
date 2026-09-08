import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { buildBrowserProcessEnv, buildChromeArgs, ChromeProcess, parseDevToolsActivePort } from "../src/browser/chrome-process.js";

test("parses a Chrome DevToolsActivePort record with browser identity", () => {
  assert.deepEqual(
    parseDevToolsActivePort("43123\n/devtools/browser/abc-123_def.456\n"),
    { port: 43123, browserPath: "/devtools/browser/abc-123_def.456" }
  );
});

test("rejects incomplete or malformed DevToolsActivePort records", () => {
  assert.equal(parseDevToolsActivePort("43123\n"), undefined);
  assert.equal(parseDevToolsActivePort("not-a-port\n/devtools/browser/abc\n"), undefined);
  assert.equal(parseDevToolsActivePort("70000\n/devtools/browser/abc\n"), undefined);
  assert.equal(parseDevToolsActivePort("43123\n/devtools/page/abc\n"), undefined);
});

test("does not disable the Chromium sandbox by default", () => {
  const args = buildChromeArgs({ profileDir: "/tmp/test-profile", headless: true });
  assert.equal(args.includes("--no-sandbox"), false);
});

test("normal Agent Chromium does not restore prior session state by default", () => {
  const args = buildChromeArgs({ profileDir: "/tmp/test-profile", headless: false });
  assert.equal(args.includes("--restore-last-session"), false);
});

test("a scoped Agent launch can restore persisted session cookies from the dedicated profile", () => {
  const args = buildChromeArgs(
    { profileDir: "/tmp/test-profile", headless: false },
    { restoreLastSession: true }
  );
  assert.equal(args.includes("--restore-last-session"), true);
});

test("session-restore arming fails closed for an external CDP browser", () => {
  const chrome = new ChromeProcess({
    profileDir: "/tmp/test-profile",
    headless: false,
    externalCdpPort: 9222
  });
  assert.throws(() => chrome.requestNextStartSessionRestore(), /external CDP browser/);
});

test("adds --no-sandbox only for explicit Linux opt-in", { skip: process.platform !== "linux" }, () => {
  const args = buildChromeArgs({
    profileDir: "/tmp/test-profile",
    headless: true,
    allowUnsandboxedChromium: true
  });
  assert.equal(args.includes("--no-sandbox"), true);
});


test("browser child environment strips server-side secret material", () => {
  const env = buildBrowserProcessEnv({
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    LANG: "en_US.UTF-8",
    MCP_BEARER_TOKEN: "bearer-secret",
    MCP_HANDOFF_CLOUDFLARE_TURN_KEY_API_TOKEN: "turn-secret",
    MAPS_HANDOFF_CHECKPOINT_KEY: "checkpoint-secret",
    AWS_SESSION_TOKEN: "aws-secret",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/credential.json",
    SAFE_FEATURE_FLAG: "1"
  });

  assert.deepEqual(env, {
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    LANG: "en_US.UTF-8",
    SAFE_FEATURE_FLAG: "1"
  });
});


test("browser child environment preserves the local graphical environment while stripping secrets", () => {
  const env = buildBrowserProcessEnv({
    DISPLAY: ":99",
    XDG_RUNTIME_DIR: "/tmp/runtime",
    MAPS_OPERATOR_SECRET: "must-not-leak",
    HOME: "/home/mcp"
  });
  assert.equal(env.DISPLAY, ":99");
  assert.equal(env.XDG_RUNTIME_DIR, "/tmp/runtime");
  assert.equal(env.HOME, "/home/mcp");
  assert.equal(env.MAPS_OPERATOR_SECRET, undefined);
});


test("scoped restore rejects a live endpoint from disk and consumes the request only once", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "maps-fresh-owner-"));
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ Browser: "Chromium/152", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/test-owned" }));
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await writeFile(path.join(profileDir, "DevToolsActivePort"), `${address.port}\n/devtools/browser/test-owned\n`);
    const chrome = new ChromeProcess({ profileDir, headless: true, executable: "/nonexistent/must-not-spawn" });
    chrome.requestNextStartSessionRestore();
    await assert.rejects(chrome.start(), /requires a stopped dedicated profile/);
    // A subsequent ordinary call may attach: the rejected request must not leak.
    assert.equal(await chrome.start(), address.port);
    chrome.requestNextStartSessionRestore();
    await assert.rejects(chrome.start(), /requires a fresh Chrome process/);
    assert.equal(await chrome.start(), address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("Agent close recognizes a signal-terminated process as stopped", { skip: process.platform === "win32" }, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const chrome = new ChromeProcess({ profileDir: "/unused", headless: true });
  try {
    await once(child, "spawn");
    (chrome as unknown as { child?: ChildProcess }).child = child;
    await chrome.close();
    assert.equal(child.signalCode, "SIGTERM");
    assert.equal(child.exitCode, null);
    await chrome.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
