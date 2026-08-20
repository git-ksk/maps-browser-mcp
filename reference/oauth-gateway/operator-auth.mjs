import { createHmac, timingSafeEqual } from "node:crypto";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { accountMatchesDecodedToken, parseAllowedAccountConfig, readBoundedText } from "./oauth.mjs";

const COOKIE = "mbm_takeover_operator";
const MAX_BODY_BYTES = 20 * 1024;
const NATIVE_AUTH_PATH = "/takeover/operator/native-auth";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for remote takeover operator auth`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || undefined;
}

function baseUrl() {
  const url = new URL(required("MCP_PUBLIC_BASE_URL"));
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("MCP_PUBLIC_BASE_URL must be an origin URL");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("MCP_PUBLIC_BASE_URL must use HTTPS except for loopback development");
  }
  return url.origin;
}

function ttlSeconds() {
  const raw = process.env.MCP_TAKEOVER_OPERATOR_SESSION_SECONDS?.trim();
  const value = raw ? Number(raw) : 900;
  if (!Number.isInteger(value) || value < 60 || value > 3600) {
    throw new Error("MCP_TAKEOVER_OPERATOR_SESSION_SECONDS must be between 60 and 3600");
  }
  return value;
}

function cookieValue(request) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE) return rest.join("=");
  }
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueOperatorSession(accountBinding, expiresAt, secret) {
  const payload = Buffer.from(JSON.stringify({ v: 1, accountBinding, expiresAt }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyOperatorSession(token, accountBinding, secret, now = Date.now()) {
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token || "");
  if (!match) return false;
  const expected = Buffer.from(signature(match[1], secret), "utf8");
  const actual = Buffer.from(match[2], "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const body = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    return body?.v === 1 && body.accountBinding === accountBinding && Number.isFinite(body.expiresAt) && body.expiresAt > now;
  } catch {
    return false;
  }
}

function loginPage(webApiKey, secret, successPath) {
  const nonce = createHmac("sha256", secret).update(String(Date.now())).digest("base64url").slice(0, 24);
  const apiKey = JSON.stringify(webApiKey).replaceAll("<", "\\u003c");
  const destination = successPath ? JSON.stringify(successPath).replaceAll("<", "\\u003c") : "null";
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Human takeover</title><style nonce="${nonce}">body{font-family:system-ui;max-width:34rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:.9rem 0 .3rem}input{box-sizing:border-box;width:100%;font:inherit;padding:.65rem}button{font:inherit;margin-top:1rem;padding:.7rem 1rem}#status{margin-top:1rem}</style></head><body><h1>Authorize Human takeover</h1><p>Authenticate to the single-user operator boundary before opening the dedicated Human surface.</p><label>Email</label><input id="email" type="email" autocomplete="username"><label>Password</label><input id="password" type="password" autocomplete="current-password"><button id="login">Continue</button><p id="status"></p><script nonce="${nonce}">const apiKey=${apiKey},destination=${destination},s=document.querySelector('#status'),b=document.querySelector('#login');b.onclick=async()=>{b.disabled=true;s.textContent='Authorizing…';const e=document.querySelector('#email').value.trim(),p=document.querySelector('#password'),pw=p.value;try{const a=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,password:pw,returnSecureToken:true}),credentials:'omit',referrerPolicy:'no-referrer'});p.value='';if(!a.ok){s.textContent='Sign-in failed.';return}const j=await a.json(),r=await fetch('/takeover/operator/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:j.idToken}),credentials:'same-origin',referrerPolicy:'no-referrer'});if(!r.ok){s.textContent='Authorization failed.';return}if(destination){location.replace(destination)}else{location.reload()}}catch{p.value='';s.textContent='Authorization service unavailable.'}finally{b.disabled=false}};</script></body></html>`;
  return new Response(body, { status: 200, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self' https://identitytoolkit.googleapis.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  }});
}

function nativeAuthorizedPage() {
  const body = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Native takeover authorized</title></head><body><main><h1>Authorized</h1><p>Return to the Native Takeover app. This page does not claim the browser takeover lease.</p></main></body></html>";
  return new Response(body, { status: 200, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  }});
}

export function createTakeoverOperatorBoundary() {
  const origin = baseUrl();
  const webApiKey = required("MCP_FIREBASE_WEB_API_KEY");
  const allowed = parseAllowedAccountConfig(optional("MCP_FIREBASE_ALLOWED_UID"), optional("MCP_FIREBASE_ALLOWED_EMAIL"));
  const secret = required("MCP_TAKEOVER_OPERATOR_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32 || /\s/.test(secret)) throw new Error("MCP_TAKEOVER_OPERATOR_SECRET must be at least 32 non-whitespace bytes");
  const ttl = ttlSeconds();
  const app = getApps()[0];
  if (!app) throw new Error("Firebase app must be initialized before takeover operator auth");
  const auth = getAuth(app);

  return {
    loginPage: () => loginPage(webApiKey, secret),
    nativeLoginPage: () => loginPage(webApiKey, secret, NATIVE_AUTH_PATH),
    nativeAuthorizedPage,
    nativeAuthPath: NATIVE_AUTH_PATH,
    isAuthorized: (request) => verifyOperatorSession(cookieValue(request), allowed.binding, secret),
    async createSession(request) {
      if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (request.headers.get("origin") !== origin) return new Response(JSON.stringify({ error: "origin_not_allowed" }), { status: 403, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      let body;
      try { body = JSON.parse(await readBoundedText(request, MAX_BODY_BYTES)); }
      catch { return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
      if (typeof body?.idToken !== "string" || body.idToken.length > 16_384) return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      const decoded = await auth.verifyIdToken(body.idToken, true).catch(() => null);
      if (!accountMatchesDecodedToken(decoded, allowed)) return new Response(JSON.stringify({ error: "access_denied" }), { status: 403, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      const expiresAt = Date.now() + ttl * 1000;
      const token = issueOperatorSession(allowed.binding, expiresAt, secret);
      return new Response(JSON.stringify({ ok: true, expiresAt }), { status: 200, headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/takeover; Max-Age=${ttl}`
      }});
    }
  };
}
