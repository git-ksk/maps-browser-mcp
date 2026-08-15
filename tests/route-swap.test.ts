import assert from "node:assert/strict";
import test from "node:test";
import { isFreshSimpleDirectionsUrl, swapVerifiedRouteEndpoints } from "../src/browser/route-swap.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";
import { MapsUrlCompiler } from "../src/maps/url-compiler.js";
import type { MapsAction } from "../src/types.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

const action: Extract<MapsAction, { kind: "directions" }> = {
  kind: "directions",
  origin: "Tokyo Station",
  destination: "Yokohama Station",
  mode: "driving",
  avoid: ["tolls", "highways"]
};
const url = "https://www.google.com/maps/dir/?api=1&origin=Tokyo+Station&destination=Yokohama+Station&travelmode=driving&avoid=tolls%2Chighways";

test("fresh simple directions identity is restricted to documented matching URLs", () => {
  assert.equal(isFreshSimpleDirectionsUrl(url, action), true);
  assert.equal(isFreshSimpleDirectionsUrl(url.replace("Yokohama", "Osaka"), action), false);
  assert.equal(isFreshSimpleDirectionsUrl(url.replace("driving", "walking"), action), false);
  assert.equal(isFreshSimpleDirectionsUrl("https://www.google.com/maps/dir/Tokyo/Yokohama/@35,139,10z/data=x", action), false);
  assert.equal(isFreshSimpleDirectionsUrl(url, { ...action, waypoints: ["Shinagawa Station"] }), false);
  assert.equal(isFreshSimpleDirectionsUrl(url, { ...action, origin: undefined }), false);
});

function fakeRuntime(input: {
  action?: MapsAction;
  url?: string;
  assertError?: BrowserRuntimeError;
}) {
  let navigateCount = 0;
  let navigatedUrl = "";
  let navigatedAction: MapsAction | undefined;
  let epoch = 12;
  const runtime = {
    async assertDirectionsContext() {
      if (input.assertError) throw input.assertError;
    },
    getLastAction() { return input.action ?? action; },
    async currentUrl() { return input.url ?? url; },
    async navigate(nextUrl: string, nextAction: MapsAction) {
      navigateCount += 1;
      navigatedUrl = nextUrl;
      navigatedAction = nextAction;
      epoch += 1;
      return { url: nextUrl };
    },
    getResourceEpoch() { return epoch; }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    navigateCount: () => navigateCount,
    navigatedUrl: () => navigatedUrl,
    navigatedAction: () => navigatedAction,
    epoch: () => epoch
  };
}

test("verified endpoint swap rebuilds documented URL, preserves mode/avoid, and advances navigation once", async () => {
  const fake = fakeRuntime({});
  const before = fake.epoch();
  const result = await swapVerifiedRouteEndpoints(
    fake.runtime,
    new MapsUrlCompiler(),
    "Tokyo Station",
    "Yokohama Station"
  );
  assert.equal(fake.navigateCount(), 1);
  assert.equal(fake.epoch(), before + 1);
  const parsed = new URL(fake.navigatedUrl());
  assert.equal(parsed.searchParams.get("origin"), "Yokohama Station");
  assert.equal(parsed.searchParams.get("destination"), "Tokyo Station");
  assert.equal(parsed.searchParams.get("travelmode"), "driving");
  assert.equal(parsed.searchParams.get("avoid"), "tolls,highways");
  assert.deepEqual(fake.navigatedAction(), {
    kind: "directions",
    origin: "Yokohama Station",
    destination: "Tokyo Station",
    mode: "driving",
    avoid: ["tolls", "highways"]
  });
  assert.deepEqual(result, {
    swapped: true,
    origin: "Yokohama Station",
    destination: "Tokyo Station",
    mode: "driving",
    avoid: ["tolls", "highways"],
    url: fake.navigatedUrl(),
    source: "google_maps_documented_directions_url"
  });
});

test("endpoint swap expected identity mismatch fails before navigation", async () => {
  const fake = fakeRuntime({});
  await assert.rejects(
    () => swapVerifiedRouteEndpoints(fake.runtime, new MapsUrlCompiler(), "Osaka Station", "Yokohama Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.navigateCount(), 0);
});

test("endpoint swap refuses omitted origin and waypoint semantics", async () => {
  for (const badAction of [
    { ...action, origin: undefined },
    { ...action, waypoints: ["Shinagawa Station"] }
  ] as MapsAction[]) {
    const fake = fakeRuntime({ action: badAction });
    await assert.rejects(
      () => swapVerifiedRouteEndpoints(fake.runtime, new MapsUrlCompiler(), "Tokyo Station", "Yokohama Station"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
    assert.equal(fake.navigateCount(), 0);
  }
});

test("endpoint swap refuses stale or resolved route URL before navigation", async () => {
  const fake = fakeRuntime({ url: "https://www.google.com/maps/dir/Tokyo/Yokohama/@35,139,10z/data=x" });
  await assert.rejects(
    () => swapVerifiedRouteEndpoints(fake.runtime, new MapsUrlCompiler(), "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.navigateCount(), 0);
});

test("endpoint swap propagates Human Intervention without navigation or replay", async () => {
  const fake = fakeRuntime({ assertError: new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge") });
  await assert.rejects(
    () => swapVerifiedRouteEndpoints(fake.runtime, new MapsUrlCompiler(), "Tokyo Station", "Yokohama Station"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.navigateCount(), 0);
});
