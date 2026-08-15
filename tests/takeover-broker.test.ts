import assert from "node:assert/strict";
import test from "node:test";
import type { AuthPrincipal } from "../src/auth-provider.js";
import { principalBinding } from "../src/request-principal.js";
import { TakeoverBroker, type TakeoverBrowserAdapter } from "mcp-execution-handoff/browser-takeover";

const PRINCIPAL_A: AuthPrincipal = { subject: "user-a", email: "a@example.test" };
const PRINCIPAL_B: AuthPrincipal = { subject: "user-b", email: "b@example.test" };
const CLIENT_A = "client-binding-a-1234567890";
const CLIENT_B = "client-binding-b-1234567890";

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
  const link = broker.createLink({ id: "intervention-a", epoch: 7 }, principalBinding(PRINCIPAL_A));
  assert.ok(link);
  const url = new URL(link);
  const sessionId = url.pathname.split("/").at(-1);
  assert.ok(sessionId);
  return { broker, calls, url, sessionId };
}

async function bootstrap(
  broker: TakeoverBroker,
  sessionId: string,
  principal: AuthPrincipal = PRINCIPAL_A,
  clientBinding: string = CLIENT_A
): Promise<string> {
  const response = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      "x-takeover-client": clientBinding
    }
  }), principalBinding(principal));
  assert.equal(response.status, 200);
  const body = await response.json() as { capability?: string };
  assert.ok(body.capability);
  return body.capability;
}

test("takeover link is locator-only and the external client stays nonce-bound and memory-only", async () => {
  const { broker, url, sessionId } = fixture();
  assert.equal(url.search, "");
  assert.equal(url.hash, "");

  const response = await broker.handle(new Request(`http://localhost${url.pathname}`), principalBinding(PRINCIPAL_A));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  const nonce = /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];
  assert.ok(nonce);
  assert.doesNotMatch(csp, /script-src 'self'/);

  const html = await response.text();
  assert.doesNotMatch(html, /Takeover [A-Za-z0-9_-]{32,}/);
  assert.match(
    html,
    new RegExp(`<script nonce="${nonce}" src="\\/takeover\\/client\\.js" defer><\\/script>`)
  );
  assert.doesNotMatch(html, /sessionStorage|localStorage/);
  assert.doesNotMatch(html, /Maps human takeover|return to MCP/);

  const scriptResponse = await broker.handle(new Request(`http://localhost/takeover/client.js`), principalBinding(PRINCIPAL_A));
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get("cache-control") ?? "", /no-store/);
  assert.match(scriptResponse.headers.get("content-type") ?? "", /^text\/javascript/);
  const script = await scriptResponse.text();
  assert.match(script, /takeover\/api\/bootstrap/);
  assert.match(script, /crypto\.getRandomValues/);
  assert.match(script, /const clientBinding=randomClientBinding\(\)/);
  assert.match(script, /x-takeover-client/);
  assert.doesNotMatch(script, /sessionStorage|localStorage/);

  const scriptHead = await broker.handle(new Request(`http://localhost/takeover/client.js`, {
    method: "HEAD"
  }), principalBinding(PRINCIPAL_A));
  assert.equal(scriptHead.status, 200);
  assert.equal(await scriptHead.text(), "");

  const scriptPost = await broker.handle(new Request(`http://localhost/takeover/client.js`, {
    method: "POST"
  }), principalBinding(PRINCIPAL_A));
  assert.equal(scriptPost.status, 405);

  const scriptWithoutPrincipal = await broker.handle(new Request(`http://localhost/takeover/client.js`));
  assert.equal(scriptWithoutPrincipal.status, 404);

  const crossSiteBootstrap = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: {
      "sec-fetch-site": "cross-site",
      "x-takeover-client": CLIENT_A
    }
  }), principalBinding(PRINCIPAL_A));
  assert.equal(crossSiteBootstrap.status, 403);
});

