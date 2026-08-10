import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const TX_TTL_MS = 10 * 60 * 1000;
const FIREBASE_WEB_SDK_VERSION = "12.16.0";
const TX_COOKIE = "mbm_oauth_tx";
const REQUIRED_SCOPE = "maps:use";
const OPTIONAL_SCOPE = "offline_access";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
const now = () => Date.now();
const form = (request) => request.text().then((body) => new URLSearchParams(body));

export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function constantEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...headers
    }
  });
}

function html(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function oauthError(code, description, status = 400) {
  return json(status, { error: code, error_description: description });
}

function parseScopes(value) {
  const scopes = [...new Set((value || REQUIRED_SCOPE).split(/\s+/).filter(Boolean))];
  if (!scopes.includes(REQUIRED_SCOPE)) throw new Error("missing_required_scope");
  if (scopes.some((scope) => scope !== REQUIRED_SCOPE && scope !== OPTIONAL_SCOPE)) throw new Error("unsupported_scope");
  return scopes;
}

function safeBaseUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error("MCP_PUBLIC_BASE_URL must be an origin URL");
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("MCP_PUBLIC_BASE_URL must use HTTPS except for loopback development");
  }
  return url.origin;
}

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Firebase auth`);
  return value;
}

function readConfig() {
  const baseUrl = safeBaseUrl(env("MCP_PUBLIC_BASE_URL"));
  const clientSecret = env("MCP_OAUTH_CLIENT_SECRET");
  if (clientSecret.length < 32 || /\s/.test(clientSecret)) throw new Error("MCP_OAUTH_CLIENT_SECRET must be at least 32 non-whitespace characters");
  const redirectUris = env("MCP_OAUTH_REDIRECT_URIS").split(",").map((value) => new URL(value.trim()).toString());
  return {
    baseUrl,
    resource: `${baseUrl}/mcp`,
    projectId: env("MCP_FIREBASE_PROJECT_ID"),
    allowedUid: env("MCP_FIREBASE_ALLOWED_UID"),
    webApiKey: env("MCP_FIREBASE_WEB_API_KEY"),
    authDomain: env("MCP_FIREBASE_AUTH_DOMAIN"),
    webAppId: env("MCP_FIREBASE_WEB_APP_ID"),
    clientId: env("MCP_OAUTH_CLIENT_ID"),
    clientSecret,
    redirectUris
  };
}

function bearer(header) {
  const match = /^Bearer +(\S+)$/i.exec(header || "");
  return match?.[1];
}

function clientAuthenticated(request, params, config) {
  const auth = request.headers.get("authorization") || "";
  if (/^Basic /i.test(auth)) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const split = decoded.indexOf(":");
      if (split < 0) return false;
      return constantEqual(decodeURIComponent(decoded.slice(0, split)), config.clientId) &&
        constantEqual(decodeURIComponent(decoded.slice(split + 1)), config.clientSecret);
    } catch { return false; }
  }
  return constantEqual(params.get("client_id") || "", config.clientId) &&
    constantEqual(params.get("client_secret") || "", config.clientSecret);
}

function metadata(config) {
  return {
    protectedResource: {
      resource: config.resource,
      authorization_servers: [config.baseUrl],
      scopes_supported: [REQUIRED_SCOPE],
      bearer_methods_supported: ["header"]
    },
    authorizationServer: {
      issuer: config.baseUrl,
      authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
      token_endpoint: `${config.baseUrl}/oauth/token`,
      scopes_supported: [REQUIRED_SCOPE, OPTIONAL_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      authorization_response_iss_parameter_supported: true
    }
  };
}

function loginPage(config) {
  const nonce = randomBytes(18).toString("base64url");
  const firebaseConfig = JSON.stringify({ apiKey: config.webApiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.webAppId }).replaceAll("<", "\\u003c");
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize maps-browser-mcp</title><style>body{font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.7rem 1rem}#status{margin-top:1rem}</style></head><body><h1>Authorize maps-browser-mcp</h1><p>Sign in with the single Firebase account allowed by this server.</p><button id="login">Continue with Google</button><p id="status"></p><script type="module" nonce="${nonce}">import{initializeApp}from"https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-app.js";import{getAuth,GoogleAuthProvider,signInWithPopup}from"https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-auth.js";const app=initializeApp(${firebaseConfig});const auth=getAuth(app);const status=document.querySelector("#status");document.querySelector("#login").onclick=async()=>{try{status.textContent="Signing in…";const result=await signInWithPopup(auth,new GoogleAuthProvider());const idToken=await result.user.getIdToken();const response=await fetch("/oauth/firebase/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})});if(response.redirected){location.assign(response.url);return}if(!response.ok){status.textContent="Authorization failed.";return}const data=await response.json();location.assign(data.redirect)}catch{status.textContent="Authorization failed."}};</script></body></html>`;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' https://www.gstatic.com https://apis.google.com; connect-src https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com; frame-src https://accounts.google.com https://*.firebaseapp.com; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  return html(200, body, { "content-security-policy": csp, "referrer-policy": "no-referrer" });
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
}

