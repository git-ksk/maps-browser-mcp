import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("package, lockfile, and MCP server versions stay synchronized", () => {
  const packageJson = JSON.parse(read("package.json")) as { version?: unknown };
  const packageLock = JSON.parse(read("package-lock.json")) as {
    version?: unknown;
    packages?: Record<string, { version?: unknown }>;
  };
  assert.equal(typeof packageJson.version, "string");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.[""]?.version, packageJson.version);

  const serverSource = read("src/server.ts");
  const match = serverSource.match(/const SERVER_VERSION = "([^"]+)";/);
  assert.ok(match, "src/server.ts must declare SERVER_VERSION explicitly");
  assert.equal(match[1], packageJson.version);

  const appSource = read("src/mcp-apps-map-embed.ts");
  const appMatch = appSource.match(/MAP_DIRECTIONS_APP_VERSION = "([^"]+)";/);
  assert.ok(appMatch, "MCP Apps View must declare its implementation version explicitly");
  assert.equal(appMatch[1], packageJson.version);
});

test("top-level READMEs document every registered MCP tool and current release version", () => {
  const serverSource = read("src/server.ts");
  const registeredTools = [...serverSource.matchAll(/server\.registerTool\(\s*"(maps_[a-z0-9_]+)"/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
  assert.ok(registeredTools.length > 0, "src/server.ts must register MCP tools");

  const packageJson = JSON.parse(read("package.json")) as { version?: unknown };
  assert.equal(typeof packageJson.version, "string");

  for (const readme of ["README.md", "README.ja.md"]) {
    const source = read(readme);
    for (const tool of registeredTools) {
      assert.ok(source.includes(`\`${tool}\``), `${readme} must document registered tool ${tool}`);
    }
    assert.ok(source.includes(`v${packageJson.version}`), `${readme} must mention current release v${packageJson.version}`);
    assert.ok(source.includes(`\`${packageJson.version}\``), `${readme} must mention current metadata version ${packageJson.version}`);
  }
});

test("execution handoff upstream source release is pinned to an immutable commit", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.equal(
    pkg.dependencies?.["mcp-execution-handoff"],
    "https://github.com/git-ksk/mcp-execution-handoff/archive/9748bb765f42395543b4846874d9bcd1ab2a4435.tar.gz"
  );
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

test("Live Maps E2E remains manual-only and supports an explicit container path", () => {
  const source = read(".github/workflows/live-maps-e2e.yml");
  assert.match(source, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(source, /^\s{2}(push|pull_request|schedule|workflow_run):\s*$/m);
  assert.match(source, /^permissions:\s*\n\s{2}contents:\s*read\s*$/m);
  assert.match(source, /^\s{6}runtime:\s*$/m);
  assert.match(source, /^\s{10}- host\s*$/m);
  assert.match(source, /^\s{10}- container\s*$/m);
  assert.match(source, /inputs\.runtime == 'container'/);
  assert.match(source, /docker build --tag maps-browser-mcp:live \./);
  assert.match(source, /--cap-add=SYS_ADMIN/);
  assert.doesNotMatch(source, /MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true/);
  assert.doesNotMatch(source, /upload-artifact/i);
});

test("container portability is gated by the existing required Node 22 check", () => {
  const source = read(".github/workflows/ci.yml");
  assert.match(source, /^  check:\s*$/m);
  assert.match(source, /matrix:\s*\n\s+node:\s*\[20, 22, 24\]/m);
  assert.match(source, /- name: Build container image\s*\n\s+if: matrix\.node == 22/m);
  assert.match(source, /- name: Sandboxed Chrome\/CDP smoke in a sandbox-capable container\s*\n\s+if: matrix\.node == 22/m);
  assert.match(source, /- name: HTTP liveness, guarded browser readiness, and PORT fallback inside container\s*\n\s+if: matrix\.node == 22/m);
  assert.doesNotMatch(source, /^  container:\s*$/m, "container validation must not live in a separate optional job");
});

test("readiness, MCP, and takeover paths use the configured HTTP auth provider", () => {
  const indexSource = read("src/index.ts");
  const authSource = read("src/auth-provider.ts");

  assert.match(indexSource, /createHttpAuthProvider\(config\)/);
  assert.match(indexSource, /requestUrl\.pathname === "\/readyz"/);
  assert.match(indexSource, /isTakeoverHttpPath\(requestUrl\.pathname\)/);
  assert.match(indexSource, /authorizeRequest\(authProvider, req, res, requestUrl\)/);
  assert.match(indexSource, /runWithRequestPrincipal\(principal/);
  assert.match(authSource, /bearerAllowed\(request\.headers\.authorization, expectedToken\)/);
  assert.match(authSource, /www-authenticate/);
  assert.match(authSource, /createAuthProvider/);
});

test("reference Cloud Run profile protects the single Chromium runtime from OOM/parallelism regressions", () => {
  for (const doc of ["reference/oauth-gateway/README.md", "reference/oauth-gateway/README.ja.md"]) {
    const source = read(doc);
    assert.match(source, /--cpu=1/);
    assert.match(source, /--memory=2Gi/);
    assert.match(source, /--concurrency=1/);
    assert.match(source, /--max-instances=1/);
    assert.match(source, /503/);
    assert.match(source, /TaskGroup/);
  }
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

test("human-intervention detection stays fail-closed and contains no solver integration", () => {
  const runtimeSource = read("src/browser/runtime.ts");
  const surfaceSource = read("src/browser/intervention-surface.ts");
  assert.match(runtimeSource, /HUMAN_INTERVENTION_REQUIRED/);
  assert.ok(runtimeSource.includes("'iframe[src*=\"recaptcha\"]'"));
  assert.ok(runtimeSource.includes("'form[action*=\"/sorry/\"]'"));
  assert.ok(runtimeSource.includes("'input[name=\"captcha\"]'"));
  assert.match(runtimeSource, /classifyGoogleInterventionSurface/);
  assert.match(surfaceSource, /url\.protocol !== "https:"/);
  assert.match(surfaceSource, /GOOGLE_SORRY_HOSTS\.has\(hostname\)/);
  assert.match(surfaceSource, /pathname\.startsWith\("\/sorry\/"\)/);
  assert.match(surfaceSource, /GOOGLE_RECAPTCHA_HOSTS\.has\(hostname\)/);
  assert.match(surfaceSource, /pathname\.startsWith\("\/recaptcha\/"\)/);

  const packageJson = read("package.json");
  assert.doesNotMatch(packageJson, /recaptcha|captcha-solver|puppeteer-extra-plugin-stealth|playwright-extra|proxy-chain/i);
});
