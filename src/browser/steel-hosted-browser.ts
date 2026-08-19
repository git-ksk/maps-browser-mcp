import type { BrowserAutomationEndpoint, BrowserSessionOwner } from "./browser-session-owner.js";

interface ActiveSteelSession {
  id: string;
  websocketUrl: string;
  expiresAt: number;
}

interface SteelSessionResponse {
  id: string;
  createdAt: string;
  timeout: number;
  status: "live" | "released" | "failed";
  websocketUrl: string;
}

export interface SteelHostedBrowserOptions {
  apiKey?: string;
  baseUrl?: string;
  profileId?: string;
  timeoutMs: number;
}

type FetchLike = typeof fetch;

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

function steelApiBaseUrl(value?: string): URL {
  const url = new URL(value ?? "https://api.steel.dev");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("Steel API must use HTTPS except for loopback development");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Steel session response is missing ${name}`);
  return value;
}

function parseSteelSession(value: unknown): SteelSessionResponse {
  if (!value || typeof value !== "object") throw new Error("Steel session response is invalid");
  const session = value as Record<string, unknown>;
  const timeout = session.timeout;
  const status = session.status;
  if (!Number.isSafeInteger(timeout) || (timeout as number) <= 0) {
    throw new Error("Steel session response has an invalid timeout");
  }
  if (status !== "live" && status !== "released" && status !== "failed") {
    throw new Error("Steel session response has an invalid status");
  }
  return {
    id: requiredString(session.id, "id"),
    createdAt: requiredString(session.createdAt, "createdAt"),
    timeout: timeout as number,
    status,
    websocketUrl: requiredString(session.websocketUrl, "websocketUrl"),
  };
}

class SteelSessionClient {
  private readonly baseUrl: URL;

  constructor(
    private readonly apiKey: string | undefined,
    baseUrl: string | undefined,
    private readonly fetchImpl: FetchLike
  ) {
    this.baseUrl = steelApiBaseUrl(baseUrl);
  }

  async create(input: {
    timeout: number;
    solveCaptcha: false;
    profileId?: string;
    persistProfile?: true;
  }): Promise<SteelSessionResponse> {
    const response = await this.request("/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return parseSteelSession(await response.json());
  }

  async release(id: string): Promise<void> {
    await this.request(`/v1/sessions/${encodeURIComponent(id)}/release`, { method: "POST" });
  }

  private async request(pathname: string, init: RequestInit): Promise<Response> {
    const url = new URL(this.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${pathname}`;
    const headers = new Headers(init.headers);
    if (this.apiKey) headers.set("steel-api-key", this.apiKey);
    const response = await this.fetchImpl(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      throw new Error(`Steel API request failed with HTTP ${response.status}`);
    }
    return response;
  }
}

export class SteelHostedBrowserSession implements BrowserSessionOwner {
  readonly kind = "steel-hosted-session";
  private readonly client: SteelSessionClient;
  private active?: ActiveSteelSession;

  constructor(
    private readonly options: SteelHostedBrowserOptions,
    fetchImpl: FetchLike = fetch
  ) {
    this.client = new SteelSessionClient(options.apiKey, options.baseUrl, fetchImpl);
  }

  async start(): Promise<BrowserAutomationEndpoint> {
    if (!this.active) {
      const session = await this.client.create({
        timeout: this.options.timeoutMs,
        solveCaptcha: false,
        ...(this.options.profileId ? { profileId: this.options.profileId, persistProfile: true as const } : {})
      });
      if (session.status !== "live") {
        await this.client.release(session.id).catch(() => undefined);
        throw new Error("Steel browser session did not enter the live state");
      }
      try {
        this.active = {
          id: session.id,
          websocketUrl: authenticatedWebsocketUrl(session.websocketUrl, this.options.apiKey),
          expiresAt: sessionExpiry(session.createdAt, session.timeout)
        };
      } catch (error) {
        await this.client.release(session.id).catch(() => undefined);
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

  sessionInfo(): { sessionId: string; expiresAt: number } {
    const active = this.active;
    if (!active) throw new Error("Steel browser session is not active for Human handoff");
    return { sessionId: active.id, expiresAt: active.expiresAt };
  }

  async close(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    if (active) await this.client.release(active.id);
  }
}
