import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTransitClockForObservedInput,
  isFreshTransitDirectionsUrl,
  normalizeTransitClockTime,
  parseTransitTimeInputProbe,
  parseTransitTimeMenuProbe,
  parseTransitTimeOpenProbe,
  parseTransitTimePostconditionProbe,
  setVerifiedTransitTime,
  type TransitRouteSnapshot
} from "../src/browser/transit-time.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";
import type { MapsAction } from "../src/types.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

const snapshot: TransitRouteSnapshot = {
  originValue: "Tokyo Station resolved",
  destinationValue: "Yokohama Station resolved"
};

const canonicalUrl =
  "https://www.google.com/maps/dir/?api=1&origin=Tokyo+Station&destination=Yokohama+Station&travelmode=transit&hl=en";
const resolvedUrl =
  "https://www.google.com/maps/dir/Tokyo+Station/Yokohama+Station/@35.5,139.6,11z/data=!4m18";

const canonicalAction: MapsAction = {
  kind: "directions",
  origin: "Tokyo Station",
  destination: "Yokohama Station",
  mode: "transit"
};

test("transit time input is strict HH:MM and formats to observed 24h or 12h UI", () => {
  assert.equal(normalizeTransitClockTime("13:30"), "13:30");
  assert.equal(formatTransitClockForObservedInput("13:30", "12:20"), "13:30");
  assert.equal(formatTransitClockForObservedInput("13:30", "12:20 PM"), "1:30 PM");
  assert.equal(formatTransitClockForObservedInput("00:05", "12:20 PM"), "12:05 AM");
  assert.equal(formatTransitClockForObservedInput("12:05", "12:20 PM"), "12:05 PM");
  assert.throws(() => normalizeTransitClockTime("24:00"), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(() => normalizeTransitClockTime("9:30"), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(
    () => formatTransitClockForObservedInput("13:30", "13時30分"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("fresh transit route identity accepts only the documented explicit transit URL", () => {
  assert.equal(isFreshTransitDirectionsUrl(canonicalUrl, "Tokyo Station", "Yokohama Station"), true);
  assert.equal(
    isFreshTransitDirectionsUrl(canonicalUrl, " tokyo   station ", "yokohama station"),
    true
  );
  assert.equal(isFreshTransitDirectionsUrl(resolvedUrl, "Tokyo Station", "Yokohama Station"), false);
  assert.equal(
    isFreshTransitDirectionsUrl(
      "https://www.google.com/maps/dir/?api=1&origin=Tokyo+Station&destination=Osaka+Station&travelmode=transit",
      "Tokyo Station",
      "Yokohama Station"
    ),
    false
  );
  assert.equal(
    isFreshTransitDirectionsUrl(
      "https://www.google.com/maps/dir/?api=1&origin=Tokyo+Station&destination=Yokohama+Station&travelmode=driving",
      "Tokyo Station",
      "Yokohama Station"
    ),
    false
  );
});

test("transit time open probe accepts observed EN/JA trigger and exact route snapshot", () => {
  assert.deepEqual(
    parseTransitTimeOpenProbe({
      ok: true,
      triggerLabel: "Leave now",
      originValue: snapshot.originValue,
      destinationValue: snapshot.destinationValue
    }),
    snapshot
  );
  assert.deepEqual(
    parseTransitTimeOpenProbe({
      ok: true,
      triggerLabel: "すぐに出発",
      originValue: "東京駅、住所",
      destinationValue: "横浜駅、住所"
    }),
    { originValue: "東京駅、住所", destinationValue: "横浜駅、住所" }
  );
  assert.deepEqual(parseTransitTimeOpenProbe({ ok: false, reason: "pending" }), { state: "pending" });
});

test("transit time open probe fails closed on missing, duplicate, and stale controls", () => {
  assert.throws(
    () => parseTransitTimeOpenProbe({ ok: false, reason: "missing_trigger" }),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  for (const reason of ["ambiguous_trigger", "ambiguous_origin", "ambiguous_destination", "stale_time_state"]) {
    assert.throws(
      () => parseTransitTimeOpenProbe({ ok: false, reason }),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
  assert.throws(
    () => parseTransitTimeOpenProbe({
      ok: true,
      triggerLabel: "Depart at",
      originValue: snapshot.originValue,
      destinationValue: snapshot.destinationValue
    }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("transit time menu is restricted to observed depart-at and arrive-by labels", () => {
  assert.equal(parseTransitTimeMenuProbe({ ok: true, targetLabel: "Depart at" }, "depart_at"), "ready");
  assert.equal(parseTransitTimeMenuProbe({ ok: true, targetLabel: "到着時刻" }, "arrive_by"), "ready");
  assert.deepEqual(parseTransitTimeMenuProbe({ ok: false, reason: "pending" }, "depart_at"), { state: "pending" });
  assert.throws(
    () => parseTransitTimeMenuProbe({ ok: false, reason: "missing_option" }, "depart_at"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  assert.throws(
    () => parseTransitTimeMenuProbe({ ok: false, reason: "ambiguous_option" }, "arrive_by"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseTransitTimeMenuProbe({ ok: true, targetLabel: "Last available" }, "depart_at"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("transit time input and postcondition preserve exact resolved endpoints", () => {
  const input = {
    ok: true,
    triggerLabel: "Depart at",
    originValue: snapshot.originValue,
    destinationValue: snapshot.destinationValue,
    timeValue: "12:20 PM"
  };
  assert.deepEqual(parseTransitTimeInputProbe(input, "depart_at", snapshot), { observedTime: "12:20 PM" });
  assert.deepEqual(
    parseTransitTimePostconditionProbe({ ...input, timeValue: "1:30 PM" }, "depart_at", snapshot, "1:30 PM"),
    "ready"
  );
  assert.deepEqual(
    parseTransitTimePostconditionProbe(input, "depart_at", snapshot, "1:30 PM"),
    { state: "pending" }
  );
  assert.throws(
    () => parseTransitTimeInputProbe({ ...input, destinationValue: "Other place" }, "depart_at", snapshot),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseTransitTimeInputProbe({ ok: false, reason: "ambiguous_time" }, "depart_at", snapshot),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

type FakeInput = {
  evaluations: unknown[];
  action?: MapsAction;
  canonicalUrls?: string[];
  directionsErrors?: Map<number, BrowserRuntimeError>;
  mapsErrors?: Map<number, BrowserRuntimeError>;
  interventionOnDirectionsAssert?: number;
  interventionOnMapsAssert?: number;
};

function fakeRuntime(input: FakeInput) {
  let evaluationIndex = 0;
  let directionsAssertIndex = 0;
  let mapsAssertIndex = 0;
  let currentUrlIndex = 0;
  let epoch = 40;
  let invalidationCount = 0;
  let dropReplayMutationCount = 0;
  let interventionActive = false;
  let lastAction: MapsAction | undefined = input.action ?? canonicalAction;
  let viewState: "directions" | "blank" = "directions";
  const inserted: string[] = [];
  const keys: string[] = [];

  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: input.evaluations[evaluationIndex++] } };
      }
    },
    Input: {
      async insertText({ text }: { text: string }) { inserted.push(text); },
      async dispatchKeyEvent({ key }: { key: string }) { keys.push(key); }
    }
  };

  const runtime = {
    async assertDirectionsContext() {
      const current = directionsAssertIndex++;
      if (input.interventionOnDirectionsAssert === current) interventionActive = true;
      const error = input.directionsErrors?.get(current);
      if (error) throw error;
    },
    getLastAction() { return lastAction; },
    async currentUrl() {
      return input.canonicalUrls?.[currentUrlIndex++] ?? canonicalUrl;
    },
    async assertMapsSurface() {
      const current = mapsAssertIndex++;
      if (input.interventionOnMapsAssert === current) interventionActive = true;
      const error = input.mapsErrors?.get(current);
      if (error) throw error;
      return resolvedUrl;
    },
    async getClient() { return client; },
    getViewState() { return viewState; },
    markSemanticMutationWithoutReplayAction() {
      dropReplayMutationCount += 1;
      lastAction = undefined;
      epoch += 1;
    },
    invalidateSemanticContext() {
      invalidationCount += 1;
      lastAction = undefined;
      viewState = "blank";
      epoch += 1;
    },
    getActiveIntervention() { return interventionActive ? { id: "human" } : undefined; },
    getResourceEpoch() { return epoch; }
  } as unknown as MapsBrowserRuntime;

  return {
    runtime,
    evaluations: () => evaluationIndex,
    inserted: () => inserted,
    keys: () => keys,
    invalidationCount: () => invalidationCount,
    dropReplayMutationCount: () => dropReplayMutationCount,
    epoch: () => epoch,
    lastAction: () => lastAction,
    viewState: () => viewState
  };
}

const openProbe = {
  ok: true,
  triggerLabel: "Leave now",
  originValue: snapshot.originValue,
  destinationValue: snapshot.destinationValue
};
const departMenuProbe = { ok: true, targetLabel: "Depart at" };
const inputProbe = {
  ok: true,
  triggerLabel: "Depart at",
  originValue: snapshot.originValue,
  destinationValue: snapshot.destinationValue,
  timeValue: "12:20 PM"
};
const postProbe = { ...inputProbe, timeValue: "1:30 PM" };

test("verified transit time succeeds, drops replay action, keeps route readable, and advances epoch once", async () => {
  const fake = fakeRuntime({ evaluations: [openProbe, departMenuProbe, inputProbe, postProbe] });
  const before = fake.epoch();
  const result = await setVerifiedTransitTime(
    fake.runtime,
    "Tokyo Station",
    "Yokohama Station",
    "depart_at",
    "13:30"
  );
  assert.deepEqual(result, {
    scheduled: true,
    origin: "Tokyo Station",
    destination: "Yokohama Station",
    mode: "depart_at",
    time: "13:30",
    source: "google_maps_transit_time"
  });
  assert.deepEqual(fake.inserted(), ["1:30 PM"]);
  assert.deepEqual(fake.keys(), ["Enter", "Enter"]);
  assert.equal(fake.dropReplayMutationCount(), 1);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before + 1);
  assert.equal(fake.lastAction(), undefined);
  assert.equal(fake.viewState(), "directions");
});

test("transit time expected identity mismatch and unsupported route constraints do not mutate state", async () => {
  for (const action of [
    canonicalAction,
    { ...canonicalAction, destination: "Osaka Station" } as MapsAction,
    { ...canonicalAction, mode: "driving" } as MapsAction,
    { ...canonicalAction, waypoints: ["Shinagawa Station"] } as MapsAction
  ]) {
    const fake = fakeRuntime({ evaluations: [], action });
    const expectedDestination = action === canonicalAction ? "Osaka Station" : "Yokohama Station";
    await assert.rejects(
      () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", expectedDestination, "depart_at", "13:30"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
    assert.equal(fake.dropReplayMutationCount(), 0);
    assert.equal(fake.invalidationCount(), 0);
  }
});

test("transit time refuses a resolved or otherwise stale route before mutation", async () => {
  const fake = fakeRuntime({ evaluations: [], canonicalUrls: [resolvedUrl] });
  await assert.rejects(
    () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", "Yokohama Station", "depart_at", "13:30"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.dropReplayMutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
});

test("transit time invalidates semantic context on stale route after mode selection", async () => {
  const fake = fakeRuntime({
    evaluations: [
      openProbe,
      departMenuProbe,
      { ok: false, reason: "changed_route" }
    ]
  });
  await assert.rejects(
    () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", "Yokohama Station", "depart_at", "13:30"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.dropReplayMutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
  assert.equal(fake.viewState(), "blank");
});

test("transit time invalidates semantic context on unexpected navigation after click", async () => {
  const fake = fakeRuntime({
    evaluations: [openProbe, departMenuProbe],
    mapsErrors: new Map([[0, new BrowserRuntimeError("UI_STATE_CHANGED", "left directions")]])
  });
  await assert.rejects(
    () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", "Yokohama Station", "depart_at", "13:30"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.dropReplayMutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("transit time invalidates semantic context on invalid postcondition", async () => {
  const fake = fakeRuntime({
    evaluations: [
      openProbe,
      departMenuProbe,
      inputProbe,
      { ok: false, reason: "ambiguous_time" }
    ]
  });
  await assert.rejects(
    () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", "Yokohama Station", "depart_at", "13:30"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.dropReplayMutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("transit time treats malformed successful opener as post-click and invalidates semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [{ ...openProbe, triggerLabel: "Other" }]
  });
  await assert.rejects(
    () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", "Yokohama Station", "depart_at", "13:30"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.dropReplayMutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
});

test("transit time stops at Human Intervention after click without replay or extra invalidation", async () => {
  const humanError = new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
  // assertDirectionsContext calls: initial fresh identity, opener poll, then pre-menu fresh identity.
  const fake = fakeRuntime({
    evaluations: [openProbe],
    directionsErrors: new Map([[2, humanError]]),
    interventionOnDirectionsAssert: 2
  });
  await assert.rejects(
    () => setVerifiedTransitTime(fake.runtime, "Tokyo Station", "Yokohama Station", "depart_at", "13:30"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.dropReplayMutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
});
