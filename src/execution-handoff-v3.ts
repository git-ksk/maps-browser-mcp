import { timingSafeEqual } from "node:crypto";
import {
  ActionApprovalManager,
  digestActionEnvelope,
  type ApprovalRequest
} from "./action-approval.js";
import type {
  RegisteredExecutionAdapter
} from "./execution-adapter.js";
import {
  NOOP_EXECUTION_AUDIT,
  type ExecutionAuditSink
} from "./execution-audit.js";
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
  auditSink?: ExecutionAuditSink;
  checkpointTtlMs?: number;
  now?: () => number;
}

/**
 * V3 control-plane composition. It intentionally does not know how to click a browser,
 * approve a terminal command, or operate a desktop. Those capabilities remain inside
 * the registered adapter. It adds only durable recovery metadata, exact-action
 * approvals, and secret-safe audit events around that adapter.
 */
export class ExecutionHandoffRuntimeV3<
  TIntervention extends CheckpointableIntervention,
  TResumeDecision
> {
  private readonly approvals: ActionApprovalManager;
  private readonly audit: ExecutionAuditSink;
  private readonly checkpointTtlMs: number;
  private readonly now: () => number;

  constructor(
    readonly adapter: RegisteredExecutionAdapter<TIntervention, TResumeDecision>,
    private readonly options: ExecutionHandoffV3Options = {}
  ) {
    this.approvals = options.approvalManager ?? new ActionApprovalManager();
    this.audit = options.auditSink ?? NOOP_EXECUTION_AUDIT;
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
      this.audit.record({
        type: "checkpoint_cleared",
        adapterKind: this.adapter.kind,
        timestamp: this.now(),
        principalBinding
      });
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
    this.audit.record({
      type: "checkpoint_written",
      adapterKind: this.adapter.kind,
      timestamp: now,
      interventionId: active.id,
      epoch: active.epoch,
      principalBinding,
      actionDigest
    });
  }

  clearCheckpoint(principalBinding?: string): void {
    this.options.checkpointStore?.clear();
    this.audit.record({
      type: "checkpoint_cleared",
      adapterKind: this.adapter.kind,
      timestamp: this.now(),
      principalBinding
    });
  }

  recover(principalBinding: string): HandoffRecoveryRecord | undefined {
    const record = this.options.checkpointStore?.recover();
    if (!record) return undefined;
    if (record.adapterKind !== this.adapter.kind || !this.same(record.principalBinding, principalBinding)) {
      return undefined;
    }
    this.audit.record({
      type: "recovery_requested",
      adapterKind: this.adapter.kind,
      timestamp: this.now(),
      interventionId: record.interventionId,
      epoch: record.epoch,
      principalBinding,
      actionDigest: record.actionDigest
    });
    return record;
  }

  requestApproval(input: {
    actionName: string;
    args: unknown;
    principalBinding: string;
  }): ApprovalRequest {
    const request = this.approvals.request({
      actionName: input.actionName,
      args: input.args,
      epoch: this.adapter.control.getResourceEpoch(),
      principalBinding: input.principalBinding
    });
    this.audit.record({
      type: "approval_requested",
      adapterKind: this.adapter.kind,
      timestamp: this.now(),
      approvalId: request.id,
      epoch: request.epoch,
      principalBinding: input.principalBinding,
      actionDigest: request.actionDigest
    });
    return request;
  }

  grantApproval(id: string, principalBinding: string): string {
    const receipt = this.approvals.grant(id, principalBinding);
    this.audit.record({
      type: "approval_granted",
      adapterKind: this.adapter.kind,
      timestamp: this.now(),
      approvalId: id,
      principalBinding
    });
    return receipt;
  }

  consumeApproval(input: {
    id: string;
    receipt: string;
    actionName: string;
    args: unknown;
    principalBinding: string;
  }): void {
    const epoch = this.adapter.control.getResourceEpoch();
    this.approvals.consume({ ...input, epoch });
    this.audit.record({
      type: "approval_consumed",
      adapterKind: this.adapter.kind,
      timestamp: this.now(),
      approvalId: input.id,
      epoch,
      principalBinding: input.principalBinding,
      actionDigest: digestActionEnvelope(input.actionName, input.args)
    });
  }

  private same(left: string, right: string): boolean {
    const a = Buffer.from(left, "utf8");
    const b = Buffer.from(right, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
