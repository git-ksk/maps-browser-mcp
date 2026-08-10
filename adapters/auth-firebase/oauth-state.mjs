import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_COOKIE_BYTES = 3800;

function signature(encoded, secret) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function signOAuthTransaction(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const value = `${encoded}.${signature(encoded, secret)}`;
  if (Buffer.byteLength(value, "utf8") > MAX_COOKIE_BYTES) throw new Error("oauth_transaction_too_large");
  return value;
}

export function verifyOAuthTransaction(value, secret) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_COOKIE_BYTES) throw new Error("invalid_oauth_transaction");
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("invalid_oauth_transaction");
  const expected = Buffer.from(signature(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("invalid_oauth_transaction");
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new Error("invalid_oauth_transaction"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_oauth_transaction");
  return payload;
}
