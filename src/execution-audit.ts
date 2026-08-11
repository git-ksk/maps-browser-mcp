export type ExecutionAuditEventType =
  | "checkpoint_written"
  | "checkpoint_cleared"
  | "recovery_requested"
  | "approval_requested"
  | "approval_granted"
  | "approval_consumed";

export interface ExecutionAuditEvent {
  type: ExecutionAuditEventType;
  adapterKind: string;
  timestamp: number;
  interventionId?: string;
  approvalId?: string;
  epoch?: number;
  principalBinding?: string;
  actionDigest?: string;
}

export interface ExecutionAuditSink {
  record(event: ExecutionAuditEvent): void;
}

export const NOOP_EXECUTION_AUDIT: ExecutionAuditSink = {
  record() {}
};

/**
 * Deterministic in-memory sink for tests and embedding runtimes. Production sinks
 * must preserve the same bounded metadata contract and must not append raw action
 * arguments, browser content, credentials, cookies, CAPTCHA/2FA values, or tokens.
 */
export class MemoryExecutionAuditSink implements ExecutionAuditSink {
  private readonly events: ExecutionAuditEvent[] = [];

  record(event: ExecutionAuditEvent): void {
    this.events.push({ ...event });
  }

  snapshot(): ExecutionAuditEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}
