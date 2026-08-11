import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { InterventionStatus, ResumePolicy } from "./execution-handoff.js";

export interface HandoffCheckpoint {
  version: 1;
  adapterKind: string;
  interventionId: string;
  status: InterventionStatus;
  epoch: number;
  resumePolicy: ResumePolicy;
  principalBinding: string;
  actionDigest?: string;
  updatedAt: number;
  expiresAt: number;
}

export interface HandoffRecoveryRecord extends HandoffCheckpoint {
  recovery: "reissue_and_revalidate";
}

interface SignedCheckpointEnvelope {
  checkpoint: HandoffCheckpoint;
  mac: string;
}

export class HandoffCheckpointError extends Error {
  constructor(
    public readonly code: "CHECKPOINT_INVALID" | "CHECKPOINT_EXPIRED",
    message: string
  ) {
    super(message);
    this.name = "HandoffCheckpointError";
  }
}

function isCheckpoint(value: unknown): value is HandoffCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<HandoffCheckpoint>;
  return v.version === 1 &&
    typeof v.adapterKind === "string" && v.adapterKind.length > 0 && v.adapterKind.length <= 80 &&
    typeof v.interventionId === "string" && v.interventionId.length > 0 && v.interventionId.length <= 160 &&
    ["awaiting_human", "human_active", "verifying", "ready_to_resume"].includes(v.status ?? "") &&
    Number.isSafeInteger(v.epoch) && Number(v.epoch) >= 0 &&
    ["replay_safe", "revalidate", "confirm_before_execute", "never_replay"].includes(v.resumePolicy ?? "") &&
    typeof v.principalBinding === "string" && v.principalBinding.length >= 16 && v.principalBinding.length <= 160 &&
    (v.actionDigest === undefined || (typeof v.actionDigest === "string" && v.actionDigest.length >= 16 && v.actionDigest.length <= 160)) &&
    Number.isSafeInteger(v.updatedAt) && Number.isSafeInteger(v.expiresAt);
}

/**
 * Persists only control-plane metadata. Raw action arguments, browser content,
 * credentials, cookies, CAPTCHA responses, and approval receipts must never be
 * written here. Recovery deliberately requires the original action to be reissued
 * and revalidated instead of restoring stale execution authority.
 */
export class SignedFileHandoffCheckpointStore {
  constructor(
    private readonly filePath: string,
    private readonly signingKey: Buffer,
    private readonly now: () => number = Date.now
  ) {
    if (!path.isAbsolute(filePath)) throw new Error("handoff checkpoint path must be absolute");
    if (signingKey.byteLength < 32) throw new Error("handoff checkpoint signing key must contain at least 32 bytes");
  }

  write(checkpoint: HandoffCheckpoint): void {
    if (!isCheckpoint(checkpoint)) throw new HandoffCheckpointError("CHECKPOINT_INVALID", "Invalid handoff checkpoint");
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const envelope: SignedCheckpointEnvelope = {
      checkpoint: { ...checkpoint },
      mac: this.mac(checkpoint)
    };
    const temp = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
    );
    try {
      fs.writeFileSync(temp, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temp, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } finally {
      try { fs.unlinkSync(temp); } catch { /* already renamed or absent */ }
    }
  }

  load(): HandoffCheckpoint | undefined {
    if (!fs.existsSync(this.filePath)) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      throw new HandoffCheckpointError("CHECKPOINT_INVALID", "Handoff checkpoint is unreadable");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HandoffCheckpointError("CHECKPOINT_INVALID", "Handoff checkpoint envelope is invalid");
    }
    const envelope = parsed as Partial<SignedCheckpointEnvelope>;
    if (!isCheckpoint(envelope.checkpoint) || typeof envelope.mac !== "string") {
      throw new HandoffCheckpointError("CHECKPOINT_INVALID", "Handoff checkpoint envelope is invalid");
    }
    const expected = Buffer.from(this.mac(envelope.checkpoint), "utf8");
    const supplied = Buffer.from(envelope.mac, "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new HandoffCheckpointError("CHECKPOINT_INVALID", "Handoff checkpoint integrity check failed");
    }
    if (envelope.checkpoint.expiresAt <= this.now()) {
      throw new HandoffCheckpointError("CHECKPOINT_EXPIRED", "Handoff checkpoint expired");
    }
    return { ...envelope.checkpoint };
  }

  recover(): HandoffRecoveryRecord | undefined {
    const checkpoint = this.load();
    if (!checkpoint) return undefined;
    return { ...checkpoint, recovery: "reissue_and_revalidate" };
  }

  clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private mac(checkpoint: HandoffCheckpoint): string {
    return createHmac("sha256", this.signingKey)
      .update("maps-browser-mcp/handoff-checkpoint/v1\0")
      .update(JSON.stringify(checkpoint))
      .digest("base64url");
  }
}
