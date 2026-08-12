import assert from "node:assert/strict";
import test from "node:test";
import { SemanticController } from "../src/browser/semantic-controller.js";
import type { MapsBrowserRuntime } from "../src/browser/runtime.js";
import { MapsUrlCompiler } from "../src/maps/url-compiler.js";
import type { MapsAction } from "../src/types.js";

test("setTravelMode preserves documented waypoints and avoid constraints", async () => {
  let assertedDirectionsContext = false;
  let navigatedAction: MapsAction | undefined;
  let navigatedUrl = "";

  const runtime = {
    async assertDirectionsContext() {
      assertedDirectionsContext = true;
    },
    getLastAction(): MapsAction {
      return {
        kind: "directions",
        origin: "Tokyo Station",
        destination: "Hakone-Yumoto Station",
        mode: "driving",
        waypoints: ["Yokohama Station", "Odawara Station"],
        avoid: ["tolls", "highways"]
      };
    },
    async navigate(url: string, action: MapsAction) {
      navigatedUrl = url;
      navigatedAction = action;
      return { url };
    }
  } as unknown as MapsBrowserRuntime;

  const controller = new SemanticController(runtime, new MapsUrlCompiler());
  const result = await controller.setTravelMode("walking");

  assert.equal(assertedDirectionsContext, true);
  assert.equal(result.mode, "walking");
  assert.equal(result.url, navigatedUrl);
  const parsed = new URL(navigatedUrl);
  assert.equal(parsed.searchParams.get("travelmode"), "walking");
  assert.equal(parsed.searchParams.get("waypoints"), "Yokohama Station|Odawara Station");
  assert.equal(parsed.searchParams.get("avoid"), "tolls,highways");
  assert.deepEqual(navigatedAction, {
    kind: "directions",
    origin: "Tokyo Station",
    destination: "Hakone-Yumoto Station",
    mode: "walking",
    waypoints: ["Yokohama Station", "Odawara Station"],
    avoid: ["tolls", "highways"]
  });
});
