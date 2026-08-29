import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverAuthorityReleaseEvent } from "mcp-execution-handoff/browser-takeover";
import { MapsHandoffLifecycleBridge } from "../src/browser/handoff-lifecycle-bridge.js";
import { BrowserRuntimeError, MapsBrowserRuntime } from "../src/browser/runtime.js";
import type { ChromeProcess } from "../src/browser/chrome-process.js";
import type { PolicyEngine } from "../src/policy/policy-engine.js";

function runtimeWithHumanSignIn(): MapsBrowserRuntime {
  const runtime = new MapsBrowserRuntime({} as ChromeProcess, {} as PolicyEngine);
  runtime.readAuthenticatedReadiness = async () => "signed_out";
  return runtime;
}

async function activeHuman(runtime: MapsBrowserRuntime) {
  await assert.rejects(
    runtime.requestHumanSignIn(),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  const awaiting = runtime.getActiveIntervention();
  assert.ok(awaiting);
  return runtime.claimHumanControl(awaiting.id);
}

function releaseEvent(
  interventionId: string,
  epoch: number,
  reason: TakeoverAuthorityReleaseEvent["reason"]
): TakeoverAuthorityReleaseEvent {
  return {
    interventionId,
    epoch,
    disposition: reason === "human_completed" ? "completed" : "revoked",
    reason
  };
}

for (const reason of ["human_completed", "authority_lost"] as const) {
  test(`Handoff ${reason} releases only Human authority and moves Maps to verifying`, async () => {
    const runtime = runtimeWithHumanSignIn();
    const human = await activeHuman(runtime);
    const bridge = new MapsHandoffLifecycleBridge(runtime);

    const verifying = bridge.onAuthorityReleased(releaseEvent(human.id, human.epoch, reason));

    assert.equal(verifying?.status, "verifying");
    assert.equal(verifying?.authority, "none");
    assert.equal(verifying?.epoch, human.epoch + 1);
    assert.equal(runtime.getActiveIntervention()?.status, "verifying");
    assert.equal(bridge.matchesReleasedContinuation(human.id, human.epoch), true);
    assert.throws(
      () => runtime.resumeAfterHumanIntervention(human.id),
      /expected ready_to_resume/
    );
  });
}

test("stale Handoff release generation cannot change Maps authority", async () => {
  const runtime = runtimeWithHumanSignIn();
  const human = await activeHuman(runtime);
  const bridge = new MapsHandoffLifecycleBridge(runtime);

  assert.equal(
    bridge.onAuthorityReleased(releaseEvent(human.id, human.epoch + 1, "authority_lost")),
    undefined
  );
  assert.equal(runtime.getActiveIntervention()?.status, "human_active");
  assert.equal(runtime.getActiveIntervention()?.authority, "human");
});

test("explicit completion can enter verifying without pretending consumer revoke was Handoff Done", async () => {
  const runtime = runtimeWithHumanSignIn();
  const human = await activeHuman(runtime);
  const bridge = new MapsHandoffLifecycleBridge(runtime);

  const verifying = bridge.ensureVerifying(human.id, human.epoch);

  assert.equal(verifying.status, "verifying");
  assert.equal(verifying.authority, "none");
  assert.equal(bridge.matchesReleasedContinuation(human.id, human.epoch), false);
});

test("clearing a released generation prevents a stale completion bridge from reviving it", async () => {
  const runtime = runtimeWithHumanSignIn();
  const human = await activeHuman(runtime);
  const bridge = new MapsHandoffLifecycleBridge(runtime);
  bridge.onAuthorityReleased(releaseEvent(human.id, human.epoch, "human_completed"));

  bridge.clear(human.id);

  assert.equal(bridge.matchesReleasedContinuation(human.id, human.epoch), false);
  assert.throws(
    () => bridge.ensureVerifying(human.id, human.epoch),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "UI_STATE_CHANGED"
  );
  assert.equal(runtime.getActiveIntervention()?.status, "verifying");
  assert.equal(runtime.getActiveIntervention()?.authority, "none");
});
