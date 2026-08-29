import net from "node:net";

export async function waitForTcpReady({
  host = "127.0.0.1",
  port = 8081,
  timeoutMs = 30_000,
  retryMs = 100,
  connectImpl = net.connect
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = connectImpl({ host, port });
        const done = (error) => {
          socket.removeAllListeners();
          socket.destroy();
          error ? reject(error) : resolve();
        };
        socket.once("connect", () => done());
        socket.once("error", done);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  throw new Error(`private core readiness timed out${lastError instanceof Error ? `: ${lastError.code || lastError.message}` : ""}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await waitForTcpReady();
  console.error("[maps-oauth-gateway] private core is ready");
}
