import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExpectedSearchQuery,
  parseRatingAppliedChipProbe,
  parseRatingMenuProbe,
  parseRatingOptionActionProbe,
  parseRatingTriggerActionProbe,
  setVerifiedSearchRating
} from "../src/browser/search-rating-filter.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("search rating expected query is normalized and bounded", () => {
  assert.equal(normalizeExpectedSearchQuery("  restaurants   near Shibuya  "), "restaurants near Shibuya");
  assert.throws(() => normalizeExpectedSearchQuery("   "), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(() => normalizeExpectedSearchQuery("x".repeat(501)), isRuntimeCode("UI_STATE_CHANGED"));
});

test("rating trigger accepts observed base/chip labels and rejects stale or ambiguous state", () => {
  assert.deepEqual(
    parseRatingTriggerActionProbe(
      { ok: true, queryValue: "restaurants near Shibuya", triggerLabel: "評価", alreadyApplied: false },
      "Restaurants Near Shibuya",
      "4.0"
    ),
    { state: "ready", triggerLabel: "評価", alreadyApplied: false }
  );
  assert.deepEqual(
    parseRatingTriggerActionProbe(
      { ok: true, queryValue: "restaurants near Shibuya", triggerLabel: "4.0+", alreadyApplied: true },
      "restaurants near Shibuya",
      "4.0"
    ),
    { state: "ready", triggerLabel: "4.0+", alreadyApplied: true }
  );
  assert.throws(
    () => parseRatingTriggerActionProbe(
      { ok: true, queryValue: "q", triggerLabel: "Rating", alreadyApplied: true },
      "q",
      "4.0"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  for (const reason of ["changed_query", "ambiguous_query", "ambiguous_filter", "ambiguous_menu", "menu_open", "changed_filter"]) {
    assert.throws(
      () => parseRatingTriggerActionProbe({ ok: false, reason }, "q", "4.0"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
  assert.throws(
    () => parseRatingTriggerActionProbe({ ok: false, reason: "missing" }, "q", "4.0"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
});

test("rating menu probe requires exact option identity and at most one checked radio", () => {
  assert.deepEqual(
    parseRatingMenuProbe(
      {
        ok: true,
        queryValue: "restaurants near Shibuya",
        menuLabel: "評価",
        optionLabel: "4.0",
        requestedChecked: false,
        checkedCount: 0
      },
      "restaurants near Shibuya",
      "4.0"
    ),
    { state: "ready", requestedChecked: false, checkedCount: 0 }
  );
  assert.throws(
    () => parseRatingMenuProbe(
      {
        ok: true,
        queryValue: "q",
        menuLabel: "Rating",
        optionLabel: "4.0",
        requestedChecked: true,
        checkedCount: 2
      },
      "q",
      "4.0"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseRatingMenuProbe({ ok: false, reason: "missing_option" }, "q", "4.0"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
});

test("rating option action and applied-chip postcondition fail closed on stale or ambiguous state", () => {
  assert.deepEqual(
    parseRatingOptionActionProbe(
      { ok: true, queryValue: "q", menuLabel: "Rating", optionLabel: "4.0" },
      "q",
      "4.0"
    ),
    { state: "ready" }
  );
  assert.equal(
    parseRatingAppliedChipProbe(
      { ok: true, queryValue: "q", triggerLabel: "4.0+", menuCount: 0 },
      "q",
      "4.0"
    ),
    true
  );
  assert.equal(
    parseRatingAppliedChipProbe(
      { ok: true, queryValue: "q", triggerLabel: "Rating", menuCount: 0 },
      "q",
      "4.0"
    ),
    false
  );
  assert.throws(
    () => parseRatingAppliedChipProbe(
      { ok: true, queryValue: "q", triggerLabel: "4.0+", menuCount: 2 },
      "q",
      "4.0"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

type FakeInput = {
  evaluations: unknown[];
  assertErrors?: Map<number, BrowserRuntimeError>;
  interventionAfterAssert?: number;
};

function fakeRuntime(input: FakeInput) {
  let evaluationIndex = 0;
  let assertIndex = 0;
  let mutationCount = 0;
  let invalidationCount = 0;
  let epoch = 21;
  let interventionActive = false;
  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: input.evaluations[evaluationIndex++] } };
      }
    }
  };
  const runtime = {
    async assertReadableView() {
      const current = assertIndex++;
      if (input.interventionAfterAssert === current) interventionActive = true;
      const error = input.assertErrors?.get(current);
      if (error) throw error;
      return "search" as const;
    },
    getViewState() { return "search" as const; },
    async getClient() { return client; },
    markSemanticMutation() { mutationCount += 1; epoch += 1; },
    invalidateSemanticContext() { invalidationCount += 1; epoch += 1; },
    getActiveIntervention() { return interventionActive ? { id: "human" } : undefined; },
    getResourceEpoch() { return epoch; }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    evaluations: () => evaluationIndex,
    mutationCount: () => mutationCount,
    invalidationCount: () => invalidationCount,
    epoch: () => epoch
  };
}

const triggerBase = { ok: true, queryValue: "restaurants near Shibuya", triggerLabel: "評価", alreadyApplied: false };
const triggerApplied = { ok: true, queryValue: "restaurants near Shibuya", triggerLabel: "4.0+", alreadyApplied: true };
const menuUnselected = {
  ok: true,
  queryValue: "restaurants near Shibuya",
  menuLabel: "評価",
  optionLabel: "4.0",
  requestedChecked: false,
  checkedCount: 0
};
const optionReady = {
  ok: true,
  queryValue: "restaurants near Shibuya",
  menuLabel: "評価",
  optionLabel: "4.0"
};
const chipApplied = { ok: true, queryValue: "restaurants near Shibuya", triggerLabel: "4.0+", menuCount: 0 };

test("verified search rating applies exact option, verifies selected chip, and advances epoch once", async () => {
  const fake = fakeRuntime({ evaluations: [triggerBase, menuUnselected, optionReady, chipApplied] });
  const before = fake.epoch();
  const result = await setVerifiedSearchRating(fake.runtime, "restaurants near Shibuya", "4.0");
  assert.deepEqual(result, {
    applied: true,
    query: "restaurants near Shibuya",
    rating: "4.0",
    alreadyApplied: false,
    source: "google_maps_search_rating_filter"
  });
  assert.equal(fake.evaluations(), 4);
  assert.equal(fake.mutationCount(), 1);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before + 1);
});

test("already-applied rating chip is idempotent without opening the menu or advancing epoch", async () => {
  const fake = fakeRuntime({ evaluations: [triggerApplied] });
  const before = fake.epoch();
  const result = await setVerifiedSearchRating(fake.runtime, "restaurants near Shibuya", "4.0");
  assert.equal(result.alreadyApplied, true);
  assert.equal(fake.evaluations(), 1);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before);
});

test("search rating invalidates semantic context after post-click unexpected navigation", async () => {
  // assert indexes: initial, trigger, menu, option, then selected-chip verification.
  const fake = fakeRuntime({
    evaluations: [triggerBase, menuUnselected, optionReady],
    assertErrors: new Map([[4, new BrowserRuntimeError("UI_STATE_CHANGED", "left search view")]])
  });
  await assert.rejects(
    () => setVerifiedSearchRating(fake.runtime, "restaurants near Shibuya", "4.0"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("search rating invalidates semantic context when selected-chip postcondition is invalid", async () => {
  const fake = fakeRuntime({
    evaluations: [
      triggerBase,
      menuUnselected,
      optionReady,
      { ok: false, reason: "ambiguous_filter" }
    ]
  });
  await assert.rejects(
    () => setVerifiedSearchRating(fake.runtime, "restaurants near Shibuya", "4.0"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("search rating stops at Human Intervention without automatic semantic replay", async () => {
  const humanError = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  const fake = fakeRuntime({
    evaluations: [triggerBase, menuUnselected, optionReady],
    assertErrors: new Map([[4, humanError]]),
    interventionAfterAssert: 4
  });
  await assert.rejects(
    () => setVerifiedSearchRating(fake.runtime, "restaurants near Shibuya", "4.0"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
});
