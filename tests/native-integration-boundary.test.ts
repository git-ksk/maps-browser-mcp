import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Maps Handoff integration remains a thin transport lifecycle boundary", () => {
  const nativeBoundary = read("src/browser/native-credential-takeover-boundary.ts");
  const webRtcBoundary = read("src/browser/webrtc-credential-takeover-boundary.ts");
  const provider = read("src/browser/credential-takeover-human-provider.ts");
  const server = read("src/server.ts");
  const mapsOwnedTakeoverSurface = `${nativeBoundary}\n${webRtcBoundary}\n${provider}\n${server}`;

  for (const forbidden of [
    "ScreenCaptureKit",
    "VideoToolbox",
    "CoreGraphics",
    "CVPixelBuffer",
    "rootKeyBase64Url",
    "THIN_TAKEOVER_SESSION_KEY",
    "ChaCha20",
    "HKDF",
    "RTCPeerConnection",
    "RTCDataChannel",
    "setRemoteDescription",
    "iceServers",
    "DTLS",
    "RtpPacket"
  ]) {
    assert.equal(
      mapsOwnedTakeoverSurface.includes(forbidden),
      false,
      `Maps takeover integration must not own ${forbidden} implementation details`
    );
  }

  assert.match(nativeBoundary, /broker\.createNativeLink\(/);
  assert.match(nativeBoundary, /broker\.revokeNativeForIntervention\(/);
  assert.match(webRtcBoundary, /this\.handoff\.start\(/);
  assert.match(webRtcBoundary, /this\.handoff\.revoke\(/);
  assert.match(server, /new InheritedFdNativeRuntimeProvider\(config\.credentialSafeHandoff\.nativeRuntime\)/);
  assert.match(server, /new BrowserHandoffAdapter\(\{[\s\S]*runtime: config\.credentialSafeHandoff\.webRtcRuntime/);
  assert.match(server, /new NativeCredentialTakeoverBoundary\(takeoverBroker\)/);
  assert.match(server, /new WebRtcCredentialTakeoverBoundary\(browserHandoffAdapter\)/);
  assert.match(provider, /SystemBrowserCredentialSession/);
  assert.match(provider, /await this\.browser\.start\(\)/);
  assert.match(provider, /this\.browser\.getPid\(\)/);
  assert.match(provider, /targetProcessId/);
  assert.match(nativeBoundary, /\{ processId: request\.targetProcessId \}/);
  assert.match(webRtcBoundary, /target: \{ processId: request\.targetProcessId \}/);
  assert.match(webRtcBoundary, /inputPolicy: CREDENTIAL_SAFE_INPUT_POLICY/);
  assert.match(provider, /await this\.browser\.close\(\)/);
  assert.doesNotMatch(server, /preserveBrowserSession/);
  assert.match(
    server,
    /suspendAutomationForCredentialSafeHumanControl\(\s*intervention\.id,\s*intervention\.epoch\s*\)/
  );
  assert.match(server, /legacy hosted_cdp Human path is disabled/);
  assert.match(server, /automation browser process is stopped/);
  assert.doesNotMatch(server, /preserveBrowserSession:\s*config\.credentialSafeHandoff\.transport === "thin_takeover"/);
  assert.doesNotMatch(server, /preserveBrowserSession:\s*config\.credentialSafeHandoff\.transport === "webrtc_takeover"/);
  assert.doesNotMatch(server, /new SpawnedWebRtcRuntimeProvider/);
  assert.doesNotMatch(webRtcBoundary, /createWebRtcLink|SpawnedWebRtcRuntimeProvider|TakeoverBroker/);
  assert.match(server, /browserHandoffAdapter\?\.ownsPath\(pathname\)/);
  assert.match(server, /browserHandoffAdapter\.handle\(request, boundPrincipal\)/);
});

test("Native and WebRTC transports are siblings and neither instantiates CUA", () => {
  const server = read("src/server.ts");
  assert.match(server, /credentialSafeHandoff\.transport === "cua_takeover"\s*\? new CuaHumanTakeoverAdapter/);
  assert.match(server, /credentialSafeHandoff\.transport === "thin_takeover"[\s\S]*?CredentialTakeoverHumanProvider\("thin-takeover"/);
  assert.match(server, /credentialSafeHandoff\.transport === "webrtc_takeover"[\s\S]*?CredentialTakeoverHumanProvider\("webrtc-takeover"/);
  assert.doesNotMatch(read("src/browser/native-credential-takeover-boundary.ts"), /Cua|CUA|cua-driver/);
  assert.doesNotMatch(read("src/browser/webrtc-credential-takeover-boundary.ts"), /Cua|CUA|cua-driver/);
});

test("credential prompts distinguish Native app from direct Safari WebRTC takeover", () => {
  const server = read("src/server.ts");
  assert.match(server, /Open the Native Takeover app and use this short-lived Native-only locator/);
  assert.match(server, /Open this short-lived WebRTC takeover locator in iPhone Safari/);
  assert.match(server, /Control only the dedicated Chrome window directly with tap\/swipe and the iOS keyboard/);
  assert.match(server, /Legacy button-driven frame\/input takeover is disabled/);
});
