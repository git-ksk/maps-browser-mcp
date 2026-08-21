import assert from "node:assert/strict";
import test from "node:test";
import { buildCredentialSafeChromeArgs, parseLocalLinuxSingletonLockPid, SystemBrowserCredentialSession } from "../src/browser/system-browser-credential-session.js";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("credential-safe normal Chrome uses the dedicated profile without remote debugging or automation flags", () => {
  const args = buildCredentialSafeChromeArgs({
    profileDir: "/tmp/maps-dedicated-profile",
    startUrl: "https://www.google.com/maps"
  });
  assert.ok(args.includes("--user-data-dir=/tmp/maps-dedicated-profile"));
  assert.equal(args.at(-1), "https://www.google.com/maps");
  assert.equal(args.some((value) => value.startsWith("--remote-debugging")), false);
  assert.equal(args.some((value) => /automation/i.test(value)), false);
  assert.equal(args.some((value) => value === "--headless" || value.startsWith("--headless=")), false);
  assert.equal(args.includes("--no-sandbox"), false);
});

test("credential-safe normal Chrome adds --no-sandbox only for explicit Linux opt-in", { skip: process.platform !== "linux" }, () => {
  const args = buildCredentialSafeChromeArgs({
    profileDir: "/tmp/maps-dedicated-profile",
    startUrl: "https://www.google.com/maps",
    allowUnsandboxedChromium: true
  });
  assert.equal(args.includes("--no-sandbox"), true);
  assert.equal(args.some((value) => value.startsWith("--remote-debugging")), false);
  assert.equal(args.some((value) => /automation/i.test(value)), false);
  assert.equal(args.some((value) => value === "--headless" || value.startsWith("--headless=")), false);
});


test("Linux singleton lock parsing is host-bound and PID-bounded", () => {
  assert.equal(parseLocalLinuxSingletonLockPid("container-a-123", "container-a"), 123);
  assert.equal(parseLocalLinuxSingletonLockPid("container-b-123", "container-a"), undefined);
  assert.equal(parseLocalLinuxSingletonLockPid("container-a-0", "container-a"), undefined);
  assert.equal(parseLocalLinuxSingletonLockPid("container-a-not-a-pid", "container-a"), undefined);
});

test("credential-safe Linux profile clears only dead same-host Chromium singleton symlinks", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-browser-lock-test-"));
  const deadPid = 2_000_000_000;
  try {
    await symlink(`${os.hostname()}-${deadPid}`, path.join(root, "SingletonLock"));
    await symlink("cookie", path.join(root, "SingletonCookie"));
    await symlink("/tmp/nonexistent-maps-browser-socket", path.join(root, "SingletonSocket"));
    const session = new SystemBrowserCredentialSession({ profileDir: root, profileUnlockTimeoutMs: 100 });
    await session.assertProfileUnlocked();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});



test("credential-safe Linux profile keeps live same-host singleton ownership fail-closed", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-browser-lock-test-"));
  try {
    await symlink(`${os.hostname()}-${process.pid}`, path.join(root, "SingletonLock"));
    const session = new SystemBrowserCredentialSession({ profileDir: root, profileUnlockTimeoutMs: 100 });
    await assert.rejects(() => session.assertProfileUnlocked(), /still owned by another browser process/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("credential-safe Linux profile keeps ambiguous foreign-host singleton ownership fail-closed", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-browser-lock-test-"));
  try {
    await symlink(`other-host-${process.pid}`, path.join(root, "SingletonLock"));
    const session = new SystemBrowserCredentialSession({ profileDir: root, profileUnlockTimeoutMs: 100 });
    await assert.rejects(() => session.assertProfileUnlocked(), /still owned by another browser process/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
