export class OperationQueueError extends Error {
  readonly code = "SERVER_BUSY" as const;

  constructor(message: string) {
    super(message);
    this.name = "OperationQueueError";
  }
}

export class OperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly maxPending: number) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error("maxPending must be a positive integer");
    }
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.pending >= this.maxPending) {
      throw new OperationQueueError(`Browser operation queue is full (${this.maxPending} pending)`);
    }

    this.pending += 1;
    const result = this.tail.then(task);
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
}
