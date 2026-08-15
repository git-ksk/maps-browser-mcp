# Roadmap

[日本語](roadmap.ja.md) | [Documentation](README.md) | [V4 capability inventory](maps-web-capability-inventory.md)

This roadmap records likely directions for `maps-browser-mcp`. It is not a commitment to ship every item. The project should continue to prefer small, user-directed workflows. Supported structured interfaces remain preferred when the rendered Google Maps Web experience is not required, but overlap with an official interface is a priority signal rather than an automatic browser-scope exclusion.

## Current baseline

The current server intentionally separates two operating modes:

- **Navigation-only** — open Google Maps search, directions, map, and Street View surfaces without reading rendered Maps content.
- **Interactive Assist** — optionally read a small, bounded summary of the active route/place UI and perform Maps-specific semantic interactions with current-state/identity validation.

The existing browser path remains bounded and is not intended for bulk collection, crawling, review harvesting, or persistent Maps-derived datasets. See [Usage modes and examples](use-cases.md) and [Compliance / Safety](compliance.md).

## V4 — broad unauthenticated Google Maps Web semantic coverage

V4 is defined as:

> **Broad semantic coverage of major Google Maps Web capabilities available without authentication.**

The canonical feature-by-feature scope and coverage table is [Google Maps Web Capability Inventory](maps-web-capability-inventory.md).

**V4-F coverage closeout completed on 2026-08-15.** The current unauthenticated high/normal-priority rows are either implemented, structurally covered by an existing semantic operation, or explicitly observation/design-gated with a recorded re-open condition. UI-dependent operations remain experimental compatibility surfaces rather than permanent-selector guarantees.

Priority order:

1. browser-native / UI-dependent Maps Web capabilities,
2. search / directions / place operations required to complete a browser workflow,
3. capabilities whose value mostly overlaps an official structured interface.

The browser surface must still remain Maps-specific. V4 does **not** expose raw DOM, raw Accessibility Tree, raw CDP, pointer primitives, generic browser automation, desktop automation, or shell execution through MCP.

V4 is split into reviewable slices:

- **V4-A** — canonical inventory and reusable semantic identity/stale-state primitives,
- **V4-B** — place workflow: share link, nearby, photos, bounded panel interactions,
- **V4-C** — search and map viewport: filters, search-this-area, current location, semantic layers,
- **V4-D** — directions UI: departure/arrival and transit options, route sharing, route editing/details,
- **V4-E** — Street View entry and Maps-specific semantic navigation,
- **V4-F** — bounded live compatibility closeout and final coverage table.

Login-required capability stays out of V4 and moves to V5. Consent, sign-in, CAPTCHA, or access challenges that occur naturally continue to stop at the existing Human Intervention boundary; they are never bypassed and completing human intervention does not approve a different semantic action.

Maps now consumes the extracted `mcp-execution-handoff` upstream at an immutable pre-release commit; the full two-adapter upstream-validation track with Japan Cinema remains separate. This integration does not generalize the Maps server into a browser/desktop/shell MCP.

### First V4 implementation slice

`maps_get_place_share_link(expectedLabel)` is the first V4 browser-native semantic operation. It uses the currently selected place only, revalidates the active place identity immediately before activating the visible Share control, accepts only bounded Google Maps share URLs, and fails closed on missing/ambiguous targets. The operation remains behind Interactive Assist and the visible-read/action budgets.

## Near-term direction

### 1. Keep route/place reading useful but bounded

The bounded summary path adds conservative semantic annotations for signals already present in accepted visible text (for example route duration/departure/arrival or place rating/open status) without widening the existing read boundary. Continue improving semantic quality only where the same extraction boundary can be preserved.

Current invariants:

- keep the existing read budgets, candidate limits, AX depth, node limits, line limits, and response-size limits,
- keep the raw bounded labels/text as the source of truth and treat them as untrusted external data,
- avoid guessing semantics from ambiguous numbers or times without an explicit visible cue,
- continue to fail closed when the Maps UI changes unexpectedly.

### 2. Use documented URLs for structured routing, semantic UI controls for browser-native routing options

