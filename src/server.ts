import { randomBytes } from "node:crypto";
import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  McpServer,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadConfig } from "./config.js";
import { ActionApprovalError, ActionApprovalManager } from "./action-approval.js";
import {
  ACTION_APPROVAL_INPUT_KEY,
  actionApprovalStateMatchesInvocation,
  createActionApprovalRequestState,
  supportsActionApprovalFormElicitation,
  type ActionApprovalRequestState
} from "./action-approval-mcp.js";
import {
  buildDirectionsAppHtml,
  MAP_DIRECTIONS_APP_RESOURCE_URI,
  MAP_DIRECTIONS_FRAME_DOMAINS,
  MCP_APP_MIME_TYPE
} from "./mcp-apps-map-embed.js";
import {
  CredentialSafeHumanSurfaceRuntime,
  ExecutionHandoffError,
  ExecutionHandoffRuntime,
  ExternalHumanSurfaceError,
  HandoffCheckpointError,
  SignedFileHandoffCheckpointStore,
  claimHandoffOwner,
  createHandoffOwner,
  digestToolInvocation,
  handoffOwnerMatches,
  selectHumanSurface,
  type HandoffOwner,
  type HandoffResumeStrategy
} from "mcp-execution-handoff/core";
import {
  HANDOFF_INPUT_KEY,
  HANDOFF_STATE_TTL_SECONDS,
  HUMAN_INTERVENTION_SCHEMA,
  createHandoffRequestState,
  handoffStateMatchesInvocation,
  type HandoffRequestState
} from "mcp-execution-handoff/mcp";
import { createMapsExecutionAdapter } from "./maps-execution-adapter.js";
import { MapsUrlCompiler } from "./maps/url-compiler.js";
import { PolicyEngine, PolicyError } from "./policy/policy-engine.js";
import { currentRequestPrincipal, principalBinding } from "./request-principal.js";
import { ChromeProcess } from "./browser/chrome-process.js";
import { CuaMcpClient } from "./browser/cua-mcp-client.js";
import { CuaHumanTakeoverAdapter } from "./browser/cua-human-takeover-adapter.js";
import { CredentialAwareTakeoverAdapter } from "./browser/credential-aware-takeover-adapter.js";
import { CuaTakeoverHumanProvider } from "./browser/cua-takeover-human-provider.js";
import { SystemBrowserCredentialSession } from "./browser/system-browser-credential-session.js";
import { SystemBrowserHumanProvider } from "./browser/system-browser-human-provider.js";
import { CredentialTakeoverHumanProvider } from "./browser/credential-takeover-human-provider.js";
import { NativeCredentialTakeoverBoundary } from "./browser/native-credential-takeover-boundary.js";
import { WebRtcCredentialTakeoverBoundary } from "./browser/webrtc-credential-takeover-boundary.js";
import { MapsBrowserRuntime, BrowserRuntimeError, type MapsIntervention } from "./browser/runtime.js";
import { SemanticController } from "./browser/semantic-controller.js";
import { SEARCH_RATING_OPTIONS } from "./browser/search-rating-filter.js";
import { SEARCH_ZOOM_DIRECTIONS } from "./browser/search-zoom.js";
import { TRANSIT_TIME_MODES } from "./browser/transit-time.js";
import { VisibleStateReader } from "./browser/visible-state-reader.js";
import { resolveFreshRouteSendTarget, type RouteSendActionInput } from "./browser/route-send.js";
import { OperationQueue, OperationQueueError } from "./operation-queue.js";
import { createStoppedBrowserProfileCheckpointHook } from "./browser-profile-checkpoint.js";
import { HostedBrowserTakeoverProvider, InheritedFdNativeRuntimeProvider, SpawnedWebRtcRuntimeProvider, TakeoverBroker, type TakeoverBrowserAdapter } from "mcp-execution-handoff/browser-takeover";
import { ROUTE_AVOID_OPTIONS, TRAVEL_MODES } from "./types.js";

const SERVER_VERSION = "0.3.3";
const config = loadConfig();
const compiler = new MapsUrlCompiler();
const policy = new PolicyEngine({
  interactiveAssist: config.policy.interactiveAssist,
  maxActionsPerMinute: config.policy.maxActionsPerMinute,
  maxVisibleReadsPerHour: config.policy.maxVisibleReadsPerHour
});
const localChrome = new ChromeProcess(config.browser);
const runtime = new MapsBrowserRuntime(localChrome, policy);
const credentialSafeCuaAdapter = config.credentialSafeHandoff.enabled && config.credentialSafeHandoff.transport === "cua_takeover"
  ? new CuaHumanTakeoverAdapter(() => new CuaMcpClient(config.credentialSafeHandoff.cuaCommand))
  : undefined;
const takeoverAdapter: TakeoverBrowserAdapter = credentialSafeCuaAdapter
  ? new CredentialAwareTakeoverAdapter(runtime, credentialSafeCuaAdapter)
  : runtime;
const nativeTakeoverRuntime = config.credentialSafeHandoff.enabled &&
  config.credentialSafeHandoff.transport === "thin_takeover" &&
  config.credentialSafeHandoff.nativeRuntime
  ? new InheritedFdNativeRuntimeProvider(config.credentialSafeHandoff.nativeRuntime)
  : undefined;
const webRtcTakeoverRuntime = config.credentialSafeHandoff.enabled &&
  config.credentialSafeHandoff.transport === "webrtc_takeover" &&
  config.credentialSafeHandoff.webRtcRuntime
  ? new SpawnedWebRtcRuntimeProvider(config.credentialSafeHandoff.webRtcRuntime)
  : undefined;
const takeoverBroker = new TakeoverBroker(takeoverAdapter, config.takeover, nativeTakeoverRuntime, webRtcTakeoverRuntime);
const hostedBrowserCredentialTakeover = config.credentialSafeHandoff.enabled &&
  config.credentialSafeHandoff.transport === "hosted_cdp"
  ? new HostedBrowserTakeoverProvider(takeoverBroker)
  : undefined;
const stoppedProfileCheckpoint = createStoppedBrowserProfileCheckpointHook(config.browserProfileCheckpoint.module);
const credentialSafeProfileCheckpointEnabled = Boolean(config.browserProfileCheckpoint.module);

function credentialSafeVerificationOptions(interventionId: string) {
  if (!credentialSafeProfileCheckpointEnabled) return undefined;
  return {
    beforeMarkVerified: async () => {
      await runtime.stopBrowserForProfileCheckpoint(interventionId);
      await stoppedProfileCheckpoint({ reason: "credential_safe_sign_in" });
    }
  };
}
const nativeCredentialTakeover = nativeTakeoverRuntime
  ? new NativeCredentialTakeoverBoundary(takeoverBroker)
  : undefined;
const webRtcCredentialTakeover = webRtcTakeoverRuntime
  ? new WebRtcCredentialTakeoverBoundary(takeoverBroker)
  : undefined;
const credentialSafeBrowser = config.credentialSafeHandoff.enabled &&
  config.credentialSafeHandoff.transport !== "hosted_cdp"
  ? new SystemBrowserCredentialSession({
      executable: config.browser.executable,
      profileDir: config.browser.profileDir,
      startUrl: "https://www.google.com/maps"
    })
  : undefined;
