import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine, PolicyError } from "../src/policy/policy-engine.js";

function policy(overrides: Partial<{
  interactiveAssist: boolean;
  maxActionsPerMinute: number;
  maxVisibleReadsPerHour: number;
}> = {}) {
  return new PolicyEngine({
    interactiveAssist: overrides.interactiveAssist ?? false,
    maxActionsPerMinute: overrides.maxActionsPerMinute ?? 10,
    maxVisibleReadsPerHour: overrides.maxVisibleReadsPerHour ?? 10
  });
}

test("allows single user-directed searches", () => {
  assert.doesNotThrow(() => policy().assertSearchQuery("横浜駅 周辺 カフェ"));
});

test("blocks blank and bulk-collection search wording", () => {
  assert.throws(
    () => policy().assertSearchQuery("   "),
    (error) => error instanceof PolicyError && error.code === "POLICY_BLOCKED"
  );
  assert.throws(
    () => policy().assertSearchQuery("東京のレストランを全件収集"),
    (error) => error instanceof PolicyError && error.code === "POLICY_BLOCKED"
  );
  assert.throws(
    () => policy().assertSearchQuery("collect 100 restaurants in Tokyo"),
    (error) => error instanceof PolicyError && error.code === "POLICY_BLOCKED"
  );
});

test("allows only the Google Maps web path", () => {
  assert.doesNotThrow(() => policy().assertMapUrl("https://www.google.com/maps/search/?api=1&query=test"));
  assert.throws(
    () => policy().assertMapUrl("https://example.com/maps"),
    (error) => error instanceof PolicyError && error.code === "NAVIGATION_BLOCKED"
  );
  assert.throws(
    () => policy().assertMapUrl("https://www.google.com/maps-evil"),
    (error) => error instanceof PolicyError && error.code === "NAVIGATION_BLOCKED"
  );
});

test("requires explicit opt-in for visible-state reading", () => {
  assert.throws(
    () => policy().assertInteractiveAssistEnabled(),
    (error) => error instanceof PolicyError && error.code === "INTERACTIVE_ASSIST_DISABLED"
  );
});

test("rate limits repeated actions", () => {
  const instance = policy({ interactiveAssist: true, maxActionsPerMinute: 1 });
  instance.consumeAction();
  assert.throws(
    () => instance.consumeAction(),
    (error) => error instanceof PolicyError && error.code === "RATE_LIMITED"
  );
});

test("independently limits visible-state reads", () => {
  const instance = policy({ interactiveAssist: true, maxVisibleReadsPerHour: 1 });
  instance.consumeVisibleRead();
  assert.throws(
    () => instance.consumeVisibleRead(),
    (error) => error instanceof PolicyError && error.code === "RATE_LIMITED"
  );
});
