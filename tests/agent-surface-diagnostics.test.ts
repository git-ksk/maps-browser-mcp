import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import type CDP from "chrome-remote-interface";
import { AUTHENTICATED_READINESS_EXPRESSION, parseAuthenticatedReadiness } from "../src/browser/authenticated-readiness.js";
import { AgentSurfaceDiagnostics, boundedObservation, classifySurface, diagnosticErrorKind, formatAgentSurfaceDiagnostic, readinessReason, PROBE_REASONS } from "../src/browser/agent-surface-diagnostics.js";

const base = { mapsSurface: true, hasSignInLink: false, hasAccountHref: false, hasAccountAria: false };
const secret = "PRIVATE_ACCOUNT_TOKEN_SHOULD_NEVER_APPEAR";

test("all readiness reason branches distinguish absence, contradiction, non-Maps and invalid evaluation", () => {
  assert.equal(readinessReason({ ...base, hasAccountHref: true }), "signed_in_controls");
  assert.equal(readinessReason({ ...base, hasSignInLink: true }), "signed_out_controls");
  assert.equal(readinessReason(base), "missing_controls");
  assert.equal(readinessReason({ ...base, hasAccountAria: true, hasSignInLink: true }), "conflicting_controls");
  assert.equal(readinessReason({ ...base, mapsSurface: false }), "not_maps");
  for (const value of [undefined, null, 1, "secret", [], {}, { ...base, hasAccountAria: undefined }]) {
    assert.equal(readinessReason(value), "invalid_probe");
  }
});

test("actual browser expression returns content-free page shape and preserves classification", () => {
  const makeElement = (aria: string, href: string, visible: boolean) => ({
    getAttribute: (key: string) => key === "href" ? href : aria,
    textContent: secret,
    getClientRects: () => visible ? [{}] : [],
  });
  for (const scenario of [
    { controls: [], result: "unknown", reason: "missing_controls" },
    { controls: [makeElement(`Google Account ${secret}`, "", true)], result: "signed_in", reason: "signed_in_controls" },
    { controls: [makeElement("Sign in", `https://accounts.google.com/ServiceLogin?${secret}`, true)], result: "signed_out", reason: "signed_out_controls" },
    { controls: [makeElement(`Google Account ${secret}`, "", false), makeElement("Sign in", "", true)], result: "unknown", reason: "conflicting_controls" }
  ]) {
    const result = vm.runInNewContext(AUTHENTICATED_READINESS_EXPRESSION, {
      document: { querySelectorAll: (selector: string) => selector === "iframe" ? [] : scenario.controls,
        readyState: "complete", visibilityState: "visible", documentElement: { lang: "ja-JP" }, body: { childElementCount: 3 } },
      location: new URL(`https://www.google.com/maps?${secret}`),
      getComputedStyle: () => ({ visibility: "visible" })
    });
    assert.equal(parseAuthenticatedReadiness(result), scenario.result);
    assert.equal(readinessReason(result), scenario.reason);
    assert.equal(result.surface, "maps");
    assert.equal(result.language, "ja");
    assert.equal(result.readyState, "complete");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }
});

test("URL classification strips path, query and authority from every output", () => {
  for (const [url, expected] of [
    [`https://www.google.com/maps?${secret}`, "maps"],
    [`https://accounts.google.com/${secret}`, "google_auth"],
    [`https://consent.google.com/${secret}`, "google_consent"],
    ["https://www.google.com/sorry/index", "google_challenge"],
    ["https://recaptcha.google.com/x", "google_challenge"],
    ["https://www.google.com/", "google_other"],
    ["about:blank", "blank"], ["chrome-error://chromewebdata/", "browser_error"],
    ["https://www.google.com.evil.example/maps", "other"], ["http://www.google.com/maps", "other"],
    [secret, "unavailable"]
  ]) assert.equal(classifySurface(url), expected);
});

test("diagnostic schema rejects unknown fields and free text even in allowlisted fields", () => {
  for (const fields of [{ url: secret }, { reason: secret }, { surface: secret }, { pages: -1 }, { pages: Infinity }, { state: secret }, { result: secret }, { errorKind: secret }]) {
    assert.throws(() => formatAgentSurfaceDiagnostic("human_verification", "probe", fields as never));
  }
  assert.throws(() => formatAgentSurfaceDiagnostic("bad" as never, "probe", {}));
  assert.throws(() => formatAgentSurfaceDiagnostic("human_verification", secret, {}));
});

