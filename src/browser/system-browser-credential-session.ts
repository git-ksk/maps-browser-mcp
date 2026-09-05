import { spawn, type ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildBrowserProcessEnv, findChromeExecutable } from "./chrome-process.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROFILE_LOCK_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

export function parseLocalLinuxSingletonLockPid(target: string, hostname = os.hostname()): number | undefined {
  const match = target.match(/^(.*)-([1-9]\d*)$/);
  if (!match || match[1] !== hostname) return undefined;
  const pid = Number.parseInt(match[2] ?? "", 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export interface SystemBrowserCredentialSessionOptions {
  executable?: string;
  profileDir: string;
  startUrl?: string;
  profileUnlockTimeoutMs?: number;
  allowUnsandboxedChromium?: boolean;
  takeoverDisplayName?: string;
  xdotoolExecutable?: string;
}

export interface CredentialTakeoverTarget {
  processId: number;
  windowId?: number;
}

type WindowCommandRunner = (
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
) => Promise<string>;

const EXACT_WINDOW_TIMEOUT_MS = 5_000;
const EXACT_WINDOW_POLL_MS = 100;

export function parseLinuxWindowIds(value: string): number[] {
  return [...new Set(value
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0))];
}

export async function resolveLinuxExactWindowId(
  processId: number,
  displayName: string,
  options: {
    xdotoolExecutable?: string;
    timeoutMs?: number;
    pollMs?: number;
    runCommand?: WindowCommandRunner;
  } = {}
): Promise<number> {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error("Credential-safe normal Chrome process is unavailable");
  }
  if (!/^:\d+(?:\.\d+)?$/.test(displayName)) {
    throw new Error("Credential-safe exact-window lookup requires a local X11 display");
  }
  const xdotoolExecutable = options.xdotoolExecutable ?? "/usr/bin/xdotool";
  if (!path.isAbsolute(xdotoolExecutable)) {
    throw new Error("Credential-safe xdotool executable must be an absolute path");
  }
  const timeoutMs = options.timeoutMs ?? EXACT_WINDOW_TIMEOUT_MS;
  const pollMs = options.pollMs ?? EXACT_WINDOW_POLL_MS;
  const runCommand = options.runCommand ?? runBoundedWindowCommand;
  const deadline = Date.now() + timeoutMs;
  const env = { ...buildBrowserProcessEnv(), DISPLAY: displayName };
  let stableWindowId: number | undefined;
  let stableSamples = 0;

  for (;;) {
    const rawIds = await runCommand(
      xdotoolExecutable,
      ["search", "--onlyvisible", "--pid", String(processId)],
      env
    ).catch(() => "");
    const ids = parseLinuxWindowIds(rawIds);
    if (ids.length === 1) {
      const windowId = ids[0]!;
      const rawOwner = await runCommand(
        xdotoolExecutable,
        ["getwindowpid", String(windowId)],
        env
      ).catch(() => "");
      const ownerPid = Number(rawOwner.trim());
      if (Number.isSafeInteger(ownerPid) && ownerPid === processId) {
        if (stableWindowId === windowId) stableSamples += 1;
        else {
          stableWindowId = windowId;
          stableSamples = 1;
        }
        if (stableSamples >= 2) return windowId;
      } else {
        stableWindowId = undefined;
        stableSamples = 0;
      }
    } else {
      stableWindowId = undefined;
      stableSamples = 0;
    }

    if (Date.now() >= deadline) {
      throw new Error("Credential-safe normal Chrome exact window is unavailable");
    }
    await sleep(pollMs);
  }
}

export function buildCredentialSafeChromeArgs(options: Pick<SystemBrowserCredentialSessionOptions, "profileDir" | "startUrl" | "allowUnsandboxedChromium">): string[] {
  const args = [
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--new-window",
    options.startUrl ?? "https://www.google.com/maps"
  ];
  if (process.platform === "linux" && options.allowUnsandboxedChromium) {
    args.unshift("--no-sandbox");
  }
  return args;
}


export async function requestLinuxGracefulWindowClose(
  processId: number,
  windowId: number,
  displayName: string,
  options: {
    xdotoolExecutable?: string;
    runCommand?: WindowCommandRunner;
  } = {}
): Promise<boolean> {
  if (!Number.isSafeInteger(processId) || processId <= 0 || !Number.isSafeInteger(windowId) || windowId <= 0) {
    return false;
  }
  if (!/^:\d+(?:\.\d+)?$/.test(displayName)) return false;
  const xdotoolExecutable = options.xdotoolExecutable ?? "/usr/bin/xdotool";
  if (!path.isAbsolute(xdotoolExecutable)) return false;
  const runCommand = options.runCommand ?? runBoundedWindowCommand;
  const env = { ...buildBrowserProcessEnv(), DISPLAY: displayName };
  const rawOwner = await runCommand(
    xdotoolExecutable,
    ["getwindowpid", String(windowId)],
    env
  ).catch(() => "");
  const ownerPid = Number(rawOwner.trim());
  if (!Number.isSafeInteger(ownerPid) || ownerPid !== processId) return false;
  await runCommand(
    xdotoolExecutable,
    ["windowclose", String(windowId)],
    env
  );
  return true;
}

export class SystemBrowserCredentialSession {
  private child?: ChildProcess;
  private takeoverWindowId?: number;
  private warnedUnsandboxed = false;

  constructor(private readonly options: SystemBrowserCredentialSessionOptions) {}

