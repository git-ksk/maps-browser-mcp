import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "src/server.ts"), "utf8");

test("Human sign-in keeps MRTR for form-elicitation clients and uses an explicit fallback otherwise", () => {
  assert.match(
    server,
    /maps_request_human_sign_in[^]*supportsFormElicitation\(ctx\)[^]*runToolWithHandoff[^]*beginExplicitHumanSignIn\(\)/
  );
  assert.match(server, /server\.registerTool\(\s*"maps_complete_human_sign_in"/);
  assert.match(server, /server\.registerTool\(\s*"maps_cancel_human_sign_in"/);
});

test("explicit Human sign-in returns only the bounded locator surface and no control-plane identity", () => {
  const start = server.indexOf("async function explicitHumanSignInRequired");
  const end = server.indexOf("async function beginExplicitHumanSignIn", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /takeoverUrl: surface\.locator/);
  assert.match(source, /providerKind: surface\.providerKind/);
  assert.doesNotMatch(source, /sessionId:/);
  assert.doesNotMatch(source, /principalBinding:/);
  assert.doesNotMatch(source, /capability:/i);
});

test("explicit completion revokes Human authority before fresh verification and checkpoints only after a stopped browser boundary", () => {
  const start = server.indexOf("async function completeExplicitHumanSignIn");
  const end = server.indexOf("async function cancelExplicitHumanSignIn", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  const brokerRevoke = source.indexOf("takeoverBroker.revokeForIntervention");
  const surfaceRevoke = source.indexOf("revokeCredentialSafeSurface");
  const markComplete = source.indexOf("runtime.markHumanControlComplete");
  const verify = source.indexOf("runtime.verifyCredentialSafeHumanIntervention");
  const stop = source.indexOf("runtime.stopBrowserForProfileCheckpoint");
  const checkpoint = source.indexOf("stoppedProfileCheckpoint");
  assert.ok(brokerRevoke >= 0 && surfaceRevoke > brokerRevoke);
  assert.ok(markComplete > surfaceRevoke && verify > markComplete);
  assert.ok(stop > verify && checkpoint > stop);
});

test("explicit cancellation cannot create a profile checkpoint", () => {
  const start = server.indexOf("async function cancelExplicitHumanSignIn");
  const end = server.indexOf("async function executeToolTask", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /cancelIntervention\(active\.id, owner\)/);
  assert.doesNotMatch(source, /stoppedProfileCheckpoint/);
});