test("probe logging is capped but summary keeps all reason counts and final detail", async () => {
  const lines: string[] = [];
  const d = new AgentSurfaceDiagnostics("human_verification", line => lines.push(line));
  for (let i = 0; i < 200; i++) d.probe({ ...base, hasSignInLink: i % 2 === 0, surface: secret, readyState: secret, url: secret });
  for (const reason of PROBE_REASONS) d.probe(undefined, reason);
  d.probe({ ...base, surface: "maps", readyState: "complete", visibility: "hidden", language: "ja", controls: 4 });
  await d.finish("failed");
  const events = lines.map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.event === "probe").length, 12);
  const summary = events.at(-1);
  assert.equal(summary.probeCount, 210);
  assert.equal(summary.suppressedProbes, 198);
  assert.equal(summary.reason, "missing_controls");
  assert.equal(summary.visibility, "hidden");
  assert.equal(summary.evaluationTimeouts, 1);
  assert.equal(summary.evaluationExceptions, 1);
  assert.equal(summary.evaluationRejections, 1);
  assert.doesNotMatch(lines.join(""), new RegExp(secret));
});

function fakeClient() {
  const events = new EventEmitter();
  const subscribe = (name: string) => (listener: (...args: any[]) => void) => { events.on(name, listener); return () => events.off(name, listener); };
  let enabled = 0, disabled = 0;
  const client = Object.assign(events, {
    Page: { frameNavigated: subscribe("frame"), getFrameTree: async () => ({ frameTree: { frame: { id: "private-main", url: "about:blank" } } }) },
    Runtime: { executionContextsCleared: subscribe("clear"), exceptionThrown: subscribe("exception") },
    Inspector: { targetCrashed: subscribe("crash"), enable: async () => {}, disable: async () => {} },
    Network: { responseReceived: subscribe("response"), requestWillBeSent: subscribe("request"), loadingFailed: subscribe("failure"),
      enable: async () => { enabled++; }, disable: async () => { disabled++; } }
  });
  return { client: client as unknown as CDP.Client, events, counts: () => ({ enabled, disabled }) };
}

test("CDP observer aggregates navigation/network/context/crash facts without retaining payloads and detaches", async () => {
  const { client, events, counts } = fakeClient();
  const lines: string[] = [];
  const d = new AgentSurfaceDiagnostics("human_verification", line => lines.push(line));
  await d.attach(client, true);
  events.emit("frame", { frame: { id: "private-main", url: `https://www.google.com/maps?${secret}` } });
  events.emit("frame", { frame: { id: "private-child", parentId: "private-main", url: secret } });
  events.emit("clear"); events.emit("exception", { exceptionDetails: { text: secret } }); events.emit("crash"); events.emit("disconnect");
  events.emit("response", { type: "Document", frameId: "private-main", response: { status: 503, url: secret, headers: { authorization: secret } } });
  events.emit("response", { type: "Document", frameId: "private-child", response: { status: 200 } });
  events.emit("response", { type: "Script", response: { status: 404 } });
  events.emit("request", { redirectResponse: { url: secret }, request: { postData: secret } });
  events.emit("failure", { type: "Document", errorText: "net::ERR_NAME_NOT_RESOLVED" });
  events.emit("failure", { type: "Script", errorText: secret });
  await d.finish("failed");
  assert.deepEqual(counts(), { enabled: 1, disabled: 1 });
  assert.equal(events.eventNames().length, 0);
  const summary = JSON.parse(lines.at(-1)!);
  assert.equal(summary.mainNavigations, 1);
  assert.equal(summary.mainFrameSurface, "maps");
  assert.equal(summary.documentResponses, 2);
  assert.equal(summary.mainDocumentResponses, 1);
  assert.equal(summary.lastDocumentStatus, 503);
  assert.equal(summary.httpErrors, 2);
  assert.equal(summary.runtimeExceptions, 1);
  assert.equal(summary.contextClears, 1);
  assert.equal(summary.crashes, 1);
  assert.equal(summary.crashObserverEnabled, true);
  assert.equal(summary.disconnects, 1);
  assert.equal(summary.loadingFailures, 2);
  assert.equal(summary.networkError, "other");
  assert.doesNotMatch(lines.join(""), new RegExp(`${secret}|private-main|private-child|authorization|postData`));
});

test("missing observer support and collector failures never replace the original operation error", async () => {
  const lines: string[] = [];
  const d = new AgentSurfaceDiagnostics("post_checkpoint", line => lines.push(line));
  await d.attach({} as CDP.Client, true);
  const original = Object.assign(new Error(secret), { code: "ECONNRESET" });
  await assert.rejects(d.step("connect", async () => { throw original; }), error => error === original);
  await d.finish("failed");
  assert.equal(JSON.parse(lines.at(-1)!).observerAvailable, false);
  assert.ok(lines.some(line => line.includes('"errorKind":"transport"')));
  assert.doesNotMatch(lines.join(""), new RegExp(secret));
  const broken = new AgentSurfaceDiagnostics("post_checkpoint", () => { throw new Error(secret); });
  assert.equal(await broken.step("read", async () => 42), 42);
  await broken.finish("completed");
});

