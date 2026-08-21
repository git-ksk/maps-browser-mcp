import type { TakeoverBroker } from "mcp-execution-handoff/browser-takeover";
import type { CredentialTakeoverBoundary, CredentialTakeoverStartRequest } from "./credential-takeover-boundary.js";

/** Browser WebRTC Takeover adapter; signaling/media/input/reconnect stay in mcp-execution-handoff. */
export class WebRtcCredentialTakeoverBoundary implements CredentialTakeoverBoundary {
  constructor(
    private readonly broker: TakeoverBroker,
    platform: NodeJS.Platform = process.platform
  ) {
    if (platform !== "darwin" && platform !== "linux") {
      throw new Error("WebRTC credential takeover requires a macOS or Linux host runtime");
    }
  }

  start(request: CredentialTakeoverStartRequest): string {
    const locator = this.broker.createWebRtcLink(
      { id: request.interventionId, epoch: request.epoch },
      request.principalBinding,
      { processId: request.targetProcessId }
    );
    if (!locator) throw new Error("WebRTC credential takeover is unavailable");
    return locator;
  }

  async revoke(interventionId: string): Promise<void> {
    await this.broker.revokeWebRtcForIntervention(interventionId);
  }
}
