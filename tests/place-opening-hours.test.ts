import assert from "node:assert/strict";
import test from "node:test";
import {
  expandVerifiedOpeningHours,
  isObservedCollapsedOpeningHoursLabel,
  isObservedExpandedOpeningHoursLabel,
  parseOpeningHoursActionProbe,
  parseOpeningHoursPostconditionProbe,
  placeUrlIdentity
} from "../src/browser/place-opening-hours.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("opening-hours labels are restricted to bounded live-observed EN/JA shapes", () => {
  for (const label of [
    "Closed · Opens 10:30 AM",
    "Open · Closes 9 PM",
    "Open 24 hours",
    "営業時間外 · 営業開始: 11:00 ·詳しい営業時間を見る",
    "営業中 · 営業終了: 19:30"
  ]) {
    assert.equal(isObservedCollapsedOpeningHoursLabel(label), true, label);
  }
  for (const label of ["Closed", "Open now", "営業中"]) {
    assert.equal(isObservedExpandedOpeningHoursLabel(label), true, label);
  }
  assert.equal(isObservedCollapsedOpeningHoursLabel("Hours"), false);
  assert.equal(isObservedCollapsedOpeningHoursLabel("Saturday 9-5"), false);
  assert.equal(isObservedExpandedOpeningHoursLabel("営業時間外"), false);
});

