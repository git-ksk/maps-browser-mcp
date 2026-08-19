import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";

interface ActiveProviderSession {
  sessionId: string;
  interventionId: string;
  epoch: number;
}

/**
 * Keyless Human surface for a browser session already owned by the consumer.
 * Browser/session lifecycle stays in MapsBrowserRuntime; this provider owns only
 * the authenticated Handoff broker locator and its revocation lifecycle.
 */
export class ThinTakeoverHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind = "thin-takeover";
  private active?: ActiveProviderSession;

  constructor(private readonly broker: TakeoverBroker) {}

  async begin(request: ExternalHumanSurfaceRequest): Promise<{ sessionId: string; locator: string }> {
    if (this.active) throw new Error("Thin Takeover Human provider is already active");
    try {
      const locator = this.broker.createLink(
        { id: request.interventionId, epoch: request.epoch },
        request.principalBinding
      );
      if (!locator) throw new Error("Thin Takeover Human surface is unavailable");
      const sessionId = randomUUID();
      this.active = { sessionId, interventionId: request.interventionId, epoch: request.epoch };
      return { sessionId, locator };
    } catch (error) {
      this.broker.revokeForIntervention(request.interventionId);
      throw error;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) {
      throw new Error("Thin Takeover Human provider session no longer matches");
    }
    this.active = undefined;
    this.broker.revokeForIntervention(active.interventionId);
  }
}
