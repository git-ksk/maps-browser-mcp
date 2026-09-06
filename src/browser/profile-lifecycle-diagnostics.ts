import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProfileLifecycleDiagnosticEvent =
  | "runtime_boot"
  | "human_browser_starting"
  | "human_browser_started"
  | "human_window_bound"
  | "human_browser_close_started"
  | "human_window_close_requested"
  | "human_window_close_sample"
  | "human_graceful_exit_timeout"
  | "human_sigterm_sent"
  | "human_sigterm_sample"
  | "human_sigkill_sent"
  | "human_sigkill_sample"
  | "human_profile_quiescent"
  | "candidate_stage_started"
  | "candidate_staged"
  | "candidate_stage_failed"
  | "fresh_agent_verification_started"
  | "fresh_agent_browser_preflight"
  | "fresh_agent_cdp_ready"
  | "fresh_agent_browser_ready"
  | "fresh_agent_readiness_transition"
  | "fresh_agent_readiness_final"
  | "agent_checkpoint_stop_started"
  | "agent_checkpoint_stopped"
  | "candidate_promoted"
  | "candidate_promotion_failed";

export interface ProfileMetadataSummary {
  mountFsType: string;
  coreFilesPresent: number;
  coreBytes: number;
  coreLatestMtimeMs: number;
  cookieDbFilesPresent: number;
  cookieDbBytes: number;
  cookieDbLatestMtimeMs: number;
  cookieWalFilesPresent: number;
  cookieWalBytes: number;
  cookieWalLatestMtimeMs: number;
  sqliteSidecarFilesPresent: number;
  sqliteSidecarBytes: number;
  singletonLocksPresent: number;
}

export interface ProfileSqliteIntegritySummary {
  databasesPresent: number;
  databasesChecked: number;
  databasesOk: number;
  databasesFailed: number;
}

export interface LinuxChromeProcessSummary {
  rootState: "running" | "exited_code" | "exited_signal" | "unavailable";
  chromiumProcessesTotal: number;
  profileBoundProcesses: number;
  descendants: number;
  renderers: number;
  gpu: number;
  utility: number;
  zygote: number;
  other: number;
}

export interface LinuxGraphicsSummary {
  x11SocketPresent: boolean;
  xvfbProcesses: number;
  openboxProcesses: number;
}

export interface BrowserRuntimeFingerprint {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  executableBasename: string;
  chromiumVersion: string;
  headless: boolean;
  remoteDebugging: boolean;
  backgroundModeDisabled: boolean;
  noSandbox: boolean;
  homeConfigured: boolean;
  xdgConfigHomeConfigured: boolean;
  xdgCacheHomeConfigured: boolean;
  xdgRuntimeDirConfigured: boolean;
  displayConfigured: boolean;
}

export type ProfileLifecycleDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | ProfileMetadataSummary
  | ProfileSqliteIntegritySummary
  | LinuxChromeProcessSummary
  | LinuxGraphicsSummary
  | BrowserRuntimeFingerprint;

const CORE_FILES = [
  "Local State",
  path.join("Default", "Preferences"),
  path.join("Default", "Secure Preferences"),
  path.join("Default", "Web Data"),
  path.join("Default", "Login Data")
] as const;
const COOKIE_DATABASES = [
  path.join("Default", "Cookies"),
  path.join("Default", "Network", "Cookies")
] as const;
const SINGLETON_LOCKS = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

const ALLOWED_FIELD_NAMES = new Set([
  "checkpointConfigured", "bytes", "generation", "basePointerGeneration", "archiveEntries",
  "requiredProfileFiles", "sqliteDatabasesChecked", "exactWindowBound", "closeAccepted", "elapsedMs",
  "windowState", "process", "profile", "sqlite", "graphics", "runtime", "credentialSafe", "cdpReady",
  "state", "finalState", "samples", "signedInSamples", "signedOutSamples", "unknownSamples", "transitions",
  "checkpointStop", "backgroundModeDisabled",
  "mountFsType", "coreFilesPresent", "coreBytes",
  "coreLatestMtimeMs", "cookieDbFilesPresent", "cookieDbBytes", "cookieDbLatestMtimeMs",
  "cookieWalFilesPresent", "cookieWalBytes", "cookieWalLatestMtimeMs", "sqliteSidecarFilesPresent",
  "sqliteSidecarBytes", "singletonLocksPresent", "databasesPresent", "databasesChecked", "databasesOk",
  "databasesFailed", "rootState", "chromiumProcessesTotal", "profileBoundProcesses", "descendants", "renderers", "gpu", "utility",
  "zygote", "other", "x11SocketPresent", "xvfbProcesses", "openboxProcesses", "platform", "arch",
  "nodeVersion", "executableBasename", "chromiumVersion", "headless", "remoteDebugging", "noSandbox",
  "homeConfigured", "xdgConfigHomeConfigured", "xdgCacheHomeConfigured",
  "xdgRuntimeDirConfigured", "displayConfigured"
]);

