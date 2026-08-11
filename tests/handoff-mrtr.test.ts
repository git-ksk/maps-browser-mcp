import assert from "node:assert/strict";
import test from "node:test";
import {
  createHandoffRequestState,
  digestToolInvocation,
  handoffStateMatchesInvocation,
  interventionPrompt
} from "../src/handoff-mrtr.js";

test("tool invocation digest is stable across object key order", () => {
  const first = digestToolInvocation("maps_directions", {
    destination: "Yokohama Station",
    mode: "transit",
    origin: "Tokyo Station"
  });
  const second = digestToolInvocation("maps_directions", {
    origin: "Tokyo Station",
    destination: "Yokohama Station",
    mode: "transit"
  });

  assert.equal(first, second);
});

test("handoff state is bound to the originating tool and normalized arguments", () => {
  const args = { query: "coffee near Tokyo Station" };
  const state = createHandoffRequestState({
    toolName: "maps_search",
    args,
    interventionId: "intervention-1",
    epoch: 3,
    resumeStrategy: "retry_original"
  });

  assert.equal(handoffStateMatchesInvocation(state, "maps_search", args), true);
  assert.equal(
    handoffStateMatchesInvocation(state, "maps_search", { query: "restaurants near Tokyo Station" }),
    false
  );
  assert.equal(handoffStateMatchesInvocation(state, "maps_show", args), false);
});

test("handoff prompt keeps credentials and challenge answers out of MCP", () => {
  const prompt = interventionPrompt("access_challenge");
  assert.match(prompt, /dedicated Chrome/i);
  assert.match(prompt, /Do not paste passwords/i);
  assert.match(prompt, /CAPTCHA answers/i);
  assert.match(prompt, /Continue/i);
});
