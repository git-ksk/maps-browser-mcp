export type TakeoverLatencyMetric =
  | "capture_to_pipeline_ms"
  | "input_dispatch_ms";

export interface LatencyMetricSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

/** Bounded in-memory metrics only. No browser content, credentials, or input values are retained. */
export class LatencyMetrics {
  private readonly samples = new Map<TakeoverLatencyMetric, number[]>();

  constructor(private readonly maxSamplesPerMetric = 256) {
    if (!Number.isInteger(maxSamplesPerMetric) || maxSamplesPerMetric < 1 || maxSamplesPerMetric > 10_000) {
      throw new Error("maxSamplesPerMetric must be between 1 and 10000");
    }
  }

  record(metric: TakeoverLatencyMetric, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const values = this.samples.get(metric) ?? [];
    values.push(milliseconds);
    if (values.length > this.maxSamplesPerMetric) values.splice(0, values.length - this.maxSamplesPerMetric);
    this.samples.set(metric, values);
  }

  snapshot(metric: TakeoverLatencyMetric): LatencyMetricSummary {
    const sorted = [...(this.samples.get(metric) ?? [])].sort((left, right) => left - right);
    return {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted.at(-1) ?? 0
    };
  }
}
