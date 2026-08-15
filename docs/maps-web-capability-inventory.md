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

A bounded 2026-08-15 re-observation across JA/EN place panels and standard/wide viewports found place-bound Overview/About tabs but did not reproduce a visible Reviews tab. Opening-hours controls were observed in both inline accordion and same-place detail-surface variants. The implementation below is intentionally limited to those re-observed shapes.

A separate bounded 2026-08-15 V4-C re-observation found visible Price, Rating, Hours, and All filters outside the search result `role=main`, plus the explicit `Update results when map moves` checkbox. Rating was the smallest stable slice in both JA/EN: an exact `Rating` / `評価` button opens one labelled menu with fixed `menuitemradio` options `2.0` through `4.5`. Bounded observations also verified the selected trigger changing to numeric chips such as `2.0+`, `4.0+`, and `4.5+`; the implementation uses that selected-chip state plus a closed menu as its postcondition. Price and All filters use different surface shapes, and Hours expands into a larger day/time dialog, so they remain observation/design-gated.

A bounded 2026-08-15 search-this-area re-observation used dedicated Chrome profiles with JA UI and explicit `--lang=en-US`, kept the search query visible, left `Update results when map moves` disabled, and manually panned the map. The map center/path changed while search identity remained stable, but no visible `Search this area` / `このエリアを検索` one-shot control appeared in either UI. Only the update-after-move checkbox remained visible. Because that checkbox changes automatic update behavior rather than representing the requested explicit semantic action, it is not treated as a substitute; `maps_search_this_area` remains observation-gated with no selector or schema.

A bounded 2026-08-15 current-location observation used a fresh dedicated Chrome profile with no pre-granted geolocation permission. Maps exposed exactly one visible `現在地を表示` / Show Your Location semantic button with `aria-pressed=false`. Activating that exact control reached Chrome's browser-level location permission prompt; no permission choice was made. While the prompt was active, the page control remained unpressed, the map path was unchanged, and `navigator.permissions` still reported `prompt`. Because a successful location postcondition cannot be observed without a user permission decision, and the current page-state Human Intervention boundary does not itself authorize or auto-resume a browser permission prompt, no current-location MCP action is exposed yet. Re-open this slice only with a manually authorized session plus an observable Maps-native success state, or after a dedicated permission-handoff model is designed.

A bounded 2026-08-15 map-layer observation used dedicated JA and explicit `--lang=en-US` Chrome profiles. The visible `レイヤ` / `Layers` entry point rendered as two overlapping nested `div` nodes with no `role`, `aria-label`, `tabindex`, or other semantic control state; a bounded accessibility-name query also returned no `レイヤ` / `Layers` control. Manual hover exposed strong semantic options: `地形` / Terrain, `交通状況` / Traffic, `公共交通機関` / Transit, and `自転車` / Biking were each visible `menuitemcheckbox` controls with `aria-checked=false`. A bounded exact-one Traffic toggle verified `aria-checked=false -> true`. The option postcondition is therefore viable once the surface is open, but the opener cannot currently be identified exactly without nested-DOM heuristics or pointer geometry. No map-layer MCP action is exposed until Maps provides an exact-one semantic/accessible Layers opener (or another equally bounded Maps-native way to expose the options).

A bounded 2026-08-15 viewport observation used a JA search-result view at 1440×1000 and an explicit en-US search-result view at 1280×800. In both UIs, Zoom in/out were exact-one visible enabled `button` controls (with hidden duplicates ignored by the visible-only boundary), the visible query remained exact, and the public Maps search path exposed a settled integer zoom level. One bounded round trip verified JA `17z -> 18z -> 17z` and EN `16z -> 17z -> 16z`. The longitude changed slightly during the zoom animation because of the results-pane geometry, so map-center equality is deliberately not a postcondition. `maps_zoom_search(expectedQuery, direction)` therefore implements only one-level `in|out` zoom for an active verified search state, requiring the same query plus an exact ±1 zoom transition. Generic pan/recenter and root/place zoom remain outside this slice.

