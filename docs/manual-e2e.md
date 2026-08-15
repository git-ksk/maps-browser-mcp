# User-directed live Google Maps E2E checklist

Normal CI intentionally does not visit Google Maps pages. UI-dependent releases can additionally use the repository's **manual-only** GitHub Actions workflow, `Live Maps E2E (manual)`, or this checklist from a controlled local environment.

The Live workflow remains intentionally fixed and low-volume. V4 capability-by-capability checks must not turn it into a broad crawler; add or run only bounded scenarios needed to validate an affected semantic operation.

Do not turn this checklist or workflow into unattended crawling. Use one ordinary request per scenario and stop if Google presents an access challenge.

## Automated manual-trigger check

From GitHub Actions:

1. Open **Live Maps E2E (manual)**.
2. Choose **Run workflow**.
3. Select `run-live-check` for the confirmation input.
4. Select one execution environment:
   - `host` for the normal runner path, or
   - `container` for the built container image with sandbox-capable Chromium.
5. Run the workflow.

Use `container` before a release that materially changes the Dockerfile, headless Chromium startup, browser profile paths, container filesystem assumptions, or container-specific Chrome flags. Do not run both modes merely for routine activity; keep live checks low-volume and purpose-driven.

The fixed workflow verifies one bounded autocomplete read/select, one search-share check, the established bounded place workflow (including representative photo/nearby/place-share checks), and one fresh simple transit route with Recommended/Best followed by bounded route read/select. It does not broaden into result crawling, capability-by-capability probing, screenshots, review harvesting, or persistence.

The container path builds the repository Dockerfile and runs the same bounded script inside that image. It uses a sandbox-capable container configuration and does not enable `MAPS_ALLOW_UNSANDBOXED_CHROMIUM`. No artifact upload step exists in either path.

## Preconditions for the full manual checklist

- Use the dedicated `maps-browser-mcp` Chrome profile, not an everyday personal profile.
- Keep the Chrome DevTools port local/private.
- Confirm `npm ci --ignore-scripts`, `npm audit --audit-level=moderate`, `npm run check`, `npm run build`, `npm run smoke:http`, and `npm run smoke:browser` pass first.
- Start with `INTERACTIVE_ASSIST_MODE=false`.
- Keep live checks low-frequency, bounded, and tied to a user-directed compatibility question.
- Never intentionally generate a consent/sign-in/CAPTCHA/challenge surface.

## 1. Search navigation

1. Call `maps_search` for one ordinary public place/category query.
2. Confirm the dedicated browser opens Google Maps search.
3. Confirm no non-Maps page is visited by the MCP.
4. Confirm no result content is persisted by the server.

Expected: one MCP call produces one Maps URL navigation.

When validating the V4 Rating-filter slice with Interactive Assist enabled:

1. Start from a fresh `maps_search({ query })` result view.
2. Call `maps_set_search_rating({ expectedQuery: query, rating: "4.0" })`.
3. Confirm the same visible query/search state is retained and the operation reports `alreadyApplied: false` on the first successful change.
4. Repeat the same call and confirm `alreadyApplied: true` without another resource-epoch advance.
5. A deliberately wrong `expectedQuery`, missing/duplicate Rating target, changed option/menu, unexpected navigation, or invalid selected-chip postcondition must fail closed. If the filter may already have changed before verification fails, the prior semantic context must be invalidated.
6. Confirm no arbitrary filter text, raw DOM/AX payload, search-result harvesting, or URL-internal filter-token parsing is exposed.

When validating the V4 search-zoom slice with Interactive Assist enabled:

1. Start from a fresh `maps_search({ query })` result view and note the settled integer zoom level in the public Maps search path.
2. Call `maps_zoom_search({ expectedQuery: query, direction: "in" })`; confirm the same visible query/search state remains and the zoom level advances by exactly one.
3. Call `maps_zoom_search({ expectedQuery: query, direction: "out" })`; confirm the same visible query/search state remains and the zoom level decreases by exactly one. Do not require map-center coordinates to remain byte-for-byte equal.
4. A deliberately wrong `expectedQuery`, missing/duplicate/disabled Zoom control, unexpected navigation, opposite/overshoot zoom transition, or invalid postcondition must fail closed. If a click may already have happened before verification fails, prior semantic context must be invalidated.
5. Confirm the public surface exposes no coordinates, arbitrary zoom level, generic pan/drag, root-map zoom, or place-view zoom through this tool.

