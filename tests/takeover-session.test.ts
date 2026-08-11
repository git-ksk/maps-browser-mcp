import assert from "node:assert/strict";
import test from "node:test";
import { TakeoverSessionError, TakeoverSessionManager } from "../src/takeover-session.js";

const PRINCIPAL_A = "principal-a";
const PRINCIPAL_B = "principal-b";

function manager() {
  let now = 1_000;
  let id = 0;
  return {
    sessions: new TakeoverSessionManager(
      60_000,
      () => now,
      () => `takeover-${++id}`,
      Buffer.alloc(32, 7)
    ),
    advance(ms: number) {
      now += ms;
    }
  };
}

test("takeover capability is stable for one intervention epoch and bound to its principal", () => {
  const { sessions } = manager();
  const first = sessions.ensure("intervention-a", 4, PRINCIPAL_A);
  const repeated = sessions.ensure("intervention-a", 4, PRINCIPAL_A);

  assert.equal(first.id, repeated.id);
  assert.equal(first.capability, repeated.capability);
  assert.equal(first.expiresAt, repeated.expiresAt);
  assert.deepEqual(sessions.verify(first.id, first.capability, PRINCIPAL_A), {
    id: first.id,
    interventionId: "intervention-a",
    epoch: 4,
    principalBinding: PRINCIPAL_A,
    expiresAt: first.expiresAt
  });

  assert.throws(
    () => sessions.verify(first.id, first.capability, PRINCIPAL_B),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
  assert.throws(
    () => sessions.verify(first.id, `${first.capability}x`, PRINCIPAL_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
});

test("new resource epoch rotates capability and revokes previous session", () => {
  const { sessions } = manager();
  const first = sessions.ensure("intervention-a", 4, PRINCIPAL_A);
  const second = sessions.ensure("intervention-a", 5, PRINCIPAL_A);

  assert.notEqual(second.id, first.id);
  assert.notEqual(second.capability, first.capability);
  assert.throws(
    () => sessions.verify(first.id, first.capability, PRINCIPAL_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_NOT_FOUND"
  );
  assert.equal(sessions.verify(second.id, second.capability, PRINCIPAL_A).epoch, 5);
});

test("takeover capability expires and can be revoked explicitly", () => {
  const { sessions, advance } = manager();
  const grant = sessions.ensure("intervention-a", 1, PRINCIPAL_A);
  advance(60_001);
  assert.throws(
    () => sessions.verify(grant.id, grant.capability, PRINCIPAL_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_EXPIRED"
  );

  const replacement = sessions.ensure("intervention-a", 1, PRINCIPAL_A);
  sessions.revokeForIntervention("intervention-a");
  assert.throws(
    () => sessions.verify(replacement.id, replacement.capability, PRINCIPAL_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_NOT_FOUND"
  );
});
