# Contributing

Thanks for contributing to `maps-browser-mcp`.

This project intentionally keeps a narrow scope: user-directed Google Maps interaction through a dedicated browser session, with a small MCP tool surface and explicit safety boundaries.

## Before opening a change

Please read:

- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/compliance.md](docs/compliance.md)
- [SECURITY.md](SECURITY.md)

For setup and debugging:

- [Getting Started](docs/getting-started.md)
- [Troubleshooting](docs/troubleshooting.md)

## Scope

Good contributions include:

- fixing Google Maps UI compatibility within the existing semantic tools,
- improving Chrome/CDP reliability and cross-platform behavior,
- tightening security/policy boundaries,
- improving MCP protocol compatibility,
- tests, documentation, accessibility, and error handling,
- performance improvements that do not broaden collection behavior.

Changes that are intentionally out of scope include:

- generic browser-control tools such as arbitrary `click`, `type`, DOM queries, or JavaScript execution exposed to MCP clients,
- Google Maps internal/undocumented API interception,
- XHR/fetch harvesting,
- bulk scraping/crawling or dataset extraction,
- review harvesting,
- CAPTCHA solving or bypass,
- stealth/fingerprint spoofing,
- proxy rotation for bot-evasion purposes,
- multi-tenant shared-browser hosting without a separate security architecture.

If a proposal changes these boundaries, discuss it first rather than opening a large implementation PR.

## Development setup

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

Useful commands:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

The browser smoke test starts a real Chrome/Chromium process but does not visit Google Maps.

## Branches and pull requests

`main` is protected. Make changes on a branch and open a pull request.

Keep PRs focused. A reviewer should be able to answer:

1. What behavior changes?
2. Which safety/security boundary is affected?
3. How is the change tested?
4. Does it require a live Maps compatibility run?
5. Does documentation/configuration need updating?

Do not force-push or bypass required checks on `main` to land a change.

## Required checks

The protected branch currently requires the repository's Node, cross-platform browser, and CodeQL checks. CI covers:

- Node.js 20 / 22 / 24,
- dependency audit,
- type checking,
- unit tests,
- build,
- stdio MCP smoke,
- Streamable HTTP MCP smoke,
- Chrome/CDP smoke,
- package dry-run checks,
- macOS and Windows browser startup,
- CodeQL JavaScript/TypeScript analysis.

GitHub Actions dependencies are pinned to immutable commit SHAs and monitored by Dependabot.

## Tests

Add or update tests for behavioral changes whenever practical.

Prefer deterministic tests that do not call Google Maps. Normal CI must remain independent of the live Maps website.

For live UI-dependent changes, use the manual-only workflow described in [docs/manual-e2e.md](docs/manual-e2e.md). Do not add scheduled or push-triggered Maps crawling.

## Google Maps UI changes

Semantic selectors should remain:

- narrowly scoped to the current Maps surface,
- bounded in result count,
- shared between read/select paths where consistency matters,
- guarded with `expectedLabel` when selecting dynamic candidates,
- fail-closed when state is ambiguous.

Do not replace a broken semantic selector with broad DOM dumping or generic browser primitives.

## Security-sensitive code

Take extra care when changing:

- URL/host/path allowlists,
- HTTP binding/authentication,
- Host/Origin handling,
- CDP endpoint handling,
- browser profile isolation,
- challenge/CAPTCHA detection,
- operation queue/watchdog behavior,
- V3 read bounds,
- untrusted text handling.

Security changes should fail closed when uncertain.

For vulnerabilities, do not open a detailed public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub Private Vulnerability Reporting.

## Dependencies

Avoid adding a dependency when Node.js or the existing stack can do the job cleanly.

When adding/updating dependencies:

- explain why the dependency is needed,
- keep runtime dependencies minimal,
- update the lockfile,
- run the audit/check/build path,
- consider lifecycle scripts and supply-chain implications.

Do not weaken `npm ci --ignore-scripts` CI behavior without a concrete requirement and review.

## Documentation

Update docs in the same PR when you change:

- tool names/input schemas,
- environment variables/defaults,
- install/start commands,
- error behavior,
- supported Node/browser/platform assumptions,
- ChatGPT/remote connection behavior,
- safety/compliance boundaries.

Keep `README.md` and `README.ja.md` aligned on user-visible functionality.

## Commit and PR hygiene

Do not commit:

- `.env` files,
- tokens or credentials,
- browser profiles/cookies,
- local machine paths containing personal information,
- screenshots/traces/logs containing account or location data,
- generated Maps datasets.

Use a GitHub noreply email if you do not want a personal email address exposed in public commit metadata.

## Release-related changes

If your PR is part of a release, follow [docs/release.md](docs/release.md).

Do not advertise npm installation until the package is actually published and verified.