test("target inventories detect ambiguous/restored/disappeared pages without target identifiers", async () => {
  const lines: string[] = [];
  const d = new AgentSurfaceDiagnostics("human_verification", line => lines.push(line));
  d.selected("private-target");
  d.targets([{ type: "page", id: "private-target", url: "https://www.google.com/maps" }, { type: "page", id: secret, url: "https://www.google.com/maps" }], "ambiguous");
  d.targets([{ type: "page", id: secret, url: "about:blank" }], "final", "private-target");
  assert.equal(JSON.parse(lines[0]!).mapsPages, 2);
  assert.equal(JSON.parse(lines[1]!).targetPresent, false);
  assert.equal(JSON.parse(lines[1]!).sameTarget, false);
  assert.doesNotMatch(lines.join(""), new RegExp(`${secret}|private-target`));
});

test("observation timeout and error categories stay bounded and content-free", async () => {
  await assert.rejects(boundedObservation(new Promise(() => {}), 5), error => diagnosticErrorKind(error) === "timeout");
  assert.equal(diagnosticErrorKind(new Error(`Execution context was destroyed ${secret}`)), "context_destroyed");
  assert.equal(diagnosticErrorKind(new Error(`Target closed ${secret}`)), "target_closed");
  assert.equal(diagnosticErrorKind(new Error(secret)), "other");
});

for (const [label, response, expected] of [
  ["exception", async () => ({ result: {}, exceptionDetails: { text: secret } }), "evaluation_exception"],
  ["malformed", async () => ({}), "invalid_probe"],
  ["rejected", async () => { throw new Error(`Execution context was destroyed ${secret}`); }, "evaluation_rejected"],
  ["timeout", async () => new Promise(() => {}), "evaluation_timeout"]
] as const) {
  test(`runtime emits probe failure and final summary on ${label}`, async () => {
    const { MapsBrowserRuntime } = await import("../src/browser/runtime.js");
    const lines: string[] = [];
    const originalLog = console.error;
    console.error = (...values: unknown[]) => lines.push(values.join(" "));
    try {
      const runtime = new MapsBrowserRuntime({} as never, {} as never);
      const mutable = runtime as unknown as {
        assertMapsSurface: () => Promise<void>;
        getClient: () => Promise<unknown>;
      };
      mutable.assertMapsSurface = async () => {};
      mutable.getClient = async () => ({ Runtime: { evaluate: response }, Target: { getTargets: async () => ({ targetInfos: [] }) } });
      if (label === "rejected" || label === "timeout") await assert.rejects(runtime.readAuthenticatedReadiness());
      else assert.equal(await runtime.readAuthenticatedReadiness(), "unknown");
    } finally { console.error = originalLog; }
    const records = lines.filter(line => line.includes('"type":"agent_surface_diagnostics"')).map(line => JSON.parse(line.slice(line.indexOf("{"))));
    assert.ok(records.some(record => record.event === "probe" && record.reason === expected));
    assert.equal(records.at(-1)?.event, "summary");
    assert.equal(records.at(-1)?.phase, "ordinary_readiness");
    assert.doesNotMatch(lines.join(""), new RegExp(secret));
  });
}

test("observer cleanup failures are explicit and never change the operation outcome", async () => {
  const { client } = fakeClient();
  client.Network.disable = async () => { throw new Error(secret); };
  const lines: string[] = [];
  const d = new AgentSurfaceDiagnostics("post_checkpoint", line => lines.push(line));
  await d.attach(client, true);
  await d.finish("completed");
  assert.equal(JSON.parse(lines.at(-1)!).cleanupState, "failed");
  assert.doesNotMatch(lines.join(""), new RegExp(secret));
});

test("runtime identifies Chrome startup failure separately from CDP attachment", async () => {
  const { MapsBrowserRuntime } = await import("../src/browser/runtime.js");
  const lines: string[] = [];
  const originalLog = console.error;
  console.error = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    const runtime = new MapsBrowserRuntime({ start: async () => { throw new Error(secret); } } as never, {} as never);
    await assert.rejects(runtime.readAuthenticatedReadiness());
  } finally { console.error = originalLog; }
  assert.ok(lines.some(line => line.includes('"stage":"chrome_start"') && line.includes('"state":"failed"')));
  assert.ok(lines.some(line => line.includes('"event":"summary"') && line.includes('"result":"failed"')));
  assert.doesNotMatch(lines.join(""), new RegExp(secret));
});
