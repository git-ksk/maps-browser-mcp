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

test("release documentation keeps distribution metadata and Cloud Run acceptance claims synchronized", () => {
  const packageJson = JSON.parse(read("package.json")) as { name?: unknown; version?: unknown; mcpName?: unknown };
  const registryGuide = read("docs/official-mcp-registry.md");
  const targetMatch = registryGuide.match(
    /first npm \+ Official MCP Registry publication target is \*\*v([0-9]+\.[0-9]+\.[0-9]+)\*\*/i
  );
  assert.ok(targetMatch, "registry guide must declare the next exact publication target");
  const targetVersion = targetMatch[1];

  const serverExample = JSON.parse(read("server.json.example")) as {
    name?: unknown;
    version?: unknown;
    packages?: Array<{ identifier?: unknown; version?: unknown; transport?: { type?: unknown } }>;
  };
  assert.equal(serverExample.name, packageJson.mcpName);
  assert.equal(serverExample.version, targetVersion);
  assert.equal(serverExample.packages?.[0]?.identifier, packageJson.name);
  assert.equal(serverExample.packages?.[0]?.version, targetVersion);
  assert.equal(serverExample.packages?.[0]?.transport?.type, "stdio");

  for (const readme of ["README.md", "README.ja.md"]) {
    assert.match(read(readme), /handoff-overview(?:\.ja)?\.md/);
  }

  const currentAcceptanceDocs = [
    "README.md",
    "README.ja.md",
    "docs/architecture.md",
    "docs/architecture.ja.md",
    "docs/container.md",
    "docs/container.ja.md",
    "docs/v5-authenticated-workflows.md",
    "docs/v5-authenticated-workflows.ja.md",
    "docs/webrtc-human-takeover.md",
    "docs/webrtc-human-takeover.ja.md"
  ];
  for (const doc of currentAcceptanceDocs) {
    const source = read(doc);
    assert.doesNotMatch(source, /Cloud Run \+ physical[- ]iPhone real Google sign-in acceptance remains pending/i);
    assert.doesNotMatch(source, /Cloud Run \+ physical iPhone Google sign-in acceptance is still pending/i);
    assert.doesNotMatch(source, /Cloud Run \+ 物理iPhoneでのreal Google sign-in acceptanceは未実施/);
    assert.doesNotMatch(source, /本番昇格にはreal Cloud Run Google sign-in acceptance/);
  }

  const releaseGuide = read("docs/release.md");
  assert.match(releaseGuide, /Official MCP Registry publication/);
  assert.match(releaseGuide, /server\.json/);
  assert.match(read("CHANGELOG.md"), /## \[Unreleased\][\s\S]*Linux\/container normal-browser `webrtc_takeover`/);
});

test("execution handoff upstream Browser Handoff integration is pinned to an immutable commit", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.equal(
    pkg.dependencies?.["mcp-execution-handoff"],
    "https://github.com/git-ksk/mcp-execution-handoff/archive/cae605d44892f779dd54245f05a0e035fa277220.tar.gz"
  );
});

test("local Google sign-in acceptance proxy keeps the Handoff WebRTC route and upstream destination explicitly bounded", () => {
  const source = read("scripts/live-google-sign-in-acceptance.mjs");
  assert.match(source, /webrtc-connect\|webrtc-diagnostics\|webrtc-metrics\|webrtc-suspend/);
  assert.doesNotMatch(source, /takeover\\\/api\\\/(?:\.\*|\[\^\/\]\+)/);
  assert.match(source, /hostname: "127\.0\.0\.1"/);
  assert.match(source, /port: corePort/);
  assert.match(source, /path: requestUrl\.pathname/);
  assert.doesNotMatch(source, /new URL\(requestUrl\.pathname, coreBaseUrl\)/);
});

