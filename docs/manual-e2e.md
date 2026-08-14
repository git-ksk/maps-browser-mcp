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

The fixed workflow now verifies the established search/read/select path, exactly one V4 selected-place share-link operation, and the established transit route read/select path. It does not broaden into result crawling, screenshots, review harvesting, or persistence.

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

## 6. V4 selected-place tabs

Run this only from a freshly verified active place with Interactive Assist enabled.

1. Call `maps_select_place_tab({ expectedLabel, tab: "about" })`, then `maps_select_place_tab({ expectedLabel, tab: "overview" })`.
2. Confirm each successful state-changing selection verifies the requested tab as selected, preserves the same place identity, and advances the resource epoch. An already-selected tab must be idempotent.
3. Do not test a Reviews enum: it is intentionally absent until a current visible Reviews tab is re-observed.
4. Wrong identity, missing/duplicate controls, unexpected navigation, or invalid postconditions must fail closed. After any click whose postcondition cannot be verified, prior semantic state must not remain usable.

## 7. Route read/select

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