The structured route path continues to use documented Google Maps URL parameters rather than guessed web parameters. The bounded URL-backed route-option surface includes:

- ordered `waypoints` (capped at three),
- `avoid` values limited to `ferries`, `highways`, and `tolls`,
- preserving those constraints when the active travel mode is changed.

Departure/arrival time and transit preference controls are important unauthenticated Maps Web capabilities, but they are not represented by the documented Google Maps URLs directions parameters used by this project. V4 may therefore support them through **bounded, visible Maps-specific semantic controls with postcondition/identity validation**. Do not invent undocumented URL parameters, intercept internal Maps APIs/XHR, or expose generic DOM automation to reach them.

## MCP Apps / optional interactive UI

An MCP Apps proof of concept is validated for inline Google Maps directions rendering while the existing text/tool workflow remains available as the baseline. The UI remains experimental until the remaining portability work is complete.

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

### Validated Google Maps Embed proof of concept

The initial PoC successfully rendered an official Google Maps Embed directions surface inside ChatGPT using the existing Remote MCP URL connection. No separate UI endpoint or special connection mechanism was required: the host discovered the `ui://` resource through the same MCP server.

Validated flow:

```text
user request
  -> existing data/navigation tools as needed
  -> maps_render_directions
  -> host reads ui:// resource
  -> sandboxed MCP Apps View
  -> official Google Maps Embed surface
```

Validated PoC status:

- `maps_render_directions` is a display-only render tool linked to `ui://maps-browser-mcp/directions.html`.
- The View uses `text/html;profile=mcp-app` and the MCP Apps lifecycle.
- The nested Google Maps Embed iframe renders successfully in ChatGPT Web through the existing Remote MCP connection.
- The tool continues to return text and structured content so hosts that ignore the UI metadata still receive a useful result.
- When the Embed feature is configured, the server advertises the standard `io.modelcontextprotocol/ui` extension with `text/html;profile=mcp-app` through MCP extension capabilities.
- Stdio smoke coverage validates both a client without the UI extension receiving the text/structured fallback and a client declaring the UI extension exercising the `ui://` resource path.
- V4 adds Maps-specific browser tools without changing the MCP Apps render boundary.
- The real Google Maps Embed API key is deployment configuration only and must never be committed to the repository. Use a dedicated restricted key and a deployment secret/environment mechanism.

Design requirements that remain in force:

- Keep the existing MCP endpoint and established tool behavior as the baseline.
- Keep map rendering separate from browser-based visible-state reading/interaction.
- Prefer a dedicated render/UI tool if that keeps data tools simpler and portable.
- Return a useful text fallback for hosts without MCP Apps support.
- Declare only the minimum CSP origins required by the Embed implementation.
- If the View nests an iframe, declare the required origins through MCP Apps `ui.csp.frameDomains`; nested frames are denied by default when not declared.
- Do not treat UI support as permission to widen scraping, crawling, persistence, or review collection.
- Verify Google Maps Embed terms, CSP requirements, and host compatibility again at implementation time.

### Remaining portability validation

Before treating the UI as production-ready, complete the remaining checks:

1. Validate one additional MCP Apps-capable host where practical.
2. Validate the text-only fallback in a second real non-MCP-Apps host where practical; the protocol-level fallback is already covered by smoke tests.
3. Validate supported host layouts and container sizing beyond the successful ChatGPT Web PoC.

The successful ChatGPT Web render closes the original feasibility question. MCP extension advertisement, negotiated-client smoke coverage, and the text/structured fallback are now covered; the remaining items are cross-host portability and hardening work.

## Explicit non-goals for the roadmap

V4 coverage and future UI work do not change these project boundaries:

- no bulk scraping or crawling,
- no route/place/review dataset harvesting,
- no full DOM or full accessibility-tree extraction,
- no review-body harvesting,
- no undocumented Maps internal API interception,
- no CAPTCHA solving or bot-detection bypass,
- no raw DOM / raw CDP / generic browser MCP surface,
- no dependency on a rich UI for core MCP tool functionality.

## References

- [V4 Google Maps Web Capability Inventory](maps-web-capability-inventory.md)
- [MCP Apps official repository](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)