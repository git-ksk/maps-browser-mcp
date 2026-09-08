import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { waitForLinuxProfileProcessQuiescence } from "./profile-process-quiescence.js";
import {
  readBrowserRuntimeFingerprint,
  readLinuxChromeProcessSummary,
  readLinuxGraphicsSummary,
  readProfileMetadataSummary
} from "./profile-lifecycle-diagnostics.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ActiveDevToolsEndpoint {
  port: number;
  browserPath: string;
}

export interface ChromeProcessOptions {
  executable?: string;
  profileDir: string;
  externalCdpPort?: number;
  headless: boolean;
  allowUnsandboxedChromium?: boolean;
}

const SENSITIVE_BROWSER_ENV_SEGMENT = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSKEY|COOKIE|CREDENTIALS?|BEARER|AUTHORIZATION|KEY)(?:_|$)/i;

export function buildBrowserProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || SENSITIVE_BROWSER_ENV_SEGMENT.test(name)) continue;
    sanitized[name] = value;
  }
  return sanitized;
}

export function parseDevToolsActivePort(value: string): ActiveDevToolsEndpoint | undefined {
  const [portLine, browserPathLine] = value.split(/\r?\n/);
  const port = Number.parseInt(portLine ?? "", 10);
  const browserPath = browserPathLine?.trim() ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (!/^\/devtools\/browser\/[A-Za-z0-9._:-]+$/.test(browserPath)) return undefined;
  return { port, browserPath };
}

