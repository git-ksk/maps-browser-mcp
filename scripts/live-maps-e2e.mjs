import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChromeProcess } from "../dist/browser/chrome-process.js";
import { MapsBrowserRuntime } from "../dist/browser/runtime.js";
import { VisibleStateReader } from "../dist/browser/visible-state-reader.js";
import { SemanticController } from "../dist/browser/semantic-controller.js";
import { MapsUrlCompiler } from "../dist/maps/url-compiler.js";
import { PolicyEngine } from "../dist/policy/policy-engine.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedSummary(summary, maxChars) {
  const totalChars = [
    ...summary.items.map((item) => item.label),
    ...summary.lines
  ].reduce((sum, value) => sum + value.length, 0);

  assert(summary.untrustedExternalText === true, "Reader must mark Maps text as untrusted");
  assert(summary.source === "google_maps_bounded_visible_ui", "Unexpected reader source");
  assert(summary.items.length <= (summary.kind === "place" ? 8 : 6), "Reader returned too many indexed items");
  assert(summary.lines.length <= 12, "Reader returned too many UI lines");
  assert(totalChars <= maxChars, `Reader exceeded ${maxChars} character budget`);
  assert(summary.items.length + summary.lines.length > 0, `No bounded ${summary.kind} UI content was detected`);
}

const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), "maps-browser-mcp-live-"));
const chrome = new ChromeProcess({ profileDir, headless: true });
const policy = new PolicyEngine({
  interactiveAssist: true,
  maxActionsPerMinute: 10,
  maxVisibleReadsPerHour: 8
});
const runtime = new MapsBrowserRuntime(chrome, policy);
const compiler = new MapsUrlCompiler();
const reader = new VisibleStateReader(runtime, { maxNodes: 120, maxChars: 1800 });
const semantic = new SemanticController(runtime, compiler);

async function searchAndSelectFirstPlace(placeQuery) {
  policy.consumeAction();
  policy.assertSearchQuery(placeQuery);
  const search = compiler.search(placeQuery);
  const searchNavigation = await runtime.navigate(search.url, search.action);
  assert(searchNavigation.url.includes("/maps/"), "Search did not remain on Google Maps");
  await sleep(2_500);

  policy.consumeVisibleRead();
  const placeSummary = await reader.read("place");
  boundedSummary(placeSummary, 1800);
  assert(placeSummary.items.length > 0, "No selectable place candidates were detected");

  const firstPlace = placeSummary.items[0];
  assert(firstPlace, "No first place candidate was returned");
  const selectedPlace = await semantic.selectResult(firstPlace.index, firstPlace.label);
  assert(
    typeof selectedPlace.selected === "string" && selectedPlace.selected.length > 0,
    "Place selection did not return a label"
  );
  await sleep(1_500);
  return selectedPlace.selected;
}

try {
  // Public, user-directed place workflow. No reviews, crawling, screenshots, or persistence.
  const placeQuery = "coffee near Tokyo Station";

  // Exercise the V4-B photo opener through the public semantic controller, not a
  // diagnostic CDP probe. The human-visible viewer is deliberately not retained as
  // replayable place state after the verified transition.
  const photoPlace = await searchAndSelectFirstPlace(placeQuery);
  const photoEpochBefore = runtime.getResourceEpoch();
  policy.consumeVisibleRead();
  const photoSurface = await semantic.openPlacePhotos(photoPlace);
  assert(photoSurface.opened === true, "Place photo surface did not report an opened viewer");
  assert(photoSurface.source === "google_maps_photo_surface", "Unexpected place-photo result source");
  assert(photoSurface.placeLabel === photoPlace, "Place photo surface lost the verified place label");
  assert(runtime.getViewState() === "blank", "Photo viewer retained stale place semantic state");
  assert(runtime.getLastAction() === undefined, "Photo viewer retained a stale replayable Maps action");
  assert(runtime.getResourceEpoch() > photoEpochBefore, "Photo viewer did not advance the resource epoch");
  console.log("Live Maps photo phase passed: verified active place -> bounded photo viewer -> stale state invalidated");

  // Re-establish a verified place after the photo viewer invalidated the old state.
  const selectedPlace = await searchAndSelectFirstPlace(placeQuery);

  // Exercise the V4-B nearby operation before unrelated legacy live checks so its
  // compatibility result is independently observable in the workflow log.
  const nearbyQuery = "coffee";
  policy.consumeAction();
  policy.assertSearchQuery(nearbyQuery);
  policy.consumeVisibleRead();
  const nearby = await semantic.searchNearby(selectedPlace, nearbyQuery);
  assert(nearby.source === "google_maps_nearby_search", "Unexpected nearby-search result source");
  assert(nearby.fromPlaceLabel.length > 0, "Nearby search lost the verified source-place label");
  assert(nearby.query === nearbyQuery, "Nearby search did not preserve the requested query");
  assert(new URL(nearby.url).pathname.startsWith("/maps/search/"), "Nearby search did not enter a Maps search result path");
  await sleep(2_000);

  policy.consumeVisibleRead();
  const nearbySummary = await reader.read("place");
  boundedSummary(nearbySummary, 1800);
  assert(nearbySummary.items.length > 0, "Nearby search returned no bounded place candidates");
  console.log("Live Maps nearby phase passed: verified active place -> bounded nearby search");

  // Re-establish a fresh verified place before the existing share check. This keeps
  // nearby state transition validation independent from the share dialog lifecycle.
  const sharePlace = await searchAndSelectFirstPlace(placeQuery);
  policy.consumeAction();
  policy.consumeVisibleRead();
  const placeShare = await semantic.getPlaceShareLink(sharePlace);
  assert(placeShare.placeLabel.length > 0, "Place share did not preserve a selected-place label");
  assert(placeShare.source === "google_maps_share_dialog", "Unexpected place-share result source");
  const shareUrl = new URL(placeShare.url);
  assert(shareUrl.protocol === "https:", "Place share URL was not HTTPS");
  assert(
    shareUrl.hostname === "maps.app.goo.gl" ||
      (shareUrl.hostname === "www.google.com" && (shareUrl.pathname === "/maps" || shareUrl.pathname.startsWith("/maps/"))),
    "Place share URL left the allow-listed Google Maps origins"
  );

  // One public transit route. This is intentionally fixed and low-volume.
  policy.consumeAction();
  const directions = compiler.directions({
    origin: "Tokyo Station",
    destination: "Yokohama Station",
    mode: "transit"
  });
  const routeNavigation = await runtime.navigate(directions.url, directions.action);
  assert(routeNavigation.url.includes("/maps/"), "Directions did not remain on Google Maps");
  await sleep(3_000);

  policy.consumeVisibleRead();
  const routeSummary = await reader.read("route");
  boundedSummary(routeSummary, 1800);
  assert(routeSummary.items.length > 0, "No selectable transit route candidates were detected");

  // Verify the stale-index guard using exactly the label returned by the bounded reader.
  const firstRoute = routeSummary.items[0];
  assert(firstRoute, "No first route candidate was returned");
  const selectedRoute = await semantic.selectRoute(firstRoute.index, firstRoute.label);
  assert(
    typeof selectedRoute.selected === "string" && selectedRoute.selected.length > 0,
    "Route selection did not return a label"
  );

  console.log("Live Maps E2E passed: photo opener, nearby, bounded place share, transit read, and guarded route selection");
} finally {
  await runtime.close().catch(() => undefined);
  await fsp.rm(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 150
  }).catch(() => undefined);
}
