import { request as httpRequest, STATUS_CODES } from "node:http";
import { request as httpsRequest } from "node:https";

const MCP_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-method",
  "mcp-name",
  "mcp-session-id",
  "last-event-id",
  "user-agent"
]);

const MCP_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "mcp-session-id",
  "retry-after"
]);

const TAKEOVER_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "content-length",
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-mcp-handoff-fallback",
  "x-mcp-takeover-capability",
  "x-mcp-takeover-reconnect",
  "x-takeover-client",
  "x-takeover-native-client"
]);


const TAKEOVER_UPGRADE_REQUEST_HEADERS = new Set([
  "origin",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "user-agent"
]);

const TAKEOVER_UPGRADE_RESPONSE_HEADERS = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-protocol",
  "upgrade"
]);

const TAKEOVER_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-security-policy",
  "content-type",
  "permissions-policy",
  "pragma",
  "referrer-policy",
  "x-content-type-options",
  "x-takeover-height",
  "x-takeover-host",
  "x-takeover-stream",
  "x-takeover-width"
]);

export function safeCoreUrl(raw) {
  const url = new URL(raw);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/mcp") {
    throw new Error("MCP_CORE_URL must be an exact /mcp URL without credentials, query, or fragment");
  }
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("MCP_CORE_URL must use HTTPS except for loopback development");
  }
  return url.toString();
}

export function assertPrivateBearer(value) {
  const token = value?.trim() || "";
  if (token.length < 24 || /\s/.test(token)) {
    throw new Error("MCP_CORE_BEARER_TOKEN must be at least 24 non-whitespace characters");
  }
  return token;
}

