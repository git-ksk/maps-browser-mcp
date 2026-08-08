# User-directed live Google Maps E2E checklist

Normal CI intentionally does not visit Google Maps pages. UI-dependent releases can additionally use the repository's **manual-only** GitHub Actions workflow, `Live Maps E2E (manual)`, or this checklist from a controlled local environment.

The Live workflow is triggered only through `workflow_dispatch`. It performs exactly two fixed, low-volume public scenarios: a place/category search around `Tokyo Station` and a `Tokyo Station` -> `Yokohama Station` transit route. It does not save screenshots, DOM/AX dumps, reviews, cookies, browser profiles, or Maps result artifacts.

Do not turn this checklist or workflow into unattended crawling. Use one ordinary request per scenario and stop if Google presents an access challenge.

## Automated manual-trigger check

From GitHub Actions:

1. Open **Live Maps E2E (manual)**.
2. Choose **Run workflow**.
3. Select `run-live-check` for the confirmation input.
4. Run the workflow.

The workflow verifies:

- official Maps URL navigation stays on the Google Maps web surface,
- one bounded V3 place read returns only limited UI data and marks it untrusted,
- at least one selectable place candidate is detected,
- `index + expectedLabel` selects the same current place candidate,
- one transit directions request produces bounded route data,
- at least one selectable route candidate is detected,
- `index + expectedLabel` selects the same current route candidate,
- access challenges or non-Maps redirects fail rather than being bypassed.

The expected live path is:

```text
place search
  -> bounded place read
  -> guarded place selection
  -> transit directions
  -> bounded route read
  -> guarded route selection
```

No artifact upload step exists in the workflow.

## Preconditions for the full manual checklist

- Use the dedicated `maps-browser-mcp` Chrome profile, not an everyday personal profile.
- Keep the Chrome DevTools port local/private.
- Confirm `npm ci --ignore-scripts`, `npm audit --audit-level=moderate`, `npm run check`, `npm run build`, `npm run smoke:http`, and `npm run smoke:browser` pass first.
- Start with `INTERACTIVE_ASSIST_MODE=false`.

## 1. Search navigation

1. Call `maps_search` for one ordinary public place/category query.
2. Confirm the dedicated browser opens Google Maps search.
3. Confirm no non-Maps page is visited by the MCP.
4. Confirm no result content is persisted by the server.

Expected: one MCP call produces one Maps URL navigation.

## 2. Directions navigation

1. Call `maps_directions` with a public origin/destination and `mode=transit`.
2. Confirm Google Maps opens the directions view.
3. Call `maps_set_travel_mode` once.
4. Confirm the directions URL is rebuilt rather than a generic UI click being used.

## 3. Safe-mode behavior

With `INTERACTIVE_ASSIST_MODE=false`:

1. Call `maps_read_place_summary` or `maps_read_route_summary`.
2. Confirm it returns `INTERACTIVE_ASSIST_DISABLED` and does not read the page.

## 4. V3 place read/select

Restart with `INTERACTIVE_ASSIST_MODE=true`.

1. Call one `maps_search`.
2. Call `maps_read_place_summary`.
3. Confirm the result is small and contains `untrustedExternalText: true`.
4. Confirm it does not contain raw HTML, full DOM/AX dumps, review bodies, cookies, or network payloads.
5. Choose one returned `items[{index,label}]` entry.
6. Call `maps_select_result` with both `index` and that exact `label` as `expectedLabel`.
7. Confirm the intended place opens.

If the list changes before step 6, expected behavior is `UI_STATE_CHANGED`, not a best-effort click.

## 5. V3 route read/select

1. Call one `maps_directions`.
2. Call `maps_read_route_summary`.
3. Confirm only a small bounded set of route-related labels/lines is returned.
4. Select one returned route with `index` + `expectedLabel`.
5. Confirm the intended route is selected.

## 6. Manual navigation / stale-state guard

1. Start a Maps search or directions request through MCP.
2. Manually navigate the dedicated browser to a different Maps surface.
3. Attempt the previous semantic operation (for example, select a prior result or change its travel mode).

Expected: `UI_STATE_CHANGED` and a requirement to run the original search/directions action again. The MCP must not act on stale semantic state.

## 7. Human-intervention boundary

If a consent, sign-in, CAPTCHA, or other access challenge appears:

1. Confirm the MCP stops with `HUMAN_INTERVENTION_REQUIRED`.
2. Confirm it does not attempt CAPTCHA solving, stealth/fingerprint changes, proxy rotation, or internal endpoint calls.
3. If the user manually resolves the screen, repeat the original Maps action instead of continuing from stale state.

Do not intentionally trigger access challenges for testing.

## 8. Bulk-policy boundary

Send a clearly bulk-oriented search request such as asking to collect every store/review in a large area.

Expected: `POLICY_BLOCKED` before browser navigation.

Do not split a rejected bulk request into many smaller calls. That would violate the intended project boundary even if each individual query were accepted.

## Release result

Record only pass/fail and the Google Maps UI date/locale used for the check. Do not attach screenshots or logs containing account information, private locations, cookies, browser profiles, or personal identifiers to public issues.

If candidate extraction no longer matches the live Maps UI, keep the affected tool experimental/disabled until the semantic selectors are updated and this checklist passes again.

For the full release procedure, see [release.md](release.md).