When validating the V4-F autocomplete slice with Interactive Assist enabled:

1. Call `maps_read_search_suggestions({ query: "Tokyo Station" })`; confirm it opens a fresh suggestion state and returns at most six `items[{ index, label }]` with `untrustedExternalText: true`.
2. Confirm composite labels distinguish visible duplicate primary names when Maps provides secondary identity, and that raw combobox/DOM/AX payloads are not returned.
3. Without rereading, call `maps_select_search_suggestion({ query, index, expectedLabel: "deliberately wrong" })`; expect `UI_STATE_CHANGED`, no row activation, no resource-epoch advance, and the same suggestion state retained.
4. Call the selection again with the exact returned `index + expectedLabel`; confirm the controlled suggestion grid closes, Maps settles to a verified search/place view, and the resource epoch advances exactly once for the adopted semantic result.
5. Duplicate composite identities, reordered/missing targets, a changed active query, unexpected navigation, or an unverifiable postcondition must fail closed. Do not fall back to primary text, DOM position without expected identity, pointer geometry, or hidden suggestion IDs.

When validating V4-F search-result sharing:

1. Start from a fresh `maps_search({ query })` result view.
2. Call `maps_get_search_share_link({ expectedQuery: "deliberately wrong" })`; expect `UI_STATE_CHANGED`, no Share activation, and no resource-epoch advance.
3. Call `maps_get_search_share_link({ expectedQuery: query })`; confirm exact visible search identity, exact-one Share, selected Send-link tab, and exactly one visible allow-listed Maps URL are required.
4. Confirm the Share dialog is semantically closed, the original search action/view remains usable, and the resource epoch does not advance on success.
5. Confirm no clipboard read/interception, current-browser-URL substitution, network interception, or raw DOM/AX output is used.

## 2. Directions navigation

1. Call `maps_directions` with a public origin/destination and `mode=transit`.
2. Confirm Google Maps opens the directions view.
3. Call `maps_set_travel_mode` once.
4. Confirm the directions URL is rebuilt rather than a generic UI click being used.

## 3. Safe-mode behavior

With `INTERACTIVE_ASSIST_MODE=false`:

1. Call `maps_read_place_summary`, `maps_read_route_summary`, or a V4 UI-native operation such as `maps_get_place_share_link`.
2. Confirm it returns `INTERACTIVE_ASSIST_DISABLED` before reading/acting on the rendered UI.

## 4. Place read/select

Restart with `INTERACTIVE_ASSIST_MODE=true`.

1. Call one `maps_search`.
2. Call `maps_read_place_summary`.
3. Confirm the result is small and contains `untrustedExternalText: true`.
4. Confirm it does not contain raw HTML, full DOM/AX dumps, review bodies, cookies, or network payloads.
5. Choose one returned `items[{index,label}]` entry.
6. Call `maps_select_result` with both `index` and that exact `label` as `expectedLabel`.
7. Confirm the intended place opens.

If the list changes before step 6, expected behavior is `UI_STATE_CHANGED`, not a best-effort click.

## 5. V4 selected-place share link

Run this only when validating the V4 place-share semantic operation.

1. Continue from a verified place selected through step 4.
2. Record the selected place's visible heading/label only for the current test; do not persist a place dataset.
3. Call `maps_get_place_share_link({ expectedLabel })` with that exact active-place identity.
4. Confirm the returned `placeLabel` still identifies the selected place.
5. Confirm the returned URL is HTTPS and is either a `maps.app.goo.gl` share link or a `www.google.com/maps...` Maps URL.
6. Confirm the Share dialog is not left open after a successful operation.
7. Confirm no clipboard dump, unrelated page text, cookies, network response, internal Maps endpoint, or raw DOM/AX payload is returned.

