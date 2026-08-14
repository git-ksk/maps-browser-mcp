import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNearbyQuery,
  parseNearbyInputProbe,
  parseNearbyOpenProbe,
  parseNearbyPostconditionProbe
} from "../src/browser/place-nearby.js";
import { BrowserRuntimeError } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("nearby query is normalized and bounded", () => {
  assert.equal(normalizeNearbyQuery("  coffee   shops  "), "coffee shops");
  assert.throws(() => normalizeNearbyQuery("   "), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(() => normalizeNearbyQuery("x".repeat(501)), isRuntimeCode("UI_STATE_CHANGED"));
});

test("nearby open probe revalidates active place identity", () => {
  assert.deepEqual(
    parseNearbyOpenProbe({ ok: true, placeLabel: "Tokyo Station" }, " tokyo  station "),
    { placeLabel: "Tokyo Station" }
  );

  for (const value of [
    { ok: true, placeLabel: "Shibuya Station" },
    { ok: false, reason: "changed" },
    { ok: false, reason: "ambiguous_place" },
    { ok: false, reason: "ambiguous_nearby" }
  ]) {
    assert.throws(
      () => parseNearbyOpenProbe(value, "Tokyo Station"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }

  assert.throws(
    () => parseNearbyOpenProbe({ ok: false, reason: "missing_nearby" }, "Tokyo Station"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
});

test("nearby input probe waits for a verified fallback and fails closed on ambiguity", () => {
  assert.deepEqual(
    parseNearbyInputProbe({ ok: true, inputLabel: "combobox" }),
    { inputLabel: "combobox" }
  );
  assert.equal(parseNearbyInputProbe({ ok: false, reason: "missing" }), undefined);
  assert.equal(parseNearbyInputProbe({ ok: false, reason: "fallback_not_ready" }), undefined);
  assert.throws(
    () => parseNearbyInputProbe({ ok: false, reason: "ambiguous" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseNearbyInputProbe({ ok: false, reason: "unexpected" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("nearby postcondition requires the exact requested query", () => {
  assert.equal(
    parseNearbyPostconditionProbe({ ok: true, query: "coffee shops" }, " Coffee   Shops "),
    true
  );
  assert.equal(parseNearbyPostconditionProbe({ ok: false, reason: "pending" }, "coffee"), false);
  assert.throws(
    () => parseNearbyPostconditionProbe({ ok: true, query: "restaurants" }, "coffee"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseNearbyPostconditionProbe({ ok: false, reason: "ambiguous" }, "coffee"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});
