# Releases and versioning

This page explains how to choose between a stable release and the current `main` branch.

## Latest stable release

The release baseline documented here is **v0.3.1**. The GitHub tag/Release is the authoritative record for the exact tested release commit.

- Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.3.1
- Draft: no
- Prerelease: no
- npm: **not published**

v0.3.1 documents the already-implemented V5 tool surface in the top-level READMEs and adds repository-policy coverage preventing registered tools from disappearing from either README. v0.3.0 added the bounded V5 authenticated-workflow slices (A–D) behind the existing fail-closed opt-in, completed the clean external OAuth/MCP Runtime reference path and ChatGPT dogfood migration, and hardened remote/headless bounded reads. V5 remains disabled by default, account-backed automation remains single-user/dedicated-profile only, and npm remains unpublished.

For the detailed release history, see [CHANGELOG.md](../CHANGELOG.md).

## Stable checkout

If you want the exact source that was validated and released, check out the release tag:

```bash
git clone --branch v0.3.1 --depth 1 https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

Then start stdio:

```bash
npm start
```

or Streamable HTTP:

```bash
npm run start:http
```

Using a release tag avoids accidentally picking up unreleased changes that may later land on `main`.

## Using `main`

Use `main` when you intentionally want the newest merged development state.

`main` is protected and changes land through required CI/CodeQL checks, but it may move ahead of the latest public tag. Do not assume that a commit on `main` has been published as a GitHub Release.

For contributors, branch from the current `main` unless a maintainer explicitly asks for a release-branch fix.

## v0.3.1 validation record

v0.3.1 is a documentation/version-metadata patch: it changes no Maps navigation, browser-control, OAuth, or V5 action semantics. The exact release commit must still pass Node.js 20/22/24 required CI, macOS/Windows browser smoke, CodeQL, package/repository policy checks, and local stdio/HTTP/browser/package release validation.

A new Live Maps E2E run is intentionally not required for this documentation-only patch under the release checklist; the v0.3.0 exact-release container Live Maps baseline was green immediately before this patch and no runtime behavior changed.

## v0.3.0 validation record

The release procedure requires the exact v0.3.0 release commit to pass Node.js 20/22/24 required CI, macOS/Windows browser smoke, CodeQL, package/repository policy checks, and the bounded manual Live Maps compatibility path appropriate to this runtime release. The exact commit and workflow run are recorded in the GitHub Release rather than hard-coded here before the protected-branch merge exists.

Remote dogfood acceptance also includes the clean MCP Runtime OAuth deployment, ChatGPT reconnect/tool execution, bounded headless reads, and verified retirement of the historical Monokura-derived Maps services after traffic observation. V5 account-backed tools remain opt-in and disabled on the public dogfood deployment.

## v0.2.0 validation record

The release procedure requires the exact v0.2.0 release commit to pass Node.js 20/22/24 required CI, macOS/Windows browser smoke, CodeQL, package/repository policy checks, and the fixed manual-only Live Maps E2E representative path. The exact commit and workflow run are recorded in the GitHub Release rather than hard-coded here before the protected-branch merge exists.

The representative live path is intentionally bounded: one autocomplete read/select, one search-share check, a representative place workflow, and one fresh simple transit route with Recommended/Best followed by guarded route read/select. It is not a crawler or a capability-by-capability sweep.

## v0.1.1 validation record

The v0.1.1 release commit passed:

- Node.js 20 / 22 / 24 CI
- macOS browser smoke
- Windows browser smoke
- container image build and runtime checks
- sandboxed Chromium/CDP smoke
- restricted-runtime fail-closed checks
- explicit restricted-runtime compatibility smoke
- HTTP liveness, authenticated browser readiness, and `PORT` fallback checks
- CodeQL with zero findings

The manual-only container + live Google Maps E2E also passed on the release commit:

- Workflow run: https://github.com/git-ksk/maps-browser-mcp/actions/runs/31310463642
- Runtime: container
- Chromium sandbox: enabled
- `MAPS_ALLOW_UNSANDBOXED_CHROMIUM`: not used
- `--no-sandbox`: not used
- Workflow artifacts: none

The live workflow intentionally performs only the repository's fixed, bounded place-search and transit-route scenarios. It does not become part of normal push/PR CI.

## What is not distributed

There is currently no published npm package for this project. Do not rely on commands such as:

```text
npm install maps-browser-mcp
```

unless a future release explicitly states that npm publication has been completed and verified.

The repository also does not publish a hosted multi-user Maps service. The project remains designed around bounded, user-directed, single-user/self-hosted use.

## Release policy

- Existing public release tags are not rewritten.
- Fixes after a release should use a new patch version rather than moving an existing tag.
- Package metadata, lockfile root metadata, and MCP server version must stay synchronized before tagging.
- Normal CI does not visit Google Maps.
- Live Maps compatibility checks remain explicit, manual-only, bounded, and non-persistent.
- CAPTCHA, consent, sign-in, or access challenges are never deliberately triggered or bypassed.

See [Release checklist](release.md) for the full pre-release and post-release procedure.
