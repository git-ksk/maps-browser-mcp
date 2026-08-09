# Changelog

All notable public releases of `maps-browser-mcp` are recorded here.

This project is pre-1.0. Until the public API stabilizes, minor and patch releases may include compatibility or safety hardening that users should review before upgrading.

## [v0.1.1] - 2026-08-09

Container/headless portability and release-hardening patch release.

### Added

- Provider-neutral Linux container/headless execution support.
- Non-root Chromium container image.
- Generic `PORT` fallback while keeping `MCP_HTTP_PORT` precedence.
- `/healthz` process liveness endpoint.
- `/readyz` managed Chromium/CDP readiness endpoint that does not navigate to Google Maps.
- Explicit `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` compatibility mode for restricted Linux runtimes.
- Docker dependency monitoring and digest-pinned Node base image.
- Manual-only container execution path for the bounded live Google Maps E2E workflow.

### Changed

- Container validation now runs inside the required Node 22 CI check.
- `/readyz` requires bearer authentication whenever a bearer token is configured.
- Package, lockfile, and MCP server metadata are synchronized at `0.1.1`.
- English and Japanese container/release documentation was expanded.

### Safety / validation

- Chromium sandboxing remains enabled by default; there is no silent downgrade to `--no-sandbox`.
- Restricted-runtime behavior is tested fail-closed.
- Deterministic `HUMAN_INTERVENTION_REQUIRED` challenge-boundary tests were strengthened without adding CAPTCHA/anti-bot bypass behavior.
- Node 20/22/24 CI, macOS browser smoke, Windows browser smoke, container smoke, and CodeQL passed on the release commit.
- Manual container + live Google Maps E2E passed on release commit `27ab7c82e13f19730bb765b5bd6f2dd76c92ba89`.
- The live workflow uploaded no artifacts.

GitHub release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.1

Live validation run: https://github.com/git-ksk/maps-browser-mcp/actions/runs/31310463642

**npm status:** not published.

## [v0.1.0] - 2026-08-09

First public release.

### Added

- Nine Maps-specific MCP tools for search, directions, map display, Street View, semantic selection, travel-mode changes, and bounded visible-state reading.
- stdio and Streamable HTTP transports.
- Dedicated Chrome/Chromium profile isolation and local CDP boundary.
- Google Maps-only navigation policy.
- Bounded V3 place/route summaries with `untrustedExternalText: true`.
- `index + expectedLabel` guards and stale-state rejection with `UI_STATE_CHANGED`.
- Human-intervention boundary for consent, sign-in, CAPTCHA, and challenge flows.
- Bounded queues, operation watchdogs, guarded external CDP attachment, and rate/read safety limits.
- English and Japanese documentation.

### Validation

- Node 20/22/24 CI, macOS and Windows browser smoke, and CodeQL passed.
- User-directed live Google Maps E2E passed on Apple Silicon macOS.

GitHub release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.0

**npm status:** not published.

## Versioning notes

- GitHub Releases are the authoritative public release records.
- `main` may contain unreleased work after the latest tag.
- For a reproducible stable checkout, use a release tag rather than assuming `main` is identical to the latest release.
- Existing release tags are not rewritten. Security-sensitive fixes should ship as a new patch release.
