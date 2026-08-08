export class OperationQueueError extends Error {
  constructor(
    readonly code: "SERVER_BUSY" | "OPERATION_TIMEOUT",
    message: string
  ) {
    super(message);
    this.name = "OperationQueueError";
  }
}

export class OperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly maxPending: number,
    private readonly options?: {
      timeoutMs?: number;
      onTimeout?: () => void | Promise<void>;
    }
  ) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error("maxPending must be a positive integer");
    }
    if (
      options?.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1)
    ) {
      throw new Error("timeoutMs must be a positive integer when configured");
    }
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.pending >= this.maxPending) {
      throw new OperationQueueError(
        "SERVER_BUSY",
        `Browser operation queue is full (${this.maxPending} pending)`
      );
    }

    this.pending += 1;
    const result = this.tail.then(() => this.runGuarded(task));
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    void result.finally(() => {
      this.pending -= 1;
    }).catch(() => undefined);
    return result;
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  getPendingCount(): number {
    return this.pending;
  }

  private async runGuarded<T>(task: () => Promise<T>): Promise<T> {
    const timeoutMs = this.options?.timeoutMs;
    if (timeoutMs === undefined) return task();

    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const taskPromise = Promise.resolve().then(task);

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        void Promise.resolve(this.options?.onTimeout?.())
          .catch(() => undefined)
          .finally(() => {
            reject(new OperationQueueError(
              "OPERATION_TIMEOUT",
              `Browser operation exceeded ${timeoutMs} ms and the browser session was reset`
            ));
          });
      }, timeoutMs);
    });

    try {
      return await Promise.race([taskPromise, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (timedOut) void taskPromise.catch(() => undefined);
    }
  }
}
