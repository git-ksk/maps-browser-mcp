import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionApprovalError,
  ActionApprovalManager,
  digestActionEnvelope
} from "../src/action-approval.js";

function fixture() {
  let now = 1_000;
  let id = 0;
  return {
    approvals: new ActionApprovalManager(
      60_000,
      () => now,
      () => `approval-${++id}`,
      Buffer.alloc(32, 9)
    ),
    advance(ms: number) { now += ms; }
  };
}

test("action envelope digest is canonical across object key order", () => {
  assert.equal(
    digestActionEnvelope("send", { to: "a@example.test", subject: "x" }),
    digestActionEnvelope("send", { subject: "x", to: "a@example.test" })
  );
});

test("approval is bound to principal, resource epoch and exact final action", () => {
  const { approvals } = fixture();
  const args = { target: "resource-1", operation: "delete" };
  const request = approvals.request({
    actionName: "dangerous_action",
    args,
    epoch: 7,
    principalBinding: "principal-a"
  });

  assert.throws(
    () => approvals.grant(request.id, "principal-b"),
    (error: unknown) => error instanceof ActionApprovalError && error.code === "APPROVAL_FORBIDDEN"
  );

  const receipt = approvals.grant(request.id, "principal-a");
  assert.throws(
    () => approvals.consume({
      id: request.id,
      receipt,
      actionName: "dangerous_action",
      args: { target: "resource-2", operation: "delete" },
      epoch: 7,
      principalBinding: "principal-a"
    }),
    (error: unknown) => error instanceof ActionApprovalError && error.code === "APPROVAL_FORBIDDEN"
  );
  assert.throws(
    () => approvals.consume({
      id: request.id,
      receipt,
      actionName: "dangerous_action",
      args,
      epoch: 8,
      principalBinding: "principal-a"
    }),
    (error: unknown) => error instanceof ActionApprovalError && error.code === "APPROVAL_FORBIDDEN"
  );

  approvals.consume({
    id: request.id,
    receipt,
    actionName: "dangerous_action",
    args,
    epoch: 7,
    principalBinding: "principal-a"
  });
  assert.throws(
    () => approvals.consume({
      id: request.id,
      receipt,
      actionName: "dangerous_action",
      args,
      epoch: 7,
      principalBinding: "principal-a"
    }),
    (error: unknown) => error instanceof ActionApprovalError && error.code === "APPROVAL_ALREADY_USED"
  );
});

test("takeover completion cannot implicitly create or satisfy an approval", () => {
  const { approvals } = fixture();
  const request = approvals.request({
    actionName: "purchase",
    args: { sku: "example", quantity: 1 },
    epoch: 3,
    principalBinding: "principal-a"
  });

  assert.throws(
    () => approvals.consume({
      id: request.id,
      receipt: "not-a-grant",
      actionName: "purchase",
      args: { sku: "example", quantity: 1 },
      epoch: 3,
      principalBinding: "principal-a"
    }),
    (error: unknown) => error instanceof ActionApprovalError && error.code === "APPROVAL_NOT_GRANTED"
  );
});

test("approval expires instead of becoming a durable authorization", () => {
  const { approvals, advance } = fixture();
  const request = approvals.request({
    actionName: "send",
    args: { messageDigest: "abc" },
    epoch: 1,
    principalBinding: "principal-a"
  });
  advance(60_001);
  assert.throws(
    () => approvals.grant(request.id, "principal-a"),
    (error: unknown) => error instanceof ActionApprovalError && error.code === "APPROVAL_EXPIRED"
  );
});
