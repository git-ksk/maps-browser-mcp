import assert from "node:assert/strict";
import test from "node:test";
import { CdpScreencastCapture, type CdpScreencastPage } from "../src/takeover-runtime/cdp-screencast-capture.js";

test("CDP capture keeps JPEG encoded, ACKs frames, and uses latest-frame semantics", async () => {
  let frameHandler: ((event: { data: string; sessionId: number }) => void) | undefined;
  let navigationHandler: ((event: { frame: { url: string; parentId?: string } }) => void) | undefined;
  const acked: number[] = [];
  let stopped = 0;
  const page: CdpScreencastPage = {
    screencastFrame(listener) { frameHandler = listener; return () => { frameHandler = undefined; }; },
    frameNavigated(listener) { navigationHandler = listener; return () => { navigationHandler = undefined; }; },
    async screencastFrameAck({ sessionId }) { acked.push(sessionId); },
    async startScreencast() {
      queueMicrotask(() => {
        frameHandler?.({ data: "old-frame", sessionId: 1 });
        frameHandler?.({ data: "latest-frame", sessionId: 2 });
      });
    },
    async stopScreencast() { stopped += 1; }
  };
  let now = 100;
  const capture = new CdpScreencastCapture({
    page,
    width: 900,
    height: 700,
    hostname: "accounts.google.com",
    assertSurface(url) { assert.match(url, /^https:\/\//); },
    now: () => now++
  });
  const controller = new AbortController();
  const iterator = capture.frames(controller.signal)[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value?.kind, "encoded_image");
  assert.equal(first.value?.data, "latest-frame");
  assert.equal(first.value?.mimeType, "image/jpeg");
  assert.deepEqual(acked, [1, 2]);

  controller.abort();
  await iterator.return?.();
  assert.equal(stopped, 1);
  assert.equal(frameHandler, undefined);
  assert.equal(navigationHandler, undefined);
});
