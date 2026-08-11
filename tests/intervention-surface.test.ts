import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGoogleInterventionSurface,
  isAllowedHumanTakeoverSurface
} from "../src/browser/intervention-surface.js";

function isAllowedMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.google.com" &&
      (url.pathname === "/maps" || url.pathname.startsWith("/maps/"));
  } catch {
    return false;
  }
}

test("explicit Google challenge surfaces are classified as access challenges", () => {
  assert.equal(
    classifyGoogleInterventionSurface("https://www.google.com/sorry/index?continue=x"),
    "access_challenge"
  );
  assert.equal(
    classifyGoogleInterventionSurface("https://recaptcha.google.com/recaptcha/api2/anchor"),
    "access_challenge"
  );
});

test("explicit sign-in and consent paths are allowed for human takeover", () => {
  assert.equal(
    classifyGoogleInterventionSurface("https://accounts.google.com/signin/v2/identifier"),
    "sign_in"
  );
  assert.equal(
    classifyGoogleInterventionSurface("https://accounts.google.com/challenge/totp"),
    "sign_in"
  );
  assert.equal(
    classifyGoogleInterventionSurface("https://consent.google.com/m"),
    "consent"
  );
});

test("lookalike hosts and unrelated paths are rejected", () => {
  const rejected = [
    "https://example.com/sorry/index",
    "https://recaptcha.example.com/recaptcha/api2/anchor",
    "https://recaptcha.google.com.evil.example/recaptcha/api2/anchor",
    "https://accounts.google.com.evil.example/signin/v2/identifier",
    "https://accounts.google.com/unrelated/path",
    "https://consent.google.com/unrelated/path",
    "http://www.google.com/sorry/index"
  ];

  for (const value of rejected) {
    assert.equal(classifyGoogleInterventionSurface(value), undefined, value);
    assert.equal(isAllowedHumanTakeoverSurface(value, isAllowedMapsUrl), false, value);
  }
});

test("normal HTTPS Google Maps surfaces remain allowed for human takeover", () => {
  assert.equal(
    isAllowedHumanTakeoverSurface("https://www.google.com/maps/search/Tokyo", isAllowedMapsUrl),
    true
  );
});
