import type { CaptureFrame } from "./frame-pipeline.js";

/** Capture is transport-neutral. Encoded-image and raw-frame adapters share this boundary. */
export interface CaptureAdapter<TFrame extends CaptureFrame = CaptureFrame> {
  frames(signal: AbortSignal): AsyncIterable<TFrame>;
}
