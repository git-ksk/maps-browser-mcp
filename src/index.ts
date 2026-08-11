#!/usr/bin/env node

import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  buildServer,
  config,
  handleTakeoverHttpRequest,
  isTakeoverHttpPath,
  probeBrowserReady,
  shutdownRuntime
} from "./server.js";
import {
  bearerAllowed,
  hostAllowed,
  originAllowed,
  parseContentLength
} from "./http-security.js";

const BEARER_CHALLENGE = 'Bearer realm="maps-browser-mcp"';

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
    this.name = "HttpRequestError";
  }
}

function setPrivateResponseHeaders(res: ServerResponse): void {
  res.setHeader("cache-control", "no-store");
}

function reject(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  setPrivateResponseHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

function validateProbeMethod(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  res.setHeader("allow", "GET, HEAD");
  reject(res, 405, "method_not_allowed");
  return false;
}

function challengeBearer(res: ServerResponse): void {
  res.setHeader("www-authenticate", BEARER_CHALLENGE);
}

function validateTransportGuard(req: IncomingMessage, res: ServerResponse): boolean {
  if (bearerAllowed(req.headers.authorization, config.http.bearerToken)) return true;
  challengeBearer(res);
  reject(res, 401, "invalid_token");
  return false;
}

function writeProbeResponse(req: IncomingMessage, res: ServerResponse, status: number, payload: object): void {
  if (res.destroyed || res.writableEnded) return;
  setPrivateResponseHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(payload));
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
  setPrivateResponseHeaders(res);

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

function makeAbortController(req: IncomingMessage, res: ServerResponse): AbortController {
  const abortController = new AbortController();
  req.once("aborted", () => abortController.abort());
  res.once("close", () => {
    if (!res.writableEnded) abortController.abort();
  });
  return abortController;
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
      if (!validateProbeMethod(req, res)) return;
      writeProbeResponse(req, res, 200, { ok: true });
      return;
    }

    if (isTakeoverHttpPath(requestUrl.pathname)) {
      const abortController = makeAbortController(req, res);
      void (async () => {
        try {
          const request = await toWebRequest(req, abortController.signal);
          const response = await handleTakeoverHttpRequest(request);
          await writeWebResponse(response, res);
        } catch (error) {
          if (error instanceof HttpRequestError) {
            if (error.status === 413) res.setHeader("connection", "close");
            reject(res, error.status, error.code);
            return;
          }
          if (abortController.signal.aborted) return;
          console.error("[maps-browser-mcp] takeover broker HTTP error");
          reject(res, 500, "takeover_broker_error");
        }
      })();
      return;
    }

    if (requestUrl.pathname === "/readyz") {
      if (!validateProbeMethod(req, res)) return;
      if (!validateTransportGuard(req, res)) return;
      void probeBrowserReady()
        .then(() => writeProbeResponse(req, res, 200, { ok: true, browser: "ready" }))
        .catch((error) => {
          console.error("[maps-browser-mcp] Browser readiness probe failed", error);
          writeProbeResponse(req, res, 503, { ok: false, browser: "unavailable" });
        });
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
    if (!validateTransportGuard(req, res)) return;

    const abortController = makeAbortController(req, res);
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
  console.error(
    `[maps-browser-mcp] HTTP transport guard: ${config.http.bearerToken ? "static-bearer" : "none"}; built-in OAuth/OIDC: disabled`
  );
  console.error(
    `[maps-browser-mcp] Remote human takeover: ${config.takeover.enabled ? "enabled behind configured authenticated HTTPS gateway" : "disabled"}`
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
