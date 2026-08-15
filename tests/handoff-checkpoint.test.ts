import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HandoffCheckpointError,
  SignedFileHandoffCheckpointStore,
  type HandoffCheckpoint
} from "mcp-execution-handoff/core";

function fixture(now = 10_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-handoff-checkpoint-"));
  const file = path.join(dir, "checkpoint.json");
  const store = new SignedFileHandoffCheckpointStore(file, Buffer.alloc(32, 4), () => now);
  return { dir, file, store };
}

function checkpoint(): HandoffCheckpoint {
  return {
    version: 1,
    adapterKind: "browser.maps",
    interventionId: "intervention-a",
    status: "human_active",
    epoch: 9,
    resumePolicy: "replay_safe",
    principalBinding: "principal-binding-hash-value",
    actionDigest: "action-digest-value-12345",
    updatedAt: 9_500,
    expiresAt: 20_000
  };
}

test("durable checkpoint persists only bounded control-plane metadata", () => {
  const { dir, file, store } = fixture();
  try {
    store.write(checkpoint());
    const raw = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(raw, /Tokyo|Yokohama|password|captcha|cookie/i);
    assert.match(raw, /intervention-a/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(store.load(), checkpoint());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recovery never restores stale execution authority or raw action", () => {
  const { dir, store } = fixture();
  try {
    store.write(checkpoint());
    const recovered = store.recover();
    assert.ok(recovered);
    assert.equal(recovered.recovery, "reissue_and_revalidate");
    assert.equal(recovered.status, "human_active");
    assert.equal("action" in recovered, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered checkpoint fails closed", () => {
  const { dir, file, store } = fixture();
  try {
    store.write(checkpoint());
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as { checkpoint: HandoffCheckpoint; mac: string };
    envelope.checkpoint.epoch = 999;
    fs.writeFileSync(file, JSON.stringify(envelope));
    assert.throws(
      () => store.load(),
      (error: unknown) => error instanceof HandoffCheckpointError && error.code === "CHECKPOINT_INVALID"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("expired checkpoint cannot authorize recovery", () => {
  const { dir, file } = fixture();
  try {
    const store = new SignedFileHandoffCheckpointStore(file, Buffer.alloc(32, 4), () => 30_000);
    store.write({ ...checkpoint(), expiresAt: 20_000 });
    assert.throws(
      () => store.recover(),
      (error: unknown) => error instanceof HandoffCheckpointError && error.code === "CHECKPOINT_EXPIRED"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkpoint can be cleared atomically from the control plane", () => {
  const { dir, file, store } = fixture();
  try {
    store.write(checkpoint());
    assert.equal(fs.existsSync(file), true);
    store.clear();
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.load(), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
