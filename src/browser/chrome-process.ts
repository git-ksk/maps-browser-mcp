import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ActiveDevToolsEndpoint {
  port: number;
  browserPath: string;
}

export function parseDevToolsActivePort(value: string): ActiveDevToolsEndpoint | undefined {
  const [portLine, browserPathLine] = value.split(/\r?\n/);
  const port = Number.parseInt(portLine ?? "", 10);
  const browserPath = browserPathLine?.trim() ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (!/^\/devtools\/browser\/[A-Za-z0-9._:-]+$/.test(browserPath)) return undefined;
  return { port, browserPath };
}

async function canReachCdp(port: number, expectedBrowserPath?: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(800)
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

  constructor(
    private readonly options: {
      executable?: string;
      profileDir: string;
      externalCdpPort?: number;
      headless: boolean;
    }
  ) {}

  async start(): Promise<number> {
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
      return this.port;
    }
    this.port = undefined;
    this.browserPath = undefined;

    await fsp.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await fsp.chmod(this.options.profileDir, 0o700).catch(() => undefined);
    }
    const activePortFile = path.join(this.options.profileDir, "DevToolsActivePort");

    try {
      const existing = parseDevToolsActivePort(await fsp.readFile(activePortFile, "utf8"));
      if (existing && (await canReachCdp(existing.port, existing.browserPath))) {
        this.port = existing.port;
        this.browserPath = existing.browserPath;
        return existing.port;
      }
      await fsp.rm(activePortFile, { force: true });
    } catch {
      // No reusable browser session.
    }

    const executable = findChromeExecutable(this.options.executable);
    const args = [
      `--user-data-dir=${this.options.profileDir}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--new-window",
      "about:blank"
    ];
    if (this.options.headless) args.unshift("--headless=new");

    this.child = spawn(executable, args, { stdio: "ignore" });
    let startupError: Error | undefined;
    this.child.once("error", (error) => {
      startupError = error;
    });

    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (startupError) {
        await this.close();
        throw new Error("Chrome/Chromium could not be started");
      }
      if (this.child.exitCode !== null) {
        await this.close();
        throw new Error("Chrome/Chromium exited before its DevTools endpoint became ready");
      }

      const endpoint = parseDevToolsActivePort(
        await fsp.readFile(activePortFile, "utf8").catch(() => "")
      );
      if (endpoint && (await canReachCdp(endpoint.port, endpoint.browserPath))) {
        this.port = endpoint.port;
        this.browserPath = endpoint.browserPath;
        return endpoint.port;
      }
      await sleep(120);
    }

    await this.close();
    throw new Error("Chrome started but its DevTools endpoint did not become ready");
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.port = undefined;
    this.browserPath = undefined;
    if (!child || child.exitCode !== null) return;

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(1_500)]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([exited, sleep(1_000)]);
    }
  }
}