const credentialSafeProvider = !config.credentialSafeHandoff.enabled
  ? undefined
  : config.credentialSafeHandoff.transport === "hosted_cdp"
    ? hostedBrowserCredentialTakeover
    : config.credentialSafeHandoff.transport === "thin_takeover"
    ? nativeCredentialTakeover && credentialSafeBrowser
      ? new CredentialTakeoverHumanProvider("thin-takeover", credentialSafeBrowser, nativeCredentialTakeover)
      : undefined
    : config.credentialSafeHandoff.transport === "webrtc_takeover"
      ? webRtcCredentialTakeover && credentialSafeBrowser
        ? new CredentialTakeoverHumanProvider("webrtc-takeover", credentialSafeBrowser, webRtcCredentialTakeover)
        : undefined
    : credentialSafeBrowser && config.credentialSafeHandoff.transport === "cua_takeover" && credentialSafeCuaAdapter
      ? new CuaTakeoverHumanProvider(credentialSafeBrowser, credentialSafeCuaAdapter, takeoverBroker)
      : credentialSafeBrowser
        ? new SystemBrowserHumanProvider(
            credentialSafeBrowser,
            config.credentialSafeHandoff.operatorUrl ?? "local://dedicated-maps-browser"
          )
        : undefined;
const credentialSafeSurface = credentialSafeProvider
  ? new CredentialSafeHumanSurfaceRuntime(credentialSafeProvider)
  : undefined;
const controller = new SemanticController(runtime, compiler);
const reader = new VisibleStateReader(runtime, {
  maxNodes: config.policy.maxAxNodes,
  maxChars: config.policy.maxReadChars
});
const operationQueue = new OperationQueue(config.policy.maxPendingActions, {
  timeoutMs: config.policy.operationTimeoutMs,
  onTimeout: () => runtime.close()
});

const v3Handoff = config.handoffCheckpoint.enabled
  ? new ExecutionHandoffRuntime(createMapsExecutionAdapter(runtime), {
      checkpointStore: new SignedFileHandoffCheckpointStore(
        config.handoffCheckpoint.filePath!,
        config.handoffCheckpoint.signingKey!
      ),
      checkpointTtlMs: config.handoffCheckpoint.ttlMs
    })
  : undefined;

type MapsRequestState = HandoffRequestState | ActionApprovalRequestState;

const handoffStateCodec = createRequestStateCodec<MapsRequestState>({
  key: randomBytes(32).toString("base64url"),
  ttlSeconds: HANDOFF_STATE_TTL_SECONDS
});

const handoffOwners = new Map<string, HandoffOwner>();
const explicitHumanSignInInterventions = new Set<string>();
const actionApprovals = new ActionApprovalManager();

const queryText = z.string().trim().min(1).max(500);
const locationText = z.string().trim().min(1).max(300);
const expectedLabelText = z.string().trim().min(1).max(240);
const expectedListLabelText = z.string().trim().min(1).max(160);
const expectedDeviceLabelText = z.string().trim().min(1).max(160);
const handoffDecisionSchema = z.object({ decision: z.enum(["continue", "cancel"]) });
const actionApprovalDecisionSchema = z.object({ decision: z.enum(["approve", "cancel"]) });
const CREDENTIAL_SAFE_REASONS = new Set<MapsIntervention["reason"]>(["sign_in", "consent", "access_challenge"]);

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error: unknown): CallToolResult {
  const known =
    error instanceof PolicyError ||
    error instanceof BrowserRuntimeError ||
    error instanceof OperationQueueError ||
    error instanceof ExecutionHandoffError ||
    error instanceof ExternalHumanSurfaceError ||
    error instanceof ActionApprovalError;
  if (!known) console.error("[maps-browser-mcp] unexpected tool error", error);
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known
    ? error.message
    : "The operation failed unexpectedly. Check the local server logs for details.";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true
  };
}

function activePrincipalBinding(): string {
  const principal = currentRequestPrincipal();
  return principal ? principalBinding(principal) : "local-stdio";
}

function checkpointHumanHandoff(owner: HandoffOwner): void {
  v3Handoff?.checkpoint(owner.principalBinding, owner.argsDigest);
}

function clearHandoffCheckpoint(owner?: HandoffOwner): void {
  v3Handoff?.clearCheckpoint(owner?.principalBinding ?? activePrincipalBinding());
}

function consumeMatchingRecovery(toolName: string, args: unknown): void {
  if (!v3Handoff || runtime.getActiveIntervention()) return;
  try {
    const recovery = v3Handoff.recover(activePrincipalBinding());
    if (recovery?.actionDigest === digestToolInvocation(toolName, args)) {
      v3Handoff.clearCheckpoint(activePrincipalBinding());
    }
  } catch (error) {
    if (!(error instanceof HandoffCheckpointError)) throw error;
    console.error(`[maps-browser-mcp] ignoring unusable handoff recovery checkpoint: ${error.code}`);
    v3Handoff.clearCheckpoint(activePrincipalBinding());
  }
}

function staleAfterInterventionResult(toolName: string): CallToolResult {
  if (toolName === "maps_request_human_sign_in") {
    return jsonResult({
      humanStepCompleted: true,
      authenticatedReadiness: "must_recheck",
      nextTool: "maps_read_authenticated_readiness"
    });
  }
  const next = toolName === "maps_select_route" ||
    toolName === "maps_read_route_summary" ||
    toolName === "maps_set_travel_mode" ||
    toolName === "maps_set_transit_time" ||
    toolName === "maps_set_recommended_travel_mode" ||
    toolName === "maps_swap_route_endpoints" ||
    toolName === "maps_get_route_share_link" ||
    toolName === "maps_read_route_send_targets" ||
    toolName === "maps_send_route_to_device"
    ? "Run maps_directions again before continuing with the route."
    : "Run maps_search again before continuing with the place results.";
  return errorResult(new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    `Human intervention invalidated the previous Google Maps semantic state. ${next}`
  ));
}

function ownerFor(toolName: string, args: unknown, resumeStrategy: HandoffResumeStrategy): HandoffOwner {
  return createHandoffOwner(activePrincipalBinding(), toolName, args, resumeStrategy);
}

function mapsInterventionPrompt(reason: MapsIntervention["reason"]): string {
  const label = reason === "access_challenge"
    ? "an access challenge or CAPTCHA"
    : reason === "sign_in"
      ? "a Google sign-in step"
      : reason === "consent"
        ? "a Google consent step"
        : "a manual browser step";
  return [
    `Google Maps requires ${label}.`,
    "Complete that step directly in the dedicated Chrome window.",
    "Do not paste passwords, 2FA codes, CAPTCHA answers, cookies, or other credentials into this MCP prompt.",
    "Choose Continue only after the browser step is complete, or Cancel to stop the operation."
  ].join(" ");
}

function handoffPrompt(intervention: MapsIntervention, owner: HandoffOwner): string {
  const base = mapsInterventionPrompt(intervention.reason);
  const principal = currentRequestPrincipal();
  const takeoverUrl = principal && principalBinding(principal) === owner.principalBinding
    ? takeoverBroker.createLink(intervention, owner.principalBinding)
    : undefined;
  if (!takeoverUrl) return base;
  return `${base}\n\nRemote human takeover is available through the configured authenticated HTTPS gateway:\n${takeoverUrl}\n\nOpen that URL on your phone, complete the manual browser interaction, close remote control with Done, then return here and choose Continue. The capability is short-lived, bound to this intervention and resource epoch, and must not be forwarded.`;
}

function credentialSafePrompt(
  intervention: MapsIntervention,
  surface: { providerKind: string; locator: string }
): string {
  const base = mapsInterventionPrompt(intervention.reason);
  const remote = surface.providerKind === "thin-takeover" && /^https?:\/\//i.test(surface.locator)
    ? `Open the Native Takeover app and use this short-lived Native-only locator:\n${surface.locator}\n\nDo not use the locator as a Web takeover page; legacy Web bootstrap/frame/input are disabled for this Human session.`
    : surface.providerKind === "webrtc-takeover" && /^https?:\/\//i.test(surface.locator)
      ? `Open this short-lived WebRTC takeover locator in iPhone Safari:\n${surface.locator}\n\nControl only the dedicated Chrome window directly with tap/swipe and the iOS keyboard. Legacy button-driven frame/input takeover is disabled for this Human session.`
      : /^https?:\/\//i.test(surface.locator)
          ? `Open the configured Human access surface:\n${surface.locator}`
          : "Use the local or separately configured OS-level Human access surface to control the dedicated browser.";
  const ownership = "Automation control is fully detached, the automation browser process is stopped, and the same dedicated profile is opened in a normal browser without agent-owned CDP/remote-debugging/automation authority.";
  const recovery = "Choose Continue after the browser-side step is complete. Human authority is revoked and the normal browser is closed before automation establishes a fresh Chrome process/CDP attachment and readiness check; stale pre-auth actions are not replayed.";
  return [
    base,
    ownership,
    remote,
    "Complete only the authentication/consent/challenge step as a Human. Do not send credentials, MFA values, cookies, tokens, account identifiers, or passkey material through MCP.",
    "Passkey/WebAuthn ceremonies remain provider-controlled Human interactions and are never bypassed or synthesized by this handoff.",
    recovery
  ].join("\n\n");
}

