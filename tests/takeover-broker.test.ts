import assert from "node:assert/strict";
import test from "node:test";
import type { AuthPrincipal } from "../src/auth-provider.js";
import { TakeoverBroker, type TakeoverBrowserAdapter } from "../src/takeover-broker.js";

const PRINCIPAL_A: AuthPrincipal = { subject: "user-a", email: "a@example.test" };
const PRINCIPAL_B: AuthPrincipal = { subject: "user-b", email: "b@example.test" };

function fixture() {
  const calls: unknown[] = [];
  const browser: TakeoverBrowserAdapter = {
    async captureHumanTakeoverFrame(interventionId, epoch) {
      calls.push(["frame", interventionId, epoch]);
      return {
        data: Buffer.from("jpeg-bytes").toString("base64"),
        width: 390,
        height: 844,
        hostname: "accounts.google.com"
      };
    },
    async tapHumanTakeover(interventionId, epoch, x, y) {
      calls.push(["tap", interventionId, epoch, x, y]);
    },
    async scrollHumanTakeover(interventionId, epoch, deltaY) {
      calls.push(["scroll", interventionId, epoch, deltaY]);
    },
    async insertHumanTakeoverText(interventionId, epoch, text) {
      calls.push(["text", interventionId, epoch, text]);
    },
    async pressHumanTakeoverKey(interventionId, epoch, key) {
      calls.push(["key", interventionId, epoch, key]);
    }
  };
  const broker = new TakeoverBroker(browser, {
    enabled: true,
    publicBaseUrl: "https://takeover.example",
    ttlMs: 60_000
  });
  const link = broker.createLink({ id: "intervention-a", epoch: 7 }, PRINCIPAL_A);
  assert.ok(link);
  const url = new URL(link);
  const sessionId = url.pathname.split("/").at(-1);
  assert.ok(sessionId);
  return { broker, calls, url, sessionId };
}

async function bootstrap(
  broker: TakeoverBroker,
  sessionId: string,
  principal: AuthPrincipal = PRINCIPAL_A
): Promise<string> {
  const response = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: { "sec-fetch-site": "same-origin" }
  }), principal);
  assert.equal(response.status, 200);
  const body = await response.json() as { capability?: string };
  assert.ok(body.capability);
  return body.capability;
}

test("takeover link is a locator only and page is hardened", async () => {
  const { broker, url, sessionId } = fixture();
  assert.equal(url.search, "");
  assert.equal(url.hash, "");

  const response = await broker.handle(new Request(`http://localhost${url.pathname}`), PRINCIPAL_A);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.doesNotMatch(html, /Takeover [A-Za-z0-9_-]{32,}/);
  assert.match(html, /takeover\/api\/bootstrap/);

  const crossSiteBootstrap = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: { "sec-fetch-site": "cross-site" }
  }), PRINCIPAL_A);
  assert.equal(crossSiteBootstrap.status, 403);
});

test("different or missing principal cannot open or bootstrap another takeover", async () => {
  const { broker, url, sessionId } = fixture();
  const wrongPage = await broker.handle(new Request(`http://localhost${url.pathname}`), PRINCIPAL_B);
  assert.equal(wrongPage.status, 404);

  const wrongBootstrap = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: { "sec-fetch-site": "same-origin" }
  }), PRINCIPAL_B);
  assert.equal(wrongBootstrap.status, 404);

  const missing = await broker.handle(new Request(`http://localhost${url.pathname}`));
  assert.equal(missing.status, 404);
});

test("frame and bounded inputs require matching principal, capability and same-origin mutation", async () => {
  const { broker, calls, sessionId } = fixture();
  const capability = await bootstrap(broker, sessionId);
  const auth = { authorization: `Takeover ${capability}` };

  const denied = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`), PRINCIPAL_A);
  assert.equal(denied.status, 404);

  const wrongPrincipal = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, { headers: auth }), PRINCIPAL_B);
  assert.equal(wrongPrincipal.status, 404);

  const frame = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, { headers: auth }), PRINCIPAL_A);
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get("x-takeover-width"), "390");
  assert.equal(frame.headers.get("x-takeover-height"), "844");
  assert.equal(frame.headers.get("x-takeover-host"), "accounts.google.com");

  const wrongOrigin = await broker.handle(new Request(`http://localhost/takeover/api/input/${sessionId}`, {
    method: "POST",
    headers: { ...auth, origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ kind: "tap", x: 10, y: 20 })
  }), PRINCIPAL_A);
  assert.equal(wrongOrigin.status, 403);

  const accepted = await broker.handle(new Request(`http://localhost/takeover/api/input/${sessionId}`, {
    method: "POST",
    headers: { ...auth, origin: "https://takeover.example", "content-type": "application/json" },
    body: JSON.stringify({ kind: "tap", x: 10, y: 20 })
  }), PRINCIPAL_A);
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls.at(-1), ["tap", "intervention-a", 7, 10, 20]);
});

test("done revokes remote capability without pretending to approve the MCP action", async () => {
  const { broker, sessionId } = fixture();
  const capability = await bootstrap(broker, sessionId);
  const auth = { authorization: `Takeover ${capability}`, origin: "https://takeover.example" };
  const done = await broker.handle(new Request(`http://localhost/takeover/api/done/${sessionId}`, {
    method: "POST",
    headers: auth
  }), PRINCIPAL_A);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { done: true });

  const stale = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, {
    headers: { authorization: `Takeover ${capability}` }
  }), PRINCIPAL_A);
  assert.equal(stale.status, 404);
});
