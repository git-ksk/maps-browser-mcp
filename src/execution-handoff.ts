import { randomUUID } from "node:crypto";

export const RESUME_POLICIES = [
  "replay_safe",
  "revalidate",
  "confirm_before_execute",
  "never_replay"
] as const;

export type ResumePolicy = (typeof RESUME_POLICIES)[number];
export type ExecutionAuthority = "agent" | "human" | "none";
export type InterventionStatus =
  | "awaiting_human"
  | "human_active"
  | "verifying"
  | "ready_to_resume";

export interface ExecutionIntervention<TAction, TReason extends string = string> {
  id: string;
  reason: TReason;
  status: InterventionStatus;
  authority: Exclude<ExecutionAuthority, "agent">;
  epoch: number;
  action?: TAction;
  resumePolicy: ResumePolicy;
  createdAt: number;
  updatedAt: number;
}

export interface ResumeDecision<TAction> {
  action?: TAction;
  resumePolicy: ResumePolicy;
  epoch: number;
}

export class ExecutionHandoffError extends Error {
  constructor(
    public readonly code:
      | "INTERVENTION_NOT_FOUND"
      | "INTERVENTION_STATE_CHANGED"
      | "AGENT_AUTHORITY_SUSPENDED",
    message: string
  ) {
    super(message);
    this.name = "ExecutionHandoffError";
  }
}

export class ExecutionHandoffState<TAction, TReason extends string = string> {
  private epoch = 0;
  private active?: ExecutionIntervention<TAction, TReason>;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID
  ) {}

  getResourceEpoch(): number {
    return this.epoch;
  }

  getAuthority(): ExecutionAuthority {
    if (!this.active) return "agent";
    return this.active.status === "human_active" ? "human" : "none";
  }

  getActive(): ExecutionIntervention<TAction, TReason> | undefined {
    return this.active ? { ...this.active } : undefined;
  }

  advanceResourceEpoch(): number {
    this.epoch += 1;
    return this.epoch;
  }

  begin(input: {
    reason: TReason;
    action?: TAction;
    resumePolicy: ResumePolicy;
  }): ExecutionIntervention<TAction, TReason> {
    if (this.active) return { ...this.active };

    const now = this.now();
    const intervention: ExecutionIntervention<TAction, TReason> = {
      id: this.createId(),
      reason: input.reason,
      status: "awaiting_human",
      authority: "none",
      epoch: this.advanceResourceEpoch(),
      resumePolicy: input.resumePolicy,
      createdAt: now,
      updatedAt: now
    };
    if (input.action !== undefined) intervention.action = input.action;
    this.active = intervention;
    return { ...intervention };
  }

  claimHuman(interventionId: string): ExecutionIntervention<TAction, TReason> {
    const active = this.requireActive(interventionId);
    if (active.status === "human_active") return { ...active };
    this.requireStatus(active, "awaiting_human");
    active.status = "human_active";
    active.authority = "human";
    active.updatedAt = this.now();
    return { ...active };
  }

  markHumanComplete(interventionId: string): ExecutionIntervention<TAction, TReason> {
    const active = this.requireActive(interventionId);
    this.requireStatus(active, "human_active");
    active.status = "verifying";
    active.authority = "none";
    active.epoch = this.advanceResourceEpoch();
    active.updatedAt = this.now();
    return { ...active };
  }

  markVerified(interventionId: string): ExecutionIntervention<TAction, TReason> {
    const active = this.requireActive(interventionId);
    this.requireStatus(active, "verifying");
    active.status = "ready_to_resume";
    active.updatedAt = this.now();
    return { ...active };
  }

  resumeAgent(interventionId: string): ResumeDecision<TAction> {
    const active = this.requireActive(interventionId);
    this.requireStatus(active, "ready_to_resume");
    const decision: ResumeDecision<TAction> = {
      resumePolicy: active.resumePolicy,
      epoch: active.epoch
    };
    if (active.action !== undefined) decision.action = active.action;
    this.active = undefined;
    return decision;
  }

  cancel(interventionId: string): void {
    this.requireActive(interventionId);
    this.active = undefined;
    this.advanceResourceEpoch();
  }

  assertAgentAuthority(): void {
    const active = this.active;
    if (!active) return;
    throw new ExecutionHandoffError(
      "AGENT_AUTHORITY_SUSPENDED",
      `Agent authority is suspended while intervention ${active.id} is ${active.status}`
    );
  }

  private requireActive(interventionId: string): ExecutionIntervention<TAction, TReason> {
    const active = this.active;
    if (!active || active.id !== interventionId) {
      throw new ExecutionHandoffError(
        "INTERVENTION_NOT_FOUND",
        "The intervention is no longer active"
      );
    }
    return active;
  }

  private requireStatus(
    active: ExecutionIntervention<TAction, TReason>,
    expected: InterventionStatus
  ): void {
    if (active.status === expected) return;
    throw new ExecutionHandoffError(
      "INTERVENTION_STATE_CHANGED",
      `Intervention ${active.id} is ${active.status}; expected ${expected}`
    );
  }
}
