import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthenticatedSaveReadiness, parsePlaceSaveStateProbe } from "../src/browser/place-save-state.js";

test("parses bounded save-list membership and preserves exact returned order", () => {
  const result = parsePlaceSaveStateProbe({ ok:true, placeLabel:"Example Place", rows:[{label:"List A",checked:false},{label:"List B",checked:true}], total:2 }, "Example Place");
  assert.deepEqual(result?.lists, [{index:0,label:"List A",saved:false},{index:1,label:"List B",saved:true}]);
  assert.equal(result?.truncated, false);
});

test("caps save-list identities at ten and reports truncation", () => {
  const rows = Array.from({length:12},(_,i)=>({label:`List ${i}`,checked:false}));
  const result = parsePlaceSaveStateProbe({ok:true,placeLabel:"Example Place",rows,total:12},"Example Place");
  assert.equal(result?.lists.length,10); assert.equal(result?.truncated,true);
});

test("fails closed on changed place or duplicate list identity", () => {
  assert.throws(()=>parsePlaceSaveStateProbe({ok:true,placeLabel:"Other",rows:[],total:0},"Example Place"),/active Google Maps place changed/);
  assert.throws(()=>parsePlaceSaveStateProbe({ok:true,placeLabel:"Example Place",rows:[{label:"Same",checked:false},{label:" same ",checked:true}],total:2},"Example Place"),/duplicate/);
});

test("pending chooser observation is retryable", () => {
  assert.equal(parsePlaceSaveStateProbe({ok:false,reason:"pending"},"Example Place"),undefined);
});


test("fails closed when the chooser no longer exposes a stable list-name leaf", () => {
  assert.throws(
    () => parsePlaceSaveStateProbe({ ok: false, reason: "ambiguous_list_structure" }, "Example Place"),
    /changed or became ambiguous/
  );
});


test("requires a signed-in readiness state before opening the save chooser", () => {
  assert.doesNotThrow(() => assertAuthenticatedSaveReadiness("signed_in"));
  assert.throws(() => assertAuthenticatedSaveReadiness("signed_out"), /not signed in/);
  assert.throws(() => assertAuthenticatedSaveReadiness("unknown"), /not signed in/);
});
