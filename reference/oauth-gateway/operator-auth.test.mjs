import assert from "node:assert/strict";
import test from "node:test";
import { issueOperatorSession, verifyOperatorSession } from "./operator-auth.mjs";

const secret = "0123456789abcdefghijklmnopqrstuvwxyzABCD";
const binding = "account-binding-hash";

test("operator session is account-bound and expires", () => {
  const token = issueOperatorSession(binding, 10_000, secret);
  assert.equal(verifyOperatorSession(token, binding, secret, 9_999), true);
  assert.equal(verifyOperatorSession(token, "other-binding", secret, 9_999), false);
  assert.equal(verifyOperatorSession(token, binding, secret, 10_000), false);
});

test("operator session rejects tampering and wrong signing secret", () => {
  const token = issueOperatorSession(binding, 10_000, secret);
  const [payload, signature] = token.split(".");
  assert.equal(verifyOperatorSession(`${payload}x.${signature}`, binding, secret, 1), false);
  assert.equal(verifyOperatorSession(token, binding, "abcdefghijklmnopqrstuvwxyz0123456789ABCD", 1), false);
  assert.equal(verifyOperatorSession("not-a-token", binding, secret, 1), false);
});
