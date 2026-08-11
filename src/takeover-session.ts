import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface TakeoverGrant {
  id: string;
  capability: string;
  interventionId: string;
  epoch: number;
  principalBinding: string;
  expiresAt: number;
}

interface TakeoverRecord {
  id: string;
  interventionId: string;
  epoch: number;
  principalBinding: string;
  expiresAt: number;
  revoked: boolean;
}

export class TakeoverSessionError extends Error {
  constructor(
    public readonly code: "TAKEOVER_NOT_FOUND" | "TAKEOVER_EXPIRED" | "TAKEOVER_FORBIDDEN",
    message: string
  ) {
    super(message);
    this.name = "TakeoverSessionError";
  }
}

export class TakeoverSessionManager {
  private readonly records = new Map<string, TakeoverRecord>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly signingKey: Buffer = randomBytes(32)
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) {
      throw new Error("takeover ttl must be at least 1000ms");
    }
  }

  ensure(interventionId: string, epoch: number, principalBinding: string): TakeoverGrant {
    this.pruneExpired();
    for (const record of this.records.values()) {
      if (
        !record.revoked &&
        record.interventionId === interventionId &&
        record.epoch === epoch &&
        record.principalBinding === principalBinding
      ) {
        return this.grant(record);
      }
    }

    this.revokeForIntervention(interventionId);
    const record: TakeoverRecord = {
      id: this.createId(),
      interventionId,
      epoch,
      principalBinding,
      expiresAt: this.now() + this.ttlMs,
      revoked: false
    };
    this.records.set(record.id, record);
    return this.grant(record);
  }

  issueCapability(id: string, principalBinding: string): TakeoverGrant {
    const record = this.requireActive(id);
    this.assertPrincipal(record, principalBinding);
    return this.grant(record);
  }

  verify(id: string, capability: string, principalBinding: string): Omit<TakeoverGrant, "capability"> {
    const record = this.requireActive(id);
    this.assertPrincipal(record, principalBinding);
    const expected = Buffer.from(this.capabilityFor(record), "utf8");
    const supplied = Buffer.from(capability, "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover capability is invalid");
    }

    return {
      id: record.id,
      interventionId: record.interventionId,
      epoch: record.epoch,
      principalBinding: record.principalBinding,
      expiresAt: record.expiresAt
    };
  }

  revoke(id: string): void {
    const record = this.records.get(id);
    if (record) record.revoked = true;
  }

  revokeForIntervention(interventionId: string): void {
    for (const record of this.records.values()) {
      if (record.interventionId === interventionId) record.revoked = true;
    }
  }

  private requireActive(id: string): TakeoverRecord {
    const record = this.records.get(id);
    if (!record || record.revoked) {
      throw new TakeoverSessionError("TAKEOVER_NOT_FOUND", "Takeover session is not active");
    }
    if (record.expiresAt <= this.now()) {
      record.revoked = true;
      throw new TakeoverSessionError("TAKEOVER_EXPIRED", "Takeover session expired");
    }
    return record;
  }

  private assertPrincipal(record: TakeoverRecord, principalBinding: string): void {
    const expected = Buffer.from(record.principalBinding, "utf8");
    const supplied = Buffer.from(principalBinding, "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover session is unavailable");
    }
  }

  private grant(record: TakeoverRecord): TakeoverGrant {
    return {
      id: record.id,
      capability: this.capabilityFor(record),
      interventionId: record.interventionId,
      epoch: record.epoch,
      principalBinding: record.principalBinding,
      expiresAt: record.expiresAt
    };
  }

  private capabilityFor(record: TakeoverRecord): string {
    return createHmac("sha256", this.signingKey)
      .update("maps-browser-mcp/takeover/v2\0")
      .update(record.id)
      .update("\0")
      .update(record.interventionId)
      .update("\0")
      .update(String(record.epoch))
      .update("\0")
      .update(record.principalBinding)
      .update("\0")
      .update(String(record.expiresAt))
      .digest("base64url");
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (record.revoked || record.expiresAt <= now) this.records.delete(id);
    }
  }
}
