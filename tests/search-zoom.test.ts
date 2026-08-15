import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSearchZoomActionProbe,
  parseSearchZoomLevelFromPath,
  parseSearchZoomPostconditionProbe,
  zoomVerifiedSearch
} from "../src/browser/search-zoom.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("search zoom level parser accepts bounded Maps search viewport paths only", () => {
  assert.equal(
    parseSearchZoomLevelFromPath("/maps/search/restaurants/@35.6587936,139.7016674,17z/data=!3m1!4b1"),
    17
  );
  assert.equal(
    parseSearchZoomLevelFromPath("/maps/search/restaurants/@40.7,-73.9,16.5z"),
    16.5
  );
  assert.equal(parseSearchZoomLevelFromPath("/maps/place/Test/@35,139,17z"), undefined);
  assert.equal(parseSearchZoomLevelFromPath("/maps/search/Test"), undefined);
  assert.equal(parseSearchZoomLevelFromPath("/maps/search/Test/@35,139,22z"), undefined);
});

test("search zoom action accepts exact observed EN/JA controls and settled integer zoom", () => {
  assert.deepEqual(
    parseSearchZoomActionProbe(
      {
        ok: true,
        queryValue: "restaurants near Shibuya Station",
        controlLabel: "ズームイン",
        beforeZoom: 17,
        path: "/maps/search/restaurants/@35.6,139.7,17z/data=!3m1!4b1"
      },
      "Restaurants Near Shibuya Station",
      "in"
    ),
    { state: "ready", beforeZoom: 17, controlLabel: "ズームイン" }
  );
  assert.deepEqual(
    parseSearchZoomActionProbe(
      {
        ok: true,
        queryValue: "restaurants near Times Square",
        controlLabel: "Zoom out",
        beforeZoom: 16,
        path: "/maps/search/restaurants/@40.7,-73.9,16z"
      },
      "restaurants near Times Square",
      "out"
    ),
    { state: "ready", beforeZoom: 16, controlLabel: "Zoom out" }
  );
  assert.deepEqual(
    parseSearchZoomActionProbe({ ok: false, reason: "pending" }, "q", "in"),
    { state: "pending" }
  );
});

