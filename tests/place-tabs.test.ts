import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePlaceTabActionProbe,
  parsePlaceTabPostconditionProbe,
  selectVerifiedPlaceTab
} from "../src/browser/place-tabs.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("place tab action accepts only observed place-bound Overview/About labels", () => {
  assert.deepEqual(
    parsePlaceTabActionProbe(
      {
        ok: true,
        placeLabel: "Saza Coffee",
        tabLabel: "Overview of Saza Coffee",
        alreadySelected: true
      },
      " saza  coffee ",
      "overview"
    ),
    {
      placeLabel: "Saza Coffee",
      tabLabel: "Overview of Saza Coffee",
      alreadySelected: true
    }
  );

  assert.deepEqual(
    parsePlaceTabActionProbe(
      {
        ok: true,
        placeLabel: "東京駅",
        tabLabel: "「東京駅」について",
        alreadySelected: false
      },
      "東京駅",
      "about"
    ),
    {
      placeLabel: "東京駅",
      tabLabel: "「東京駅」について",
      alreadySelected: false
    }
  );

  assert.throws(
    () => parsePlaceTabActionProbe(
      { ok: true, placeLabel: "Other Place", tabLabel: "Overview of Other Place", alreadySelected: false },
      "Saza Coffee",
      "overview"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parsePlaceTabActionProbe(
      { ok: true, placeLabel: "Saza Coffee", tabLabel: "Reviews of Saza Coffee", alreadySelected: false },
      "Saza Coffee",
      "overview"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("place tab action fails closed on missing, duplicate, or stale targets", () => {
  assert.throws(
    () => parsePlaceTabActionProbe({ ok: false, reason: "missing_tab" }, "Saza Coffee", "about"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
  for (const reason of ["changed", "ambiguous_place", "ambiguous_tab"]) {
    assert.throws(
      () => parsePlaceTabActionProbe({ ok: false, reason }, "Saza Coffee", "about"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
});

test("place tab postcondition requires selected=true and exact place-bound tab identity", () => {
  assert.equal(
    parsePlaceTabPostconditionProbe(
      { ok: true, placeLabel: "Saza Coffee", tabLabel: "About Saza Coffee", selected: true },
      "Saza Coffee",
      "about"
    ),
    true
  );
  assert.equal(
    parsePlaceTabPostconditionProbe(
      { ok: true, placeLabel: "Saza Coffee", tabLabel: "About Saza Coffee", selected: false },
      "Saza Coffee",
      "about"
    ),
    false
  );
  for (const reason of ["changed", "ambiguous_place", "ambiguous_tab", "missing_tab"]) {
    assert.throws(
      () => parsePlaceTabPostconditionProbe({ ok: false, reason }, "Saza Coffee", "about"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }
});

function fakeRuntime(input: {
  evaluations?: unknown[];
  assertErrors?: Map<number, BrowserRuntimeError>;
  initialEpoch?: number;
}) {
  let evaluateIndex = 0;
  let assertIndex = 0;
  let epoch = input.initialEpoch ?? 7;
  let mutationCount = 0;
  let invalidationCount = 0;
  const client = {
    Runtime: {
      async evaluate() {
        const value = input.evaluations?.[evaluateIndex++];
        return { result: { value } };
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
    async getClient() {
      return client;
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
    },
    getResourceEpoch() {
      return epoch;
    }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    mutationCount: () => mutationCount,
    invalidationCount: () => invalidationCount,
    epoch: () => epoch,
    evaluations: () => evaluateIndex
  };
}

test("verified place tab selection advances resource epoch only after a valid postcondition", async () => {
  const fake = fakeRuntime({
    evaluations: [
      {
        ok: true,
        placeLabel: "Saza Coffee",
        tabLabel: "About Saza Coffee",
        alreadySelected: false
      },
      {
        ok: true,
        placeLabel: "Saza Coffee",
        tabLabel: "About Saza Coffee",
        selected: true
      }
    ]
  });

  const before = fake.epoch();
  const result = await selectVerifiedPlaceTab(fake.runtime, "Saza Coffee", "about");
  assert.deepEqual(result, {
    selected: true,
    placeLabel: "Saza Coffee",
    tab: "about",
    alreadySelected: false,
    source: "google_maps_place_tabs"
  });
  assert.equal(fake.mutationCount(), 1);
  assert.equal(fake.epoch(), before + 1);
});

test("already-selected place tab is idempotent and does not advance resource epoch", async () => {
  const fake = fakeRuntime({
    evaluations: [
      {
        ok: true,
        placeLabel: "Saza Coffee",
        tabLabel: "Overview of Saza Coffee",
        alreadySelected: true
      }
    ]
  });

  const before = fake.epoch();
  const result = await selectVerifiedPlaceTab(fake.runtime, "Saza Coffee", "overview");
  assert.equal(result.alreadySelected, true);
  assert.equal(fake.evaluations(), 1);
  assert.equal(fake.mutationCount(), 0);
  assert.equal(fake.epoch(), before);
});

test("verified place tab selection propagates unexpected navigation and invalid postconditions", async () => {
  const action = {
    ok: true,
    placeLabel: "Saza Coffee",
    tabLabel: "About Saza Coffee",
    alreadySelected: false
  };

  const navigation = fakeRuntime({
    evaluations: [action],
    assertErrors: new Map([
      [1, new BrowserRuntimeError("UI_STATE_CHANGED", "left place view")]
    ])
  });
  await assert.rejects(
    () => selectVerifiedPlaceTab(navigation.runtime, "Saza Coffee", "about"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(navigation.mutationCount(), 0);
  assert.equal(navigation.invalidationCount(), 1);

  const invalidPostcondition = fakeRuntime({
    evaluations: [action, { ok: false, reason: "ambiguous_tab" }]
  });
  await assert.rejects(
    () => selectVerifiedPlaceTab(invalidPostcondition.runtime, "Saza Coffee", "about"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(invalidPostcondition.mutationCount(), 0);
  assert.equal(invalidPostcondition.invalidationCount(), 1);
});

test("verified place tab selection stops at Human Intervention before acting", async () => {
  const human = fakeRuntime({
    assertErrors: new Map([
      [0, new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge")]
    ])
  });
  await assert.rejects(
    () => selectVerifiedPlaceTab(human.runtime, "Saza Coffee", "about"),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(human.evaluations(), 0);
  assert.equal(human.mutationCount(), 0);
});
