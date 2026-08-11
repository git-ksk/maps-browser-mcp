import {
  digestToolInvocation,
  type HandoffResumeStrategy
} from "./handoff-mrtr.js";

export interface HandoffOwner {
  toolName: string;
  argsDigest: string;
  resumeStrategy: HandoffResumeStrategy;
  principalBinding: string;
}

export function createHandoffOwner(input: {
  toolName: string;
  args: unknown;
  resumeStrategy: HandoffResumeStrategy;
  principalBinding: string;
}): HandoffOwner {
  return {
    toolName: input.toolName,
    argsDigest: digestToolInvocation(input.toolName, input.args),
    resumeStrategy: input.resumeStrategy,
    principalBinding: input.principalBinding
  };
}

export function handoffOwnerMatches(left: HandoffOwner, right: HandoffOwner): boolean {
  return left.toolName === right.toolName &&
    left.argsDigest === right.argsDigest &&
    left.resumeStrategy === right.resumeStrategy &&
    left.principalBinding === right.principalBinding;
}

export class HandoffOwnerRegistry {
  private readonly owners = new Map<string, HandoffOwner>();

  claim(interventionId: string, owner: HandoffOwner): boolean {
    const existing = this.owners.get(interventionId);
    if (existing) return handoffOwnerMatches(existing, owner);
    this.owners.set(interventionId, owner);
    return true;
  }

  get(interventionId: string): HandoffOwner | undefined {
    return this.owners.get(interventionId);
  }

  delete(interventionId: string): boolean {
    return this.owners.delete(interventionId);
  }
}
