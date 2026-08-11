import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function digestActionEnvelope(actionName: string, args: unknown): string {
  return createHash("sha256")
    .update("maps-browser-mcp/action-envelope/v1\0")
    .update(actionName)
    .update("\0")
    .update(canonicalJson(args))
    .digest("base64url");
}

export interface ApprovalRequest {
  id: string;
  actionDigest: string;
  epoch: number;
  principalBinding: string;
  expiresAt: number;
}

interface ApprovalRecord extends ApprovalRequest {
  granted: boolean;
  consumed: boolean;
}

export class ActionApprovalError extends Error {
  constructor(
    public readonly code:
      | "APPROVAL_NOT_FOUND"
      | "APPROVAL_EXPIRED"
      | "APPROVAL_FORBIDDEN"
      | "APPROVAL_NOT_GRANTED"
      | "APPROVAL_ALREADY_USED",
    message: string
  ) {
    super(message);
    this.name = "ActionApprovalError";
  }
}

/**
 * Explicit approval channel for irreversible actions. Human takeover completion is
 * deliberately not connected to this manager: an adapter must separately request,
 * grant, and consume an approval bound to the exact final action arguments.
 */
export class ActionApprovalManager {
  private readonly records = new Map<string, ApprovalRecord>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly signingKey: Buffer = randomBytes(32)
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 30 * 60_000) {
      throw new Error("approval ttl must be between 1000ms and 30 minutes");
    }
  }

  request(input: {
    actionName: string;
    args: unknown;
    epoch: number;
    principalBinding: string;
  }): ApprovalRequest {
    this.prune();
    const record: ApprovalRecord = {
      id: this.createId(),
      actionDigest: digestActionEnvelope(input.actionName, input.args),
      epoch: input.epoch,
      principalBinding: input.principalBinding,
      expiresAt: this.now() + this.ttlMs,
      granted: false,
      consumed: false
    };
    this.records.set(record.id, record);
    return this.publicRecord(record);
  }

  grant(id: string, principalBinding: string): string {
    const record = this.requireActive(id);
    this.assertPrincipal(record, principalBinding);
    record.granted = true;
    return this.receipt(record);
  }

  consume(input: {
    id: string;
    receipt: string;
    actionName: string;
    args: unknown;
    epoch: number;
    principalBinding: string;
  }): void {
    const record = this.requireActive(input.id);
    this.assertPrincipal(record, input.principalBinding);
    if (!record.granted) {
      throw new ActionApprovalError("APPROVAL_NOT_GRANTED", "Action approval has not been granted");
    }
    if (record.consumed) {
      throw new ActionApprovalError("APPROVAL_ALREADY_USED", "Action approval was already consumed");
    }
    if (record.epoch !== input.epoch || record.actionDigest !== digestActionEnvelope(input.actionName, input.args)) {
      throw new ActionApprovalError("APPROVAL_FORBIDDEN", "Action approval does not match the final action envelope");
    }
    const expected = Buffer.from(this.receipt(record), "utf8");
    const supplied = Buffer.from(input.receipt, "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new ActionApprovalError("APPROVAL_FORBIDDEN", "Action approval receipt is invalid");
    }
    record.consumed = true;
  }

  revoke(id: string): void {
    this.records.delete(id);
  }

  private requireActive(id: string): ApprovalRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new ActionApprovalError("APPROVAL_NOT_FOUND", "Action approval is not active");
    }
    if (record.expiresAt <= this.now()) {
      this.records.delete(id);
      throw new ActionApprovalError("APPROVAL_EXPIRED", "Action approval expired");
    }
    return record;
  }

  private assertPrincipal(record: ApprovalRecord, principalBinding: string): void {
    const expected = Buffer.from(record.principalBinding, "utf8");
    const supplied = Buffer.from(principalBinding, "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new ActionApprovalError("APPROVAL_FORBIDDEN", "Action approval is unavailable");
    }
  }

  private receipt(record: ApprovalRecord): string {
    return createHmac("sha256", this.signingKey)
      .update("maps-browser-mcp/action-approval/v1\0")
      .update(record.id)
      .update("\0")
      .update(record.actionDigest)
      .update("\0")
      .update(String(record.epoch))
      .update("\0")
      .update(record.principalBinding)
      .update("\0")
      .update(String(record.expiresAt))
      .digest("base64url");
  }

  private publicRecord(record: ApprovalRecord): ApprovalRequest {
    return {
      id: record.id,
      actionDigest: record.actionDigest,
      epoch: record.epoch,
      principalBinding: record.principalBinding,
      expiresAt: record.expiresAt
    };
  }

  private prune(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now || record.consumed) this.records.delete(id);
    }
  }
}
