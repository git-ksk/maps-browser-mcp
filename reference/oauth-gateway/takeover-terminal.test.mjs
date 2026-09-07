import assert from "node:assert/strict";
import test from "node:test";
import {
  responseForUnauthenticatedTopLevelProbe,
  unavailableTopLevelTakeoverPage
} from "./takeover-terminal.mjs";

function loginPage() {
  return new Response("operator-login", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

test("expired or unknown top-level takeover probes become one generic content-free terminal page", async () => {
  for (const status of [404, 410]) {
    let loginCalls = 0;
    const probe = new Response(JSON.stringify({ error: "private-core-detail-must-not-leak" }), {
      status,
      headers: { "content-type": "application/json", "x-private-detail": "must-not-leak" }
    });
    const response = responseForUnauthenticatedTopLevelProbe(probe, "GET", () => {
      loginCalls += 1;
      return loginPage();
    });
    assert.equal(loginCalls, 0);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.equal(response.headers.has("x-private-detail"), false);
    const body = await response.text();
    assert.match(body, /unavailable or has expired/i);
    assert.match(body, /Return to the requesting workflow/i);
    assert.doesNotMatch(body, /private-core-detail|404|410|session|principal|token|cookie/i);
  }
});

test("valid top-level probe preserves the existing operator login flow", async () => {
  let loginCalls = 0;
  const get = responseForUnauthenticatedTopLevelProbe(new Response(null, { status: 200 }), "GET", () => {
    loginCalls += 1;
    return loginPage();
  });
  assert.equal(loginCalls, 1);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), "operator-login");

  const head = responseForUnauthenticatedTopLevelProbe(new Response(null, { status: 200 }), "HEAD", () => {
    loginCalls += 1;
    return loginPage();
  });
  assert.equal(loginCalls, 2);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("top-level terminal HEAD is 200 and content-free", async () => {
  const response = unavailableTopLevelTakeoverPage("HEAD");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("infrastructure and auth probe failures keep their existing gateway response", () => {
  for (const status of [401, 403, 500, 502, 503]) {
    let loginCalls = 0;
    const probe = new Response(null, { status });
    const response = responseForUnauthenticatedTopLevelProbe(probe, "GET", () => {
      loginCalls += 1;
      return loginPage();
    });
    assert.equal(response, probe);
    assert.equal(loginCalls, 0);
  }
});
