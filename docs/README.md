# Documentation

[English README](../README.md) | [日本語ドキュメント](README.ja.md)

Documentation index for `maps-browser-mcp`.

## Getting started

- [Getting Started](getting-started.md) — installation, first run, stdio / HTTP, V3 opt-in, Remote MCP shape, shutdown and cleanup
- [Container / headless Linux](container.md) — standard Linux containers, headless Chromium, ports, profiles, readiness and sandbox boundaries
- [Troubleshooting](troubleshooting.md) — error codes and safe recovery procedures
- [ChatGPT connection notes](chatgpt.md) — ChatGPT App / Remote MCP boundary, authentication and tool refresh
- [Usage modes and examples](use-cases.md) — when to use navigation-only vs. bounded interactive assist, with local and remote examples
- [Roadmap](roadmap.md) — portable MCP Apps / optional UI, including the validated Google Maps Embed directions PoC and remaining portability work

## Design and safety

- [Architecture](architecture.md) — process model, CDP, semantic interaction, bounded V3 reader and HTTP boundary
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