Fail-closed probes:

- call with a deliberately wrong `expectedLabel` for the already-open place; expected `UI_STATE_CHANGED` and no Share activation,
- if the active place changes between read and action, expected `UI_STATE_CHANGED`,
- if the visible Share target or resulting share URL is ambiguous/missing, expected a semantic error rather than a guessed click/link.

Do **not** intentionally trigger sign-in, consent, CAPTCHA, or another challenge to test this operation. If one occurs naturally, stop and use the Human Intervention checks below. After handoff completion, reissue the place workflow and revalidate identity; do not automatically replay the old share action.

## 6. V4 selected-place tabs and opening hours

Run these only from a freshly verified active place with Interactive Assist enabled.

1. Call `maps_select_place_tab({ expectedLabel, tab: "about" })`, then `maps_select_place_tab({ expectedLabel, tab: "overview" })`.
2. Confirm each successful state-changing selection verifies the requested tab as selected, preserves the same place identity, and advances the resource epoch. An already-selected tab must be idempotent.
3. Do not test a Reviews enum: it is intentionally absent until a current visible Reviews tab is re-observed.
4. From a fresh Overview place, call `maps_expand_opening_hours({ expectedLabel })`. Confirm the result reports expansion state only and does not return the weekly-hours text.
5. If `placeStateRetained` is `true`, a repeated expansion should report `alreadyExpanded: true` without another epoch change. If `placeStateRetained` is `false`, confirm the prior place semantic state was invalidated and reacquire the place before another semantic action.
6. Wrong identity, missing/duplicate controls, unexpected navigation, or invalid postconditions must fail closed. After any click whose postcondition cannot be verified, prior semantic state must not remain usable.

## 7. Route read/select

When validating the V4-F Recommended/Best travel-mode slice, begin from a fresh simple `maps_directions({ origin, destination, mode: "transit" })` request with an explicit origin, no waypoints, and no avoid constraints:

1. Call `maps_set_recommended_travel_mode({ expectedOrigin: "deliberately wrong", expectedDestination: destination })`; expect `UI_STATE_CHANGED` before UI mutation and no resource-epoch advance.
2. Call `maps_set_recommended_travel_mode({ expectedOrigin: origin, expectedDestination: destination })` once; confirm exact-one `Best` / `おすすめ` is selected, the resolved visible origin/destination values remain unchanged, and the page remains a directions surface.
3. Confirm success advances the resource epoch exactly once, clears the stale replayable canonical directions action, and preserves the current directions view.
4. After bounded UI settle, confirm `maps_read_route_summary` and guarded `maps_select_route(index, expectedLabel)` remain usable in the same session.
5. Omitted-origin, waypoint, avoid-constrained, non-transit, missing/duplicate Recommended control, unexpected navigation, or invalid postcondition cases must fail closed. Never infer Recommended state from the stale `travelmode=transit` URL or opaque `/data=` payload.

When validating the V4-D same-day transit-time slice, begin from a fresh simple `maps_directions({ origin, destination, mode: "transit" })` request with Interactive Assist enabled:

1. Call `maps_set_transit_time({ expectedOrigin: origin, expectedDestination: destination, mode: "depart_at", time: "13:30" })`. Repeat separately with `mode: "arrive_by"` only when that compatibility path needs checking.
2. Confirm wrong expected origin/destination fails before UI mutation and does not advance the resource epoch.
3. Confirm success preserves the visible resolved origin/destination values, verifies the localized selected time mode plus exact transit-time input, stays in the directions view, and advances the resource epoch once.
4. Confirm the original replayable navigation action is cleared after success; do not automatically apply `maps_set_travel_mode` or another UI-only route mutation from stale pre-time state.
5. After the route list settles, `maps_read_route_summary` and guarded `maps_select_route(index, expectedLabel)` must remain usable in the same browser session. Do not require at least one route candidate as the time-setting postcondition because a valid requested time may have no service.
6. Missing/duplicate controls, stale route endpoints, unexpected navigation, invalid time postcondition, or Human Intervention must fail closed. Never parse the opaque `/data=` route payload, and do not expose generic text entry.
7. Date selection, Last available, and transit preference options are not part of this slice.