A bounded 2026-08-15 V4-D transit-time observation used a fresh simple Tokyo Station -> Yokohama Station transit request in JA and explicit en-US. `Leave now` / `すぐに出発` was an exact visible button; its menu exposed `Depart at` / `出発時刻` and `Arrive by` / `到着時刻` as exact `menuitemradio` controls. After either mode was selected, exactly one visible `input[name="transit-time"]` appeared. A bounded 13:30 edit verified JA `13:30` and EN `1:30 PM`, while the visible resolved origin/destination input values remained byte-for-byte unchanged and the page stayed in `/maps/dir/`. The transit-mode radio group may disappear after choosing a time mode, so it is deliberately not a postcondition. `maps_set_transit_time(expectedOrigin, expectedDestination, mode, time)` therefore implements only same-day `depart_at|arrive_by` with a 24-hour `HH:MM` input from a fresh simple documented transit request. Date selection, `Last available`, and transit preference options remain observation/design-gated. Because the resulting UI-only schedule is not fully represented by the original documented navigation action, success advances the resource epoch and drops that replayable action while preserving the current directions view for bounded route read/select in the same session.

A bounded 2026-08-15 V4-D route-link re-observation found an exact-one visible `Copy link` / `リンクをコピー` button in the unselected directions view after UI settle. The control is a plain button with no visible `href` or link value. Activating it left the current Maps URL unchanged and did not expose a bounded visible link field, share dialog, or reliable visible copied-state postcondition. After a guarded route-candidate selection, the Copy link control was no longer visible in the observed JA/en-US route view. Reading or intercepting clipboard contents would violate the clipboard boundary, and assuming the current URL equals the copied link would be unverified. Therefore no route-link MCP action is exposed. Re-open this slice only if Maps exposes the generated link through a bounded visible semantic surface or another postcondition that does not require clipboard access.

A bounded 2026-08-15 V4-D route-swap observation found exactly one visible `Reverse starting point and destination` / `出発地と目的地を入れ替える` button in fresh JA/en-US transit directions. One bounded activation verified the resolved visible endpoint values changing exactly A/B -> B/A. However the documented current URL and runtime canonical action remained A -> B even after a further settle, so exposing that UI click directly would leave semantic state stale. `maps_swap_route_endpoints(expectedOrigin, expectedDestination)` therefore implements the same semantic intent by rebuilding documented Maps directions parameters rather than clicking the UI control. It is restricted to a fresh simple route with an explicit origin and no waypoints, revalidates expected canonical endpoints, preserves mode and bounded avoid constraints, and lets the existing navigation path advance the resource epoch and invalidate prior route candidates. Stateful stop editing remains separate; existing `maps_directions` already supports bounded documented waypoints.

A bounded 2026-08-15 stateful-stop observation used fresh JA/en-US driving routes with zero and one documented waypoint. `Add destination` / `目的地を追加` was exact-one and visible, but it only opens another destination-entry workflow whose bounded value is already covered structurally by `maps_directions(..., waypoints)`. With one waypoint, two visible `Remove this destination` / `この目的地を削除` buttons had the same semantic label, so removing a specific waypoint versus the final destination would require positional/DOM heuristics. No exact semantic reorder control was observed; exposing reordering would require generic drag/pointer geometry. No stateful stop-edit MCP action is added. Re-open only if Maps exposes target-specific remove/reorder semantics that are exactly identifiable; documented bounded waypoints remain the safe supported path.

A subsequent bounded 2026-08-15 selected-route share observation changed the earlier route-link conclusion for one narrow surface. After guarded selection of a simple transit candidate, JA/en-US exposed exactly one `ルートを共有` / `Share directions` control. Its dialog had the `リンクを送信する` / `Send a link` tab selected and, after bounded settle, exactly one visible input containing an allow-listed `https://maps.app.goo.gl/...` URL. The link can therefore be read without clipboard access, and exact `閉じる` / `Close` semantics allow the transient dialog to be closed and verified. `maps_get_route_share_link(expectedOrigin, expectedDestination)` implements only this selected simple transit-route surface. The unselected directions `Copy link` button remains unused, and driving/other route modes remain observation-gated because the visible generated-link field was not stable in bounded re-observation.

