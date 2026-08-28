export interface CredentialTakeoverStartRequest {
  interventionId: string;
  epoch: number;
  principalBinding: string;
  targetProcessId: number;
  targetWindowId?: number;
}

/**
 * Thin Maps-facing boundary for a Handoff-owned credential takeover transport.
 * Transport signaling, media, input, reconnect, and cryptographic details remain in Handoff.
 */
export interface CredentialTakeoverBoundary {
  start(request: CredentialTakeoverStartRequest): string;
  revoke(interventionId: string): Promise<void>;
}
