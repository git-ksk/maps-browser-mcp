import assert from "node:assert/strict";
import test from "node:test";
import {
  accountMatchesDecodedToken,
  bearerFromRequest,
  buildMetadata,
  buildRefreshTokenRecord,
  parseAllowedAccountConfig,
  pkceChallenge,
  readBoundedText
} from "./oauth.mjs";
import {
  isPublicIpAddress,
  parseAllowedClientHosts,
  validateClientIdUrl,
  validateRedirectUris
} from "./cimd.mjs";
import { signOAuthTransaction, verifyOAuthTransaction } from "./oauth-state.mjs";

test("PKCE S256 matches RFC 7636 example", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(pkceChallenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("CIMD accepts only exact allowlisted HTTPS metadata hosts", () => {
  const hosts = parseAllowedClientHosts("chatgpt.com,example.com");
  assert.equal(validateClientIdUrl("https://chatgpt.com/oauth/client.json", hosts).hostname, "chatgpt.com");
  assert.throws(() => validateClientIdUrl("http://chatgpt.com/oauth/client.json", hosts), /invalid_client_id_url/);
  assert.throws(() => validateClientIdUrl("https://evil.chatgpt.com/oauth/client.json", hosts), /client_host_not_allowed/);
  assert.throws(() => validateClientIdUrl("https://chatgpt.com/", hosts), /invalid_client_id_url/);
  assert.throws(() => validateClientIdUrl("https://chatgpt.com/oauth/client.json?redirect=evil", hosts), /invalid_client_id_url/);
});

test("CIMD SSRF policy rejects private, loopback, link-local, and documentation IPs", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1"
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("OAuth browser transaction cookie is integrity protected", () => {
  const secret = "0123456789abcdefghijklmnopqrstuvwxyz";
  const value = signOAuthTransaction({ clientId: "https://chatgpt.com/oauth/client.json", expiresAt: 123 }, secret);
  assert.deepEqual(verifyOAuthTransaction(value, secret), { clientId: "https://chatgpt.com/oauth/client.json", expiresAt: 123 });
  const parts = value.split(".");
  parts[3] = `${parts[3].startsWith("A") ? "B" : "A"}${parts[3].slice(1)}`;
  const tampered = parts.join(".");
  assert.throws(() => verifyOAuthTransaction(tampered, secret), /invalid_oauth_transaction/);
});


test("metadata keeps offline_access at the authorization server, not the Maps resource", () => {
  const m = buildMetadata({
    baseUrl: "https://maps.example.com",
    resource: "https://maps.example.com/mcp",
    tokenEndpoint: "https://maps.example.com/oauth/token"
  });
  assert.deepEqual(m.protectedResource.scopes_supported, ["maps:use"]);
  assert.deepEqual(m.authorizationServer.scopes_supported, ["maps:use", "offline_access"]);
  assert.equal(m.authorizationServer.code_challenge_methods_supported.includes("S256"), true);
  assert.equal(m.authorizationServer.authorization_response_iss_parameter_supported, true);
  assert.equal("registration_endpoint" in m.authorizationServer, false);
});


test("public OAuth bearer is read from Web Request Headers", () => {
  const request = new Request("https://maps.example.com/mcp", {
    headers: { authorization: "Bearer public-token-value" }
  });
  assert.equal(bearerFromRequest(request), "public-token-value");
  assert.equal(bearerFromRequest(new Request("https://maps.example.com/mcp")), undefined);
});


test("CIMD redirect URIs require HTTPS except loopback development", () => {
  assert.deepEqual(validateRedirectUris(["https://chatgpt.com/oauth/callback"]), ["https://chatgpt.com/oauth/callback"]);
  assert.deepEqual(validateRedirectUris(["http://127.0.0.1:3456/callback"]), ["http://127.0.0.1:3456/callback"]);
  assert.throws(() => validateRedirectUris(["http://example.com/callback"]), /invalid_client_metadata/);
});


test("OAuth request bodies are bounded even without Content-Length", async () => {
  const ok = new Request("https://maps.example.com/oauth/token", { method: "POST", body: "a=1" });
  assert.equal(await readBoundedText(ok, 16), "a=1");
  const oversized = new Request("https://maps.example.com/oauth/token", { method: "POST", body: "x".repeat(17) });
  await assert.rejects(() => readBoundedText(oversized, 16), /oauth_request_too_large/);
});


test("single-user identity config accepts exactly one UID or verified email", () => {
  const uid = parseAllowedAccountConfig("firebase-uid-1", undefined);
  assert.equal(uid.kind, "uid");
  assert.equal(accountMatchesDecodedToken({ uid: "firebase-uid-1" }, uid), true);
  assert.equal(accountMatchesDecodedToken({ uid: "other" }, uid), false);

  const email = parseAllowedAccountConfig(undefined, "User@Example.COM");
  assert.equal(email.kind, "email");
  assert.equal(email.value, "user@example.com");
  assert.match(email.binding, /^[0-9a-f]{64}$/);
  assert.equal(email.binding.includes("user@example.com"), false);
  assert.equal(accountMatchesDecodedToken({ uid: "stable-uid", email: "USER@example.com", email_verified: true }, email), true);
  assert.equal(accountMatchesDecodedToken({ uid: "stable-uid", email: "user@example.com", email_verified: false }, email), false);
  assert.equal(accountMatchesDecodedToken({ uid: "stable-uid", email: "other@example.com", email_verified: true }, email), false);

  assert.throws(() => parseAllowedAccountConfig(undefined, undefined), /exactly one/);
  assert.throws(() => parseAllowedAccountConfig("uid", "user@example.com"), /exactly one/);
});


test("initial and rotated refresh records require the account binding", () => {
  const common = {
    uid: "firebase-uid-1",
    accountBinding: "a".repeat(64),
    clientId: "https://chatgpt.com/oauth/client.json",
    resource: "https://maps.example.com/mcp",
    scopes: ["maps:use", "offline_access"],
    familyId: "family-1",
    expiresAt: { seconds: 1 },
    usedAt: null
  };
  const initial = buildRefreshTokenRecord({ ...common, generation: 0 });
  const rotated = buildRefreshTokenRecord({ ...common, generation: 1 });
  assert.equal(initial.accountBinding, common.accountBinding);
  assert.equal(rotated.accountBinding, common.accountBinding);
  assert.equal(initial.generation, 0);
  assert.equal(rotated.generation, 1);
  assert.throws(
    () => buildRefreshTokenRecord({ ...common, accountBinding: "", generation: 0 }),
    /invalid_refresh_record_identity/
  );
});
