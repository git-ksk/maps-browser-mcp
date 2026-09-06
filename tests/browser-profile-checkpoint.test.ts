import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  createStoppedBrowserProfileCheckpointHook,
  createStoppedBrowserProfilePreparationHook
} from "../src/browser-profile-checkpoint.js";

test("stopped browser profile checkpoint hook is a no-op when deployment module is absent", async () => {
  const hook = createStoppedBrowserProfileCheckpointHook(undefined);
  await hook({ reason: "credential_safe_sign_in" });
});

test("stopped browser profile checkpoint hook loads one bounded deployment module", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-hook-"));
  try {
    const marker = path.join(root, "marker.txt");
    const modulePath = path.join(root, "provider.mjs");
    await writeFile(modulePath, `import { writeFile } from "node:fs/promises";\nexport async function checkpointStoppedBrowserProfile(context) {\n  if (context.reason !== "credential_safe_sign_in") throw new Error("wrong reason");\n  await writeFile(${JSON.stringify(marker)}, context.reason);\n}\n`);
    const hook = createStoppedBrowserProfileCheckpointHook(pathToFileURL(modulePath).href);
    await hook({ reason: "credential_safe_sign_in" });
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(marker, "utf8"), "credential_safe_sign_in");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stopped browser profile checkpoint hook rejects an invalid deployment module", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-hook-invalid-"));
  try {
    const modulePath = path.join(root, "provider.mjs");
    await writeFile(modulePath, "export const nope = true;\n");
    const hook = createStoppedBrowserProfileCheckpointHook(pathToFileURL(modulePath).href);
    await assert.rejects(
      hook({ reason: "credential_safe_sign_in" }),
      /candidate stage\/promote pair or checkpointStoppedBrowserProfile/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("stopped browser profile preparation hook is optional and runs only when the module exports it", async () => {
  const absent = createStoppedBrowserProfilePreparationHook(undefined);
  await absent({ reason: "credential_safe_sign_in" });

  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-prepare-hook-"));
  try {
    const marker = path.join(root, "prepared.txt");
    const modulePath = path.join(root, "provider.mjs");
    await writeFile(modulePath, `import { writeFile } from "node:fs/promises";\nexport async function prepareStoppedBrowserProfileForVerification(context) {\n  await writeFile(${JSON.stringify(marker)}, context.reason);\n}\nexport async function checkpointStoppedBrowserProfile() {}\n`);
    const hook = createStoppedBrowserProfilePreparationHook(pathToFileURL(modulePath).href);
    await hook({ reason: "credential_safe_sign_in" });
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(marker, "utf8"), "credential_safe_sign_in");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stopped browser profile preparation hook preserves backward compatibility when provider omits preparation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-prepare-optional-"));
  try {
    const modulePath = path.join(root, "provider.mjs");
    await writeFile(modulePath, "export async function checkpointStoppedBrowserProfile() {}\n");
    const hook = createStoppedBrowserProfilePreparationHook(pathToFileURL(modulePath).href);
    await hook({ reason: "credential_safe_sign_in" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stopped browser profile candidate provider stages bounded metadata and promotes that exact candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-candidate-hook-"));
  try {
    const marker = path.join(root, "promoted.txt");
    const modulePath = path.join(root, "provider.mjs");
    const candidate = {
      object: "maps-browser-mcp/profile/candidates/example.tar.gz",
      generation: "101",
      bytes: 1234,
      sha256: "a".repeat(64),
      createdAt: "2026-09-06T04:00:00.000Z",
      basePointerGeneration: "77",
      validation: { archiveEntries: 42, requiredProfileFiles: 2, sqliteDatabasesChecked: 1 }
    };
    await writeFile(modulePath, `import { writeFile } from "node:fs/promises";\nexport async function stageStoppedBrowserProfileCandidate(context) {\n  if (context.reason !== "credential_safe_sign_in") throw new Error("wrong reason");\n  return ${JSON.stringify(candidate)};\n}\nexport async function promoteStoppedBrowserProfileCandidate(context, candidate) {\n  if (context.reason !== "credential_safe_sign_in") throw new Error("wrong reason");\n  await writeFile(${JSON.stringify(marker)}, candidate.object);\n}\n`);
    const preparation = createStoppedBrowserProfilePreparationHook(pathToFileURL(modulePath).href);
    const checkpoint = createStoppedBrowserProfileCheckpointHook(pathToFileURL(modulePath).href);
    const staged = await preparation({ reason: "credential_safe_sign_in" });
    assert.deepEqual(staged, candidate);
    await checkpoint({ reason: "credential_safe_sign_in" }, staged);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(marker, "utf8"), candidate.object);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate hook rejects provider metadata with undeclared fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-candidate-secret-"));
  try {
    const modulePath = path.join(root, "provider.mjs");
    await writeFile(modulePath, `export async function stageStoppedBrowserProfileCandidate() { return { object: "maps-browser-mcp/profile/candidates/example.tar.gz", generation: "1", bytes: 1, sha256: "${"b".repeat(64)}", createdAt: "2026-09-06T04:00:00.000Z", basePointerGeneration: "0", validation: { archiveEntries: 1, requiredProfileFiles: 2, sqliteDatabasesChecked: 0 }, rawCredentialData: "forbidden" }; }\nexport async function promoteStoppedBrowserProfileCandidate() {}\n`);
    const preparation = createStoppedBrowserProfilePreparationHook(pathToFileURL(modulePath).href);
    await assert.rejects(
      preparation({ reason: "credential_safe_sign_in" }),
      /unsupported metadata fields/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
