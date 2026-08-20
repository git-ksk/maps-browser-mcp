import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";

export interface NativeCredentialTakeoverStartRequest {
  interventionId: string;
  epoch: number;
  principalBinding: string;
}

/**
 * Maps-facing boundary for Native credential takeover.
 *
 * Native media/input/runtime details stay inside mcp-execution-handoff. Maps owns only the
 * intervention lifecycle: create one short-lived Native-only locator and revoke the matching runtime.
 */
export class NativeCredentialTakeoverBoundary {
  constructor(
    private readonly broker: TakeoverBroker,
    platform: NodeJS.Platform = process.platform
  ) {
    if (platform !== "darwin") {
      throw new Error("Native credential takeover currently requires a macOS host runtime");
    }
  }

  start(request: NativeCredentialTakeoverStartRequest): string {
    const locator = this.broker.createNativeLink(
      { id: request.interventionId, epoch: request.epoch },
      request.principalBinding
    );
    if (!locator) throw new Error("Native credential takeover is unavailable");
    return locator;
  }

  async revoke(interventionId: string): Promise<void> {
    await this.broker.revokeNativeForIntervention(interventionId);
  }
}