async function prepareHandoffPrompt(intervention: MapsIntervention, owner: HandoffOwner): Promise<string> {
  if (config.credentialSafeHandoff.transport === "hosted_cdp") {
    takeoverBroker.revokeForIntervention(intervention.id);
    const active = runtime.getActiveIntervention();
    if (active?.id === intervention.id) runtime.cancelHumanIntervention(intervention.id);
    handoffOwners.delete(intervention.id);
    clearHandoffCheckpoint(owner);
    throw new BrowserRuntimeError(
      "BROWSER_UNAVAILABLE",
      "Human browser control requires the automation browser to stop and the same dedicated profile to open in a normal browser without remote-debugging or automation authority. The legacy hosted_cdp Human path is disabled for credential-safe Human control; use a supported normal-browser transport such as webrtc_takeover."
    );
  }
  if (
    credentialSafeSurface &&
    selectHumanSurface(intervention.reason, CREDENTIAL_SAFE_REASONS) === "credential_safe_external"
  ) {
    takeoverBroker.revokeForIntervention(intervention.id);
    await runtime.suspendAutomationForCredentialSafeHumanControl(
      intervention.id,
      intervention.epoch
    );
    const surface = await credentialSafeSurface.begin(intervention, owner.principalBinding);
    return credentialSafePrompt(intervention, surface);
  }
  return handoffPrompt(intervention, owner);
}

async function revokeCredentialSafeSurface(interventionId: string, owner: HandoffOwner): Promise<string | undefined> {
  const external = credentialSafeSurface?.getActive();
  if (!external || external.interventionId !== interventionId) return undefined;
  await credentialSafeSurface!.revoke(
    external.interventionId,
    external.epoch,
    owner.principalBinding
  );
  return external.providerKind;
}

async function humanInputRequired(
  intervention: MapsIntervention,
  candidateOwner: HandoffOwner,
  args: unknown
): Promise<InputRequiredResult | CallToolResult> {
  const owner = handoffOwners.get(intervention.id);
  if (!owner || !handoffOwnerMatches(owner, candidateOwner)) {
    return errorResult(new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      "The active human intervention belongs to another authenticated principal or no longer has a valid owner. Complete the original flow before starting another Maps action."
    ));
  }

  let active = runtime.getActiveIntervention();
  if (!active || active.id !== intervention.id) {
    handoffOwners.delete(intervention.id);
    takeoverBroker.revokeForIntervention(intervention.id);
    clearHandoffCheckpoint(owner);
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The human intervention is no longer active. Repeat the intended Maps action."
    ));
  }
  if (active.status === "awaiting_human") {
    active = runtime.claimHumanControl(active.id);
  }
  if (active.status !== "human_active") {
    return errorResult(new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      `The active human intervention is ${active.status}; wait for the original handoff flow to finish.`
    ));
  }

  checkpointHumanHandoff(owner);
  const prompt = await prepareHandoffPrompt(active, owner);
  const requestState = await handoffStateCodec.mint(createHandoffRequestState({
    toolName: owner.toolName,
    args,
    interventionId: active.id,
    epoch: active.epoch,
    resumeStrategy: owner.resumeStrategy,
    principalBinding: owner.principalBinding
  }));

  return inputRequired({
    requestState,
    inputRequests: {
      [HANDOFF_INPUT_KEY]: inputRequired.elicit({
        message: prompt,
        requestedSchema: HUMAN_INTERVENTION_SCHEMA
      })
    }
  });
}

async function cancelIntervention(interventionId: string, owner: HandoffOwner): Promise<CallToolResult> {
  takeoverBroker.revokeForIntervention(interventionId);
  await revokeCredentialSafeSurface(interventionId, owner);
  const active = runtime.getActiveIntervention();
  if (active?.id === interventionId) runtime.cancelHumanIntervention(interventionId);
  handoffOwners.delete(interventionId);
  clearHandoffCheckpoint(owner);
  return jsonResult({ cancelled: true, reason: "human_intervention_cancelled" });
}

async function explicitHumanSignInRequired(
  intervention: MapsIntervention,
  candidateOwner: HandoffOwner
): Promise<CallToolResult> {
  const owner = handoffOwners.get(intervention.id);
  if (!owner || !handoffOwnerMatches(owner, candidateOwner)) {
    return errorResult(new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      "The active human sign-in intervention belongs to another authenticated principal or no longer has a valid owner. Cancel the original flow before starting another Maps action."
    ));
  }

  let active = runtime.getActiveIntervention();
  if (!active || active.id !== intervention.id) {
    handoffOwners.delete(intervention.id);
    explicitHumanSignInInterventions.delete(intervention.id);
    takeoverBroker.revokeForIntervention(intervention.id);
    clearHandoffCheckpoint(owner);
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The human sign-in intervention is no longer active. Read authentication readiness again before requesting sign-in."
    ));
  }
  if (active.status === "awaiting_human") active = runtime.claimHumanControl(active.id);
  if (active.status !== "human_active") {
    return errorResult(new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      `The active human sign-in intervention is ${active.status}; finish or cancel that flow before continuing.`
    ));
  }

  checkpointHumanHandoff(owner);
  await prepareHandoffPrompt(active, owner);
  const surface = credentialSafeSurface?.getActive();
  if (!surface || surface.interventionId !== active.id || surface.principalBinding !== owner.principalBinding) {
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The credential-safe Human sign-in surface could not be established for the active principal."
    ));
  }

  explicitHumanSignInInterventions.add(active.id);
  return jsonResult({
    humanActionRequired: true,
    takeoverUrl: surface.locator,
    providerKind: surface.providerKind,
    nextTool: "maps_complete_human_sign_in",
    cancelTool: "maps_cancel_human_sign_in"
  });
}

async function beginExplicitHumanSignIn(): Promise<CallToolResult> {
  const toolName = "maps_request_human_sign_in";
  const args = {};
  const owner = ownerFor(toolName, args, "require_fresh_semantic_action");
  try {
    policy.consumeAction();
    const result = await operationQueue.run(async () => {
      const interventionBefore = runtime.getActiveIntervention()?.id;
      try {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return await controller.requestHumanSignIn();
      } finally {
        const interventionAfter = runtime.getActiveIntervention();
        if (interventionAfter && interventionAfter.id !== interventionBefore) {
          const boundOwner = claimHandoffOwner(
            handoffOwners,
            interventionAfter.id,
            interventionAfter.status,
            owner
          );
          if (!boundOwner) {
            takeoverBroker.revokeForIntervention(interventionAfter.id);
            runtime.cancelHumanIntervention(interventionAfter.id);
            throw new BrowserRuntimeError(
              "UI_STATE_CHANGED",
              "A newly-created human sign-in intervention could not be bound to the originating authenticated principal. The intervention was cancelled."
            );
          }
        }
      }
    });
    return jsonResult(result);
  } catch (error) {
    if (
      error instanceof BrowserRuntimeError &&
      error.code === "HUMAN_INTERVENTION_REQUIRED" &&
      error.intervention
    ) {
      return explicitHumanSignInRequired(error.intervention, owner);
    }
    return errorResult(error);
  }
}

