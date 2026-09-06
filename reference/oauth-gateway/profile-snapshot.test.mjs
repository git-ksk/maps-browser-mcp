import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tar from "tar";
import {
  checkpointProfileToCloud,
  createProfileArchive,
  isExcludedProfilePath,
  loadProfileSnapshotConfig,
  prepareProfileForFreshAgentVerification,
  restoreProfileArchive
} from "./profile-snapshot.mjs";

test("profile snapshot config is disabled without a bucket", () => {
  const config = loadProfileSnapshotConfig({ MAPS_CHROME_PROFILE_DIR: "/tmp/profile" });
  assert.equal(config.enabled, false);
  assert.equal(config.required, false);
  assert.equal(config.keepSnapshots, 2);
});

test("profile snapshot default path matches the Maps runtime default", () => {
  const config = loadProfileSnapshotConfig({});
  assert.equal(config.profileDir, path.join(os.homedir(), ".maps-browser-mcp", "chrome-profile"));
});

test("profile snapshot config validates integer and prefix bounds", () => {
  assert.throws(() => loadProfileSnapshotConfig({ MAPS_PROFILE_SNAPSHOT_PREFIX: "../bad" }), /dot segments/);
  assert.throws(() => loadProfileSnapshotConfig({ MAPS_PROFILE_SNAPSHOT_KEEP: "1" }), /between 2 and 10/);
});

test("cache, crash, CDP and Singleton runtime files are excluded", () => {
  assert.equal(isExcludedProfilePath("Default/Cache/data"), true);
  assert.equal(isExcludedProfilePath("Default/Code Cache/js/index"), true);
  assert.equal(isExcludedProfilePath("Crashpad/reports/x"), true);
  assert.equal(isExcludedProfilePath("SingletonLock"), true);
  assert.equal(isExcludedProfilePath("DevToolsActivePort"), true);
  assert.equal(isExcludedProfilePath("Default/Cookies"), false);
  assert.equal(isExcludedProfilePath("Default/Local Storage/leveldb/000003.log"), false);
});

