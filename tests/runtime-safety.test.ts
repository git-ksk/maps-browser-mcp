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



test("explicit Human sign-in request never automates credentials and begins a never-replay sign-in intervention", async () => {
  const runtime = makeRuntime();
  runtime.readAuthenticatedReadiness = async () => "signed_out";

  await assert.rejects(
    runtime.requestHumanSignIn(),
    (error: unknown) => {
      if (!(error instanceof BrowserRuntimeError)) return false;
      assert.equal(error.code, "HUMAN_INTERVENTION_REQUIRED");
      assert.equal(error.intervention?.reason, "sign_in");
      assert.equal(error.intervention?.resumePolicy, "never_replay");
      assert.equal(error.intervention?.action, undefined);
      return true;
    }
  );
});

test("explicit Human sign-in request is a no-op when already signed in and fails closed on unknown readiness", async () => {
  const signedIn = makeRuntime();
  signedIn.readAuthenticatedReadiness = async () => "signed_in";
  assert.deepEqual(await signedIn.requestHumanSignIn(), { state: "signed_in" });

  const unknown = makeRuntime();
  unknown.readAuthenticatedReadiness = async () => "unknown";
  await assert.rejects(
    unknown.requestHumanSignIn(),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "UI_STATE_CHANGED"
  );
});

test("credential-safe browser suspension keeps Human authority active while stopping managed Chrome", async () => {
  let closed = 0;
  const chrome = { async close() { closed += 1; } } as ChromeProcess;
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
  const runtime = new MapsBrowserRuntime(chrome, policy);
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://accounts.google.com/signin/v2/identifier"),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  const awaiting = runtime.getActiveIntervention();
  assert.ok(awaiting);
  const human = runtime.claimHumanControl(awaiting.id);
  const epochBefore = runtime.getResourceEpoch();

  await runtime.suspendAutomationForCredentialSafeHumanControl(human.id, human.epoch);

  assert.equal(closed, 1);
  assert.equal(runtime.getActiveIntervention()?.status, "human_active");
  assert.equal(runtime.getActiveIntervention()?.authority, "human");
  assert.equal(runtime.getResourceEpoch(), epochBefore);
  await assert.rejects(
    runtime.getClient(),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
});


test("Thin Takeover suspension detaches automation while preserving the same browser session", async () => {
  let suspended = 0;
  let closed = 0;
  const hosted = {
    async start() { return { kind: "browser_websocket" as const, websocketUrl: "wss://example.invalid/session" }; },
    async suspendForHuman() { suspended += 1; },
    async close() { closed += 1; }
  };
  const policy = {
    isAllowedMapsUrl(value: string) {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "www.google.com" &&
          (url.pathname === "/maps" || url.pathname.startsWith("/maps/"));
      } catch { return false; }
    }
  } as PolicyEngine;
  const runtime = new MapsBrowserRuntime(hosted, policy);
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://accounts.google.com/ServiceLogin"),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  const awaiting = runtime.getActiveIntervention();
  assert.ok(awaiting);
  const human = runtime.claimHumanControl(awaiting.id);

  await runtime.suspendAutomationForCredentialSafeHumanControl(human.id, human.epoch, { preserveBrowserSession: true });

  assert.equal(suspended, 0);
  assert.equal(closed, 0);
  assert.equal(runtime.getActiveIntervention()?.authority, "human");
});



test("Thin Takeover revoke closes Human-owned CDP before automation can reconnect", async () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://accounts.google.com/ServiceLogin"),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  const awaiting = runtime.getActiveIntervention();
  assert.ok(awaiting);
  const human = runtime.claimHumanControl(awaiting.id);

  let closed = 0;
  const mutable = runtime as unknown as {
    client?: { close(): Promise<void> };
    clientOwner?: "automation" | "human";
    endpoint?: unknown;
  };
  mutable.client = { async close() { closed += 1; } };
  mutable.clientOwner = "human";
  mutable.endpoint = { kind: "local_port", port: 9222 };

  await runtime.releaseHumanTakeoverConnection(human.id, human.epoch);

  assert.equal(closed, 1);
  assert.equal(mutable.client, undefined);
  assert.equal(mutable.clientOwner, undefined);
  assert.equal(mutable.endpoint, undefined);
});

