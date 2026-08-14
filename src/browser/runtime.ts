import CDP from "chrome-remote-interface";
import {
  ExecutionHandoffError,
  ExecutionHandoffState,
  type ExecutionIntervention,
  type ResumeDecision,
  type ResumePolicy
} from "../execution-handoff.js";
import type { MapsAction, MapsViewState } from "../types.js";
import { PolicyEngine, PolicyError } from "../policy/policy-engine.js";
import { classifyGoogleInterventionSurface } from "./intervention-surface.js";
import { ChromeProcess } from "./chrome-process.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CdpClient = Awaited<ReturnType<typeof CDP>>;
type CandidateKind = "place" | "route";
type MapsPathKind = "search" | "place" | "directions" | "map" | "root" | "other";
export type MapsInterventionReason = "access_challenge" | "sign_in" | "consent" | "external_surface";
export type MapsIntervention = ExecutionIntervention<MapsAction, MapsInterventionReason>;

const HUMAN_TAKEOVER_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight"
]);

function actionToView(action: MapsAction): MapsViewState {
  switch (action.kind) {
    case "search":
      return "search";
    case "directions":
      return "directions";
    case "show":
      return "show";
    case "streetview":
      return "streetview";
  }
}

function mapsPathKind(value: string): MapsPathKind {
  try {
    const pathname = new URL(value).pathname;
    if (pathname === "/maps" || pathname === "/maps/") return "root";
    if (pathname.startsWith("/maps/search/")) return "search";
    if (pathname.startsWith("/maps/place/")) return "place";
    if (pathname.startsWith("/maps/dir/")) return "directions";
    if (pathname === "/maps/@" || pathname.startsWith("/maps/@/")) return "map";
    return "other";
  } catch {
    return "other";
  }
}

function resumePolicyForMapsAction(action: MapsAction | undefined): ResumePolicy {
  return action ? "replay_safe" : "never_replay";
}

function candidateExpression(kind: CandidateKind, clickIndex?: number, expectedLabel?: string): string {
  const click = clickIndex === undefined ? "null" : String(clickIndex);
  const expected = JSON.stringify(expectedLabel?.trim().slice(0, 240) ?? "");
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
    const safePlaceLink = (el) => {
      try {
        const url = new URL(el.href, location.href);
        return url.protocol === 'https:' && url.origin === location.origin && url.pathname.startsWith('/maps/place/');
      } catch {
        return false;
      }
    };
    const unique = (nodes, limit) => {
      const result = [];
      const seen = new Set();
      for (const el of nodes) {
        if (!visible(el)) continue;
        const label = labelOf(el);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        result.push({ el, label });
        if (result.length >= limit) break;
      }
      return result;
    };

    let items;
    if (${JSON.stringify(kind)} === 'place') {
      const feed = Array.from(document.querySelectorAll('[role="feed"] a[href*="/maps/place/"]')).filter(safePlaceLink);
      const fallback = Array.from(document.querySelectorAll('[role="main"] a[href*="/maps/place/"]')).filter(safePlaceLink);
      items = unique(feed.some(visible) ? feed : fallback, 20);
    } else {
      const primary = Array.from(document.querySelectorAll('[role="main"] [data-trip-index]'));
      if (primary.some(visible)) {
        items = unique(primary, 12);
      } else {
        const durationLike = /(\\d+\\s*(?:min|mins|hr|hrs|h|分|時間))/i;
        const fallback = Array.from(document.querySelectorAll('[role="main"] [role="button"]'))
          .filter((el) => durationLike.test(labelOf(el)));
        items = unique(fallback, 12);
      }
    }

    const index = ${click};
    if (index === null) return { ok: true, labels: items.map((item) => item.label) };
    const target = items[index];
    if (!target) return { ok: false, reason: 'missing' };
    const expected = ${expected};
    const normalize = (value) => value.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    if (expected && normalize(target.label) !== normalize(expected)) {
      return { ok: false, reason: 'changed', label: target.label };
    }
    target.el.click();
    return { ok: true, label: target.label };
  })()`;
}

const INLINE_CHALLENGE_EXPRESSION = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const selectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="/sorry/"]',
    'form[action*="/sorry/"]',
    '#captcha',
    'input[name="captcha"]'
  ];
  return selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(visible));
})()`;

