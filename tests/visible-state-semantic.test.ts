import assert from "node:assert/strict";
import test from "node:test";
import { VisibleStateReader } from "../src/browser/visible-state-reader.js";
import type { MapsBrowserRuntime } from "../src/browser/runtime.js";

function fakeRouteRuntime() {
  let getClientCalls = 0;
  let requestedDepth: number | undefined;
  let fetchRelatives: boolean | undefined;

  const client = {
    DOM: {
      async getDocument(options: { depth: number }) {
        requestedDepth = options.depth;
        return { root: { nodeId: 1 } };
      },
      async querySelector() {
        return { nodeId: 2 };
      }
    },
    Accessibility: {
      async enable() {},
      async disable() {},
      async getPartialAXTree(options: { fetchRelatives: boolean }) {
        fetchRelatives = options.fetchRelatives;
        return { nodes: [{ nodeId: "root", ignored: false }] };
      },
      async getChildAXNodes({ id }: { id: string }) {
        if (id === "root") {
          return {
            nodes: [{
              nodeId: "child",
              ignored: false,
              role: { value: "StaticText" },
              name: { value: "depart 10:30 · arrive 10:58 · via Tokyo" }
            }]
          };
        }
        return { nodes: [] };
      }
    }
  };

  const runtime = {
    async assertReadableView(kind: string) {
      assert.equal(kind, "route");
      return "directions" as const;
    },
    async listRouteResults() {
      return ["28 min · train"];
    },
    async listPlaceResults() {
      throw new Error("place results should not be read in a route summary");
    },
    async getClient() {
      getClientCalls += 1;
      return client;
    }
  } as unknown as MapsBrowserRuntime;

  return {
    runtime,
    metrics: () => ({ getClientCalls, requestedDepth, fetchRelatives })
  };
}

test("reader adds source-indexed semantics without widening its bounded UI read", async () => {
  const fake = fakeRouteRuntime();
  const reader = new VisibleStateReader(fake.runtime, { maxNodes: 20, maxChars: 2_000 });
  const summary = await reader.read("route");

  assert.deepEqual(summary.items, [{ index: 0, label: "28 min · train" }]);
  assert.deepEqual(summary.lines, ["depart 10:30 · arrive 10:58 · via Tokyo"]);
  assert.deepEqual(summary.semanticAnnotations, [
    { source: "item", index: 0, signals: ["duration", "transit"] },
    { source: "line", index: 0, signals: ["departure", "arrival", "via"] }
  ]);
  assert.equal(summary.untrustedExternalText, true);

  assert.deepEqual(fake.metrics(), {
    getClientCalls: 1,
    requestedDepth: 2,
    fetchRelatives: false
  });
});
