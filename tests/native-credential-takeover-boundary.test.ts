import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import { NativeCredentialTakeoverBoundary } from "../src/browser/native-credential-takeover-boundary.js";

function fakeBroker(calls: string[]): TakeoverBroker {
  return {
    createLink(ref: { id: string; epoch: number }, principalBinding: string) {
      calls.push(`create:${ref.id}:${ref.epoch}:${principalBinding}`);
      return "https://takeover.example/takeover/native-locator";
    },
    async revokeNativeForIntervention(interventionId: string) {
      calls.push(`revoke:${interventionId}`);
    }
  } as unknown as TakeoverBroker;
}

test("native credential boundary fails closed away from macOS", () => {
  assert.throws(
    () => new NativeCredentialTakeoverBoundary(fakeBroker([]), "linux"),
    /requires a macOS host runtime/
  );
});

test("native credential boundary exposes only start and revoke lifecycle", async () => {
  const calls: string[] = [];
  const boundary = new NativeCredentialTakeoverBoundary(fakeBroker(calls), "darwin");

  const locator = boundary.start({
    interventionId: "int-1",
    epoch: 7,
    principalBinding: "principal-a"
  });
  assert.equal(locator, "https://takeover.example/takeover/native-locator");
  assert.deepEqual(calls, ["create:int-1:7:principal-a"]);

  await boundary.revoke("int-1");
  assert.deepEqual(calls, ["create:int-1:7:principal-a", "revoke:int-1"]);
});
