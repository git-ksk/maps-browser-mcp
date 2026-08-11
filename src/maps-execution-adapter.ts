import type { ResumeDecision } from "./execution-handoff.js";
import { defineExecutionAdapter, type RegisteredExecutionAdapter } from "./execution-adapter.js";
import type { MapsBrowserRuntime, MapsIntervention } from "./browser/runtime.js";
import type { MapsAction } from "./types.js";

export type MapsExecutionAdapter = RegisteredExecutionAdapter<
  MapsIntervention,
  ResumeDecision<MapsAction>
>;

export function createMapsExecutionAdapter(runtime: MapsBrowserRuntime): MapsExecutionAdapter {
  return defineExecutionAdapter("browser.maps", runtime);
}
