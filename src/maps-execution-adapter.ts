import { defineExecutionAdapter, type RegisteredExecutionAdapter, type ResumeDecision } from "mcp-execution-handoff/core";
import type { MapsBrowserRuntime, MapsIntervention } from "./browser/runtime.js";
import type { MapsAction } from "./types.js";

export type MapsExecutionAdapter = RegisteredExecutionAdapter<
  MapsIntervention,
  ResumeDecision<MapsAction>
>;

export function createMapsExecutionAdapter(runtime: MapsBrowserRuntime): MapsExecutionAdapter {
  return defineExecutionAdapter("browser.maps", runtime);
}
