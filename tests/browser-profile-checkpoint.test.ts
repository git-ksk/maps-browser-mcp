import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createStoppedBrowserProfileCheckpointHook } from "../src/browser-profile-checkpoint.js";

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
      /must export checkpointStoppedBrowserProfile/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
