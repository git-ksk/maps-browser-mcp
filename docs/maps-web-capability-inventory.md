# Google Maps Web Capability Inventory

[日本語](maps-web-capability-inventory.ja.md) | [Roadmap](roadmap.md) | [Positioning](positioning.md)

This document is the canonical V4 coverage inventory for the Google Maps Web surface available without authentication.

V4 is defined as:

> **Broad semantic coverage of major Google Maps Web capabilities available without authentication.**

The inventory is a product/engineering boundary, not a commitment to reproduce every control Google Maps happens to render. A capability belongs in the MCP surface only when it can be expressed as a Maps-specific semantic operation with bounded state reading, identity validation, fail-closed behavior, and the existing Human Intervention boundary.

## Priority model

The status column uses exactly these classes:

- **implemented** — the current public MCP surface already covers the core operation.
- **V4 high priority** — browser-native or UI-dependent behavior where controlling Google Maps Web is the main value.
- **V4 normal priority** — useful to complete a Maps Web workflow but less browser-specific or already partially covered.
- **lower priority / official overlap** — useful, but an official structured interface provides most of the same value and the browser adds little.
- **login required** — keep out of V4; reconsider in V5 only behind the existing Human Intervention/credential boundary.
- **out of scope** — intentionally not exposed even if the web UI contains it.

Official Google Maps Platform / Google-managed Maps MCP overlap is a priority signal, not an automatic scope exclusion.

## Live inventory basis

A bounded manual inventory was run on **2026-08-13** against Google Maps Web in a dedicated Chromium window with the visible **Sign in** control and no authenticated Google account.

The session verified the following real UI surfaces before the dedicated browser process exited naturally:

- root map controls, category discovery, current-location, zoom, layer and Street View entry points,
- search autocomplete and a local `cafe` search,
- the result feed, price/rating/time filters, all-filters entry point, result sharing, and `update results when map moves`,
- a selected place panel with photos, Overview/Reviews/About tabs, directions, Save, Nearby, Send to device, Share, opening hours, website, phone, Plus Code, and Street View,
- Save leaving Maps for Google Account sign-in,
- an unauthenticated place Share dialog producing a `https://maps.app.goo.gl/...` link,
- transit directions between two stations, travel-mode radios, origin/destination swap, departure-time control, Options, route candidate details, route link copy, destination-nearby shortcuts, and send-to-device.

Google Maps Web is dynamic and may vary by locale, viewport, experiment, geography, and account state. A capability marked below reflects a semantic product decision plus the observed UI, not a promise that the same label or DOM shape is permanently stable.

## Coverage table

