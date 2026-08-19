import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import { ThinTakeoverHumanProvider } from "../src/browser/thin-takeover-human-provider.js";

test("Thin Takeover provider is keyless and returns only the Handoff broker locator", async () => {
  const calls: string[] = [];
  const broker = {
    createLink(ref: { id: string; epoch: number }, principal: string) {
      calls.push(`broker:create:${ref.id}:${ref.epoch}:${principal}`);
      return "https://handoff.example/takeover/session/public-locator";
    },
    revokeForIntervention(id: string) { calls.push(`broker:revoke:${id}`); }
  } as unknown as TakeoverBroker;

  const provider = new ThinTakeoverHumanProvider(broker);
  const grant = await provider.begin({ interventionId: "int-1", epoch: 5, principalBinding: "principal-a" });
  assert.equal(grant.locator, "https://handoff.example/takeover/session/public-locator");
  assert.doesNotMatch(grant.locator, /apiKey|steel/i);
  assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(calls, ["broker:create:int-1:5:principal-a"]);

  await provider.revoke(grant.sessionId);
  assert.deepEqual(calls, [
    "broker:create:int-1:5:principal-a",
    "broker:revoke:int-1"
  ]);
});
