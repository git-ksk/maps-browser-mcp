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

export class SystemBrowserCredentialSession {
  private child?: ChildProcess;
  private warnedUnsandboxed = false;

  constructor(private readonly options: SystemBrowserCredentialSessionOptions) {}

  isActive(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  getPid(): number | undefined {
    return this.isActive() ? this.child?.pid : undefined;
  }

  async start(): Promise<void> {
    if (this.isActive()) return;
    this.child = undefined;
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
    this.child = undefined;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await Promise.race([exited, sleep(2_000)]);
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
