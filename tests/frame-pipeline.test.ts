import assert from "node:assert/strict";
import test from "node:test";
import { FramePipeline, type EncoderAdapter, type RawFrame } from "../src/takeover-runtime/frame-pipeline.js";
import { LatencyMetrics } from "../src/takeover-runtime/latency-metrics.js";

test("FramePipeline passes encoded JPEG through without invoking EncoderAdapter", async () => {
  let encoded = 0;
  const encoder: EncoderAdapter = {
    async encode() {
      encoded += 1;
      throw new Error("encoded image must not be decoded/re-encoded");
    }
  };
  const metrics = new LatencyMetrics();
  const pipeline = new FramePipeline(encoder, metrics, () => 120);
  const input = {
    kind: "encoded_image" as const,
    data: Buffer.from("jpeg").toString("base64"),
    mimeType: "image/jpeg" as const,
    width: 800,
    height: 600,
    hostname: "accounts.google.com",
    capturedAtMs: 100
  };

  const output = await pipeline.process(input);
  assert.equal(output, input);
  assert.equal(encoded, 0);
  assert.deepEqual(metrics.snapshot("capture_to_pipeline_ms"), { count: 1, p50: 20, p95: 20, max: 20 });
});

test("FramePipeline routes raw pixels through EncoderAdapter only", async () => {
  const raw: RawFrame = {
    kind: "raw",
    data: new Uint8Array([1, 2, 3, 4]),
    pixelFormat: "bgra",
    width: 1,
    height: 1,
    stride: 4,
    hostname: "www.google.com",
    capturedAtMs: 10
  };
  let observed: RawFrame | undefined;
  const pipeline = new FramePipeline({
    async encode(frame) {
      observed = frame;
      return {
        kind: "encoded_video",
        data: new Uint8Array([9]),
        codec: "h264",
        width: frame.width,
        height: frame.height,
        hostname: frame.hostname,
        timestampUs: 12_000
      };
    }
  }, new LatencyMetrics(), () => 12);

  const output = await pipeline.process(raw);
  assert.equal(observed, raw);
  assert.equal(output.kind, "encoded_video");
  assert.equal(output.codec, "h264");
});

test("FramePipeline fails closed when raw capture has no EncoderAdapter", async () => {
  const pipeline = new FramePipeline(undefined, new LatencyMetrics(), () => 12);
  await assert.rejects(pipeline.process({
    kind: "raw",
    data: new Uint8Array([1, 2, 3, 4]),
    pixelFormat: "rgba",
    width: 1,
    height: 1,
    stride: 4,
    hostname: "www.google.com",
    capturedAtMs: 10
  }), /requires an EncoderAdapter/);
});
