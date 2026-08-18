import { createHash, randomBytes } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  loadCimdClient,
  parseAllowedClientHosts,
  verifyCimdPrivateKeyJwt
} from "./cimd.mjs";
import { signOAuthTransaction, verifyOAuthTransaction } from "./oauth-state.mjs";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const TX_TTL_MS = 10 * 60 * 1000;
const FIREBASE_WEB_SDK_VERSION = "12.17.1";
const TX_COOKIE = "mbm_ref_oauth_tx";
const REQUIRED_SCOPE = "maps:use";
const OPTIONAL_SCOPE = "offline_access";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
const now = () => Date.now();
const timestamp = (value) => Timestamp.fromMillis(value);
const millis = (value) => typeof value?.toMillis === "function" ? value.toMillis() : Number(value || 0);
const OAUTH_BODY_MAX_BYTES = 64 * 1024;

export async function readBoundedText(request, maxBytes = OAUTH_BODY_MAX_BYTES) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) throw new Error("oauth_request_too_large");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("oauth_request_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

const form = async (request) => new URLSearchParams(await readBoundedText(request));

export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
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

function oauthError(code, description, status = 400, headers = {}) {
  return json(status, { error: code, error_description: description }, headers);
}

function parseScopes(value) {
  const scopes = [...new Set((value || REQUIRED_SCOPE).split(/\s+/).filter(Boolean))];
  if (!scopes.includes(REQUIRED_SCOPE)) throw new Error("missing_required_scope");
  if (scopes.some((scope) => scope !== REQUIRED_SCOPE && scope !== OPTIONAL_SCOPE)) throw new Error("unsupported_scope");
  return scopes;
}

function narrowedRefreshScopes(raw, original) {
  if (!raw) return original;
  const requested = parseScopes(raw);
  if (requested.some((scope) => !original.includes(scope))) throw new Error("scope_escalation");
  return requested;
}

function safeBaseUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("MCP_PUBLIC_BASE_URL must be an origin URL without a path, query, or fragment");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("MCP_PUBLIC_BASE_URL must use HTTPS except for loopback development");
  }
  return url.origin;
}

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the OAuth gateway`);
  return value;
}

function envInt(name, fallback, min, max) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function readConfig() {
  const baseUrl = safeBaseUrl(env("MCP_PUBLIC_BASE_URL"));
  const transactionSecret = env("MCP_OAUTH_TRANSACTION_SECRET");
  if (Buffer.byteLength(transactionSecret, "utf8") < 32 || /\s/.test(transactionSecret)) {
    throw new Error("MCP_OAUTH_TRANSACTION_SECRET must be at least 32 non-whitespace bytes");
  }
  return {
    baseUrl,
    resource: `${baseUrl}/mcp`,
    tokenEndpoint: `${baseUrl}/oauth/token`,
    allowedClientHosts: parseAllowedClientHosts(env("MCP_OAUTH_ALLOWED_CLIENT_HOSTS")),
    transactionSecret,
    maxAuthRequestsPerMinute: envInt("MCP_OAUTH_MAX_REQUESTS_PER_MINUTE", 60, 10, 600),
    projectId: env("MCP_FIREBASE_PROJECT_ID"),
    allowedUid: env("MCP_FIREBASE_ALLOWED_UID"),
    webApiKey: env("MCP_FIREBASE_WEB_API_KEY"),
    authDomain: env("MCP_FIREBASE_AUTH_DOMAIN"),
    webAppId: env("MCP_FIREBASE_WEB_APP_ID")
  };
}

function bearer(header) {
  const match = /^Bearer +(\S+)$/i.exec(header || "");
  return match?.[1];
}

export function bearerFromRequest(request) {
  return bearer(request.headers.get("authorization"));
}

export function buildMetadata(config) {
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
      token_endpoint: config.tokenEndpoint,
      scopes_supported: [REQUIRED_SCOPE, OPTIONAL_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true
    }
  };
}

function loginPage(config) {
  const nonce = randomBytes(18).toString("base64url");
  const firebaseConfig = JSON.stringify({
    apiKey: config.webApiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.webAppId
  }).replaceAll("<", "\\u003c");
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize maps-browser-mcp</title><style>body{font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.7rem 1rem}#status{margin-top:1rem}</style></head><body><h1>Authorize maps-browser-mcp</h1><p>Sign in with the single Firebase account allowed by this server.</p><button id="login">Continue with Google</button><p id="status"></p><script type="module" nonce="${nonce}">import{initializeApp}from"https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-app.js";import{getAuth,GoogleAuthProvider,signInWithPopup}from"https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-auth.js";const app=initializeApp(${firebaseConfig});const auth=getAuth(app);const status=document.querySelector("#status");document.querySelector("#login").onclick=async()=>{try{status.textContent="Signing in…";const result=await signInWithPopup(auth,new GoogleAuthProvider());const idToken=await result.user.getIdToken();const response=await fetch("/oauth/firebase/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})});if(!response.ok){status.textContent="Authorization failed.";return}const data=await response.json();location.assign(data.redirect)}catch{status.textContent="Authorization failed."}};</script></body></html>`;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' https://www.gstatic.com https://apis.google.com; connect-src https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com; frame-src https://accounts.google.com https://*.firebaseapp.com; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  return html(200, body, { "content-security-policy": csp, "referrer-policy": "no-referrer" });
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
}

