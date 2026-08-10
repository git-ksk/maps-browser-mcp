import assert from "node:assert/strict";
import test from "node:test";
import { pkceChallenge } from "./index.mjs";
import {
  isPublicIpAddress,
  parseAllowedClientHosts,
  validateClientIdUrl
} from "./cimd.mjs";

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
