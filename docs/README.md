# Documentation

[English README](../README.md) | [日本語ドキュメント](README.ja.md)

Documentation index for `maps-browser-mcp`.

## Getting started

- [Getting Started](getting-started.md) — installation, first run, stdio / HTTP, V3 opt-in, Remote MCP shape, shutdown and cleanup
- [Container / headless Linux](container.md) — standard Linux containers, headless Chromium, ports, profiles, readiness and sandbox boundaries
- [Troubleshooting](troubleshooting.md) — error codes and safe recovery procedures
- [ChatGPT connection notes](chatgpt.md) — ChatGPT App / Remote MCP boundary, authentication and tool refresh
- [OAuth gateway pattern](oauth-gateway.md) — external OAuth resource-server boundary for remote MCP clients while keeping identity/OAuth protocol concerns outside the browser runtime
- [Usage modes and examples](use-cases.md) — when to use navigation-only vs. bounded interactive assist, with local and remote examples
- [MCP Apps portability](mcp-apps.md) — host-neutral contract, fallback behavior, layout/lifecycle hardening, deployment security and compatibility evidence
- [V5 authenticated workflows](v5-authenticated-workflows.md) — design-only account boundary, staged saved-state scope, approval gates and explicit authenticated non-goals
- [Roadmap](roadmap.md) — completed V4 Google Maps Web baseline, MCP Apps portability status, and future direction
- [V4 Google Maps Web Capability Inventory](maps-web-capability-inventory.md) — canonical unauthenticated Maps Web coverage table, priorities, implementation slices, login-required boundary, and explicit non-goals

## Design and safety

- [Architecture](architecture.md) — process model, CDP, semantic interaction, bounded V3/V4 reader/controller and HTTP boundary
- [Project positioning](positioning.md) — competitive category, Maps Web coverage priority, and official-interface overlap policy
- [Compliance / Safety](compliance.md) — intended use, non-goals, policy boundaries and live-E2E policy
- [Security Policy](../SECURITY.md) — exposure boundaries, sensitive information and private vulnerability reporting

## Releases and development

- [Releases and versioning](releases.md) — latest stable release, stable tag checkout, `main` behavior, npm status and validation record
- [Changelog](../CHANGELOG.md) — notable changes by public release
- [Manual Live E2E](manual-e2e.md) — explicit user-triggered live Google Maps compatibility check
- [Release Checklist](release.md) — pre-release and post-release procedure
- [Contributing](../CONTRIBUTING.md) — accepted scope, non-goals, tests and pull-request rules
- [Code of Conduct](../CODE_OF_CONDUCT.md) — collaboration and moderation expectations

## Language policy

The English documents are maintained as the specification-oriented source. Japanese counterparts are provided for users and should remain synchronized. When wording differs, prefer the code, tests, and latest English documentation.
