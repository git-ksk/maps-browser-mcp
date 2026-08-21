import { LatencyMetrics } from "./latency-metrics.js";

export interface EncodedImageFrame {
  kind: "encoded_image";
  data: string;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  hostname: string;
  capturedAtMs: number;
}

export interface RawFrame {
  kind: "raw";
  data: Uint8Array;
  pixelFormat: "rgba" | "bgra";
  width: number;
  height: number;
  stride: number;
  hostname: string;
  capturedAtMs: number;
}

export interface EncodedVideoFrame {
  kind: "encoded_video";
  data: Uint8Array;
  codec: "vp8" | "h264" | "av1";
  width: number;
  height: number;
  hostname: string;
  timestampUs: number;
}

export interface EncoderAdapter {
  encode(frame: RawFrame): Promise<EncodedVideoFrame>;
}

export type CaptureFrame = EncodedImageFrame | RawFrame;
export type FramePipelineOutput = EncodedImageFrame | EncodedVideoFrame;

/**
 * Keeps already-encoded image frames on a passthrough path. Raw capture is the only
 * path that invokes EncoderAdapter, preventing CDP JPEG decode/re-encode in Phase 1.
 */
export class FramePipeline {
  constructor(
    private readonly encoder: EncoderAdapter | undefined,
    private readonly metrics: LatencyMetrics,
    private readonly now: () => number = Date.now
  ) {}

  async process(frame: CaptureFrame): Promise<FramePipelineOutput> {
    this.metrics.record("capture_to_pipeline_ms", Math.max(0, this.now() - frame.capturedAtMs));
    if (frame.kind === "encoded_image") return frame;
    if (!this.encoder) throw new Error("Raw takeover frame requires an EncoderAdapter");
    return this.encoder.encode(frame);
  }
}
