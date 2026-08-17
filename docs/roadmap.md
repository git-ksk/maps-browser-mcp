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

V4 was delivered in reviewable slices:

- **V4-A** — canonical inventory and reusable semantic identity/stale-state primitives,
- **V4-B** — place workflow: share link, nearby, photos, bounded panel interactions,
- **V4-C** — search and map viewport: filters, search-this-area, current location, semantic layers,
- **V4-D** — directions UI: departure/arrival and transit options, route sharing, route editing/details,
- **V4-E** — Street View entry and Maps-specific semantic navigation,
- **V4-F** — bounded live compatibility closeout and final coverage table.

Login-required capability stays out of V4 and moves to V5. Consent, sign-in, CAPTCHA, or access challenges that occur naturally continue to stop at the existing Human Intervention boundary; they are never bypassed and completing human intervention does not approve a different semantic action.

Maps now consumes the extracted `mcp-execution-handoff` formal upstream at the immutable v0.1.0 source-release commit. The two-real-adapter validation with Japan Cinema is complete. This integration does not generalize the Maps server into a browser/desktop/shell MCP.

### Initial V4 implementation slice (completed)

`maps_get_place_share_link(expectedLabel)` was the first V4 browser-native semantic operation. It uses the currently selected place only, revalidates the active place identity immediately before activating the visible Share control, accepts only bounded Google Maps share URLs, and fails closed on missing/ambiguous targets. The operation remains behind Interactive Assist and the visible-read/action budgets.

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

Departure/arrival time and transit preference controls are important unauthenticated Maps Web capabilities, but they are not represented by the documented Google Maps URLs directions parameters used by this project. V4 now supports the bounded same-day `depart_at|arrive_by` slice through **visible Maps-specific semantic controls with postcondition/identity validation**; date, Last available, and transit preferences remain explicitly observation/design-gated. Do not invent undocumented URL parameters, intercept internal Maps APIs/XHR, or expose generic DOM automation to reach them.

## MCP Apps / optional interactive UI

The MCP Apps directions proof of concept has progressed through the portability/hardening milestone. The existing text/structured tool result remains the baseline, the host-neutral UI path is hardened against the stable 2026-01-26 lifecycle, and the UI remains experimental until a second production host completes a real-key Google Maps Embed render.

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

### Portability hardening status

The portability baseline is now complete:

1. `maps_render_directions` remains useful as text + structured data with no Embed key and no MCP Apps UI.
2. UI resource/linkage/extension advertisement is conditional, so an optional UI configuration cannot remove the core display result.
3. The View handles stable host context, safe areas/container dimensions, size changes, cancellation/error cleanup, and teardown.
4. The official MCP Apps basic reference host exercised resource discovery, CSP propagation, sandbox/View lifecycle, tool input/result delivery, and the nested Google Embed frame path. A dummy key was intentionally used, so this is not claimed as a second real-key map render.
5. The official MCP SDK client exercised the no-key, no-UI fallback as a real client.
6. ChatGPT Web remains the project-verified production host with a successful real Google Maps Embed render. VS Code officially supports MCP Apps, but this repository does not yet claim a project-level real-key render there.

The remaining item is a **production-host re-validation gate**, not unfinished core portability work: when a suitable second production host and restricted key are available, verify a real Embed render and then reconsider the experimental label. Re-open sooner if the stable MCP Apps specification, Google Embed requirements, or host sandbox/CSP behavior changes materially.

See [MCP Apps portability and deployment](mcp-apps.md) for the canonical contract, security rules, evidence, and completion criteria.

## Pre-v1 release progression

The current planning sequence maps the remaining major pre-v1 work to release themes. These are planning targets rather than promises to ship every listed item in a specific release. Scope may move when live Google Maps Web behavior, MCP host support, or security constraints require it.

- **v0.3.0 — V5 authenticated workflows + clean remote-auth foundation**
  - Implement V5 in the staged order below rather than enabling broad signed-in browser automation.
  - Treat the clean external OAuth reference gateway tracked in issue #74 as foundation/pre-work for this release: a reproducible Maps-specific remote-auth path, current-main backend, stable-principal propagation, `mcp-interop`/target-client validation, and migration away from the historical Monokura-derived dogfood gateway without modifying it in place while active clients depend on it.
- **v0.4.0 — MCP Apps production portability**
  - Re-validate the existing host-neutral MCP Apps surface on a suitable second production host with a real restricted Google Maps Embed key.
  - Reconsider the experimental UI label only after production-host evidence; preserve useful text/structured fallback and avoid turning rich UI into a core requirement.
- **v0.5.0 — reliability, UI-change resilience, and observability**
  - Strengthen detection and diagnosis of Google Maps Web UI drift while preserving fail-closed behavior.
  - Improve shared semantic identity/postcondition machinery, failure classification, live compatibility evidence, and locale/A-B-variation resilience without widening into generic browser automation.

Later pre-v1 releases remain intentionally open for evidence-driven semantic capability gaps or hardening discovered through real use. **v1.0.0 is not reserved for a final feature dump**: it should graduate an already-complete, bounded, documented, and operationally mature product surface to stable status.

## V5 / v0.3.0 — authenticated Google Maps Web workflows

V5 is defined as **bounded authenticated Google Maps Web workflows, starting with read-oriented and low-consequence reversible account state**. V5-A through V5-D are implemented behind the existing fail-closed opt-in/Interactive Assist boundaries; V5-E has been evaluated as a privacy/browser-surface gate and intentionally adds no history tool.

Current ordering/status:

1. **V5-A authenticated-session foundation — implemented** — Human-only sign-in/account selection, coarse account readiness, single-user/per-principal browser isolation gate, fresh reissue after Human Intervention.
2. **V5-B bounded saved-state reads — implemented** — selected-place save membership / existing list identities only; no Saved-library crawl.
3. **V5-C save to an existing list — implemented** — add one revalidated place to one existing list with an exact postcondition; no new-list text entry and no unsave/remove in the first mutation slice.
4. **V5-D Send to phone — implemented** — principal+epoch+exact-action approval is integrated into the real MCP form-elicitation flow; Human Intervention completion remains separate from send approval.
5. **V5-E Maps history — evaluated / blocked** — History crosses to My Activity and therefore requires a separate account-surface threat model; Maps-local Recent is still observation-gated because the current surface lacks stable bounded activity-row semantics.

Timeline is removed from the V5 Web candidate set because current Google Maps documentation states that Timeline is not available in Maps on a computer. Review/rating/edit/public-photo contribution workflows remain outside the initial V5 direction.

The MCP authorization principal and the Google Account active in the dedicated browser are distinct identities. Until per-principal browser/profile isolation exists, V5 account-backed tools are designed only for a single-user deployment/profile. No raw Google account identifier is required in MCP output merely to prove sign-in.

See [V5 authenticated workflows — design baseline](v5-authenticated-workflows.md) for the entry gate, proposed semantic shapes, logging/privacy rules, test plan, and explicit deferrals.

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