import assert from "node:assert/strict";
import test from "node:test";
import { classifyGoogleInterventionSurface } from "../src/browser/intervention-surface.js";

const allowed = [
  ["https://www.google.com/sorry/index?continue=x", "access_challenge"],
  ["https://recaptcha.google.com/recaptcha/api2/anchor", "access_challenge"],
  ["https://accounts.google.com/signin/v2/identifier", "sign_in"],
  ["https://accounts.google.com/v3/signin/identifier", "sign_in"],
  ["https://accounts.google.com/ServiceLogin", "sign_in"],
  ["https://consent.google.com/m", "consent"]
] as const;

for (const [url, expected] of allowed) {
  test(`allows intended intervention surface: ${url}`, () => {
    assert.equal(classifyGoogleInterventionSurface(url), expected);
  });
}

test("rejects lookalike hosts, unexpected paths and non-HTTPS intervention surfaces", () => {
  const rejected = [
    "https://evil.example/sorry/index",
    "https://recaptcha.evil.example/recaptcha/api2/anchor",
    "https://accounts.google.com.example/signin/v2/identifier",
    "https://accounts.google.com/not-a-signin-flow",
    "https://consent.google.com/not-consent",
    "http://accounts.google.com/signin/v2/identifier"
  ];
  for (const url of rejected) {
    assert.equal(classifyGoogleInterventionSurface(url), undefined, url);
  }
});
