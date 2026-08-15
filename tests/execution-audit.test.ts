import assert from "node:assert/strict";
import test from "node:test";
import { MemoryExecutionAuditSink } from "mcp-execution-handoff/core";

test("execution audit sink records bounded control-plane metadata only", () => {
  const sink = new MemoryExecutionAuditSink();
  sink.record({
    type: "checkpoint_written",
    adapterKind: "browser.maps",
    timestamp: 123,
    epoch: 4,
    principalBinding: "principal-binding-hash",
    actionDigest: "action-digest-hash"
  });

  const events = sink.snapshot();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: "checkpoint_written",
    adapterKind: "browser.maps",
    timestamp: 123,
    epoch: 4,
    principalBinding: "principal-binding-hash",
    actionDigest: "action-digest-hash"
  });
  assert.equal("args" in events[0]!, false);
  assert.equal("credential" in events[0]!, false);
  assert.equal("token" in events[0]!, false);
});
