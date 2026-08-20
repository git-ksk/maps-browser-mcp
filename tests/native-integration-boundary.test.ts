import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Maps Native integration remains a thin lifecycle boundary", () => {
  const boundary = read("src/browser/native-credential-takeover-boundary.ts");
  const provider = read("src/browser/thin-takeover-human-provider.ts");
  const server = read("src/server.ts");
  const mapsOwnedNativeSurface = `${boundary}\n${provider}\n${server}`;

  for (const forbidden of [
    "ScreenCaptureKit",
    "VideoToolbox",
    "CoreGraphics",
    "CVPixelBuffer",
    "rootKeyBase64Url",
    "THIN_TAKEOVER_SESSION_KEY",
    "ChaCha20",
    "HKDF"
  ]) {
    assert.equal(
      mapsOwnedNativeSurface.includes(forbidden),
      false,
      `Maps Native integration must not own ${forbidden} implementation details`
    );
  }

  assert.match(boundary, /start\(request: NativeCredentialTakeoverStartRequest\): string/);
  assert.match(boundary, /async revoke\(interventionId: string\): Promise<void>/);
  assert.match(server, /new InheritedFdNativeRuntimeProvider\(config\.credentialSafeHandoff\.nativeRuntime\)/);
  assert.match(server, /new NativeCredentialTakeoverBoundary\(takeoverBroker\)/);
});

test("thin_takeover does not instantiate the CUA transport", () => {
  const server = read("src/server.ts");

  assert.match(
    server,
    /credentialSafeHandoff\.transport === "cua_takeover"\s*\? new CuaHumanTakeoverAdapter/
  );
  assert.match(
    server,
    /credentialSafeHandoff\.transport === "thin_takeover"[\s\S]*?new ThinTakeoverHumanProvider\(nativeCredentialTakeover\)/
  );
  assert.doesNotMatch(
    read("src/browser/native-credential-takeover-boundary.ts"),
    /Cua|CUA|cua-driver/
  );
});
