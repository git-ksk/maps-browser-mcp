import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRecommendedModeProbe,
  selectVerifiedRecommendedTravelMode,
  type RecommendedModeSnapshot
} from "../src/browser/recommended-mode.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";
import type { MapsAction } from "../src/types.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

const action: MapsAction = {
  kind: "directions",
  origin: "Tokyo Station",
  destination: "Yokohama Station",
  mode: "transit"
};
const freshUrl = "https://www.google.com/maps/dir/?api=1&origin=Tokyo+Station&destination=Yokohama+Station&travelmode=transit";
const snapshot: RecommendedModeSnapshot = {
  originValue: "Tokyo Station, 1 Chome Marunouchi, Chiyoda City, Tokyo",
  destinationValue: "Yokohama Station, 2 Chome Takashima, Nishi Ward, Yokohama"
};
const clicked = { ok: true, label: "Best", checked: false, clicked: true, ...snapshot };
const checked = { ok: true, label: "Best", checked: true, clicked: false, ...snapshot };

test("Recommended mode probe accepts only observed EN/JA labels and exact endpoint snapshot", () => {
  assert.deepEqual(parseRecommendedModeProbe(clicked), { snapshot, checked: false, clicked: true });
  assert.deepEqual(
    parseRecommendedModeProbe({ ...checked, label: "おすすめ" }, snapshot),
    { snapshot, checked: true, clicked: false }
  );
  assert.deepEqual(parseRecommendedModeProbe({ ok: false, reason: "pending" }), { state: "pending" });
  for (const reason of ["ambiguous_recommended", "ambiguous_origin", "ambiguous_destination"]) {
    assert.throws(() => parseRecommendedModeProbe({ ok: false, reason }), isRuntimeCode("UI_STATE_CHANGED"));
  }
  assert.throws(
    () => parseRecommendedModeProbe({ ...checked, destinationValue: "Osaka Station" }, snapshot),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseRecommendedModeProbe({ ...checked, label: "Transit" }, snapshot),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

type FakeInput = {
  action?: MapsAction;
  url?: string;
  evaluations?: unknown[];
  directionsErrors?: Map<number, BrowserRuntimeError>;
  mapsErrors?: Map<number, BrowserRuntimeError>;
  interventionAtMaps?: number;
};

function fakeRuntime(input: FakeInput = {}) {
  let directionsIndex = 0;
  let mapsIndex = 0;
  let evaluationIndex = 0;
  let invalidations = 0;
  let mutations = 0;
  let interventionActive = false;
  let viewState: "directions" | "blank" = "directions";
  let lastAction = input.action ?? action;
  let url = input.url ?? freshUrl;
  const evaluations = input.evaluations ?? [clicked, checked];
  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: evaluations[evaluationIndex++] } };
      }
    }
  };
  const runtime = {
    async assertDirectionsContext() {
      const current = directionsIndex++;
      const error = input.directionsErrors?.get(current);
      if (error) throw error;
    },
    getLastAction() { return lastAction; },
    async currentUrl() { return url; },
    async getClient() { return client; },
    async assertMapsSurface() {
      const current = mapsIndex++;
      if (input.interventionAtMaps === current) interventionActive = true;
      const error = input.mapsErrors?.get(current);
      if (error) throw error;
      return url;
    },
    markSemanticMutationWithoutReplayAction() {
      mutations += 1;
      lastAction = undefined as never;
    },
    getActiveIntervention() { return interventionActive ? { id: "human" } : undefined; },
    invalidateSemanticContext() {
      invalidations += 1;
      viewState = "blank";
      lastAction = undefined as never;
    },
    getViewState() { return viewState; }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    evaluations: () => evaluationIndex,
    invalidations: () => invalidations,
    mutations: () => mutations,
    lastAction: () => lastAction,
    viewState: () => viewState,
    setUrl(value: string) { url = value; }
  };
}

test("verified Recommended mode keeps the directions view, drops stale replay action, and advances semantic state once", async () => {
  const fake = fakeRuntime();
  const result = await selectVerifiedRecommendedTravelMode(fake.runtime, "Tokyo Station", "Yokohama Station");
  assert.deepEqual(result, {
    selected: true,
    origin: "Tokyo Station",
    destination: "Yokohama Station",
    source: "google_maps_recommended_travel_mode"
  });
  assert.equal(fake.evaluations(), 2);
  assert.equal(fake.mutations(), 1);
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.lastAction(), undefined);
  assert.equal(fake.viewState(), "directions");
});

test("Recommended mode identity mismatch and unsupported route constraints fail before UI action", async () => {
  const cases: Array<{ origin?: string; input?: FakeInput }> = [
    { origin: "Osaka Station" },
    { input: { action: { ...action, mode: "driving" } as MapsAction } },
    { input: { action: { ...action, waypoints: ["Shinagawa Station"] } as MapsAction } },
    { input: { action: { ...action, avoid: ["tolls"] } as MapsAction } },
    { input: { url: "https://www.google.com/maps/dir/Tokyo/Yokohama/data=!4m2!4m1!3e3" } }
  ];
  for (const item of cases) {
    const fake = fakeRuntime(item.input);
    await assert.rejects(
      () => selectVerifiedRecommendedTravelMode(fake.runtime, item.origin ?? "Tokyo Station", "Yokohama Station"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
    assert.equal(fake.evaluations(), 0);
    assert.equal(fake.mutations(), 0);
  }
});

test("Recommended mode treats malformed clicked success as a mutation and invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [{ ok: true, label: 42, checked: false, clicked: true, ...snapshot }]
  });
  await assert.rejects(
    () => selectVerifiedRecommendedTravelMode(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.mutations(), 0);
  assert.equal(fake.viewState(), "blank");
});

test("Recommended mode invalid postcondition after click invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [clicked, { ...checked, destinationValue: "Osaka Station" }]
  });
  await assert.rejects(
    () => selectVerifiedRecommendedTravelMode(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.mutations(), 0);
  assert.equal(fake.viewState(), "blank");
});

test("Recommended mode unexpected navigation after click invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [clicked],
    url: freshUrl,
    mapsErrors: new Map([[0, new BrowserRuntimeError("UI_STATE_CHANGED", "left Maps")]])
  });
  await assert.rejects(
    () => selectVerifiedRecommendedTravelMode(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.mutations(), 0);
});

test("Recommended mode stops at Human Intervention after click without replay or extra invalidation", async () => {
  const human = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  const fake = fakeRuntime({
    evaluations: [clicked],
    mapsErrors: new Map([[0, human]]),
    interventionAtMaps: 0
  });
  await assert.rejects(
    () => selectVerifiedRecommendedTravelMode(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.mutations(), 0);
  assert.equal(fake.evaluations(), 1);
});
