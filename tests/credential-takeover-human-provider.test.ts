import assert from "node:assert/strict";
import test from "node:test";
import type { CredentialTakeoverBoundary } from "../src/browser/credential-takeover-boundary.js";
import { CredentialTakeoverHumanProvider } from "../src/browser/credential-takeover-human-provider.js";
import type { SystemBrowserCredentialSession } from "../src/browser/system-browser-credential-session.js";

function fakeBrowser(calls: string[], windowId?: number): SystemBrowserCredentialSession {
  return {
    async start() { calls.push("browser:start"); },
    async getTakeoverTarget() {
      return { processId: 4242, ...(windowId === undefined ? {} : { windowId }) };
    },
    async close() { calls.push("browser:close"); }
  } as unknown as SystemBrowserCredentialSession;
}

function fakeTakeover(calls: string[], startError?: Error): CredentialTakeoverBoundary {
  return {
    start(request) {
      calls.push(
        `takeover:start:${request.interventionId}:${request.epoch}:${request.principalBinding}`
        + `:${request.targetProcessId}:${request.targetWindowId ?? "none"}`
      );
      if (startError) throw startError;
      return "https://handoff.example/takeover/session/public-locator";
    },
    async revoke(interventionId) {
      calls.push(`takeover:revoke:${interventionId}`);
    }
  };
}

for (const kind of ["thin-takeover", "webrtc-takeover"] as const) {
  test(`${kind} opens normal Chrome before issuing the Handoff locator and closes it after revoke`, async () => {
    const calls: string[] = [];
    const provider = new CredentialTakeoverHumanProvider(kind, fakeBrowser(calls), fakeTakeover(calls));
    const grant = await provider.begin({ interventionId: "int-1", epoch: 5, principalBinding: "principal-a" });

    assert.equal(provider.kind, kind);
    assert.equal(grant.locator, "https://handoff.example/takeover/session/public-locator");
    assert.doesNotMatch(grant.locator, /apiKey|steel|rootKey|sdp|ice/i);
    assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(calls, [
      "browser:start",
      "takeover:start:int-1:5:principal-a:4242:none"
    ]);

    await provider.revoke(grant.sessionId);
    assert.deepEqual(calls, [
      "browser:start",
      "takeover:start:int-1:5:principal-a:4242:none",
      "takeover:revoke:int-1",
      "browser:close"
    ]);
  });
}

test("credential takeover closes normal Chrome if Handoff locator creation fails", async () => {
  const calls: string[] = [];
  const provider = new CredentialTakeoverHumanProvider(
    "webrtc-takeover",
    fakeBrowser(calls),
    fakeTakeover(calls, new Error("takeover unavailable"))
  );

  await assert.rejects(
    provider.begin({ interventionId: "int-2", epoch: 6, principalBinding: "principal-b" }),
    /takeover unavailable/
  );
  assert.deepEqual(calls, [
    "browser:start",
    "takeover:start:int-2:6:principal-b:4242:none",
    "takeover:revoke:int-2",
    "browser:close"
  ]);
});


test("credential takeover fails closed when normal Chrome PID is unavailable", async () => {
  const calls: string[] = [];
  const browser = {
    async start() { calls.push("browser:start"); },
    async getTakeoverTarget() {
      throw new Error("Credential-safe normal Chrome process is unavailable");
    },
    async close() { calls.push("browser:close"); }
  } as unknown as SystemBrowserCredentialSession;
  const provider = new CredentialTakeoverHumanProvider("webrtc-takeover", browser, fakeTakeover(calls));
  await assert.rejects(
    provider.begin({ interventionId: "int-3", epoch: 7, principalBinding: "principal-c" }),
    /normal Chrome process is unavailable/
  );
  assert.deepEqual(calls, ["browser:start", "takeover:revoke:int-3", "browser:close"]);
});

test("credential takeover forwards a bounded exact window when the normal browser resolves one", async () => {
  const calls: string[] = [];
  const provider = new CredentialTakeoverHumanProvider(
    "webrtc-takeover",
    fakeBrowser(calls, 9001),
    fakeTakeover(calls)
  );
  const grant = await provider.begin({ interventionId: "int-window", epoch: 9, principalBinding: "principal-w" });
  assert.match(grant.sessionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(calls, [
    "browser:start",
    "takeover:start:int-window:9:principal-w:4242:9001"
  ]);
  await provider.revoke(grant.sessionId);
});