test("search zoom action fails closed on identity mismatch, missing, duplicate, stale, and disabled targets", () => {
  assert.throws(
    () => parseSearchZoomActionProbe(
      {
        ok: true,
        queryValue: "other query",
        controlLabel: "Zoom in",
        beforeZoom: 17,
        path: "/maps/search/q/@35,139,17z"
      },
      "expected query",
      "in"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSearchZoomActionProbe(
      {
        ok: true,
        queryValue: "q",
        controlLabel: "Zoom out",
        beforeZoom: 17,
        path: "/maps/search/q/@35,139,17z"
      },
      "q",
      "in"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSearchZoomActionProbe({ ok: false, reason: "missing_zoom" }, "q", "in"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  assert.throws(
    () => parseSearchZoomActionProbe({ ok: false, reason: "disabled" }, "q", "out"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  for (const reason of ["changed_query", "ambiguous_query", "ambiguous_zoom", "changed_zoom"]) {
    assert.throws(
      () => parseSearchZoomActionProbe({ ok: false, reason }, "q", "in"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
});

test("search zoom postcondition accepts exactly one level in the requested direction and tolerates animation progress", () => {
  const base = {
    queryValue: "restaurants near Shibuya",
    controlLabel: "ズームイン"
  };
  assert.equal(
    parseSearchZoomPostconditionProbe(
      { ok: true, ...base, currentZoom: 18, path: "/maps/search/q/@35.6,139.7,18z" },
      "restaurants near Shibuya",
      "in",
      17
    ),
    "ready"
  );
  assert.equal(
    parseSearchZoomPostconditionProbe(
      { ok: true, ...base, currentZoom: 17.4, path: "/maps/search/q/@35.6,139.7,17.4z" },
      "restaurants near Shibuya",
      "in",
      17
    ),
    "pending"
  );
  assert.equal(
    parseSearchZoomPostconditionProbe(
      { ok: true, ...base, currentZoom: 17, path: "/maps/search/q/@35.6,139.7,17z" },
      "restaurants near Shibuya",
      "in",
      17
    ),
    "pending"
  );
});

test("search zoom postcondition rejects opposite, overshoot, wrong identity, and ambiguous controls", () => {
  assert.throws(
    () => parseSearchZoomPostconditionProbe(
      {
        ok: true,
        queryValue: "q",
        controlLabel: "Zoom in",
        currentZoom: 16,
        path: "/maps/search/q/@35,139,16z"
      },
      "q",
      "in",
      17
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSearchZoomPostconditionProbe(
      {
        ok: true,
        queryValue: "q",
        controlLabel: "Zoom in",
        currentZoom: 19,
        path: "/maps/search/q/@35,139,19z"
      },
      "q",
      "in",
      17
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSearchZoomPostconditionProbe(
      {
        ok: true,
        queryValue: "other",
        controlLabel: "Zoom in",
        currentZoom: 18,
        path: "/maps/search/q/@35,139,18z"
      },
      "q",
      "in",
      17
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSearchZoomPostconditionProbe({ ok: false, reason: "ambiguous_zoom" }, "q", "in", 17),
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
  let epoch = 30;
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

const actionIn17 = {
  ok: true,
  queryValue: "restaurants near Shibuya",
  controlLabel: "ズームイン",
  beforeZoom: 17,
  path: "/maps/search/restaurants/@35.6,139.7,17z"
};
const postIn18 = {
  ok: true,
  queryValue: "restaurants near Shibuya",
  controlLabel: "ズームイン",
  currentZoom: 18,
  path: "/maps/search/restaurants/@35.6,139.71,18z"
};

test("verified search zoom succeeds, preserves search context, and advances resource epoch once", async () => {
  const fake = fakeRuntime({ evaluations: [actionIn17, postIn18] });
  const before = fake.epoch();
  const result = await zoomVerifiedSearch(fake.runtime, "restaurants near Shibuya", "in");
  assert.deepEqual(result, {
    zoomed: true,
    query: "restaurants near Shibuya",
    direction: "in",
    beforeZoom: 17,
    afterZoom: 18,
    source: "google_maps_search_zoom"
  });
  assert.equal(fake.evaluations(), 2);
  assert.equal(fake.mutationCount(), 1);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before + 1);
});

test("search zoom identity mismatch, missing target, duplicate target, and disabled limit do not mutate state", async () => {
  for (const probe of [
    { ok: false, reason: "changed_query" },
    { ok: false, reason: "missing_zoom" },
    { ok: false, reason: "ambiguous_zoom" },
    { ok: false, reason: "disabled" }
  ]) {
    const fake = fakeRuntime({ evaluations: [probe] });
    await assert.rejects(() => zoomVerifiedSearch(fake.runtime, "q", "in"));
    assert.equal(fake.mutationCount(), 0);
    assert.equal(fake.invalidationCount(), 0);
  }
});

test("search zoom invalidates semantic context on unexpected navigation after click", async () => {
  // assert indexes: initial, action probe, then postcondition.
  const fake = fakeRuntime({
    evaluations: [actionIn17],
    assertErrors: new Map([[2, new BrowserRuntimeError("UI_STATE_CHANGED", "left search view")]])
  });
  await assert.rejects(
    () => zoomVerifiedSearch(fake.runtime, "restaurants near Shibuya", "in"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("search zoom invalidates semantic context on invalid postcondition after click", async () => {
  const fake = fakeRuntime({
    evaluations: [
      actionIn17,
      {
        ok: true,
        queryValue: "restaurants near Shibuya",
        controlLabel: "ズームイン",
        currentZoom: 16,
        path: "/maps/search/restaurants/@35.6,139.7,16z"
      }
    ]
  });
  await assert.rejects(
    () => zoomVerifiedSearch(fake.runtime, "restaurants near Shibuya", "in"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("search zoom treats malformed ok action result as post-click and invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [
      {
        ok: true,
        queryValue: "restaurants near Shibuya",
        controlLabel: "Zoom out",
        beforeZoom: 17,
        path: "/maps/search/restaurants/@35.6,139.7,17z"
      }
    ]
  });
  await assert.rejects(
    () => zoomVerifiedSearch(fake.runtime, "restaurants near Shibuya", "in"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("search zoom stops at Human Intervention after click without automatic semantic replay", async () => {
  const humanError = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  const fake = fakeRuntime({
    evaluations: [actionIn17],
    assertErrors: new Map([[2, humanError]]),
    interventionAfterAssert: 2
  });
  await assert.rejects(
    () => zoomVerifiedSearch(fake.runtime, "restaurants near Shibuya", "in"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
});