export class BrowserRuntimeError extends Error {
  constructor(
    public readonly code:
      | "BROWSER_UNAVAILABLE"
      | "MAPS_NOT_OPEN"
      | "HUMAN_INTERVENTION_REQUIRED"
      | "UI_ELEMENT_NOT_FOUND"
      | "UI_STATE_CHANGED",
    message: string,
    public readonly intervention?: MapsIntervention
  ) {
    super(message);
    this.name = "BrowserRuntimeError";
  }
}

export class MapsBrowserRuntime {
  private client?: CdpClient;
  private port?: number;
  private targetId?: string;
  private lastAction?: MapsAction;
  private viewState: MapsViewState = "blank";
  private readonly handoff = new ExecutionHandoffState<MapsAction, MapsInterventionReason>();

  constructor(
    private readonly chrome: ChromeProcess,
    private readonly policy: PolicyEngine
  ) {}

  getLastAction(): MapsAction | undefined {
    return this.lastAction;
  }

  getViewState(): MapsViewState {
    return this.viewState;
  }

  getResourceEpoch(): number {
    return this.handoff.getResourceEpoch();
  }

  markSemanticMutation(): void {
    this.assertAgentAuthority();
    this.handoff.advanceResourceEpoch();
  }

  invalidateSemanticContext(): void {
    this.assertAgentAuthority();
    if (this.viewState === "blank" && this.lastAction === undefined) return;
    this.invalidateSemanticState();
  }

  getActiveIntervention(): MapsIntervention | undefined {
    return this.handoff.getActive();
  }

  claimHumanControl(interventionId: string): MapsIntervention {
    return this.handoff.claimHuman(interventionId);
  }

  markHumanControlComplete(interventionId: string): MapsIntervention {
    return this.handoff.markHumanComplete(interventionId);
  }

  async verifyHumanIntervention(interventionId: string): Promise<MapsIntervention> {
    const active = this.handoff.getActive();
    if (!active || active.id !== interventionId) {
      throw new ExecutionHandoffError("INTERVENTION_NOT_FOUND", "The intervention is no longer active");
    }
    if (active.status !== "verifying") {
      throw new ExecutionHandoffError(
        "INTERVENTION_STATE_CHANGED",
        `Intervention ${active.id} is ${active.status}; expected verifying`
      );
    }

    const client = await this.getClientUnchecked();
    const url = await this.currentUrlUnchecked(client);
    this.assertAllowedCurrentUrl(url, active.action);
    await this.assertNoInlineChallenge(active.action, client);
    return this.handoff.markVerified(interventionId);
  }

  resumeAfterHumanIntervention(interventionId: string): ResumeDecision<MapsAction> {
    return this.handoff.resumeAgent(interventionId);
  }

  cancelHumanIntervention(interventionId: string): void {
    this.handoff.cancel(interventionId);
  }

  async captureHumanTakeoverFrame(interventionId: string, epoch: number): Promise<{
    data: string;
    width: number;
    height: number;
    hostname: string;
  }> {
    const { client, url } = await this.getHumanTakeoverClient(interventionId, epoch);
    const viewport = await this.viewportSize(client);
    const screenshot = await client.Page.captureScreenshot({
      format: "jpeg",
      quality: 68,
      fromSurface: true,
      captureBeyondViewport: false
    });
    return {
      data: screenshot.data,
      width: viewport.width,
      height: viewport.height,
      hostname: new URL(url).hostname
    };
  }