test("opening-hours action probe revalidates identity and observed control shape", () => {
  assert.deepEqual(
    parseOpeningHoursActionProbe(
      { ok: true, placeLabel: "787 coffee", controlLabel: "Open · Closes 9 PM", alreadyExpanded: false },
      "787 coffee"
    ),
    { placeLabel: "787 coffee", controlLabel: "Open · Closes 9 PM", alreadyExpanded: false }
  );
  assert.deepEqual(
    parseOpeningHoursActionProbe(
      { ok: true, placeLabel: "Bird & Branch", controlLabel: "営業中", alreadyExpanded: true },
      "Bird & Branch"
    ),
    { placeLabel: "Bird & Branch", controlLabel: "営業中", alreadyExpanded: true }
  );
  assert.throws(
    () => parseOpeningHoursActionProbe(
      { ok: true, placeLabel: "Other", controlLabel: "Open · Closes 9 PM", alreadyExpanded: false },
      "787 coffee"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseOpeningHoursActionProbe(
      { ok: true, placeLabel: "787 coffee", controlLabel: "Hours", alreadyExpanded: false },
      "787 coffee"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("opening-hours action fails closed on missing, duplicate, and stale targets", () => {
  assert.throws(
    () => parseOpeningHoursActionProbe({ ok: false, reason: "missing_hours" }, "787 coffee"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  for (const reason of ["changed", "ambiguous_place", "ambiguous_hours"]) {
    assert.throws(
      () => parseOpeningHoursActionProbe({ ok: false, reason }, "787 coffee"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
});

test("opening-hours postcondition accepts only verified inline/detail states", () => {
  assert.equal(parseOpeningHoursPostconditionProbe({ ok: true, mode: "inline" }), "inline");
  assert.equal(parseOpeningHoursPostconditionProbe({ ok: true, mode: "detail" }), "detail");
  assert.equal(parseOpeningHoursPostconditionProbe({ ok: false, reason: "pending" }), undefined);
  assert.throws(
    () => parseOpeningHoursPostconditionProbe({ ok: false, reason: "ambiguous" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseOpeningHoursPostconditionProbe({ ok: true, mode: "other" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("opening-hours place URL identity ignores opaque Maps data changes but not place changes", () => {
  const a = "https://www.google.com/maps/place/787+coffee/@40.7,-73.9,16z/data=!4m10?hl=en";
  const b = "https://www.google.com/maps/place/787+coffee/@40.7,-73.9,16z/data=!4m11?hl=en";
  const other = "https://www.google.com/maps/place/Other/@40.7,-73.9,16z/data=!4m10?hl=en";
  assert.equal(placeUrlIdentity(a), placeUrlIdentity(b));
  assert.notEqual(placeUrlIdentity(a), placeUrlIdentity(other));
  assert.throws(() => placeUrlIdentity("https://accounts.google.com/signin"), isRuntimeCode("UI_STATE_CHANGED"));
});

function fakeRuntime(input: {
  action: unknown;
  post?: unknown[];
  urls?: string[];
  assertReadableError?: BrowserRuntimeError;
  assertMapsError?: BrowserRuntimeError;
}) {
  const defaultUrl = "https://www.google.com/maps/place/787+coffee/@40.7,-73.9,16z/data=!4m10";
  const urls = [...(input.urls ?? [defaultUrl, defaultUrl])];
  const posts = [...(input.post ?? [])];
  let evaluateCount = 0;
  let mutationCount = 0;
  let invalidationCount = 0;
  let epoch = 12;
  const client = {
    Runtime: {
      async evaluate() {
        evaluateCount += 1;
        return { result: { value: evaluateCount === 1 ? input.action : posts.shift() } };
      }
    }
  };
  const runtime = {
    async assertReadableView() {
      if (input.assertReadableError) throw input.assertReadableError;
      return "place" as const;
    },
    getViewState() { return "place" as const; },
    async currentUrl() { return urls.shift() ?? defaultUrl; },
    async assertMapsSurface() {
      if (input.assertMapsError) throw input.assertMapsError;
      return urls.shift() ?? defaultUrl;
    },
    async getClient() { return client; },
    markSemanticMutation() { mutationCount += 1; epoch += 1; },
    invalidateSemanticContext() { invalidationCount += 1; epoch += 1; },
    getActiveIntervention() { return undefined; },
    getResourceEpoch() { return epoch; }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    mutationCount: () => mutationCount,
    invalidationCount: () => invalidationCount,
    evaluationCount: () => evaluateCount,
    epoch: () => epoch
  };
}

const collapsedAction = {
  ok: true,
  placeLabel: "787 coffee",
  controlLabel: "Open · Closes 9 PM",
  alreadyExpanded: false
};

test("inline opening-hours expansion retains place state and advances epoch once", async () => {
  const fake = fakeRuntime({ action: collapsedAction, post: [{ ok: true, mode: "inline" }] });
  const before = fake.epoch();
  const result = await expandVerifiedOpeningHours(fake.runtime, "787 coffee");
  assert.deepEqual(result, {
    expanded: true,
    placeLabel: "787 coffee",
    alreadyExpanded: false,
    placeStateRetained: true,
    source: "google_maps_opening_hours"
  });
  assert.equal(fake.mutationCount(), 1);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before + 1);
});

test("detail opening-hours expansion invalidates stale place state", async () => {
  const fake = fakeRuntime({ action: collapsedAction, post: [{ ok: true, mode: "detail" }] });
  const before = fake.epoch();
  const result = await expandVerifiedOpeningHours(fake.runtime, "787 coffee");
  assert.equal(result.placeStateRetained, false);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
  assert.equal(fake.epoch(), before + 1);
});

test("already-expanded opening hours are idempotent", async () => {
  const fake = fakeRuntime({
    action: { ok: true, placeLabel: "787 coffee", controlLabel: "Open now", alreadyExpanded: true }
  });
  const before = fake.epoch();
  const result = await expandVerifiedOpeningHours(fake.runtime, "787 coffee");
  assert.equal(result.alreadyExpanded, true);
  assert.equal(result.placeStateRetained, true);
  assert.equal(fake.evaluationCount(), 1);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before);
});

test("opening-hours mutation invalidates semantic state on stale place or invalid postcondition", async () => {
  const stale = fakeRuntime({
    action: collapsedAction,
    urls: [
      "https://www.google.com/maps/place/787+coffee/@40.7,-73.9,16z/data=!4m10",
      "https://www.google.com/maps/place/Other/@40.7,-73.9,16z/data=!4m10"
    ]
  });
  await assert.rejects(() => expandVerifiedOpeningHours(stale.runtime, "787 coffee"), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(stale.invalidationCount(), 1);

  const ambiguous = fakeRuntime({ action: collapsedAction, post: [{ ok: false, reason: "ambiguous" }] });
  await assert.rejects(() => expandVerifiedOpeningHours(ambiguous.runtime, "787 coffee"), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(ambiguous.invalidationCount(), 1);
});

test("opening-hours operation stops at Human Intervention before mutation", async () => {
  const human = fakeRuntime({
    action: collapsedAction,
    assertReadableError: new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge")
  });
  await assert.rejects(() => expandVerifiedOpeningHours(human.runtime, "787 coffee"), isRuntimeCode("HUMAN_INTERVENTION_REQUIRED"));
  assert.equal(human.evaluationCount(), 0);
  assert.equal(human.mutationCount(), 0);
  assert.equal(human.invalidationCount(), 0);
});
