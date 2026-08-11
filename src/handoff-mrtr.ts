import { createHash } from "node:crypto";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/server";

export const HANDOFF_INPUT_KEY = "human_intervention";
export const HANDOFF_STATE_TTL_SECONDS = 10 * 60;

export type HandoffResumeStrategy = "retry_original" | "require_fresh_semantic_action";

export interface HandoffRequestState {
  version: 2;
  phase: "awaiting_human";
  toolName: string;
  argsDigest: string;
  interventionId: string;
  epoch: number;
  resumeStrategy: HandoffResumeStrategy;
  principalBinding: string;
}

export const HUMAN_INTERVENTION_SCHEMA: ElicitRequestFormParams["requestedSchema"] = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      title: "Manual step",
      enum: ["continue", "cancel"],
      enumNames: ["Continue after completing it", "Cancel this operation"]
    }
  },
  required: ["decision"]
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
  return `{${entries.join(",")}}`;
}

export function digestToolInvocation(toolName: string, args: unknown): string {
  return createHash("sha256")
    .update(toolName)
    .update("\0")
    .update(canonicalJson(args))
    .digest("hex");
}

export function createHandoffRequestState(input: {
  toolName: string;
  args: unknown;
  interventionId: string;
  epoch: number;
  resumeStrategy: HandoffResumeStrategy;
  principalBinding: string;
}): HandoffRequestState {
  return {
    version: 2,
    phase: "awaiting_human",
    toolName: input.toolName,
    argsDigest: digestToolInvocation(input.toolName, input.args),
    interventionId: input.interventionId,
    epoch: input.epoch,
    resumeStrategy: input.resumeStrategy,
    principalBinding: input.principalBinding
  };
}

export function handoffStateMatchesInvocation(
  state: HandoffRequestState,
  toolName: string,
  args: unknown,
  principalBinding: string
): boolean {
  return state.version === 2 &&
    state.phase === "awaiting_human" &&
    state.toolName === toolName &&
    state.argsDigest === digestToolInvocation(toolName, args) &&
    state.principalBinding === principalBinding;
}

export function interventionPrompt(reason: string): string {
  const label = reason === "access_challenge"
    ? "an access challenge or CAPTCHA"
    : reason === "sign_in"
      ? "a Google sign-in step"
      : reason === "consent"
        ? "a Google consent step"
        : "a manual browser step";

  return [
    `Google Maps requires ${label}.`,
    "Complete that step directly in the dedicated Chrome window.",
    "Do not paste passwords, 2FA codes, CAPTCHA answers, cookies, or other credentials into this MCP prompt.",
    "Choose Continue only after the browser step is complete, or Cancel to stop the operation."
  ].join(" ");
}
