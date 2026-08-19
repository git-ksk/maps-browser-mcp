import assert from "node:assert/strict";
import test from "node:test";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import type { SteelHostedBrowserSession } from "../src/browser/steel-hosted-browser.js";
import { SteelTakeoverHumanProvider } from "../src/browser/steel-takeover-human-provider.js";

test("Steel takeover provider returns the Handoff broker locator, not a provider viewer URL", async () => {
  const calls: string[] = [];
  const browser = {
    async start() { calls.push("browser:start"); return { kind: "browser_websocket", websocketUrl: "wss://internal.invalid?apiKey=secret" }; },
    sessionInfo() { return { sessionId: "steel-1", expiresAt: 123456789 }; }
  } as unknown as SteelHostedBrowserSession;
  const broker = {
    createLink(ref: { id: string; epoch: number }, principal: string) {
      calls.push(`broker:create:${ref.id}:${ref.epoch}:${principal}`);
      return "https://handoff.example/takeover/session/public-locator";
    },
    revokeForIntervention(id: string) { calls.push(`broker:revoke:${id}`); }
  } as unknown as TakeoverBroker;

  const provider = new SteelTakeoverHumanProvider(browser, broker);
  const grant = await provider.begin({ interventionId: "int-1", epoch: 5, principalBinding: "principal-a" });
  assert.equal(grant.locator, "https://handoff.example/takeover/session/public-locator");
  assert.doesNotMatch(grant.locator, /apiKey|steel-1/);
  assert.equal(grant.expiresAt, 123456789);
  assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(calls, ["browser:start", "broker:create:int-1:5:principal-a"]);

  await provider.revoke(grant.sessionId);
  assert.deepEqual(calls, [
    "browser:start",
    "broker:create:int-1:5:principal-a",
    "broker:revoke:int-1"
  ]);
});