async function completeExplicitHumanSignIn(): Promise<CallToolResult> {
  const active = runtime.getActiveIntervention();
  if (!active || !explicitHumanSignInInterventions.has(active.id)) {
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "No explicit Human sign-in flow is awaiting completion. Read authentication readiness before starting a new sign-in flow."
    ));
  }
  const expectedOwner = ownerFor(
    "maps_request_human_sign_in",
    {},
    "require_fresh_semantic_action"
  );
  const owner = handoffOwners.get(active.id);
  if (!owner || !handoffOwnerMatches(owner, expectedOwner)) {
    return errorResult(new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      "The active human sign-in intervention belongs to another authenticated principal or no longer has a valid owner."
    ));
  }

  try {
    policy.consumeAction();
    takeoverBroker.revokeForIntervention(active.id);
    const currentSurface = credentialSafeSurface?.getActive();
    const usedCredentialSafeSurface = currentSurface?.interventionId === active.id;
    await revokeCredentialSafeSurface(active.id, owner);
    runtime.markHumanControlComplete(active.id);
    await operationQueue.run(() => usedCredentialSafeSurface
      ? runtime.verifyCredentialSafeHumanIntervention(
          active.id,
          credentialSafeVerificationOptions(active.id)
        )
      : runtime.verifyHumanIntervention(active.id));
  } catch (error) {
    const stillActive = runtime.getActiveIntervention();
    if (
      error instanceof BrowserRuntimeError &&
      error.code === "HUMAN_INTERVENTION_REQUIRED" &&
      stillActive?.id === active.id &&
      stillActive.status === "verifying"
    ) {
      const returned = runtime.claimHumanControl(active.id);
      return explicitHumanSignInRequired(returned, owner);
    }
    if (stillActive?.id === active.id) runtime.cancelHumanIntervention(active.id);
    handoffOwners.delete(active.id);
    explicitHumanSignInInterventions.delete(active.id);
    clearHandoffCheckpoint(owner);
    return errorResult(error);
  }

  runtime.resumeAfterHumanIntervention(active.id);
  takeoverBroker.revokeForIntervention(active.id);
  handoffOwners.delete(active.id);
  explicitHumanSignInInterventions.delete(active.id);
  clearHandoffCheckpoint(owner);
  return staleAfterInterventionResult("maps_request_human_sign_in");
}

async function cancelExplicitHumanSignIn(): Promise<CallToolResult> {
  const active = runtime.getActiveIntervention();
  if (!active || !explicitHumanSignInInterventions.has(active.id)) {
    return jsonResult({ cancelled: false, reason: "no_explicit_human_sign_in" });
  }
  const expectedOwner = ownerFor(
    "maps_request_human_sign_in",
    {},
    "require_fresh_semantic_action"
  );
  const owner = handoffOwners.get(active.id);
  if (!owner || !handoffOwnerMatches(owner, expectedOwner)) {
    return errorResult(new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      "The active human sign-in intervention belongs to another authenticated principal or no longer has a valid owner."
    ));
  }
  policy.consumeAction();
  explicitHumanSignInInterventions.delete(active.id);
  return cancelIntervention(active.id, owner);
}

async function executeToolTask<T>(
  toolName: string,
  args: unknown,
  resumeStrategy: HandoffResumeStrategy,
  task: () => Promise<T>
): Promise<CallToolResult | InputRequiredResult> {
  const owner = ownerFor(toolName, args, resumeStrategy);
  try {
    policy.consumeAction();
    const result = await operationQueue.run(async () => {
      const interventionBefore = runtime.getActiveIntervention()?.id;
      try {
        return await task();
      } finally {
        const interventionAfter = runtime.getActiveIntervention();
        if (interventionAfter && interventionAfter.id !== interventionBefore) {
          const boundOwner = claimHandoffOwner(
            handoffOwners,
            interventionAfter.id,
            interventionAfter.status,
            owner
          );
          if (!boundOwner) {
            takeoverBroker.revokeForIntervention(interventionAfter.id);
            runtime.cancelHumanIntervention(interventionAfter.id);
            throw new BrowserRuntimeError(
              "UI_STATE_CHANGED",
              "A newly-created human intervention could not be bound to the originating authenticated principal. The intervention was cancelled."
            );
          }
        }
      }
    });
    return jsonResult(result);
  } catch (error) {
    if (
      error instanceof BrowserRuntimeError &&
      error.code === "HUMAN_INTERVENTION_REQUIRED" &&
      error.intervention
    ) {
      return humanInputRequired(error.intervention, owner, args);
    }
    return errorResult(error);
  }
}

async function runToolWithHandoff<T>(input: {
  toolName: string;
  args: unknown;
  resumeStrategy: HandoffResumeStrategy;
  ctx: ServerContext;
  task: () => Promise<T>;
}): Promise<CallToolResult | InputRequiredResult> {
  const state = input.ctx.mcpReq.requestState<MapsRequestState>();
  if (!state) {
    consumeMatchingRecovery(input.toolName, input.args);
    return executeToolTask(input.toolName, input.args, input.resumeStrategy, input.task);
  }

  if (state.phase !== "awaiting_human") {
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The returned MCP requestState belongs to a different multi-round action. Restart the Maps action instead of reusing it."
    ));
  }

  if (!handoffStateMatchesInvocation(state, input.toolName, input.args, activePrincipalBinding())) {
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The returned MCP requestState does not match this tool invocation. Restart the Maps action instead of reusing stale intervention state."
    ));
  }

  const expectedOwner = ownerFor(input.toolName, input.args, input.resumeStrategy);
  const owner = handoffOwners.get(state.interventionId);
  if (!owner || !handoffOwnerMatches(owner, expectedOwner)) {
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The human intervention owner does not match this authenticated principal and invocation. Repeat the intended Maps action from the original session."
    ));
  }

  const active = runtime.getActiveIntervention();
  if (!active || active.id !== state.interventionId || active.epoch !== state.epoch) {
    handoffOwners.delete(state.interventionId);
    takeoverBroker.revokeForIntervention(state.interventionId);
    clearHandoffCheckpoint(owner);
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The browser changed while waiting for human intervention. Repeat the intended Maps action."
    ));
  }

  const response = inputResponse(input.ctx.mcpReq.inputResponses, HANDOFF_INPUT_KEY);
  if (response.kind === "missing") {
    return humanInputRequired(active, owner, input.args);
  }
  if (response.kind !== "elicit" || response.action !== "accept") {
    return cancelIntervention(state.interventionId, owner);
  }

  const content = acceptedContent(
    input.ctx.mcpReq.inputResponses,
    HANDOFF_INPUT_KEY,
    handoffDecisionSchema
  );
  if (!content) {
    return humanInputRequired(active, owner, input.args);
  }
  if (content.decision === "cancel") {
    return cancelIntervention(state.interventionId, owner);
  }

  takeoverBroker.revokeForIntervention(state.interventionId);
  const activeCredentialSafeSurface = credentialSafeSurface?.getActive();
  const usedCredentialSafeSurface = activeCredentialSafeSurface?.interventionId === state.interventionId;
  try {
    await revokeCredentialSafeSurface(state.interventionId, owner);
    runtime.markHumanControlComplete(state.interventionId);
    await operationQueue.run(() => usedCredentialSafeSurface
      ? runtime.verifyCredentialSafeHumanIntervention(
          state.interventionId,
          credentialSafeVerificationOptions(state.interventionId)
        )
      : runtime.verifyHumanIntervention(state.interventionId));
  } catch (error) {
    const stillActive = runtime.getActiveIntervention();
    if (
      error instanceof BrowserRuntimeError &&
      error.code === "HUMAN_INTERVENTION_REQUIRED" &&
      stillActive?.id === state.interventionId &&
      stillActive.status === "verifying"
    ) {
      const returned = runtime.claimHumanControl(state.interventionId);
      return humanInputRequired(returned, owner, input.args);
    }
    if (stillActive?.id === state.interventionId) {
      runtime.cancelHumanIntervention(state.interventionId);
    }
    handoffOwners.delete(state.interventionId);
    clearHandoffCheckpoint(owner);
    return errorResult(error);
  }

  const decision = runtime.resumeAfterHumanIntervention(state.interventionId);
  takeoverBroker.revokeForIntervention(state.interventionId);
  handoffOwners.delete(state.interventionId);
  clearHandoffCheckpoint(owner);
  if (decision.resumePolicy !== "replay_safe" || input.resumeStrategy === "require_fresh_semantic_action") {
    return staleAfterInterventionResult(input.toolName);
  }

  return executeToolTask(input.toolName, input.args, input.resumeStrategy, input.task);
}


