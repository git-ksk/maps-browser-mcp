import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerAllowed,
  hostAllowed,
  hostnameFromHostHeader,
  originAllowed,
  parseContentLength
} from "../src/http-security.js";

test("normalizes host headers including IPv6", () => {
  assert.equal(hostnameFromHostHeader("LOCALHOST:8787"), "localhost");
  assert.equal(hostnameFromHostHeader("[::1]:8787"), "::1");
  assert.equal(hostAllowed("example.com:443", ["example.com"]), true);
  assert.equal(hostAllowed("evil.example", ["example.com"]), false);
});

test("validates Origin against explicit origins or allowed hosts", () => {
  assert.equal(originAllowed(undefined, [], ["localhost"]), true);
  assert.equal(originAllowed("https://mcp-host.example", ["https://mcp-host.example"], ["localhost"]), true);
  assert.equal(originAllowed("https://evil.example", ["https://mcp-host.example"], ["localhost"]), false);
  assert.equal(originAllowed("http://localhost:3000", [], ["localhost"]), true);
});

test("compares static bearer transport tokens without accepting malformed values", () => {
  assert.equal(bearerAllowed(undefined, undefined), true);
  assert.equal(bearerAllowed("Bearer abcdef", "abcdef"), true);
  assert.equal(bearerAllowed("bearer abcdef", "abcdef"), true);
  assert.equal(bearerAllowed("BEARER   abcdef", "abcdef"), true);
  assert.equal(bearerAllowed("Bearer abcdeg", "abcdef"), false);
  assert.equal(bearerAllowed("Basic abcdef", "abcdef"), false);
  assert.equal(bearerAllowed("Bearer", "abcdef"), false);
  assert.equal(bearerAllowed("Bearer abcdef trailing", "abcdef"), false);
  assert.equal(bearerAllowed("Bearer\tabcdef", "abcdef"), false);
});

test("enforces Content-Length bounds", () => {
  assert.equal(parseContentLength(undefined, 1024), undefined);
  assert.equal(parseContentLength("512", 1024), 512);
  assert.throws(() => parseContentLength("2048", 1024), /request_body_too_large/);
  assert.throws(() => parseContentLength("12oops", 1024), /invalid_content_length/);
});
