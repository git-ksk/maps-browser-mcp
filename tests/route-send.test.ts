import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRouteSendActionProbe,
  parseRouteSendConfirmationSnapshot,
  parseRouteSendPostconditionProbe,
  parseRouteSendTargetsProbe,
  readVerifiedRouteSendTargets,
  resolveFreshRouteSendTarget,
  sendVerifiedRouteToDevice
} from "../src/browser/route-send.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

const identity = {
  expectedOrigin: "Tokyo Station",
  expectedDestination: "Shibuya Station",
  expectedRouteIndex: 0,
  expectedRouteLabel: "12 min via Route A"
};
const actionInput = { ...identity, deviceIndex: 0, expectedDeviceLabel: "Test Phone" };

function fakeRuntime(input: {
  evaluations?: unknown[];
  readiness?: "signed_in" | "signed_out" | "unknown";
  epoch?: number;
  selectedRoute?: { index: number; label: string };
  view?: "route" | "directions";
  lastAction?: unknown;
  assertErrorAt?: number;
}) {
  let evaluationIndex = 0;
  let assertCount = 0;
  let epoch = input.epoch ?? 9;
  let mutationCount = 0;
  let invalidationCount = 0;
  let keyEvents = 0;
  const client = {
    Runtime: {
      async evaluate() {
        return { result: { value: input.evaluations?.[evaluationIndex++] } };
      }
    },
    Input: {
      async dispatchKeyEvent() { keyEvents += 1; }
    }
  };
  const runtime = {
    async assertDirectionsContext() {
      if (input.assertErrorAt === assertCount++) throw new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", "challenge");
    },
    async assertMapsSurface() {},
    getViewState() { return input.view ?? "route"; },
    async readAuthenticatedReadiness() { return input.readiness ?? "signed_in"; },
    getLastAction() {
      return input.lastAction ?? { kind: "directions", origin: "Tokyo Station", destination: "Shibuya Station", mode: "driving" };
    },
    getSelectedRoute() { return input.selectedRoute ?? { index: 0, label: "12 min via Route A" }; },
    getResourceEpoch() { return epoch; },
    async getClient() { return client; },
    markSemanticMutationWithoutReplayAction() { mutationCount += 1; epoch += 1; },
    invalidateSemanticContext() { invalidationCount += 1; epoch += 1; },
    getActiveIntervention() { return undefined; }
  } as unknown as MapsBrowserRuntime;
  return {
    runtime,
    evaluations: () => evaluationIndex,
    mutations: () => mutationCount,
    invalidations: () => invalidationCount,
    keyEvents: () => keyEvents,
    epoch: () => epoch
  };
}