function routeSendApprovalPrompt(args: RouteSendActionInput): string {
  return [
    `Approve sending the selected route "${args.expectedRouteLabel}"`,
    `from "${args.expectedOrigin}" to "${args.expectedDestination}"`,
    `to the exact device "${args.expectedDeviceLabel}"?`,
    "This creates an external notification on that device.",
    "Approve only this exact route/device action; Human Intervention completion is not approval."
  ].join(" ");
}

async function routeSendApprovalRequired(
  state: ActionApprovalRequestState,
  args: RouteSendActionInput
): Promise<InputRequiredResult> {
  const requestState = await handoffStateCodec.mint(state);
  return inputRequired({
    requestState,
    inputRequests: {
      [ACTION_APPROVAL_INPUT_KEY]: inputRequired.elicit({
        message: routeSendApprovalPrompt(args),
        requestedSchema: actionApprovalDecisionSchema
      })
    }
  });
}

function supportsFormElicitation(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  return supportsActionApprovalFormElicitation(envelope?.[CLIENT_CAPABILITIES_META_KEY]);
}

async function beginRouteSendApproval(
  toolName: string,
  args: RouteSendActionInput,
  ctx: ServerContext
): Promise<CallToolResult | InputRequiredResult> {
  if (!supportsFormElicitation(ctx)) {
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Send to phone explicit approval requires an MCP 2026-07-28 client with form elicitation support; no approval was created and no send action was attempted"
    ));
  }
  let targets: Awaited<ReturnType<SemanticController["readRouteSendTargets"]>> | undefined;
  const preflight = await executeToolTask(
    toolName,
    args,
    "require_fresh_semantic_action",
    async () => {
      policy.assertInteractiveAssistEnabled();
      policy.consumeVisibleRead();
      targets = await controller.readRouteSendTargets(args);
      return { readyForApproval: true };
    }
  );
  if (!targets) return preflight;

  try {
    resolveFreshRouteSendTarget(targets.devices, args.deviceIndex, args.expectedDeviceLabel);
    const epoch = runtime.getResourceEpoch();
    const principal = activePrincipalBinding();
    const request = actionApprovals.request({
      actionName: toolName,
      args,
      epoch,
      principalBinding: principal
    });
    return routeSendApprovalRequired(
      createActionApprovalRequestState({
        toolName,
        args,
        approvalId: request.id,
        epoch,
        principalBinding: principal
      }),
      args
    );
  } catch (error) {
    return errorResult(error);
  }
}

