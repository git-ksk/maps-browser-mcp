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

test("explicit Human lifecycle discovery stays symmetric with advertised follow-up tools", () => {
  for (const toolName of [
    "maps_request_human_sign_in",
    "maps_complete_human_sign_in",
    "maps_cancel_human_sign_in",
    "maps_read_handoff_diagnostics"
  ]) {
    assert.match(server, new RegExp(`server\\.registerTool\\(\\s*"${toolName}"`));
  }

  const start = server.indexOf("async function explicitHumanSignInRequired");
  const end = server.indexOf("async function beginExplicitHumanSignIn", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /nextTool: "maps_complete_human_sign_in"/);
  assert.match(source, /cancelTool: "maps_cancel_human_sign_in"/);
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
  const release = source.indexOf("handoffLifecycleBridge.ensureVerifying");
  const verify = source.indexOf("runtime.verifyCredentialSafeHumanIntervention");
  const options = source.indexOf("credentialSafeVerificationOptions(active.id)");
  assert.ok(brokerRevoke >= 0 && surfaceRevoke > brokerRevoke);
  assert.ok(release > surfaceRevoke && verify > release && options > verify);

  const helperStart = server.indexOf("function credentialSafeVerificationOptions");
  const helperEnd = server.indexOf("const nativeCredentialTakeover", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = server.slice(helperStart, helperEnd);
  const stop = helper.indexOf("runtime.stopBrowserForProfileCheckpoint");
  const checkpoint = helper.indexOf("stoppedProfileCheckpoint");
  assert.ok(stop >= 0 && checkpoint > stop);
});


test("deployment profile checkpoint is credential-safe-transport agnostic", () => {
  assert.match(server, /credentialSafeProfileCheckpointEnabled = Boolean\(config\.browserProfileCheckpoint\.module\)/);
  assert.match(server, /credentialSafeVerificationOptions\(active\.id\)/);
  assert.match(server, /credentialSafeVerificationOptions\(state\.interventionId\)/);
  assert.doesNotMatch(server, /usedHostedBrowserSurface/);
  assert.doesNotMatch(server, /providerKind === "hosted-browser-takeover"[\s\S]{0,400}stoppedProfileCheckpoint/);
});

test("explicit cancellation cannot create a profile checkpoint", () => {
  const start = server.indexOf("async function cancelExplicitHumanSignIn");
  const end = server.indexOf("async function executeToolTask", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /cancelIntervention\(active\.id, owner, true\)/);
  assert.doesNotMatch(source, /stoppedProfileCheckpoint/);
});


test("expired explicit Human sign-in recovery fences only the same principal and reconstructs without replay", () => {
  const start = server.indexOf("async function recoverExpiredExplicitHumanSignInForPrincipal");
  const end = server.indexOf("function reconstructedBrowserRequiresFreshInvocation", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /owner\.principalBinding !== principalBindingValue/);
  assert.match(source, /credentialSafeSurface\?\.getActive\(\)/);
  assert.match(source, /revokeCredentialSafeSurfaceIncludingExpired/);
  assert.match(source, /runtime\.cancelHumanIntervention/);
  assert.match(source, /recoverAutomationBrowserRuntime\(\)/);
  assert.doesNotMatch(source, /resumeAfterHumanIntervention|markVerified|task\(\)/);
});

test("browser unavailable recovery reconstructs the runtime but requires a separate fresh tool invocation", () => {
  const start = server.indexOf("async function executeToolTask");
  const end = server.indexOf("async function runToolWithHandoff", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /error\.code === "BROWSER_UNAVAILABLE"/);
  assert.match(source, /error\.recoveryHint === "reconstruct_browser"/);
  assert.match(source, /!runtime\.getActiveIntervention\(\)/);
  assert.match(source, /await recoverAutomationBrowserRuntime\(\)/);
  assert.match(source, /return reconstructedBrowserRequiresFreshInvocation\(\)/);
  const resultStart = server.indexOf("function reconstructedBrowserRequiresFreshInvocation");
  const resultEnd = server.indexOf("async function humanInputRequired", resultStart);
  const resultSource = server.slice(resultStart, resultEnd);
  assert.match(resultSource, /interrupted action was not replayed/);
});

test("credential-safe Human control has no hosted-CDP automation-browser exception", () => {
  const start = server.indexOf("async function prepareHandoffPrompt");
  const end = server.indexOf("async function revokeCredentialSafeSurface", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /credentialSafeHandoff\.transport === "hosted_cdp"/);
  assert.match(source, /runtime\.cancelHumanIntervention/);
  assert.match(source, /legacy hosted_cdp Human path is disabled/);
  assert.doesNotMatch(source, /preserveBrowserSession/);
  assert.match(source, /suspendAutomationForCredentialSafeHumanControl\(\s*intervention\.id,\s*intervention\.epoch\s*\)/);
});

test("access challenges use the same credential-safe Human boundary as sign-in and consent", () => {
  assert.match(server, /CREDENTIAL_SAFE_REASONS[^\n]*"sign_in"[^\n]*"consent"[^\n]*"access_challenge"/);
});


test("Handoff authority release only advances Maps to verifying and never verifies or resumes by callback", () => {
  assert.match(server, /onAuthorityReleased: handleBrowserHandoffAuthorityReleased/);
  const start = server.indexOf("function handleBrowserHandoffAuthorityReleased");
  const end = server.indexOf("function consumeMatchingRecovery", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /handoffLifecycleBridge\.onAuthorityReleased\(event\)/);
  assert.doesNotMatch(source, /verifyCredentialSafeHumanIntervention|verifyHumanIntervention|resumeAfterHumanIntervention/);
});

test("consumer cancellation never masquerades as Human Done", () => {
  const start = server.indexOf("async function cancelIntervention");
  const end = server.indexOf("async function explicitHumanSignInRequired", start);
  assert.ok(start >= 0 && end > start);
  const source = server.slice(start, end);
  assert.match(source, /takeoverBroker\.revokeForIntervention/);
  assert.match(source, /runtime\.cancelHumanIntervention/);
  assert.doesNotMatch(source, /ensureVerifying|releaseHumanAuthorityForVerification|markHumanControlComplete/);
});
