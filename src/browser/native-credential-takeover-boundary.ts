import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import type { CredentialTakeoverBoundary, CredentialTakeoverStartRequest } from "./credential-takeover-boundary.js";

/** Native Thin Takeover adapter; media/input/runtime details stay in mcp-execution-handoff. */
export class NativeCredentialTakeoverBoundary implements CredentialTakeoverBoundary {
  constructor(
    private readonly broker: TakeoverBroker,
    platform: NodeJS.Platform = process.platform
  ) {
    if (platform !== "darwin") {
      throw new Error("Native credential takeover currently requires a macOS host runtime");
    }
  }

  start(request: CredentialTakeoverStartRequest): string {
    const locator = this.broker.createNativeLink(
      { id: request.interventionId, epoch: request.epoch },
      request.principalBinding,
      { processId: request.targetProcessId }
    );
    if (!locator) throw new Error("Native credential takeover is unavailable");
    return locator;
  }

  async revoke(interventionId: string): Promise<void> {
    await this.broker.revokeNativeForIntervention(interventionId);
  }
}