function boundedSafeString(value: string): string {
  const bounded = value.slice(0, 160);
  if (/\r|\n|\0/.test(bounded)) throw new Error("profile lifecycle diagnostic string is not single-line");
  return bounded;
}

function assertSafeDiagnosticObject(value: Record<string, unknown>): void {
  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_FIELD_NAMES.has(key)) {
      throw new Error(`profile lifecycle diagnostic field is not allowlisted: ${key}`);
    }
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item) || item < 0) throw new Error(`profile lifecycle diagnostic number is invalid: ${key}`);
      continue;
    }
    if (typeof item === "string") {
      boundedSafeString(item);
      continue;
    }
    if (typeof item === "object" && !Array.isArray(item)) {
      assertSafeDiagnosticObject(item as Record<string, unknown>);
      continue;
    }
    throw new Error(`profile lifecycle diagnostic value is unsupported: ${key}`);
  }
}

async function statSummary(filePath: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  const info = await fsp.stat(filePath).catch(() => undefined);
  if (!info?.isFile()) return undefined;
  return { size: info.size, mtimeMs: Math.max(0, Math.floor(info.mtimeMs)) };
}

function decodeMountPath(value: string): string {
  return value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\134/g, "\\");
}

async function readLinuxMountFsType(profileDir: string): Promise<string> {
  if (process.platform !== "linux") return "non_linux";
  const resolved = path.resolve(profileDir);
  const lines = (await fsp.readFile("/proc/self/mountinfo", "utf8").catch(() => "")).split("\n");
  let best: { mount: string; fsType: string } | undefined;
  for (const line of lines) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const left = line.slice(0, separator).split(" ");
    const right = line.slice(separator + 3).split(" ");
    if (left.length < 5 || right.length < 1) continue;
    const mount = decodeMountPath(left[4] ?? "");
    const fsType = right[0] ?? "unknown";
    if (!(resolved === mount || resolved.startsWith(`${mount.endsWith("/") ? mount : `${mount}/`}`))) continue;
    if (!best || mount.length > best.mount.length) best = { mount, fsType };
  }
  return boundedSafeString(best?.fsType ?? "unknown");
}

export async function readProfileMetadataSummary(profileDir: string): Promise<ProfileMetadataSummary> {
  let coreFilesPresent = 0;
  let coreBytes = 0;
  let coreLatestMtimeMs = 0;
  for (const relative of CORE_FILES) {
    const info = await statSummary(path.join(profileDir, relative));
    if (!info) continue;
    coreFilesPresent += 1;
    coreBytes += info.size;
    coreLatestMtimeMs = Math.max(coreLatestMtimeMs, info.mtimeMs);
  }

  let cookieDbFilesPresent = 0;
  let cookieDbBytes = 0;
  let cookieDbLatestMtimeMs = 0;
  let cookieWalFilesPresent = 0;
  let cookieWalBytes = 0;
  let cookieWalLatestMtimeMs = 0;
  let sqliteSidecarFilesPresent = 0;
  let sqliteSidecarBytes = 0;
  for (const relative of COOKIE_DATABASES) {
    const databasePath = path.join(profileDir, relative);
    const database = await statSummary(databasePath);
    if (database) {
      cookieDbFilesPresent += 1;
      cookieDbBytes += database.size;
      cookieDbLatestMtimeMs = Math.max(cookieDbLatestMtimeMs, database.mtimeMs);
    }
    const wal = await statSummary(`${databasePath}-wal`);
    if (wal) {
      cookieWalFilesPresent += 1;
      cookieWalBytes += wal.size;
      cookieWalLatestMtimeMs = Math.max(cookieWalLatestMtimeMs, wal.mtimeMs);
      sqliteSidecarFilesPresent += 1;
      sqliteSidecarBytes += wal.size;
    }
    const shm = await statSummary(`${databasePath}-shm`);
    if (shm) {
      sqliteSidecarFilesPresent += 1;
      sqliteSidecarBytes += shm.size;
    }
  }

  let singletonLocksPresent = 0;
  for (const name of SINGLETON_LOCKS) {
    if (await fsp.lstat(path.join(profileDir, name)).then(() => true).catch(() => false)) singletonLocksPresent += 1;
  }

  return {
    mountFsType: await readLinuxMountFsType(profileDir),
    coreFilesPresent,
    coreBytes,
    coreLatestMtimeMs,
    cookieDbFilesPresent,
    cookieDbBytes,
    cookieDbLatestMtimeMs,
    cookieWalFilesPresent,
    cookieWalBytes,
    cookieWalLatestMtimeMs,
    sqliteSidecarFilesPresent,
    sqliteSidecarBytes,
    singletonLocksPresent
  };
}

