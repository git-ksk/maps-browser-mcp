# Vendored mcp-usage-control packages

These tarballs are vendored because the project is not published to npm yet.
They were packed from `git-ksk/mcp-usage-control` tag `v0.7.0`, commit
`bf4a6df`.

- `mcp-usage-control` — scalar transactional reservation/liability/settlement contract
- `mcp-usage-control-firestore` — server-side Firestore transactional UsageStore

Maps Browser MCP intentionally uses the scalar contract for one-unit browser-operation
accounting. The optional v0.6 progressive-growth and v0.7 vector APIs do not widen the
browser execution or Human-handoff authority boundary.
