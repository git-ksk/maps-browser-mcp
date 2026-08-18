import assert from "node:assert/strict";
import test from "node:test";
import { CuaTakeoverHumanProvider } from "../src/browser/cua-takeover-human-provider.js";
import type { CuaHumanTakeoverAdapter } from "../src/browser/cua-human-takeover-adapter.js";
import type { SystemBrowserCredentialSession } from "../src/browser/system-browser-credential-session.js";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";

test("Cua Human provider starts normal Chrome, binds exact intervention and returns broker locator", async () => {
  const calls: string[] = [];
  const browser = {
    async start() { calls.push("browser:start"); },
    getPid() { return 4321; },
    async close() { calls.push("browser:close"); }
  } as unknown as SystemBrowserCredentialSession;
  const adapter = {
    async begin(id: string, epoch: number, pid: number) { calls.push(`adapter:begin:${id}:${epoch}:${pid}`); },
    async end(id: string, epoch: number) { calls.push(`adapter:end:${id}:${epoch}`); },
    async close() { calls.push("adapter:close"); }
  } as unknown as CuaHumanTakeoverAdapter;
  const broker = {
    createLink(ref: { id: string; epoch: number }, principal: string) {
      calls.push(`broker:create:${ref.id}:${ref.epoch}:${principal}`);
      return "https://takeover.example/session/abc";
    },
    revokeForIntervention(id: string) { calls.push(`broker:revoke:${id}`); }
  } as unknown as TakeoverBroker;

  const provider = new CuaTakeoverHumanProvider(browser, adapter, broker);
  const grant = await provider.begin({ interventionId: "int-1", epoch: 5, principalBinding: "principal-a" });
  assert.equal(grant.locator, "https://takeover.example/session/abc");
  assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(calls.slice(0, 3), [
    "browser:start",
    "adapter:begin:int-1:5:4321",
    "broker:create:int-1:5:principal-a"
  ]);

  await provider.revoke(grant.sessionId);
  assert.deepEqual(calls.slice(-3), ["broker:revoke:int-1", "adapter:end:int-1:5", "browser:close"]);
});
