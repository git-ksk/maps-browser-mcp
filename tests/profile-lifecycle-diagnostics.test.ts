import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  formatProfileLifecycleDiagnostic,
  readProfileMetadataSummary
} from "../src/browser/profile-lifecycle-diagnostics.js";

test("profile lifecycle diagnostics expose only bounded metadata and no profile values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "maps-profile-diagnostics-"));
  try {
    await mkdir(path.join(root, "Default", "Network"), { recursive: true });
    await writeFile(path.join(root, "Local State"), "secret-local-state");
    await writeFile(path.join(root, "Default", "Preferences"), "secret-preferences");
    await writeFile(path.join(root, "Default", "Network", "Cookies"), "secret-cookie-db");
    await writeFile(path.join(root, "Default", "Network", "Cookies-wal"), "secret-cookie-wal");
    await writeFile(path.join(root, "Default", "Network", "Cookies-shm"), "secret-cookie-shm");
    await writeFile(path.join(root, "SingletonLock"), "lock");

    const summary = await readProfileMetadataSummary(root);
    assert.equal(summary.coreFilesPresent, 2);
    assert.equal(summary.cookieDbFilesPresent, 1);
    assert.equal(summary.cookieWalFilesPresent, 1);
    assert.equal(summary.sqliteSidecarFilesPresent, 2);
    assert.equal(summary.singletonLocksPresent, 1);

    const encoded = formatProfileLifecycleDiagnostic("human_browser_close_started", {
      exactWindowBound: true,
      profile: summary
    });
    assert.match(encoded, /profile_lifecycle_diagnostics/);
    assert.doesNotMatch(encoded, /secret-|maps-profile-diagnostics-|cookie-db|cookie-wal|cookie-shm/);
    assert.doesNotMatch(encoded, /pid|windowId|profileDir|email|cookieValue|token|credential/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("profile lifecycle formatter does not invent identifiers", () => {
  const encoded = formatProfileLifecycleDiagnostic("fresh_agent_readiness_final", {
    finalState: "signed_out",
    elapsedMs: 8000,
    samples: 81,
    signedInSamples: 0,
    signedOutSamples: 81,
    unknownSamples: 0,
    transitions: 1
  });
  const parsed = JSON.parse(encoded);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "elapsedMs", "event", "finalState", "samples", "signedInSamples",
    "signedOutSamples", "transitions", "type", "unknownSamples"
  ].sort());
});


test("profile lifecycle diagnostics reject identifiers and free-form fields", () => {
  for (const field of ["bootId", "sequence", "pid", "windowId", "profileDir", "account", "email", "token", "cookieValue"]) {
    assert.throws(
      () => formatProfileLifecycleDiagnostic("runtime_boot", { [field]: "forbidden" } as never),
      /not allowlisted/
    );
  }
});