A bounded 2026-08-15 route-detail observation confirmed that guarded `maps_select_route(index, expectedLabel)` itself enters a selected route detail view: the candidate-level `Details` / `詳細` control disappears and the resulting surface exposes exact `Back`, route-share, `Print`, and `Toggle details` / `詳細を切り替える` controls. The extra Toggle-details control was exact-one in JA/en-US, but bounded activation produced no semantic selected/pressed/expanded state and its label did not change. The URL either remained equivalent or changed only in opaque Maps `data=` state, which is intentionally not parsed. Although more visible semantic controls appeared after activation, using control-count or newly revealed step text as the postcondition would be heuristic/content-harvesting rather than an explicit semantic state. No additional details-toggle MCP action is exposed. Route-detail entry remains covered by guarded `maps_select_route`; re-open the toggle slice only if Maps exposes a stable semantic expanded/collapsed postcondition.

A bounded 2026-08-15 destination-nearby observation separated route-destination shortcuts from driving-only along-route stop controls. In fresh JA/en-US transit and driving directions, `Restaurants` / `レストラン` was exact-one. Activating it first exposed exact nearby-search state (`Cancel search nearby` / `付近の検索をキャンセル` plus a Restaurants query) and then transitioned to a Maps search path. In en-US, the settled search surface additionally exposed the destination-bound heading `Explore nearby Yokohama Station`, so the expected destination scope was visible. In JA, however, bounded settle exposed only `結果` plus `付近の検索をキャンセル`; no visible semantic destination identity was present. The opaque Maps URL `data=` state contained routing/destination information but is intentionally not parsed. Because “nearby search started” is weaker than “near the expected destination,” no destination-nearby MCP action is exposed yet. Re-open only when a destination-bound visible semantic identity/postcondition is available across the supported observed locale shapes. Driving `Search stops along the route` and its gas/EV/hotel actions are a separate along-route workflow and are not substituted.

## Coverage table

