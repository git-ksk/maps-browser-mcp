import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import { NativeCredentialTakeoverBoundary } from "../src/browser/native-credential-takeover-boundary.js";

function fakeBroker(calls: string[]): TakeoverBroker {
  return {
    createNativeLink(ref: { id: string; epoch: number }, principalBinding: string, target?: { processId: number }) {
      calls.push(`create-native:${ref.id}:${ref.epoch}:${principalBinding}:${target?.processId ?? "none"}`);
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

test("native credential boundary exposes only Native-only start and revoke lifecycle", async () => {
  const calls: string[] = [];
  const boundary = new NativeCredentialTakeoverBoundary(fakeBroker(calls), "darwin");

  const locator = boundary.start({
    interventionId: "int-1",
    epoch: 7,
    principalBinding: "principal-a",
    targetProcessId: 4242
  });
  assert.equal(locator, "https://takeover.example/takeover/native-locator");
  assert.deepEqual(calls, ["create-native:int-1:7:principal-a:4242"]);

  await boundary.revoke("int-1");
  assert.deepEqual(calls, ["create-native:int-1:7:principal-a:4242", "revoke:int-1"]);
});
