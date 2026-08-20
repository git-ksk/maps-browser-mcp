import assert from "node:assert/strict";
import test from "node:test";
import type { NativeCredentialTakeoverBoundary } from "../src/browser/native-credential-takeover-boundary.js";
import { ThinTakeoverHumanProvider } from "../src/browser/thin-takeover-human-provider.js";

test("Thin Takeover provider is keyless and returns only the Native Handoff locator", async () => {
  const calls: string[] = [];
  const takeover = {
    start(request: { interventionId: string; epoch: number; principalBinding: string }) {
      calls.push(`native:start:${request.interventionId}:${request.epoch}:${request.principalBinding}`);
      return "https://handoff.example/takeover/session/public-locator";
    },
    async revoke(interventionId: string) {
      calls.push(`native:revoke:${interventionId}`);
    }
  } as unknown as NativeCredentialTakeoverBoundary;

  const provider = new ThinTakeoverHumanProvider(takeover);
  const grant = await provider.begin({ interventionId: "int-1", epoch: 5, principalBinding: "principal-a" });
  assert.equal(grant.locator, "https://handoff.example/takeover/session/public-locator");
  assert.doesNotMatch(grant.locator, /apiKey|steel|rootKey/i);
  assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(calls, ["native:start:int-1:5:principal-a"]);

  await provider.revoke(grant.sessionId);
  assert.deepEqual(calls, [
    "native:start:int-1:5:principal-a",
    "native:revoke:int-1"
  ]);
});