export async function createAuthProvider() {
  const config = readConfig();
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: config.projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const m = metadata(config);
  const collections = {
    tx: db.collection("_mapsBrowserMcpOAuthTransactions"),
    codes: db.collection("_mapsBrowserMcpOAuthCodes"),
    access: db.collection("_mapsBrowserMcpOAuthAccessTokens"),
    refresh: db.collection("_mapsBrowserMcpOAuthRefreshTokens"),
    families: db.collection("_mapsBrowserMcpOAuthTokenFamilies")
  };

  async function authorize(request) {
    const token = bearer(request.headers.authorization);
    const challenge = `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource/mcp", scope="${REQUIRED_SCOPE}"`;
    if (!token) return { allowed: false, status: 401, code: "invalid_token", headers: { "www-authenticate": challenge } };
    const doc = await collections.access.doc(sha256(token)).get();
    if (!doc.exists) return { allowed: false, status: 401, code: "invalid_token", headers: { "www-authenticate": challenge } };
    const data = doc.data();
    if (!data || data.expiresAt <= now() || data.resource !== config.resource || data.uid !== config.allowedUid || !data.scopes?.includes(REQUIRED_SCOPE)) {
      return { allowed: false, status: 401, code: "invalid_token", headers: { "www-authenticate": challenge } };
    }
    if (data.familyId) {
      const family = await collections.families.doc(data.familyId).get();
      if (!family.exists || family.data()?.revokedAt) return { allowed: false, status: 401, code: "invalid_token", headers: { "www-authenticate": challenge } };
    }
    return { allowed: true, principal: { subject: data.uid } };
  }

  async function startAuthorization(request) {
    if (request.method !== "GET") return oauthError("invalid_request", "GET required", 405);
    const url = new URL(request.url);
    const q = url.searchParams;
    if (q.get("response_type") !== "code" || q.get("client_id") !== config.clientId) return oauthError("invalid_request", "unsupported authorization request");
    const redirectUri = q.get("redirect_uri") || "";
    if (!config.redirectUris.includes(new URL(redirectUri).toString())) return oauthError("invalid_request", "redirect_uri is not registered");
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get("code_challenge") || "")) return oauthError("invalid_request", "PKCE S256 is required");
    if (q.get("resource") !== config.resource) return oauthError("invalid_target", "resource must identify this MCP server");
    let scopes;
    try { scopes = parseScopes(q.get("scope") || REQUIRED_SCOPE); } catch { return oauthError("invalid_scope", "unsupported scope"); }
    const txId = randomToken();
    await collections.tx.doc(sha256(txId)).set({ clientId: config.clientId, redirectUri, state: q.get("state") || "", codeChallenge: q.get("code_challenge"), scopes, resource: config.resource, expiresAt: now() + TX_TTL_MS });
    const response = loginPage(config);
    response.headers.set("set-cookie", `${TX_COOKIE}=${txId}; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=600`);
    return response;
  }

  async function completeAuthorization(request) {
    if (request.method !== "POST") return oauthError("invalid_request", "POST required", 405);
    const txId = cookieValue(request, TX_COOKIE);
    if (!txId) return oauthError("invalid_request", "authorization transaction missing");
    let body;
    try { body = await request.json(); } catch { return oauthError("invalid_request", "invalid JSON"); }
    if (typeof body?.idToken !== "string") return oauthError("invalid_request", "Firebase ID token missing");
    const decoded = await auth.verifyIdToken(body.idToken, true).catch(() => null);
    if (!decoded || decoded.uid !== config.allowedUid) return oauthError("access_denied", "account is not allowed", 403);
    const code = randomToken();
    const result = await db.runTransaction(async (transaction) => {
      const ref = collections.tx.doc(sha256(txId));
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.expiresAt <= now()) return null;
      transaction.delete(ref);
      transaction.create(collections.codes.doc(sha256(code)), { ...data, uid: decoded.uid, expiresAt: now() + CODE_TTL_MS, usedAt: null });
      return data;
    });
    if (!result) return oauthError("invalid_request", "authorization transaction expired");
    const redirect = new URL(result.redirectUri);
    redirect.searchParams.set("code", code);
    if (result.state) redirect.searchParams.set("state", result.state);
    redirect.searchParams.set("iss", config.baseUrl);
    const response = json(200, { redirect: redirect.toString() });
    response.headers.set("set-cookie", `${TX_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=0`);
    return response;
  }

  async function issueFromCode(params) {
    const code = params.get("code") || "";
    const verifier = params.get("code_verifier") || "";
    const redirectUri = params.get("redirect_uri") || "";
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || params.get("resource") !== config.resource) return oauthError("invalid_grant", "invalid authorization code request");
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const familyId = randomToken();
    const outcome = await db.runTransaction(async (transaction) => {
      const codeRef = collections.codes.doc(sha256(code));
      const snapshot = await transaction.get(codeRef);
      const data = snapshot.data();
      if (!data || data.usedAt || data.expiresAt <= now() || data.clientId !== config.clientId || data.redirectUri !== redirectUri || data.resource !== config.resource || !constantEqual(pkceChallenge(verifier), data.codeChallenge)) return null;
      transaction.update(codeRef, { usedAt: now() });
      transaction.create(collections.families.doc(familyId), { uid: data.uid, clientId: config.clientId, createdAt: now(), revokedAt: null });
      transaction.create(collections.access.doc(sha256(accessToken)), { uid: data.uid, clientId: config.clientId, resource: config.resource, scopes: data.scopes, familyId, expiresAt: now() + ACCESS_TTL_MS });
      if (data.scopes.includes(OPTIONAL_SCOPE)) transaction.create(collections.refresh.doc(sha256(refreshToken)), { uid: data.uid, clientId: config.clientId, resource: config.resource, scopes: data.scopes, familyId, generation: 0, expiresAt: now() + REFRESH_TTL_MS, usedAt: null });
      return data;
    });
    if (!outcome) return oauthError("invalid_grant", "authorization code is invalid or expired");
    return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, ...(outcome.scopes.includes(OPTIONAL_SCOPE) ? { refresh_token: refreshToken } : {}), scope: outcome.scopes.join(" ") });
  }

  async function issueFromRefresh(params) {
    const refreshToken = params.get("refresh_token") || "";
    if (!refreshToken || params.get("resource") !== config.resource) return oauthError("invalid_grant", "invalid refresh request");
    const nextAccess = randomToken();
    const nextRefresh = randomToken();
    const result = await db.runTransaction(async (transaction) => {
      const ref = collections.refresh.doc(sha256(refreshToken));
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || data.expiresAt <= now() || data.clientId !== config.clientId || data.resource !== config.resource) return { status: "invalid" };
      const familyRef = collections.families.doc(data.familyId);
      const familySnapshot = await transaction.get(familyRef);
      if (!familySnapshot.exists || familySnapshot.data()?.revokedAt) return { status: "invalid" };
      if (data.usedAt) {
        transaction.update(familyRef, { revokedAt: now(), revokeReason: "refresh_reuse" });
        return { status: "reused" };
      }
      transaction.update(ref, { usedAt: now() });
      transaction.create(collections.access.doc(sha256(nextAccess)), { uid: data.uid, clientId: config.clientId, resource: config.resource, scopes: data.scopes, familyId: data.familyId, expiresAt: now() + ACCESS_TTL_MS });
      transaction.create(collections.refresh.doc(sha256(nextRefresh)), { ...data, generation: (data.generation || 0) + 1, expiresAt: now() + REFRESH_TTL_MS, usedAt: null });
      return { status: "ok", scopes: data.scopes };
    });
    if (result.status !== "ok") return oauthError("invalid_grant", result.status === "reused" ? "refresh token reuse revoked the token family" : "refresh token is invalid or expired");
    return json(200, { access_token: nextAccess, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: nextRefresh, scope: result.scopes.join(" ") });
  }

  async function token(request) {
    if (request.method !== "POST") return oauthError("invalid_request", "POST required", 405);
    const params = await form(request);
    if (!clientAuthenticated(request, params, config)) return oauthError("invalid_client", "client authentication failed", 401);
    if (params.get("grant_type") === "authorization_code") return issueFromCode(params);
    if (params.get("grant_type") === "refresh_token") return issueFromRefresh(params);
    return oauthError("unsupported_grant_type", "grant type is not supported");
  }

  const routes = new Set(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/oauth/authorize", "/oauth/firebase/complete", "/oauth/token"]);
  return {
    kind: "firebase-oauth-single-user",
    authorize,
    handlesPath: (pathname) => routes.has(pathname),
    async handle(request) {
      const path = new URL(request.url).pathname;
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") return json(200, m.protectedResource);
      if (path === "/.well-known/oauth-authorization-server") return json(200, m.authorizationServer);
      if (path === "/oauth/authorize") return startAuthorization(request);
      if (path === "/oauth/firebase/complete") return completeAuthorization(request);
      if (path === "/oauth/token") return token(request);
      return json(404, { error: "not_found" });
    }
  };
}
