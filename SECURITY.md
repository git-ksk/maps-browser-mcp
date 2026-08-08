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

## Safe deployment

If you expose `/mcp` through a tunnel or reverse proxy:

1. keep the Node process on loopback where possible,
2. authenticate the public endpoint,
3. restrict the allowed Host/Origin values,
4. do not expose a Chrome DevTools port publicly,
5. do not reuse your everyday Chrome profile,
6. rotate any token immediately if it is accidentally exposed.

A non-loopback `MCP_HTTP_HOST` always requires `MCP_BEARER_TOKEN`. Authentication performed by a front proxy is not accepted as a reason to leave a directly reachable non-loopback Node port unauthenticated.

Chrome instances launched by this project bind remote debugging to `127.0.0.1`. `MAPS_CDP_PORT` is rejected unless `MAPS_ALLOW_EXTERNAL_CDP=true` is also set, and should only point to a local, dedicated Chrome/Chromium instance you control. CDP provides powerful browser access and must not be exposed to untrusted networks.

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
- private location history,
- personal email addresses or other identifying account data.

The repository intentionally ignores common environment/profile/runtime files. Review staged changes before publishing them.

## Dependency and CI security

GitHub Actions used by this repository are pinned to full commit SHAs. Dependabot monitors npm and GitHub Actions dependencies. CI uses `npm ci --ignore-scripts`, runs `npm audit --audit-level=moderate`, and tests Chrome/CDP startup without visiting Google Maps on Linux, macOS, and Windows runners.

## Reporting a vulnerability

Do not publish secrets or exploit details in a public issue.

Prefer GitHub's private vulnerability reporting / Security Advisory flow when available for this repository. If no private reporting option is available, open a minimal public issue stating that you have a security report, without including exploit details or secrets, so a private channel can be established.

## Supported versions

The project is currently pre-1.0. Security fixes are applied to the latest `main` branch. Older snapshots are not guaranteed to receive backports.
