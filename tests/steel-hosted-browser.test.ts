import assert from "node:assert/strict";
import test from "node:test";
import { SteelHostedBrowserSession } from "../src/browser/steel-hosted-browser.js";

interface FakeCall {
  url: string;
  method: string;
  apiKey: string | null;
  body?: unknown;
}

function fakeSteelFetch(session: Record<string, unknown>) {
  const calls: FakeCall[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    calls.push({
      url: url.toString(),
      method: init.method ?? "GET",
      apiKey: headers.get("steel-api-key"),
      ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {})
    });
    if (url.pathname === "/v1/sessions" && init.method === "POST") {
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (/^\/v1\/sessions\/[^/]+\/release$/.test(url.pathname) && init.method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(null, { status: 404 });
  };
  return { fetchImpl, calls };
}

test("Steel owner keeps one stateful browser session and exposes only its CDP endpoint internally", async () => {
  const fake = fakeSteelFetch({
    id: "session-1",
    createdAt: "2026-08-19T12:00:00.000Z",
    timeout: 1_800_000,
    status: "live",
    websocketUrl: "wss://connect.steel.dev?sessionId=session-1",
    sessionViewerUrl: "https://app.steel.dev/sessions/session-1?providerToken=ignored"
  });
  const browser = new SteelHostedBrowserSession({
    apiKey: "secret-api-key",
    profileId: "profile-1",
    timeoutMs: 1_800_000
  }, fake.fetchImpl);

  const endpoint = await browser.start();
  assert.equal(endpoint.kind, "browser_websocket");
  assert.match(endpoint.websocketUrl, /apiKey=secret-api-key/);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], {
    url: "https://api.steel.dev/v1/sessions",
    method: "POST",
    apiKey: "secret-api-key",
    body: {
      timeout: 1_800_000,
      solveCaptcha: false,
      profileId: "profile-1",
      persistProfile: true
    }
  });
  assert.deepEqual(browser.sessionInfo(), {
    sessionId: "session-1",
    expiresAt: Date.parse("2026-08-19T12:00:00.000Z") + 1_800_000
  });

  await browser.suspendForHuman();
  assert.deepEqual(await browser.start(), endpoint);
  assert.equal(fake.calls.length, 1);

  await browser.close();
  assert.deepEqual(fake.calls[1], {
    url: "https://api.steel.dev/v1/sessions/session-1/release",
    method: "POST",
    apiKey: "secret-api-key"
  });
});

test("Steel owner supports self-hosted loopback without an API key", async () => {
  const fake = fakeSteelFetch({
    id: "local-session",
    createdAt: "2026-08-19T12:00:00.000Z",
    timeout: 300_000,
    status: "live",
    websocketUrl: "ws://127.0.0.1:3000?sessionId=local-session"
  });
  const browser = new SteelHostedBrowserSession({
    baseUrl: "http://127.0.0.1:3000",
    timeoutMs: 300_000
  }, fake.fetchImpl);

  const endpoint = await browser.start();
  assert.deepEqual(endpoint, {
    kind: "browser_websocket",
    websocketUrl: "ws://127.0.0.1:3000/?sessionId=local-session"
  });
  assert.equal(fake.calls[0]?.apiKey, null);
  assert.equal(browser.sessionInfo().sessionId, "local-session");
});

test("Steel owner rejects unsafe CDP endpoints and releases the session", async () => {
  const fake = fakeSteelFetch({
    id: "session-2",
    createdAt: "2026-08-19T12:00:00.000Z",
    timeout: 1_800_000,
    status: "live",
    websocketUrl: "ws://remote.example/session-2"
  });
  const browser = new SteelHostedBrowserSession({ apiKey: "secret-api-key", timeoutMs: 1_800_000 }, fake.fetchImpl);

  await assert.rejects(browser.start(), /must use WSS except for loopback/);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1]?.url, "https://api.steel.dev/v1/sessions/session-2/release");
});

test("Steel API errors expose only HTTP status and never response bodies", async () => {
  const fetchImpl: typeof fetch = async () => new Response(
    JSON.stringify({ error: "provider leaked secret-api-key and session bearer" }),
    { status: 503, headers: { "content-type": "application/json" } }
  );
  const browser = new SteelHostedBrowserSession({ apiKey: "secret-api-key", timeoutMs: 1_800_000 }, fetchImpl);

  await assert.rejects(
    browser.start(),
    (error: unknown) => error instanceof Error
      && error.message === "Steel API request failed with HTTP 503"
      && !error.message.includes("secret-api-key")
  );
});
