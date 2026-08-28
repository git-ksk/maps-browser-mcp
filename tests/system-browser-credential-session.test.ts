import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCredentialSafeChromeArgs,
  parseLinuxWindowIds,
  parseLocalLinuxSingletonLockPid,
  resolveLinuxExactWindowId,
  SystemBrowserCredentialSession
} from "../src/browser/system-browser-credential-session.js";
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



test("Linux exact-window parser keeps only unique positive safe integer ids", () => {
  assert.deepEqual(parseLinuxWindowIds("42\n42 77 invalid -1 0"), [42, 77]);
});

test("Linux exact-window lookup requires one stable visible window owned by the normal Chrome PID", async () => {
  const calls: string[] = [];
  const windowId = await resolveLinuxExactWindowId(4242, ":99", {
    timeoutMs: 1_000,
    pollMs: 0,
    runCommand: async (_executable, args, env) => {
      calls.push(`${args.join(" ")}:${env.DISPLAY}`);
      if (args[0] === "search") return "9001\n";
      if (args[0] === "getwindowpid") return "4242\n";
      throw new Error("unexpected xdotool operation");
    }
  });
  assert.equal(windowId, 9001);
  assert.deepEqual(calls, [
    "search --onlyvisible --pid 4242::99",
    "getwindowpid 9001::99",
    "search --onlyvisible --pid 4242::99",
    "getwindowpid 9001::99"
  ]);
  assert.equal(calls.some((call) => call.includes("getwindowname")), false);
});

test("Linux exact-window lookup strips sensitive parent environment from xdotool", async () => {
  const previousSecret = process.env.MAPS_PRIVATE_TEST_SECRET;
  process.env.MAPS_PRIVATE_TEST_SECRET = "must-not-reach-helper";
  try {
    const seenEnvs: NodeJS.ProcessEnv[] = [];
    await resolveLinuxExactWindowId(4242, ":99", {
      timeoutMs: 1_000,
      pollMs: 0,
      runCommand: async (_executable, args, env) => {
        seenEnvs.push(env);
        if (args[0] === "search") return "9001\n";
        return "4242\n";
      }
    });
    assert.ok(seenEnvs.length >= 4);
    for (const env of seenEnvs) {
      assert.equal(env.DISPLAY, ":99");
      assert.equal(env.MAPS_PRIVATE_TEST_SECRET, undefined);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.MAPS_PRIVATE_TEST_SECRET;
    else process.env.MAPS_PRIVATE_TEST_SECRET = previousSecret;
  }
});

test("Linux exact-window lookup fails closed for ambiguous windows without inspecting content", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => resolveLinuxExactWindowId(4242, ":99", {
      timeoutMs: 0,
      pollMs: 0,
      runCommand: async (_executable, args) => {
        calls.push(args.join(" "));
        return "9001\n9002\n";
      }
    }),
    /exact window is unavailable/
  );
  assert.deepEqual(calls, ["search --onlyvisible --pid 4242"]);
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
