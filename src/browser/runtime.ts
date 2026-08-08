import CDP from "chrome-remote-interface";
import type { MapsAction } from "../types.js";
import { PolicyEngine, PolicyError } from "../policy/policy-engine.js";
import { ChromeProcess } from "./chrome-process.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CdpClient = Awaited<ReturnType<typeof CDP>>;

export class BrowserRuntimeError extends Error {
  constructor(
    public readonly code:
      | "BROWSER_UNAVAILABLE"
      | "MAPS_NOT_OPEN"
      | "HUMAN_INTERVENTION_REQUIRED"
      | "UI_ELEMENT_NOT_FOUND",
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

  constructor(
    private readonly chrome: ChromeProcess,
    private readonly policy: PolicyEngine
  ) {}

  getLastAction(): MapsAction | undefined {
    return this.lastAction;
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
    if (this.isChallengeUrl(finalUrl)) {
      throw new BrowserRuntimeError(
        "HUMAN_INTERVENTION_REQUIRED",
        "Google presented an access challenge. Automatic bypass is intentionally unsupported."
      );
    }
    if (!this.policy.isAllowedMapsUrl(finalUrl)) {
      throw new BrowserRuntimeError(
        "HUMAN_INTERVENTION_REQUIRED",
        `Browser left the Google Maps surface (${new URL(finalUrl).hostname}). Complete any consent or sign-in step manually.`
      );
    }

    this.lastAction = action;
    return { url: finalUrl };
  }

  async currentUrl(): Promise<string> {
    const client = await this.getClient();
    const result = await client.Runtime.evaluate({
      expression: "location.href",
      returnByValue: true
    });
    return String(result.result.value ?? "");
  }

  async clickPlaceResult(index: number): Promise<string> {
    return this.clickWithScript(`(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const seen = new Set();
      const items = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
        .filter(visible)
        .filter((el) => {
          const href = el.href;
          if (!href || seen.has(href)) return false;
          seen.add(href);
          return true;
        })
        .slice(0, 20);
      const target = items[${index}];
      if (!target) return { ok: false };
      const label = target.getAttribute('aria-label') || target.textContent || 'place result';
      target.click();
      return { ok: true, label: label.trim().slice(0, 240) };
    })()`);
  }

  async clickRouteResult(index: number): Promise<string> {
    return this.clickWithScript(`(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const timeLike = /(\\d+\\s*(min|mins|hr|hrs|分|時間)|depart|arrive|発|着|乗換|徒歩|train|bus|transit)/i;
      const raw = Array.from(document.querySelectorAll('[data-trip-index], [role="main"] [role="button"]'))
        .filter(visible)
        .map((el) => ({ el, label: (el.getAttribute('aria-label') || el.textContent || '').trim() }))
        .filter((x) => x.label && timeLike.test(x.label));
      const unique = [];
      const seen = new Set();
      for (const item of raw) {
        const key = item.label.slice(0, 300);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
        if (unique.length >= 12) break;
      }
      const target = unique[${index}];
      if (!target) return { ok: false };
      target.el.click();
      return { ok: true, label: target.label.slice(0, 240) };
    })()`);
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } finally {
      this.client = undefined;
      this.targetId = undefined;
      await this.chrome.close();
    }
  }

  private async clickWithScript(expression: string): Promise<string> {
    const client = await this.getClient();
    const result = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
    const value = result.result.value as { ok?: boolean; label?: string } | undefined;
    if (!value?.ok) {
      throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "Matching Google Maps UI element was not found");
    }
    return value.label ?? "selected";
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return;
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
    } catch (error) {
      if (error instanceof PolicyError || error instanceof BrowserRuntimeError) throw error;
      throw new BrowserRuntimeError(
        "BROWSER_UNAVAILABLE",
        error instanceof Error ? error.message : "Unable to connect to Chrome"
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