test("different or missing principal cannot open or bootstrap another takeover", async () => {
  const { broker, url, sessionId } = fixture();
  const wrongPage = await broker.handle(new Request(`http://localhost${url.pathname}`), principalBinding(PRINCIPAL_B));
  assert.equal(wrongPage.status, 404);

  const wrongBootstrap = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      "x-takeover-client": CLIENT_A
    }
  }), principalBinding(PRINCIPAL_B));
  assert.equal(wrongBootstrap.status, 404);

  const missing = await broker.handle(new Request(`http://localhost${url.pathname}`));
  assert.equal(missing.status, 404);
});

test("same principal cannot claim one takeover from two remote clients", async () => {
  const { broker, sessionId } = fixture();
  const capability = await bootstrap(broker, sessionId, PRINCIPAL_A, CLIENT_A);

  const retryBySameClient = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      "x-takeover-client": CLIENT_A
    }
  }), principalBinding(PRINCIPAL_A));
  assert.equal(retryBySameClient.status, 200);
  const retried = await retryBySameClient.json() as { capability?: string };
  assert.equal(retried.capability, capability);

  const secondClient = await broker.handle(new Request(`http://localhost/takeover/api/bootstrap/${sessionId}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      "x-takeover-client": CLIENT_B
    }
  }), principalBinding(PRINCIPAL_A));
  assert.equal(secondClient.status, 404);
});

test("frame and bounded inputs require matching principal, client lease, capability and origin", async () => {
  const { broker, calls, sessionId } = fixture();
  const capability = await bootstrap(broker, sessionId);
  const auth = {
    authorization: `Takeover ${capability}`,
    "x-takeover-client": CLIENT_A
  };

  const denied = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, {
    headers: { "x-takeover-client": CLIENT_A }
  }), principalBinding(PRINCIPAL_A));
  assert.equal(denied.status, 404);

  const wrongPrincipal = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, { headers: auth }), principalBinding(PRINCIPAL_B));
  assert.equal(wrongPrincipal.status, 404);

  const wrongClient = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, {
    headers: {
      authorization: `Takeover ${capability}`,
      "x-takeover-client": CLIENT_B
    }
  }), principalBinding(PRINCIPAL_A));
  assert.equal(wrongClient.status, 404);

  const frame = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, { headers: auth }), principalBinding(PRINCIPAL_A));
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get("x-takeover-width"), "390");
  assert.equal(frame.headers.get("x-takeover-height"), "844");
  assert.equal(frame.headers.get("x-takeover-host"), "accounts.google.com");

  const wrongOrigin = await broker.handle(new Request(`http://localhost/takeover/api/input/${sessionId}`, {
    method: "POST",
    headers: { ...auth, origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ kind: "tap", x: 10, y: 20 })
  }), principalBinding(PRINCIPAL_A));
  assert.equal(wrongOrigin.status, 403);

  const accepted = await broker.handle(new Request(`http://localhost/takeover/api/input/${sessionId}`, {
    method: "POST",
    headers: { ...auth, origin: "https://takeover.example", "content-type": "application/json" },
    body: JSON.stringify({ kind: "tap", x: 10, y: 20 })
  }), principalBinding(PRINCIPAL_A));
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls.at(-1), ["tap", "intervention-a", 7, 10, 20]);
});

test("done revokes remote capability and client lease without approving the MCP action", async () => {
  const { broker, sessionId } = fixture();
  const capability = await bootstrap(broker, sessionId);
  const auth = {
    authorization: `Takeover ${capability}`,
    "x-takeover-client": CLIENT_A,
    origin: "https://takeover.example"
  };
  const done = await broker.handle(new Request(`http://localhost/takeover/api/done/${sessionId}`, {
    method: "POST",
    headers: auth
  }), principalBinding(PRINCIPAL_A));
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { done: true });

  const stale = await broker.handle(new Request(`http://localhost/takeover/api/frame/${sessionId}`, {
    headers: {
      authorization: `Takeover ${capability}`,
      "x-takeover-client": CLIENT_A
    }
  }), principalBinding(PRINCIPAL_A));
  assert.equal(stale.status, 404);
});