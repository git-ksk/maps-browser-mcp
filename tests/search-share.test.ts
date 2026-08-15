import assert from "node:assert/strict";
import test from "node:test";
import {
  getVerifiedSearchShareLink,
  normalizeExpectedSearchQuery,
  parseSearchShareCloseProbe,
  parseSearchShareLinkProbe,
  parseSearchShareOpenProbe
} from "../src/browser/search-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";
import type { MapsAction } from "../src/types.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

const query = "coffee near Tokyo Station";
const action: MapsAction = { kind: "search", query };
const openOk = { ok: true, query, label: "Share" };
const linkOk = {
  ok: true,
  url: "https://maps.app.goo.gl/AbCdEf123",
  tabLabel: "Send a link",
  tabSelected: true
};
const closeOk = { ok: true, label: "Close" };

test("search share query and open probe are bounded and identity-bound", () => {
  assert.equal(normalizeExpectedSearchQuery(`  ${query}  `), query);
  assert.throws(() => normalizeExpectedSearchQuery(""), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(parseSearchShareOpenProbe(openOk, query), "ready");
  assert.equal(parseSearchShareOpenProbe({ ...openOk, label: "共有" }, query), "ready");
  assert.deepEqual(parseSearchShareOpenProbe({ ok: false, reason: "pending" }, query), { state: "pending" });
  for (const reason of ["changed_query", "ambiguous_query", "ambiguous_share"]) {
    assert.throws(
      () => parseSearchShareOpenProbe({ ok: false, reason }, query),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
  assert.throws(
    () => parseSearchShareOpenProbe({ ...openOk, query: "restaurants" }, query),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("search share link probe requires selected observed Send-link tab and one safe Maps URL", () => {
  assert.equal(parseSearchShareLinkProbe(linkOk), "https://maps.app.goo.gl/AbCdEf123");
  assert.equal(
    parseSearchShareLinkProbe({ ...linkOk, tabLabel: "リンクを送信する" }),
    "https://maps.app.goo.gl/AbCdEf123"
  );
  assert.equal(parseSearchShareLinkProbe({ ok: false, reason: "pending" }), undefined);
  for (const reason of ["ambiguous_dialog", "ambiguous_tab", "wrong_tab", "ambiguous_link", "changed_query"]) {
    assert.throws(() => parseSearchShareLinkProbe({ ok: false, reason }), isRuntimeCode("UI_STATE_CHANGED"));
  }
  assert.throws(() => parseSearchShareLinkProbe({ ...linkOk, tabSelected: false }), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(
    () => parseSearchShareLinkProbe({ ...linkOk, url: "https://evil.example/share" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("search share close probe accepts exact Close semantics and rejects ambiguity", () => {
  assert.equal(parseSearchShareCloseProbe(closeOk), "ready");
  assert.equal(parseSearchShareCloseProbe({ ok: true, label: "閉じる" }), "ready");
  assert.equal(parseSearchShareCloseProbe({ ok: false, reason: "closed" }), "ready");
  assert.deepEqual(parseSearchShareCloseProbe({ ok: false, reason: "pending" }), { state: "pending" });
  assert.throws(
    () => parseSearchShareCloseProbe({ ok: false, reason: "ambiguous_dialog" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

type FakeInput = {
  evaluations?: unknown[];
  action?: MapsAction;
  viewState?: "search" | "place" | "blank";
  readableErrors?: Map<number, BrowserRuntimeError>;
  interventionAtRead?: number;
};

function fakeRuntime(input: FakeInput = {}) {
  const evaluations = input.evaluations ?? [openOk, linkOk, closeOk, { count: 0 }];
  let evaluationIndex = 0;
  let readableIndex = 0;
  let invalidations = 0;
  let interventionActive = false;
  let viewState = input.viewState ?? "search";
  let lastAction = input.action ?? action;
  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: evaluations[evaluationIndex++] } };
      }
    }
  };
  const runtime = {
    async assertReadableView() {
      const current = readableIndex++;
      if (input.interventionAtRead === current) interventionActive = true;
      const error = input.readableErrors?.get(current);
      if (error) throw error;
      return viewState;
    },
    getViewState() { return viewState; },
    getLastAction() { return lastAction; },
    async getClient() { return client; },
    getActiveIntervention() { return interventionActive ? { id: "human" } : undefined; },
    invalidateSemanticContext() {
      invalidations += 1;
      viewState = "blank";
      lastAction = undefined as never;
    }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    evaluations: () => evaluationIndex,
    invalidations: () => invalidations,
    viewState: () => viewState,
    lastAction: () => lastAction
  };
}

test("verified search share returns visible Maps link, closes dialog, and preserves search state", async () => {
  const fake = fakeRuntime();
  const result = await getVerifiedSearchShareLink(fake.runtime, query);
  assert.deepEqual(result, {
    query,
    url: "https://maps.app.goo.gl/AbCdEf123",
    source: "google_maps_search_share_dialog"
  });
  assert.equal(fake.evaluations(), 4);
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.viewState(), "search");
  assert.deepEqual(fake.lastAction(), action);
});

test("search share expected identity and active-view mismatch fail before UI action", async () => {
  const cases: FakeInput[] = [
    { action: { kind: "search", query: "restaurants" } },
    { viewState: "place" },
    { action: { kind: "directions", origin: "A", destination: "B", mode: "transit" } }
  ];
  for (const input of cases) {
    const fake = fakeRuntime(input);
    await assert.rejects(() => getVerifiedSearchShareLink(fake.runtime, query), isRuntimeCode("UI_STATE_CHANGED"));
    assert.equal(fake.evaluations(), 0);
    assert.equal(fake.invalidations(), 0);
  }
});

test("search share invalid postcondition closes dialog and preserves search when close succeeds", async () => {
  const fake = fakeRuntime({ evaluations: [openOk, { ok: false, reason: "ambiguous_link" }, closeOk, { count: 0 }] });
  await assert.rejects(() => getVerifiedSearchShareLink(fake.runtime, query), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(fake.evaluations(), 4);
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.viewState(), "search");
});

test("search share invalidates semantic context if an opened dialog cannot be closed safely", async () => {
  const fake = fakeRuntime({
    evaluations: [openOk, linkOk, { ok: false, reason: "ambiguous_close" }, { ok: false, reason: "ambiguous_close" }]
  });
  await assert.rejects(() => getVerifiedSearchShareLink(fake.runtime, query), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.viewState(), "blank");
});

test("search share propagates Human Intervention after opening without automatic cleanup or replay", async () => {
  const human = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  const fake = fakeRuntime({
    evaluations: [openOk],
    readableErrors: new Map([[2, human]]),
    interventionAtRead: 2
  });
  await assert.rejects(() => getVerifiedSearchShareLink(fake.runtime, query), isRuntimeCode("HUMAN_INTERVENTION_REQUIRED"));
  assert.equal(fake.evaluations(), 1);
  assert.equal(fake.invalidations(), 0);
});
