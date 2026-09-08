import type { EventEmitter } from "node:events";
import type CDP from "chrome-remote-interface";

export const SURFACE_CLASSES = ["maps", "google_auth", "google_consent", "google_challenge", "google_other", "blank", "browser_error", "other", "unavailable"] as const;
export type SurfaceClass = typeof SURFACE_CLASSES[number];
export function classifySurface(value: unknown): SurfaceClass {
  if (typeof value !== "string") return "unavailable";
  if (value === "about:blank") return "blank";
  if (value.startsWith("chrome-error://")) return "browser_error";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "other";
    if (url.hostname === "accounts.google.com") return "google_auth";
    if (url.hostname === "consent.google.com") return "google_consent";
    if (url.hostname === "www.google.com" && (url.pathname === "/maps" || url.pathname.startsWith("/maps/"))) return "maps";
    if ((url.hostname === "www.google.com" && url.pathname.startsWith("/sorry")) || url.hostname === "recaptcha.google.com") return "google_challenge";
    if (url.hostname === "google.com" || url.hostname.endsWith(".google.com")) return "google_other";
    return "other";
  } catch { return "unavailable"; }
}

export const PROBE_REASONS = ["signed_in_controls", "signed_out_controls", "not_maps", "missing_controls", "conflicting_controls", "invalid_probe", "evaluation_exception", "evaluation_rejected", "evaluation_timeout"] as const;
export type ProbeReason = typeof PROBE_REASONS[number];
export function readinessReason(value: unknown): ProbeReason {
  if (!value || typeof value !== "object") return "invalid_probe";
  const probe = value as Record<string, unknown>;
  if (!["mapsSurface", "hasSignInLink", "hasAccountHref", "hasAccountAria"].every(key => typeof probe[key] === "boolean")) return "invalid_probe";
  if (!probe.mapsSurface) return "not_maps";
  const account = probe.hasAccountHref || probe.hasAccountAria;
  if (account && probe.hasSignInLink) return "conflicting_controls";
  if (account) return "signed_in_controls";
  if (probe.hasSignInLink) return "signed_out_controls";
  return "missing_controls";
}

export type AgentDiagnosticPhase = "human_verification" | "post_checkpoint" | "ordinary_readiness";
const PHASES = ["human_verification", "post_checkpoint", "ordinary_readiness"];
const EVENTS = ["step", "targets", "probe", "summary", "observer"];
const STEPS = ["preflight", "connect", "navigate", "url_guard", "challenge_guard", "settle", "checkpoint", "mark_verified", "reopen_stop", "read", "chrome_start", "target_list", "target_create", "target_attach", "domains_enable", "cdp_ping"];
const ENUMS: Record<string, readonly string[]> = {
  stage: STEPS,
  state: ["started", "completed", "failed", "available", "unavailable"],
  result: ["completed", "failed"],
  cleanupState: ["completed", "failed"],
  reason: PROBE_REASONS,
  surface: SURFACE_CLASSES,
  mainFrameSurface: SURFACE_CLASSES,
  readyState: ["loading", "interactive", "complete", "unavailable"],
  visibility: ["visible", "hidden", "unavailable"],
  language: ["ja", "en", "other", "unspecified", "unavailable"],
  selection: ["existing_maps", "new_blank", "ambiguous", "cached", "final"],
  errorKind: ["none", "timeout", "transport", "policy", "browser_state", "context_destroyed", "target_closed", "other"],
  loadWait: ["event", "timeout", "unavailable"],
  networkError: ["none", "dns", "tls", "connection", "timeout", "aborted", "blocked", "other"],
};
const BOOLS = new Set(["mapsSurface", "hasSignInLink", "hasAccountHref", "hasAccountAria", "bodyPresent", "mainFrame", "sameTarget", "targetPresent", "download", "navigationError", "networkEnabled", "observerAvailable", "mainFrameKnown", "crashObserverEnabled"]);
const COUNTS = new Set(["elapsedMs", "pages", "mapsPages", "authPages", "blankPages", "otherPages", "visibleSignIn", "visibleAccount", "controls", "iframes", "bodyChildren", "suppressedProbes", "probeCount", "evaluationExceptions", "evaluationRejections", "evaluationTimeouts", "invalidProbes", "notMaps", "missingControls", "conflictingControls", "signedInControls", "signedOutControls", "mainNavigations", "contextClears", "documentResponses", "scriptResponses", "httpErrors", "redirects", "loadingFailures", "documentFailures", "scriptFailures", "lastDocumentStatus", "crashes", "runtimeExceptions", "disconnects", "mainDocumentResponses"]);
export type DiagnosticFields = Record<string, string | boolean | number>;
export function formatAgentSurfaceDiagnostic(phase: AgentDiagnosticPhase, event: string, fields: DiagnosticFields): string {
  if (!PHASES.includes(phase) || !EVENTS.includes(event)) throw new Error("Invalid agent diagnostic envelope");
  for (const [key, value] of Object.entries(fields)) {
    if (ENUMS[key]?.includes(value as string) && typeof value === "string") continue;
    if (BOOLS.has(key) && typeof value === "boolean") continue;
    if (COUNTS.has(key) && Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000) continue;
    throw new Error("Invalid agent diagnostic field or value");
  }
  return JSON.stringify({ type: "agent_surface_diagnostics", phase, event, ...fields });
}

