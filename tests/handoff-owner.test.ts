import assert from "node:assert/strict";
import test from "node:test";
import {
  claimHandoffOwner,
  createHandoffOwner,
  handoffOwnerMatches,
  type HandoffOwner
} from "mcp-execution-handoff/core";

const ARGS = { destination: "Tokyo Station", mode: "transit" };

function owner(principalBinding: string): HandoffOwner {
  return createHandoffOwner(principalBinding, "maps_directions", ARGS, "retry_original");
}

test("handoff owner identity includes the authenticated principal", () => {
  const first = owner("principal-a");
  const same = owner("principal-a");
  const other = owner("principal-b");
  assert.equal(handoffOwnerMatches(first, same), true);
  assert.equal(handoffOwnerMatches(first, other), false);
});

test("same principal may retry an owned intervention but another principal cannot rebind it", () => {
  const owners = new Map<string, HandoffOwner>();
  const first = claimHandoffOwner(owners, "intervention-1", "awaiting_human", owner("principal-a"));
  assert.ok(first);

  const retry = claimHandoffOwner(owners, "intervention-1", "human_active", owner("principal-a"));
  assert.equal(retry, first);

  const crossPrincipal = claimHandoffOwner(owners, "intervention-1", "human_active", owner("principal-b"));
  assert.equal(crossPrincipal, undefined);
  assert.equal(owners.get("intervention-1"), first);
});

test("an unowned intervention cannot be rebound after the fresh awaiting-human state", () => {
  const owners = new Map<string, HandoffOwner>();
  assert.equal(claimHandoffOwner(owners, "intervention-2", "human_active", owner("principal-a")), undefined);
  assert.equal(claimHandoffOwner(owners, "intervention-3", "verifying", owner("principal-a")), undefined);
  assert.equal(owners.size, 0);
});
