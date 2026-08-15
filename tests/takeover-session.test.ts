import assert from "node:assert/strict";
import test from "node:test";
import { TakeoverSessionError, TakeoverSessionManager } from "mcp-execution-handoff/browser-takeover";

const PRINCIPAL_A = "principal-a";
const PRINCIPAL_B = "principal-b";
const CLIENT_A = "client-binding-a-1234567890";
const CLIENT_B = "client-binding-b-1234567890";

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

test("one remote client owns the capability for an intervention epoch", () => {
  const { sessions } = manager();
  const first = sessions.ensure("intervention-a", 4, PRINCIPAL_A);
  const repeated = sessions.ensure("intervention-a", 4, PRINCIPAL_A);

  assert.equal(first.id, repeated.id);
  assert.equal(first.expiresAt, repeated.expiresAt);
  sessions.validateLocator(first.id, PRINCIPAL_A);

  const grant = sessions.claimClient(first.id, PRINCIPAL_A, CLIENT_A);
  const reload = sessions.claimClient(first.id, PRINCIPAL_A, CLIENT_A);
  assert.equal(grant.capability, reload.capability);
  assert.equal(grant.clientBinding, CLIENT_A);
  assert.deepEqual(sessions.verify(first.id, grant.capability, PRINCIPAL_A, CLIENT_A), {
    id: first.id,
    interventionId: "intervention-a",
    epoch: 4,
    principalBinding: PRINCIPAL_A,
    expiresAt: first.expiresAt,
    clientBinding: CLIENT_A
  });

  assert.throws(
    () => sessions.claimClient(first.id, PRINCIPAL_A, CLIENT_B),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
  assert.throws(
    () => sessions.verify(first.id, grant.capability, PRINCIPAL_A, CLIENT_B),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
  assert.throws(
    () => sessions.verify(first.id, grant.capability, PRINCIPAL_B, CLIENT_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
  assert.throws(
    () => sessions.verify(first.id, `${grant.capability}x`, PRINCIPAL_A, CLIENT_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
});

test("new resource epoch rotates takeover session and resets the client lease", () => {
  const { sessions } = manager();
  const first = sessions.ensure("intervention-a", 4, PRINCIPAL_A);
  const firstGrant = sessions.claimClient(first.id, PRINCIPAL_A, CLIENT_A);
  const second = sessions.ensure("intervention-a", 5, PRINCIPAL_A);
  const secondGrant = sessions.claimClient(second.id, PRINCIPAL_A, CLIENT_B);

  assert.notEqual(second.id, first.id);
  assert.notEqual(secondGrant.capability, firstGrant.capability);
  assert.equal(secondGrant.clientBinding, CLIENT_B);
  assert.throws(
    () => sessions.verify(first.id, firstGrant.capability, PRINCIPAL_A, CLIENT_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_NOT_FOUND"
  );
  assert.equal(sessions.verify(second.id, secondGrant.capability, PRINCIPAL_A, CLIENT_B).epoch, 5);
});

test("takeover capability expires and can be revoked explicitly", () => {
  const { sessions, advance } = manager();
  const locator = sessions.ensure("intervention-a", 1, PRINCIPAL_A);
  const grant = sessions.claimClient(locator.id, PRINCIPAL_A, CLIENT_A);
  advance(60_001);
  assert.throws(
    () => sessions.verify(grant.id, grant.capability, PRINCIPAL_A, CLIENT_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_EXPIRED"
  );

  const replacement = sessions.ensure("intervention-a", 1, PRINCIPAL_A);
  const replacementGrant = sessions.claimClient(replacement.id, PRINCIPAL_A, CLIENT_A);
  sessions.revokeForIntervention("intervention-a");
  assert.throws(
    () => sessions.verify(replacementGrant.id, replacementGrant.capability, PRINCIPAL_A, CLIENT_A),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_NOT_FOUND"
  );
});

test("invalid client binding never claims a lease", () => {
  const { sessions } = manager();
  const locator = sessions.ensure("intervention-a", 1, PRINCIPAL_A);
  assert.throws(
    () => sessions.claimClient(locator.id, PRINCIPAL_A, "short"),
    (error: unknown) => error instanceof TakeoverSessionError && error.code === "TAKEOVER_FORBIDDEN"
  );
  const grant = sessions.claimClient(locator.id, PRINCIPAL_A, CLIENT_B);
  assert.equal(grant.clientBinding, CLIENT_B);
});
