import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import { WebRtcCredentialTakeoverBoundary } from "../src/browser/webrtc-credential-takeover-boundary.js";

function fakeBroker(calls: string[]): TakeoverBroker {
  return {
    createWebRtcLink(ref: { id: string; epoch: number }, principalBinding: string, target?: { processId: number }) {
      calls.push(`create-webrtc:${ref.id}:${ref.epoch}:${principalBinding}:${target?.processId ?? "none"}`);
      return "https://takeover.example/takeover/webrtc-locator";
    },
    async revokeWebRtcForIntervention(interventionId: string) {
      calls.push(`revoke-webrtc:${interventionId}`);
    }
  } as unknown as TakeoverBroker;
}

test("WebRTC credential boundary fails closed away from macOS", () => {
  assert.throws(
    () => new WebRtcCredentialTakeoverBoundary(fakeBroker([]), "linux"),
    /requires a macOS host runtime/
  );
});

test("WebRTC credential boundary exposes only locator start and revoke lifecycle", async () => {
  const calls: string[] = [];
  const boundary = new WebRtcCredentialTakeoverBoundary(fakeBroker(calls), "darwin");
  const locator = boundary.start({ interventionId: "int-1", epoch: 8, principalBinding: "principal-a", targetProcessId: 5252 });
  assert.equal(locator, "https://takeover.example/takeover/webrtc-locator");
  assert.deepEqual(calls, ["create-webrtc:int-1:8:principal-a:5252"]);
  await boundary.revoke("int-1");
  assert.deepEqual(calls, ["create-webrtc:int-1:8:principal-a:5252", "revoke-webrtc:int-1"]);
});