function createGlobalRateLimiter(limit) {
  const accepted = [];
  return () => {
    const cutoff = now() - 60_000;
    while (accepted.length && accepted[0] <= cutoff) accepted.shift();
    if (accepted.length >= limit) return false;
    accepted.push(now());
    return true;
  };
}

export async function createOAuthBoundary() {
  const config = readConfig();
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: config.projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const m = buildMetadata(config);
  const allowAuthRequest = createGlobalRateLimiter(config.maxAuthRequestsPerMinute);
  const collections = {
    codes: db.collection("_mapsBrowserMcpRefOAuthCodes"),
    access: db.collection("_mapsBrowserMcpRefOAuthAccessTokens"),
    refresh: db.collection("_mapsBrowserMcpRefOAuthRefreshTokens"),
    families: db.collection("_mapsBrowserMcpRefOAuthTokenFamilies"),
    assertions: db.collection("_mapsBrowserMcpRefOAuthClientAssertions")
  };

  async function authorize(request) {
    const token = bearerFromRequest(request);
    const challenge = `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource/mcp", scope="${REQUIRED_SCOPE}"`;
    if (!token) return { allowed: false, status: 401, code: "invalid_token", headers: { "www-authenticate": challenge } };
    const doc = await collections.access.doc(sha256(token)).get();
    if (!doc.exists) return { allowed: false, status: 401, code: "invalid_token", headers: { "www-authenticate": challenge } };
    const data = doc.data();
    if (!data || millis(data.expiresAt) <= now() || data.resource !== config.resource || data.uid !== config.allowedUid || !data.scopes?.includes(REQUIRED_SCOPE)) {
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
    const q = new URL(request.url).searchParams;
    const clientId = q.get("client_id") || "";
    const state = q.get("state") || "";
    if (q.get("response_type") !== "code" || !clientId || clientId.length > 2048 || state.length > 512) {
      return oauthError("invalid_request", "unsupported authorization request");
    }
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get("code_challenge") || "")) {
      return oauthError("invalid_request", "PKCE S256 is required");
    }
    if (q.get("resource") !== config.resource) return oauthError("invalid_target", "resource must identify this MCP server");
    let scopes;
    try { scopes = parseScopes(q.get("scope") || REQUIRED_SCOPE); }
    catch { return oauthError("invalid_scope", "unsupported scope"); }
    let client;
    try { client = await loadCimdClient(clientId, config.allowedClientHosts); }
    catch { return oauthError("invalid_client", "client metadata could not be validated"); }
    const redirectUri = q.get("redirect_uri") || "";
    let normalizedRedirect;
    try { normalizedRedirect = new URL(redirectUri).toString(); }
    catch { return oauthError("invalid_request", "redirect_uri is invalid"); }
    if (!client.redirectUris.includes(normalizedRedirect)) return oauthError("invalid_request", "redirect_uri is not registered by client metadata");
    let signedTransaction;
    try {
      signedTransaction = signOAuthTransaction({
        clientId: client.clientId,
        redirectUri: normalizedRedirect,
        state,
        codeChallenge: q.get("code_challenge"),
        scopes,
        resource: config.resource,
        expiresAt: now() + TX_TTL_MS
      }, config.transactionSecret);
    } catch {
      return oauthError("invalid_request", "authorization request is too large");
    }
    const response = loginPage(config);
    response.headers.set("set-cookie", `${TX_COOKIE}=${signedTransaction}; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=600`);
    return response;
  }

  async function completeAuthorization(request) {
    if (request.method !== "POST") return oauthError("invalid_request", "POST required", 405);
    const origin = request.headers.get("origin");
    if (origin && origin !== config.baseUrl) return oauthError("invalid_request", "invalid origin", 403);
    const cookie = cookieValue(request, TX_COOKIE);
    let tx;
    try { tx = verifyOAuthTransaction(cookie, config.transactionSecret); }
    catch { return oauthError("invalid_request", "authorization transaction missing or invalid"); }
    if (millis(tx.expiresAt) <= now() || tx.resource !== config.resource || typeof tx.clientId !== "string" || typeof tx.redirectUri !== "string" || typeof tx.codeChallenge !== "string" || !Array.isArray(tx.scopes)) {
      return oauthError("invalid_request", "authorization transaction expired or invalid");
    }
    let body;
    try { body = JSON.parse(await readBoundedText(request)); } catch { return oauthError("invalid_request", "invalid JSON"); }
    if (typeof body?.idToken !== "string" || body.idToken.length > 16_384) return oauthError("invalid_request", "Firebase ID token missing");
    const decoded = await auth.verifyIdToken(body.idToken, true).catch(() => null);
    if (!decoded || decoded.uid !== config.allowedUid) return oauthError("access_denied", "account is not allowed", 403);
    const code = randomToken();
    await collections.codes.doc(sha256(code)).create({
      ...tx,
      uid: decoded.uid,
      expiresAt: timestamp(now() + CODE_TTL_MS),
      usedAt: null
    });
    const redirect = new URL(tx.redirectUri);
    redirect.searchParams.set("code", code);
    if (tx.state) redirect.searchParams.set("state", tx.state);
    redirect.searchParams.set("iss", config.baseUrl);
    const response = json(200, { redirect: redirect.toString() });
    response.headers.set("set-cookie", `${TX_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=0`);
    return response;
  }

  async function consumeClientAssertion(assertion) {
    const key = sha256(`${assertion.client.clientId}\u0000${assertion.jti}`);
    const ref = collections.assertions.doc(key);
    const accepted = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists && millis(snapshot.data()?.expiresAt) > now()) return false;
      transaction.set(ref, {
        clientId: assertion.client.clientId,
        expiresAt: timestamp(assertion.expiresAt),
        consumedAt: timestamp(now())
      });
      return true;
    });
    if (!accepted) throw new Error("client_assertion_replay");
  }

  async function issueFromCode(params, client) {
    const code = params.get("code") || "";
    const verifier = params.get("code_verifier") || "";
    const redirectUri = params.get("redirect_uri") || "";
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || params.get("resource") !== config.resource) {
      return oauthError("invalid_grant", "invalid authorization code request");
    }
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const familyId = randomToken();
    const outcome = await db.runTransaction(async (transaction) => {
      const codeRef = collections.codes.doc(sha256(code));
      const snapshot = await transaction.get(codeRef);
      const data = snapshot.data();
      if (!data || data.usedAt || millis(data.expiresAt) <= now() || data.clientId !== client.clientId || data.redirectUri !== redirectUri || data.resource !== config.resource || pkceChallenge(verifier) !== data.codeChallenge) {
        return null;
      }
      const familyExpiresAt = now() + (data.scopes.includes(OPTIONAL_SCOPE) ? REFRESH_TTL_MS : ACCESS_TTL_MS);
      transaction.update(codeRef, { usedAt: timestamp(now()) });
      transaction.create(collections.families.doc(familyId), {
        uid: data.uid,
        clientId: client.clientId,
        createdAt: timestamp(now()),
        expiresAt: timestamp(familyExpiresAt),
        revokedAt: null
      });
      transaction.create(collections.access.doc(sha256(accessToken)), {
        uid: data.uid,
        clientId: client.clientId,
        resource: config.resource,
        scopes: data.scopes,
        familyId,
        expiresAt: timestamp(now() + ACCESS_TTL_MS)
      });
      if (data.scopes.includes(OPTIONAL_SCOPE)) {
        transaction.create(collections.refresh.doc(sha256(refreshToken)), {
          uid: data.uid,
          clientId: client.clientId,
          resource: config.resource,
          scopes: data.scopes,
          familyId,
          generation: 0,
          expiresAt: timestamp(now() + REFRESH_TTL_MS),
          usedAt: null
        });
      }
      return data;
    });
    if (!outcome) return oauthError("invalid_grant", "authorization code is invalid or expired");
    return json(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_MS / 1000,
      ...(outcome.scopes.includes(OPTIONAL_SCOPE) ? { refresh_token: refreshToken } : {}),
      scope: outcome.scopes.join(" ")
    });
  }

  async function issueFromRefresh(params, client) {
    const refreshToken = params.get("refresh_token") || "";
    if (!refreshToken || params.get("resource") !== config.resource) return oauthError("invalid_grant", "invalid refresh request");
    const nextAccess = randomToken();
    const nextRefresh = randomToken();
    const result = await db.runTransaction(async (transaction) => {
      const ref = collections.refresh.doc(sha256(refreshToken));
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data || millis(data.expiresAt) <= now() || data.clientId !== client.clientId || data.resource !== config.resource) return { status: "invalid" };
      const familyRef = collections.families.doc(data.familyId);
      const familySnapshot = await transaction.get(familyRef);
      if (!familySnapshot.exists || familySnapshot.data()?.revokedAt) return { status: "invalid" };
      if (data.usedAt) {
        transaction.update(familyRef, { revokedAt: timestamp(now()), revokeReason: "refresh_reuse" });
        return { status: "reused" };
      }
      let scopes;
      try { scopes = narrowedRefreshScopes(params.get("scope"), data.scopes); }
      catch { return { status: "scope" }; }
      const refreshExpiresAt = now() + REFRESH_TTL_MS;
      transaction.update(ref, { usedAt: timestamp(now()) });
      transaction.update(familyRef, { expiresAt: timestamp(refreshExpiresAt) });
      transaction.create(collections.access.doc(sha256(nextAccess)), {
        uid: data.uid,
        clientId: client.clientId,
        resource: config.resource,
        scopes,
        familyId: data.familyId,
        expiresAt: timestamp(now() + ACCESS_TTL_MS)
      });
      transaction.create(collections.refresh.doc(sha256(nextRefresh)), {
        uid: data.uid,
        clientId: client.clientId,
        resource: config.resource,
        scopes,
        familyId: data.familyId,
        generation: (data.generation || 0) + 1,
        expiresAt: timestamp(refreshExpiresAt),
        usedAt: null
      });
      return { status: "ok", scopes };
    });
    if (result.status === "scope") return oauthError("invalid_scope", "refresh request cannot expand scope");
    if (result.status !== "ok") {
      return oauthError("invalid_grant", result.status === "reused" ? "refresh token reuse revoked the token family" : "refresh token is invalid or expired");
    }
    return json(200, {
      access_token: nextAccess,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: nextRefresh,
      scope: result.scopes.join(" ")
    });
  }

  async function token(request) {
    if (request.method !== "POST") return oauthError("invalid_request", "POST required", 405);
    const params = await form(request);
    let assertion;
    try {
      assertion = await verifyCimdPrivateKeyJwt(params, config.tokenEndpoint, config.allowedClientHosts);
      await consumeClientAssertion(assertion);
    } catch {
      return oauthError("invalid_client", "CIMD client authentication failed", 401);
    }
    if (params.get("grant_type") === "authorization_code") return issueFromCode(params, assertion.client);
    if (params.get("grant_type") === "refresh_token") return issueFromRefresh(params, assertion.client);
    return oauthError("unsupported_grant_type", "grant type is not supported");
  }

  const metadataRoutes = new Set([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server"
  ]);
  const authRoutes = new Set(["/oauth/authorize", "/oauth/firebase/complete", "/oauth/token"]);
  const routes = new Set([...metadataRoutes, ...authRoutes]);

  return {
    kind: "maps-reference-oauth-single-user-cimd",
    authorizePublicMcp: authorize,
    handlesPath: (pathname) => routes.has(pathname),
    async handle(request) {
      const path = new URL(request.url).pathname;
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") return json(200, m.protectedResource);
      if (path === "/.well-known/oauth-authorization-server") return json(200, m.authorizationServer);
      if (authRoutes.has(path) && !allowAuthRequest()) {
        return oauthError("temporarily_unavailable", "OAuth request rate limit exceeded", 429, { "retry-after": "60" });
      }
      if (path === "/oauth/authorize") return startAuthorization(request);
      if (path === "/oauth/firebase/complete") return completeAuthorization(request);
      if (path === "/oauth/token") return token(request);
      return json(404, { error: "not_found" });
    }
  };
}
