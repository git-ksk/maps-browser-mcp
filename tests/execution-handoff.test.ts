import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionHandoffError,
  ExecutionHandoffState
} from "../src/execution-handoff.js";

type Action = { kind: "search"; query: string };
type Reason = "access_challenge" | "sign_in";

function makeState() {
  let now = 1_000;
  let id = 0;
  return {
    state: new ExecutionHandoffState<Action, Reason>(
      () => now,
      () => `intervention-${++id}`
    ),
    tick(ms = 1) {
      now += ms;
    }
  };
}

test("begin suspends agent authority and preserves canonical action", () => {
  const { state } = makeState();
  const action: Action = { kind: "search", query: "coffee near Tokyo Station" };

  const started = state.begin({
    reason: "access_challenge",
    action,
    resumePolicy: "replay_safe"
  });

  assert.equal(started.id, "intervention-1");
  assert.equal(started.status, "awaiting_human");
  assert.equal(started.authority, "none");
  assert.equal(started.epoch, 1);
  assert.deepEqual(started.action, action);
  assert.equal(state.getAuthority(), "none");
  assert.throws(
    () => state.assertAgentAuthority(),
    (error: unknown) =>
      error instanceof ExecutionHandoffError && error.code === "AGENT_AUTHORITY_SUSPENDED"
  );

  const duplicate = state.begin({
    reason: "sign_in",
    resumePolicy: "never_replay"
  });
  assert.equal(duplicate.id, started.id);
  assert.equal(duplicate.reason, "access_challenge");
  assert.equal(state.getResourceEpoch(), 1);
});

test("human handoff invalidates old resource state before safe resume", () => {
  const { state, tick } = makeState();
  const action: Action = { kind: "search", query: "coffee near Tokyo Station" };
  const started = state.begin({
    reason: "access_challenge",
    action,
    resumePolicy: "replay_safe"
  });

  tick();
  const claimed = state.claimHuman(started.id);
  assert.equal(claimed.status, "human_active");
  assert.equal(claimed.authority, "human");
  assert.equal(state.getAuthority(), "human");

  tick();
  const completed = state.markHumanComplete(started.id);
  assert.equal(completed.status, "verifying");
  assert.equal(completed.authority, "none");
  assert.equal(completed.epoch, 2);

  tick();
  const verified = state.markVerified(started.id);
  assert.equal(verified.status, "ready_to_resume");
  assert.equal(verified.epoch, 2);

  const decision = state.resumeAgent(started.id);
  assert.deepEqual(decision.action, action);
  assert.equal(decision.resumePolicy, "replay_safe");
  assert.equal(decision.epoch, 2);
  assert.equal(state.getAuthority(), "agent");
  assert.equal(state.getActive(), undefined);
  assert.doesNotThrow(() => state.assertAgentAuthority());
});

test("failed verification can explicitly return exclusive control to the human", () => {
  const { state, tick } = makeState();
  const started = state.begin({
    reason: "access_challenge",
    resumePolicy: "replay_safe"
  });
  state.claimHuman(started.id);
  const completed = state.markHumanComplete(started.id);
  const epochAfterCompletion = completed.epoch;

  tick();
  const returned = state.returnToHuman(started.id);

  assert.equal(returned.status, "human_active");
  assert.equal(returned.authority, "human");
  assert.equal(returned.epoch, epochAfterCompletion);
  assert.equal(state.getResourceEpoch(), epochAfterCompletion);
  assert.equal(state.getAuthority(), "human");
});

test("invalid transition and stale intervention ids fail closed", () => {
  const { state } = makeState();
  const started = state.begin({
    reason: "sign_in",
    resumePolicy: "never_replay"
  });

  assert.throws(
    () => state.markVerified(started.id),
    (error: unknown) =>
      error instanceof ExecutionHandoffError && error.code === "INTERVENTION_STATE_CHANGED"
  );
  assert.throws(
    () => state.claimHuman("wrong-id"),
    (error: unknown) =>
      error instanceof ExecutionHandoffError && error.code === "INTERVENTION_NOT_FOUND"
  );
  assert.throws(
    () => state.returnToHuman(started.id),
    (error: unknown) =>
      error instanceof ExecutionHandoffError && error.code === "INTERVENTION_STATE_CHANGED"
  );
});

test("cancel restores agent authority and advances the resource epoch", () => {
  const { state } = makeState();
  const started = state.begin({
    reason: "access_challenge",
    resumePolicy: "never_replay"
  });
  assert.equal(state.getResourceEpoch(), 1);

  state.cancel(started.id);

  assert.equal(state.getAuthority(), "agent");
  assert.equal(state.getResourceEpoch(), 2);
  assert.equal(state.getActive(), undefined);
});
