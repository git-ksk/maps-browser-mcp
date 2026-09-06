import type { ProfileLifecycleDiagnosticValue } from "./profile-lifecycle-diagnostics.js";

export type BrowserAutomationEndpoint =
  | { kind: "local_port"; port: number }
  | { kind: "browser_websocket"; websocketUrl: string };

export interface BrowserSessionOwner {
  readonly kind?: string;
  start(): Promise<number | BrowserAutomationEndpoint>;
  close(): Promise<void>;
  closeForProfileCheckpoint?(): Promise<void>;
  diagnosticsSnapshot?(): Promise<Record<string, ProfileLifecycleDiagnosticValue>>;
}

export function normalizeBrowserAutomationEndpoint(
  value: number | BrowserAutomationEndpoint
): BrowserAutomationEndpoint {
  if (typeof value === "number") return { kind: "local_port", port: value };
  return value;
}
