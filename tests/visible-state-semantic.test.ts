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


function fakeStaleAxRuntime(alwaysStale = false) {
  let readViewCalls = 0;
  let listCalls = 0;
  let getClientCalls = 0;
  let childCalls = 0;
  let disableCalls = 0;

  const client = {
    DOM: {
      async getDocument() { return { root: { nodeId: 1 } }; },
      async querySelector() { return { nodeId: 2 }; }
    },
    Accessibility: {
      async enable() {},
      async disable() { disableCalls += 1; },
      async getPartialAXTree() {
        return { nodes: [{ nodeId: `root-${getClientCalls}`, ignored: false }] };
      },
      async getChildAXNodes() {
        childCalls += 1;
        if (alwaysStale || childCalls === 1) {
          throw {
            message: "Invalid ID",
            request: { method: "Accessibility.getChildAXNodes" },
            response: { code: -32602, message: "Invalid ID" }
          };
        }
        return {
          nodes: [{
            nodeId: "child",
            ignored: false,
            role: { value: "Heading" },
            name: { value: "Tokyo Station details" }
          }]
        };
      }
    }
  };

  const runtime = {
    async assertReadableView(kind: string) {
      assert.equal(kind, "place");
      readViewCalls += 1;
      return "search" as const;
    },
    async listPlaceResults() {
      listCalls += 1;
      return ["Tokyo Station"];
    },
    async listRouteResults() {
      throw new Error("route results should not be read in a place summary");
    },
    async getClient() {
      getClientCalls += 1;
      return client;
    }
  } as unknown as MapsBrowserRuntime;

  return {
    runtime,
    metrics: () => ({ readViewCalls, listCalls, getClientCalls, childCalls, disableCalls })
  };
}

test("reader retries one fresh bounded snapshot when an AX node id becomes stale", async () => {
  const fake = fakeStaleAxRuntime();
  const reader = new VisibleStateReader(fake.runtime, { maxNodes: 20, maxChars: 2_000 });
  const summary = await reader.read("place");

  assert.deepEqual(summary.items, [{ index: 0, label: "Tokyo Station" }]);
  assert.deepEqual(summary.lines, ["Tokyo Station details"]);
  assert.equal(summary.view, "search");
  assert.deepEqual(fake.metrics(), {
    readViewCalls: 2,
    listCalls: 2,
    getClientCalls: 2,
    childCalls: 3,
    disableCalls: 2
  });
});

test("reader fails with UI_STATE_CHANGED when the fresh AX snapshot also becomes stale", async () => {
  const fake = fakeStaleAxRuntime(true);
  const reader = new VisibleStateReader(fake.runtime, { maxNodes: 20, maxChars: 2_000 });

  await assert.rejects(
    () => reader.read("place"),
    (error: unknown) => {
      const candidate = error as { code?: unknown; message?: unknown };
      assert.equal(candidate.code, "UI_STATE_CHANGED");
      assert.match(String(candidate.message), /accessibility tree during the bounded read/);
      return true;
    }
  );
  assert.deepEqual(fake.metrics(), {
    readViewCalls: 2,
    listCalls: 2,
    getClientCalls: 2,
    childCalls: 2,
    disableCalls: 2
  });
});
