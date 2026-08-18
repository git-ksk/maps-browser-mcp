import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parsePlaceSaveActionProbe,
  parsePlaceSavePostconditionProbe,
  resolveFreshPlaceSaveTarget,
  saveVerifiedPlaceToExistingList
} from "../src/browser/place-save-action.js";
import { parsePlaceSaveStateProbe, type PlaceSaveStateResult } from "../src/browser/place-save-state.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

function state(rows: Array<{ label: string; saved: boolean }>, placeLabel = "Example Place"): PlaceSaveStateResult {
  return {
    placeLabel,
    lists: rows.map((row, index) => ({ index, ...row })),
    truncated: false,
    source: "google_maps_save_menu"
  };
}

test("fresh exact place + exact index + exact list identity resolves one existing target", () => {
  assert.deepEqual(
    resolveFreshPlaceSaveTarget(
      state([{ label: "List A", saved: false }, { label: "List B", saved: true }]),
      "Example Place",
      0,
      "List A"
    ),
    { placeLabel: "Example Place", listIndex: 0, listLabel: "List A", alreadySaved: false }
  );
});

test("index match with label mismatch and stale index with matching label elsewhere both fail closed", () => {
  const fresh = state([{ label: "List B", saved: false }, { label: "List A", saved: false }]);
  assert.throws(
    () => resolveFreshPlaceSaveTarget(fresh, "Example Place", 0, "List A"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => resolveFreshPlaceSaveTarget(fresh, "Example Place", 1, "List B"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("duplicate, missing, changed-place, and new-list identities fail closed", () => {
  assert.throws(
    () => resolveFreshPlaceSaveTarget(state([{ label: "Same", saved: false }, { label: " same ", saved: false }]), "Example Place", 0, "Same"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => resolveFreshPlaceSaveTarget(state([{ label: "List A", saved: false }]), "Example Place", 2, "List A"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => resolveFreshPlaceSaveTarget(state([{ label: "List A", saved: false }], "Other Place"), "Example Place", 0, "List A"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => resolveFreshPlaceSaveTarget(state([{ label: "New list", saved: false }]), "Example Place", 0, "New list"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parsePlaceSaveStateProbe({ ok: true, placeLabel: "Example Place", rows: [{ label: "新しいリスト", checked: false }], total: 1 }, "Example Place"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("action and postcondition probes bind exact place/index/list and aria-checked", () => {
  assert.deepEqual(
    parsePlaceSaveActionProbe(
      { ok: true, placeLabel: "Example Place", listIndex: 1, listLabel: "List B", checked: false, clicked: true },
      "Example Place",
      1,
      "List B"
    ),
    { placeLabel: "Example Place", listIndex: 1, listLabel: "List B", wasSaved: false, clicked: true }
  );
  assert.equal(
    parsePlaceSavePostconditionProbe(
      { ok: true, placeLabel: "Example Place", listIndex: 1, listLabel: "List B", checked: true, clicked: false },
      "Example Place",
      1,
      "List B"
    ),
    true
  );
  assert.equal(
    parsePlaceSavePostconditionProbe(
      { ok: true, placeLabel: "Example Place", listIndex: 1, listLabel: "List B", checked: false, clicked: false },
      "Example Place",
      1,
      "List B"
    ),
    false
  );
});

test("ambiguous chooser, target mismatch, missing row, and structure change fail closed", () => {
  for (const reason of ["ambiguous_menu", "target_mismatch", "target_missing", "ambiguous_list_structure", "duplicate_list", "new_list_in_radio"]) {
    assert.throws(
      () => parsePlaceSaveActionProbe({ ok: false, reason }, "Example Place", 0, "List A"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
});

function fakeRuntime(input: {
  evaluations?: unknown[];
  readiness?: "signed_in" | "signed_out" | "unknown";
  assertErrors?: Map<number, BrowserRuntimeError>;
  resourceEpochSequence?: number[];
}) {
  let evaluateIndex = 0;
  let assertIndex = 0;
  let epoch = 7;
  let epochReadIndex = 0;
  let mutationCount = 0;
  let invalidationCount = 0;
  let keyEventCount = 0;
  let mouseEventCount = 0;
  const client = {
    Runtime: {
      async evaluate() {
        const value = input.evaluations?.[evaluateIndex++];
        return { result: { value } };
      }
    },
    Input: {
      async dispatchKeyEvent() {
        keyEventCount += 1;
      },
      async dispatchMouseEvent() {
        mouseEventCount += 1;
      }
    }
  };
  const runtime = {
    async assertReadableView() {
      const error = input.assertErrors?.get(assertIndex++);
      if (error) throw error;
      return "place" as const;
    },
    getViewState() {
      return "place" as const;
    },
    async readAuthenticatedReadiness() {
      return input.readiness ?? "signed_in";
    },
    async getClient() {
      return client;
    },
    getResourceEpoch() {
      const sequence = input.resourceEpochSequence;
      if (!sequence?.length) return epoch;
      const value = sequence[Math.min(epochReadIndex, sequence.length - 1)]!;
      epochReadIndex += 1;
      return value;
    },
    markSemanticMutation() {
      mutationCount += 1;
      epoch += 1;
    },
    invalidateSemanticContext() {
      invalidationCount += 1;
      epoch += 1;
    },
    getActiveIntervention() {
      return undefined;
    }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    evaluations: () => evaluateIndex,
    mutationCount: () => mutationCount,
    invalidationCount: () => invalidationCount,
    keyEventCount: () => keyEventCount,
    mouseEventCount: () => mouseEventCount,
    epoch: () => epoch
  };
}

const openProbe = { ok: true, placeLabel: "Example Place" };
const freshUnsaved = { ok: true, placeLabel: "Example Place", rows: [{ label: "List A", checked: false }], total: 1 };
const freshSaved = { ok: true, placeLabel: "Example Place", rows: [{ label: "List A", checked: true }], total: 1 };
const actionTarget = { ok: true, placeLabel: "Example Place", listIndex: 0, listLabel: "List A", checked: false, clicked: false, x: 120, y: 240 };
const postSaved = { ok: true, placeLabel: "Example Place", listIndex: 0, listLabel: "List A", checked: true, clicked: false };
const postUnsaved = { ok: true, placeLabel: "Example Place", listIndex: 0, listLabel: "List A", checked: false, clicked: false };

test("signed_out and unknown readiness fail before opening or clicking Save UI", async () => {
  for (const readiness of ["signed_out", "unknown"] as const) {
    const fake = fakeRuntime({ readiness });
    await assert.rejects(
      () => saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
    assert.equal(fake.evaluations(), 0);
    assert.equal(fake.mutationCount(), 0);
  }
});

test("already-saved target is idempotent success with no click and no epoch advance", async () => {
  const fake = fakeRuntime({ evaluations: [openProbe, freshSaved] });
  const before = fake.epoch();
  const result = await saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A");
  assert.equal(result.saved, true);
  assert.equal(result.alreadySaved, true);
  assert.equal(fake.evaluations(), 2);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.epoch(), before);
  assert.equal(fake.keyEventCount(), 2);
});


test("target becoming saved immediately before click is still an idempotent no-toggle success", async () => {
  const becameSaved = { ok: true, placeLabel: "Example Place", listIndex: 0, listLabel: "List A", checked: true, clicked: false };
  const fake = fakeRuntime({ evaluations: [openProbe, freshUnsaved, becameSaved] });
  const before = fake.epoch();
  const result = await saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A");
  assert.equal(result.saved, true);
  assert.equal(result.alreadySaved, true);
  assert.equal(fake.evaluations(), 3);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before);
});

test("one bounded save click followed by checked=true verifies success and advances epoch once", async () => {
  const fake = fakeRuntime({ evaluations: [openProbe, freshUnsaved, actionTarget, postSaved] });
  const before = fake.epoch();
  const result = await saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A");
  assert.equal(result.saved, true);
  assert.equal(result.alreadySaved, false);
  assert.equal(fake.evaluations(), 4);
  assert.equal(fake.mutationCount(), 1);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.epoch(), before + 1);
  assert.equal(fake.keyEventCount(), 2);
  assert.equal(fake.mouseEventCount(), 2);
});

test("checked=false after click is failure, returns no success, invalidates stale semantic context, and never retries the mutation", async () => {
  const fake = fakeRuntime({ evaluations: [openProbe, freshUnsaved, actionTarget, postUnsaved] });
  await assert.rejects(
    () => saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A", { postconditionTimeoutMs: 0, pollIntervalMs: 0 }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.evaluations(), 4);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
  assert.equal(fake.keyEventCount(), 2);
  assert.equal(fake.mouseEventCount(), 2);
});

test("postcondition timeout fails closed even if chooser must be reopened for verification", async () => {
  const pending = { ok: false, reason: "pending" };
  const fake = fakeRuntime({ evaluations: [openProbe, freshUnsaved, actionTarget, pending, openProbe, pending] });
  await assert.rejects(
    () => saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A", { postconditionTimeoutMs: 0, pollIntervalMs: 0 }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.evaluations(), 6);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 1);
  assert.equal(fake.keyEventCount(), 2);
  assert.equal(fake.mouseEventCount(), 2);
});

test("UI structure change after fresh read fails closed before any reported mutation", async () => {
  const fake = fakeRuntime({ evaluations: [openProbe, freshUnsaved, { ok: false, reason: "ambiguous_list_structure" }] });
  await assert.rejects(
    () => saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.invalidationCount(), 0);
  assert.equal(fake.mouseEventCount(), 0);
  assert.equal(fake.keyEventCount(), 2);
});

test("Human Intervention before action is propagated without stale automatic replay", async () => {
  const fake = fakeRuntime({
    assertErrors: new Map([[0, new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge")]])
  });
  await assert.rejects(
    () => saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.evaluations(), 0);
  assert.equal(fake.mutationCount(), 0);

  const serverSource = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(serverSource, /toolName: "maps_save_place_to_list"[\s\S]*?resumeStrategy: "require_fresh_semantic_action"/);
});

test("resource epoch change between fresh chooser read and click rejects stale action", async () => {
  const fake = fakeRuntime({ evaluations: [openProbe, freshUnsaved], resourceEpochSequence: [7, 8] });
  await assert.rejects(
    () => saveVerifiedPlaceToExistingList(fake.runtime, "Example Place", 0, "List A"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(fake.evaluations(), 2);
  assert.equal(fake.mutationCount(), 0);
});

test("V5-C source does not read credentials/account identifiers or persist raw place/list content", () => {
  const actionSource = fs.readFileSync(new URL("../src/browser/place-save-action.ts", import.meta.url), "utf8");
  assert.doesNotMatch(actionSource, /document\.cookie|localStorage|sessionStorage|cookieStore|Authorization|SignOutOptions/i);
  assert.doesNotMatch(actionSource, /writeFile|appendFile|checkpoint|durable/i);
  assert.match(actionSource, /\[role=\\?"menuitemradio\\?"\]/);
  assert.match(actionSource, /aria-checked/);
  assert.match(actionSource, /dispatchMouseEvent/);
  assert.doesNotMatch(actionSource, /target\.el\.click\(\)/);
});
