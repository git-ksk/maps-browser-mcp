import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserHandoffAdapter, BrowserHandoffStartRequest } from "mcp-execution-handoff/browser-takeover";
import { WebRtcCredentialTakeoverBoundary } from "../src/browser/webrtc-credential-takeover-boundary.js";

function fakeHandoff(calls: string[]): BrowserHandoffAdapter {
  return {
    start(request: BrowserHandoffStartRequest) {
      calls.push(`start:${request.intervention.id}:${request.intervention.epoch}:${request.principalBinding}:${request.target.processId}:${JSON.stringify(request.inputPolicy)}`);
      return "https://takeover.example/takeover/webrtc-locator";
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
    'start:int-1:8:principal-a:5252:{"tap":true,"scroll":true,"text":true,"key":true}'
  ]);
  await boundary.revoke("int-1");
  assert.deepEqual(calls, [
    'start:int-1:8:principal-a:5252:{"tap":true,"scroll":true,"text":true,"key":true}',
    "revoke:int-1"
  ]);
});
