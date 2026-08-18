import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Cua Human transport keeps tool payloads on stdio instead of argv or logs", () => {
  const source = fs.readFileSync(new URL("../src/browser/cua-mcp-client.ts", import.meta.url), "utf8");
  assert.match(source, /spawn\(this\.command, \["mcp"\]/);
  assert.match(source, /stdio: \["pipe", "pipe", "ignore"\]/);
  assert.match(source, /child\.stdin\.write/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  for (const name of ["bring_to_front", "list_windows", "get_window_state", "click", "scroll", "type_text", "press_key"]) {
    assert.match(source, new RegExp(`\\"${name}\\"`));
  }
  assert.match(source, /outside the credential-safe Human transport allowlist/);
});