  isActive(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  getPid(): number | undefined {
    return this.isActive() ? this.child?.pid : undefined;
  }

  async getTakeoverTarget(): Promise<CredentialTakeoverTarget> {
    const processId = this.getPid();
    if (!processId) throw new Error("Credential-safe normal Chrome process is unavailable");
    if (process.platform !== "linux" || !this.options.takeoverDisplayName) {
      return { processId };
    }
    const windowId = await resolveLinuxExactWindowId(processId, this.options.takeoverDisplayName, {
      ...(this.options.xdotoolExecutable ? { xdotoolExecutable: this.options.xdotoolExecutable } : {})
    });
    if (this.getPid() !== processId) {
      throw new Error("Credential-safe normal Chrome process changed during exact-window lookup");
    }
    this.takeoverWindowId = windowId;
    return { processId, windowId };
  }

  async start(): Promise<void> {
    if (this.isActive()) return;
    this.child = undefined;
    this.takeoverWindowId = undefined;
    await fsp.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await fsp.chmod(this.options.profileDir, 0o700).catch(() => undefined);
    }
    await this.waitForProfileUnlock();

    const executable = findChromeExecutable(this.options.executable);
    if (process.platform === "linux" && this.options.allowUnsandboxedChromium && !this.warnedUnsandboxed) {
      this.warnedUnsandboxed = true;
      console.error(
        "[maps-browser-mcp] WARNING: Credential-safe normal Chromium is running with --no-sandbox because MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true. Use this only in a dedicated, isolated single-user runtime."
      );
    }
    const child = spawn(executable, buildCredentialSafeChromeArgs(this.options), { stdio: "ignore", env: buildBrowserProcessEnv() });
    this.child = child;
    let startupError: Error | undefined;
    child.once("error", (error) => { startupError = error; });
    await sleep(350);
    if (startupError || child.exitCode !== null) {
      this.child = undefined;
      throw new Error("Normal Chrome could not be started for credential-safe Human control");
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    const takeoverWindowId = this.takeoverWindowId;
    this.child = undefined;
    this.takeoverWindowId = undefined;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      if (process.platform === "linux" && child.pid !== undefined && this.options.takeoverDisplayName && takeoverWindowId !== undefined) {
        await requestLinuxGracefulWindowClose(child.pid, takeoverWindowId, this.options.takeoverDisplayName, {
          ...(this.options.xdotoolExecutable ? { xdotoolExecutable: this.options.xdotoolExecutable } : {})
        }).catch(() => undefined);
        await Promise.race([exited, sleep(2_000)]);
      }
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([exited, sleep(2_000)]);
      }
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await Promise.race([exited, sleep(1_000)]);
      }
    }
    await this.waitForProfileUnlock();
  }

  async assertProfileUnlocked(): Promise<void> {
    await this.clearStaleLinuxProfileLocks();
    const locked = await this.profileLockNames();
    if (locked.length > 0) {
      throw new Error("Dedicated Chrome profile is still owned by another browser process");
    }
  }

  private async waitForProfileUnlock(): Promise<void> {
    const deadline = Date.now() + (this.options.profileUnlockTimeoutMs ?? 5_000);
    for (;;) {
      await this.clearStaleLinuxProfileLocks();
      const locked = await this.profileLockNames();
      if (locked.length === 0) return;
      if (Date.now() >= deadline) {
        throw new Error("Dedicated Chrome profile did not become available for a safe browser handoff");
      }
      await sleep(100);
    }
  }

  private async clearStaleLinuxProfileLocks(): Promise<void> {
    if (process.platform !== "linux") return;
    const lockPath = path.join(this.options.profileDir, "SingletonLock");
    let target: string;
    try {
      target = await fsp.readlink(lockPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EINVAL") return;
      throw error;
    }
    const ownerPid = parseLocalLinuxSingletonLockPid(target);
    if (ownerPid === undefined || processExists(ownerPid)) return;

    // Chromium may leave its singleton symlinks behind after an abrupt container-safe
    // process shutdown. Only remove the known symlinks when the lock names this host
    // and a PID that no longer exists; any ambiguous/live ownership remains fail-closed.
    const removable: string[] = [];
    for (const name of ["SingletonCookie", "SingletonSocket"] as const) {
      const value = path.join(this.options.profileDir, name);
      try {
        const stat = await fsp.lstat(value);
        if (!stat.isSymbolicLink()) return;
        removable.push(value);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
    }

    const currentTarget = await fsp.readlink(lockPath).catch(() => undefined);
    if (currentTarget !== target) return;
    const lockStat = await fsp.lstat(lockPath).catch(() => undefined);
    if (!lockStat?.isSymbolicLink()) return;
    for (const value of removable) await fsp.unlink(value);
    const finalTarget = await fsp.readlink(lockPath).catch(() => undefined);
    if (finalTarget === target) await fsp.unlink(lockPath);
  }

  private async profileLockNames(): Promise<string[]> {
    const present: string[] = [];
    for (const name of PROFILE_LOCK_NAMES) {
      const value = path.join(this.options.profileDir, name);
      try {
        await fsp.lstat(value);
        present.push(name);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
    }
    return present;
  }
}

async function runBoundedWindowCommand(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...args], { env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Credential-safe exact-window lookup timed out"));
    }, 1_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes <= 8 * 1024) chunks.push(chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || bytes > 8 * 1024) {
        reject(new Error("Credential-safe exact-window lookup failed"));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
