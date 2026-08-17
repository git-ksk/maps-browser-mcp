import { digestToolInvocation } from "mcp-execution-handoff/core";

export const ACTION_APPROVAL_INPUT_KEY = "action-approval";

export interface ActionApprovalRequestState {
  version: 1;
  phase: "awaiting_action_approval";
  toolName: string;
  argsDigest: string;
  approvalId: string;
  epoch: number;
  principalBinding: string;
}

export function createActionApprovalRequestState(input: {
  toolName: string;
  args: unknown;
  approvalId: string;
  epoch: number;
  principalBinding: string;
}): ActionApprovalRequestState {
  return {
    version: 1,
    phase: "awaiting_action_approval",
    toolName: input.toolName,
    argsDigest: digestToolInvocation(input.toolName, input.args),
    approvalId: input.approvalId,
    epoch: input.epoch,
    principalBinding: input.principalBinding
  };
}

export function actionApprovalStateMatchesInvocation(
  state: ActionApprovalRequestState,
  toolName: string,
  args: unknown,
  principalBinding: string
): boolean {
  return state.version === 1 &&
    state.phase === "awaiting_action_approval" &&
    state.toolName === toolName &&
    state.argsDigest === digestToolInvocation(toolName, args) &&
    state.principalBinding === principalBinding;
}

export function supportsActionApprovalFormElicitation(capabilities: unknown): boolean {
  const value = capabilities as { elicitation?: { form?: unknown } } | null | undefined;
  return value?.elicitation?.form !== undefined;
}
