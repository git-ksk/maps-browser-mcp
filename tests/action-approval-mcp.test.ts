import assert from "node:assert/strict";
import test from "node:test";
import {
  actionApprovalStateMatchesInvocation,
  createActionApprovalRequestState,
  supportsActionApprovalFormElicitation
} from "../src/action-approval-mcp.js";

const args = {
  expectedOrigin: "Tokyo Station",
  expectedDestination: "Shibuya Station",
  expectedRouteIndex: 0,
  expectedRouteLabel: "12 min via Route A",
  deviceIndex: 0,
  expectedDeviceLabel: "Test Phone"
};

test("MCP action-approval state binds tool, exact args, epoch, approval id and principal", () => {
  const state = createActionApprovalRequestState({
    toolName: "maps_send_route_to_device",
    args,
    approvalId: "approval-1",
    epoch: 9,
    principalBinding: "principal-a"
  });
  assert.equal(actionApprovalStateMatchesInvocation(state, "maps_send_route_to_device", args, "principal-a"), true);
  assert.equal(actionApprovalStateMatchesInvocation(state, "maps_send_route_to_device", { ...args, deviceIndex: 1 }, "principal-a"), false);
  assert.equal(actionApprovalStateMatchesInvocation(state, "maps_send_route_to_device", args, "principal-b"), false);
  assert.equal(actionApprovalStateMatchesInvocation(state, "other", args, "principal-a"), false);
  assert.equal(state.epoch, 9);
  assert.equal(state.approvalId, "approval-1");
});

test("approval requestState stores only bounded control-plane digests, not raw route/device content", () => {
  const state = createActionApprovalRequestState({
    toolName: "maps_send_route_to_device",
    args,
    approvalId: "approval-1",
    epoch: 9,
    principalBinding: "principal-hash"
  });
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes(args.expectedRouteLabel), false);
  assert.equal(serialized.includes(args.expectedDeviceLabel), false);
  assert.equal(serialized.includes(args.expectedOrigin), false);
  assert.equal(serialized.includes(args.expectedDestination), false);
});


test("explicit action approval requires form elicitation capability", () => {
  assert.equal(supportsActionApprovalFormElicitation({ elicitation: { form: {} } }), true);
  assert.equal(supportsActionApprovalFormElicitation({ elicitation: {} }), false);
  assert.equal(supportsActionApprovalFormElicitation({}), false);
  assert.equal(supportsActionApprovalFormElicitation(undefined), false);
});
