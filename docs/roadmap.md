# Roadmap

[日本語](roadmap.ja.md) | [Documentation](README.md)

This roadmap records likely directions for `maps-browser-mcp`. It is not a commitment to ship every item. The project should continue to prefer small, user-directed workflows and supported structured interfaces when those already satisfy the use case.

## Current baseline

The current server intentionally separates two operating modes:

- **Navigation-only** — open Google Maps search, directions, map, and Street View surfaces without reading rendered Maps content.
- **Interactive Assist** — optionally read a small, bounded summary of the active route/place UI and select a current candidate using `index + expectedLabel`.

The existing browser path remains bounded and is not intended for bulk collection, crawling, review harvesting, or persistent Maps-derived datasets. See [Usage modes and examples](use-cases.md) and [Compliance / Safety](compliance.md).

## Near-term direction

### 1. Keep route/place reading useful but bounded

Improve semantic quality where it can be done without widening the extraction boundary. Candidate areas include:

- clearer structured route fields when already visible in the active UI,
- clearer structured place fields when already visible in the active UI,
- preserving the existing read budgets and response-size limits,
- continuing to fail closed when the Maps UI changes unexpectedly.

### 2. Add user-requested route constraints only when they can be expressed safely

Potential examples include departure/arrival time and other supported route options. Prefer official URL/API parameters or other documented interfaces over exploratory DOM automation.

## Future: MCP Apps / optional interactive UI

A future experiment may add an optional interactive UI to the existing MCP server so compatible chat hosts can render a map-oriented view inline while the existing text/tool workflow remains available everywhere.

### Standards position

This should be implemented against the **MCP Apps** extension rather than as a ChatGPT-only UI contract where practical.

MCP Apps is an optional extension to MCP identified by `io.modelcontextprotocol/ui`. It standardizes:

- `ui://` UI resources,
- tool-to-UI linkage through `_meta.ui.resourceUri`,
- HTML resources using `text/html;profile=mcp-app`,
- sandboxed iframe rendering,
- bidirectional host/UI communication through MCP JSON-RPC,
- capability negotiation between host and server.

Host support is not universal. UI must therefore remain a **progressive enhancement**: if a host does not support MCP Apps, the same tools should continue to return useful text/structured results without requiring the UI.

OpenAI's earlier Apps SDK / optional-UI approach helped inform the standardized MCP Apps design, but the roadmap should avoid unnecessary OpenAI-specific coupling so the same server can work with other compliant MCP hosts.

### Proposed Google Maps Embed proof of concept

A small PoC can test whether an MCP Apps View can present an official Google Maps Embed surface alongside the current bounded tool results.

Suggested flow:

```text
user request
  -> maps_directions / maps_search
  -> existing bounded tool result
  -> UI-enabled render tool or UI-linked tool
  -> host reads ui:// resource
  -> sandboxed MCP Apps View
  -> official Google Maps Embed surface
```

Design requirements:

- Keep the existing MCP endpoint and tool behavior as the baseline.
- Keep map rendering separate from browser-based visible-state reading.
- Prefer a dedicated render/UI tool if that keeps data tools simpler and portable.
- Return a useful text fallback for hosts without MCP Apps support.
- Declare only the minimum CSP origins required by the Embed implementation.
- If the View nests an iframe, declare the required origins through MCP Apps `ui.csp.frameDomains`; nested frames are denied by default when not declared.
- Do not treat UI support as permission to widen scraping, crawling, persistence, or review collection.
- Verify Google Maps Embed terms, CSP requirements, and host compatibility again at implementation time.

### Portability validation

Before treating the UI as production-ready, test at least:

1. ChatGPT developer/private-plugin connection using the existing remote MCP URL.
2. One additional MCP Apps-capable host where practical.
3. A host without MCP Apps support to confirm graceful text-only fallback.
4. Mobile and desktop layouts, because the host controls the iframe/container dimensions.

The server should detect/observe negotiated UI capability rather than assuming every MCP client can render the View.

## Explicit non-goals for the roadmap

Future UI work does not change these project boundaries:

- no bulk scraping or crawling,
- no route/place/review dataset harvesting,
- no full DOM or full accessibility-tree extraction,
- no review-body harvesting,
- no undocumented Maps internal API interception,
- no CAPTCHA solving or bot-detection bypass,
- no dependency on a rich UI for core MCP tool functionality.

## References

- [MCP Apps official repository](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
