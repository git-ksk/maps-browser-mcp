import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";
import * as tar from "tar";

const POINTER_VERSION = 1;
const DEFAULT_PREFIX = "maps-browser-mcp/profile";
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_KEEP_SNAPSHOTS = 2;
const DEFAULT_KEEP_CANDIDATES = 3;
const execFileAsync = promisify(execFile);
const PROFILE_STORE_DIAGNOSTIC_EVENTS = new Set([
  "candidate_stage_pointer_observed",
  "candidate_promote_pointer_observed",
  "profile_restore_succeeded",
  "profile_restore_failed",
  "profile_store_step"
]);

function profileStoreDiagnostic(logger, event, fields = {}) {
  if (!PROFILE_STORE_DIAGNOSTIC_EVENTS.has(event)) throw new Error("unsupported profile store diagnostic event");
  const allowed = new Set([
    "pointerGenerationBefore", "pointerGenerationAfter", "pointerUnchanged", "pointerAdvanced",
    "currentMatchesCandidate", "source", "pointerGeneration", "bytes", "digestVerified", "state", "stage", "operation", "errorKind"
  ]);
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) throw new Error(`unsupported profile store diagnostic field: ${key}`);
    if (typeof value === "boolean") continue;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) continue;
    if (typeof value === "string" && /^(?:\d+|current|previous|fallback|unavailable|failed|started|completed|stage_candidate|promote_candidate|restore|archive|structure|sqlite|pointer_read|upload|metadata|pointer_write|download|extract|cleanup|permission|not_found|precondition|timeout|invalid_or_other|integrity|size|structure|sqlite_invalid)$/.test(value)) continue;
    throw new Error(`invalid profile store diagnostic value: ${key}`);
  }
  logger.error(`[maps-profile] ${JSON.stringify({ type: "profile_store_diagnostics", event, ...fields })}`);
}


export function profileStoreErrorKind(error) {
  const code = error?.code;
  if (code === 401 || code === 403 || code === "EACCES" || code === "EPERM") return "permission";
  if (code === 404 || code === "ENOENT") return "not_found";
  if (code === 412) return "precondition";
  if (code === "ETIMEDOUT" || code === "ABORT_ERR") return "timeout";
  const message = error?.message;
  if (message === "profile snapshot digest mismatch" || message === "profile candidate integrity metadata changed before promotion" || message === "staged profile candidate metadata does not match the uploaded archive") return "integrity";
  if (message === "durable profile pointer changed after candidate staging" || message === "profile candidate generation changed before promotion") return "precondition";
  if (message === "profile SQLite integrity check failed") return "sqlite_invalid";
  if (typeof message === "string" && /^(profile snapshot archive exceeds |profile snapshot object has an invalid or excessive size|profile candidate size)/.test(message)) return "size";
  if (typeof message === "string" && /^(profile snapshot contains |profile snapshot is missing required)/.test(message)) return "structure";
  return "invalid_or_other";
}


const EXCLUDED_SEGMENTS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "GraphiteDawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
  "BrowserMetrics"
]);
const EXCLUDED_BASENAMES = new Set(["DevToolsActivePort"]);
const PROFILE_PREFERENCES = /^(?:Default|Profile [^/]+)\/Preferences$/;
const SQLITE_RELATIVE_PATHS = ["Cookies", path.join("Network", "Cookies")];