async function runRouteSendWithApproval(
  args: RouteSendActionInput,
  ctx: ServerContext
): Promise<CallToolResult | InputRequiredResult> {
  const toolName = "maps_send_route_to_device";
  const state = ctx.mcpReq.requestState<MapsRequestState>();
  if (!state) return beginRouteSendApproval(toolName, args, ctx);

  if (state.phase === "awaiting_human") {
    return runToolWithHandoff({
      toolName,
      args,
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        throw new BrowserRuntimeError(
          "UI_STATE_CHANGED",
          "Send to phone requires a fresh route/device read and a new explicit approval after Human Intervention"
        );
      }
    });
  }

  if (!actionApprovalStateMatchesInvocation(state, toolName, args, activePrincipalBinding())) {
    actionApprovals.revoke(state.approvalId);
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The returned action-approval requestState does not match this exact route/device invocation"
    ));
  }
  if (runtime.getResourceEpoch() !== state.epoch) {
    actionApprovals.revoke(state.approvalId);
    return errorResult(new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The Maps resource epoch changed while waiting for approval. Re-read the route/device target and request fresh approval."
    ));
  }

  const response = inputResponse(ctx.mcpReq.inputResponses, ACTION_APPROVAL_INPUT_KEY);
  if (response.kind === "missing") return routeSendApprovalRequired(state, args);
  if (response.kind !== "elicit" || response.action !== "accept") {
    actionApprovals.revoke(state.approvalId);
    return jsonResult({ cancelled: true, reason: "action_approval_cancelled" });
  }
  const content = acceptedContent(ctx.mcpReq.inputResponses, ACTION_APPROVAL_INPUT_KEY, actionApprovalDecisionSchema);
  if (!content) return routeSendApprovalRequired(state, args);
  if (content.decision === "cancel") {
    actionApprovals.revoke(state.approvalId);
    return jsonResult({ cancelled: true, reason: "action_approval_cancelled" });
  }

  let receipt: string;
  try {
    receipt = actionApprovals.grant(state.approvalId, activePrincipalBinding());
  } catch (error) {
    return errorResult(error);
  }

  try {
    return await executeToolTask(
      toolName,
      args,
      "require_fresh_semantic_action",
      async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.sendRouteToDevice(args, state.epoch, () => {
          actionApprovals.consume({
            id: state.approvalId,
            receipt,
            actionName: toolName,
            args,
            epoch: state.epoch,
            principalBinding: activePrincipalBinding()
          });
        });
      }
    );
  } finally {
    actionApprovals.revoke(state.approvalId);
  }
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "maps-browser-mcp", version: SERVER_VERSION },
    {
      requestState: { verify: handoffStateCodec.verify },
      inputRequired: { maxRounds: 4, roundTimeoutMs: HANDOFF_STATE_TTL_SECONDS * 1_000 }
    }
  );

  if (config.v5.authenticatedWorkflows && config.credentialSafeHandoff.enabled) {
    server.registerTool(
      "maps_request_human_sign_in",
      {
        description: "Request a Human-only Google Maps sign-in ceremony when the dedicated session is signed out. This tool never clicks Sign in, selects an account, enters credentials/MFA, reads account identity, or exports session material. With credential-safe handoff enabled, supported Human transports stop the automation browser and open the same dedicated profile in a normal browser without agent-owned remote-debugging/automation authority before Human control begins. The legacy hosted_cdp Human path fails closed for credential-safe Human control; Linux/container deployments use the normal-browser webrtc_takeover path.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
      },
      async (_args, ctx) => supportsFormElicitation(ctx)
        ? runToolWithHandoff({
            toolName: "maps_request_human_sign_in",
            args: {},
            resumeStrategy: "require_fresh_semantic_action",
            ctx,
            task: async () => {
              policy.assertInteractiveAssistEnabled();
              policy.consumeVisibleRead();
              return controller.requestHumanSignIn();
            }
          })
        : beginExplicitHumanSignIn()
    );

    server.registerTool(
      "maps_complete_human_sign_in",
      {
        description: "Complete the explicit Human-only Google Maps sign-in fallback after the user has finished the credential-safe takeover surface. This revokes Human authority, verifies signed-in readiness from a fresh Agent CDP connection, checkpoints only the stopped dedicated Chrome profile when configured, and requires a fresh readiness read afterward.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      },
      async () => completeExplicitHumanSignIn()
    );

    server.registerTool(
      "maps_cancel_human_sign_in",
      {
        description: "Cancel an explicit Human-only Google Maps sign-in fallback, revoke its credential-safe takeover surface, and return the dedicated browser runtime to a fresh state without checkpointing a signed-in profile.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
      },
      async () => cancelExplicitHumanSignIn()
    );
  }

  if (config.v5.authenticatedWorkflows) {
    server.registerTool(
      "maps_read_authenticated_readiness",
      {
        description: "Return only a coarse signed_in | signed_out | unknown readiness state for the dedicated Google Maps Web session. This V5-A read never returns account name, email, profile photo, account ID, cookie, or token data. V5 authenticated workflows and Interactive Assist must both be enabled.",
        inputSchema: z.object({}),
        annotations: {
          readOnlyHint: true,
          idempotentHint: true
        }
      },
      async (_args, ctx) => runToolWithHandoff({
        toolName: "maps_read_authenticated_readiness",
        args: {},
        resumeStrategy: "require_fresh_semantic_action",
        ctx,
        task: async () => {
          policy.assertInteractiveAssistEnabled();
          policy.consumeVisibleRead();
          return controller.readAuthenticatedReadiness();
        }
      })
    );
  }

  if (config.v5.authenticatedWorkflows) {
    server.registerTool(
      "maps_read_place_save_state",
      {
        description: "Read only the bounded existing save-list membership for the currently selected Google Maps place. Returns at most 10 visible existing list identities with saved=true|false, never creates a list, never traverses Saved library contents, and closes the chooser without selecting anything. V5 authenticated workflows and Interactive Assist must both be enabled.",
        inputSchema: z.object({ expectedLabel: expectedLabelText }),
        annotations: { readOnlyHint: true, idempotentHint: true }
      },
      async ({ expectedLabel }, ctx) => runToolWithHandoff({
        toolName: "maps_read_place_save_state",
        args: { expectedLabel },
        resumeStrategy: "require_fresh_semantic_action",
        ctx,
        task: async () => {
          policy.assertInteractiveAssistEnabled();
          policy.consumeVisibleRead();
          return controller.readPlaceSaveState(expectedLabel);
        }
      })
    );
  }

  if (config.v5.authenticatedWorkflows) {
    server.registerTool(
      "maps_save_place_to_list",
      {
        description: "Save the currently selected, revalidated Google Maps place to exactly one already-existing list from a fresh bounded save-list chooser. Requires exact place label + list index + expected list label, treats already-saved as idempotent success, never creates/removes/renames/shares lists, and reports success only after aria-checked=true is freshly verified. V5 authenticated workflows and Interactive Assist must both be enabled.",
        inputSchema: z.object({
          expectedPlaceLabel: expectedLabelText,
          listIndex: z.number().int().min(0).max(9),
          expectedListLabel: expectedListLabelText
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true
        }
      },
      async ({ expectedPlaceLabel, listIndex, expectedListLabel }, ctx) => runToolWithHandoff({
        toolName: "maps_save_place_to_list",
        args: { expectedPlaceLabel, listIndex, expectedListLabel },
        resumeStrategy: "require_fresh_semantic_action",
        ctx,
        task: async () => {
          policy.assertInteractiveAssistEnabled();
          policy.consumeVisibleRead();
          policy.consumeAction();
          return controller.savePlaceToList(expectedPlaceLabel, listIndex, expectedListLabel);
        }
      })
    );
  }

  if (config.v5.authenticatedWorkflows) {
    server.registerTool(
      "maps_read_route_send_targets",
      {
        description: "Read only the bounded device targets currently visible in Google Maps Send to phone for one exact selected simple route. Requires signed-in readiness plus exact origin, destination, selected route index and route label; returns at most six device labels, excludes email targets, does not send anything, and closes the dialog after the read.",
        inputSchema: z.object({
          expectedOrigin: locationText,
          expectedDestination: locationText,
          expectedRouteIndex: z.number().int().min(0).max(11),
          expectedRouteLabel: expectedLabelText
        }),
        annotations: { readOnlyHint: true, idempotentHint: true }
      },
      async ({ expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel }, ctx) => runToolWithHandoff({
        toolName: "maps_read_route_send_targets",
        args: { expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel },
        resumeStrategy: "require_fresh_semantic_action",
        ctx,
        task: async () => {
          policy.assertInteractiveAssistEnabled();
          policy.consumeVisibleRead();
          return controller.readRouteSendTargets({ expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel });
        }
      })
    );

    server.registerTool(
      "maps_send_route_to_device",
      {
        description: "Send one exact selected simple Google Maps route to one exact visible device only after a fresh MCP explicit approval bound to principal + resource epoch + route + device. The tool excludes email/free-form targets, never treats Human Intervention completion as approval, consumes approval once immediately before the device click, and refuses automatic replay after any state change.",
        inputSchema: z.object({
          expectedOrigin: locationText,
          expectedDestination: locationText,
          expectedRouteIndex: z.number().int().min(0).max(11),
          expectedRouteLabel: expectedLabelText,
          deviceIndex: z.number().int().min(0).max(5),
          expectedDeviceLabel: expectedDeviceLabelText
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false
        }
      },
      async ({ expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel, deviceIndex, expectedDeviceLabel }, ctx) =>
        runRouteSendWithApproval(
          { expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel, deviceIndex, expectedDeviceLabel },
          ctx
        )
    );
  }

  server.registerTool(
    "maps_search",
    {
      description: "Open one user-directed Google Maps search in the dedicated browser session.",
      inputSchema: z.object({ query: queryText })
    },
    async ({ query }, ctx) => runToolWithHandoff({
      toolName: "maps_search",
      args: { query },
      resumeStrategy: "retry_original",
      ctx,
      task: async () => {
        policy.assertSearchQuery(query);
        const compiled = compiler.search(query);
        const result = await runtime.navigate(compiled.url, compiled.action);
        return { opened: true, url: result.url };
      }
    })
  );

  server.registerTool(
    "maps_read_search_suggestions",
    {
      description: "Open a fresh Google Maps root search box, type one user-directed query, and return at most six live suggestion identities from the exact combobox-controlled Suggestions grid. Returned labels are untrusted external text. The operation does not expose the raw combobox/DOM and intentionally resets the active Maps view to a fresh suggestion surface. Interactive Assist must be enabled.",
      inputSchema: z.object({ query: queryText })
    },
    async ({ query }, ctx) => runToolWithHandoff({
      toolName: "maps_read_search_suggestions",
      args: { query },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.assertSearchQuery(query);
        policy.consumeVisibleRead();
        return controller.readSearchSuggestions(query);
      }
    })
  );

  server.registerTool(
    "maps_select_search_suggestion",
    {
      description: "Select one suggestion from the currently active bounded suggestion state created by maps_read_search_suggestions, using the same query plus the exact returned index and expectedLabel. Duplicate, reordered, missing, stale, or changed suggestion identities fail closed before the row is activated. Success requires the controlled suggestion grid to close and Maps to enter a verified search or place view. Interactive Assist must be enabled.",
      inputSchema: z.object({
        query: queryText,
        index: z.number().int().min(0).max(5),
        expectedLabel: expectedLabelText
      })
    },
    async ({ query, index, expectedLabel }, ctx) => runToolWithHandoff({
      toolName: "maps_select_search_suggestion",
      args: { query, index, expectedLabel },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.assertSearchQuery(query);
        policy.consumeVisibleRead();
        return controller.selectSearchSuggestion(query, index, expectedLabel);
      }
    })
  );

  server.registerTool(
    "maps_get_search_share_link",
    {
      description: "Return the Google Maps-generated share URL for the active search-result list. expectedQuery is required and revalidated against both the canonical maps_search action and the exact visible search combobox immediately before the exact-one Share control is activated. The selected Send a link tab and exactly one visible allow-listed Maps URL are verified, then the dialog is closed semantically. Clipboard contents are never read. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedQuery: queryText
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ expectedQuery }, ctx) => runToolWithHandoff({
      toolName: "maps_get_search_share_link",
      args: { expectedQuery },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.getSearchShareLink(expectedQuery);
      }
    })
  );

  server.registerTool(
    "maps_set_search_rating",
    {
      description: "Apply one bounded live-observed Google Maps Rating filter option to the active search result view. expectedQuery is required and revalidated immediately before each filter/menu action; rating is restricted to the observed 2.0–4.5 half-step options. After selection, the exact requested numeric rating chip (for example `4.0+`) and a closed Rating menu are verified while preserving the expected search query. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedQuery: queryText,
        rating: z.enum(SEARCH_RATING_OPTIONS)
      })
    },
    async ({ expectedQuery, rating }, ctx) => runToolWithHandoff({
      toolName: "maps_set_search_rating",
      args: { expectedQuery, rating },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.setSearchRating(expectedQuery, rating);
      }
    })
  );

  server.registerTool(
    "maps_zoom_search",
    {
      description: "Zoom the active Google Maps search-result viewport by exactly one observed level while preserving a verified visible search query. expectedQuery is revalidated immediately before the exact-one visible Zoom in/out control is activated; direction is restricted to `in|out`. Success requires the same search/query plus an exact one-level zoom change in the public Maps URL. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedQuery: queryText,
        direction: z.enum(SEARCH_ZOOM_DIRECTIONS)
      })
    },
    async ({ expectedQuery, direction }, ctx) => runToolWithHandoff({
      toolName: "maps_zoom_search",
      args: { expectedQuery, direction },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.zoomSearch(expectedQuery, direction);
      }
    })
  );

  server.registerTool(
    "maps_directions",
    {
      description: "Open Google Maps directions using documented Maps URL parameters. Origin may be omitted so Google Maps can use the browser/device location when available. Optional waypoints and avoid constraints remain bounded.",
      inputSchema: z.object({
        origin: locationText.optional(),
        destination: locationText,
        mode: z.enum(TRAVEL_MODES).default("transit"),
        waypoints: z.array(locationText).max(3).optional(),
        avoid: z.array(z.enum(ROUTE_AVOID_OPTIONS)).max(3).optional()
      })
    },
    async ({ origin, destination, mode, waypoints, avoid }, ctx) => {
      const args = {
        origin,
        destination,
        mode,
        ...(waypoints && waypoints.length > 0 ? { waypoints } : {}),
        ...(avoid && avoid.length > 0 ? { avoid } : {})
      };
      return runToolWithHandoff({
        toolName: "maps_directions",
        args,
        resumeStrategy: "retry_original",
        ctx,
        task: async () => {
          const compiled = compiler.directions({ origin, destination, mode, waypoints, avoid });
          const result = await runtime.navigate(compiled.url, compiled.action);
          return {
            opened: true,
            url: result.url,
            mode,
            ...(compiled.action.kind === "directions" && compiled.action.waypoints
              ? { waypoints: compiled.action.waypoints }
              : {}),
            ...(compiled.action.kind === "directions" && compiled.action.avoid
              ? { avoid: compiled.action.avoid }
              : {})
          };
        }
      });
    }
  );

  server.registerTool(
    "maps_show",
    {
      description: "Open Google Maps centered on coordinates using an official Maps URL.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        zoom: z.number().int().min(0).max(21).optional()
      })
    },
    async (args, ctx) => runToolWithHandoff({
      toolName: "maps_show",
      args,
      resumeStrategy: "retry_original",
      ctx,
      task: async () => {
        const compiled = compiler.show(args);
        const result = await runtime.navigate(compiled.url, compiled.action);
        return { opened: true, url: result.url };
      }
    })
  );

  server.registerTool(
    "maps_streetview",
    {
      description: "Open Street View at coordinates using an official Google Maps URL.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        heading: z.number().min(0).max(360).optional(),
        pitch: z.number().min(-90).max(90).optional(),
        fov: z.number().min(10).max(100).optional()
      })
    },
    async (args, ctx) => runToolWithHandoff({
      toolName: "maps_streetview",
      args,
      resumeStrategy: "retry_original",
      ctx,
      task: async () => {
        const compiled = compiler.streetview(args);
        const result = await runtime.navigate(compiled.url, compiled.action);
        return { opened: true, url: result.url };
      }
    })
  );

  server.registerTool(
    "maps_select_result",
    {
      description: "Select a currently displayed place result by zero-based index. Pass expectedLabel from maps_read_place_summary when available so the server refuses to click if the dynamic result list changed.",
      inputSchema: z.object({
        index: z.number().int().min(0).max(19),
        expectedLabel: expectedLabelText.optional()
      })
    },
    async ({ index, expectedLabel }, ctx) => runToolWithHandoff({
      toolName: "maps_select_result",
      args: { index, expectedLabel },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: () => controller.selectResult(index, expectedLabel)
    })
  );

  server.registerTool(
    "maps_get_place_share_link",
    {
      description: "Return the Google Maps-generated share link for the currently selected place. expectedLabel is required and is revalidated against the active place immediately before the visible Share control is activated. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedLabel: expectedLabelText
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ expectedLabel }, ctx) => runToolWithHandoff({
      toolName: "maps_get_place_share_link",
      args: { expectedLabel },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.getPlaceShareLink(expectedLabel);
      }
    })
  );

  server.registerTool(
    "maps_search_nearby",
    {
      description: "Search near the currently selected Google Maps place using its visible Nearby workflow. expectedLabel is required and revalidated immediately before the scoped Nearby control is activated. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedLabel: expectedLabelText,
        query: queryText
      })
    },
    async ({ expectedLabel, query }, ctx) => runToolWithHandoff({
      toolName: "maps_search_nearby",
      args: { expectedLabel, query },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.assertSearchQuery(query);
        policy.consumeVisibleRead();
        return controller.searchNearby(expectedLabel, query);
      }
    })
  );

  server.registerTool(
    "maps_select_place_tab",
    {
      description: "Select the verified Overview or About tab for the currently selected Google Maps place. expectedLabel is required and is revalidated against place-bound visible tab identity immediately before the action. Reviews is intentionally not exposed until its current live UI control is re-observed. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedLabel: expectedLabelText,
        tab: z.enum(["overview", "about"])
      })
    },
    async ({ expectedLabel, tab }, ctx) => runToolWithHandoff({
      toolName: "maps_select_place_tab",
      args: { expectedLabel, tab },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.selectPlaceTab(expectedLabel, tab);
      }
    })
  );

  server.registerTool(
    "maps_expand_opening_hours",
    {
      description: "Expand the visible opening-hours surface for the currently selected Google Maps place. expectedLabel is required and revalidated immediately before exactly one observed hours control is activated. The tool verifies only the expansion state and does not return or harvest the weekly hours data. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedLabel: expectedLabelText
      })
    },
    async ({ expectedLabel }, ctx) => runToolWithHandoff({
      toolName: "maps_expand_opening_hours",
      args: { expectedLabel },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.expandOpeningHours(expectedLabel);
      }
    })
  );

  server.registerTool(
    "maps_open_place_photos",
    {
      description: "Open the visible Google Maps photo viewer for the currently selected place. expectedLabel is required and revalidated immediately before exactly one bounded photo control is activated. The previous place semantic state is invalidated after the verified viewer transition. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedLabel: expectedLabelText
      })
    },
    async ({ expectedLabel }, ctx) => runToolWithHandoff({
      toolName: "maps_open_place_photos",
      args: { expectedLabel },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.openPlacePhotos(expectedLabel);
      }
    })
  );

  server.registerTool(
    "maps_select_route",
    {
      description: "Select a currently displayed route candidate by zero-based index. Pass expectedLabel from maps_read_route_summary when available to guard against UI reordering.",
      inputSchema: z.object({
        index: z.number().int().min(0).max(11),
        expectedLabel: expectedLabelText.optional()
      })
    },
    async ({ index, expectedLabel }, ctx) => runToolWithHandoff({
      toolName: "maps_select_route",
      args: { index, expectedLabel },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: () => controller.selectRoute(index, expectedLabel)
    })
  );

  server.registerTool(
    "maps_set_transit_time",
    {
      description: "Set a same-day depart-at or arrive-by time on one fresh verified Google Maps transit directions request. expectedOrigin and expectedDestination must match the active documented maps_directions request; mode is restricted to depart_at|arrive_by and time to 24-hour HH:MM. The operation verifies the localized mode trigger, exact transit-time input, unchanged visible route endpoints, and directions view before dropping the stale replayable navigation action. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedOrigin: locationText,
        expectedDestination: locationText,
        mode: z.enum(TRANSIT_TIME_MODES),
        time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      })
    },
    async ({ expectedOrigin, expectedDestination, mode, time }, ctx) => runToolWithHandoff({
      toolName: "maps_set_transit_time",
      args: { expectedOrigin, expectedDestination, mode, time },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.setTransitTime(expectedOrigin, expectedDestination, mode, time);
      }
    })
  );

  server.registerTool(
    "maps_set_recommended_travel_mode",
    {
      description: "Select Google Maps' live-observed Recommended/Best travel-mode radio for one fresh simple transit directions request. expectedOrigin and expectedDestination must match the active documented maps_directions request; omitted origins, waypoints, avoid constraints, and non-transit requests fail closed. Success verifies the exact Best/おすすめ radio plus unchanged visible resolved endpoints, then drops the stale replayable URL action while preserving the current directions view for bounded route reading/selection. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedOrigin: locationText,
        expectedDestination: locationText
      })
    },
    async ({ expectedOrigin, expectedDestination }, ctx) => runToolWithHandoff({
      toolName: "maps_set_recommended_travel_mode",
      args: { expectedOrigin, expectedDestination },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.setRecommendedTravelMode(expectedOrigin, expectedDestination);
      }
    })
  );

  server.registerTool(
    "maps_get_route_share_link",
    {
      description: "Return the Google Maps-generated share URL from the visible Share directions dialog for one selected simple transit route. expectedOrigin and expectedDestination must match the active canonical directions request; the route must already be selected with maps_select_route. The operation is intentionally transit-only for the currently live-observed JA/en-US share surface and never reads clipboard contents. Interactive Assist must be enabled.",
      inputSchema: z.object({
        expectedOrigin: locationText,
        expectedDestination: locationText
      })
    },
    async ({ expectedOrigin, expectedDestination }, ctx) => runToolWithHandoff({
      toolName: "maps_get_route_share_link",
      args: { expectedOrigin, expectedDestination },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return controller.getRouteShareLink(expectedOrigin, expectedDestination);
      }
    })
  );

  server.registerTool(
    "maps_swap_route_endpoints",
    {
      description: "Swap the explicit origin and destination of one fresh simple Google Maps directions request by rebuilding documented Maps URL parameters rather than automating the observed UI swap button. expectedOrigin and expectedDestination must match the active canonical request; waypoint routes and omitted origins fail closed. The current mode and bounded avoid constraints are preserved.",
      inputSchema: z.object({
        expectedOrigin: locationText,
        expectedDestination: locationText
      })
    },
    async ({ expectedOrigin, expectedDestination }, ctx) => runToolWithHandoff({
      toolName: "maps_swap_route_endpoints",
      args: { expectedOrigin, expectedDestination },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: () => controller.swapRouteEndpoints(expectedOrigin, expectedDestination)
    })
  );

  server.registerTool(
    "maps_set_travel_mode",
    {
      description: "Change the travel mode of the active directions request by rebuilding the official Maps URL instead of exploring the DOM. Existing waypoints and avoid constraints are preserved.",
      inputSchema: z.object({ mode: z.enum(TRAVEL_MODES) })
    },
    async ({ mode }, ctx) => runToolWithHandoff({
      toolName: "maps_set_travel_mode",
      args: { mode },
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: () => controller.setTravelMode(mode)
    })
  );

  server.registerTool(
    "maps_read_place_summary",
    {
      description: "Read a small bounded summary from the active Google Maps search/place UI. Returned labels/text are untrusted external data. Disabled by default; no full DOM, review-body harvesting, or persistent dataset extraction.",
      inputSchema: z.object({})
    },
    async (_args, ctx) => runToolWithHandoff({
      toolName: "maps_read_place_summary",
      args: {},
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return reader.read("place");
      }
    })
  );

  server.registerTool(
    "maps_read_route_summary",
    {
      description: "Read a small bounded summary from the active Google Maps route UI. Returned labels/text are untrusted external data. Disabled by default and intended only for the user's active request.",
      inputSchema: z.object({})
    },
    async (_args, ctx) => runToolWithHandoff({
      toolName: "maps_read_route_summary",
      args: {},
      resumeStrategy: "require_fresh_semantic_action",
      ctx,
      task: async () => {
        policy.assertInteractiveAssistEnabled();
        policy.consumeVisibleRead();
        return reader.read("route");
      }
    })
  );

  const embedApiKey = config.mcpApps.googleMapsEmbedApiKey;
  if (embedApiKey) {
    server.registerResource(
      "maps_directions_app",
      MAP_DIRECTIONS_APP_RESOURCE_URI,
      {
        title: "Google Maps directions",
        description: "Inline Google Maps directions view for MCP Apps-capable hosts.",
        mimeType: MCP_APP_MIME_TYPE
      },
      async (uri) => ({
        contents: [{
          uri: uri.href,
          mimeType: MCP_APP_MIME_TYPE,
          text: buildDirectionsAppHtml(embedApiKey),
          _meta: {
            ui: {
              csp: {
                frameDomains: [...MAP_DIRECTIONS_FRAME_DOMAINS]
              },
              prefersBorder: true
            }
          }
        }]
      })
    );
  }

  server.registerTool(
    "maps_render_directions",
    {
      title: "Render Google Maps directions",
      description: "Return explicit origin/destination directions data and, when Google Maps Embed is configured, render it in an inline MCP Apps view. Display-only: this does not navigate or mutate the dedicated browser session.",
      inputSchema: z.object({
        origin: locationText,
        destination: locationText,
        mode: z.enum(TRAVEL_MODES).default("driving")
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      },
      ...(embedApiKey ? {
        _meta: {
          ui: {
            resourceUri: MAP_DIRECTIONS_APP_RESOURCE_URI
          }
        }
      } : {})
    },
    async ({ origin, destination, mode }) => {
      const route = { origin, destination, mode };
      return {
        content: [{
          type: "text" as const,
          text: embedApiKey
            ? `Directions prepared for ${origin} → ${destination} (${mode}); an inline map is available on MCP Apps-capable hosts.`
            : `Directions prepared for ${origin} → ${destination} (${mode}). Inline map rendering is disabled because GOOGLE_MAPS_EMBED_API_KEY is not configured.`
        }],
        structuredContent: route
      };
    }
  );

  return server;
}

export function isTakeoverHttpPath(pathname: string): boolean {
  return takeoverBroker.isEnabled() && takeoverBroker.isPath(pathname);
}

export async function handleTakeoverHttpRequest(request: Request): Promise<Response> {
  const principal = currentRequestPrincipal();
  return takeoverBroker.handle(request, principal ? principalBinding(principal) : undefined);
}

export async function probeBrowserReady(): Promise<void> {
  await operationQueue.run(async () => {
    const client = await runtime.getClient();
    await client.Runtime.evaluate({ expression: "1", returnByValue: true });
  });
}

export async function shutdownRuntime(): Promise<void> {
  const active = runtime.getActiveIntervention();
  if (active) takeoverBroker.revokeForIntervention(active.id);
  await operationQueue.drain();
  await credentialSafeCuaAdapter?.close().catch(() => undefined);
  await credentialSafeBrowser?.close().catch(() => undefined);
  await runtime.close();
}

export { config };
