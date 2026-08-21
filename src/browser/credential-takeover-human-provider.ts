import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
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
    private readonly takeover: CredentialTakeoverBoundary
  ) {
    this.kind = kind;
  }

  async begin(request: ExternalHumanSurfaceRequest): Promise<{ sessionId: string; locator: string }> {
    if (this.active) throw new Error("Credential Takeover Human provider is already active");
    await this.browser.start();
    try {
      const targetProcessId = this.browser.getPid();
      if (!targetProcessId) throw new Error("Credential-safe normal Chrome process is unavailable");
      const locator = this.takeover.start({
        interventionId: request.interventionId,
        epoch: request.epoch,
        principalBinding: request.principalBinding,
        targetProcessId
      });
      const sessionId = randomUUID();
      this.active = { sessionId, interventionId: request.interventionId, epoch: request.epoch };
      return { sessionId, locator };
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
