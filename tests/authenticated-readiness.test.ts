import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHENTICATED_READINESS_EXPRESSION,
  parseAuthenticatedReadiness
} from "../src/browser/authenticated-readiness.js";

test("classifies identity-free signed-in readiness only from coarse Maps controls", () => {
  assert.equal(parseAuthenticatedReadiness({
    mapsSurface: true,
    hasSignInLink: false,
    hasAccountHref: true,
    hasAccountAria: true
  }), "signed_in");
});

test("classifies signed-out readiness from a sign-in surface without an account control", () => {
  assert.equal(parseAuthenticatedReadiness({
    mapsSurface: true,
    hasSignInLink: true,
    hasAccountHref: false,
    hasAccountAria: false
  }), "signed_out");
});

test("fails to unknown for contradictory, incomplete, or non-Maps probes", () => {
  assert.equal(parseAuthenticatedReadiness({ mapsSurface: true }), "unknown");
  assert.equal(parseAuthenticatedReadiness({
    mapsSurface: true,
    hasSignInLink: true,
    hasAccountHref: true,
    hasAccountAria: false
  }), "unknown");
  assert.equal(parseAuthenticatedReadiness({
    mapsSurface: false,
    hasSignInLink: false,
    hasAccountHref: true,
    hasAccountAria: true
  }), "unknown");
});

test("probe source does not read or return raw account identity fields", () => {
  assert.doesNotMatch(AUTHENTICATED_READINESS_EXPRESSION, /innerText|textContent\s*[,}]|email|profile photo|account name/i);
  assert.doesNotMatch(AUTHENTICATED_READINESS_EXPRESSION, /cookie|localStorage|sessionStorage|indexedDB/i);
});

test("post-Human readiness tolerates transient signed_out until signed_in stabilizes", async () => {
  const { waitForAuthenticatedReadinessAfterHuman } = await import("../src/browser/authenticated-readiness.js");
  const values = ["signed_out", "unknown", "signed_in"] as const;
  let index = 0;
  let now = 0;
  const result = await waitForAuthenticatedReadinessAfterHuman(async () => values[Math.min(index++, values.length - 1)]!, {
    timeoutMs: 1_000,
    pollMs: 25,
    now: () => now,
    wait: async (ms) => { now += ms; }
  });
  assert.equal(result, "signed_in");
  assert.equal(index, 3);
});

test("post-Human readiness remains fail-closed when signed_out persists through the bounded settle", async () => {
  const { waitForAuthenticatedReadinessAfterHuman } = await import("../src/browser/authenticated-readiness.js");
  let now = 0;
  let reads = 0;
  const result = await waitForAuthenticatedReadinessAfterHuman(async () => {
    reads += 1;
    return "signed_out" as const;
  }, {
    timeoutMs: 50,
    pollMs: 25,
    now: () => now,
    wait: async (ms) => { now += ms; }
  });
  assert.equal(result, "signed_out");
  assert.ok(reads >= 3);
});