| Capability | V4 status | Current coverage / target semantic behavior |
|---|---|---|
| Open a user-directed search | implemented | `maps_search` opens a documented Maps search URL. |
| Read bounded search/place results | implemented | `maps_read_place_summary` returns bounded visible labels/text and conservative annotations. |
| Select a visible search result | implemented | `maps_select_result(index, expectedLabel)` revalidates identity and fails closed on reordering. |
| Search autocomplete / suggestion selection | V4 high priority | Add bounded Maps-specific suggestion read/select semantics; never expose the raw combobox/DOM. |
| Search result filters (price/rating/time/all filters) | V4 high priority | Model a bounded allow-listed filter surface with postcondition validation. |
| Search this area / update after map movement | V4 high priority | Preserve query identity and explicitly apply the visible-area search action. |
| Root category discovery (restaurants/hotels/activities/etc.) | V4 normal priority | Semantic category search is useful, but overlaps normal search. |
| Search-result list sharing | V4 high priority | Produce the Maps-generated share URL from the visible search state with identity/state validation. |
| Open a place from results | implemented | `maps_select_result` transitions verified search state to place state. |
| Read bounded place summary | implemented | Existing place summary covers visible place text without full-detail harvesting. |
| Place photos / photo categories | V4 high priority | Open and navigate bounded photo surfaces semantically; no bulk image harvesting. |
| Place Overview / Reviews / About tabs | V4 normal priority | Tab selection may be exposed; review-body harvesting remains out of scope. |
| Place → directions | V4 normal priority | Existing `maps_directions` covers the workflow structurally; add current-place convenience only if it preserves identity. |
| Place → nearby search | V4 high priority | Browser-native place-context workflow; revalidate the active place before applying the nearby query. |
| Place share / Maps share URL | V4 high priority | Generate/read the visible Maps share link without clipboard scraping or generic DOM exposure. First V4 implementation slice. |
| Expand opening hours | V4 normal priority | Bounded visible-place interaction; do not build persistent place datasets. |
| Copy/open website, phone, address, Plus Code | lower priority / official overlap | Useful panel actions, but most data value overlaps structured place interfaces. |
| Save place / saved lists | login required | Real unauthenticated Save action redirected to Google Account sign-in. V5 only. |
| Recent/history synced to account | login required | Treat account-backed history as V5. Local ephemeral browser history is not a public MCP dataset. |
| Send place to mobile device | login required | Treat as account/device-linked until a bounded unauthenticated target can be proven; do not handle credentials. |
| Open directions | implemented | `maps_directions` uses documented Maps URLs with bounded waypoints/avoid options. |
| Read bounded route candidates | implemented | `maps_read_route_summary`. |
| Select route candidate | implemented | `maps_select_route(index, expectedLabel)` validates current route identity. |
| Change travel mode | implemented | `maps_set_travel_mode` supports driving/walking/bicycling/transit while preserving route constraints. |
| Recommended/automatic travel mode | V4 normal priority | UI-specific mode chooser; expose only if postcondition can be verified without heuristic mode guessing. |
| Swap origin and destination | V4 normal priority | Stateful route edit; preserve route identity and invalidate old candidate state. |
| Add/reorder/remove route stops | V4 normal priority | URL path already supports bounded waypoints; stateful UI editing is secondary but useful. |
| Driving avoid options (ferries/highways/tolls) | implemented | Bounded documented route options are supported and preserved across mode changes. |
| Departure/arrival time and transit preferences | V4 high priority | Important UI-only routing behavior not covered by documented Maps URL parameters; implement via semantic visible controls, not guessed web parameters. |
| Route candidate details / step expansion | V4 normal priority | Bounded route-detail interaction; no bulk itinerary extraction. |
| Route link copy/share | V4 high priority | Read the Maps-generated link for the verified active route; do not use raw clipboard access. |
| Destination-nearby shortcuts from route view | V4 normal priority | Convenience category search scoped to current destination. |
| Send route to mobile device | login required | Account/device-linked workflow stays V5. |
| Show map at coordinates/zoom | implemented | `maps_show` opens a documented coordinate-centered Maps URL. |
| Stateful zoom in/out | V4 normal priority | Add only if useful beyond `maps_show`; verify resulting viewport state. |
| Semantic map pan/recenter | V4 normal priority | Maps-specific viewport operation only; never expose pointer coordinates or generic drag. |
| Current location | V4 high priority | Browser-native; permission/consent must stop at Human Intervention and never be bypassed. |
| Map layers / map type / traffic / transit / bicycling / terrain | V4 high priority | Strong browser-native value. Use an allow-listed semantic layer model with verified toggles. |
| Street View open by coordinates | implemented | `maps_streetview` opens documented Street View parameters. |
| Enter Street View from active place/map | V4 high priority | Preserve place/viewport identity before entering. |
| Street View rotate/zoom/navigation | V4 high priority | Maps-specific movement semantics only; no raw pointer/CDP tool surface. |
| Street View imagery/date selection | V4 normal priority | Bounded visible-image navigation where available; no bulk historical imagery harvesting. |
| Share current map/view URL | V4 high priority | Produce Maps-generated/shareable state, not a generic browser URL/clipboard tool. |
| Sign-in, account switching, credential entry | login required | Existing Human Intervention can hand off naturally occurring sign-in, but MCP never handles credentials. |
| Timeline, account lists, synced saved places | login required | V5. |
| Contributions, ratings, reviews, edits, public photo upload | login required | State-changing/account-backed contribution workflows are not part of V4. |
| CAPTCHA / access-challenge solving | out of scope | Human handoff only; no bypass or solver. |
| Raw DOM / AX tree / raw CDP / generic browser actions | out of scope | Internal implementation detail only; never exported as MCP tools. |
| Bulk scraping/crawling/review harvesting/dataset creation | out of scope | Remains prohibited. |
| Internal Maps API/XHR interception or undocumented endpoint harvesting | out of scope | Remains prohibited. |
| Generic desktop/shell automation | out of scope | Issue #36 and other adapter work must not turn this server into a general computer-use MCP. |

## V4 implementation slices

V4 should be delivered in small reviewable groups rather than as one broad DOM-automation change.

### V4-A — inventory and semantic identity primitives

- Keep this inventory canonical and synchronized in English/Japanese.
- Reuse or extend `expectedLabel`-style identity checks for every dynamic selection/action.
- Treat a human handoff, unexpected navigation, or resource-epoch change as invalidating prior semantic state.

### V4-B — place workflow

Priority order:

1. place share link,
2. nearby search from the verified active place,
3. photo surface/category navigation,
4. bounded place tabs/opening-hours interactions.

### V4-C — search and map viewport

Priority order:

1. result filters,
2. search-this-area / update-after-move,
3. current-location permission-safe action,
4. semantic layer toggles,
5. bounded viewport movement where it adds value beyond `maps_show`.

### V4-D — directions UI

Priority order:

1. departure/arrival time and transit options,
2. route link sharing,
3. swap/edit stops,
4. bounded route detail expansion,
5. destination-nearby shortcuts.

### V4-E — Street View

- enter from active place/map,
- semantic turn/zoom/navigation,
- bounded imagery/date choice where safely identifiable.

### V4-F — coverage closeout

- rerun low-frequency, bounded live E2E only for user-directed compatibility checks,
- close gaps that remain V4 high/normal priority,
- leave login-required items for V5,
- leave official-overlap items lower priority unless needed to complete a browser workflow,
- publish the final implemented/remaining coverage table in this document.

## Safety invariants for every new V4 operation

Every new operation must preserve the existing browser safety model:

- dedicated Chrome/Chromium and loopback CDP only,
- one serialized semantic browser state,
- stale-state and expected-identity validation before mutation,
- fail closed on missing, duplicated, reordered, or ambiguous targets,
- bounded visible-state reads and bounded action counts,
- no secrets, credentials, clipboard dumps, or unrelated page text in outputs/logs,
- consent/sign-in/CAPTCHA/challenge surfaces stop at Human Intervention,
- completing Human Intervention never approves a different action,
- restart/reconnect never automatically replays a previous state-changing semantic operation,
- no CAPTCHA/anti-bot bypass,
- no scraping, bulk harvesting, internal Maps API/XHR harvesting, or raw browser/DOM/CDP MCP tools.

## Issue #36 boundary

Issue #36 (second real Execution Handoff adapter proof) remains a separate track. V4 Maps coverage must not depend on turning `maps-browser-mcp` into a generic browser, desktop, or shell MCP.