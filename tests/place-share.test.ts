import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExpectedPlaceLabel,
  parsePlaceShareLinkProbe,
  parsePlaceShareOpenProbe,
  validateMapsShareUrl
} from "../src/browser/place-share.js";
import { BrowserRuntimeError } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("expected place identity is normalized but remains bounded", () => {
  assert.equal(normalizeExpectedPlaceLabel("  Tokyo   Station  "), "Tokyo Station");
  assert.throws(() => normalizeExpectedPlaceLabel("   "), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(() => normalizeExpectedPlaceLabel("x".repeat(241)), isRuntimeCode("UI_STATE_CHANGED"));
});

test("place share open probe revalidates the active place identity", () => {
  assert.deepEqual(
    parsePlaceShareOpenProbe({ ok: true, placeLabel: "Tokyo Station" }, "  tokyo   station "),
    { placeLabel: "Tokyo Station" }
  );
  assert.throws(
    () => parsePlaceShareOpenProbe({ ok: true, placeLabel: "Shibuya Station" }, "Tokyo Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parsePlaceShareOpenProbe({ ok: false, reason: "ambiguous_place" }, "Tokyo Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parsePlaceShareOpenProbe({ ok: false, reason: "ambiguous_share" }, "Tokyo Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parsePlaceShareOpenProbe({ ok: false, reason: "missing_share" }, "Tokyo Station"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
});

test("share URLs are restricted to HTTPS Google Maps share origins", () => {
  assert.equal(
    validateMapsShareUrl("https://maps.app.goo.gl/AbCdEf123"),
    "https://maps.app.goo.gl/AbCdEf123"
  );
  assert.equal(
    validateMapsShareUrl("https://www.google.com/maps/place/Tokyo+Station"),
    "https://www.google.com/maps/place/Tokyo+Station"
  );

  for (const unsafe of [
    "http://maps.app.goo.gl/AbCdEf123",
    "https://accounts.google.com/signin",
    "https://maps.app.goo.gl.evil.example/AbCdEf123",
    "javascript:alert(1)",
    `https://maps.app.goo.gl/${"x".repeat(2_100)}`
  ]) {
    assert.throws(() => validateMapsShareUrl(unsafe), isRuntimeCode("UI_STATE_CHANGED"));
  }
});

test("share link probe fails closed on ambiguous links", () => {
  assert.equal(
    parsePlaceShareLinkProbe({ ok: true, url: "https://maps.app.goo.gl/AbCdEf123" }),
    "https://maps.app.goo.gl/AbCdEf123"
  );
  assert.equal(parsePlaceShareLinkProbe({ ok: false, reason: "pending" }), undefined);
  assert.throws(
    () => parsePlaceShareLinkProbe({ ok: false, reason: "ambiguous" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});
