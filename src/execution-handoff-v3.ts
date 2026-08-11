import { timingSafeEqual } from "node:crypto";
import {
  ActionApprovalManager,
  type ApprovalRequest
} from "./action-approval.js";
import type {
  RegisteredExecutionAdapter
} from "./execution-adapter.js";
import type {
  InterventionStatus,
  ResumePolicy
} from "./execution-handoff.js";
import type {
  HandoffRecoveryRecord,
  SignedFileHandoffCheckpointStore
} from "./handoff-checkpoint.js";

export interface CheckpointableIntervention {
  id: string;
  status: InterventionStatus;
  epoch: number;
  resumePolicy: ResumePolicy;
  updatedAt: number;
}

export interface ExecutionHandoffV3Options {
  checkpointStore?: SignedFileHandoffCheckpointStore;
  approvalManager?: ActionApprovalManager;
  checkpointTtlMs?: number;
  now?: () => number;
}

/**
 * V3 control-plane composition. It intentionally does not know how to click a browser,
 * approve a terminal command, or operate a desktop. Those capabilities remain inside
 * the registered adapter. It adds only durable recovery metadata and exact-action
 * approvals around that adapter.
 */
export class ExecutionHandoffRuntimeV3<
  TIntervention extends CheckpointableIntervention,
  TResumeDecision
> {
  private readonly approvals: ActionApprovalManager;
  private readonly checkpointTtlMs: number;
  private readonly now: () => number;

  constructor(
    readonly adapter: RegisteredExecutionAdapter<TIntervention, TResumeDecision>,
    private readonly options: ExecutionHandoffV3Options = {}
  ) {
    this.approvals = options.approvalManager ?? new ActionApprovalManager();
    this.checkpointTtlMs = options.checkpointTtlMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.checkpointTtlMs) || this.checkpointTtlMs < 60_000 || this.checkpointTtlMs > 24 * 60 * 60_000) {
      throw new Error("checkpoint ttl must be between 1 minute and 24 hours");
    }
  }

  checkpoint(principalBinding: string, actionDigest?: string): void {
    const store = this.options.checkpointStore;
    if (!store) return;
    const active = this.adapter.control.getActiveIntervention();
    if (!active) {
      store.clear();
      return;
    }
    const now = this.now();
    store.write({
      version: 1,
      adapterKind: this.adapter.kind,
      interventionId: active.id,
      status: active.status,
      epoch: active.epoch,
      resumePolicy: active.resumePolicy,
      principalBinding,
      actionDigest,
      updatedAt: active.updatedAt,
      expiresAt: now + this.checkpointTtlMs
    });
  }

  clearCheckpoint(): void {
    this.options.checkpointStore?.clear();
  }

  recover(principalBinding: string): HandoffRecoveryRecord | undefined {
    const record = this.options.checkpointStore?.recover();
    if (!record) return undefined;
    if (record.adapterKind !== this.adapter.kind || !this.same(record.principalBinding, principalBinding)) {
      return undefined;
    }
    return record;
  }

  requestApproval(input: {
    actionName: string;
    args: unknown;
    principalBinding: string;
  }): ApprovalRequest {
    return this.approvals.request({
      actionName: input.actionName,
      args: input.args,
      epoch: this.adapter.control.getResourceEpoch(),
      principalBinding: input.principalBinding
    });
  }

  grantApproval(id: string, principalBinding: string): string {
    return this.approvals.grant(id, principalBinding);
  }

  consumeApproval(input: {
    id: string;
    receipt: string;
    actionName: string;
    args: unknown;
    principalBinding: string;
  }): void {
    this.approvals.consume({
      ...input,
      epoch: this.adapter.control.getResourceEpoch()
    });
  }

  private same(left: string, right: string): boolean {
    const a = Buffer.from(left, "utf8");
    const b = Buffer.from(right, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
