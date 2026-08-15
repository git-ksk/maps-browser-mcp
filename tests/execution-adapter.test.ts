import assert from "node:assert/strict";
import test from "node:test";
import { defineExecutionAdapter, type ExecutionHandoffAdapter } from "mcp-execution-handoff/core";

type Intervention = { id: string; epoch: number; status: string };
type Decision = { epoch: number; resumePolicy: string };

class FakeDesktopAdapter implements ExecutionHandoffAdapter<Intervention, Decision> {
  private active: Intervention | undefined = { id: "desktop-1", epoch: 2, status: "awaiting_human" };

  getResourceEpoch(): number { return this.active?.epoch ?? 3; }
  getActiveIntervention(): Intervention | undefined { return this.active ? { ...this.active } : undefined; }
  claimHumanControl(id: string): Intervention {
    assert.equal(id, this.active?.id);
    this.active = { ...this.active!, status: "human_active" };
    return { ...this.active };
  }
  markHumanControlComplete(id: string): Intervention {
    assert.equal(id, this.active?.id);
    this.active = { ...this.active!, epoch: 3, status: "verifying" };
    return { ...this.active };
  }
  async verifyHumanIntervention(id: string): Promise<Intervention> {
    assert.equal(id, this.active?.id);
    this.active = { ...this.active!, status: "ready_to_resume" };
    return { ...this.active };
  }
  resumeAfterHumanIntervention(id: string): Decision {
    assert.equal(id, this.active?.id);
    const decision = { epoch: this.active!.epoch, resumePolicy: "revalidate" };
    this.active = undefined;
    return decision;
  }
  cancelHumanIntervention(id: string): void {
    assert.equal(id, this.active?.id);
    this.active = undefined;
  }
}

test("generic adapter contract supports a non-browser execution surface", async () => {
  const registered = defineExecutionAdapter("desktop.mock", new FakeDesktopAdapter());
  assert.equal(registered.kind, "desktop.mock");
  const active = registered.control.getActiveIntervention();
  assert.ok(active);
  registered.control.claimHumanControl(active.id);
  registered.control.markHumanControlComplete(active.id);
  await registered.control.verifyHumanIntervention(active.id);
  assert.deepEqual(registered.control.resumeAfterHumanIntervention(active.id), {
    epoch: 3,
    resumePolicy: "revalidate"
  });
});

test("adapter kind is bounded", () => {
  const adapter = new FakeDesktopAdapter();
  assert.throws(() => defineExecutionAdapter("", adapter), /1-80/);
  assert.throws(() => defineExecutionAdapter("x".repeat(81), adapter), /1-80/);
});