export async function readProfileSqliteIntegritySummary(profileDir: string): Promise<ProfileSqliteIntegritySummary> {
  const databases: string[] = [];
  for (const relative of COOKIE_DATABASES) {
    const databasePath = path.join(profileDir, relative);
    if ((await fsp.stat(databasePath).catch(() => undefined))?.isFile()) databases.push(databasePath);
  }
  let databasesOk = 0;
  let databasesFailed = 0;
  for (const databasePath of databases.slice(0, 4)) {
    try {
      const { stdout } = await execFileAsync("sqlite3", ["-readonly", databasePath, "PRAGMA quick_check;"], {
        timeout: 2_000,
        maxBuffer: 4_096
      });
      if (stdout.trim() === "ok") databasesOk += 1;
      else databasesFailed += 1;
    } catch {
      databasesFailed += 1;
    }
  }
  return {
    databasesPresent: databases.length,
    databasesChecked: Math.min(databases.length, 4),
    databasesOk,
    databasesFailed
  };
}

function parseProcStatParent(value: string): number | undefined {
  const closing = value.lastIndexOf(")");
  if (closing < 0) return undefined;
  const tail = value.slice(closing + 1).trim().split(/\s+/);
  const ppid = Number(tail[1]);
  return Number.isSafeInteger(ppid) && ppid >= 0 ? ppid : undefined;
}

function processType(argv: readonly string[]): "renderer" | "gpu" | "utility" | "zygote" | "other" {
  const type = argv.find((arg) => arg.startsWith("--type="))?.slice("--type=".length);
  if (type === "renderer") return "renderer";
  if (type === "gpu-process") return "gpu";
  if (type === "utility") return "utility";
  if (type === "zygote") return "zygote";
  return "other";
}