| Capability | V4 status | Current coverage / target semantic behavior |
|---|---|---|
| Open a user-directed search | implemented | `maps_search` opens a documented Maps search URL. |
| Read bounded search/place results | implemented | `maps_read_place_summary` returns bounded visible labels/text and conservative annotations. |
| Select a visible search result | implemented | `maps_select_result(index, expectedLabel)` revalidates identity and fails closed on reordering. |
| Search autocomplete / suggestion selection | V4 high priority | Add bounded Maps-specific suggestion read/select semantics; never expose the raw combobox/DOM. |
| Search result filters (price/rating/time/all filters) | partial / rating implemented | `maps_set_search_rating(expectedQuery, rating)` implements only the live-reobserved Rating menu with fixed `2.0`–`4.5` half-step options. It revalidates the exact visible query before each action and verifies the exact requested numeric rating chip with the Rating menu closed after selection. Price, Hours, and All filters remain observation/design-gated; there is no generic filter-string API. |
| Search this area / update after map movement | observation-gated | 2026-08-15 JA and explicit en-US manual-pan re-observation did not expose a visible one-shot `Search this area` control. The visible `Update results when map moves` checkbox is an automatic-update preference and is intentionally not substituted for the explicit semantic action. No `maps_search_this_area` selector/schema is exposed until the one-shot control is observed. |
| Root category discovery (restaurants/hotels/activities/etc.) | V4 normal priority | Semantic category search is useful, but overlaps normal search. |
| Search-result list sharing | V4 high priority | Produce the Maps-generated share URL from the visible search state with identity/state validation. |
| Open a place from results | implemented | `maps_select_result` transitions verified search state to place state. |
| Read bounded place summary | implemented | Existing place summary covers visible place text without full-detail harvesting. |
| Open place photos | implemented | `maps_open_place_photos(expectedLabel)` revalidates the active place, activates exactly one allow-listed photo entry control, verifies the Maps photo viewer and expected place heading, then invalidates the old place semantic state. No image harvesting. Interactive Assist is required. |
| Photo category navigation | V4 high priority | Navigate only bounded, explicitly observed viewer categories with identity/postcondition checks; no bulk image harvesting. |
| Place Overview / Reviews / About tabs | partial / observation-gated | `maps_select_place_tab(expectedLabel, tab)` implements only the live-reobserved `overview` / `about` enum with exact place-bound tab identity and `aria-selected` postconditions. Reviews was not visible in the 2026-08-15 JA/EN re-observation, so no Reviews selector/schema is exposed. Review-body harvesting remains out of scope. |
| Place → directions | V4 normal priority | Existing `maps_directions` covers the workflow structurally; add current-place convenience only if it preserves identity. |
| Place → nearby search | implemented | `maps_search_nearby(expectedLabel, query)` revalidates the active place and activates exactly one allow-listed Nearby control. It then accepts only one bounded search-input state: a Nearby-labeled input or the uniquely focused empty Maps combobox produced by that action. The transition is accepted only when the requested query and a Maps search-result path are both verified. Interactive Assist is required. |
| Place share / Maps share URL | implemented | `maps_get_place_share_link(expectedLabel)` revalidates the active place immediately before one visible Share action, then returns only a bounded allow-listed Google Maps share URL. Interactive Assist is required. |
| Expand opening hours | implemented | `maps_expand_opening_hours(expectedLabel)` revalidates the active place and exactly one live-observed hours control. Inline expansions verify the observed expanded state and retain place semantics; the observed JA detail-surface variant verifies same-place URL identity plus bounded hours markers and invalidates the stale place state. Weekly-hours harvesting is not exposed. |
| Copy/open website, phone, address, Plus Code | lower priority / official overlap | Useful panel actions, but most data value overlaps structured place interfaces. |
| Save place / saved lists | login required | Real unauthenticated Save action redirected to Google Account sign-in. V5 only. |
| Recent/history synced to account | login required | Treat account-backed history as V5. Local ephemeral browser history is not a public MCP dataset. |
| Send place to mobile device | login required | Treat as account/device-linked until a bounded unauthenticated target can be proven; do not handle credentials. |
| Open directions | implemented | `maps_directions` uses documented Maps URLs with bounded waypoints/avoid options. |
| Read bounded route candidates | implemented | `maps_read_route_summary`. |
| Select route candidate | implemented | `maps_select_route(index, expectedLabel)` validates current route identity. |
| Change travel mode | implemented | `maps_set_travel_mode` supports driving/walking/bicycling/transit while preserving route constraints. |
| Recommended/automatic travel mode | V4 normal priority | UI-specific mode chooser; expose only if postcondition can be verified without heuristic mode guessing. |
| Swap origin and destination | implemented via documented URL rebuild | `maps_swap_route_endpoints(expectedOrigin, expectedDestination)` revalidates a fresh simple canonical directions request, rejects omitted origins/waypoints, preserves mode/avoid constraints, and rebuilds documented Maps URL parameters with endpoints reversed. Live UI swap was observed but is not automated because it leaves canonical URL/action stale. |
| Add/reorder/remove route stops | observation/design-gated / documented waypoint overlap | JA/en-US observation found exact Add destination, but one-waypoint routes exposed duplicate indistinguishable Remove destination buttons and no exact semantic reorder control. Do not use positional heuristics or generic drag. Existing `maps_directions(..., waypoints)` remains the supported bounded route-stop path. |
| Driving avoid options (ferries/highways/tolls) | implemented | Bounded documented route options are supported and preserved across mode changes. |
| Departure/arrival time and transit preferences | partial / same-day transit time implemented | `maps_set_transit_time(expectedOrigin, expectedDestination, mode, time)` implements only fresh simple transit routes with `mode=depart_at|arrive_by` and 24-hour `HH:MM` for the current day. It revalidates documented route identity before mutation, verifies exact localized time controls plus unchanged visible resolved endpoints, then drops the stale replayable navigation action while keeping route read/select available. Date, Last available, and transit preference options remain observation/design-gated. |
| Route candidate details / step expansion | partial / detail entry covered, extra toggle gated | Guarded `maps_select_route(index, expectedLabel)` already enters the selected route detail view. JA/en-US `Toggle details` was exact-one but exposed no selected/pressed/expanded postcondition and retained the same label; do not infer success from opaque URL data, revealed step text, or control-count changes. No extra toggle action until an explicit semantic expanded/collapsed state is observable. |
| Route link copy/share | partial / selected transit route implemented | `maps_get_route_share_link(expectedOrigin, expectedDestination)` uses the selected-route `Share directions` dialog only for live-observed simple transit routes, verifies the selected Send-link tab and exact-one visible allow-listed Maps URL, then closes the dialog. It never reads clipboard contents. The unselected Copy link surface and driving/other modes remain observation-gated. |
| Destination-nearby shortcuts from route view | observation-gated / destination postcondition incomplete | JA/en-US exact Restaurants shortcuts enter nearby-search state. en-US exposed `Explore nearby <destination>`, but JA exposed only generic Results/Cancel-nearby state, leaving the expected destination unverified without parsing opaque URL data. Do not substitute driving along-route stop controls. Re-open when destination-bound visible identity is available across observed locale shapes. |
| Send route to mobile device | login required | Account/device-linked workflow stays V5. |
| Show map at coordinates/zoom | implemented | `maps_show` opens a documented coordinate-centered Maps URL. |
| Stateful zoom in/out | partial / verified search zoom implemented | `maps_zoom_search(expectedQuery, direction)` supports only active search-result `in|out`. It revalidates exact visible query + exact-one visible enabled Zoom button immediately before mutation and verifies the same search/query plus exactly one zoom-level change in the public Maps path. Center equality is intentionally not required. Root/place zoom remains unimplemented. |
| Semantic map pan/recenter | observation/design-gated | Not included in the verified search-zoom slice. Do not expose pointer coordinates or generic drag; require a separately observed Maps-specific semantic target and postcondition. |
| Current location | observation-gated / permission boundary observed | A fresh-profile activation of the exact visible location button reached Chrome geolocation permission. Permission was deliberately not granted, so no safe success postcondition was established. Do not expose an action that merely opens the prompt, auto-grants permission, or auto-replays after it; require a manually authorized session plus a verified Maps-native success state or a dedicated permission-handoff design. |
| Map layers / map type / traffic / transit / bicycling / terrain | observation-gated / option toggles verified | JA/en-US observation found exact semantic `menuitemcheckbox` toggles for Terrain/Traffic/Transit/Biking, and Traffic verified `false -> true`. However the visible Layers opener itself is two overlapping non-semantic `div` nodes with no role/ARIA/AX identity, so opening it safely would require a DOM/geometry heuristic. Do not expose a layer action until an exact-one semantic/accessible opener or equivalent bounded Maps-native surface is observed. |
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

