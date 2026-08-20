import http from "node:http";
import { Readable } from "node:stream";
import { createOAuthBoundary } from "./oauth.mjs";
import { createTakeoverOperatorBoundary } from "./operator-auth.mjs";
import { assertPrivateBearer, proxyMcpRequest, proxyTakeoverRequest, safeCoreUrl } from "./proxy.mjs";

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function envBool(name, fallback = false) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean`);
}

function port() {
  const raw = process.env.PORT?.trim() || "8080";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("PORT must be between 1 and 65535");
  return value;
}

function requestFromNode(req) {
  const origin = env("MCP_PUBLIC_BASE_URL");
  const url = new URL(req.url || "/", origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const init = { method: req.method || "GET", headers };
  if (init.method !== "GET" && init.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}

function json(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function headResponse(response) {
  return new Response(null, { status: response.status, headers: response.headers });
}

const coreUrl = safeCoreUrl(env("MCP_CORE_URL"));
const privateBearer = assertPrivateBearer(env("MCP_CORE_BEARER_TOKEN"));
const oauth = await createOAuthBoundary();
const takeoverOperator = envBool("MAPS_REMOTE_TAKEOVER") ? createTakeoverOperatorBoundary() : undefined;

const server = http.createServer(async (req, res) => {
  try {
    const request = requestFromNode(req);
    const path = new URL(request.url).pathname;

    if (path === "/healthz" && request.method === "GET") {
      return await writeNodeResponse(res, new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      }));
    }

    if (oauth.handlesPath(path)) {
      return await writeNodeResponse(res, await oauth.handle(request));
    }

    if (path === "/mcp") {
      const decision = await oauth.authorizePublicMcp(request);
      if (!decision.allowed) {
        return await writeNodeResponse(res, new Response(JSON.stringify({ error: decision.code }), {
          status: decision.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...(decision.headers || {})
          }
        }));
      }
      return await writeNodeResponse(res, await proxyMcpRequest(request, { coreUrl, privateBearer }));
    }

    if (path === "/takeover/operator/session") {
      if (!takeoverOperator) return await writeNodeResponse(res, json(404, "not_found"));
      return await writeNodeResponse(res, await takeoverOperator.createSession(request));
    }

    if (path === takeoverOperator?.nativeAuthPath) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return await writeNodeResponse(res, json(405, "method_not_allowed"));
      }
      const response = takeoverOperator.isAuthorized(request)
        ? takeoverOperator.nativeAuthorizedPage()
        : takeoverOperator.nativeLoginPage();
      return await writeNodeResponse(res, request.method === "HEAD" ? headResponse(response) : response);
    }

    if (path.startsWith("/takeover/")) {
      if (!takeoverOperator) return await writeNodeResponse(res, json(404, "not_found"));
      if (!takeoverOperator.isAuthorized(request)) {
        const page = /^\/takeover\/[A-Za-z0-9-]{8,100}$/.test(path);
        if (page && (request.method === "GET" || request.method === "HEAD")) {
          const probe = await proxyTakeoverRequest(new Request(request.url, {
            method: "HEAD",
            headers: request.headers,
            signal: request.signal
          }), { coreUrl, privateBearer });
          if (probe.status !== 200) return await writeNodeResponse(res, probe);
          const response = takeoverOperator.loginPage();
          return await writeNodeResponse(res, request.method === "HEAD" ? headResponse(response) : response);
        }
        return await writeNodeResponse(res, json(401, "operator_auth_required"));
      }
      return await writeNodeResponse(res, await proxyTakeoverRequest(request, { coreUrl, privateBearer }));
    }

    return await writeNodeResponse(res, json(404, "not_found"));
  } catch (error) {
    console.error("[maps-oauth-gateway] request failed", error instanceof Error ? error.message : "unknown error");
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ error: "gateway_error" }));
  }
});

server.listen(port(), "0.0.0.0", () => {
  console.error(`[maps-oauth-gateway] listening on :${port()}`);
});
