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
  const workflows = [
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/live-maps-e2e.yml"
  ];

  for (const workflow of workflows) {
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

test("container portability is gated by the existing required Node 22 check", () => {
  const source = read(".github/workflows/ci.yml");
  assert.match(source, /^  check:\s*$/m);
  assert.match(source, /matrix:\s*\n\s+node:\s*\[20, 22, 24\]/m);
  assert.match(source, /- name: Build container image\s*\n\s+if: matrix\.node == 22/m);
  assert.match(source, /- name: Sandboxed Chrome\/CDP smoke in a sandbox-capable container\s*\n\s+if: matrix\.node == 22/m);
  assert.match(source, /- name: HTTP liveness, browser readiness, and PORT fallback inside container\s*\n\s+if: matrix\.node == 22/m);
  assert.doesNotMatch(source, /^  container:\s*$/m, "container validation must not live in a separate optional job");
});

test("container base image is digest-pinned and monitored", () => {
  const dockerfile = read("Dockerfile");
  const fromLines = dockerfile.split(/\r?\n/).filter((line) => line.startsWith("FROM "));
  assert.ok(fromLines.length >= 2);
  for (const line of fromLines) {
    assert.match(line, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}(?: AS \w+)?$/i);
  }

  const dependabot = read(".github/dependabot.yml");
  assert.match(dependabot, /package-ecosystem:\s*docker/);
});

test("human-intervention detection stays fail-closed and contains no bypass path", () => {
  const source = read("src/browser/runtime.ts");
  assert.match(source, /HUMAN_INTERVENTION_REQUIRED/);
  assert.match(source, /iframe\[src\*=\\"recaptcha\\"\]/);
  assert.match(source, /form\[action\*=\\"\/sorry\/\\"\]/);
  assert.match(source, /input\[name=\\"captcha\\"\]/);
  assert.match(source, /url\.pathname\.startsWith\(\"\/sorry\/\"\)/);
  assert.match(source, /url\.hostname\.includes\(\"recaptcha\"\)/);
  assert.doesNotMatch(source, /captcha.{0,30}(solve|bypass)|stealth|fingerprint spoof|proxy rotation/i);
});