For V4-D selected transit-route sharing, start from a fresh simple `maps_directions({ origin, destination, mode: "transit" })`, read route candidates, and select one with guarded `maps_select_route(index, expectedLabel)`:

1. Call `maps_get_route_share_link({ expectedOrigin: origin, expectedDestination: destination })`.
2. Confirm wrong expected endpoints fail before opening the share dialog and do not advance the resource epoch.
3. Confirm success requires the selected-route detail view, exact Share directions control, selected Send-link tab, and exactly one visible allow-listed Maps share URL; no clipboard read/interception is used.
4. Confirm the dialog closes through exact Close semantics, the route view/canonical action remain intact, and the resource epoch does not advance for this read-only semantic operation.
5. Driving/other modes, waypoint/avoid routes, and the unselected directions Copy link surface are not part of this slice.

For V4-D endpoint swap, start from a fresh simple `maps_directions({ origin, destination, mode })` request with an explicit origin and no waypoints:

1. Call `maps_swap_route_endpoints({ expectedOrigin: origin, expectedDestination: destination })`.
2. Confirm a deliberately wrong expected endpoint fails before navigation and does not advance the resource epoch.
3. Confirm success rebuilds the documented Maps URL with origin/destination reversed, preserves travel mode and any bounded avoid constraints, updates the canonical directions action, and advances the resource epoch exactly once.
4. Omitted-origin and waypoint routes must fail closed rather than guessing reversal semantics.
5. Confirm the implementation does not click the observed Maps swap UI control; live observation showed that control swaps visible inputs but leaves the canonical URL/action stale.

1. Call one `maps_directions`.
2. Call `maps_read_route_summary`.
3. Confirm only a small bounded set of route-related labels/lines is returned.
4. Select one returned route with `index` + `expectedLabel`.
5. Confirm the intended route is selected.

## 8. Manual navigation / stale-state guard

1. Start a Maps search or directions request through MCP.
2. Manually navigate the dedicated browser to a different Maps surface.
3. Attempt the previous semantic operation (for example, select a prior result, share the prior place, or change a prior route's travel mode).

Expected: `UI_STATE_CHANGED` and a requirement to rerun the appropriate semantic workflow. The MCP must not act on stale semantic state.

## 9. Human-intervention boundary

If a consent, sign-in, CAPTCHA, or other access challenge appears naturally:

1. Confirm the MCP stops with `HUMAN_INTERVENTION_REQUIRED`.
2. Confirm it does not attempt CAPTCHA solving, stealth/fingerprint changes, proxy rotation, credential entry, or internal endpoint calls.
3. Confirm the agent sends no cleanup click/key/CDP input while Human Intervention is active.
4. If the user manually resolves the screen, reissue the intended Maps operation and revalidate target identity instead of continuing/replaying stale state.

Do not intentionally trigger access challenges for testing. Deterministic repository tests cover the fail-closed challenge URL/redirect boundary; live confirmation is opportunistic when a challenge naturally appears.

## 10. Bulk-policy boundary

Send a clearly bulk-oriented search request such as asking to collect every store/review in a large area.

Expected: `POLICY_BLOCKED` before browser navigation.

Do not split a rejected bulk request into many smaller calls. That would violate the intended project boundary even if each individual query were accepted.

## Release result

Record only pass/fail, selected runtime (`host` or `container` when applicable), the specific semantic operation checked, and the Google Maps UI date/locale used for the check. Do not attach screenshots or logs containing account information, private locations, cookies, browser profiles, or personal identifiers to public issues.

If a semantic target no longer matches the live Maps UI, keep the affected tool experimental/disabled until the bounded selector/identity logic is updated and this checklist passes again.

For V4 feature status see [maps-web-capability-inventory.md](maps-web-capability-inventory.md). For the full release procedure, see [release.md](release.md).