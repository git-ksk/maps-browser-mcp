import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReachCdp(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(800)
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { Browser?: unknown; webSocketDebuggerUrl?: unknown };
    const browser = typeof payload.Browser === "string" ? payload.Browser : "";
    const websocket = typeof payload.webSocketDebuggerUrl === "string" ? payload.webSocketDebuggerUrl : "";
    return /(Chrome|Chromium)/i.test(browser) && websocket.startsWith("ws://");
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
        throw new Error(`No Chrome DevTools endpoint on port ${this.options.externalCdpPort}`);
      }
      return this.options.externalCdpPort;
    }

    if (this.port !== undefined && (await canReachCdp(this.port))) return this.port;
    this.port = undefined;

    await fsp.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    const activePortFile = path.join(this.options.profileDir, "DevToolsActivePort");

    try {
      const existing = await fsp.readFile(activePortFile, "utf8");
      const existingPort = Number.parseInt(existing.split(/\r?\n/, 1)[0] ?? "", 10);
      if (Number.isInteger(existingPort) && (await canReachCdp(existingPort))) {
        this.port = existingPort;
        return existingPort;
      }
      await fsp.rm(activePortFile, { force: true });
    } catch {
      // No reusable browser session.
    }

    const executable = findChromeExecutable(this.options.executable);
    const args = [
      `--user-data-dir=${this.options.profileDir}`,
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

      const result = await fsp.readFile(activePortFile, "utf8").catch(() => "");
      if (result) {
        const detectedPort = Number.parseInt(result.split(/\r?\n/, 1)[0] ?? "", 10);
        if (Number.isInteger(detectedPort) && (await canReachCdp(detectedPort))) {
          this.port = detectedPort;
          return detectedPort;
        }
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
