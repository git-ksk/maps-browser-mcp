import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAX_COOKIE_BYTES = 3800;
const VERSION = "v1";
const AAD = Buffer.from("maps-browser-mcp/oauth-transaction/v1", "utf8");
const KDF_SALT = Buffer.from("maps-browser-mcp/oauth-transaction-key/v1", "utf8");
let cachedSecret;
let cachedKey;

function transactionKey(secret) {
  if (secret === cachedSecret && cachedKey) return cachedKey;
  const key = scryptSync(secret, KDF_SALT, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  cachedSecret = secret;
  cachedKey = key;
  return key;
}

export function signOAuthTransaction(payload, secret) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", transactionKey(secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const value = `${VERSION}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
  if (Buffer.byteLength(value, "utf8") > MAX_COOKIE_BYTES) throw new Error("oauth_transaction_too_large");
  return value;
}

export function verifyOAuthTransaction(value, secret) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_COOKIE_BYTES) throw new Error("invalid_oauth_transaction");
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || !parts[1] || !parts[2] || !parts[3]) throw new Error("invalid_oauth_transaction");

  let plaintext;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid_oauth_transaction");
    const decipher = createDecipheriv("aes-256-gcm", transactionKey(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("invalid_oauth_transaction");
  }

  let payload;
  try { payload = JSON.parse(plaintext.toString("utf8")); }
  catch { throw new Error("invalid_oauth_transaction"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_oauth_transaction");
  return payload;
}
