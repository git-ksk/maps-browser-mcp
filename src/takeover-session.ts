import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface TakeoverLocator {
  id: string;
  interventionId: string;
  epoch: number;
  principalBinding: string;
  expiresAt: number;
}

export interface TakeoverGrant extends TakeoverLocator {
  capability: string;
  clientBinding: string;
}

interface TakeoverRecord extends TakeoverLocator {
  revoked: boolean;
  clientBinding?: string;
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

  ensure(interventionId: string, epoch: number, principalBinding: string): TakeoverLocator {
    this.pruneExpired();
    for (const record of this.records.values()) {
      if (
        !record.revoked &&
        record.interventionId === interventionId &&
        record.epoch === epoch &&
        record.principalBinding === principalBinding
      ) {
        return this.locator(record);
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
    return this.locator(record);
  }

  validateLocator(id: string, principalBinding: string): TakeoverLocator {
    const record = this.requireActive(id);
    this.assertPrincipal(record, principalBinding);
    return this.locator(record);
  }

  claimClient(id: string, principalBinding: string, clientBinding: string): TakeoverGrant {
    const record = this.requireActive(id);
    this.assertPrincipal(record, principalBinding);
    this.assertClientBindingShape(clientBinding);
    if (record.clientBinding === undefined) {
      record.clientBinding = clientBinding;
    } else if (!this.same(record.clientBinding, clientBinding)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover session is unavailable");
    }
    return this.grant(record);
  }

  verify(
    id: string,
    capability: string,
    principalBinding: string,
    clientBinding: string
  ): Omit<TakeoverGrant, "capability"> {
    const record = this.requireActive(id);
    this.assertPrincipal(record, principalBinding);
    this.assertClient(record, clientBinding);
    const expected = Buffer.from(this.capabilityFor(record), "utf8");
    const supplied = Buffer.from(capability, "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover capability is invalid");
    }

    return {
      ...this.locator(record),
      clientBinding: record.clientBinding!
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
    if (!this.same(record.principalBinding, principalBinding)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover session is unavailable");
    }
  }

  private assertClient(record: TakeoverRecord, clientBinding: string): void {
    this.assertClientBindingShape(clientBinding);
    if (!record.clientBinding || !this.same(record.clientBinding, clientBinding)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover session is unavailable");
    }
  }

  private assertClientBindingShape(clientBinding: string): void {
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(clientBinding)) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover session is unavailable");
    }
  }

  private same(left: string, right: string): boolean {
    const expected = Buffer.from(left, "utf8");
    const supplied = Buffer.from(right, "utf8");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }

  private locator(record: TakeoverRecord): TakeoverLocator {
    return {
      id: record.id,
      interventionId: record.interventionId,
      epoch: record.epoch,
      principalBinding: record.principalBinding,
      expiresAt: record.expiresAt
    };
  }

  private grant(record: TakeoverRecord): TakeoverGrant {
    if (!record.clientBinding) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover client has not claimed the session");
    }
    return {
      ...this.locator(record),
      capability: this.capabilityFor(record),
      clientBinding: record.clientBinding
    };
  }

  private capabilityFor(record: TakeoverRecord): string {
    if (!record.clientBinding) {
      throw new TakeoverSessionError("TAKEOVER_FORBIDDEN", "Takeover client has not claimed the session");
    }
    return createHmac("sha256", this.signingKey)
      .update("maps-browser-mcp/takeover/v3\0")
      .update(record.id)
      .update("\0")
      .update(record.interventionId)
      .update("\0")
      .update(String(record.epoch))
      .update("\0")
      .update(record.principalBinding)
      .update("\0")
      .update(record.clientBinding)
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
