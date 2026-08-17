# Changelog

All notable public releases of `maps-browser-mcp` are recorded here.

This project is pre-1.0. Until the public API stabilizes, minor and patch releases may include compatibility or safety hardening that users should review before upgrading.

## [Unreleased]

### Documentation

- Define the pre-v1 completion sequence: v0.3.0 for V5 plus the clean remote-auth foundation, v0.4.0 for MCP Apps production portability, v0.5.0 for reliability/UI-change resilience/observability, and v1.0.0 as stable graduation rather than a final feature dump.
- Define the V5 authenticated-workflows design baseline without enabling implementation: Human-only sign-in, single-user/per-principal browser isolation gate, bounded saved-state reads, save-to-existing-list as the first mutation candidate, explicit ActionApproval before Send to phone, Maps-history privacy gating, and Timeline removal from the desktop Web candidate set.

### Changed

- Harden the experimental MCP Apps directions View against host differences: stable 2026-01-26 host context, safe areas/container sizing, size notifications, cancellation/error cleanup, teardown, and Google-recommended Embed referrer policy.
- Keep `maps_render_directions` available as a text/structured display tool even when the Embed API key is absent; UI resource/linkage/extension advertisement remains conditional.
- Validate the UI pipeline with the official MCP Apps basic reference host and validate the no-UI fallback with the official MCP SDK client. A second production-host real-key render remains explicitly unclaimed, so the UI retains its experimental label.

### Security

- Keep the MCP Apps CSP restricted to the single required Google nested-frame origin and document dedicated/restricted Embed-key deployment. No browser-control or credential surface is added.

## [v0.2.0] - 2026-08-15

V4 unauthenticated Google Maps Web coverage completion and Execution Handoff upstream-consumer minor release.

### Added

- Broad V4 Maps-specific semantic coverage for the current unauthenticated Google Maps Web scope, including bounded place share/nearby/photos/tabs/opening-hours flows, search rating and viewport zoom, same-day transit time, endpoint swap, selected transit-route share, bounded autocomplete read/select, search-result sharing, and Recommended/Best transit selection.
- Experimental MCP Apps directions rendering as a progressive enhancement through `ui://maps-browser-mcp/directions.html`, while retaining useful text/structured fallback behavior for non-UI hosts.
- Canonical V4 capability inventory evidence and explicit observation/design gates with re-open conditions for unsupported or unstable surfaces.

### Changed

- V4 is now closed out for the current unauthenticated scope; no high/normal-priority V4 row remains unresolved.
- Maps consumes `mcp-execution-handoff` as its first real adapter and is synchronized to the immutable upstream v0.1.0 source-release commit after the two-real-adapter validation completed with Japan Cinema.
- The manual Live Maps E2E release path now covers one representative autocomplete/search-share/place workflow and one fresh simple transit workflow with Recommended/Best, while remaining fixed and low-volume.
- Package, lockfile, and MCP server metadata are synchronized at `0.2.0`.

### Safety / compatibility

- Raw browser/CDP/DOM/Accessibility-tree surfaces, generic browser actions, arbitrary navigation, generic text entry, pointer primitives, clipboard dumps, Maps internal API/XHR harvesting, bulk scraping, and review harvesting remain outside the public MCP surface.
- Consent, sign-in, CAPTCHA, and access challenges remain fail-closed Human Intervention boundaries; Human completion is not approval and does not authorize automatic replay of a state-changing action.
- UI-dependent Maps operations and MCP Apps rendering remain compatibility-sensitive/experimental surfaces rather than guarantees against future Google Maps or host UI changes.
- `mcp-execution-handoff` is consumed from its source release; it and `maps-browser-mcp` are not published to npm by this release.

Validation details and the exact release commit/live run are recorded in the GitHub Release for v0.2.0.

**npm status:** not published.

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
