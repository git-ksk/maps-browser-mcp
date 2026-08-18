import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceProvider, ExternalHumanSurfaceRequest } from "mcp-execution-handoff/core";
import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import { CuaHumanTakeoverAdapter } from "./cua-human-takeover-adapter.js";
import { SystemBrowserCredentialSession } from "./system-browser-credential-session.js";

interface ActiveProviderSession {
  sessionId: string;
  interventionId: string;
  epoch: number;
}

export class CuaTakeoverHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind = "system-browser-cua-takeover";
  private active?: ActiveProviderSession;

  constructor(
    private readonly browser: SystemBrowserCredentialSession,
    private readonly adapter: CuaHumanTakeoverAdapter,
    private readonly broker: TakeoverBroker
  ) {}

  async begin(request: ExternalHumanSurfaceRequest): Promise<{ sessionId: string; locator: string }> {
    if (this.active) throw new Error("Credential-safe Cua Human provider is already active");
    await this.browser.start();
    const pid = this.browser.getPid();
    if (!pid) {
      await this.browser.close().catch(() => undefined);
      throw new Error("Credential-safe normal Chrome PID is unavailable");
    }
    try {
      await this.adapter.begin(request.interventionId, request.epoch, pid);
      const locator = this.broker.createLink(
        { id: request.interventionId, epoch: request.epoch },
        request.principalBinding
      );
      if (!locator) throw new Error("Credential-safe Cua takeover link is unavailable");
      const sessionId = randomUUID();
      this.active = { sessionId, interventionId: request.interventionId, epoch: request.epoch };
      return { sessionId, locator };
    } catch (error) {
      this.broker.revokeForIntervention(request.interventionId);
      await this.adapter.close().catch(() => undefined);
      await this.browser.close().catch(() => undefined);
      throw error;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) {
      throw new Error("Credential-safe Cua Human provider session no longer matches");
    }
    this.active = undefined;
    this.broker.revokeForIntervention(active.interventionId);
    await this.adapter.end(active.interventionId, active.epoch).catch(() => undefined);
    await this.browser.close();
  }
}