test("parses bounded device identities and rejects duplicates or email targets", () => {
  assert.deepEqual(
    parseRouteSendTargetsProbe({ ok: true, rows: [{ label: "Phone A" }, { label: "Phone B" }], total: 2 }),
    [{ index: 0, label: "Phone A" }, { index: 1, label: "Phone B" }]
  );
  assert.throws(
    () => parseRouteSendTargetsProbe({ ok: true, rows: [{ label: "Phone A" }, { label: " phone a " }], total: 2 }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parseRouteSendTargetsProbe({ ok: true, rows: [{ label: "user@example.test" }], total: 1 }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(parseRouteSendTargetsProbe({ ok: false, reason: "pending" }), undefined);
});

test("fresh device target requires exact index plus unique expected label", () => {
  const devices = [{ index: 0, label: "Phone A" }, { index: 1, label: "Phone B" }];
  assert.deepEqual(resolveFreshRouteSendTarget(devices, 1, "Phone B"), devices[1]);
  assert.throws(() => resolveFreshRouteSendTarget(devices, 1, "Phone A"), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(() => resolveFreshRouteSendTarget(devices, 2, "Phone B"), isRuntimeCode("UI_STATE_CHANGED"));
  assert.throws(
    () => resolveFreshRouteSendTarget([{ index: 0, label: "Phone A" }, { index: 1, label: "phone a" }], 0, "Phone A"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("action and postcondition probes fail closed on stale or ambiguous device state", () => {
  assert.deepEqual(
    parseRouteSendActionProbe({ ok: true, index: 0, label: "Test Phone", clicked: false }, 0, "Test Phone"),
    { index: 0, label: "Test Phone", clicked: false }
  );
  for (const reason of ["ambiguous_dialog", "duplicate_device", "target_missing", "target_mismatch"]) {
    assert.throws(() => parseRouteSendActionProbe({ ok: false, reason }, 0, "Test Phone"), isRuntimeCode("UI_STATE_CHANGED"));
  }
  assert.deepEqual(
    parseRouteSendConfirmationSnapshot({ ok: true, texts: ["Old status", " old status ", ""] }),
    ["Old status"]
  );
  assert.throws(() => parseRouteSendConfirmationSnapshot({ ok: false }), isRuntimeCode("UI_STATE_CHANGED"));
  const baseline = ["Test Phone にルートを送信"];
  assert.equal(
    parseRouteSendPostconditionProbe({ ok: true, texts: ["Test Phone に送信されました", "Test Phone に送信されました"] }, "Test Phone", baseline),
    true
  );
  assert.equal(
    parseRouteSendPostconditionProbe({ ok: true, texts: ["Test Phone にルートを送信"] }, "Test Phone", baseline),
    undefined
  );
  assert.equal(
    parseRouteSendPostconditionProbe({ ok: true, texts: ["Other Phone に送信されました"] }, "Test Phone", baseline),
    undefined
  );
  assert.throws(
    () => parseRouteSendPostconditionProbe({ ok: true, texts: ["Test Phone sent", "Send complete: Test Phone"] }, "Test Phone", baseline),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("read targets requires signed-in exact selected simple route and closes the dialog", async () => {
  const fake = fakeRuntime({ evaluations: [{ ok: true }, { ok: true, rows: [{ label: "Test Phone" }], total: 1 }] });
  const result = await readVerifiedRouteSendTargets(fake.runtime, identity);
  assert.equal(result.routeIndex, 0);
  assert.equal(result.routeLabel, "12 min via Route A");
  assert.deepEqual(result.devices, [{ index: 0, label: "Test Phone" }]);
  assert.equal(fake.keyEvents(), 2);

  const signedOut = fakeRuntime({ readiness: "signed_out" });
  await assert.rejects(() => readVerifiedRouteSendTargets(signedOut.runtime, identity), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(signedOut.evaluations(), 0);
  assert.equal(signedOut.keyEvents(), 0);

  const changedRoute = fakeRuntime({ selectedRoute: { index: 1, label: "Other route" } });
  await assert.rejects(() => readVerifiedRouteSendTargets(changedRoute.runtime, identity), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(changedRoute.evaluations(), 0);
  assert.equal(changedRoute.keyEvents(), 0);

  const waypoint = fakeRuntime({
    lastAction: { kind: "directions", origin: "Tokyo Station", destination: "Shibuya Station", mode: "driving", waypoints: ["Other"] }
  });
  await assert.rejects(() => readVerifiedRouteSendTargets(waypoint.runtime, identity), isRuntimeCode("UI_STATE_CHANGED"));
});

test("approved send consumes approval exactly once immediately before one device click and verifies confirmation", async () => {
  const fake = fakeRuntime({
    evaluations: [
      { ok: true },
      { ok: true, rows: [{ label: "Test Phone" }], total: 1 },
      { ok: true, index: 0, label: "Test Phone", clicked: false },
      { ok: true, texts: ["Previous status", "Previous status"] },
      { ok: true, index: 0, label: "Test Phone", clicked: true },
      { ok: true, texts: ["Test Phone に送信されました", "Test Phone に送信されました"] }
    ]
  });
  const before = fake.epoch();
  let consumed = 0;
  const result = await sendVerifiedRouteToDevice(fake.runtime, actionInput, before, () => { consumed += 1; });
  assert.equal(result.sent, true);
  assert.equal(consumed, 1);
  assert.equal(fake.mutations(), 1);
  assert.equal(fake.invalidations(), 0);
  assert.equal(fake.epoch(), before + 1);
  assert.equal(fake.evaluations(), 6);
});

test("approval failure or stale epoch prevents the device click", async () => {
  const approvalFailure = fakeRuntime({
    evaluations: [
      { ok: true },
      { ok: true, rows: [{ label: "Test Phone" }], total: 1 },
      { ok: true, index: 0, label: "Test Phone", clicked: false },
      { ok: true, texts: [] }
    ]
  });
  await assert.rejects(
    () => sendVerifiedRouteToDevice(approvalFailure.runtime, actionInput, approvalFailure.epoch(), () => { throw new Error("approval rejected"); }),
    /approval rejected/
  );
  assert.equal(approvalFailure.evaluations(), 4);
  assert.equal(approvalFailure.invalidations(), 0);

  const stale = fakeRuntime({ epoch: 12, evaluations: [{ ok: true }, { ok: true, rows: [{ label: "Test Phone" }], total: 1 }] });
  let consumed = 0;
  await assert.rejects(() => sendVerifiedRouteToDevice(stale.runtime, actionInput, 11, () => { consumed += 1; }), isRuntimeCode("UI_STATE_CHANGED"));
  assert.equal(consumed, 0);
  assert.equal(stale.evaluations(), 2);
});

test("unverified postcondition fails without retrying the send and invalidates stale semantic context", async () => {
  const fake = fakeRuntime({
    evaluations: [
      { ok: true },
      { ok: true, rows: [{ label: "Test Phone" }], total: 1 },
      { ok: true, index: 0, label: "Test Phone", clicked: false },
      { ok: true, texts: ["Test Phone にルートを送信"] },
      { ok: true, index: 0, label: "Test Phone", clicked: true },
      { ok: false, reason: "pending" }
    ]
  });
  let consumed = 0;
  await assert.rejects(
    () => sendVerifiedRouteToDevice(fake.runtime, actionInput, fake.epoch(), () => { consumed += 1; }, { postconditionTimeoutMs: 0, pollIntervalMs: 0 }),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.equal(consumed, 1);
  assert.equal(fake.mutations(), 0);
  assert.equal(fake.invalidations(), 1);
  assert.equal(fake.evaluations(), 5);
});

test("Human Intervention stops route-send target reads before dialog interaction", async () => {
  const fake = fakeRuntime({ assertErrorAt: 0 });
  await assert.rejects(
    () => readVerifiedRouteSendTargets(fake.runtime, identity),
    isRuntimeCode("HUMAN_INTERVENTION_REQUIRED")
  );
  assert.equal(fake.evaluations(), 0);
  assert.equal(fake.keyEvents(), 0);
});

test("V5-D source exposes no credential, generic text-entry, network interception, or raw account-identity path", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../src/browser/route-send.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "document.cookie",
    "localStorage",
    "sessionStorage",
    "XMLHttpRequest",
    "performance.getEntries",
    "accounts.google.com",
    "querySelectorAll('input",
    "querySelectorAll(\"input",
    "textarea"
  ]) {
    assert.equal(source.includes(forbidden), false, `route-send source must not contain ${forbidden}`);
  }
  assert.match(source, /EMAIL_MARKERS/);
  assert.equal(source.includes("getAttribute('role')==='checkbox'"), true);
  assert.match(source, /sendConfirmationSnapshotExpression/);
  assert.match(source, /baseline = new Set/);
  assert.match(source, /do not automatically retry/);
  assert.equal((source.match(/targetDeviceExpression\(input\.deviceIndex, expectedDevice, true\)/g) ?? []).length, 1);
});
