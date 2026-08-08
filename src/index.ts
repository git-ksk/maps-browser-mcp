#!/usr/bin/env node

import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer, config, shutdownRuntime } from "./server.js";
import {
  bearerAllowed,
  hostAllowed,
  originAllowed,
  parseContentLength
} from "./http-security.js";

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
    this.name = "HttpRequestError";
  }
}

function reject(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

async function readRequestBody(req: IncomingMessage): Promise<string | undefined> {
  try {
    parseContentLength(req.headers["content-length"], config.http.maxBodyBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "request_body_too_large") {
      throw new HttpRequestError(413, "request_body_too_large");
    }
    throw new HttpRequestError(400, "invalid_content_length");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > config.http.maxBodyBytes) {
      throw new HttpRequestError(413, "request_body_too_large");
    }
    chunks.push(buffer);
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

async function toWebRequest(req: IncomingMessage, signal: AbortSignal): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const body = await readRequestBody(req);
  return new Request(url, {
    method: req.method ?? "POST",
    headers: toWebHeaders(req),
    body,
    signal
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
      if (done || res.destroyed) break;
      if (value && !res.write(Buffer.from(value))) {
        await once(res, "drain");
      }
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  } finally {
    reader.releaseLock();
  }
}

async function startHttp(): Promise<void> {
  const mcpHandler = createMcpHandler(buildServer);
  const httpServer = createServer((req, res) => {
    if (!hostAllowed(req.headers.host, config.http.allowedHosts)) {
      reject(res, 403, "host_not_allowed");
      return;
    }

    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (requestUrl.pathname === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("allow", "GET, HEAD");
        reject(res, 405, "method_not_allowed");
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true }));
      return;
    }

    if (requestUrl.pathname !== "/mcp") {
      reject(res, 404, "not_found");
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      reject(res, 405, "method_not_allowed");
      return;
    }
    if (!originAllowed(req.headers.origin, config.http.allowedOrigins, config.http.allowedHosts)) {
      reject(res, 403, "origin_not_allowed");
      return;
    }
    if (!bearerAllowed(req.headers.authorization, config.http.bearerToken)) {
      res.setHeader("www-authenticate", "Bearer");
      reject(res, 401, "invalid_token");
      return;
    }

    const abortController = new AbortController();
    req.once("aborted", () => abortController.abort());
    res.once("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    void (async () => {
      try {
        const request = await toWebRequest(req, abortController.signal);
        const response = await mcpHandler.fetch(request);
        await writeWebResponse(response, res);
      } catch (error) {
        if (error instanceof HttpRequestError) {
          if (error.status === 413) res.setHeader("connection", "close");
          reject(res, error.status, error.code);
          return;
        }
        if (abortController.signal.aborted) return;
        console.error("[maps-browser-mcp] MCP HTTP error", error);
        reject(res, 500, "mcp_handler_error");
      }
    })();
  });

  httpServer.maxHeadersCount = 64;
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 30_000;
  httpServer.keepAliveTimeout = 5_000;

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
    httpServer.closeIdleConnections();
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