export async function readLinuxChromeProcessSummary(
  rootPid: number | undefined,
  profileDir: string,
  childState?: { exitCode: number | null; signalCode: NodeJS.Signals | null }
): Promise<LinuxChromeProcessSummary> {
  if (process.platform !== "linux" || !rootPid || !Number.isSafeInteger(rootPid) || rootPid <= 0) {
    return { rootState: "unavailable", chromiumProcessesTotal: 0, profileBoundProcesses: 0, descendants: 0, renderers: 0, gpu: 0, utility: 0, zygote: 0, other: 0 };
  }
  const rootState: LinuxChromeProcessSummary["rootState"] = childState?.signalCode
    ? "exited_signal"
    : childState?.exitCode !== null && childState?.exitCode !== undefined
      ? "exited_code"
      : "running";
  const entries = await fsp.readdir("/proc").catch(() => [] as string[]);
  const parents = new Map<number, number>();
  const allProcessArgs = new Map<number, string[]>();
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const pid = Number(entry);
    const [statRaw, cmdlineRaw] = await Promise.all([
      fsp.readFile(path.join("/proc", entry, "stat"), "utf8").catch(() => ""),
      fsp.readFile(path.join("/proc", entry, "cmdline")).catch(() => Buffer.alloc(0))
    ]);
    const ppid = parseProcStatParent(statRaw);
    if (ppid !== undefined) parents.set(pid, ppid);
    allProcessArgs.set(pid, cmdlineRaw.toString("utf8").split("\0").filter(Boolean));
  }

  const descendants = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of parents) {
      if (pid === rootPid || descendants.has(pid)) continue;
      if (ppid === rootPid || descendants.has(ppid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }

  const related = new Set([rootPid, ...descendants]);
  let chromiumProcessesTotal = 0;
  let profileBoundProcesses = 0;
  let renderers = 0;
  let gpu = 0;
  let utility = 0;
  let zygote = 0;
  let other = 0;
  const expectedProfileArg = `--user-data-dir=${profileDir}`;
  const chromiumBasenames = new Set(["chromium", "chromium-browser", "chrome", "google-chrome", "google-chrome-stable"]);
  for (const [pid, argv] of allProcessArgs) {
    if (chromiumBasenames.has(path.basename(argv[0] ?? ""))) chromiumProcessesTotal += 1;
    if (argv.includes(expectedProfileArg)) profileBoundProcesses += 1;
    if (!related.has(pid) || pid === rootPid) continue;
    switch (processType(argv)) {
      case "renderer": renderers += 1; break;
      case "gpu": gpu += 1; break;
      case "utility": utility += 1; break;
      case "zygote": zygote += 1; break;
      case "other": other += 1; break;
    }
  }
  return { rootState, chromiumProcessesTotal, profileBoundProcesses, descendants: descendants.size, renderers, gpu, utility, zygote, other };
}

export async function readLinuxGraphicsSummary(displayName: string | undefined): Promise<LinuxGraphicsSummary> {
  if (process.platform !== "linux") return { x11SocketPresent: false, xvfbProcesses: 0, openboxProcesses: 0 };
  const displayMatch = displayName?.match(/^:(\d+)(?:\.\d+)?$/);
  const x11SocketPresent = displayMatch
    ? await fsp.stat(`/tmp/.X11-unix/X${displayMatch[1]}`).then((info) => info.isSocket()).catch(() => false)
    : false;
  let xvfbProcesses = 0;
  let openboxProcesses = 0;
  for (const entry of await fsp.readdir("/proc").catch(() => [] as string[])) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const comm = (await fsp.readFile(`/proc/${entry}/comm`, "utf8").catch(() => "")).trim();
    if (comm === "Xvfb") xvfbProcesses += 1;
    if (comm === "openbox") openboxProcesses += 1;
  }
  return { x11SocketPresent, xvfbProcesses, openboxProcesses };
}

export async function readBrowserRuntimeFingerprint(
  executable: string,
  options: {
    headless: boolean;
    remoteDebugging: boolean;
    backgroundModeDisabled: boolean;
    noSandbox: boolean;
  }
): Promise<BrowserRuntimeFingerprint> {
  let chromiumVersion = "unknown";
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], { timeout: 2_000, maxBuffer: 4_096 });
    chromiumVersion = boundedSafeString((stdout || stderr).trim() || "unknown");
  } catch {
    chromiumVersion = "unavailable";
  }
  return {
    platform: process.platform,
    arch: boundedSafeString(process.arch),
    nodeVersion: boundedSafeString(process.version),
    executableBasename: boundedSafeString(path.basename(executable)),
    chromiumVersion,
    headless: options.headless,
    remoteDebugging: options.remoteDebugging,
    backgroundModeDisabled: options.backgroundModeDisabled,
    noSandbox: options.noSandbox,
    homeConfigured: Boolean(process.env.HOME),
    xdgConfigHomeConfigured: Boolean(process.env.XDG_CONFIG_HOME),
    xdgCacheHomeConfigured: Boolean(process.env.XDG_CACHE_HOME),
    xdgRuntimeDirConfigured: Boolean(process.env.XDG_RUNTIME_DIR),
    displayConfigured: Boolean(process.env.DISPLAY)
  };
}

export function formatProfileLifecycleDiagnostic(
  event: ProfileLifecycleDiagnosticEvent,
  fields: Record<string, ProfileLifecycleDiagnosticValue>
): string {
  assertSafeDiagnosticObject(fields as Record<string, unknown>);
  return JSON.stringify({
    type: "profile_lifecycle_diagnostics",
    event,
    ...fields
  });
}
