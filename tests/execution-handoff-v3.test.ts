import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defineExecutionAdapter, type ExecutionHandoffAdapter } from "../src/execution-adapter.js";
import type { ResumePolicy } from "../src/execution-handoff.js";
import { ExecutionHandoffRuntimeV3, type CheckpointableIntervention } from "../src/execution-handoff-v3.js";
import { SignedFileHandoffCheckpointStore } from "../src/handoff-checkpoint.js";

type Intervention = CheckpointableIntervention;
type Decision = { epoch: number; resumePolicy: ResumePolicy };

const PRINCIPAL_A = "principal-binding-a-1234567890";
const PRINCIPAL_B = "principal-binding-b-1234567890";

class FixtureAdapter implements ExecutionHandoffAdapter<Intervention, Decision> {
  active: Intervention | undefined = {
    id: "handoff-1",
    status: "human_active",
    epoch: 4,
    resumePolicy: "replay_safe",
    updatedAt: 12_000
  };

  getResourceEpoch(): number { return this.active?.epoch ?? 5; }
  getActiveIntervention(): Intervention | undefined { return this.active ? { ...this.active } : undefined; }
  claimHumanControl(): Intervention { return { ...this.active! }; }
  markHumanControlComplete(): Intervention { return { ...this.active! }; }
  async verifyHumanIntervention(): Promise<Intervention> { return { ...this.active! }; }
  resumeAfterHumanIntervention(): Decision { return { epoch: this.getResourceEpoch(), resumePolicy: "revalidate" }; }
  cancelHumanIntervention(): void { this.active = undefined; }
}

test("v3 recovery is principal-bound and always requires reissue plus revalidation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-handoff-v3-"));
  const file = path.join(dir, "checkpoint.json");
  try {
    const adapter = new FixtureAdapter();
    const store = new SignedFileHandoffCheckpointStore(file, Buffer.alloc(32, 8), () => 13_000);
    const runtime = new ExecutionHandoffRuntimeV3(
      defineExecutionAdapter("desktop.mock", adapter),
      { checkpointStore: store, checkpointTtlMs: 60_000, now: () => 13_000 }
    );

    runtime.checkpoint(PRINCIPAL_A, "action-digest-only");
    const recovered = runtime.recover(PRINCIPAL_A);
    assert.ok(recovered);
    assert.equal(recovered.recovery, "reissue_and_revalidate");
    assert.equal(recovered.actionDigest, "action-digest-only");
    assert.equal(runtime.recover(PRINCIPAL_B), undefined);

    const raw = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(raw, /query|destination|password|cookie|captcha/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("v3 approval is invalidated by resource epoch changes", () => {
  const adapter = new FixtureAdapter();
  const runtime = new ExecutionHandoffRuntimeV3(defineExecutionAdapter("desktop.mock", adapter));
  const request = runtime.requestApproval({
    actionName: "delete",
    args: { resourceId: "r1" },
    principalBinding: PRINCIPAL_A
  });
  const receipt = runtime.grantApproval(request.id, PRINCIPAL_A);

  adapter.active = { ...adapter.active!, epoch: 5 };
  assert.throws(() => runtime.consumeApproval({
    id: request.id,
    receipt,
    actionName: "delete",
    args: { resourceId: "r1" },
    principalBinding: PRINCIPAL_A
  }));
});

test("v3 checkpoint clears once no intervention remains", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-handoff-v3-clear-"));
  const file = path.join(dir, "checkpoint.json");
  try {
    const adapter = new FixtureAdapter();
    const runtime = new ExecutionHandoffRuntimeV3(
      defineExecutionAdapter("terminal.mock", adapter),
      {
        checkpointStore: new SignedFileHandoffCheckpointStore(file, Buffer.alloc(32, 8), () => 13_000),
        checkpointTtlMs: 60_000,
        now: () => 13_000
      }
    );
    runtime.checkpoint(PRINCIPAL_A);
    assert.equal(fs.existsSync(file), true);
    adapter.active = undefined;
    runtime.checkpoint(PRINCIPAL_A);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("configured durability releases Human authority if checkpoint persistence fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-handoff-v3-fail-"));
  const blocker = path.join(dir, "not-a-directory");
  fs.writeFileSync(blocker, "block");
  try {
    const adapter = new FixtureAdapter();
    const runtime = new ExecutionHandoffRuntimeV3(
      defineExecutionAdapter("browser.maps", adapter),
      {
        checkpointStore: new SignedFileHandoffCheckpointStore(
          path.join(blocker, "checkpoint.json"),
          Buffer.alloc(32, 8),
          () => 13_000
        ),
        checkpointTtlMs: 60_000,
        now: () => 13_000
      }
    );

    assert.throws(() => runtime.checkpoint(PRINCIPAL_A, "action-digest-only"));
    assert.equal(adapter.getActiveIntervention(), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
