import type { BrowserHandoffAdapter } from "mcp-execution-handoff/browser-takeover";
import type { CredentialTakeoverBoundary, CredentialTakeoverStartRequest } from "./credential-takeover-boundary.js";

const CREDENTIAL_SAFE_INPUT_POLICY = Object.freeze({
  tap: true,
  scroll: true,
  text: true,
  key: true
} as const);

/**
 * Maps-facing boundary over Handoff's first-class BrowserHandoffAdapter.
 *
 * Maps owns the normal-browser/profile/authentication lifecycle and fresh verification. Handoff
 * owns direct/WSS/optional TURN selection, reconnect/generation fencing, exact target binding,
 * and server-enforced Human input policy.
 */
export class WebRtcCredentialTakeoverBoundary implements CredentialTakeoverBoundary {
  constructor(
    private readonly handoff: BrowserHandoffAdapter,
    platform: NodeJS.Platform = process.platform
  ) {
    if (platform !== "darwin" && platform !== "linux") {
      throw new Error("WebRTC credential takeover requires a macOS or Linux host runtime");
    }
  }

  start(request: CredentialTakeoverStartRequest): string {
    return this.handoff.start({
      intervention: { id: request.interventionId, epoch: request.epoch },
      principalBinding: request.principalBinding,
      target: {
        processId: request.targetProcessId,
        ...(request.targetWindowId === undefined ? {} : { windowId: request.targetWindowId })
      },
      // Credential-safe Maps interventions include sign-in/MFA/passkey-adjacent ceremonies where
      // the Human may need pointer, scroll, text, Backspace, and Enter. This is explicit rather
      // than inheriting a transport default; Handoff binds and enforces it for the session.
      inputPolicy: CREDENTIAL_SAFE_INPUT_POLICY
    });
  }

  async revoke(interventionId: string): Promise<void> {
    await this.handoff.revoke(interventionId);
  }
}
