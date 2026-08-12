import {
  digestToolInvocation,
  type HandoffResumeStrategy
} from "./handoff-mrtr.js";

export interface HandoffOwner {
  principalBinding: string;
  toolName: string;
  argsDigest: string;
  resumeStrategy: HandoffResumeStrategy;
}

export function createHandoffOwner(
  principalBinding: string,
  toolName: string,
  args: unknown,
  resumeStrategy: HandoffResumeStrategy
): HandoffOwner {
  return {
    principalBinding,
    toolName,
    argsDigest: digestToolInvocation(toolName, args),
    resumeStrategy
  };
}

export function handoffOwnerMatches(left: HandoffOwner, right: HandoffOwner): boolean {
  return left.principalBinding === right.principalBinding &&
    left.toolName === right.toolName &&
    left.argsDigest === right.argsDigest &&
    left.resumeStrategy === right.resumeStrategy;
}

export function claimHandoffOwner(
  owners: Map<string, HandoffOwner>,
  interventionId: string,
  interventionStatus: string,
  candidate: HandoffOwner
): HandoffOwner | undefined {
  const existing = owners.get(interventionId);
  if (existing) return handoffOwnerMatches(existing, candidate) ? existing : undefined;

  // Only the request that first observes a freshly-created intervention may bind it.
  // Once Human control has been claimed or verification has begun, a missing owner is
  // treated as an invariant failure rather than allowing the intervention to be rebound.
  if (interventionStatus !== "awaiting_human") return undefined;
  owners.set(interventionId, candidate);
  return candidate;
}
