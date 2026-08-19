import { Firestore } from "@google-cloud/firestore";
import { UsageControl, UsageDeniedError, type UsageLease, type UsagePolicy } from "mcp-usage-control";
import { FirestoreUsageStore } from "mcp-usage-control-firestore";

export const MAPS_USAGE_COLLECTION_PREFIX = "maps_muc";

export interface MapsUsageConfig {
  projectId: string;
  dailyLimit: number;
  leaseTtlMs: number;
}

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function mapsUsageOperationId(operationScope: string | undefined, requestId: string | number): string {
  return `${operationScope ?? "stdio"}:${String(requestId)}`;
}

function returnedToolError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    (result as { isError?: unknown }).isError === true
  );
}

async function settleBestEffort(
  lease: Pick<UsageLease, "settle">,
  outcome: "completed" | "error"
): Promise<void> {
  try {
    await lease.settle(1, outcome);
  } catch (settlementError) {
    // Liability is marked before browser work. Firestore retains the full unit
    // for an expired liable reservation, so a post-task settlement failure must
    // not replace or weaken the real Maps tool result.
    console.error("[maps-browser-mcp] MCP usage settlement failed", {
      errorName: settlementError instanceof Error ? settlementError.name : "UnknownError"
    });
  }
}

export async function executeLiableUsageTask<T>(
  lease: Pick<UsageLease, "settle">,
  task: () => Promise<T>
): Promise<T> {
  let result: T;
  try {
    result = await task();
  } catch (error) {
    await settleBestEffort(lease, "error");
    throw error;
  }

  await settleBestEffort(lease, returnedToolError(result) ? "error" : "completed");
  return result;
}

export class MapsUsageRuntime {
  private readonly firestore: Firestore;
  private readonly control: UsageControl;

  constructor(private readonly config: MapsUsageConfig) {
    this.firestore = new Firestore({ projectId: config.projectId });
    const store = new FirestoreUsageStore(this.firestore, {
      // Cinema MCP can share the same Firestore project safely because the
      // adapter owns distinct top-level collections for each prefix.
      collectionPrefix: MAPS_USAGE_COLLECTION_PREFIX,
      cleanupBatchSize: 8,
      cleanupIntervalMs: 10_000
    });
    const policy: UsagePolicy = {
      quote: (request) => ({
        decision: "allow",
        units: 1,
        reservationTtlMs: config.leaseTtlMs,
        budget: {
          key: `maps:user:${request.principal.id}:day:${utcDay()}`,
          limit: config.dailyLimit
        }
      })
    };
    this.control = new UsageControl(store, policy, {
      defaultReservationTtlMs: config.leaseTtlMs,
      metadata: (request) => ({ service: "maps-browser-mcp", tool: request.tool })
    });
  }

  async execute<T>(input: {
    operationId: string;
    principalId: string;
    tool: string;
    args: unknown;
    task: () => Promise<T>;
  }): Promise<T> {
    const admission = await this.control.reserve({
      operationId: input.operationId,
      principal: { id: input.principalId },
      tool: input.tool,
      args: input.args
    });
    if (!admission.allowed) throw new UsageDeniedError(admission.reason);

    await admission.lease.markLiable();
    return executeLiableUsageTask(admission.lease, input.task);
  }

  async close(): Promise<void> {
    await this.firestore.terminate();
  }
}
