import type { EncodedImageFrame } from "./frame-pipeline.js";
import type { CaptureAdapter } from "./capture-adapter.js";

interface ScreencastFrameEvent {
  data: string;
  sessionId: number;
}

interface FrameNavigatedEvent {
  frame: {
    parentId?: string;
    url: string;
  };
}

export interface CdpScreencastPage {
  screencastFrame(listener: (event: ScreencastFrameEvent) => void): () => void;
  frameNavigated(listener: (event: FrameNavigatedEvent) => void): () => void;
  screencastFrameAck(input: { sessionId: number }): Promise<unknown>;
  startScreencast(input: {
    format: "jpeg";
    quality: number;
    maxWidth: number;
    maxHeight: number;
    everyNthFrame: number;
  }): Promise<unknown>;
  stopScreencast(): Promise<unknown>;
}

export interface CdpScreencastCaptureOptions {
  page: CdpScreencastPage;
  width: number;
  height: number;
  hostname: string;
  assertSurface(url: string): void;
  now?: () => number;
}

/** Phase 1 capture: CDP JPEG is kept encoded and latest-frame wins under backpressure. */
export class CdpScreencastCapture implements CaptureAdapter<EncodedImageFrame> {
  private readonly now: () => number;

  constructor(private readonly options: CdpScreencastCaptureOptions) {
    this.now = options.now ?? Date.now;
  }

  async *frames(signal: AbortSignal): AsyncIterable<EncodedImageFrame> {
    let hostname = this.options.hostname;
    let latest: EncodedImageFrame | undefined;
    let surfaceError: unknown;
    let wake: (() => void) | undefined;

    const notify = () => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };
    const onAbort = () => notify();
    signal.addEventListener("abort", onAbort, { once: true });

    const removeFrameListener = this.options.page.screencastFrame((frame) => {
      void this.options.page.screencastFrameAck({ sessionId: frame.sessionId }).catch(() => undefined);
      latest = {
        kind: "encoded_image",
        data: frame.data,
        width: this.options.width,
        height: this.options.height,
        hostname,
        mimeType: "image/jpeg",
        capturedAtMs: this.now()
      };
      notify();
    });
    const removeNavigationListener = this.options.page.frameNavigated((event) => {
      if (event.frame.parentId) return;
      try {
        this.options.assertSurface(event.frame.url);
        hostname = new URL(event.frame.url).hostname;
      } catch (error) {
        surfaceError = error;
      }
      notify();
    });

    let started = false;
    try {
      if (signal.aborted) return;
      await this.options.page.startScreencast({
        format: "jpeg",
        quality: 75,
        maxWidth: Math.min(this.options.width, 1_600),
        maxHeight: Math.min(this.options.height, 1_200),
        everyNthFrame: 1
      });
      started = true;
      while (!signal.aborted) {
        if (surfaceError) throw surfaceError;
        if (!latest) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (signal.aborted || surfaceError || latest) notify();
          });
          continue;
        }
        const frame = latest;
        latest = undefined;
        yield frame;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      removeFrameListener();
      removeNavigationListener();
      if (started) await this.options.page.stopScreencast().catch(() => undefined);
    }
  }
}
