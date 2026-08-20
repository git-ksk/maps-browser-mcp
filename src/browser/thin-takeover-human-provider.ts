import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
import { NativeCredentialTakeoverBoundary } from "./native-credential-takeover-boundary.js";

interface ActiveProviderSession {
  sessionId: string;
  interventionId: string;
  epoch: number;
}

/**
 * Keyless Human surface for a browser session already owned by the consumer.
 * Browser/session lifecycle stays in MapsBrowserRuntime; this provider owns only
 * the thin Native credential takeover locator and its revocation lifecycle.
 */
export class ThinTakeoverHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind = "thin-takeover";
  private active?: ActiveProviderSession;

  constructor(private readonly takeover: NativeCredentialTakeoverBoundary) {}

  async begin(request: ExternalHumanSurfaceRequest): Promise<{ sessionId: string; locator: string }> {
    if (this.active) throw new Error("Thin Takeover Human provider is already active");
    try {
      const locator = this.takeover.start({
        interventionId: request.interventionId,
        epoch: request.epoch,
        principalBinding: request.principalBinding
      });
      const sessionId = randomUUID();
      this.active = { sessionId, interventionId: request.interventionId, epoch: request.epoch };
      return { sessionId, locator };
    } catch (error) {
      await this.takeover.revoke(request.interventionId).catch(() => undefined);
      throw error;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) {
      throw new Error("Thin Takeover Human provider session no longer matches");
    }
    this.active = undefined;
    await this.takeover.revoke(active.interventionId);
  }
}