function copyHeaders(source, allowlist) {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (allowlist.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

export function buildCoreRequestHeaders(publicHeaders, privateBearer) {
  const headers = copyHeaders(publicHeaders, MCP_REQUEST_HEADERS);
  headers.set("authorization", `Bearer ${privateBearer}`);
  return headers;
}

export function buildPublicResponseHeaders(coreHeaders) {
  return copyHeaders(coreHeaders, MCP_RESPONSE_HEADERS);
}

export function buildTakeoverCoreRequestHeaders(publicHeaders, privateBearer) {
  const headers = copyHeaders(publicHeaders, TAKEOVER_REQUEST_HEADERS);
  headers.set("authorization", `Bearer ${privateBearer}`);
  return headers;
}

export function buildTakeoverPublicResponseHeaders(coreHeaders) {
  return copyHeaders(coreHeaders, TAKEOVER_RESPONSE_HEADERS);
}

export function buildTakeoverCoreUpgradeHeaders(publicHeaders, privateBearer) {
  const headers = copyHeaders(publicHeaders, TAKEOVER_UPGRADE_REQUEST_HEADERS);
  headers.set("authorization", `Bearer ${privateBearer}`);
  headers.set("connection", "Upgrade");
  headers.set("upgrade", "websocket");
  return headers;
}

function upgradeResponseHead(response) {
  const statusCode = response.statusCode === 101 ? 101 : 502;
  const statusText = statusCode === 101 ? "Switching Protocols" : (STATUS_CODES[statusCode] || "Bad Gateway");
  const lines = [`HTTP/1.1 ${statusCode} ${statusText}`];
  if (statusCode === 101) {
    for (const [name, value] of Object.entries(response.headers)) {
      if (!TAKEOVER_UPGRADE_RESPONSE_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
    }
  } else {
    lines.push("Connection: close", "Cache-Control: no-store", "Content-Length: 0");
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function rejectUpgradeSocket(socket, statusCode) {
  if (socket.destroyed) return;
  const bounded = [400, 401, 403, 404, 405, 502].includes(statusCode) ? statusCode : 502;
  socket.end(
    `HTTP/1.1 ${bounded} ${STATUS_CODES[bounded] || "Bad Gateway"}\r\n`
    + "Connection: close\r\n"
    + "Cache-Control: no-store\r\n"
    + "Content-Length: 0\r\n\r\n"
  );
}

export function proxyTakeoverUpgrade(
  req,
  socket,
  head,
  { coreUrl, privateBearer, publicBaseUrl }
) {
  if ((req.method || "GET").toUpperCase() !== "GET" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    rejectUpgradeSocket(socket, 400);
    return;
  }

  let target;
  try {
    const publicUrl = new URL(req.url || "/", publicBaseUrl);
    target = new URL(takeoverCoreUrl(coreUrl, publicUrl));
  } catch {
    rejectUpgradeSocket(socket, 404);
    return;
  }

  const publicHeaders = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) publicHeaders.append(name, item);
    else if (value !== undefined) publicHeaders.set(name, value);
  }
  const headers = buildTakeoverCoreUpgradeHeaders(publicHeaders, privateBearer);
  const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstreamRequest = requestImpl(target, {
    method: "GET",
    headers: Object.fromEntries(headers.entries()),
    agent: false
  });

  upstreamRequest.once("upgrade", (response, upstreamSocket, upstreamHead) => {
    if (response.statusCode !== 101) {
      upstreamSocket.destroy();
      rejectUpgradeSocket(socket, 502);
      return;
    }
    socket.write(upgradeResponseHead(response));
    if (head?.length) upstreamSocket.write(head);
    if (upstreamHead?.length) socket.write(upstreamHead);
    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
    const closePeer = () => {
      if (!socket.destroyed) socket.destroy();
      if (!upstreamSocket.destroyed) upstreamSocket.destroy();
    };
    socket.once("error", closePeer);
    upstreamSocket.once("error", closePeer);
  });
  upstreamRequest.once("response", (response) => {
    response.resume();
    rejectUpgradeSocket(socket, response.statusCode === 401 || response.statusCode === 403 ? 502 : response.statusCode);
  });
  upstreamRequest.once("error", () => rejectUpgradeSocket(socket, 502));
  upstreamRequest.end();
}

export function takeoverCoreUrl(coreUrl, publicRequestUrl) {
  const core = new URL(safeCoreUrl(coreUrl));
  const requestUrl = new URL(publicRequestUrl);
  if (!requestUrl.pathname.startsWith("/takeover/") || requestUrl.search || requestUrl.hash) {
    throw new Error("takeover proxy path must be an exact /takeover/* path without query or fragment");
  }
  core.pathname = requestUrl.pathname;
  core.search = "";
  core.hash = "";
  return core.toString();
}

function gatewayJson(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function proxyMcpRequest(request, { coreUrl, privateBearer, fetchImpl = fetch }) {
  const method = request.method.toUpperCase();
  if (!["GET", "POST", "DELETE"].includes(method)) {
    return gatewayJson(405, "method_not_allowed");
  }

  const init = {
    method,
    headers: buildCoreRequestHeaders(request.headers, privateBearer),
    redirect: "manual",
    signal: request.signal
  };
  if (method === "POST") {
    init.body = request.body;
    init.duplex = "half";
  }

  let response;
  try {
    response = await fetchImpl(coreUrl, init);
  } catch {
    return gatewayJson(502, "core_unavailable");
  }

  if (response.status === 401 || response.status === 403) {
    return gatewayJson(502, "core_auth_failed");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildPublicResponseHeaders(response.headers)
  });
}

export async function proxyTakeoverRequest(request, { coreUrl, privateBearer, fetchImpl = fetch }) {
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD", "POST"].includes(method)) {
    return gatewayJson(405, "method_not_allowed");
  }

  let target;
  try {
    target = takeoverCoreUrl(coreUrl, request.url);
  } catch {
    return gatewayJson(404, "not_found");
  }

  const init = {
    method,
    headers: buildTakeoverCoreRequestHeaders(request.headers, privateBearer),
    redirect: "manual",
    signal: request.signal
  };
  if (method === "POST") {
    init.body = request.body;
    init.duplex = "half";
  }

  let response;
  try {
    response = await fetchImpl(target, init);
  } catch {
    return gatewayJson(502, "core_unavailable");
  }

  if (response.status === 401 || response.status === 403) {
    return gatewayJson(502, "core_auth_failed");
  }

  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildTakeoverPublicResponseHeaders(response.headers)
  });
}
