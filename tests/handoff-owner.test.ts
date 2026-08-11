import assert from "node:assert/strict";
import test from "node:test";
import {
  createHandoffOwner,
  HandoffOwnerRegistry
} from "../src/handoff-owner.js";

function owner(principalBinding: string) {
  return createHandoffOwner({
    toolName: "maps_search",
    args: { query: "coffee near Tokyo Station" },
    resumeStrategy: "retry_original",
    principalBinding
  });
}

test("same-principal retry keeps ownership of the active intervention", () => {
  const registry = new HandoffOwnerRegistry();
  const original = owner("principal-a");

  assert.equal(registry.claim("intervention-1", original), true);
  assert.equal(registry.claim("intervention-1", owner("principal-a")), true);
  assert.deepEqual(registry.get("intervention-1"), original);
});

test("different principal fails closed without replacing the original owner", () => {
  const registry = new HandoffOwnerRegistry();
  const original = owner("principal-a");

  assert.equal(registry.claim("intervention-1", original), true);
  assert.equal(registry.claim("intervention-1", owner("principal-b")), false);
  assert.deepEqual(registry.get("intervention-1"), original);
});

test("same principal cannot rebind an intervention to a different operation", () => {
  const registry = new HandoffOwnerRegistry();
  const original = owner("principal-a");
  const replacement = createHandoffOwner({
    toolName: "maps_directions",
    args: { destination: "Shinjuku", mode: "transit" },
    resumeStrategy: "retry_original",
    principalBinding: "principal-a"
  });

  assert.equal(registry.claim("intervention-1", original), true);
  assert.equal(registry.claim("intervention-1", replacement), false);
  assert.deepEqual(registry.get("intervention-1"), original);
});
