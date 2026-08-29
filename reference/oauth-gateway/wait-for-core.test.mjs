import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { waitForTcpReady } from "./wait-for-core.mjs";

test("waits until the private core TCP listener is ready", async () => {
  const reserve = net.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const address = reserve.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => reserve.close(resolve));

  const core = net.createServer();
  const delayedStart = setTimeout(() => core.listen(port, "127.0.0.1"), 120);
  await waitForTcpReady({ port, timeoutMs: 2_000, retryMs: 20 });
  clearTimeout(delayedStart);
  assert.equal(core.listening, true);
  await new Promise((resolve) => core.close(resolve));
});

test("fails boundedly when the private core never becomes ready", async () => {
  const connectImpl = () => {
    const socket = new net.Socket();
    queueMicrotask(() => socket.emit("error", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })));
    return socket;
  };
  await assert.rejects(
    waitForTcpReady({ timeoutMs: 60, retryMs: 10, connectImpl }),
    /private core readiness timed out: ECONNREFUSED/
  );
});
