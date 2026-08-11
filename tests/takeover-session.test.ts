import assert from "node:assert/strict";
import test from "node:test";
import { TakeoverSessionError, TakeoverSessionManager } from "../src/takeover-session.js";

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

test("takeover capability is stable for one intervention epoch and bound to it", () => {
  const { sessions } = manager();
  const first = sessions.ensure("intervention-a", 4);
  const repeated = sessions.ensure("intervention-a", 4);

  assert.equal(first.id, repeated.id);
  assert.equal(first.capability, repeated.capability);
  assert.equal(first.expiresAt, repeated.expiresAt);
  assert.deepEqual(sessions.verify(first.id, first.capability), {
    id: first.id,
    interventionId: "intervention-a",
    epoch: 4,
    expiresAt: first.expiresAt
  });

  assert.throws(
    () => sessions.verify(first.id, `${first.capability}x`),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
});

test("new resource epoch rotates capability and revokes previous session", () => {
  const { sessions } = manager();
  const first = sessions.ensure("intervention-a", 4);
  const second = sessions.ensure("intervention-a", 5);

  assert.notEqual(second.id, first.id);
  assert.notEqual(second.capability, first.capability);
  assert.throws(
    () => sessions.verify(first.id, first.capability),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_NOT_FOUND"
  );
  assert.equal(sessions.verify(second.id, second.capability).epoch, 5);
});

test("takeover capability expires and can be revoked explicitly", () => {
  const { sessions, advance } = manager();
  const grant = sessions.ensure("intervention-a", 1);
  advance(60_001);
  assert.throws(
    () => sessions.verify(grant.id, grant.capability),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_EXPIRED"
  );

  const replacement = sessions.ensure("intervention-a", 1);
  sessions.revokeForIntervention("intervention-a");
  assert.throws(
    () => sessions.verify(replacement.id, replacement.capability),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_NOT_FOUND"
  );
});
