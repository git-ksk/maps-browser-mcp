import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine, PolicyError } from "../src/policy/policy-engine.js";

test("allows single user-directed searches", () => {
  const policy = new PolicyEngine({ interactiveAssist: false, maxActionsPerMinute: 10 });
  assert.doesNotThrow(() => policy.assertSearchQuery("横浜駅 周辺 カフェ"));
});

test("blocks bulk collection wording", () => {
  const policy = new PolicyEngine({ interactiveAssist: false, maxActionsPerMinute: 10 });
  assert.throws(
    () => policy.assertSearchQuery("東京のレストランを全件収集"),
    (error) => error instanceof PolicyError && error.code === "POLICY_BLOCKED"
  );
});

test("blocks navigation outside Google Maps", () => {
  const policy = new PolicyEngine({ interactiveAssist: false, maxActionsPerMinute: 10 });
  assert.throws(
    () => policy.assertMapUrl("https://example.com/maps"),
    (error) => error instanceof PolicyError && error.code === "NAVIGATION_BLOCKED"
  );
});

test("requires explicit opt-in for visible-state reading", () => {
  const policy = new PolicyEngine({ interactiveAssist: false, maxActionsPerMinute: 10 });
  assert.throws(
    () => policy.assertInteractiveAssistEnabled(),
    (error) => error instanceof PolicyError && error.code === "INTERACTIVE_ASSIST_DISABLED"
  );
});

test("rate limits repeated actions", () => {
  const policy = new PolicyEngine({ interactiveAssist: true, maxActionsPerMinute: 1 });
  policy.consumeAction();
  assert.throws(
    () => policy.consumeAction(),
    (error) => error instanceof PolicyError && error.code === "RATE_LIMITED"
  );
});
