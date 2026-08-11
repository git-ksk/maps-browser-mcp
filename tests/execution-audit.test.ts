import assert from "node:assert/strict";
import test from "node:test";
import { MemoryExecutionAuditSink } from "../src/execution-audit.js";

test("execution audit sink records bounded control-plane metadata only", () => {
  const sink = new MemoryExecutionAuditSink();
  sink.record({
    type: "approval_requested",
    adapterKind: "browser.maps",
    timestamp: 123,
    approvalId: "approval-1",
    epoch: 4,
    principalBinding: "principal-binding-hash",
    actionDigest: "action-digest-hash"
  });

  const events = sink.snapshot();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: "approval_requested",
    adapterKind: "browser.maps",
    timestamp: 123,
    approvalId: "approval-1",
    epoch: 4,
    principalBinding: "principal-binding-hash",
    actionDigest: "action-digest-hash"
  });
  assert.equal("args" in events[0]!, false);
  assert.equal("credential" in events[0]!, false);
  assert.equal("token" in events[0]!, false);
});
