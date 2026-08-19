import assert from "node:assert/strict";
import test from "node:test";
import { executeLiableUsageTask, MAPS_USAGE_COLLECTION_PREFIX, mapsUsageOperationId } from "../src/usage.js";

function failingLease(calls: Array<{ units: number; outcome: string }>) {
  return {
    settle: async (units: number, outcome: string) => {
      calls.push({ units, outcome });
      throw new Error("fixture settlement unavailable");
    }
  };
}

test("HTTP request scopes keep reused JSON-RPC ids distinct", () => {
  assert.notEqual(mapsUsageOperationId("request-a", 7), mapsUsageOperationId("request-b", 7));
  assert.equal(mapsUsageOperationId("request-a", 7), "request-a:7");
});

test("Maps owns a Firestore namespace distinct from Cinema MCP", () => {
  assert.equal(MAPS_USAGE_COLLECTION_PREFIX, "maps_muc");
  assert.notEqual(MAPS_USAGE_COLLECTION_PREFIX, "cinema_muc");
});

test("post-liability settlement failure never masks a successful Maps result", async () => {
  const calls: Array<{ units: number; outcome: string }> = [];
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const result = await executeLiableUsageTask(failingLease(calls), async () => ({ ok: true }));
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [{ units: 1, outcome: "completed" }]);
  } finally {
    console.error = originalError;
  }
});

test("post-liability settlement failure preserves the original Maps task error", async () => {
  const calls: Array<{ units: number; outcome: string }> = [];
  const expected = new Error("browser task failed");
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(
      () => executeLiableUsageTask(failingLease(calls), async () => { throw expected; }),
      (error) => error === expected
    );
    assert.deepEqual(calls, [{ units: 1, outcome: "error" }]);
  } finally {
    console.error = originalError;
  }
});

test("returned MCP tool errors settle as errors without changing the payload", async () => {
  const calls: Array<{ units: number; outcome: string }> = [];
  const lease = {
    settle: async (units: number, outcome: string) => {
      calls.push({ units, outcome });
      return {} as never;
    }
  };
  const payload = { isError: true, content: [{ type: "text", text: "bounded Maps failure" }] };
  const result = await executeLiableUsageTask(lease, async () => payload);
  assert.equal(result, payload);
  assert.deepEqual(calls, [{ units: 1, outcome: "error" }]);
});
