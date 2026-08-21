import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Storage } from "@google-cloud/storage";
import * as tar from "tar";

const POINTER_VERSION = 1;
const DEFAULT_PREFIX = "maps-browser-mcp/profile";
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_KEEP_SNAPSHOTS = 2;

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
  const profileDir = path.resolve(env.MAPS_CHROME_PROFILE_DIR?.trim() || "/tmp/maps-browser-mcp/chrome-profile");
  return {
    enabled: Boolean(bucket),
    bucket,
    prefix: cleanPrefix(env.MAPS_PROFILE_SNAPSHOT_PREFIX),
    profileDir,
    required: envBool("MAPS_PROFILE_SNAPSHOT_REQUIRED", false, env),
    maxBytes: envInt("MAPS_PROFILE_SNAPSHOT_MAX_BYTES", DEFAULT_MAX_BYTES, 1 * 1024 * 1024, 2 * 1024 * 1024 * 1024, env),
    keepSnapshots: envInt("MAPS_PROFILE_SNAPSHOT_KEEP", DEFAULT_KEEP_SNAPSHOTS, 2, 10, env)
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
  try {
    const pointerState = await readPointer(bucket, config);
    if (pointerState) candidates = [pointerState.pointer.current, pointerState.pointer.previous].filter(Boolean);
  } catch (error) {
    logger.error(`[maps-profile] pointer read failed: ${error instanceof Error ? error.message : "unknown_error"}`);
  }

  if (candidates.length === 0) {
    candidates = await listFallbackCandidates(bucket, config).catch((error) => {
      if (error?.code === 404) return [];
      throw error;
    });
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
      try {
        await downloadSnapshot(bucket, candidate, config, archivePath);
        await restoreProfileArchive(archivePath, config.profileDir, { maxBytes: config.maxBytes });
        logger.error("[maps-profile] restored persisted dedicated Chrome profile");
        return { status: "restored", object: candidate.object };
      } catch (error) {
        logger.error(`[maps-profile] snapshot restore candidate failed: ${error instanceof Error ? error.message : "unknown_error"}`);
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
  const [files] = await bucket.getFiles({ prefix: snapshotsPrefix(config) });
  const keep = new Set(keepObjects);
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

export async function checkpointProfileToCloud(config, { storage = new Storage(), logger = console } = {}) {
  if (!config.enabled) return { status: "disabled" };
  const bucket = storage.bucket(config.bucket);
  const workDir = await mkdtemp(path.join(os.tmpdir(), "maps-profile-checkpoint-"));
  const archivePath = path.join(workDir, "profile.tar.gz");
  try {
    const archive = await createProfileArchive(config.profileDir, archivePath, { maxBytes: config.maxBytes });
    const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
    const object = `${snapshotsPrefix(config)}${stamp}-${randomUUID()}.tar.gz`;
    await bucket.file(object).upload(archivePath, {
      resumable: false,
      validation: "crc32c",
      metadata: {
        cacheControl: "no-store",
        contentType: "application/gzip"
      },
      preconditionOpts: { ifGenerationMatch: 0 }
    });

    let prior;
    let pointerGeneration;
    try {
      const pointerState = await readPointer(bucket, config);
      prior = pointerState?.pointer.current;
      pointerGeneration = pointerState?.generation;
    } catch (error) {
      logger.error(`[maps-profile] prior pointer unreadable; retaining snapshots without rollback pointer: ${error instanceof Error ? error.message : "unknown_error"}`);
    }

    const current = {
      object,
      sha256: archive.sha256,
      bytes: archive.bytes,
      createdAt: new Date().toISOString()
    };
    const pointer = {
      version: POINTER_VERSION,
      current,
      ...(prior ? { previous: prior } : {})
    };
    await bucket.file(pointerObject(config)).save(Buffer.from(`${JSON.stringify(pointer)}\n`), {
      resumable: false,
      validation: "crc32c",
      metadata: { cacheControl: "no-store", contentType: "application/json" },
      preconditionOpts: { ifGenerationMatch: pointerGeneration ? Number(pointerGeneration) : 0 }
    });

    await pruneSnapshots(bucket, config, [current.object, prior?.object].filter(Boolean)).catch((error) => {
      logger.error(`[maps-profile] stale snapshot pruning failed: ${error instanceof Error ? error.message : "unknown_error"}`);
    });
    logger.error(`[maps-profile] checkpointed dedicated Chrome profile (${archive.bytes} bytes)`);
    return { status: "checkpointed", object, bytes: archive.bytes, sha256: archive.sha256 };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const [command, safetyFlag] = process.argv.slice(2);
  const config = loadProfileSnapshotConfig();
  if (command === "restore") {
    await restoreProfileFromCloud(config);
    return;
  }
  if (command === "checkpoint") {
    if (safetyFlag !== "--browser-stopped") {
      throw new Error("checkpoint requires --browser-stopped; never archive a live Chrome profile");
    }
    await checkpointProfileToCloud(config);
    return;
  }
  throw new Error("usage: profile-snapshot.mjs restore | checkpoint --browser-stopped");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`[maps-profile] ${error instanceof Error ? error.message : "profile snapshot command failed"}`);
    process.exitCode = 1;
  });
}
