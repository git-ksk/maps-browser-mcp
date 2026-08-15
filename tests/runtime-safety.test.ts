import assert from "node:assert/strict";
import test from "node:test";
import type { ChromeProcess } from "../src/browser/chrome-process.js";
import { BrowserRuntimeError, MapsBrowserRuntime } from "../src/browser/runtime.js";
import type { PolicyEngine } from "../src/policy/policy-engine.js";
import type { MapsAction } from "../src/types.js";

function makeRuntime() {
  const chrome = {} as ChromeProcess;
  const policy = {
    isAllowedMapsUrl(value: string) {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "www.google.com" &&
          (url.pathname === "/maps" || url.pathname.startsWith("/maps/"));
      } catch {
        return false;
      }
    }
  } as PolicyEngine;
  return new MapsBrowserRuntime(chrome, policy);
}

function assertBoundaryCode(url: string, code: BrowserRuntimeError["code"]): void {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as {
    assertAllowedCurrentUrl(value: string, intendedAction?: MapsAction): void;
  };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl(url),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === code
  );
}

test("challenge URLs stop for human intervention", () => {
  assertBoundaryCode("https://www.google.com/sorry/index?continue=x", "HUMAN_INTERVENTION_REQUIRED");
  assertBoundaryCode("https://recaptcha.google.com/recaptcha/api2/anchor", "HUMAN_INTERVENTION_REQUIRED");
});

test("consent or sign-in surfaces outside Maps stop for human intervention", () => {
  assertBoundaryCode("https://accounts.google.com/signin/v2/identifier", "HUMAN_INTERVENTION_REQUIRED");
  assertBoundaryCode("https://consent.google.com/m", "HUMAN_INTERVENTION_REQUIRED");
});

test("blank browser state is not misclassified as a challenge", () => {
  assertBoundaryCode("about:blank", "MAPS_NOT_OPEN");
});

test("an allowed Maps surface passes the navigation boundary", () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as {
    assertAllowedCurrentUrl(value: string, intendedAction?: MapsAction): void;
  };
  assert.doesNotThrow(() => boundary.assertAllowedCurrentUrl("https://www.google.com/maps/search/Tokyo"));
});

test("UI-only semantic mutation can drop the replay action while preserving the readable view", () => {
  const runtime = makeRuntime();
  const mutable = runtime as unknown as {
    lastAction?: MapsAction;
    viewState: "directions" | "blank";
  };
  mutable.lastAction = {
    kind: "directions",
    origin: "Tokyo Station",
    destination: "Yokohama Station",
    mode: "transit"
  };
  mutable.viewState = "directions";
  const before = runtime.getResourceEpoch();

  runtime.markSemanticMutationWithoutReplayAction();

  assert.equal(runtime.getLastAction(), undefined);
  assert.equal(runtime.getViewState(), "directions");
  assert.equal(runtime.getResourceEpoch(), before + 1);
});

test("verified search suggestion adoption replaces transient suggestion state and advances epoch once", () => {
  const runtime = makeRuntime();
  const mutable = runtime as unknown as { lastAction?: MapsAction; viewState: "suggestions" | "place" | "blank" };
  mutable.lastAction = { kind: "suggestions", query: "Tokyo Station" };
  mutable.viewState = "suggestions";
  const before = runtime.getResourceEpoch();

  runtime.adoptSearchSuggestionResult("Tokyo Station", "place");

  assert.deepEqual(runtime.getLastAction(), { kind: "search", query: "Tokyo Station" });
  assert.equal(runtime.getViewState(), "place");
  assert.equal(runtime.getResourceEpoch(), before + 1);
});

test("challenge handoff preserves the canonical Maps action and invalidates stale state", () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as {
    assertAllowedCurrentUrl(value: string, intendedAction?: MapsAction): void;
  };
  const action: MapsAction = { kind: "search", query: "coffee near Tokyo Station" };

  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://www.google.com/sorry/index?continue=x", action),
    (error: unknown) => {
      if (!(error instanceof BrowserRuntimeError)) return false;
      assert.equal(error.code, "HUMAN_INTERVENTION_REQUIRED");
      assert.equal(error.intervention?.reason, "access_challenge");
      assert.equal(error.intervention?.resumePolicy, "replay_safe");
      assert.deepEqual(error.intervention?.action, action);
      return true;
    }
  );

  const intervention = runtime.getActiveIntervention();
  assert.equal(intervention?.status, "awaiting_human");
  assert.equal(intervention?.epoch, 1);
  assert.equal(runtime.getResourceEpoch(), 1);
  assert.equal(runtime.getLastAction(), undefined);
  assert.equal(runtime.getViewState(), "blank");
});

test("active intervention blocks agent CDP access before touching the browser", async () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as {
    assertAllowedCurrentUrl(value: string, intendedAction?: MapsAction): void;
  };

  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://accounts.google.com/signin/v2/identifier"),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  assert.equal(runtime.getActiveIntervention()?.reason, "sign_in");

  await assert.rejects(
    runtime.getClient(),
    (error: unknown) =>
      error instanceof BrowserRuntimeError &&
      error.code === "HUMAN_INTERVENTION_REQUIRED" &&
      error.intervention?.status === "awaiting_human"
  );
});
