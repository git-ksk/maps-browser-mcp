import type { ExecutionAuthority } from "./execution-handoff.js";

/**
 * Generic control-plane contract between the MCP handoff flow and a resource adapter.
 * Browser, desktop, terminal, or cloud-console adapters can implement this without
 * exposing their native control protocol to the MCP client.
 */
export interface ExecutionHandoffAdapter<TIntervention, TResumeDecision> {
  readonly adapterKind: string;
  getResourceEpoch(): number;
  getExecutionAuthority(): ExecutionAuthority;
  getActiveIntervention(): TIntervention | undefined;
  claimHumanControl(interventionId: string): TIntervention;
  markHumanControlComplete(interventionId: string): TIntervention;
  verifyHumanIntervention(interventionId: string): Promise<TIntervention>;
  resumeAfterHumanIntervention(interventionId: string): TResumeDecision;
  cancelHumanIntervention(interventionId: string): void;
}
