import assert from "node:assert/strict";
import test from "node:test";
import type {
  ManagedOperatorDiagnosticEvent,
  ManagedOperatorDiagnosticsSnapshot
} from "mcp-execution-handoff/browser-takeover";
import { formatManagedHandoffDiagnosticsLog } from "../src/browser/handoff-diagnostics-log.js";

function snapshot(): ManagedOperatorDiagnosticsSnapshot {
  return {
    version: 1,
    source: "browser_handoff",
    namespace: "managed_handoff",
    health: "failed",
    currentTransport: "websocket_relay",
    previousTransport: "webrtc_direct",
    generation: 2,
    transitionCount: 1,
    fallbackReason: "transport_unavailable",
    wss: {
      namespace: "managed_wss",
      channelState: "failed",
      channelFailure: "transport_failure",
      disconnectKind: "channel_failure",
      framesObserved: 3,
      framesSent: 2,
      framesDropped: 1,
      surfaceFailure: "input_timeout",
      inputAttempts: 1,
      lastInputStage: "pointer_down_sent",
      lastInputBoundaryStage: "command_sent",
      helperStopReason: "input_failure",
      helperCrashReason: "none",
      helperExitKind: "none",
      helperCrashClass: "none",
      helperCrashOrigin: "none",
      helperCrashErrorKind: "none",
      helperCrashMessageClass: "xtest_helper_ack_timeout",
      authorityBoundary: "valid",
      sessionDisposition: "retained"
    },
    events: [
      { kind: "transport_transition" },
      { kind: "wss_open" },
      { kind: "input_dispatch_failure" },
      { kind: "wss_failed" },
      { kind: "session_retained" }
    ]
  };
}

test("managed Handoff production log stays strict and content-free", () => {
  const event: ManagedOperatorDiagnosticEvent = { kind: "wss_failed" };
  const encoded = formatManagedHandoffDiagnosticsLog(event, snapshot());
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  assert.equal(parsed.type, "managed_handoff_diagnostics");
  assert.equal(parsed.event, "wss_failed");
  assert.deepEqual(Object.keys(parsed).sort(), ["diagnostics", "event", "type"]);
  assert.doesNotMatch(encoded, /credential|passkey|cookie|token|humanInput|framebuffer|processId|windowId|principal|interventionId|sessionId|iceCandidate|sdp|accountIdentity/i);
});

test("managed Handoff production log rejects consumer-added identity or payload fields", () => {
  const event: ManagedOperatorDiagnosticEvent = { kind: "wss_failed" };
  for (const field of ["sessionId", "windowId", "humanInput", "credential", "iceCandidate"]) {
    assert.throws(
      () => formatManagedHandoffDiagnosticsLog(event, { ...snapshot(), [field]: "forbidden" } as ManagedOperatorDiagnosticsSnapshot),
      /Invalid managed operator diagnostics snapshot/
    );
  }
});

test("managed Handoff pre-takeover checkpoint uses the same strict content-free snapshot", async () => {
  const { formatManagedHandoffDiagnosticsCheckpointLog } = await import("../src/browser/handoff-diagnostics-log.js");
  const encoded = formatManagedHandoffDiagnosticsCheckpointLog("before_takeover", snapshot());
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  assert.equal(parsed.type, "managed_handoff_diagnostics");
  assert.equal(parsed.checkpoint, "before_takeover");
  assert.deepEqual(Object.keys(parsed).sort(), ["checkpoint", "diagnostics", "type"]);
  assert.doesNotMatch(encoded, /credential|passkey|cookie|token|humanInput|framebuffer|processId|windowId|principal|interventionId|sessionId|iceCandidate|sdp|accountIdentity/i);
});