export function diagnosticErrorKind(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === "DIAGNOSTIC_TIMEOUT") return "timeout";
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EPIPE") return "transport";
  if (code === "POLICY_DENIED") return "policy";
  if (code === "UI_STATE_CHANGED" || code === "BROWSER_UNAVAILABLE" || code === "HUMAN_INTERVENTION_REQUIRED" || code === "MAPS_NOT_OPEN") return "browser_state";
  const message = (error as { message?: unknown } | undefined)?.message;
  if (typeof message === "string") {
    if (/execution context (?:was destroyed|is not available)|Cannot find context with specified id/i.test(message)) return "context_destroyed";
    if (/target closed|session closed|not connected|WebSocket is not open/i.test(message)) return "target_closed";
  }
  return "other";
}

export async function boundedObservation<T>(work: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Diagnostic operation timed out"), { code: "DIAGNOSTIC_TIMEOUT" })), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function networkErrorClass(value: unknown): string {
  if (typeof value !== "string") return "other";
  if (/^net::ERR_NAME_/.test(value)) return "dns";
  if (/^net::ERR_(CERT_|SSL_)/.test(value)) return "tls";
  if (/^net::ERR_CONNECTION_/.test(value)) return "connection";
  if (value === "net::ERR_TIMED_OUT") return "timeout";
  if (value === "net::ERR_ABORTED") return "aborted";
  if (/^net::ERR_BLOCKED_/.test(value)) return "blocked";
  return "other";
}

