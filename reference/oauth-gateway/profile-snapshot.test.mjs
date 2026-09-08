import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tar from "tar";
import {
  createProfileArchive,
  isExcludedProfilePath,
  loadProfileSnapshotConfig,
  inspectProfileArchiveMetadata,
  promoteProfileCandidate,
  stageProfileCandidate,
  validateProfileSqliteIntegrity,
  restoreProfileArchive,
  restoreProfileFromCloud
} from "./profile-snapshot.mjs";

test("profile snapshot config is disabled without a bucket", () => {
  const config = loadProfileSnapshotConfig({ MAPS_CHROME_PROFILE_DIR: "/tmp/profile" });
  assert.equal(config.enabled, false);
  assert.equal(config.required, false);
  assert.equal(config.keepSnapshots, 2);
  assert.equal(config.keepCandidates, 3);
});

test("profile snapshot default path matches the Maps runtime default", () => {
  const config = loadProfileSnapshotConfig({});
  assert.equal(config.profileDir, path.join(os.homedir(), ".maps-browser-mcp", "chrome-profile"));
});

test("profile snapshot config validates integer and prefix bounds", () => {
  assert.throws(() => loadProfileSnapshotConfig({ MAPS_PROFILE_SNAPSHOT_PREFIX: "../bad" }), /dot segments/);
  assert.throws(() => loadProfileSnapshotConfig({ MAPS_PROFILE_SNAPSHOT_KEEP: "1" }), /between 2 and 10/);
  assert.throws(() => loadProfileSnapshotConfig({ MAPS_PROFILE_CANDIDATE_KEEP: "2" }), /between 3 and 10/);
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





async function makeChromeProfile(root) {
  const profileDir = path.join(root, "profile");
  await mkdir(path.join(profileDir, "Default", "Local Storage"), { recursive: true });
  await mkdir(path.join(profileDir, "Default", "Cache"), { recursive: true });
  await writeFile(path.join(profileDir, "Local State"), "opaque-local-state");
  await writeFile(path.join(profileDir, "Default", "Preferences"), "opaque-preferences");
  await writeFile(path.join(profileDir, "Default", "Cookies"), "opaque-cookie-db");
  await writeFile(path.join(profileDir, "Default", "Local Storage", "state"), "opaque-auth-state");
  await writeFile(path.join(profileDir, "Default", "Cache", "discard"), "cache");
  await writeFile(path.join(profileDir, "SingletonLock"), "runtime-only");
  return profileDir;
}

function profileConfig(profileDir) {
  return {
    enabled: true,
    bucket: "profile-bucket",
    prefix: "maps-browser-mcp/profile",
    profileDir,
    required: false,
    maxBytes: 16 * 1024 * 1024,
    keepSnapshots: 2,
    keepCandidates: 3
  };
}

function missingObjectError() {
  return Object.assign(new Error("missing object"), { code: 404 });
}

test("candidate metadata inspection requires Chrome structure without reading profile values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-metadata-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const archive = path.join(root, "profile.tar.gz");
    await createProfileArchive(profileDir, archive);
    const metadata = await inspectProfileArchiveMetadata(archive);
    assert.ok(metadata.archiveEntries >= 4);
    assert.equal(metadata.requiredProfileFiles, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite integrity validation is bounded to existing profile databases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-sqlite-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const checked = [];
    const result = await validateProfileSqliteIntegrity(profileDir, {
      check: async (databasePath) => { checked.push(path.basename(databasePath)); }
    });
    assert.equal(result.sqliteDatabasesChecked, 1);
    assert.deepEqual(checked, ["Cookies"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createStorageHarness() {
  const pointerName = "maps-browser-mcp/profile/current.json";
  let pointerBytes;
  let pointerGeneration = "0";
  let nextGeneration = 101;
  const objects = new Map();
  const deleted = [];
  let uploads = 0;
  let pointerSaves = 0;

  const bucket = {
    async upload(filePath, options) {
      uploads += 1;
      const data = await readFile(filePath);
      const bytes = data.byteLength;
      const generation = String(nextGeneration++);
      const metadata = {
        generation,
        size: String(bytes),
        metadata: { ...options.metadata.metadata }
      };
      objects.set(options.destination, { metadata, data: Buffer.from(data) });
      return [{ async getMetadata() { return [metadata]; } }];
    },
    file(name) {
      if (name === pointerName) {
        return {
          async getMetadata() {
            if (!pointerBytes) throw missingObjectError();
            return [{ generation: pointerGeneration, size: String(pointerBytes.byteLength) }];
          },
          async download() {
            if (!pointerBytes) throw missingObjectError();
            return [Buffer.from(pointerBytes)];
          },
          async save(buffer, options) {
            pointerSaves += 1;
            const expected = Number(pointerGeneration);
            if (options.preconditionOpts.ifGenerationMatch !== expected) throw new Error("precondition mismatch");
            pointerBytes = Buffer.from(buffer);
            pointerGeneration = String(nextGeneration++);
          },
          async delete() {}
        };
      }
      return {
        async getMetadata() {
          const object = objects.get(name);
          if (!object) throw missingObjectError();
          return [object.metadata];
        },
        async download({ destination } = {}) {
          const object = objects.get(name);
          if (!object) throw missingObjectError();
          if (destination) {
            await writeFile(destination, object.data);
            return [];
          }
          return [Buffer.from(object.data)];
        },
        async delete() {
          deleted.push(name);
          objects.delete(name);
        }
      };
    },
    async getFiles({ prefix }) {
      return [[...objects.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name }))];
    }
  };

  return {
    storage: { bucket: () => bucket },
    get uploads() { return uploads; },
    get pointerSaves() { return pointerSaves; },
    get pointerBytes() { return pointerBytes ? Buffer.from(pointerBytes) : undefined; },
    get pointerGeneration() { return pointerGeneration; },
    deleted,
    setPointer(pointer, generation = "7") {
      pointerBytes = Buffer.from(`${JSON.stringify(pointer)}\n`);
      pointerGeneration = generation;
    }
  };
}

test("candidate staging uploads once, returns bounded metadata, and leaves the local profile unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-stage-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const messages = [];
    const result = await stageProfileCandidate(profileConfig(profileDir), {
      storage: harness.storage,
      sqliteIntegrityCheck: async () => {},
      logger: { error(message) { messages.push(message); } }
    });

    assert.equal(result.status, "staged");
    assert.equal(harness.uploads, 1);
    assert.equal(harness.pointerSaves, 0);
    assert.equal(result.candidate.basePointerGeneration, "0");
    assert.match(result.candidate.generation, /^\d+$/);
    assert.match(result.candidate.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(result.candidate).sort(), [
      "basePointerGeneration", "bytes", "createdAt", "generation", "object", "sha256", "validation"
    ]);
    assert.equal(result.candidate.validation.requiredProfileFiles, 2);
    assert.equal(result.candidate.validation.sqliteDatabasesChecked, 1);
    assert.equal(await readFile(path.join(profileDir, "Default", "Cache", "discard"), "utf8"), "cache");
    assert.equal(await readFile(path.join(profileDir, "SingletonLock"), "utf8"), "runtime-only");
    assert.equal(await readFile(path.join(profileDir, "Default", "Local Storage", "state"), "utf8"), "opaque-auth-state");
    assert.deepEqual(messages.filter(message => message.includes('"event":"profile_store_step"')).map(message => JSON.parse(message.replace(/^\[maps-profile\] /, "")).stage), ["archive", "structure", "sqlite", "pointer_read", "upload", "metadata"]);
    const stageDiagnostic = JSON.parse(messages.find(message => message.includes('"event":"candidate_stage_pointer_observed"')).replace(/^\[maps-profile\] /, ""));
    assert.deepEqual(stageDiagnostic, {
      type: "profile_store_diagnostics",
      event: "candidate_stage_pointer_observed",
      pointerGenerationBefore: "0",
      pointerGenerationAfter: "0",
      pointerUnchanged: true
    });
    assert.match(messages.at(-1), /durable pointer unchanged/);
    assert.doesNotMatch(messages.join("\n"), /opaque-cookie-db|opaque-auth-state|opaque-local-state|opaque-preferences/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified candidate promotion advances current atomically without a second profile upload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-promote-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const config = profileConfig(profileDir);
    const staged = await stageProfileCandidate(config, {
      storage: harness.storage,
      sqliteIntegrityCheck: async () => {},
      logger: { error() {} }
    });
    await writeFile(path.join(profileDir, "Default", "Local Storage", "state"), "post-stage-agent-mutation");

    const promotionMessages = [];
    const promoted = await promoteProfileCandidate(config, staged.candidate, {
      storage: harness.storage,
      logger: { error(message) { promotionMessages.push(message); } }
    });
    assert.equal(promoted.status, "promoted");
    assert.equal(harness.uploads, 1);
    assert.equal(harness.pointerSaves, 1);
    const pointer = JSON.parse(harness.pointerBytes.toString("utf8"));
    assert.equal(pointer.current.object, staged.candidate.object);
    assert.equal(pointer.current.sha256, staged.candidate.sha256);
    assert.equal(pointer.current.bytes, staged.candidate.bytes);
    const promotionDiagnostic = JSON.parse(promotionMessages.find(message => message.includes('"event":"candidate_promote_pointer_observed"')).replace(/^\[maps-profile\] /, ""));
    assert.equal(promotionDiagnostic.type, "profile_store_diagnostics");
    assert.equal(promotionDiagnostic.event, "candidate_promote_pointer_observed");
    assert.equal(promotionDiagnostic.pointerGenerationBefore, "0");
    assert.match(promotionDiagnostic.pointerGenerationAfter, /^\d+$/);
    assert.equal(promotionDiagnostic.pointerAdvanced, true);
    assert.equal(promotionDiagnostic.currentMatchesCandidate, true);
    assert.equal(await readFile(path.join(profileDir, "Default", "Local Storage", "state"), "utf8"), "post-stage-agent-mutation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh restore records that the promoted current pointer was selected without logging object identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-restore-diagnostic-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const config = profileConfig(profileDir);
    const staged = await stageProfileCandidate(config, {
      storage: harness.storage,
      sqliteIntegrityCheck: async () => {},
      logger: { error() {} }
    });
    await promoteProfileCandidate(config, staged.candidate, { storage: harness.storage, logger: { error() {} } });
    await rm(profileDir, { recursive: true, force: true });
    const messages = [];
    const restored = await restoreProfileFromCloud(config, {
      storage: harness.storage,
      logger: { error(message) { messages.push(message); } }
    });
    assert.equal(restored.status, "restored");
    const diagnostic = JSON.parse(messages[0].replace(/^\[maps-profile\] /, ""));
    assert.equal(diagnostic.type, "profile_store_diagnostics");
    assert.equal(diagnostic.event, "profile_restore_succeeded");
    assert.equal(diagnostic.source, "current");
    assert.match(diagnostic.pointerGeneration, /^\d+$/);
    assert.equal(diagnostic.bytes, staged.candidate.bytes);
    assert.equal(diagnostic.digestVerified, true);
    assert.doesNotMatch(messages.join("\n"), /candidates\/|snapshots\/|[a-f0-9]{64}/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("promotion fails closed when the durable pointer generation changed after staging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-generation-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const config = profileConfig(profileDir);
    const staged = await stageProfileCandidate(config, {
      storage: harness.storage,
      sqliteIntegrityCheck: async () => {},
      logger: { error() {} }
    });
    harness.setPointer({
      version: 1,
      current: { object: "maps-browser-mcp/profile/snapshots/other.tar.gz", sha256: "a".repeat(64), bytes: 123, createdAt: "2026-09-06T00:00:00.000Z" }
    }, "7");
    const before = harness.pointerBytes;

    await assert.rejects(
      promoteProfileCandidate(config, staged.candidate, { storage: harness.storage, logger: { error() {} } }),
      /pointer changed after candidate staging/
    );
    assert.deepEqual(harness.pointerBytes, before);
    assert.equal(harness.pointerSaves, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unpromoted candidates are never restore fallbacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-unpublished-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const config = profileConfig(profileDir);
    await stageProfileCandidate(config, {
      storage: harness.storage,
      sqliteIntegrityCheck: async () => {},
      logger: { error() {} }
    });
    await rm(profileDir, { recursive: true, force: true });
    const result = await restoreProfileFromCloud(config, {
      storage: harness.storage,
      logger: { error() {} }
    });
    assert.equal(result.status, "missing");
    assert.equal(harness.pointerSaves, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate promotion fails closed after the first atomic pointer advance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-duplicate-promotion-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const config = profileConfig(profileDir);
    const staged = await stageProfileCandidate(config, {
      storage: harness.storage,
      sqliteIntegrityCheck: async () => {},
      logger: { error() {} }
    });
    await promoteProfileCandidate(config, staged.candidate, { storage: harness.storage, logger: { error() {} } });
    const afterFirst = harness.pointerBytes;
    await assert.rejects(
      promoteProfileCandidate(config, staged.candidate, { storage: harness.storage, logger: { error() {} } }),
      /pointer changed after candidate staging/
    );
    assert.deepEqual(harness.pointerBytes, afterFirst);
    assert.equal(harness.pointerSaves, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate retention is bounded independently from durable snapshots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-retention-test-"));
  try {
    const profileDir = await makeChromeProfile(root);
    const harness = createStorageHarness();
    const config = profileConfig(profileDir);
    for (let index = 0; index < 4; index += 1) {
      await stageProfileCandidate(config, {
        storage: harness.storage,
        sqliteIntegrityCheck: async () => {},
        logger: { error() {} }
      });
    }
    assert.equal(harness.uploads, 4);
    assert.equal(harness.deleted.length, 1);
    assert.match(harness.deleted[0], /\/candidates\//);
    assert.equal(harness.pointerSaves, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function symlinkCompat(target, linkPath) {
  const { symlink } = await import("node:fs/promises");
  await symlink(target, linkPath);
}

test("store stage failures identify the boundary without logging provider error contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-store-stage-diag-"));
  const messages = [];
  const secret = "PRIVATE_PROVIDER_OBJECT_TOKEN";
  try {
    const profileDir = await makeChromeProfile(root);
    const storage = { bucket() { return {
      file() { return { async getMetadata() { throw Object.assign(new Error(secret), { code: 403 }); } }; }
    }; } };
    await assert.rejects(stageProfileCandidate(profileConfig(profileDir), {
      storage, sqliteIntegrityCheck: async () => {}, logger: { error(message) { messages.push(message); } }
    }));
    assert.ok(messages.some(message => message.includes('"stage":"pointer_read"') && message.includes('"state":"failed"') && message.includes('"errorKind":"permission"')));
    assert.doesNotMatch(messages.join(""), new RegExp(secret));
  } finally { await rm(root, { recursive: true, force: true }); }
});
