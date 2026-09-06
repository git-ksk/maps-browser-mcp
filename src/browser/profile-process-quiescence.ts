import fsp from "node:fs/promises";
import path from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROFILE_PROCESS_POLL_MS = 100;
const CHROMIUM_EXECUTABLE_BASENAMES = new Set([
  "chromium",
  "chrome",
  "google-chrome",
  "google-chrome-stable"
]);

export function commandUsesChromeProfile(argv: readonly string[], profileDir: string): boolean {
  const expected = `--user-data-dir=${profileDir}`;
  return argv.some((arg) => arg === expected);
}

async function linuxProfileBoundChromiumPids(profileDir: string): Promise<number[]> {
  if (process.platform !== "linux") return [];
  const entries = await fsp.readdir("/proc").catch(() => [] as string[]);
  const pids: number[] = [];
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const procDir = path.join("/proc", entry);
    const cmdline = await fsp.readFile(path.join(procDir, "cmdline")).catch(() => Buffer.alloc(0));
    const argv = cmdline.toString("utf8").split("\0").filter(Boolean);
    const executableBasename = path.basename(argv[0] ?? "");
    if (!CHROMIUM_EXECUTABLE_BASENAMES.has(executableBasename)) continue;
    if (!commandUsesChromeProfile(argv, profileDir)) continue;
    const pid = Number(entry);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

export async function waitForLinuxProfileProcessQuiescence(
  profileDir: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    readPids?: (profileDir: string) => Promise<readonly number[]>;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {}
): Promise<void> {
  if (process.platform !== "linux" && !options.readPids) return;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollMs = options.pollMs ?? PROFILE_PROCESS_POLL_MS;
  const readPids = options.readPids ?? linuxProfileBoundChromiumPids;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const deadline = now() + timeoutMs;
  for (;;) {
    if ((await readPids(profileDir)).length === 0) return;
    if (now() >= deadline) {
      throw new Error("Dedicated Chrome profile still has Chromium processes after browser shutdown");
    }
    await wait(pollMs);
  }
}