function envBool(name, fallback = false, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${name} must be a boolean`);
}

function envInt(name, fallback, min, max, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function cleanPrefix(value) {
  const normalized = (value || DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => part === "." || part === ".." || part === "")) {
    throw new Error("MAPS_PROFILE_SNAPSHOT_PREFIX must be a non-empty object prefix without dot segments");
  }
  return normalized;
}

export function loadProfileSnapshotConfig(env = process.env) {
  const bucket = env.MAPS_PROFILE_SNAPSHOT_BUCKET?.trim() || undefined;
  const profileDir = path.resolve(
    env.MAPS_CHROME_PROFILE_DIR?.trim() || path.join(os.homedir(), ".maps-browser-mcp", "chrome-profile")
  );
  return {
    enabled: Boolean(bucket),
    bucket,
    prefix: cleanPrefix(env.MAPS_PROFILE_SNAPSHOT_PREFIX),
    profileDir,
    required: envBool("MAPS_PROFILE_SNAPSHOT_REQUIRED", false, env),
    maxBytes: envInt("MAPS_PROFILE_SNAPSHOT_MAX_BYTES", DEFAULT_MAX_BYTES, 1 * 1024 * 1024, 2 * 1024 * 1024 * 1024, env),
    keepSnapshots: envInt("MAPS_PROFILE_SNAPSHOT_KEEP", DEFAULT_KEEP_SNAPSHOTS, 2, 10, env),
    keepCandidates: envInt("MAPS_PROFILE_CANDIDATE_KEEP", DEFAULT_KEEP_CANDIDATES, 3, 10, env)
  };
}

function normalizedArchivePath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized;
}

export function isExcludedProfilePath(value) {
  const normalized = normalizedArchivePath(value);
  if (!normalized) return false;
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  if (basename.startsWith("Singleton")) return true;
  if (EXCLUDED_BASENAMES.has(basename)) return true;
  return parts.some((part) => EXCLUDED_SEGMENTS.has(part));
}

function assertSafeArchiveEntry(entry) {
  const raw = entry.path;
  if (raw.includes("\0")) throw new Error("profile snapshot contains a NUL path");
  const normalized = normalizedArchivePath(raw);
  if (!normalized || normalized === ".") return;
  if (path.posix.isAbsolute(normalized)) throw new Error("profile snapshot contains an absolute path");
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..")) throw new Error("profile snapshot contains a parent traversal");
  if (!new Set(["File", "OldFile", "Directory"]).has(entry.type)) {
    throw new Error(`profile snapshot contains unsupported entry type: ${entry.type}`);
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function createProfileArchive(profileDir, archivePath, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const info = await stat(profileDir).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error("Chrome profile directory does not exist");

  await tar.c({
    cwd: profileDir,
    file: archivePath,
    gzip: true,
    portable: true,
    noMtime: true,
    filter: (entryPath, entryStat) => {
      if (!(entryStat.isDirectory() || entryStat.isFile())) return false;
      return !isExcludedProfilePath(entryPath);
    }
  }, ["."]);

  const archiveStat = await stat(archivePath);
  if (archiveStat.size > maxBytes) {
    await rm(archivePath, { force: true });
    throw new Error(`profile snapshot archive exceeds ${maxBytes} bytes`);
  }
  return {
    bytes: archiveStat.size,
    sha256: await sha256File(archivePath)
  };
}

export async function inspectProfileArchiveMetadata(archivePath) {
  let validationError;
  let archiveEntries = 0;
  let localStatePresent = false;
  let profilePreferencesPresent = false;
  await tar.t({
    file: archivePath,
    onentry: (entry) => {
      if (validationError) return;
      try {
        assertSafeArchiveEntry(entry);
        const normalized = normalizedArchivePath(entry.path);
        if (!normalized || normalized === ".") return;
        if (isExcludedProfilePath(normalized)) {
          throw new Error("profile snapshot contains excluded runtime data");
        }
        archiveEntries += 1;
        if ((entry.type === "File" || entry.type === "OldFile") && normalized === "Local State") {
          localStatePresent = true;
        }
        if ((entry.type === "File" || entry.type === "OldFile") && PROFILE_PREFERENCES.test(normalized)) {
          profilePreferencesPresent = true;
        }
      } catch (error) {
        validationError = error;
      }
    }
  });
  if (validationError) throw validationError;
  if (!localStatePresent || !profilePreferencesPresent) {
    throw new Error("profile snapshot is missing required Chrome profile metadata files");
  }
  return { archiveEntries, requiredProfileFiles: 2 };
}

export async function restoreProfileArchive(archivePath, profileDir, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const archiveStat = await stat(archivePath);
  if (archiveStat.size > maxBytes) throw new Error(`profile snapshot archive exceeds ${maxBytes} bytes`);

  let validationError;
  await tar.t({
    file: archivePath,
    onentry: (entry) => {
      if (validationError) return;
      try {
        assertSafeArchiveEntry(entry);
      } catch (error) {
        validationError = error;
      }
    }
  });
  if (validationError) throw validationError;

  const parentDir = path.dirname(profileDir);
  await mkdir(parentDir, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(parentDir, ".profile-restore-"));
  const extractedDir = path.join(stagingRoot, "profile");
  const backupDir = path.join(parentDir, `.profile-backup-${randomUUID()}`);
  await mkdir(extractedDir, { recursive: true });

  try {
    await tar.x({
      cwd: extractedDir,
      file: archivePath,
      preserveOwner: false,
      strict: true
    });

    const existing = await stat(profileDir).catch(() => undefined);
    if (existing) await rename(profileDir, backupDir);
    try {
      await rename(extractedDir, profileDir);
    } catch (error) {
      if (existing) await rename(backupDir, profileDir).catch(() => undefined);
      throw error;
    }
    if (existing) await rm(backupDir, { recursive: true, force: true });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function pointerObject(config) {
  return `${config.prefix}/current.json`;
}

function snapshotsPrefix(config) {
  return `${config.prefix}/snapshots/`;
}

function candidatesPrefix(config) {
  return `${config.prefix}/candidates/`;
}

function validateSnapshotRecord(value) {
  if (!value || typeof value !== "object") throw new Error("invalid profile snapshot record");
  if (typeof value.object !== "string" || !value.object) throw new Error("invalid profile snapshot object");
  if (!/^[a-f0-9]{64}$/.test(value.sha256 ?? "")) throw new Error("invalid profile snapshot digest");
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) throw new Error("invalid profile snapshot size");
  return {
    object: value.object,
    sha256: value.sha256,
    bytes: value.bytes,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined
  };
}

function parsePointer(buffer) {
  const parsed = JSON.parse(buffer.toString("utf8"));
  if (parsed?.version !== POINTER_VERSION) throw new Error("unsupported profile snapshot pointer version");
  return {
    version: POINTER_VERSION,
    current: validateSnapshotRecord(parsed.current),
    previous: parsed.previous ? validateSnapshotRecord(parsed.previous) : undefined
  };
}

async function readPointer(bucket, config) {
  const file = bucket.file(pointerObject(config));
  try {
    const [metadata] = await file.getMetadata();
    const [buffer] = await file.download();
    return { pointer: parsePointer(buffer), generation: metadata.generation };
  } catch (error) {
    if (error?.code === 404) return undefined;
    throw error;
  }
}

async function listFallbackCandidates(bucket, config) {
  const [files] = await bucket.getFiles({ prefix: snapshotsPrefix(config) });
  return files
    .map((file) => file.name)
    .filter((name) => name.endsWith(".tar.gz"))
    .sort()
    .reverse()
    .slice(0, config.keepSnapshots)
    .map((object) => ({ object }));
}

async function downloadSnapshot(bucket, candidate, config, targetPath) {
  const file = bucket.file(candidate.object);
  const [metadata] = await file.getMetadata();
  const bytes = Number(metadata.size ?? candidate.bytes ?? 0);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > config.maxBytes) {
    throw new Error("profile snapshot object has an invalid or excessive size");
  }
  await file.download({ destination: targetPath });
  const digest = await sha256File(targetPath);
  if (candidate.sha256 && digest !== candidate.sha256) throw new Error("profile snapshot digest mismatch");
  return { bytes, sha256: digest };
}

export async function restoreProfileFromCloud(config, { storage = new Storage(), logger = console } = {}) {
  if (!config.enabled) return { status: "disabled" };
  const bucket = storage.bucket(config.bucket);

  let candidates = [];
  let restorePointerGeneration = "0";
  try {
    const pointerState = await readPointer(bucket, config);
    if (pointerState) {
      restorePointerGeneration = String(pointerState.generation ?? "0");
      candidates = [
        pointerState.pointer.current ? { ...pointerState.pointer.current, diagnosticSource: "current" } : undefined,
        pointerState.pointer.previous ? { ...pointerState.pointer.previous, diagnosticSource: "previous" } : undefined
      ].filter(Boolean);
    }
  } catch (error) {
    logger.error(`[maps-profile] pointer read failed: ${profileStoreErrorKind(error)}`);
  }

  if (candidates.length === 0) {
    candidates = (await listFallbackCandidates(bucket, config).catch((error) => {
      if (error?.code === 404) return [];
      throw error;
    })).map((candidate) => ({ ...candidate, diagnosticSource: "fallback" }));
  }

  if (candidates.length === 0) {
    if (config.required) throw new Error("required profile snapshot is missing");
    logger.error("[maps-profile] no persisted profile snapshot; starting with an empty dedicated profile");
    return { status: "missing" };
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "maps-profile-restore-"));
  try {
    for (const candidate of candidates) {
      const archivePath = path.join(workDir, "profile.tar.gz");
      await rm(archivePath, { force: true });
      let restoreStage = "download";
      try {
        const downloaded = await downloadSnapshot(bucket, candidate, config, archivePath);
        restoreStage = "extract";
        await restoreProfileArchive(archivePath, config.profileDir, { maxBytes: config.maxBytes });
        profileStoreDiagnostic(logger, "profile_restore_succeeded", {
          source: candidate.diagnosticSource ?? "fallback",
          pointerGeneration: restorePointerGeneration,
          bytes: downloaded.bytes,
          digestVerified: Boolean(candidate.sha256)
        });
        logger.error("[maps-profile] restored persisted dedicated Chrome profile");
        return { status: "restored", object: candidate.object };
      } catch (error) {
        profileStoreDiagnostic(logger, "profile_restore_failed", {
          source: candidate.diagnosticSource ?? "fallback",
          pointerGeneration: restorePointerGeneration,
          state: "failed", stage: restoreStage, errorKind: profileStoreErrorKind(error)
        });
        logger.error(`[maps-profile] snapshot restore candidate failed: ${profileStoreErrorKind(error)}`);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  if (config.required) throw new Error("no valid required profile snapshot could be restored");
  logger.error("[maps-profile] no valid persisted profile snapshot; starting with an empty dedicated profile");
  return { status: "invalid" };
}

async function pruneSnapshots(bucket, config, keepObjects) {
  const prefix = snapshotsPrefix(config);
  const [files] = await bucket.getFiles({ prefix });
  const keep = new Set(keepObjects.filter((name) => typeof name === "string" && name.startsWith(prefix)));
  const additionalSlots = Math.max(0, config.keepSnapshots - keep.size);
  const nonPointerSnapshots = files
    .map((file) => file.name)
    .filter((name) => name.endsWith(".tar.gz") && !keep.has(name))
    .sort()
    .reverse();
  for (const name of nonPointerSnapshots.slice(0, additionalSlots)) keep.add(name);
  const stale = files
    .map((file) => file.name)
    .filter((name) => name.endsWith(".tar.gz") && !keep.has(name));
  await Promise.all(stale.map((name) => bucket.file(name).delete({ ignoreNotFound: true })));
}

async function pruneCandidates(bucket, config, keepObjects) {
  const prefix = candidatesPrefix(config);
  const [files] = await bucket.getFiles({ prefix });
  const keep = new Set(keepObjects.filter((name) => typeof name === "string" && name.startsWith(prefix)));
  const ordered = files
    .map((file) => file.name)
    .filter((name) => name.endsWith(".tar.gz"))
    .sort()
    .reverse();
  for (const name of ordered) {
    if (keep.size >= config.keepCandidates) break;
    keep.add(name);
  }
  const stale = ordered.filter((name) => !keep.has(name));
  await Promise.all(stale.map((name) => bucket.file(name).delete({ ignoreNotFound: true })));
}

async function defaultSqliteIntegrityCheck(filePath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("sqlite3", ["-readonly", filePath, "PRAGMA quick_check;"], {
      timeout: 5_000,
      maxBuffer: 64 * 1024
    }));
  } catch {
    throw new Error("profile SQLite integrity check failed");
  }
  if (String(stdout).trim() !== "ok") {
    throw new Error("profile SQLite integrity check failed");
  }
}

export async function validateProfileSqliteIntegrity(profileDir, { check = defaultSqliteIntegrityCheck } = {}) {
  const entries = await readdir(profileDir, { withFileTypes: true });
  const profileDirs = entries
    .filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
    .map((entry) => path.join(profileDir, entry.name));
  const databases = [];
  for (const profilePath of profileDirs) {
    for (const relative of SQLITE_RELATIVE_PATHS) {
      const databasePath = path.join(profilePath, relative);
      const info = await stat(databasePath).catch(() => undefined);
      if (info?.isFile()) databases.push(databasePath);
    }
  }
  for (const databasePath of databases.slice(0, 8)) {
    await check(databasePath);
  }
  return { sqliteDatabasesChecked: Math.min(databases.length, 8) };
}

function validateCandidateRecord(candidate, config) {
  if (!candidate || typeof candidate !== "object") throw new Error("profile candidate metadata is required");
  if (typeof candidate.object !== "string" || !candidate.object.startsWith(candidatesPrefix(config)) || !candidate.object.endsWith(".tar.gz")) {
    throw new Error("profile candidate object is outside the candidate namespace");
  }
  if (typeof candidate.generation !== "string" || !/^\d+$/.test(candidate.generation)) {
    throw new Error("profile candidate object generation is invalid");
  }
  if (!Number.isSafeInteger(candidate.bytes) || candidate.bytes < 0 || candidate.bytes > config.maxBytes) {
    throw new Error("profile candidate size is invalid");
  }
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new Error("profile candidate digest is invalid");
  }
  if (typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt))) {
    throw new Error("profile candidate timestamp is invalid");
  }
  if (typeof candidate.basePointerGeneration !== "string" || !/^\d+$/.test(candidate.basePointerGeneration)) {
    throw new Error("profile candidate base pointer generation is invalid");
  }
  const validation = candidate.validation;
  if (!validation || typeof validation !== "object") throw new Error("profile candidate validation metadata is missing");
  for (const field of ["archiveEntries", "requiredProfileFiles", "sqliteDatabasesChecked"]) {
    if (!Number.isSafeInteger(validation[field]) || validation[field] < 0) {
      throw new Error("profile candidate validation metadata is invalid");
    }
  }
  return candidate;
}

async function uploadedCandidateMetadata(bucket, object, uploadedFile) {
  if (uploadedFile && typeof uploadedFile.getMetadata === "function") {
    const [metadata] = await uploadedFile.getMetadata();
    return metadata;
  }
  const [metadata] = await bucket.file(object).getMetadata();
  return metadata;
}

export async function stageProfileCandidate(config, options = {}) {
  const { storage = new Storage(), logger = console, sqliteIntegrityCheck = defaultSqliteIntegrityCheck } = options;
  if (!config.enabled) return { status: "disabled" };
  const bucket = storage.bucket(config.bucket);
  const workDir = await mkdtemp(path.join(os.tmpdir(), "maps-profile-candidate-"));
  const archivePath = path.join(workDir, "profile.tar.gz");
  let stage = "archive";
  profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "started" });
  try {
    const archive = await createProfileArchive(config.profileDir, archivePath, { maxBytes: config.maxBytes });
    stage = "structure";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "started" });
    const structure = await inspectProfileArchiveMetadata(archivePath);
    stage = "sqlite";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "started" });
    const sqlite = await validateProfileSqliteIntegrity(config.profileDir, { check: sqliteIntegrityCheck });
    stage = "pointer_read";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "started" });
    const pointerState = await readPointer(bucket, config);
    const basePointerGeneration = String(pointerState?.generation ?? "0");
    const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
    const object = `${candidatesPrefix(config)}${stamp}-${randomUUID()}.tar.gz`;
    stage = "upload";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "started" });
    const uploadResult = await bucket.upload(archivePath, {
      destination: object,
      resumable: false,
      validation: "crc32c",
      metadata: { cacheControl: "no-store", contentType: "application/gzip", metadata: { mapsCandidateSha256: archive.sha256, mapsCandidateBytes: String(archive.bytes) } },
      preconditionOpts: { ifGenerationMatch: 0 }
    });
    stage = "metadata";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "started" });
    const metadata = await uploadedCandidateMetadata(bucket, object, uploadResult?.[0]);
    const generation = String(metadata.generation ?? "");
    const uploadedBytes = Number(metadata.size ?? -1);
    const customMetadata = metadata.metadata ?? {};
    if (!/^\d+$/.test(generation) || uploadedBytes !== archive.bytes || customMetadata.mapsCandidateSha256 !== archive.sha256 || customMetadata.mapsCandidateBytes !== String(archive.bytes)) {
      await bucket.file(object).delete({ ignoreNotFound: true }).catch(() => undefined);
      throw new Error("staged profile candidate metadata does not match the uploaded archive");
    }
    const candidate = {
      object, generation, bytes: archive.bytes, sha256: archive.sha256, createdAt: new Date().toISOString(), basePointerGeneration,
      validation: { archiveEntries: structure.archiveEntries, requiredProfileFiles: structure.requiredProfileFiles, sqliteDatabasesChecked: sqlite.sqliteDatabasesChecked }
    };
    const protectedObjects = [candidate.object, pointerState?.pointer.current?.object, pointerState?.pointer.previous?.object].filter(Boolean);
    await pruneCandidates(bucket, config, protectedObjects).catch((error) => {
      logger.error(`[maps-profile] stale candidate pruning failed: ${profileStoreErrorKind(error)}`);
    });
    let pointerGenerationAfter = "unavailable";
    try {
      const after = await readPointer(bucket, config);
      pointerGenerationAfter = String(after?.generation ?? "0");
    } catch {}
    profileStoreDiagnostic(logger, "candidate_stage_pointer_observed", {
      pointerGenerationBefore: basePointerGeneration,
      pointerGenerationAfter,
      pointerUnchanged: pointerGenerationAfter !== "unavailable" && pointerGenerationAfter === basePointerGeneration
    });
    logger.error(`[maps-profile] staged stopped profile candidate (${candidate.bytes} bytes, ${candidate.validation.archiveEntries} entries, ${candidate.validation.sqliteDatabasesChecked} SQLite checks); durable pointer unchanged`);
    return { status: "staged", candidate };
  } catch (error) {
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "stage_candidate", stage, state: "failed", errorKind: profileStoreErrorKind(error) });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function promoteProfileCandidate(config, candidate, { storage = new Storage(), logger = console } = {}) {
  if (!config.enabled) return { status: "disabled" };
  let stage = "metadata";
  profileStoreDiagnostic(logger, "profile_store_step", { operation: "promote_candidate", stage, state: "started" });
  try {
    const checked = validateCandidateRecord(candidate, config);
    const bucket = storage.bucket(config.bucket);
    const [candidateMetadata] = await bucket.file(checked.object).getMetadata();
    if (String(candidateMetadata.generation ?? "") !== checked.generation) throw new Error("profile candidate generation changed before promotion");
    if (Number(candidateMetadata.size ?? -1) !== checked.bytes) throw new Error("profile candidate size changed before promotion");
    const customMetadata = candidateMetadata.metadata ?? {};
    if (customMetadata.mapsCandidateSha256 !== checked.sha256 || customMetadata.mapsCandidateBytes !== String(checked.bytes)) {
      throw new Error("profile candidate integrity metadata changed before promotion");
    }
    stage = "pointer_read";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "promote_candidate", stage, state: "started" });
    const pointerState = await readPointer(bucket, config);
    const pointerGeneration = String(pointerState?.generation ?? "0");
    if (pointerGeneration !== checked.basePointerGeneration) throw new Error("durable profile pointer changed after candidate staging");
    const prior = pointerState?.pointer.current;
    const current = { object: checked.object, sha256: checked.sha256, bytes: checked.bytes, createdAt: checked.createdAt };
    const pointer = { version: POINTER_VERSION, current, ...(prior ? { previous: prior } : {}) };
    const generationMatch = Number(pointerGeneration);
    if (!Number.isSafeInteger(generationMatch) || generationMatch < 0) {
      throw new Error("durable profile pointer generation exceeds safe precondition bounds");
    }
    const pointerBytes = Buffer.from(`${JSON.stringify(pointer)}\n`);
    stage = "pointer_write";
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "promote_candidate", stage, state: "started" });
    await bucket.file(pointerObject(config)).save(pointerBytes, {
      resumable: false,
      validation: "crc32c",
      metadata: { cacheControl: "no-store", contentType: "application/json" },
      preconditionOpts: { ifGenerationMatch: generationMatch }
    });
    let pointerGenerationAfter = "unavailable";
    let currentMatchesCandidate = false;
    try {
      const after = await readPointer(bucket, config);
      pointerGenerationAfter = String(after?.generation ?? "0");
      currentMatchesCandidate = after?.pointer.current.object === checked.object;
    } catch {}
    profileStoreDiagnostic(logger, "candidate_promote_pointer_observed", {
      pointerGenerationBefore: pointerGeneration,
      pointerGenerationAfter,
      pointerAdvanced: pointerGenerationAfter !== "unavailable" && pointerGenerationAfter !== pointerGeneration,
      currentMatchesCandidate
    });
    const protectedObjects = [current.object, prior?.object, pointerState?.pointer.previous?.object].filter(Boolean);
    await pruneCandidates(bucket, config, protectedObjects).catch((error) => {
      logger.error(`[maps-profile] stale candidate pruning failed after promotion: ${profileStoreErrorKind(error)}`);
    });
    await pruneSnapshots(bucket, config, [prior?.object, pointerState?.pointer.previous?.object].filter(Boolean)).catch((error) => {
      logger.error(`[maps-profile] stale snapshot pruning failed: ${profileStoreErrorKind(error)}`);
    });
    logger.error(`[maps-profile] promoted verified stopped profile candidate (${checked.bytes} bytes)`);
    return { status: "promoted", object: checked.object, bytes: checked.bytes, sha256: checked.sha256 };
  } catch (error) {
    profileStoreDiagnostic(logger, "profile_store_step", { operation: "promote_candidate", stage, state: "failed", errorKind: profileStoreErrorKind(error) });
    throw error;
  }
}

async function main() {
  const [command] = process.argv.slice(2);
  const config = loadProfileSnapshotConfig();
  if (command === "restore") {
    await restoreProfileFromCloud(config);
    return;
  }
  throw new Error("usage: profile-snapshot.mjs restore");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`[maps-profile] ${profileStoreErrorKind(error)}`);
    process.exitCode = 1;
  });
}
