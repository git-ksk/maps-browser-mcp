import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceGrant, ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
import type { CredentialTakeoverBoundary } from "./credential-takeover-boundary.js";
import { SystemBrowserCredentialSession } from "./system-browser-credential-session.js";

export type CredentialTakeoverProviderKind = "thin-takeover" | "webrtc-takeover";

interface ActiveProviderSession {
  sessionId: string;
  interventionId: string;
  epoch: number;
}

/**
 * Credential-safe Human surface composed by Maps.
 *
 * Maps owns only the same-profile normal-Chrome lifecycle. Handoff owns the selected Human
 * transport and returns one short-lived locator. The automation Chrome process is stopped before
 * begin(); revoke tears down Human transport before Maps closes normal Chrome and fresh-attaches.
 */
export class CredentialTakeoverHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind: CredentialTakeoverProviderKind;
  private active?: ActiveProviderSession;

  constructor(
    kind: CredentialTakeoverProviderKind,
    private readonly browser: SystemBrowserCredentialSession,
    private readonly takeover: CredentialTakeoverBoundary,
    private readonly takeoverTtlMs: number,
    private readonly now: () => number = Date.now
  ) {
    this.kind = kind;
    if (!Number.isSafeInteger(takeoverTtlMs) || takeoverTtlMs < 1_000) {
      throw new Error("Credential Takeover Human provider requires a bounded positive takeover TTL");
    }
  }

  async begin(request: ExternalHumanSurfaceRequest): Promise<ExternalHumanSurfaceGrant> {
    if (this.active) throw new Error("Credential Takeover Human provider is already active");
    await this.browser.start();
    try {
      const target = await this.browser.getTakeoverTarget();
      // Compute the consumer-visible expiry immediately before Handoff issues its own locator.
      // This is intentionally conservative: Maps' cached Human surface may expire slightly before,
      // but never after, the provider-owned takeover authority created by the same configured TTL.
      const expiresAt = this.now() + this.takeoverTtlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new Error("Credential Takeover Human provider expiry is outside the safe integer range");
      }
      const locator = this.takeover.start({
        interventionId: request.interventionId,
        epoch: request.epoch,
        principalBinding: request.principalBinding,
        targetProcessId: target.processId,
        ...(target.windowId === undefined ? {} : { targetWindowId: target.windowId })
      });
      const sessionId = randomUUID();
      this.active = { sessionId, interventionId: request.interventionId, epoch: request.epoch };
      return { sessionId, locator, expiresAt };
    } catch (error) {
      await this.takeover.revoke(request.interventionId).catch(() => undefined);
      await this.browser.close().catch(() => undefined);
      throw error;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) {
      throw new Error("Credential Takeover Human provider session no longer matches");
    }
    this.active = undefined;
    try {
      await this.takeover.revoke(active.interventionId);
    } finally {
      await this.browser.close();
    }
  }
}
