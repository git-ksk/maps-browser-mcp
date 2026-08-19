import assert from "node:assert/strict";
import test from "node:test";
import { SteelHostedBrowserSession, SteelLiveViewHumanProvider } from "../src/browser/steel-hosted-browser.js";

function installFakeClient(browser: SteelHostedBrowserSession, session: Record<string, unknown>) {
  const calls = { create: [] as unknown[], release: [] as string[] };
  const fake = {
    sessions: {
      async create(input: unknown) {
        calls.create.push(input);
        return session;
      },
      async release(id: string) {
        calls.release.push(id);
        return { success: true };
      }
    }
  };
  (browser as unknown as { client: unknown }).client = fake;
  return calls;
}

test("Steel owner keeps one stateful session across automation detach and Human Live View", async () => {
  const browser = new SteelHostedBrowserSession({
    apiKey: "secret-api-key",
    profileId: "profile-1",
    timeoutMs: 1_800_000
  });
  const calls = installFakeClient(browser, {
    id: "session-1",
    createdAt: "2026-08-19T12:00:00.000Z",
    timeout: 1_800_000,
    status: "live",
    websocketUrl: "wss://connect.steel.dev?sessionId=session-1",
    sessionViewerUrl: "https://app.steel.dev/sessions/session-1"
  });

  const endpoint = await browser.start();
  assert.equal(endpoint.kind, "browser_websocket");
  assert.match(endpoint.websocketUrl, /apiKey=secret-api-key/);
  assert.deepEqual(calls.create, [{
    timeout: 1_800_000,
    solveCaptcha: false,
    profileId: "profile-1",
    persistProfile: true
  }]);

  const provider = new SteelLiveViewHumanProvider(browser);
  const grant = await provider.begin({ interventionId: "i-1", epoch: 4, principalBinding: "principal" });
  assert.equal(grant.sessionId, "steel:session-1");
  assert.equal(grant.locator, "https://app.steel.dev/sessions/session-1");
  assert.equal(calls.create.length, 1);

  await browser.suspendForHuman();
  await provider.revoke(grant.sessionId);
  assert.deepEqual(calls.release, []);
  assert.deepEqual(await browser.start(), endpoint);
  assert.equal(calls.create.length, 1);

  await browser.close();
  assert.deepEqual(calls.release, ["session-1"]);
});

test("Steel owner rejects secret-bearing Human viewer locators and releases the session", async () => {
  const browser = new SteelHostedBrowserSession({ apiKey: "secret-api-key", timeoutMs: 1_800_000 });
  const calls = installFakeClient(browser, {
    id: "session-2",
    createdAt: "2026-08-19T12:00:00.000Z",
    timeout: 1_800_000,
    status: "live",
    websocketUrl: "wss://connect.steel.dev?sessionId=session-2",
    sessionViewerUrl: "https://viewer.example/session-2?token=must-not-reach-mcp"
  });

  await assert.rejects(browser.start(), /must not contain credentials, query, or fragment/);
  assert.deepEqual(calls.release, ["session-2"]);
});