test("Thin Takeover release fails closed if Agent-owned CDP authority appears during Human control", async () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://accounts.google.com/ServiceLogin"),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  const awaiting = runtime.getActiveIntervention();
  assert.ok(awaiting);
  const human = runtime.claimHumanControl(awaiting.id);
  const mutable = runtime as unknown as { client?: { close(): Promise<void> }; clientOwner?: "automation" | "human" };
  mutable.client = { async close() {} };
  mutable.clientOwner = "automation";

  await assert.rejects(
    runtime.releaseHumanTakeoverConnection(human.id, human.epoch),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "UI_STATE_CHANGED"
  );
});

test("selected route identity is bounded semantic state and is cleared by later semantic mutation", () => {
  const runtime = makeRuntime();
  const mutable = runtime as unknown as {
    lastAction?: MapsAction;
    selectedRoute?: { index: number; label: string };
    viewState: "route" | "blank";
  };
  mutable.lastAction = { kind: "directions", origin: "A", destination: "B", mode: "driving" };
  mutable.selectedRoute = { index: 2, label: "15 min via Example" };
  mutable.viewState = "route";
  assert.deepEqual(runtime.getSelectedRoute(), { index: 2, label: "15 min via Example" });
  runtime.markSemanticMutationWithoutReplayAction();
  assert.equal(runtime.getSelectedRoute(), undefined);
});

test("Human takeover frame stream uses CDP screencast push with bounded latest-frame delivery", async () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl("https://accounts.google.com/ServiceLogin"),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === "HUMAN_INTERVENTION_REQUIRED"
  );
  const awaiting = runtime.getActiveIntervention();
  assert.ok(awaiting);
  const human = runtime.claimHumanControl(awaiting.id);

  let frameHandler: ((frame: { data: string; sessionId: number }) => void) | undefined;
  let navigationHandler: ((event: { frame: { url: string; parentId?: string } }) => void) | undefined;
  let acked = 0;
  let stopped = 0;
  let startOptions: Record<string, unknown> | undefined;
  const fakeClient = {
    Runtime: {
      async evaluate(input: { expression: string }) {
        if (input.expression === "location.href") {
          return { result: { value: "https://accounts.google.com/ServiceLogin" } };
        }
        if (input.expression.includes("innerWidth")) {
          return { result: { value: { width: 900, height: 700 } } };
        }
        return { result: { value: 1 } };
      }
    },
    Page: {
      screencastFrame(handler: typeof frameHandler) {
        frameHandler = handler;
        return () => { frameHandler = undefined; };
      },
      frameNavigated(handler: typeof navigationHandler) {
        navigationHandler = handler;
        return () => { navigationHandler = undefined; };
      },
      async startScreencast(options: Record<string, unknown>) {
        startOptions = options;
        queueMicrotask(() => frameHandler?.({
          data: Buffer.from("jpeg-frame").toString("base64"),
          sessionId: 11
        }));
      },
      async screencastFrameAck(input: { sessionId: number }) {
        assert.equal(input.sessionId, 11);
        acked += 1;
      },
      async stopScreencast() { stopped += 1; }
    }
  };
  const mutableRuntime = runtime as unknown as { client: unknown; clientOwner?: "automation" | "human" };
  mutableRuntime.client = fakeClient;
  mutableRuntime.clientOwner = "human";

  const controller = new AbortController();
  const stream = runtime.streamHumanTakeoverFrames(human.id, human.epoch, controller.signal);
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value, {
    data: Buffer.from("jpeg-frame").toString("base64"),
    width: 900,
    height: 700,
    hostname: "accounts.google.com",
    mimeType: "image/jpeg"
  });
  assert.deepEqual(startOptions, {
    format: "jpeg",
    quality: 75,
    maxWidth: 900,
    maxHeight: 700,
    everyNthFrame: 1
  });
  assert.equal(acked, 1);

  controller.abort();
  await iterator.return?.();
  assert.equal(stopped, 1);
  assert.equal(frameHandler, undefined);
  assert.equal(navigationHandler, undefined);
});
