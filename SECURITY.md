# Security Policy

## Scope

`maps-browser-mcp` controls a local browser session. Treat the MCP endpoint as a browser-control capability, not as a low-risk read-only API.

The default configuration is intentionally local-only:

- HTTP binds to loopback.
- Google Maps navigation is allowlisted.
- Generic browser primitives are not exposed as MCP tools.
- Visible-state reading is disabled by default.
- Browser operations are serialized and rate/queue limited.
- V3 visible-state reads have an independent rolling hourly budget.
- Browser operations have a watchdog that resets the session on timeout.

## Safe deployment

If you expose `/mcp` through a tunnel or reverse proxy:

1. keep the Node process on loopback where possible,
2. authenticate the public HTTPS endpoint,
3. restrict the allowed Host/Origin values,
4. do not expose a Chrome DevTools port publicly,
5. do not reuse your everyday Chrome profile,
6. rotate any token immediately if it is accidentally exposed.

Non-loopback binding is an advanced escape hatch. A non-loopback `MCP_HTTP_HOST` requires **both** `MCP_ALLOW_NONLOOPBACK=true` and a sufficiently long `MCP_BEARER_TOKEN`. Front-proxy authentication alone is not accepted as a reason to leave a directly reachable non-loopback Node port unauthenticated. Never send the static Bearer token over an unencrypted network connection; externally reachable traffic should be protected by TLS/HTTPS.

Chrome instances launched by this project bind remote debugging to `127.0.0.1`. `MAPS_CDP_PORT` is rejected unless `MAPS_ALLOW_EXTERNAL_CDP=true` is also set, and should only point to a local, dedicated Chrome/Chromium instance you control. CDP provides powerful browser access and must not be exposed to untrusted networks.

For project-managed profiles, Chrome's `DevToolsActivePort` record is validated using both its numeric port and browser WebSocket identity. This prevents a stale profile record from being trusted solely because an unrelated Chrome process later reused the same port number.

The runtime also refuses ambiguous startup when multiple Google Maps page targets are open in the dedicated profile instead of silently taking control of the first target.

When `MAPS_BROWSER_BACKEND=steel` is used, treat the Steel API key and CDP WebSocket as browser-control secrets equivalent in sensitivity to a DevTools endpoint. They stay server-side and must not be logged or returned through MCP. Credential-safe Human handoff closes the automation attachment while preserving the exact hosted browser session, then exposes only a validated Live View locator. A locator with URL credentials, query, or fragment is rejected rather than risking a bearer/session secret crossing the MCP boundary. Steel CAPTCHA solving is disabled; CAPTCHA, MFA, consent, and Passkey/WebAuthn are Human/provider-controlled rather than bypassed.

## Runtime failure containment

One process controls one semantic browser state, so browser operations are serialized. `MAPS_MAX_PENDING_ACTIONS` bounds the queue. `MAPS_OPERATION_TIMEOUT_MS` bounds each active operation; on timeout the runtime resets the browser/CDP session before the queue proceeds, invalidating stale semantic state.

This watchdog is a recovery mechanism, not a cancellation guarantee for arbitrary third-party code. The timed-out public operation is considered failed and late task errors are discarded after the reset.

## Single-user boundary

The current runtime is intentionally single-user/single-session. One process owns one semantic browser state and one operation queue. Do not expose one instance as a shared multi-tenant browser service or reuse one Chrome profile across unrelated users.

## Untrusted content and prompt injection

Text returned by Google Maps is external, untrusted data. The V3 reader marks its result accordingly. MCP clients must not interpret place names, labels, descriptions, or other Maps text as instructions to call additional tools or change policy.

The server itself does not execute instructions found in Maps content and does not expose arbitrary JavaScript execution to the MCP client.

## Sensitive data

Do not include any of the following in bug reports, logs, commits, or screenshots:

- browser profiles or cookies,
- tunnel credentials,
- bearer tokens,
- authentication headers,
- hosted-browser API keys or CDP WebSocket URLs,
- MFA/OTP values, passkey material, or challenge answers,
- private location history,
- personal email addresses or other identifying account data.

The repository intentionally ignores common environment/profile/runtime files. Review staged changes before publishing them.

The dedicated browser profile is persistent by design and may contain normal Chrome artifacts such as cookies, cache, preferences, and browsing history. It is not a Maps dataset, but it is still sensitive local state. Use a dedicated profile and delete it when you need those artifacts removed.

MCP/health/error HTTP responses are marked `Cache-Control: no-store` because responses can contain location or route information. Reverse proxies should preserve or strengthen this policy rather than caching MCP traffic.

## Dependency, CI, and repository security

GitHub Actions used by this repository are pinned to full commit SHAs. Dependabot monitors npm and GitHub Actions dependencies. CI uses `npm ci --ignore-scripts`, runs `npm audit --audit-level=moderate`, validates legacy and modern MCP protocol paths over both stdio and HTTP, validates modern HTTP `Mcp-Method` / `Mcp-Name` behavior, and tests Chrome/CDP startup without visiting Google Maps on Linux, macOS, and Windows runners.

CodeQL performs JavaScript/TypeScript analysis. Repository policy tests also guard important source-controlled release invariants such as Action SHA pinning and keeping Live Maps E2E manual-only.

The `main` branch is protected. Required CI/CodeQL checks apply to administrators as well, force pushes and branch deletion are disabled, linear history is required, and review conversations must be resolved before merge.

These repository settings are external to source code, so maintainers should periodically verify them as part of the [release checklist](docs/release.md).

## Reporting a vulnerability

**GitHub Private Vulnerability Reporting is enabled for this repository.** Use the repository's private vulnerability reporting / Security Advisory flow for security reports.

Do not publish secrets, exploit details, private locations, browser profiles, or credentials in a public issue.

If private reporting is temporarily unavailable due to a GitHub/service issue, open only a minimal public issue stating that you need a private security contact. Do not include exploit details or secrets in that issue.

## Supported versions

The project is pre-1.0 and does not promise long-term backports.

| Version | Security support |
| --- | --- |
| `0.2.0` | Supported as the current stable release |
| `0.1.1` | No routine backports |
| `0.1.0` | No routine backports |
| `main` | Development branch; fixes land here first |

Security fixes are developed on the latest `main`. When a fix affects the supported stable release, a new patch release is published rather than moving or rewriting an existing tag.