/** No raw event, URL, title, exception, header, response, console text or IDs leave this collector. */
export class AgentSurfaceDiagnostics {
  private readonly started = Date.now();
  private lastProbe = "";
  private lastProbeFields: DiagnosticFields = {};
  private mainFrameId?: string;
  private emittedProbes = 0;
  private disposed = false;
  private selectedTarget?: string;
  selected(target: string) { this.selectedTarget = target; }
  private cleanup: Array<() => void> = [];
  private networkOwned = false;
  private inspectorOwned = false;
  private client?: CDP.Client;
  private readonly counts: DiagnosticFields = {
    probeCount: 0, suppressedProbes: 0, evaluationExceptions: 0, evaluationRejections: 0, evaluationTimeouts: 0,
    invalidProbes: 0, notMaps: 0, missingControls: 0, conflictingControls: 0, signedInControls: 0, signedOutControls: 0,
    mainNavigations: 0, contextClears: 0, documentResponses: 0, scriptResponses: 0, httpErrors: 0,
    redirects: 0, loadingFailures: 0, documentFailures: 0, scriptFailures: 0, lastDocumentStatus: 0, crashes: 0,
    runtimeExceptions: 0, disconnects: 0, mainDocumentResponses: 0, mainFrameKnown: false, mainFrameSurface: "unavailable",
    networkError: "none", observerAvailable: false, networkEnabled: false, crashObserverEnabled: false
  };
  constructor(readonly phase: AgentDiagnosticPhase, private readonly logger: (line: string) => void = line => console.error(`[maps-browser-mcp] ${line}`)) {}
  emit(event: string, fields: DiagnosticFields) {
    // Diagnostics must not change the original operation outcome, including on a logging failure.
    try { this.logger(formatAgentSurfaceDiagnostic(this.phase, event, fields)); } catch {}
  }
  private increment(key: string) { this.counts[key] = Math.min(1_000_000, Number(this.counts[key] ?? 0) + 1); }
  async step<T>(stage: string, run: () => Promise<T>): Promise<T> {
    const started = Date.now();
    this.emit("step", { stage, state: "started" });
    try {
      const value = await run();
      this.emit("step", { stage, state: "completed", elapsedMs: Date.now() - started });
      return value;
    } catch (error) {
      this.emit("step", { stage, state: "failed", errorKind: diagnosticErrorKind(error), elapsedMs: Date.now() - started });
      throw error;
    }
  }
  targets(targets: readonly { type?: string; url?: string; id?: string; targetId?: string }[], selection: string, selectedId?: string, priorId?: string) {
    const pages = targets.filter(t => t.type === "page");
    const classes = pages.map(t => classifySurface(t.url));
    this.emit("targets", {
      selection, pages: pages.length, mapsPages: classes.filter(c => c === "maps").length,
      authPages: classes.filter(c => c === "google_auth").length,
      blankPages: classes.filter(c => c === "blank").length,
      otherPages: classes.filter(c => c !== "maps" && c !== "google_auth" && c !== "blank").length,
      ...(selectedId ? { targetPresent: pages.some(t => (t.id ?? t.targetId) === selectedId) } : {}),
      ...(selectedId && (priorId ?? this.selectedTarget) ? {
        sameTarget: pages.some(t => (t.id ?? t.targetId) === selectedId) && selectedId === (priorId ?? this.selectedTarget)
      } : {})
    });
  }
  probe(value: unknown, failure?: ProbeReason, errorKind = "none") {
    const reason = failure ?? readinessReason(value);
    this.increment("probeCount");
    const countKey: Record<ProbeReason, string> = {
      signed_in_controls: "signedInControls", signed_out_controls: "signedOutControls", not_maps: "notMaps",
      missing_controls: "missingControls", conflicting_controls: "conflictingControls", invalid_probe: "invalidProbes",
      evaluation_exception: "evaluationExceptions", evaluation_rejected: "evaluationRejections", evaluation_timeout: "evaluationTimeouts"
    };
    this.increment(countKey[reason]);
    const fields: DiagnosticFields = { reason, errorKind };
    const probe = value && typeof value === "object" ? value as Record<string, unknown> : {};
    // Copy only typed, bounded values; never spread a page-controlled result into logs.
    for (const key of ["mapsSurface", "hasSignInLink", "hasAccountHref", "hasAccountAria", "bodyPresent"]) {
      if (typeof probe[key] === "boolean") fields[key] = probe[key];
    }
    for (const key of ["surface", "readyState", "visibility", "language"]) {
      fields[key] = ENUMS[key]!.includes(probe[key] as string) ? probe[key] as string : "unavailable";
    }
    for (const key of ["visibleSignIn", "visibleAccount", "controls", "iframes", "bodyChildren"]) {
      if (Number.isSafeInteger(probe[key]) && Number(probe[key]) >= 0) fields[key] = Math.min(10000, Number(probe[key]));
    }
    const signature = JSON.stringify(fields);
    if (signature !== this.lastProbe && this.emittedProbes < 12) {
      this.emit("probe", fields);
      this.emittedProbes += 1;
    } else this.increment("suppressedProbes");
    this.lastProbe = signature;
    this.lastProbeFields = fields;
  }
  async attach(client: CDP.Client, observeNetwork: boolean): Promise<void> {
    this.client = client;
    try {
      this.cleanup.push(client.Page.frameNavigated(({ frame }) => {
        if (this.disposed || frame.parentId) return;
        this.increment("mainNavigations");
        this.mainFrameId = frame.id;
        this.counts.mainFrameKnown = true;
        this.counts.mainFrameSurface = classifySurface(frame.url);
      }));
      this.cleanup.push(client.Runtime.executionContextsCleared(() => { if (!this.disposed) this.increment("contextClears"); }));
      this.cleanup.push(client.Runtime.exceptionThrown(() => { if (!this.disposed) this.increment("runtimeExceptions"); }));
      const onDisconnect = () => { if (!this.disposed) this.increment("disconnects"); };
      client.on("disconnect", onDisconnect);
      this.cleanup.push(() => { (client as unknown as EventEmitter).removeListener("disconnect", onDisconnect); });
      try {
        const { frameTree } = await boundedObservation(client.Page.getFrameTree(), 500);
        this.mainFrameId = frameTree.frame.id;
        this.counts.mainFrameKnown = true;
        this.counts.mainFrameSurface = classifySurface(frameTree.frame.url);
      } catch { /* Missing frame tree remains explicitly unknown. */ }
      // Inspector notifications carry no content into the diagnostic stream.
      if (client.Inspector?.targetCrashed) {
        this.cleanup.push(client.Inspector.targetCrashed(() => { if (!this.disposed) this.increment("crashes"); }));
        if (client.Inspector.enable) {
          this.inspectorOwned = true;
          try {
            await boundedObservation(client.Inspector.enable(), 500);
            this.counts.crashObserverEnabled = true;
          } catch { /* Other observers can still collect evidence. */ }
        }
      }
      this.counts.observerAvailable = true;
      if (observeNetwork) {
        this.cleanup.push(client.Network.responseReceived(({ type, response, frameId }) => {
          if (this.disposed) return;
          if (type === "Document") {
            this.increment("documentResponses");
            if (this.mainFrameId && frameId === this.mainFrameId) {
              this.increment("mainDocumentResponses");
              this.counts.lastDocumentStatus = Number.isInteger(response.status) && response.status >= 0 && response.status <= 599 ? response.status : 0;
            }
          }
          if (type === "Script") this.increment("scriptResponses");
          if (response.status >= 400) this.increment("httpErrors");
        }));
        this.cleanup.push(client.Network.requestWillBeSent(({ redirectResponse }) => {
          if (!this.disposed && redirectResponse) this.increment("redirects");
        }));
        this.cleanup.push(client.Network.loadingFailed(({ type, errorText }) => {
          if (this.disposed) return;
          this.increment("loadingFailures");
          if (type === "Document") this.increment("documentFailures");
          if (type === "Script") this.increment("scriptFailures");
          this.counts.networkError = networkErrorClass(errorText);
        }));
        this.networkOwned = true;
        await boundedObservation(client.Network.enable());
        this.counts.networkEnabled = true;
      }
      this.emit("observer", { state: "available", networkEnabled: this.counts.networkEnabled === true });
    } catch {
      this.emit("observer", { state: "unavailable", networkEnabled: false });
    }
  }
  async finish(result: "completed" | "failed") {
    this.disposed = true;
    let cleanupState = "completed";
    for (const unsubscribe of this.cleanup.splice(0)) { try { unsubscribe(); } catch { cleanupState = "failed"; } }
    if (this.networkOwned && this.client) {
      try { await boundedObservation(this.client.Network.disable(), 500); } catch { cleanupState = "failed"; }
    }
    if (this.inspectorOwned && this.client) {
      try { await boundedObservation(this.client.Inspector.disable(), 500); } catch { cleanupState = "failed"; }
    }
    this.emit("summary", { ...this.counts, ...this.lastProbeFields, result, cleanupState, elapsedMs: Math.min(1_000_000_000, Date.now() - this.started) });
  }
}
