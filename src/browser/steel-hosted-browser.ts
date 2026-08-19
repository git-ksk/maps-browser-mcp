import Steel from "steel-sdk";
import type { ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
import type { BrowserAutomationEndpoint, BrowserSessionOwner } from "./browser-session-owner.js";

interface ActiveSteelSession {
  id: string;
  websocketUrl: string;
  operatorLocator: string;
  expiresAt: number;
}

export interface SteelHostedBrowserOptions {
  apiKey?: string;
  baseUrl?: string;
  profileId?: string;
  timeoutMs: number;
}

function safeOperatorLocator(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("Steel Human Live View must use HTTPS except for loopback development");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Steel Human Live View locator must not contain credentials, query, or fragment");
  }
  return url.toString();
}


function sessionExpiry(createdAt: string, timeoutMs: number): number {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? created + timeoutMs : Date.now() + timeoutMs;
}

function authenticatedWebsocketUrl(value: string, apiKey?: string): string {
  const url = new URL(value);
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("Steel CDP endpoint must use WSS except for loopback development");
  }
  if (apiKey && !url.searchParams.has("apiKey")) url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

export class SteelHostedBrowserSession implements BrowserSessionOwner {
  readonly kind = "steel-hosted-session";
  private readonly client: Steel;
  private active?: ActiveSteelSession;

  constructor(private readonly options: SteelHostedBrowserOptions) {
    this.client = new Steel({
      ...(options.apiKey ? { steelAPIKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      timeout: 30_000,
      maxRetries: 1
    });
  }

  async start(): Promise<BrowserAutomationEndpoint> {
    if (!this.active) {
      const session = await this.client.sessions.create({
        timeout: this.options.timeoutMs,
        solveCaptcha: false,
        ...(this.options.profileId ? { profileId: this.options.profileId, persistProfile: true } : {})
      });
      if (session.status !== "live") {
        await this.client.sessions.release(session.id).catch(() => undefined);
        throw new Error("Steel browser session did not enter the live state");
      }
      try {
        this.active = {
          id: session.id,
          websocketUrl: authenticatedWebsocketUrl(session.websocketUrl, this.options.apiKey),
          operatorLocator: safeOperatorLocator(session.sessionViewerUrl),
          expiresAt: sessionExpiry(session.createdAt, session.timeout)
        };
      } catch (error) {
        await this.client.sessions.release(session.id).catch(() => undefined);
        throw error;
      }
    }
    return { kind: "browser_websocket", websocketUrl: this.active.websocketUrl };
  }

  async suspendForHuman(): Promise<void> {
    if (!this.active) throw new Error("Steel browser session is not active for Human handoff");
    // Keep the hosted browser alive. MapsBrowserRuntime has already detached its CDP client and
    // Human authority prevents a new automation attachment until the handoff is completed.
  }

  humanSurface(): { sessionId: string; locator: string; expiresAt: number } {
    const active = this.active;
    if (!active) throw new Error("Steel browser session is not active for Human handoff");
    return { sessionId: active.id, locator: active.operatorLocator, expiresAt: active.expiresAt };
  }

  async close(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    if (active) await this.client.sessions.release(active.id);
  }
}

export class SteelLiveViewHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind = "steel-live-view";
  private active?: { providerSessionId: string; interventionId: string; epoch: number };

  constructor(private readonly browser: SteelHostedBrowserSession) {}

  async begin(request: ExternalHumanSurfaceRequest): Promise<{ sessionId: string; locator: string; expiresAt?: number }> {
    if (this.active) throw new Error("Steel Human Live View provider is already active");
    await this.browser.start();
    const surface = this.browser.humanSurface();
    const providerSessionId = `steel:${surface.sessionId}`;
    this.active = { providerSessionId, interventionId: request.interventionId, epoch: request.epoch };
    return { sessionId: providerSessionId, locator: surface.locator, expiresAt: surface.expiresAt };
  }

  async revoke(sessionId: string): Promise<void> {
    const active = this.active;
    if (!active || active.providerSessionId !== sessionId) {
      throw new Error("Steel Human Live View provider session no longer matches");
    }
    // Revoke only Human authority. The shared browser session remains alive so automation can
    // reconnect fresh to the exact state the Human just changed.
    this.active = undefined;
  }
}