test("archive round trip preserves durable profile data and drops caches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-test-"));
  try {
    const source = path.join(root, "source");
    const restored = path.join(root, "restored");
    const archive = path.join(root, "profile.tar.gz");
    await mkdir(path.join(source, "Default", "Local Storage"), { recursive: true });
    await mkdir(path.join(source, "Default", "Cache"), { recursive: true });
    await writeFile(path.join(source, "Default", "Cookies"), "cookie-db");
    await writeFile(path.join(source, "Default", "Local Storage", "state"), "signed-in-state");
    await writeFile(path.join(source, "Default", "Cache", "discard"), "cache");
    await writeFile(path.join(source, "SingletonLock"), "runtime-only");

    const result = await createProfileArchive(source, archive);
    assert.ok(result.bytes > 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);

    await restoreProfileArchive(archive, restored);
    assert.equal(await readFile(path.join(restored, "Default", "Cookies"), "utf8"), "cookie-db");
    assert.equal(await readFile(path.join(restored, "Default", "Local Storage", "state"), "utf8"), "signed-in-state");
    await assert.rejects(readFile(path.join(restored, "Default", "Cache", "discard")), /ENOENT/);
    await assert.rejects(readFile(path.join(restored, "SingletonLock")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore rejects parent traversal and symlink entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-unsafe-test-"));
  try {
    const payload = path.join(root, "payload");
    await mkdir(payload, { recursive: true });
    await writeFile(path.join(payload, "safe"), "safe");
    await writeFile(path.join(root, "outside"), "outside");
    await symlinkCompat(path.join(root, "outside"), path.join(payload, "link"));
    const archive = path.join(root, "unsafe.tar.gz");
    await tar.c({ cwd: payload, file: archive, gzip: true }, ["."]);
    await assert.rejects(restoreProfileArchive(archive, path.join(root, "restore")), /unsupported entry type/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});




test("pre-verification profile preparation round-trips the stopped profile locally without cloud publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-prepare-test-"));
  try {
    const profileDir = path.join(root, "profile");
    await mkdir(path.join(profileDir, "Default", "Local Storage"), { recursive: true });
    await mkdir(path.join(profileDir, "Default", "Cache"), { recursive: true });
    await writeFile(path.join(profileDir, "Default", "Cookies"), "opaque-cookie-db");
    await writeFile(path.join(profileDir, "Default", "Local Storage", "state"), "opaque-auth-state");
    await writeFile(path.join(profileDir, "Default", "Cache", "discard"), "cache");
    await writeFile(path.join(profileDir, "SingletonLock"), "runtime-only");

    const config = {
      enabled: true,
      bucket: "unused-for-local-stage",
      prefix: "maps-browser-mcp/profile",
      profileDir,
      required: false,
      maxBytes: 16 * 1024 * 1024,
      keepSnapshots: 2
    };
    const messages = [];
    const result = await prepareProfileForFreshAgentVerification(config, {
      logger: { error(message) { messages.push(message); } }
    });

    assert.equal(result.status, "prepared");
    assert.ok(result.bytes > 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(path.join(profileDir, "Default", "Cookies"), "utf8"), "opaque-cookie-db");
    assert.equal(await readFile(path.join(profileDir, "Default", "Local Storage", "state"), "utf8"), "opaque-auth-state");
    await assert.rejects(readFile(path.join(profileDir, "Default", "Cache", "discard")), /ENOENT/);
    await assert.rejects(readFile(path.join(profileDir, "SingletonLock")), /ENOENT/);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /prepared stopped dedicated Chrome profile/);
    assert.doesNotMatch(messages[0], /opaque-cookie-db|opaque-auth-state/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud checkpoint uploads the archive through Bucket.upload with an explicit object destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-cloud-checkpoint-test-"));
  try {
    const profileDir = path.join(root, "profile");
    await mkdir(path.join(profileDir, "Default"), { recursive: true });
    await writeFile(path.join(profileDir, "Default", "Cookies"), "cookie-db");

    let uploaded;
    let pointerSaved;
    const missingPointer = Object.assign(new Error("missing pointer"), { code: 404 });
    const bucket = {
      async upload(filePath, options) {
        uploaded = {
          bytes: (await readFile(filePath)).byteLength,
          options
        };
        return [{}];
      },
      file(name) {
        return {
          async getMetadata() {
            throw missingPointer;
          },
          async download() {
            throw missingPointer;
          },
          async save(buffer, options) {
            pointerSaved = { name, buffer: Buffer.from(buffer), options };
          },
          async delete() {}
        };
      },
      async getFiles() {
        return [[]];
      }
    };
    const storage = { bucket: (name) => {
      assert.equal(name, "profile-bucket");
      return bucket;
    } };
    const config = {
      enabled: true,
      bucket: "profile-bucket",
      prefix: "maps-browser-mcp/profile",
      profileDir,
      required: false,
      maxBytes: 16 * 1024 * 1024,
      keepSnapshots: 2
    };
    const logger = { error() {} };

    const result = await checkpointProfileToCloud(config, { storage, logger });
    assert.equal(result.status, "checkpointed");
    assert.ok(uploaded?.bytes > 0);
    assert.equal(uploaded.options.destination, result.object);
    assert.equal(uploaded.options.resumable, false);
    assert.equal(uploaded.options.validation, "crc32c");
    assert.deepEqual(uploaded.options.preconditionOpts, { ifGenerationMatch: 0 });
    assert.equal(pointerSaved?.name, "maps-browser-mcp/profile/current.json");
    const pointer = JSON.parse(pointerSaved.buffer.toString("utf8"));
    assert.equal(pointer.current.object, result.object);
    assert.equal(pointer.current.sha256, result.sha256);
    assert.equal(pointer.current.bytes, result.bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function symlinkCompat(target, linkPath) {
  const { symlink } = await import("node:fs/promises");
  await symlink(target, linkPath);
}

test("cloud checkpoint upload failure leaves the durable current pointer untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-upload-failure-test-"));
  try {
    const profileDir = path.join(root, "profile");
    await mkdir(path.join(profileDir, "Default"), { recursive: true });
    await writeFile(path.join(profileDir, "Default", "Cookies"), "opaque-db");

    const priorPointer = Buffer.from(`${JSON.stringify({
      version: 1,
      current: { object: "maps-browser-mcp/profile/snapshots/known-good.tar.gz", sha256: "a".repeat(64), bytes: 123, createdAt: "2026-09-05T00:00:00.000Z" }
    })}\n`);
    let pointerBytes = Buffer.from(priorPointer);
    let pointerSaveCalls = 0;
    const uploadFailure = new Error("upload failed");
    const bucket = {
      async upload() { throw uploadFailure; },
      file(name) {
        return {
          async getMetadata() { return [{ generation: "7", size: String(pointerBytes.byteLength) }]; },
          async download() { return [Buffer.from(pointerBytes)]; },
          async save(buffer) { pointerSaveCalls += 1; pointerBytes = Buffer.from(buffer); },
          async delete() {}
        };
      },
      async getFiles() { return [[]]; }
    };
    const config = {
      enabled: true,
      bucket: "profile-bucket",
      prefix: "maps-browser-mcp/profile",
      profileDir,
      required: false,
      maxBytes: 16 * 1024 * 1024,
      keepSnapshots: 2
    };

    await assert.rejects(
      checkpointProfileToCloud(config, { storage: { bucket: () => bucket }, logger: { error() {} } }),
      /upload failed/
    );
    assert.equal(pointerSaveCalls, 0);
    assert.deepEqual(pointerBytes, priorPointer);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud checkpoint pointer publication failure preserves the prior current pointer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-pointer-failure-test-"));
  try {
    const profileDir = path.join(root, "profile");
    await mkdir(path.join(profileDir, "Default"), { recursive: true });
    await writeFile(path.join(profileDir, "Default", "Cookies"), "opaque-db");

    const pointerName = "maps-browser-mcp/profile/current.json";
    const priorPointer = Buffer.from(`${JSON.stringify({
      version: 1,
      current: { object: "maps-browser-mcp/profile/snapshots/known-good.tar.gz", sha256: "b".repeat(64), bytes: 456, createdAt: "2026-09-05T00:00:00.000Z" }
    })}\n`);
    let pointerBytes = Buffer.from(priorPointer);
    let pruneCalls = 0;
    const bucket = {
      async upload() { return [{}]; },
      file(name) {
        if (name === pointerName) {
          return {
            async getMetadata() { return [{ generation: "11", size: String(pointerBytes.byteLength) }]; },
            async download() { return [Buffer.from(pointerBytes)]; },
            async save() { throw new Error("pointer publish failed"); },
            async delete() {}
          };
        }
        return { async delete() { pruneCalls += 1; } };
      },
      async getFiles() { return [[{ name: "maps-browser-mcp/profile/snapshots/known-good.tar.gz" }]]; }
    };
    const config = {
      enabled: true,
      bucket: "profile-bucket",
      prefix: "maps-browser-mcp/profile",
      profileDir,
      required: false,
      maxBytes: 16 * 1024 * 1024,
      keepSnapshots: 2
    };

    await assert.rejects(
      checkpointProfileToCloud(config, { storage: { bucket: () => bucket }, logger: { error() {} } }),
      /pointer publish failed/
    );
    assert.deepEqual(pointerBytes, priorPointer);
    assert.equal(pruneCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
