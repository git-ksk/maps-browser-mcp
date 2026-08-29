import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserHandoffAdapter, BrowserHandoffStartRequest } from "mcp-execution-handoff/browser-takeover";
import { WebRtcCredentialTakeoverBoundary } from "../src/browser/webrtc-credential-takeover-boundary.js";

function fakeHandoff(calls: string[]): BrowserHandoffAdapter {
  return {
    start(request: BrowserHandoffStartRequest) {
      calls.push(
        `start:${request.intervention.id}:${request.intervention.epoch}:${request.principalBinding}`
        + `:${request.target.processId}:${request.target.windowId ?? "none"}:${JSON.stringify(request.inputPolicy)}`
      );
      return "https://takeover.example/takeover/webrtc-locator";
    },
    operatorDiagnosticsSnapshot() {
      calls.push("diagnostics");
      return {
        version: 1,
        source: "browser_handoff",
        health: "available",
        transport: {
          namespace: "managed_handoff",
          currentTransport: "websocket_relay",
          lastTransport: "websocket_relay",
          generation: 2,
          transitionCount: 1
        }
      };
    },
    async revoke(interventionId: string) {
      calls.push(`revoke:${interventionId}`);
    }
  } as unknown as BrowserHandoffAdapter;
}

test("WebRTC credential boundary supports macOS and Linux but fails closed elsewhere", () => {
  assert.doesNotThrow(() => new WebRtcCredentialTakeoverBoundary(fakeHandoff([]), "darwin"));
  assert.doesNotThrow(() => new WebRtcCredentialTakeoverBoundary(fakeHandoff([]), "linux"));
  assert.throws(
    () => new WebRtcCredentialTakeoverBoundary(fakeHandoff([]), "win32"),
    /requires a macOS or Linux host runtime/
  );
});

test("WebRTC credential boundary delegates only target/policy lifecycle to BrowserHandoffAdapter", async () => {
  const calls: string[] = [];
  const boundary = new WebRtcCredentialTakeoverBoundary(fakeHandoff(calls), "darwin");
  const locator = boundary.start({ interventionId: "int-1", epoch: 8, principalBinding: "principal-a", targetProcessId: 5252 });
  assert.equal(locator, "https://takeover.example/takeover/webrtc-locator");
  assert.deepEqual(calls, [
    'start:int-1:8:principal-a:5252:none:{"tap":true,"scroll":true,"text":true,"key":true}'
  ]);
  await boundary.revoke("int-1");
  assert.deepEqual(calls, [
    'start:int-1:8:principal-a:5252:none:{"tap":true,"scroll":true,"text":true,"key":true}',
    "revoke:int-1"
  ]);
});

test("WebRTC credential boundary forwards exact-window identity without transport selection", () => {
  const calls: string[] = [];
  const boundary = new WebRtcCredentialTakeoverBoundary(fakeHandoff(calls), "linux");
  boundary.start({
    interventionId: "int-window",
    epoch: 10,
    principalBinding: "principal-window",
    targetProcessId: 6262,
    targetWindowId: 8080
  });
  assert.deepEqual(calls, [
    'start:int-window:10:principal-window:6262:8080:{"tap":true,"scroll":true,"text":true,"key":true}'
  ]);
});

test("WebRTC credential boundary exposes only Handoff operator diagnostics", () => {
  const calls: string[] = [];
  const boundary = new WebRtcCredentialTakeoverBoundary(fakeHandoff(calls), "linux");
  assert.deepEqual(boundary.operatorDiagnosticsSnapshot(), {
    version: 1,
    source: "browser_handoff",
    health: "available",
    transport: {
      namespace: "managed_handoff",
      currentTransport: "websocket_relay",
      lastTransport: "websocket_relay",
      generation: 2,
      transitionCount: 1
    }
  });
  assert.deepEqual(calls, ["diagnostics"]);
});