test("local Google sign-in acceptance retries only transient read-only post-login settling", () => {
  const source = read("scripts/live-google-sign-in-acceptance.mjs");
  assert.match(source, /readPlaceSummaryWithBoundedSettle/);
  assert.match(source, /Date\.now\(\) \+ 8_000/);
  assert.match(source, /UI_ELEMENT_NOT_FOUND/);
  assert.match(source, /UI_STATE_CHANGED/);
  assert.doesNotMatch(source, /maps_select_result[^]*while \(true\)/);
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

test("WebSocket upgrade keeps transport selection Handoff-owned across the public gateway", () => {
  const server = read("src/server.ts");
  const index = read("src/index.ts");
  const gatewayServer = read("reference/oauth-gateway/server.mjs");
  const gatewayProxy = read("reference/oauth-gateway/proxy.mjs");
  const mapsOwned = `${server}\n${index}\n${gatewayServer}\n${gatewayProxy}`;

  assert.match(server, /managedFallback: config\.credentialSafeHandoff\.managedFallback/);
  assert.match(index, /httpServer\.on\("upgrade"/);
  assert.match(gatewayServer, /server\.on\("upgrade"/);
  assert.match(gatewayProxy, /proxyTakeoverUpgrade/);
  assert.match(gatewayProxy, /x-mcp-handoff-fallback/);
  for (const forbidden of [
    "websocket_relay",
    "MCP_HANDOFF_CLOUDFLARE_TURN_KEY_ID",
    "MCP_HANDOFF_CLOUDFLARE_TURN_KEY_API_TOKEN",
    "iceTransportPolicy"
  ]) {
    assert.equal(
      mapsOwned.includes(forbidden),
      false,
      `Maps/gateway must not select Handoff transport via ${forbidden}`
    );
  }
});

test("readiness, MCP, and takeover paths use the configured HTTP auth provider", () => {
  const indexSource = read("src/index.ts");
  const authSource = read("src/auth-provider.ts");

  assert.match(indexSource, /createHttpAuthProvider\(config\)/);
  assert.match(indexSource, /requestUrl\.pathname === "\/readyz"/);
  assert.match(indexSource, /isTakeoverHttpPath\(requestUrl\.pathname\)/);
  assert.match(indexSource, /authorizeRequest\(authProvider, req, res, requestUrl\)/);
  assert.match(indexSource, /runWithRequestPrincipal\(principal/);
  assert.match(indexSource, /authorizeUpgradeRequest\(authProvider, req, requestUrl\)/);
  assert.match(indexSource, /handleTakeoverUpgradeRequest\(req, socket, head\)/);
  assert.match(authSource, /bearerAllowed\(request\.headers\.authorization, expectedToken\)/);
  assert.match(authSource, /www-authenticate/);
  assert.match(authSource, /createAuthProvider/);
});

test("reference Cloud Run image provisions the bounded Linux normal-browser WebRTC surface", () => {
  const dockerfile = read("reference/oauth-gateway/Dockerfile");
  const entrypoint = read("reference/oauth-gateway/entrypoint.sh");

  assert.match(dockerfile, /xvfb/);
  assert.match(dockerfile, /openbox/);
  assert.match(dockerfile, /xdotool/);
  assert.match(dockerfile, /ffmpeg/);
  assert.match(dockerfile, /fonts-noto-cjk/);
  assert.match(dockerfile, /build-linux-xtest-helper\.sh/);
  assert.match(dockerfile, /build-linux-atspi-helper\.sh/);
  assert.match(dockerfile, /dist\/native\/mcp-handoff-linux-xtest-helper/);
  assert.match(dockerfile, /dist\/native\/mcp-handoff-linux-atspi-helper/);
  assert.match(dockerfile, /MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99/);
  assert.match(dockerfile, /MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE=\/app\/node_modules\/\.bin\/handoff-linux-webrtc-host/);
  assert.match(dockerfile, /XDG_RUNTIME_DIR=\/tmp\/maps-browser-mcp\/xdg-runtime/);
  assert.match(dockerfile, /chmod 1777 \/tmp\/\.X11-unix/);
  assert.match(dockerfile, /chmod 700 \/tmp\/maps-browser-mcp\/xdg-runtime/);
  assert.doesNotMatch(dockerfile, /xclip/);

  assert.match(entrypoint, /MAPS_CREDENTIAL_SAFE_TRANSPORT:-external.*webrtc_takeover/);
  assert.match(entrypoint, /Xvfb "\$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -ac/);
  assert.match(entrypoint, /openbox --sm-disable/);
  assert.match(entrypoint, /\/tmp\/\.X11-unix\/X\$\{display_number\}/);
  assert.match(entrypoint, /kill -0 "\$xvfb_pid"/);
  assert.match(entrypoint, /kill -0 "\$openbox_pid"/);
  assert.match(entrypoint, /cleanup_graphics/);
  assert.match(entrypoint, /wait-for-core\.mjs/);
  assert.match(entrypoint, /private core failed readiness before public startup/);
  assert.match(entrypoint, /kill -0 "\$core_pid"/);
  assert.ok(entrypoint.indexOf("wait-for-core.mjs") < entrypoint.indexOf("server.mjs &"));
  assert.doesNotMatch(entrypoint, /remote-debugging|enable-automation|headless=new/);
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

test("runtime images install CJK system font fallback for Chromium UI", () => {
  assert.match(read("Dockerfile"), /fonts-noto-cjk/);
  assert.match(read("reference/oauth-gateway/Dockerfile"), /fonts-noto-cjk/);
});


test("Linux normal-browser WebRTC acceptance is a checked-in container gate", () => {
  const harness = read("scripts/linux-webrtc-container-acceptance.mjs");
  const dockerfile = read("reference/oauth-gateway/Dockerfile");
  const workflow = read(".github/workflows/ci.yml");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.["acceptance:linux:webrtc:container"], "node scripts/linux-webrtc-container-acceptance.mjs");
  assert.match(dockerfile, /COPY scripts\/linux-webrtc-container-acceptance\.mjs \.\/scripts\/linux-webrtc-container-acceptance\.mjs/);
  assert.match(workflow, /Linux normal-browser WebRTC container acceptance/);
  assert.match(workflow, /\/app\/scripts\/linux-webrtc-container-acceptance\.mjs/);
  assert.match(harness, /kind: "key", key: "Backspace"/);
  assert.match(harness, /typedLength === marker\.length - 1/);
  assert.match(harness, /fc-match/);
  assert.match(harness, /Noto \(\?:Sans\|Serif\) CJK/);
  assert.match(harness, /markerInAnyProcess/);
  assert.doesNotMatch(harness, /pid,ppid,stat,comm,args/);
  assert.doesNotMatch(harness, /CLEANUP_DIAG error=/);
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


test("reference Linux WebRTC container uses the pinned Handoff package binary and isolated X11 runtime", () => {
  const dockerfile = fs.readFileSync(path.join(root, "reference/oauth-gateway/Dockerfile"), "utf8");
  const entrypoint = fs.readFileSync(path.join(root, "reference/oauth-gateway/entrypoint.sh"), "utf8");
  assert.match(dockerfile, /MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE=\/app\/node_modules\/\.bin\/handoff-linux-webrtc-host/);
  assert.match(dockerfile, /xvfb openbox xdotool ffmpeg/);
  assert.match(dockerfile, /MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99/);
  assert.match(entrypoint, /Xvfb "\$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -ac/);
  assert.match(entrypoint, /openbox --sm-disable/);
  assert.doesNotMatch(dockerfile, /mcp-handoff-linux-webrtc-host/);
});
