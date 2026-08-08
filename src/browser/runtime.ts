import CDP from "chrome-remote-interface";
import type { MapsAction, MapsViewState } from "../types.js";
import { PolicyEngine, PolicyError } from "../policy/policy-engine.js";
import { ChromeProcess } from "./chrome-process.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CdpClient = Awaited<ReturnType<typeof CDP>>;
type CandidateKind = "place" | "route";

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
      const feed = Array.from(document.querySelectorAll('[role="feed"] a[href*="/maps/place/"]'));
      const fallback = Array.from(document.querySelectorAll('[role="main"] a[href*="/maps/place/"]'));
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

export class BrowserRuntimeError extends Error {
  constructor(
    public readonly code:
      | "BROWSER_UNAVAILABLE"
      | "MAPS_NOT_OPEN"
      | "HUMAN_INTERVENTION_REQUIRED"
      | "UI_ELEMENT_NOT_FOUND"
      | "UI_STATE_CHANGED",
    message: string
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

  async getClient(): Promise<CdpClient> {
    await this.ensureConnected();
    if (!this.client) throw new BrowserRuntimeError("BROWSER_UNAVAILABLE", "CDP client is unavailable");
    return this.client;
  }

  async navigate(url: string, action: MapsAction): Promise<{ url: string }> {
    this.policy.assertMapUrl(url);
    const client = await this.getClient();
    const loaded = client.Page.loadEventFired();
    await client.Page.navigate({ url });
    await Promise.race([loaded, sleep(8_000)]);

    const finalUrl = await this.currentUrl();
    this.assertAllowedCurrentUrl(finalUrl);
    this.lastAction = action;
    this.viewState = actionToView(action);
    return { url: finalUrl };
  }

  async currentUrl(): Promise<string> {
    const client = await this.getClient();
    const result = await client.Runtime.evaluate({ expression: "location.href", returnByValue: true });
    return String(result.result.value ?? "");
  }

  async assertMapsSurface(): Promise<string> {
    const url = await this.currentUrl();
    this.assertAllowedCurrentUrl(url);
    return url;
  }

  async assertReadableView(kind: CandidateKind): Promise<MapsViewState> {
    await this.assertMapsSurface();
    const allowed = kind === "place"
      ? new Set<MapsViewState>(["search", "place"])
      : new Set<MapsViewState>(["directions", "route"]);
    if (!allowed.has(this.viewState)) {
      throw new BrowserRuntimeError(
        "MAPS_NOT_OPEN",
        kind === "place"
          ? "No Google Maps place/search view is active. Call maps_search first."
          : "No Google Maps directions view is active. Call maps_directions first."
      );
    }
    return this.viewState;
  }

  async listPlaceResults(): Promise<string[]> {
    await this.assertMapsSurface();
    if (this.viewState !== "search") return [];
    return this.evaluateCandidates("place");
  }

  async listRouteResults(): Promise<string[]> {
    await this.assertMapsSurface();
    if (this.viewState !== "directions" && this.viewState !== "route") return [];
    return this.evaluateCandidates("route");
  }

  async clickPlaceResult(index: number, expectedLabel?: string): Promise<string> {
    await this.assertMapsSurface();
    if (this.viewState !== "search") {
      throw new BrowserRuntimeError("MAPS_NOT_OPEN", "No place result list is active. Call maps_search first.");
    }
    const label = await this.clickCandidate("place", index, expectedLabel);
    await sleep(450);
    await this.assertMapsSurface();
    this.viewState = "place";
    return label;
  }

  async clickRouteResult(index: number, expectedLabel?: string): Promise<string> {
    await this.assertMapsSurface();
    if (this.viewState !== "directions" && this.viewState !== "route") {
      throw new BrowserRuntimeError("MAPS_NOT_OPEN", "No route result list is active. Call maps_directions first.");
    }
    const label = await this.clickCandidate("route", index, expectedLabel);
    await sleep(350);
    await this.assertMapsSurface();
    this.viewState = "route";
    return label;
  }

  async close(): Promise<void> {
    try {
      await this.resetClient();
    } finally {
      this.port = undefined;
      this.invalidateSemanticState();
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
      let target = targets.find(
        (candidate) => candidate.type === "page" && this.policy.isAllowedMapsUrl(candidate.url)
      );
      if (!target) target = await CDP.New({ port: this.port, url: "about:blank" });
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

  private invalidateSemanticState(): void {
    this.lastAction = undefined;
    this.viewState = "blank";
  }

  private assertAllowedCurrentUrl(value: string): void {
    if (!value || value === "about:blank") {
      throw new BrowserRuntimeError("MAPS_NOT_OPEN", "Google Maps is not open in the dedicated browser tab");
    }
    if (this.isChallengeUrl(value)) {
      throw new BrowserRuntimeError(
        "HUMAN_INTERVENTION_REQUIRED",
        "Google presented an access challenge. Automatic bypass is intentionally unsupported."
      );
    }
    if (!this.policy.isAllowedMapsUrl(value)) {
      let hostname = "non-Maps page";
      try {
        hostname = new URL(value).hostname;
      } catch {
        // Keep generic text.
      }
      throw new BrowserRuntimeError(
        "HUMAN_INTERVENTION_REQUIRED",
        `Browser left the Google Maps surface (${hostname}). Complete any consent or sign-in step manually.`
      );
    }
  }

  private isChallengeUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.pathname.startsWith("/sorry/") || url.hostname.includes("recaptcha");
    } catch {
      return false;
    }
  }
}
