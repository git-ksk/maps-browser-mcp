import assert from "node:assert/strict";
import test from "node:test";
import { classifyVisibleSemanticSignals } from "../src/browser/semantic-signals.js";

test("classifies explicit English route signals without parsing hidden structure", () => {
  assert.deepEqual(
    classifyVisibleSemanticSignals("route", "28 min · train · via Shinagawa · depart 10:30 · arrive 10:58"),
    ["duration", "departure", "arrival", "via", "transit"]
  );
});

test("classifies explicit Japanese route signals", () => {
  assert.deepEqual(
    classifyVisibleSemanticSignals("route", "35分 10:30 発 11:05 着 東京駅経由 乗換1回"),
    ["duration", "departure", "arrival", "via", "transit"]
  );
});

test("classifies explicit English place signals", () => {
  assert.deepEqual(
    classifyVisibleSemanticSignals("place", "4.6 stars · Open · 1.2 km · Address: Example St · Phone: 03-1234-5678"),
    ["rating", "open_status", "distance", "address", "phone"]
  );
});

test("classifies explicit Japanese place signals", () => {
  assert.deepEqual(
    classifyVisibleSemanticSignals("place", "★4.4 営業中 住所: 横浜市 電話: 045-000-0000"),
    ["rating", "open_status", "address", "phone"]
  );
});

test("does not guess semantics from ambiguous bare numbers or times", () => {
  assert.deepEqual(classifyVisibleSemanticSignals("route", "10:30 11:05 12345"), []);
  assert.deepEqual(classifyVisibleSemanticSignals("place", "4.8 12345 10:30"), []);
});
