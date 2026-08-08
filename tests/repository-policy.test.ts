import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("MCP server version stays synchronized with package version", () => {
  const packageJson = JSON.parse(read("package.json")) as { version?: unknown };
  assert.equal(typeof packageJson.version, "string");

  const serverSource = read("src/server.ts");
  const match = serverSource.match(/const SERVER_VERSION = "([^"]+)";/);
  assert.ok(match, "src/server.ts must declare SERVER_VERSION explicitly");
  assert.equal(match[1], packageJson.version);
});

test("GitHub Actions dependencies are pinned to immutable commit SHAs", () => {
  for (const workflow of [".github/workflows/ci.yml", ".github/workflows/live-maps-e2e.yml"]) {
    const source = read(workflow);
    const uses = [...source.matchAll(/\buses:\s*([^\s#]+)@([^\s#]+)/g)];
    assert.ok(uses.length > 0, `${workflow} must contain at least one pinned action`);
    for (const match of uses) {
      assert.match(match[2] ?? "", /^[0-9a-f]{40}$/i, `${match[1]} in ${workflow} must use a full commit SHA`);
    }
  }
});

test("Live Maps E2E remains manual-only", () => {
  const source = read(".github/workflows/live-maps-e2e.yml");
  assert.match(source, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(source, /^\s{2}(push|pull_request|schedule|workflow_run):\s*$/m);
  assert.match(source, /^permissions:\s*\n\s{2}contents:\s*read\s*$/m);
});
