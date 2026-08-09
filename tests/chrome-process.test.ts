import assert from "node:assert/strict";
import test from "node:test";
import { buildChromeArgs, parseDevToolsActivePort } from "../src/browser/chrome-process.js";

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

test("adds --no-sandbox only for explicit Linux opt-in", { skip: process.platform !== "linux" }, () => {
  const args = buildChromeArgs({
    profileDir: "/tmp/test-profile",
    headless: true,
    allowUnsandboxedChromium: true
  });
  assert.equal(args.includes("--no-sandbox"), true);
});