  async tapHumanTakeover(interventionId: string, epoch: number, x: number, y: number): Promise<void> {
    const { client } = await this.getHumanTakeoverClient(interventionId, epoch);
    const viewport = await this.viewportSize(client);
    const safeX = Math.max(0, Math.min(viewport.width, x));
    const safeY = Math.max(0, Math.min(viewport.height, y));
    await client.Input.dispatchMouseEvent({
      type: "mousePressed",
      x: safeX,
      y: safeY,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await client.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x: safeX,
      y: safeY,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
  }

  async scrollHumanTakeover(interventionId: string, epoch: number, deltaY: number): Promise<void> {
    const { client } = await this.getHumanTakeoverClient(interventionId, epoch);
    const viewport = await this.viewportSize(client);
    await client.Input.dispatchMouseEvent({
      type: "mouseWheel",
      x: viewport.width / 2,
      y: viewport.height / 2,
      deltaX: 0,
      deltaY
    });
  }

  async insertHumanTakeoverText(interventionId: string, epoch: number, text: string): Promise<void> {
    const { client } = await this.getHumanTakeoverClient(interventionId, epoch);
    if (!text || text.length > 2_048) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Remote takeover text input is outside the allowed bounds");
    }
    await client.Input.insertText({ text });
  }

  async pressHumanTakeoverKey(interventionId: string, epoch: number, key: string): Promise<void> {
    if (!HUMAN_TAKEOVER_KEYS.has(key)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Remote takeover key is not allowed");
    }
    const { client } = await this.getHumanTakeoverClient(interventionId, epoch);
    await client.Input.dispatchKeyEvent({ type: "keyDown", key });
    await client.Input.dispatchKeyEvent({ type: "keyUp", key });
  }

  async getClient(): Promise<CdpClient> {
    this.assertAgentAuthority();
    return this.getClientUnchecked();
  }

  async navigate(url: string, action: MapsAction): Promise<{ url: string }> {
    this.policy.assertMapUrl(url);
    const client = await this.getClient();
    const loaded = client.Page.loadEventFired();
    await client.Page.navigate({ url });
    await Promise.race([loaded, sleep(8_000)]);

    const finalUrl = await this.currentUrl();
    this.assertAllowedCurrentUrl(finalUrl, action);
    await this.assertNoInlineChallenge(action);
    this.handoff.advanceResourceEpoch();
    this.lastAction = action;
    this.viewState = actionToView(action);
    return { url: finalUrl };
  }

  async currentUrl(): Promise<string> {
    const client = await this.getClient();
    return this.currentUrlUnchecked(client);
  }

  async assertMapsSurface(): Promise<string> {
    const url = await this.currentUrl();
    this.assertAllowedCurrentUrl(url);
    await this.assertNoInlineChallenge();
    return url;
  }

  async assertReadableView(kind: CandidateKind): Promise<MapsViewState> {
    const url = await this.assertMapsSurface();
    const pathKind = mapsPathKind(url);
    const pathCompatible = kind === "place"
      ? pathKind === "search" || pathKind === "place"
      : pathKind === "directions";
    const stateCompatible = kind === "place"
      ? this.viewState === "search" || this.viewState === "place"
      : this.viewState === "directions" || this.viewState === "route";

    if (!pathCompatible || !stateCompatible) {
      this.invalidateSemanticState();
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        kind === "place"
          ? "The browser no longer matches the active place/search state. Run maps_search again."
          : "The browser no longer matches the active directions state. Run maps_directions again."
      );
    }
    return this.viewState;
  }

