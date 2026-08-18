import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";

const METADATA_MAX_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ASSERTION_MAX_AGE_SECONDS = 5 * 60;
const cache = new Map();

function ipv4Parts(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function unsafeIpv4(address) {
  const p = ipv4Parts(address);
  if (!p) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function mappedIpv4(address) {
  const lower = address.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const tail = lower.slice(7);
  if (tail.includes(".")) return tail;
  const words = tail.split(":");
  if (words.length !== 2) return null;
  const high = Number.parseInt(words[0], 16);
  const low = Number.parseInt(words[1], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPublicIpAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !unsafeIpv4(address);
  if (family !== 6) return false;
  const mapped = mappedIpv4(address);
  if (mapped) return !unsafeIpv4(mapped);
  const lower = address.toLowerCase();
  return lower !== "::" && lower !== "::1" &&
    !lower.startsWith("fc") && !lower.startsWith("fd") &&
    !/^fe[89ab]/.test(lower) &&
    !lower.startsWith("ff") &&
    !lower.startsWith("2001:db8:");
}

export function parseAllowedClientHosts(raw) {
  const hosts = [...new Set((raw || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (hosts.length === 0) throw new Error("MCP_OAUTH_ALLOWED_CLIENT_HOSTS is required for CIMD");
  for (const host of hosts) {
    if (host.includes("/") || host.includes(":") || host.includes("*") || host === "localhost") {
      throw new Error(`Invalid exact hostname in MCP_OAUTH_ALLOWED_CLIENT_HOSTS: ${host}`);
    }
  }
  return new Set(hosts);
}

export function validateClientIdUrl(raw, allowedHosts) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("invalid_client_id_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || url.pathname === "/") {
    throw new Error("invalid_client_id_url");
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error("client_host_not_allowed");
  return url;
}

async function resolvePublicAddresses(hostname) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicIpAddress(record.address))) {
    throw new Error("client_host_resolves_to_non_public_address");
  }
  return records;
}

function pinnedLookup(records) {
  return (_hostname, options, callback) => {
    if (options && typeof options === "object" && options.all) {
      callback(null, records.map(({ address, family }) => ({ address, family })));
      return;
    }
    const requestedFamily = typeof options === "object" ? options.family : 0;
    const chosen = records.find((record) => !requestedFamily || record.family === requestedFamily) || records[0];
    callback(null, chosen.address, chosen.family);
  };
}

async function getJsonPinned(url, allowedHosts) {
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error("client_host_not_allowed");
  const records = await resolvePublicAddresses(url.hostname);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "maps-browser-mcp-auth/0.1" },
      lookup: pinnedLookup(records),
      timeout: FETCH_TIMEOUT_MS
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("client_metadata_fetch_failed"));
        return;
      }
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      if (!contentType.includes("application/json") && !contentType.includes("+json")) {
        response.resume();
        reject(new Error("client_metadata_not_json"));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > METADATA_MAX_BYTES) {
          response.destroy(new Error("client_metadata_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("client_metadata_invalid_json")); }
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("client_metadata_timeout")));
    request.on("error", reject);
    request.end();
  });
}

export function validateRedirectUris(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("invalid_client_metadata");
  return value.map((raw) => {
    if (typeof raw !== "string" || raw.length > 2048) throw new Error("invalid_client_metadata");
    let url;
    try { url = new URL(raw); } catch { throw new Error("invalid_client_metadata"); }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.hash || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
      throw new Error("invalid_client_metadata");
    }
    return url.toString();
  });
}

async function loadJwks(metadata, clientUrl, allowedHosts) {
  if (metadata.jwks && typeof metadata.jwks === "object" && Array.isArray(metadata.jwks.keys)) return metadata.jwks;
  if (typeof metadata.jwks_uri !== "string") throw new Error("client_jwks_required");
  const jwksUrl = new URL(metadata.jwks_uri);
  if (jwksUrl.protocol !== "https:" || jwksUrl.origin !== clientUrl.origin || jwksUrl.username || jwksUrl.password || jwksUrl.hash) {
    throw new Error("client_jwks_uri_must_be_same_origin");
  }
  return getJsonPinned(jwksUrl, allowedHosts);
}

export async function loadCimdClient(clientId, allowedHosts, { force = false } = {}) {
  const clientUrl = validateClientIdUrl(clientId, allowedHosts);
  const cached = cache.get(clientId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const metadata = await getJsonPinned(clientUrl, allowedHosts);
  if (!metadata || typeof metadata !== "object" || metadata.client_id !== clientId || typeof metadata.client_name !== "string" || !metadata.client_name.trim()) {
    throw new Error("invalid_client_metadata");
  }
  if (metadata.token_endpoint_auth_method !== "private_key_jwt") throw new Error("private_key_jwt_required");
  const redirectUris = validateRedirectUris(metadata.redirect_uris);
  const jwks = await loadJwks(metadata, clientUrl, allowedHosts);
  if (!jwks || typeof jwks !== "object" || !Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error("invalid_client_jwks");
  const value = { clientId, clientName: metadata.client_name.trim(), redirectUris, jwks };
  cache.set(clientId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

function assertionClientId(params) {
  const explicit = params.get("client_id");
  if (explicit) return explicit;
  const assertion = params.get("client_assertion");
  if (!assertion) throw new Error("client_assertion_required");
  const claims = decodeJwt(assertion);
  if (typeof claims.iss !== "string") throw new Error("client_id_required");
  return claims.iss;
}

async function verifyWithClient(assertion, client, tokenEndpoint) {
  const result = await jwtVerify(assertion, createLocalJWKSet(client.jwks), {
    issuer: client.clientId,
    subject: client.clientId,
    audience: tokenEndpoint,
    algorithms: ["RS256"],
    clockTolerance: 30
  });
  const payload = result.payload;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== "number" || payload.iat < nowSeconds - ASSERTION_MAX_AGE_SECONDS || payload.iat > nowSeconds + 30) throw new Error("invalid_client_assertion_iat");
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds || payload.exp > nowSeconds + ASSERTION_MAX_AGE_SECONDS) throw new Error("invalid_client_assertion_exp");
  if (typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 256) throw new Error("invalid_client_assertion_jti");
  return { client, jti: payload.jti, expiresAt: payload.exp * 1000 };
}

export async function verifyCimdPrivateKeyJwt(params, tokenEndpoint, allowedHosts) {
  if (params.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") throw new Error("invalid_client_assertion_type");
  const assertion = params.get("client_assertion");
  if (!assertion || assertion.length > 16_384) throw new Error("client_assertion_required");
  const clientId = assertionClientId(params);
  let client = await loadCimdClient(clientId, allowedHosts);
  try {
    return await verifyWithClient(assertion, client, tokenEndpoint);
  } catch {
    client = await loadCimdClient(clientId, allowedHosts, { force: true });
    return verifyWithClient(assertion, client, tokenEndpoint);
  }
}
