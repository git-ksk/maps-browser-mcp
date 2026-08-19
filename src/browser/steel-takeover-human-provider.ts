import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import { SteelHostedBrowserSession } from "./steel-hosted-browser.js";

interface ActiveProviderSession {
  sessionId: string;
  interventionId: string;
  epoch: number;
}

export class SteelTakeoverHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind = "steel-takeover";
  private active?: ActiveProviderSession;

  constructor(
    private readonly browser: SteelHostedBrowserSession,
    private readonly broker: TakeoverBroker
  ) {}

  async begin(request: ExternalHumanSurfaceRequest): Promise<{ sessionId: string; locator: string; expiresAt?: number }> {
    if (this.active) throw new Error("Steel takeover Human provider is already active");
    await this.browser.start();
    const browserSession = this.browser.sessionInfo();
    try {
      const locator = this.broker.createLink(
        { id: request.interventionId, epoch: request.epoch },
        request.principalBinding
      );
      if (!locator) throw new Error("Steel takeover Human surface is unavailable");
      const sessionId = randomUUID();
      this.active = { sessionId, interventionId: request.interventionId, epoch: request.epoch };
      return { sessionId, locator, expiresAt: browserSession.expiresAt };
    } catch (error) {
      this.broker.revokeForIntervention(request.interventionId);
      throw error;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) {
      throw new Error("Steel takeover Human provider session no longer matches");
    }
    this.active = undefined;
    this.broker.revokeForIntervention(active.interventionId);
    // Keep the exact hosted browser session alive. Automation reconnects fresh after Human authority is revoked.
  }
}