  async assertDirectionsContext(): Promise<void> {
    const url = await this.assertMapsSurface();
    if (mapsPathKind(url) !== "directions" || this.lastAction?.kind !== "directions") {
      this.invalidateSemanticState();
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The browser no longer matches the active directions request. Run maps_directions again."
      );
    }
  }

  async listPlaceResults(): Promise<string[]> {
    const url = await this.assertMapsSurface();
    if (this.viewState !== "search" || mapsPathKind(url) !== "search") return [];
    return this.evaluateCandidates("place");
  }

  async listRouteResults(): Promise<string[]> {
    const url = await this.assertMapsSurface();
    if (
      (this.viewState !== "directions" && this.viewState !== "route") ||
      mapsPathKind(url) !== "directions"
    ) return [];
    return this.evaluateCandidates("route");
  }

  async clickPlaceResult(index: number, expectedLabel?: string): Promise<string> {
    const url = await this.assertMapsSurface();
    if (this.viewState !== "search" || mapsPathKind(url) !== "search") {
      this.invalidateSemanticState();
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The place result list is no longer active. Run maps_search again.");
    }
    const label = await this.clickCandidate("place", index, expectedLabel);
    const finalUrl = await this.waitForMapsPathKind("place", 3_000);
    if (!finalUrl) {
      const observedUrl = await this.assertMapsSurface();
      const observedKind = mapsPathKind(observedUrl);
      this.invalidateSemanticState();
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        `Google Maps did not enter a place view after the selection (observed ${observedKind}). Run maps_search again.`
      );
    }
    this.handoff.advanceResourceEpoch();
    this.viewState = "place";
    return label;
  }

  async clickRouteResult(index: number, expectedLabel?: string): Promise<string> {
    const url = await this.assertMapsSurface();
    if (
      (this.viewState !== "directions" && this.viewState !== "route") ||
      mapsPathKind(url) !== "directions"
    ) {
      this.invalidateSemanticState();
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The route result list is no longer active. Run maps_directions again.");
    }
    const label = await this.clickCandidate("route", index, expectedLabel);
    await sleep(350);
    const finalUrl = await this.assertMapsSurface();
    if (mapsPathKind(finalUrl) !== "directions") {
      this.invalidateSemanticState();
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "Google Maps left the directions view after the route selection. Run maps_directions again."
      );
    }
    this.handoff.advanceResourceEpoch();
    this.viewState = "route";
    return label;
  }

  async close(): Promise<void> {
    try {
      await this.resetClient();
    } finally {
      this.port = undefined;
      const active = this.handoff.getActive();
      if (active) {
        this.handoff.cancel(active.id);
        this.invalidateSemanticState(false);
      } else {
        this.invalidateSemanticState();
      }
      await this.chrome.close();
    }
  }

  private async evaluateCandidates(kind: CandidateKind): Promise<string[]> {
    const client = await this.getClient();
    const result = await client.Runtime.evaluate({
      expression: candidateExpression(kind),
      returnByValue: true,
      awaitPromise: true
    });
    const value = result.result.value as { ok?: boolean; labels?: unknown[] } | undefined;
    if (!value?.ok || !Array.isArray(value.labels)) return [];
    return value.labels.filter((label): label is string => typeof label === "string").slice(0, kind === "place" ? 20 : 12);
  }

  private async clickCandidate(kind: CandidateKind, index: number, expectedLabel?: string): Promise<string> {
    const client = await this.getClient();
    const result = await client.Runtime.evaluate({
      expression: candidateExpression(kind, index, expectedLabel),
      returnByValue: true,
      awaitPromise: true
    });
    const value = result.result.value as { ok?: boolean; reason?: string; label?: string } | undefined;
    if (!value?.ok) {
      if (value?.reason === "changed") {
        throw new BrowserRuntimeError(
          "UI_STATE_CHANGED",
          "The visible Google Maps candidate list changed after it was read. Read the current summary again before selecting."
        );
      }
      throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "Matching Google Maps UI element was not found");
    }
    return value.label ?? "selected";
  }

  private async waitForMapsPathKind(expected: MapsPathKind, timeoutMs: number): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const url = await this.currentUrl();
      this.assertAllowedCurrentUrl(url);
      if (mapsPathKind(url) === expected) {
        await this.assertNoInlineChallenge();
        return url;
      }
      await sleep(100);
    }
    return undefined;
  }

  private async assertNoInlineChallenge(
    intendedAction?: MapsAction,
    client?: CdpClient
  ): Promise<void> {
    const activeClient = client ?? await this.getClient();
    const result = await activeClient.Runtime.evaluate({
      expression: INLINE_CHALLENGE_EXPRESSION,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.result.value === true) {
      this.requireHumanIntervention(
        "access_challenge",
        "Google Maps displayed an access challenge inside the page. Automatic bypass is intentionally unsupported.",
        intendedAction
      );
    }
  }

  private async getHumanTakeoverClient(interventionId: string, epoch: number): Promise<{
    client: CdpClient;
    url: string;
  }> {
    const active = this.handoff.getActive();
    if (!active || active.id !== interventionId || active.epoch !== epoch || active.status !== "human_active") {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Remote takeover no longer matches the active human intervention");
    }
    const client = await this.getClientUnchecked();
    const url = await this.currentUrlUnchecked(client);
    this.assertHumanTakeoverSurface(url);
    return { client, url };
  }

  private async viewportSize(client: CdpClient): Promise<{ width: number; height: number }> {
    const result = await client.Runtime.evaluate({
      expression: "({width: Math.max(1, innerWidth), height: Math.max(1, innerHeight)})",
      returnByValue: true
    });
    const value = result.result.value as { width?: unknown; height?: unknown } | undefined;
    const width = Math.max(1, Math.min(10_000, Number(value?.width) || 1));
    const height = Math.max(1, Math.min(10_000, Number(value?.height) || 1));
    return { width, height };
  }

  private async getClientUnchecked(): Promise<CdpClient> {
    await this.ensureConnected();
    if (!this.client) throw new BrowserRuntimeError("BROWSER_UNAVAILABLE", "CDP client is unavailable");
    return this.client;
  }

  private async currentUrlUnchecked(client: CdpClient): Promise<string> {
    const result = await client.Runtime.evaluate({ expression: "location.href", returnByValue: true });
    return String(result.result.value ?? "");
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) {
      try {
        await this.client.Runtime.evaluate({ expression: "1", returnByValue: true });
        return;
      } catch {
        await this.resetClient();
        this.invalidateSemanticState();
      }
    }

    try {
      this.port = await this.chrome.start();
      const targets = await CDP.List({ port: this.port });
      const mapsTargets = targets.filter(
        (candidate) => candidate.type === "page" && this.policy.isAllowedMapsUrl(candidate.url)
      );
      if (mapsTargets.length > 1) {
        this.invalidateSemanticState();
        throw new BrowserRuntimeError(
          "BROWSER_UNAVAILABLE",
          "Multiple Google Maps tabs are open in the dedicated browser profile. Keep one Maps tab open, close the others, then retry."
        );
      }
      const target = mapsTargets[0] ?? await CDP.New({ port: this.port, url: "about:blank" });
      this.targetId = target.id;
      this.client = await CDP({ port: this.port, target: this.targetId });
      await Promise.all([
        this.client.Page.enable(),
        this.client.Runtime.enable(),
        this.client.DOM.enable()
      ]);
      if (!this.lastAction) this.viewState = "blank";
    } catch (error) {
      if (error instanceof PolicyError || error instanceof BrowserRuntimeError) throw error;
      console.error("[maps-browser-mcp] Chrome/CDP connection failed", error);
      throw new BrowserRuntimeError(
        "BROWSER_UNAVAILABLE",
        "Unable to connect to the dedicated Chrome/Chromium session. Check the local browser configuration."
      );
    }
  }

  private async resetClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.targetId = undefined;
    if (client) await client.close().catch(() => undefined);
  }

  private invalidateSemanticState(advanceEpoch = true): void {
    this.lastAction = undefined;
    this.viewState = "blank";
    if (advanceEpoch) this.handoff.advanceResourceEpoch();
  }

  private assertAgentAuthority(): void {
    const active = this.handoff.getActive();
    if (!active) return;
    throw new BrowserRuntimeError(
      "HUMAN_INTERVENTION_REQUIRED",
      "Browser control is suspended until the active human intervention is completed, verified, and resumed.",
      active
    );
  }

  private requireHumanIntervention(
    reason: MapsInterventionReason,
    message: string,
    intendedAction?: MapsAction
  ): never {
    const action = intendedAction ?? this.lastAction;
    const input: {
      reason: MapsInterventionReason;
      resumePolicy: ResumePolicy;
      action?: MapsAction;
    } = {
      reason,
      resumePolicy: resumePolicyForMapsAction(action)
    };
    if (action !== undefined) input.action = action;
    const intervention = this.handoff.begin(input);
    this.invalidateSemanticState(false);
    throw new BrowserRuntimeError("HUMAN_INTERVENTION_REQUIRED", message, intervention);
  }

  private assertHumanTakeoverSurface(value: string): void {
    if (this.policy.isAllowedMapsUrl(value) || classifyGoogleInterventionSurface(value)) return;
    let hostname = "";
    try {
      hostname = new URL(value).hostname.toLowerCase();
    } catch {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Remote takeover reached an invalid browser URL");
    }
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      `Remote takeover stopped because the browser left the allowed Google intervention surfaces (${hostname || "unknown"})`
    );
  }

  private assertAllowedCurrentUrl(value: string, intendedAction?: MapsAction): void {
    if (!value || value === "about:blank") {
      this.invalidateSemanticState();
      throw new BrowserRuntimeError("MAPS_NOT_OPEN", "Google Maps is not open in the dedicated browser tab");
    }
    const interventionSurface = classifyGoogleInterventionSurface(value);
    if (interventionSurface === "access_challenge") {
      this.requireHumanIntervention(
        "access_challenge",
        "Google presented an access challenge. Automatic bypass is intentionally unsupported.",
        intendedAction
      );
    }
    if (!this.policy.isAllowedMapsUrl(value)) {
      let hostname = "non-Maps page";
      try {
        hostname = new URL(value).hostname;
      } catch {
        // Keep generic text.
      }
      const reason: MapsInterventionReason = interventionSurface === "sign_in"
        ? "sign_in"
        : interventionSurface === "consent"
          ? "consent"
          : "external_surface";
      this.requireHumanIntervention(
        reason,
        `Browser left the Google Maps surface (${hostname}). Complete the required manual step without sharing credentials with the agent.`,
        intendedAction
      );
    }
  }

  private isChallengeUrl(value: string): boolean {
    return classifyGoogleInterventionSurface(value) === "access_challenge";
  }
}
