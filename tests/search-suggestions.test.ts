import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeExpectedSuggestionLabel,
  normalizeSuggestionQuery,
  parseSuggestionClickProbe,
  parseSuggestionInputProbe,
  parseSuggestionListProbe,
  parseSuggestionPostconditionProbe,
  readVerifiedSearchSuggestions,
  selectVerifiedSearchSuggestion
} from "../src/browser/search-suggestions.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";
import { MapsUrlCompiler } from "../src/maps/url-compiler.js";
import type { MapsAction } from "../src/types.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

const query = "Tokyo Station";
const labels = [
  "Transit — Tokyo Station — 1 Chome-9 Marunouchi, Chiyoda City, Tokyo",
  "Transit — Tokyo Station — 1 Chome Marunouchi, Chiyoda City, Tokyo",
  "The Tokyo Station Hotel — 1 Chome-9-1 Marunouchi, Chiyoda City, Tokyo"
];
const listOk = { ok: true, query, labels, truncated: false };

test("search suggestion query/label bounds and input probe fail closed", () => {
  assert.equal(normalizeSuggestionQuery(` ${query} `), query);
  assert.equal(normalizeExpectedSuggestionLabel(` ${labels[0]} `), labels[0]);
  assert.throws(() => normalizeSuggestionQuery(""), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(() => normalizeExpectedSuggestionLabel(""), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(parseSuggestionInputProbe({ ok: true, query }, query), "ready");
  assert.deepEqual(parseSuggestionInputProbe({ ok: false, reason: "pending" }, query), { state: "pending" });
  assert.throws(
    () => parseSuggestionInputProbe({ ok: false, reason: "ambiguous_input" }, query),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("search suggestion list parser returns bounded unique identities only", () => {
  const parsed = parseSuggestionListProbe(listOk, query);
  assert.ok(!("state" in parsed));
  assert.deepEqual(parsed.items, labels.map((label, index) => ({ index, label })));
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.untrustedExternalText, true);
  assert.throws(
    () => parseSuggestionListProbe({ ...listOk, labels: [labels[0], labels[0]] }, query),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSuggestionListProbe({ ok: false, reason: "ambiguous_grid" }, query),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseSuggestionListProbe({ ...listOk, query: "Osaka" }, query),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("search suggestion click and postcondition parsers bind expected identity and settled view", () => {
  assert.deepEqual(parseSuggestionClickProbe({ ok: true, label: labels[0] }, labels[0]), { selectedLabel: labels[0] });
  assert.throws(
    () => parseSuggestionClickProbe({ ok: true, label: labels[1] }, labels[0]),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.deepEqual(
    parseSuggestionPostconditionProbe({
      ok: true,
      view: "place",
      query: "Tokyo Station",
      url: "https://www.google.com/maps/place/Tokyo+Station/"
    }),
    {
      view: "place",
      query: "Tokyo Station",
      url: "https://www.google.com/maps/place/Tokyo+Station/"
    }
  );
  assert.deepEqual(parseSuggestionPostconditionProbe({ ok: false, reason: "pending" }), { state: "pending" });
  assert.deepEqual(
    parseSuggestionPostconditionProbe({ ok: false, reason: "grid_still_open" }),
    { state: "pending" }
  );
  assert.throws(
    () => parseSuggestionPostconditionProbe({ ok: false, reason: "ambiguous_input" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

type FakeInput = {
  evaluations?: unknown[];
  mapsErrors?: Map<number, BrowserRuntimeError>;
  interventionAtMaps?: number;
  activeSuggestions?: boolean;
  lastAction?: MapsAction;
  view?: "blank" | "suggestions" | "search" | "place";
};

function fakeRuntime(input: FakeInput = {}) {
  const evaluations = input.evaluations ?? [
    { ok: true, label: labels[0] },
    {
      ok: true,
      view: "place",
      query: "Tokyo Station",
      url: "https://www.google.com/maps/place/Tokyo+Station/"
    }
  ];
  let evaluationIndex = 0;
  let mapsIndex = 0;
  let navigations = 0;
  let invalidations = 0;
  let adoptions = 0;
  let inserted = "";
  let interventionActive = false;
  let lastAction: MapsAction | undefined = input.lastAction ?? (
    input.activeSuggestions === false ? undefined : { kind: "suggestions", query }
  );
  let view = input.view ?? (input.activeSuggestions === false ? "blank" : "suggestions");
  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: evaluations[evaluationIndex++] } };
      }
    },
    Input: {
      async insertText({ text }: { text: string }) { inserted += text; }
    }
  };
  const runtime = {
    async navigate(_url: string, action: MapsAction) {
      navigations += 1;
      lastAction = action;
      view = "suggestions";
      return { url: "https://www.google.com/maps" };
    },
    async getClient() { return client; },
    async assertMapsSurface() {
      const current = mapsIndex++;
      if (input.interventionAtMaps === current) interventionActive = true;
      const error = input.mapsErrors?.get(current);
      if (error) throw error;
      return evaluationIndex >= 1
        ? "https://www.google.com/maps/place/Tokyo+Station/"
        : "https://www.google.com/maps";
    },
    getLastAction() { return lastAction; },
    getViewState() { return view; },
    adoptSearchSuggestionResult(adoptedQuery: string, adoptedView: "search" | "place") {
      adoptions += 1;
      lastAction = { kind: "search", query: adoptedQuery };
      view = adoptedView;
    },
    getActiveIntervention() { return interventionActive ? { id: "human" } : undefined; },
    invalidateSemanticContext() {
      invalidations += 1;
      lastAction = undefined;
      view = "blank";
    }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    evaluations: () => evaluationIndex,
    navigations: () => navigations,
    invalidations: () => invalidations,
    adoptions: () => adoptions,
    inserted: () => inserted,
    lastAction: () => lastAction,
    view: () => view
  };
}

test("verified suggestion read uses a fresh bounded Maps suggestion surface", async () => {
  const fake = fakeRuntime({ activeSuggestions: false, evaluations: [{ ok: true, query: "" }, listOk] });
  const result = await readVerifiedSearchSuggestions(fake.runtime, new MapsUrlCompiler(), query);
  assert.deepEqual(result.items, labels.map((label, index) => ({ index, label })));
  assert.equal(fake.navigations(), 1);
  assert.equal(fake.inserted(), query);
  assert.equal(fake.evaluations(), 2);
  assert.deepEqual(fake.lastAction(), { kind: "suggestions", query });
  assert.equal(fake.view(), "suggestions");
});

test("verified suggestion selection guards the active query/label and adopts place state", async () => {
  const fake = fakeRuntime();
  const result = await selectVerifiedSearchSuggestion(fake.runtime, query, 0, labels[0]);
  assert.deepEqual(result, {
    selected: labels[0],
    query: "Tokyo Station",
    view: "place",
    url: "https://www.google.com/maps/place/Tokyo+Station/",
    source: "google_maps_search_suggestion"
  });
  assert.equal(fake.navigations(), 0);
  assert.equal(fake.adoptions(), 1);
  assert.equal(fake.invalidations(), 0);
  assert.deepEqual(fake.lastAction(), { kind: "search", query });
  assert.equal(fake.view(), "place");
});

test("suggestion selection rejects stale view/action/query before evaluating any row", async () => {
  const cases: FakeInput[] = [
    { activeSuggestions: false },
    { view: "search", lastAction: { kind: "suggestions", query } },
    { view: "suggestions", lastAction: { kind: "suggestions", query: "Osaka Station" } },
    { view: "suggestions", lastAction: { kind: "search", query } }
  ];

  for (const input of cases) {
    const fake = fakeRuntime(input);
    await assert.rejects(
      () => selectVerifiedSearchSuggestion(fake.runtime, query, 0, labels[0]),
      isRuntimeCode("UI_STATE_CHANGED")
    );
    assert.equal(fake.evaluations(), 0);
    assert.equal(fake.adoptions(), 0);
    assert.equal(fake.invalidations(), 0);
  }
});

test("changed or reordered suggestion identity fails closed before row activation", async () => {
  const fake = fakeRuntime({
    evaluations: [{ ok: false, reason: "changed", label: labels[1] }]
  });
  await assert.rejects(
    () => selectVerifiedSearchSuggestion(fake.runtime, query, 0, labels[0]),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.adoptions(), 0);
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.evaluations(), 1);
});

test("malformed successful suggestion click is treated as post-click and invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [{ ok: true, label: 42 }]
  });
  await assert.rejects(
    () => selectVerifiedSearchSuggestion(fake.runtime, query, 0, labels[0]),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.adoptions(), 0);
  assert.equal(fake.view(), "blank");
});

test("invalid postcondition after suggestion click invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [{ ok: true, label: labels[0] }, { ok: false, reason: "ambiguous_input" }]
  });
  await assert.rejects(
    () => selectVerifiedSearchSuggestion(fake.runtime, query, 0, labels[0]),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.adoptions(), 0);
  assert.equal(fake.view(), "blank");
});

test("Human Intervention after suggestion click stops without automatic replay or extra invalidation", async () => {
  const human = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  const fake = fakeRuntime({
    evaluations: [{ ok: true, label: labels[0] }],
    mapsErrors: new Map([[2, human]]),
    interventionAtMaps: 2
  });
  await assert.rejects(
    () => selectVerifiedSearchSuggestion(fake.runtime, query, 0, labels[0]),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.adoptions(), 0);
  assert.equal(fake.evaluations(), 1);
});
