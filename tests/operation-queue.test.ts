import assert from "node:assert/strict";
import test from "node:test";
import { OperationQueue, OperationQueueError } from "../src/operation-queue.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("serializes browser operations", async () => {
  const queue = new OperationQueue(4);
  const order: string[] = [];

  const first = queue.run(async () => {
    order.push("first:start");
    await sleep(30);
    order.push("first:end");
    return 1;
  });
  const second = queue.run(async () => {
    order.push("second:start");
    order.push("second:end");
    return 2;
  });

  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.getPendingCount(), 0);
});

test("rejects work when the pending queue is full", async () => {
  const queue = new OperationQueue(1);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = queue.run(async () => blocker);
  assert.throws(
    () => queue.run(async () => undefined),
    (error) => error instanceof OperationQueueError && error.code === "SERVER_BUSY"
  );
  release();
  await first;
  await queue.drain();
});

test("times out a hung operation, waits for reset, then continues the queue", async () => {
  const events: string[] = [];
  const queue = new OperationQueue(3, {
    timeoutMs: 25,
    onTimeout: async () => {
      events.push("reset:start");
      await sleep(15);
      events.push("reset:end");
    }
  });

  const never = new Promise<void>(() => undefined);
  const first = queue.run(async () => {
    events.push("first:start");
    await never;
  });
  const second = queue.run(async () => {
    events.push("second:start");
    return 2;
  });

  await assert.rejects(
    first,
    (error) => error instanceof OperationQueueError && error.code === "OPERATION_TIMEOUT"
  );
  assert.equal(await second, 2);
  assert.deepEqual(events, ["first:start", "reset:start", "reset:end", "second:start"]);
  await queue.drain();
  assert.equal(queue.getPendingCount(), 0);
});
