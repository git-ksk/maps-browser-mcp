const REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
  "user-agent"
]);

const RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "mcp-session-id",
  "retry-after"
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

export function buildCoreRequestHeaders(publicHeaders, privateBearer) {
  const headers = new Headers();
  for (const [name, value] of publicHeaders) {
    if (REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${privateBearer}`);
  return headers;
}

export function buildPublicResponseHeaders(coreHeaders) {
  const headers = new Headers();
  for (const [name, value] of coreHeaders) {
    if (RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

export async function proxyMcpRequest(request, { coreUrl, privateBearer, fetchImpl = fetch }) {
  const method = request.method.toUpperCase();
  if (!["GET", "POST", "DELETE"].includes(method)) {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
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
    return new Response(JSON.stringify({ error: "core_unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  if (response.status === 401 || response.status === 403) {
    return new Response(JSON.stringify({ error: "core_auth_failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildPublicResponseHeaders(response.headers)
  });
}
