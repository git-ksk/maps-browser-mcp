import assert from "node:assert/strict";
import test from "node:test";
import {
  getVerifiedRouteShareLink,
  parseRouteShareCloseProbe,
  parseRouteShareLinkProbe,
  parseRouteShareOpenProbe
} from "../src/browser/route-share.js";
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

const openOk = { ok: true, label: "Share directions" };
const linkOk = {
  ok: true,
  url: "https://maps.app.goo.gl/AbCdEf123",
  tabLabel: "Send a link",
  tabSelected: true
};
const closeOk = { ok: true, label: "Close" };

test("route share open probe accepts only observed JA/EN labels and fails closed on ambiguity", () => {
  assert.equal(parseRouteShareOpenProbe(openOk), "ready");
  assert.equal(parseRouteShareOpenProbe({ ok: true, label: "ルートを共有" }), "ready");
  assert.deepEqual(parseRouteShareOpenProbe({ ok: false, reason: "pending" }), { state: "pending" });
  assert.throws(
    () => parseRouteShareOpenProbe({ ok: false, reason: "ambiguous_share" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseRouteShareOpenProbe({ ok: false, reason: "missing_share" }),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  assert.throws(
    () => parseRouteShareOpenProbe({ ok: true, label: "Share" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("route share link probe requires selected observed Send-link tab and one safe URL", () => {
  assert.equal(parseRouteShareLinkProbe(linkOk), "https://maps.app.goo.gl/AbCdEf123");
  assert.equal(
    parseRouteShareLinkProbe({ ...linkOk, tabLabel: "リンクを送信する" }),
    "https://maps.app.goo.gl/AbCdEf123"
  );
  assert.equal(parseRouteShareLinkProbe({ ok: false, reason: "pending" }), undefined);
  for (const reason of ["ambiguous_dialog", "ambiguous_tab", "wrong_tab", "ambiguous_link"]) {
    assert.throws(
      () => parseRouteShareLinkProbe({ ok: false, reason }),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
  assert.throws(
    () => parseRouteShareLinkProbe({ ...linkOk, tabSelected: false }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseRouteShareLinkProbe({ ...linkOk, url: "https://evil.example/share" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("route share close probe accepts exact Close labels, already-closed state, and rejects ambiguity", () => {
  assert.equal(parseRouteShareCloseProbe(closeOk), "ready");
  assert.equal(parseRouteShareCloseProbe({ ok: true, label: "閉じる" }), "ready");
  assert.equal(parseRouteShareCloseProbe({ ok: false, reason: "closed" }), "ready");
  assert.deepEqual(parseRouteShareCloseProbe({ ok: false, reason: "pending" }), { state: "pending" });
  assert.throws(
    () => parseRouteShareCloseProbe({ ok: false, reason: "ambiguous_dialog" }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

type FakeInput = {
  evaluations?: unknown[];
  action?: MapsAction;
  viewState?: "route" | "directions" | "blank";
  assertErrors?: Map<number, BrowserRuntimeError>;
  interventionAtAssert?: number;
};

function fakeRuntime(input: FakeInput = {}) {
  const evaluations = input.evaluations ?? [openOk, linkOk, closeOk, 0];
  let evaluationIndex = 0;
  let assertIndex = 0;
  let invalidations = 0;
  let interventionActive = false;
  let viewState = input.viewState ?? "route";
  let lastAction = input.action ?? action;

  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: evaluations[evaluationIndex++] } };
      }
    }
  };
  const runtime = {
    async assertDirectionsContext() {
      const current = assertIndex++;
      if (input.interventionAtAssert === current) interventionActive = true;
      const error = input.assertErrors?.get(current);
      if (error) throw error;
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

test("verified selected transit route share returns visible safe link and closes dialog without invalidating route", async () => {
  const fake = fakeRuntime();
  const result = await getVerifiedRouteShareLink(fake.runtime, "Tokyo Station", "Yokohama Station");
  assert.deepEqual(result, {
    origin: "Tokyo Station",
    destination: "Yokohama Station",
    mode: "transit",
    url: "https://maps.app.goo.gl/AbCdEf123",
    source: "google_maps_route_share_dialog"
  });
  assert.equal(fake.evaluations(), 4);
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.viewState(), "route");
  assert.deepEqual(fake.lastAction(), action);
});

test("route share identity mismatch, non-selected view, driving, waypoint, and avoid routes fail before UI action", async () => {
  const cases: Array<{ expectedOrigin?: string; input?: FakeInput }> = [
    { expectedOrigin: "Osaka Station" },
    { input: { viewState: "directions" } },
    { input: { action: { ...action, mode: "driving" } as MapsAction } },
    { input: { action: { ...action, waypoints: ["Shinagawa Station"] } as MapsAction } },
    { input: { action: { ...action, avoid: ["tolls"] } as MapsAction } }
  ];
  for (const item of cases) {
    const fake = fakeRuntime(item.input);
    await assert.rejects(
      () => getVerifiedRouteShareLink(
        fake.runtime,
        item.expectedOrigin ?? "Tokyo Station",
        "Yokohama Station"
      ),
      isRuntimeCode("UI_STATE_CHANGED")
    );
    assert.equal(fake.evaluations(), 0);
    assert.equal(fake.invalidations(), 0);
  }
});

test("route share invalid postcondition closes dialog and preserves route when close succeeds", async () => {
  const fake = fakeRuntime({
    evaluations: [
      openOk,
      { ok: false, reason: "ambiguous_link" },
      closeOk,
      0
    ]
  });
  await assert.rejects(
    () => getVerifiedRouteShareLink(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.viewState(), "route");
});

test("route share invalidates semantic context if opened dialog cannot be closed safely", async () => {
  const fake = fakeRuntime({
    evaluations: [
      openOk,
      linkOk,
      { ok: false, reason: "ambiguous_close" },
      { ok: false, reason: "ambiguous_close" }
    ]
  });
  await assert.rejects(
    () => getVerifiedRouteShareLink(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.viewState(), "blank");
});

test("route share propagates Human Intervention after dialog open without automatic close or replay", async () => {
  const human = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  // assert calls: initial selected route, opener poll, then share-link read.
  const fake = fakeRuntime({
    evaluations: [openOk],
    assertErrors: new Map([[2, human]]),
    interventionAtAssert: 2
  });
  await assert.rejects(
    () => getVerifiedRouteShareLink(fake.runtime, "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.evaluations(), 1);
  assert.equal(fake.invalidations(), 0);
});
