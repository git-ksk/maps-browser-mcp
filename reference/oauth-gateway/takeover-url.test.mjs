import assert from "node:assert/strict";
import test from "node:test";
import { normalizedTopLevelTakeoverUrl } from "./takeover-url.mjs";

test("top-level takeover drops tracking query before exact Handoff routing", () => {
  assert.equal(
    normalizedTopLevelTakeoverUrl(
      "https://public.example/takeover/abc12345?utm_source=chatgpt.com",
      "/takeover/abc12345"
    ),
    "https://public.example/takeover/abc12345"
  );
});

test("takeover API and WebSocket subroutes preserve query semantics", () => {
  for (const path of ["/takeover/api/example/abc12345", "/takeover/ws/abc12345"]) {
    const input = `https://public.example${path}?ticket=opaque`;
    assert.equal(normalizedTopLevelTakeoverUrl(input, path), input);
  }
});
