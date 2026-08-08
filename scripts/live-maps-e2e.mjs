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
const policy = new PolicyEngine({ interactiveAssist: true, maxActionsPerMinute: 10 });
const runtime = new MapsBrowserRuntime(chrome, policy);
const compiler = new MapsUrlCompiler();
const reader = new VisibleStateReader(runtime, { maxNodes: 120, maxChars: 1800 });
const semantic = new SemanticController(runtime, compiler);

try {
  // One public, user-directed place search. No reviews, crawling, screenshots, or persistence.
  policy.consumeAction();
  policy.assertSearchQuery("Tokyo Station");
  const search = compiler.search("Tokyo Station");
  const searchNavigation = await runtime.navigate(search.url, search.action);
  assert(searchNavigation.url.includes("/maps/"), "Search did not remain on Google Maps");
  await sleep(2_500);

  const placeSummary = await reader.read("place");
  boundedSummary(placeSummary, 1800);

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

  const routeSummary = await reader.read("route");
  boundedSummary(routeSummary, 1800);
  assert(routeSummary.items.length > 0, "No selectable transit route candidates were detected");

  // Verify the stale-index guard using exactly the label returned by the bounded reader.
  const firstRoute = routeSummary.items[0];
  assert(firstRoute, "No first route candidate was returned");
  const selected = await semantic.selectRoute(firstRoute.index, firstRoute.label);
  assert(typeof selected.selected === "string" && selected.selected.length > 0, "Route selection did not return a label");

  console.log("Live Maps E2E passed: bounded place read, transit read, and guarded route selection");
} finally {
  await runtime.close().catch(() => undefined);
  await fsp.rm(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 150
  }).catch(() => undefined);
}