export function buildChromeArgs(
  options: ChromeProcessOptions,
  launch: { restoreLastSession?: boolean } = {}
): string[] {
  const args = [
    `--user-data-dir=${options.profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--new-window",
    "about:blank"
  ];
  if (launch.restoreLastSession) args.splice(3, 0, "--restore-last-session");
  if (options.headless) args.unshift("--headless=new");
  if (process.platform === "linux" && options.allowUnsandboxedChromium) {
    args.unshift("--no-sandbox");
  }
  return args;
}

async function canReachCdp(port: number, expectedBrowserPath?: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1_500)
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { Browser?: unknown; webSocketDebuggerUrl?: unknown };
    const browser = typeof payload.Browser === "string" ? payload.Browser : "";
    const websocket = typeof payload.webSocketDebuggerUrl === "string" ? payload.webSocketDebuggerUrl : "";
    if (!/(Chrome|Chromium)/i.test(browser) || !websocket.startsWith("ws://")) return false;
    if (!expectedBrowserPath) return true;
    try {
      return new URL(websocket).pathname === expectedBrowserPath;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export function findChromeExecutable(explicit?: string): string {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error("Configured Chrome executable was not found");
    return explicit;
  }

  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  } else if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(
        path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(base, "Chromium", "Application", "chrome.exe")
      );
    }
  }

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "Chrome/Chromium was not found. Set MAPS_CHROME_EXECUTABLE to the browser executable path."
    );
  }
  return found;
}

export class ChromeProcess {
  private child?: ChildProcess;
  private port?: number;
  private browserPath?: string;
  private warnedUnsandboxed = false;
  private restoreLastSessionOnNextStart = false;
  private lastStartRestoreRequested = false;
  private lastStartSpawned = false;

  constructor(private readonly options: ChromeProcessOptions) {}

  requestNextStartSessionRestore(): void {
    if (this.options.externalCdpPort !== undefined) {
      throw new Error("Cannot control session restore for an external CDP browser");
    }
    this.restoreLastSessionOnNextStart = true;
  }

  async diagnosticsSnapshot() {
    const executable = findChromeExecutable(this.options.executable);
    return {
      sessionRestorePending: this.restoreLastSessionOnNextStart,
      sessionRestoreRequested: this.lastStartRestoreRequested,
      freshProcessSpawned: this.lastStartSpawned,
      runtime: await readBrowserRuntimeFingerprint(executable, {
        headless: this.options.headless,
        remoteDebugging: true,
        backgroundModeDisabled: false,
        noSandbox: process.platform === "linux" && Boolean(this.options.allowUnsandboxedChromium)
      }),
      graphics: await readLinuxGraphicsSummary(process.env.DISPLAY),
      process: await readLinuxChromeProcessSummary(this.child?.pid, this.options.profileDir, this.child),
      profile: await readProfileMetadataSummary(this.options.profileDir)
    };
  }

  async start(): Promise<number> {
    const restoreLastSession = this.restoreLastSessionOnNextStart;
    this.restoreLastSessionOnNextStart = false;
    this.lastStartRestoreRequested = restoreLastSession;
    this.lastStartSpawned = false;

    if (this.options.externalCdpPort !== undefined) {
      if (!(await canReachCdp(this.options.externalCdpPort))) {
        throw new Error(`No local Chrome DevTools endpoint on port ${this.options.externalCdpPort}`);
      }
      return this.options.externalCdpPort;
    }

    if (
      this.port !== undefined &&
      this.browserPath !== undefined &&
      (await canReachCdp(this.port, this.browserPath))
    ) {
      if (restoreLastSession) {
        throw new Error("Scoped session restore requires a fresh Chrome process");
      }
      return this.port;
    }
    this.port = undefined;
    this.browserPath = undefined;

    await fsp.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await fsp.chmod(this.options.profileDir, 0o700).catch(() => undefined);
    }
    const activePortFile = path.join(this.options.profileDir, "DevToolsActivePort");

    // Only a missing endpoint file is benign. Ownership rejection and filesystem
    // failures must escape instead of falling through to spawning another Chrome.
    const activePortValue = await fsp.readFile(activePortFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const existing = parseDevToolsActivePort(activePortValue);
    if (existing && (await canReachCdp(existing.port, existing.browserPath))) {
      if (restoreLastSession) {
        throw new Error("Scoped session restore requires a stopped dedicated profile");
      }
      this.port = existing.port;
      this.browserPath = existing.browserPath;
      return existing.port;
    }
    await fsp.rm(activePortFile, { force: true });

    const executable = findChromeExecutable(this.options.executable);
    const args = buildChromeArgs(this.options, { restoreLastSession });
    if (process.platform === "linux" && this.options.allowUnsandboxedChromium && !this.warnedUnsandboxed) {
      this.warnedUnsandboxed = true;
      console.error(
        "[maps-browser-mcp] WARNING: Chromium is running with --no-sandbox because MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true. Use this only in a dedicated, isolated single-user runtime."
      );
    }

    this.lastStartSpawned = true;
    this.child = spawn(executable, args, { stdio: "ignore", env: buildBrowserProcessEnv() });
    let startupError: Error | undefined;
    this.child.once("error", (error) => {
      startupError = error;
    });

    const deadline = Date.now() + 30_000;
    let observedEndpoint: ActiveDevToolsEndpoint | undefined;
    while (Date.now() < deadline) {
      if (startupError) {
        await this.close();
        throw new Error("Chrome/Chromium could not be started");
      }
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        await this.close();
        throw new Error("Chrome/Chromium exited before its DevTools endpoint became ready");
      }

      const endpoint = parseDevToolsActivePort(
        await fsp.readFile(activePortFile, "utf8").catch(() => "")
      );
      if (endpoint) {
        observedEndpoint = endpoint;
        if (await canReachCdp(endpoint.port, endpoint.browserPath)) {
          this.port = endpoint.port;
          this.browserPath = endpoint.browserPath;
          return endpoint.port;
        }
      }
      await sleep(100);
    }

    const diagnostic = observedEndpoint
      ? `DevToolsActivePort appeared on port ${observedEndpoint.port}, but /json/version never became ready`
      : "DevToolsActivePort was never created";
    await this.close();
    throw new Error(`Chrome started but its DevTools endpoint did not become ready: ${diagnostic}`);
  }

  async close(): Promise<void> {
    const child = this.child;
    this.port = undefined;
    this.browserPath = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.child = undefined;
      return;
    }

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(1_500)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([exited, sleep(1_000)]);
    }
    if (child.exitCode === null && child.signalCode === null) {
      throw new Error("Chrome/Chromium did not exit after SIGTERM/SIGKILL shutdown");
    }
    this.child = undefined;
  }

  async closeForProfileCheckpoint(): Promise<void> {
    if (this.options.externalCdpPort !== undefined) {
      throw new Error("Cannot checkpoint a profile owned by an external CDP browser");
    }
    await this.close();
    await waitForLinuxProfileProcessQuiescence(this.options.profileDir, { timeoutMs: 5_000 });
  }
}