1. place share link — implemented as `maps_get_place_share_link(expectedLabel)`,
2. nearby search — implemented as `maps_search_nearby(expectedLabel, query)` from the verified active place,
3. place photo opener — implemented as `maps_open_place_photos(expectedLabel)` with verified viewer transition and stale place-state invalidation,
4. photo category navigation — remaining; design from bounded observed viewer controls only,
5. place tabs — `maps_select_place_tab(expectedLabel, tab)` implements only `overview|about`; Reviews remains observation-gated because the current control was not re-observed,
6. opening hours — implemented as `maps_expand_opening_hours(expectedLabel)` with inline/detail postcondition handling and stale-state invalidation.

### V4-C — search and map viewport

Priority order:

1. result filters — Rating implemented as `maps_set_search_rating(expectedQuery, rating)`; Price/Hours/All filters remain observation/design-gated,
2. search-this-area / update-after-move — explicit one-shot control not re-observed after JA/en-US manual pans; keep observation-gated and do not substitute the auto-update checkbox,
3. current-location permission-safe action — browser permission boundary observed; keep observation-gated until a manually authorized success postcondition or dedicated permission-handoff model is established,
4. semantic layer toggles — option toggles are verified, but the Layers opener is non-semantic/ambiguous; keep observation-gated until an exact-one semantic opener exists,
5. bounded viewport movement — search-result one-level zoom implemented as `maps_zoom_search(expectedQuery, direction)`; root/place zoom and semantic pan/recenter remain separately observation/design-gated.

### V4-D — directions UI

Priority order:

1. departure/arrival time and transit options — same-day `depart_at|arrive_by` implemented as `maps_set_transit_time`; date/Last available/preferences remain observation/design-gated,
2. route link sharing — selected simple transit-route sharing implemented as `maps_get_route_share_link`; unselected Copy link and driving/other modes remain observation-gated,
3. swap/edit stops — endpoint swap implemented as `maps_swap_route_endpoints`; stateful stop editing remains observation/design-gated (bounded waypoints are already supported by `maps_directions`),
4. bounded route detail expansion — guarded `maps_select_route` already enters route detail; extra Toggle-details remains observation-gated for lack of a semantic postcondition,
5. destination-nearby shortcuts — exact nearby category action observed, but JA lacks a visible destination-bound postcondition; keep observation-gated and do not substitute driving along-route stop search.

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