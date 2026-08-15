import assert from "node:assert/strict";
import test from "node:test";
import {
  createHandoffRequestState,
  handoffStateMatchesInvocation,
  interventionPrompt
} from "mcp-execution-handoff/mcp";
import { digestToolInvocation } from "mcp-execution-handoff/core";
import { principalBinding, runWithRequestPrincipal } from "../src/request-principal.js";

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

test("handoff state is bound to tool, arguments and authenticated principal", () => {
  const args = { query: "coffee near Tokyo Station" };
  const principalA = { subject: "user-a" };
  const principalB = { subject: "user-b" };
  const state = createHandoffRequestState({
    toolName: "maps_search",
    args,
    interventionId: "intervention-1",
    epoch: 3,
    resumeStrategy: "retry_original",
    principalBinding: principalBinding(principalA)
  });

  assert.equal(state.principalBinding, principalBinding(principalA));
  assert.equal(
    handoffStateMatchesInvocation(state, "maps_search", args, principalBinding(principalA)),
    true
  );
  assert.equal(
    handoffStateMatchesInvocation(state, "maps_search", args, principalBinding(principalB)),
    false
  );
  assert.equal(
    handoffStateMatchesInvocation(state, "maps_search", { query: "restaurants near Tokyo Station" }, principalBinding(principalA)),
    false
  );
  assert.equal(
    handoffStateMatchesInvocation(state, "maps_show", args, principalBinding(principalA)),
    false
  );
});

test("stdio handoff state uses a separate local binding", () => {
  const state = createHandoffRequestState({
    toolName: "maps_search",
    args: { query: "Tokyo Station" },
    interventionId: "local-1",
    epoch: 1,
    resumeStrategy: "retry_original",
    principalBinding: "local-stdio"
  });
  assert.equal(state.principalBinding, "local-stdio");
});

test("handoff prompt keeps credentials and challenge answers out of MCP", () => {
  const prompt = interventionPrompt({ subject: "Google Maps", instruction: "Complete that step directly in the dedicated Chrome window." });
  assert.match(prompt, /dedicated Chrome/i);
  assert.match(prompt, /Do not paste passwords/i);
  assert.match(prompt, /CAPTCHA answers/i);
  assert.match(prompt, /Continue/i);
});
