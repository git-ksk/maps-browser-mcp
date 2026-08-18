import assert from "node:assert/strict";
import test from "node:test";
import { SystemBrowserHumanProvider } from "../src/browser/system-browser-human-provider.js";
import type { SystemBrowserCredentialSession } from "../src/browser/system-browser-credential-session.js";

test("system-browser provider delegates browser lifecycle and exposes only the configured operator locator", async () => {
  let starts = 0;
  let closes = 0;
  const browser = {
    async start() { starts += 1; },
    async close() { closes += 1; }
  } as unknown as SystemBrowserCredentialSession;
  const provider = new SystemBrowserHumanProvider(browser, "https://remote.example.test/access");

  const grant = await provider.begin({
    interventionId: "intervention-1",
    epoch: 2,
    principalBinding: "principal-a"
  });

  assert.equal(starts, 1);
  assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
  assert.equal(grant.locator, "https://remote.example.test/access");
  assert.deepEqual(Object.keys(grant).sort(), ["locator", "sessionId"]);

  await provider.revoke(grant.sessionId);
  assert.equal(closes, 1);
});
