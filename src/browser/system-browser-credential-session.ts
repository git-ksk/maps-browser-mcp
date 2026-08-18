import { spawn, type ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { findChromeExecutable } from "./chrome-process.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROFILE_LOCK_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

export interface SystemBrowserCredentialSessionOptions {
  executable?: string;
  profileDir: string;
  startUrl?: string;
  profileUnlockTimeoutMs?: number;
}

export function buildCredentialSafeChromeArgs(options: Pick<SystemBrowserCredentialSessionOptions, "profileDir" | "startUrl">): string[] {
  return [
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--new-window",
    options.startUrl ?? "https://www.google.com/maps"
  ];
}

export class SystemBrowserCredentialSession {
  private child?: ChildProcess;

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
    const child = spawn(executable, buildCredentialSafeChromeArgs(this.options), { stdio: "ignore" });
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
    const locked = await this.profileLockNames();
    if (locked.length > 0) {
      throw new Error("Dedicated Chrome profile is still owned by another browser process");
    }
  }

  private async waitForProfileUnlock(): Promise<void> {
    const deadline = Date.now() + (this.options.profileUnlockTimeoutMs ?? 5_000);
    for (;;) {
      const locked = await this.profileLockNames();
      if (locked.length === 0) return;
      if (Date.now() >= deadline) {
        throw new Error("Dedicated Chrome profile did not become available for a safe browser handoff");
      }
      await sleep(100);
    }
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
