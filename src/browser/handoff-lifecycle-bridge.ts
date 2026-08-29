import type { TakeoverAuthorityReleaseEvent } from "mcp-execution-handoff/browser-takeover";
import { BrowserRuntimeError, type MapsBrowserRuntime, type MapsIntervention } from "./runtime.js";

interface AuthorityReleaseReceipt {
  interventionId: string;
  releasedEpoch: number;
  verifyingEpoch: number;
}

/**
 * Maps-side bridge for the content-free Handoff authority-release fact.
 *
 * The bridge only removes Human authority and records the exact epoch edge needed to let the
 * existing completion request enter fresh verification. It never verifies authentication, marks
 * semantic success, restores Agent authority, or replays a stale action.
 */
export class MapsHandoffLifecycleBridge {
  private receipt?: AuthorityReleaseReceipt;

  constructor(private readonly runtime: MapsBrowserRuntime) {}

  onAuthorityReleased(event: TakeoverAuthorityReleaseEvent): MapsIntervention | undefined {
    const active = this.runtime.getActiveIntervention();
    if (
      !active ||
      active.id !== event.interventionId ||
      active.epoch !== event.epoch ||
      active.status !== "human_active" ||
      active.authority !== "human"
    ) {
      return undefined;
    }

    const verifying = this.runtime.releaseHumanAuthorityForVerification(active.id, active.epoch);
    this.receipt = {
      interventionId: active.id,
      releasedEpoch: active.epoch,
      verifyingEpoch: verifying.epoch
    };
    return verifying;
  }

  matchesReleasedContinuation(interventionId: string, releasedEpoch: number): boolean {
    const active = this.runtime.getActiveIntervention();
    const receipt = this.receipt;
    return Boolean(
      active &&
      receipt &&
      active.id === interventionId &&
      active.status === "verifying" &&
      active.authority === "none" &&
      receipt.interventionId === interventionId &&
      receipt.releasedEpoch === releasedEpoch &&
      receipt.verifyingEpoch === active.epoch
    );
  }

  ensureVerifying(interventionId: string, humanEpoch: number): MapsIntervention {
    const active = this.runtime.getActiveIntervention();
    if (!active || active.id !== interventionId) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The Human intervention is no longer active. Restart from fresh Maps state."
      );
    }

    if (active.status === "human_active" && active.authority === "human") {
      if (active.epoch !== humanEpoch) {
        throw new BrowserRuntimeError(
          "UI_STATE_CHANGED",
          "The Human intervention epoch changed before completion. Restart from fresh Maps state."
        );
      }
      return this.runtime.releaseHumanAuthorityForVerification(interventionId, humanEpoch);
    }

    if (this.matchesReleasedContinuation(interventionId, humanEpoch)) return active;

    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Human authority was not released by the matching Handoff generation. Restart from fresh Maps state."
    );
  }

  clear(interventionId: string): void {
    if (this.receipt?.interventionId === interventionId) this.receipt = undefined;
  }
}
