import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer, config, shutdownRuntime } from "./server.js";

function hostnameFromHostHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function requestHostAllowed(req: IncomingMessage): boolean {
  const hostname = hostnameFromHostHeader(req.headers.host);
  if (!hostname) return false;
  return config.http.allowedHosts.map((host) => host.toLowerCase()).includes(hostname);
}

function requestOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (config.http.allowedOrigins.length > 0) {
      return config.http.allowedOrigins.includes(parsed.origin);
    }
    return config.http.allowedHosts
      .map((host) => host.toLowerCase())
      .includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function bearerAllowed(req: IncomingMessage): boolean {
  const expected = config.http.bearerToken;
  if (!expected) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

async function readRequestBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks).toString("utf8");
}

function toWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) headers.append(name, value);
    } else {
      headers.set(name, rawValue);
    }
  }
  return headers;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const body = await readRequestBody(req);
  return new Request(url, {
    method: req.method ?? "GET",
    headers: toWebHeaders(req),
    body
  });
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => res.setHeader(name, value));

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

async function startHttp(): Promise<void> {
  const mcpHandler = createMcpHandler(buildServer);
  const httpServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");

    if (requestUrl.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (requestUrl.pathname !== "/mcp") {
      reject(res, 404, "not_found");
      return;
    }
    if (!requestHostAllowed(req)) {
      reject(res, 403, "host_not_allowed");
      return;
    }
    if (!requestOriginAllowed(req)) {
      reject(res, 403, "origin_not_allowed");
      return;
    }
    if (!bearerAllowed(req)) {
      res.setHeader("www-authenticate", "Bearer");
      reject(res, 401, "invalid_token");
      return;
    }

    void (async () => {
      try {
        const request = await toWebRequest(req);
        const response = await mcpHandler.fetch(request);
        await writeWebResponse(response, res);
      } catch (error) {
        console.error("[maps-browser-mcp] MCP HTTP error", error);
        if (!res.headersSent) reject(res, 500, "mcp_handler_error");
        else if (!res.writableEnded) res.end();
      }
    })();
  });

  await new Promise<void>((resolve, rejectPromise) => {
    httpServer.once("error", rejectPromise);
    httpServer.listen(config.http.port, config.http.host, () => resolve());
  });

  console.error(
    `[maps-browser-mcp] Streamable HTTP listening on http://${config.http.host}:${config.http.port}/mcp`
  );

  const shutdown = async () => {
    await mcpHandler.close().catch(() => undefined);
    await shutdownRuntime().catch(() => undefined);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

async function startStdio(): Promise<void> {
  process.once("SIGINT", () => void shutdownRuntime().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdownRuntime().finally(() => process.exit(0)));
  console.error("[maps-browser-mcp] serving over stdio");
  await serveStdio(buildServer);
}

if (process.argv.includes("--http")) {
  await startHttp();
} else {
  await startStdio();
}
