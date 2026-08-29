import {
  parseManagedOperatorDiagnosticsSnapshot,
  type ManagedOperatorDiagnosticEvent,
  type ManagedOperatorDiagnosticsSnapshot
} from "mcp-execution-handoff/browser-takeover";

/**
 * Format one production operator record from Handoff's closed-world managed diagnostics contract.
 * No consumer identifiers or payload fields are accepted here; the upstream parser rejects extras.
 */
export function formatManagedHandoffDiagnosticsLog(
  event: ManagedOperatorDiagnosticEvent,
  snapshot: ManagedOperatorDiagnosticsSnapshot
): string {
  const strict = parseManagedOperatorDiagnosticsSnapshot(snapshot);
  return JSON.stringify({
    type: "managed_handoff_diagnostics",
    event: event.kind,
    diagnostics: strict
  });
}

export type ManagedHandoffDiagnosticsCheckpoint = "before_takeover";

/** Format a bounded acceptance checkpoint from the same strict managed diagnostics API. */
export function formatManagedHandoffDiagnosticsCheckpointLog(
  checkpoint: ManagedHandoffDiagnosticsCheckpoint,
  snapshot: ManagedOperatorDiagnosticsSnapshot
): string {
  const strict = parseManagedOperatorDiagnosticsSnapshot(snapshot);
  return JSON.stringify({
    type: "managed_handoff_diagnostics",
    checkpoint,
    diagnostics: strict
  });
}
