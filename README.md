# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

A constrained, experimental MCP browser controller for user-directed interaction with Google Maps through a dedicated Chrome/Chromium session.

> **Status:** V1–V4 are implemented/closed out for the current unauthenticated scope. V5-A through V5-D authenticated workflows are implemented behind a disabled-by-default, fail-closed single-user/dedicated-profile opt-in; V5-E history was evaluated and intentionally adds no history tool. Remaining partial capabilities stay explicitly observation/design-gated rather than guessed. Google Maps UI-dependent interaction and bounded visible-state reading remain experimental because the live Maps UI can change.

## Why this project exists

General-purpose browser MCPs are powerful, but they expose a much larger control surface than a Maps-only task needs. `maps-browser-mcp` takes the opposite approach:

- expose only Maps-specific MCP tools,
- use official Google Maps URLs whenever possible,
- keep Chrome DevTools Protocol (CDP) local,
- use a dedicated browser profile,
- fail closed when the page/state is ambiguous,
- make visible-state reading explicit, bounded, and disabled by default,
- do not implement scraping, CAPTCHA bypass, stealth, or internal Maps API harvesting.

### Where this project fits

If a supported Google Maps Platform API or Google-managed Maps MCP already satisfies a workflow **without requiring the rendered Maps Web experience**, prefer that supported structured interface. `maps-browser-mcp` exists for bounded workflows that genuinely require the user-visible Maps web surface. Official-interface overlap is therefore a priority signal, not an automatic scope exclusion, and the browser path is never an API-avoidance mechanism.

| Surface | Best fit | This project intentionally differs by |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supported structured Maps, grounding, place, route, or related data where available | prefer these when the rendered Maps Web experience is not required; this project controls a bounded user-visible Maps browser session |
| General-purpose browser MCPs | broad web navigation and arbitrary browser automation | exposes Maps-specific actions and a substantially smaller capability surface |
| Scrapers / dataset harvesters | bulk collection and persistent extraction | explicitly out of scope; visible-state reading is bounded, transient, and opt-in |

See **[Project positioning](docs/positioning.md)**, **[V4 Maps Web Capability Inventory](docs/maps-web-capability-inventory.md)**, and **[Compliance boundaries](docs/compliance.md)** for the detailed category, coverage, and safety boundaries.

## V4 closeout and V5 authenticated direction

V4 is intentionally broader than V1–V3 but keeps the same constrained architecture:

> **V4 = broad semantic coverage of major Google Maps Web capabilities available without authentication.**

Priority order is browser-native/UI-dependent behavior first; search/directions/place operations required to complete the browser workflow second; and capabilities that mostly duplicate official structured interfaces third.

The canonical unauthenticated per-capability status table is **[Google Maps Web Capability Inventory](docs/maps-web-capability-inventory.md)**. The current **[V5 authenticated-workflows baseline](docs/v5-authenticated-workflows.md)** implements V5-A identity-free readiness, V5-B bounded save-state reads, V5-C one exact existing-list Save mutation, and V5-D bounded selected-route Send-to-phone with explicit one-shot MCP action approval. V5-E history is intentionally blocked from adding a tool because the observed History surface crosses into My Activity and Maps-local Recent lacks a stable bounded activity-row contract. Neither V4 nor V5 exposes raw DOM, raw Accessibility Tree, raw CDP, generic browser actions, desktop actions, or shell execution through MCP.

## 5-minute quick start

Requirements: Node.js 20+ and Google Chrome/Chromium.

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
npm start
```

That starts the MCP over **stdio** in safe mode. The first Maps action starts/reuses a dedicated Chrome profile.

For Streamable HTTP instead:

```bash
npm run start:http
```

Default MCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

Process liveness:

```bash
curl -i http://127.0.0.1:8787/healthz
```

Browser/CDP readiness without visiting Google Maps:

```bash
curl -i http://127.0.0.1:8787/readyz
```

For a complete first-run walkthrough, browser behavior, generic MCP client configuration, V3/V4 Interactive Assist opt-in, and cleanup, see **[Getting Started](docs/getting-started.md)**.

## Example workflows

Navigation does not require Interactive Assist:

```text
maps_search({ query: "Tokyo Station" })
```

```text
maps_directions({
  origin: "Tokyo Station",
  destination: "Yokohama Station",
  mode: "transit"
})
```

When Interactive Assist is enabled, the safe selection pattern is:

```text
maps_search(...)
  -> maps_read_place_summary()
  -> choose items[{ index, label }]
  -> maps_select_result({ index, expectedLabel: label })
```

A V4-C search filter keeps the same search identity chain explicit:

```text
maps_search({ query })
  -> maps_set_search_rating({ expectedQuery: query, rating: "4.0" })
  -> maps_read_place_summary()
```

`maps_set_search_rating` exposes only the live-reobserved `2.0|2.5|3.0|3.5|4.0|4.5` Rating options. It revalidates the visible search query before each bounded UI action, then verifies the exact requested selected chip (for example `4.0+`) with the Rating menu closed before advancing the resource epoch. Price, Hours, and All filters remain observation/design-gated rather than sharing a generic filter API.

Autocomplete is also bounded rather than generic browser input:

```text
maps_read_search_suggestions({ query: "Tokyo Station" })
  -> choose items[{ index, label }]
  -> maps_select_search_suggestion({ query: "Tokyo Station", index, expectedLabel: label })
```

`maps_read_search_suggestions` opens a fresh Maps suggestion surface and returns at most six unique composite visible identities from the exact combobox-controlled grid. Primary names may repeat, so `maps_select_search_suggestion` requires the same active query plus the exact returned index and label immediately before activation; stale/reordered/duplicate identities fail closed. Success is accepted only after the suggestion grid closes and Maps settles to a verified search or place view. Raw combobox/DOM access is never exposed.

For an active search-result list, `maps_get_search_share_link({ expectedQuery })` revalidates the canonical and exact visible query, activates exactly one live-observed Share control, reads one allow-listed Maps-generated URL from the selected Send-link tab, and closes the dialog semantically. It never reads clipboard contents and does not change the search resource epoch on success.

`maps_zoom_search({ expectedQuery, direction })` adds only the bounded stateful viewport operation that was re-observed safely beyond `maps_show`: one search-result zoom step with `direction: "in" | "out"`. It requires one exact visible query and one exact visible enabled Zoom button immediately before the click, then verifies that the same search/query remains active and the public Maps viewport path changes by exactly one zoom level. Map-center coordinates are not treated as stable identity, and generic pan/recenter or root/place zoom is not exposed.

The first V4 browser-native workflow extends that identity chain to a Maps-generated place share URL:

```text
maps_search(...)
  -> maps_read_place_summary()
  -> maps_select_result({ index, expectedLabel: label })
  -> maps_get_place_share_link({ expectedLabel: selectedPlaceLabel })
```

`maps_get_place_share_link` revalidates the active place immediately before activating the visible Share control and fails closed if the place/share target changed or became ambiguous. The same verified-place model is used by `maps_search_nearby`, `maps_open_place_photos`, `maps_select_place_tab`, and `maps_expand_opening_hours`. Place-tab selection currently exposes only live-reobserved `overview` / `about` semantics; Reviews remains observation-gated. Opening-hours expansion verifies the state transition without returning or harvesting a weekly-hours dataset.

For routes:

```text
maps_directions({ origin, destination, mode: "transit" })
  -> maps_set_transit_time({
       expectedOrigin: origin,
       expectedDestination: destination,
       mode: "depart_at",
       time: "13:30"
     })
  -> maps_read_route_summary()
  -> choose items[{ index, label }]
  -> maps_select_route({ index, expectedLabel: label })
```

`maps_set_transit_time` is intentionally limited to the same-day live-reobserved `depart_at|arrive_by` flow with a 24-hour `HH:MM` input. It requires a fresh simple `maps_directions` transit request, revalidates the documented origin/destination identity before mutation, then verifies the localized mode trigger, the exact `transit-time` input, unchanged visible route endpoints, and the directions view. Because the resulting UI-only time state is not represented by the original documented navigation action, the successful operation clears that replayable action while keeping the current route results readable/selectable in the same browser session. Date selection, last-available service, and transit preference options remain separate observation/design-gated slices.

`maps_set_recommended_travel_mode({ expectedOrigin, expectedDestination })` covers the live-observed `Best` / `おすすめ` radio only for a fresh simple **transit** request. It rejects omitted origins, waypoints, avoid constraints, and non-transit starts; verifies the exact radio plus unchanged resolved endpoints and the directions surface; then advances the resource epoch and drops the stale replayable `travelmode=transit` action while preserving the current route results for bounded read/select. This avoids pretending the original documented URL still represents the UI's Recommended mode.

`maps_swap_route_endpoints({ expectedOrigin, expectedDestination })` covers the observed origin/destination swap without automating the Maps swap button. Live JA/en-US observation verified the exact semantic swap control and visible endpoint A/B -> B/A transition, but also showed that the UI click leaves the canonical URL/action stale. The MCP operation therefore requires a fresh simple documented directions request, revalidates the expected canonical endpoints, rejects omitted origins and waypoint routes, preserves travel mode and bounded avoid constraints, and rebuilds the documented Maps URL with the endpoints reversed.

`maps_get_route_share_link({ expectedOrigin, expectedDestination })` returns the Maps-generated short link from the selected-route **transit** share dialog. After a guarded `maps_select_route`, it requires the expected simple canonical transit identity, activates exactly one live-observed `Share directions` control, verifies the selected `Send a link` tab plus exactly one allow-listed visible Maps URL field, then closes the dialog semantically before returning. It never reads clipboard contents. The earlier unselected `Copy link` surface remains unused, and driving/other modes stay observation-gated because the visible link field was not stable in the bounded re-observation.

`expectedLabel` is important: if Google Maps dynamically reorders or replaces the target, the runtime refuses stale interaction with `UI_STATE_CHANGED` instead of acting on a different target.

## MCP tools

### Navigation

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`

### Semantic interaction

- `maps_select_result`
- `maps_read_search_suggestions` — V4-F, max 6 composite suggestion identities; establishes bounded suggestion state, Interactive Assist required
- `maps_select_search_suggestion` — V4-F, same active query + guarded `index/expectedLabel`, Interactive Assist required
- `maps_get_search_share_link` — V4-F, active search-result Share dialog, clipboard-free, Interactive Assist required
- `maps_set_search_rating` — V4, fixed observed rating enum, Interactive Assist required
- `maps_zoom_search` — V4, search-only one-level `in|out`, Interactive Assist required
- `maps_get_place_share_link` — V4, Interactive Assist required
- `maps_search_nearby` — V4, Interactive Assist required
- `maps_open_place_photos` — V4, Interactive Assist required
- `maps_select_place_tab` — V4, `overview|about` only, Interactive Assist required
- `maps_expand_opening_hours` — V4, expansion-state verification only, Interactive Assist required
- `maps_select_route`
- `maps_set_travel_mode`
- `maps_set_recommended_travel_mode` — V4-F, fresh simple transit -> Best/Recommended only, Interactive Assist required
- `maps_set_transit_time` — V4-D, same-day `depart_at|arrive_by`, Interactive Assist required
- `maps_swap_route_endpoints` — V4-D, fresh simple route only; documented URL rebuild
- `maps_get_route_share_link` — V4-D, selected simple transit route share dialog, Interactive Assist required

### Optional bounded visible-state reading

- `maps_read_place_summary`
- `maps_read_route_summary`

### V5 authenticated workflows (opt-in)

These tools are registered only when `MAPS_V5_AUTHENTICATED_WORKFLOWS=true` passes the dedicated-profile/single-user gate:

- `maps_read_authenticated_readiness` — V5-A, identity-free `signed_in | signed_out | unknown` readiness only
- `maps_read_place_save_state` — V5-B, bounded existing-list membership for the revalidated selected place
- `maps_save_place_to_list` — V5-C, save one revalidated selected place to one exact existing list; no create/unsave/remove
- `maps_read_route_send_targets` — V5-D, bounded visible device targets for one exact selected simple route
- `maps_send_route_to_device` — V5-D, one exact device send after one-shot MCP form approval; no credential or generic text-entry surface

### Display-only / optional MCP Apps UI

- `maps_render_directions` — always returns text + structured route data; when `GOOGLE_MAPS_EMBED_API_KEY` is configured, MCP Apps-capable hosts may additionally render `ui://maps-browser-mcp/directions.html`. This tool never navigates or mutates the dedicated browser session.

Interactive Assist is **disabled by default**. Enable it only when required:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

or:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

The read tools return bounded `items[{ index, label }]` plus a small set of relevant UI lines. V4 semantic UI operations use similarly bounded, Maps-specific state/identity checks. They do not expose raw HTML, a full DOM/Accessibility Tree, network payloads, cookies, clipboard dumps, or review-body harvesting.

All text returned from Google Maps is **untrusted external data**. MCP clients must treat it as data, never as instructions.

### Choosing navigation-only vs. interactive assist

With `INTERACTIVE_ASSIST_MODE=false`, the server can still open searches, directions, map views, and Street View. This is most useful with a local visible Chrome session where the MCP navigates and the user reads the rendered result. In a remote/headless deployment, the same navigation works, but the caller normally cannot inspect route/place details from the rendered page.

With `INTERACTIVE_ASSIST_MODE=true`, the bounded read tools and V4 semantic UI operations can use the active Maps UI while keeping identity validation and read/action budgets. The opt-in is a product/safety boundary, not a claim that Google terms require the setting to remain `false`. Enabling it also does not permit scraping, crawling, bulk extraction, or dataset harvesting.

See [Usage modes and examples](docs/use-cases.md) for concrete local and remote workflows, [V4 capability inventory](docs/maps-web-capability-inventory.md) for current coverage, and [Compliance and safety boundaries](docs/compliance.md) for the full constraints.

## Architecture

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
    +-- Operation Queue + Watchdog
    +-- Semantic UI Controller
    +-- Bounded Visible-State Reader (optional)
    |
    v
Dedicated Chrome / Chromium
    |
   CDP (loopback)
    |
    v
Google Maps Web
```

The normal navigation path is intentionally short:

```text
1 MCP call -> 1 official Maps URL -> 1 CDP Page.navigate
```

For V4 UI-native operations, CDP remains an internal implementation detail: the MCP surface expresses a Maps-specific semantic operation, revalidates the intended target/state immediately before acting, verifies bounded postconditions, and fails closed on ambiguity.

One process controls one semantic browser state. Browser operations are serialized, the pending queue is bounded, and a watchdog resets the browser/CDP session if an operation exceeds the configured timeout.

See **[Architecture](docs/architecture.md)** for the detailed runtime/state/security model.

## Requirements and platform support

- Node.js 20+
- Google Chrome or Chromium
- macOS, Linux, or Windows

Common Chrome/Chromium install locations are auto-detected. Set `MAPS_CHROME_EXECUTABLE` if required.

Normal CI covers Node.js 20/22/24 and real Chrome/CDP startup. Browser startup is additionally smoke-tested on GitHub-hosted macOS and Windows runners. The required Node 22 check also builds the container image, exercises sandboxed and explicit restricted-runtime browser paths, and verifies both `/healthz` and `/readyz` without visiting Google Maps.

## Dedicated browser profile

By default the managed browser profile lives at:

```text
~/.maps-browser-mcp/chrome-profile
```

Do not point this project at your everyday Chrome profile.

The managed CDP endpoint binds to `127.0.0.1`. The runtime validates the managed browser identity before reusing a profile and refuses to guess between multiple open Google Maps tabs.

If Google displays consent, sign-in, CAPTCHA, or another access challenge, the MCP stops with `HUMAN_INTERVENTION_REQUIRED`. Resolve legitimate manual steps through the existing Human Intervention flow. Completion does not approve a different action, and stateful semantic operations require fresh reissue/revalidation rather than automatic replay.

## HTTP and remote MCP clients

The HTTP server binds to loopback by default:

```text
127.0.0.1:8787
```

Recommended remote architecture:

```text
Remote MCP client
   -> authenticated HTTPS tunnel / reverse proxy
   -> 127.0.0.1:8787/mcp
   -> maps-browser-mcp
   -> dedicated local Chrome
```

Only the MCP transport should cross the remote boundary. **Never expose the Chrome DevTools port publicly.**

If you deliberately bind the Node server to a non-loopback address, startup requires both:

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<at least 24 characters>
```

This is an advanced escape hatch, not the recommended deployment shape.

For ChatGPT-specific deployment and tool refresh notes, see **[ChatGPT connection notes](docs/chatgpt.md)**.

## Configuration

The server does not automatically load `.env`. Use your shell, process manager, or preferred environment loader. See [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | Project-specific HTTP port; takes precedence over `PORT` |
| `PORT` | unset | Generic HTTP-port fallback when `MCP_HTTP_PORT` is unset |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Accepted Host names |
| `MCP_ALLOWED_ORIGINS` | empty | Optional exact Origin allowlist |
| `MCP_ALLOW_NONLOOPBACK` | `false` | Explicit opt-in before non-loopback bind |
| `MCP_BEARER_TOKEN` | empty | Optional guard; mandatory for non-loopback bind; minimum 24 chars |
| `MCP_MAX_BODY_BYTES` | `262144` | Maximum MCP request body size |
| `MAPS_CHROME_EXECUTABLE` | auto-detect | Chrome/Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | Dedicated profile directory |
| `MAPS_ALLOW_EXTERNAL_CDP` | `false` | Explicit opt-in before existing-CDP attachment |
| `MAPS_CDP_PORT` | unset | Advanced: existing local CDP endpoint |
| `MAPS_HEADLESS` | `false` | Headless Chrome |
| `MAPS_ALLOW_UNSANDBOXED_CHROMIUM` | `false` | Linux-only last-resort opt-in for restricted isolated runtimes; adds `--no-sandbox` |
| `INTERACTIVE_ASSIST_MODE` | `false` | Enable bounded visible-state reading and V4 semantic UI operations that require it |
| `MAPS_V5_AUTHENTICATED_WORKFLOWS` | `false` | Enable the fail-closed bounded V5 authenticated tools; also requires Interactive Assist and the dedicated single-user profile gate |
| `GOOGLE_MAPS_EMBED_API_KEY` | unset | Optional restricted Maps Embed API key for the MCP Apps directions view; the text/structured render tool remains available without it |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | Process-local action guard |
| `MAPS_MAX_VISIBLE_READS_PER_HOUR` | `30` | Independent bounded visible-state/UI read budget |
| `MAPS_MAX_AX_NODES` | `120` | Accessibility-node bound for bounded visible-state reading |
| `MAPS_MAX_READ_CHARS` | `1800` | Returned-text bound for bounded visible-state reading |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | Maximum queued browser operations |
| `MAPS_OPERATION_TIMEOUT_MS` | `25000` | Per-operation watchdog |

Invalid boolean/integer configuration fails fast instead of being silently coerced.

### V5 authenticated-workflow opt-in

`MAPS_V5_AUTHENTICATED_WORKFLOWS=true` is an additional fail-closed opt-in for bounded authenticated V5 semantics. With Interactive Assist enabled it exposes only the staged identity-free readiness, bounded selected-place save-state read, exact existing-list Save, bounded selected-route Send-to-phone target read, and approval-gated single-device send documented in the V5 baseline. The setting rejects existing-CDP attachment, rejects `MCP_AUTH_PROVIDER=module` until per-principal profile isolation exists, and requires an absolute dedicated profile path when overridden. The send mutation additionally requires a modern MCP 2026-07-28 client with form elicitation support.

For the current remote single-user design, authenticate the public MCP client at an external gateway and use the private `static-bearer` hop to this core server. Do not forward a caller's public OAuth access token into the browser runtime. The versioned [reference OAuth gateway](reference/oauth-gateway/README.md) implements this shape as an isolated dogfood package; it is not included in the published root npm package. See [V5 authenticated workflows](docs/v5-authenticated-workflows.md) and [OAuth gateway pattern](docs/oauth-gateway.md).

### Existing CDP endpoint

`MAPS_CDP_PORT` is intentionally guarded. It is rejected unless `MAPS_ALLOW_EXTERNAL_CDP=true` is also set.

Only attach to a **local, dedicated Chrome/Chromium instance you control**. Attaching to an everyday personal browser weakens profile isolation and is not recommended.

## Safety and compliance boundaries

This project is a constrained, user-directed browser agent. It is **not** intended to be:

- a general-purpose browser MCP,
- a bulk Google Maps scraper/crawler,
- a place/review/route dataset harvester,
- a CAPTCHA solver,
- an anti-bot bypass tool.

Overlap with Google Maps Platform or a Google-managed Maps MCP is not itself out of scope, but browser implementation is prioritized only where it contributes to the user-visible Maps Web workflow.

It intentionally does not implement Google Maps internal API interception, XHR/fetch harvesting, stealth plugins, fingerprint spoofing, proxy rotation, persistent Maps datasets, raw DOM/CDP MCP tools, generic desktop control, or shell control.

Obvious bulk-collection requests are rejected by the policy layer. Interactive Assist has a separate rolling hourly read budget. Navigation remains restricted to the Google Maps HTTPS web surface. Visible inline access challenges are detected and stop the operation.

This project does not claim that every browser-agent usage is guaranteed permitted by Google. Users are responsible for applicable service terms and laws. Where supported structured Google Maps interfaces already satisfy the workflow without requiring Maps Web, prefer those interfaces. See **[Compliance boundaries](docs/compliance.md)**.

## Privacy

The server does not intentionally persist Maps result datasets. The dedicated Chrome profile is persistent local browser state, so Chrome may retain ordinary browser artifacts such as cookies, cache, preferences, and history.

Use a dedicated profile, avoid signing in unless necessary, and remove the dedicated profile when you need those local browser artifacts deleted.

Tool handlers do not log search queries or Maps result contents by default. Remote clients receive generalized unexpected-error responses rather than local paths/environment details. HTTP responses use `Cache-Control: no-store`.

Never commit browser profiles, `.env` files, tunnel credentials, tokens, screenshots/traces containing personal data, or generated Maps datasets.

## Testing and CI

Local verification:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

Normal CI intentionally **does not visit Google Maps**. It verifies protocol, package, browser/CDP, security, cross-platform behavior, and container/headless portability without turning GitHub Actions into unattended Maps automation.

Container validation is part of the existing required `check (22)` job rather than a separate optional job. It verifies that the image does not enable `--no-sandbox` by default, exercises a sandbox-capable container path, checks fail-closed behavior in a restricted runtime, exercises the explicit compatibility mode, and verifies `/healthz`, `/readyz`, and generic `PORT` fallback behavior.

The repository also provides **Live Maps E2E (manual)**, a `workflow_dispatch`-only, fixed, low-volume compatibility check for the experimental live-UI paths. See **[Manual live E2E](docs/manual-e2e.md)**. Consent/sign-in/CAPTCHA/challenge behavior is never deliberately triggered or bypassed; those live cases are rechecked opportunistically when they occur naturally, while deterministic repository tests enforce the no-bypass boundary.

GitHub Actions dependencies are pinned to full commit SHAs. Dependabot monitors npm, GitHub Actions, and the container base image. CodeQL runs JavaScript/TypeScript analysis and the protected `main` branch requires the configured CI/CodeQL checks before merge.

## Current limitations

- Google Maps UI changes can break experimental semantic selectors.
- V4 coverage closeout is complete for the current unauthenticated scope; the canonical inventory records implemented, partial, and explicitly observation/design-gated capabilities plus their re-open conditions.
- Bounded visible-state/UI interaction remains experimental and opt-in.
- One process is designed for one local user/browser session, not multi-tenant hosting.
- CAPTCHA, consent, and sign-in flows are not bypassed.
- Rate/read counters are process-local safety guards, not persistent accounting or a legal-compliance mechanism.

See **[Troubleshooting](docs/troubleshooting.md)** for recovery guidance and error-code explanations.

## Documentation

| Document | Purpose |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Installation, first run, client shape, Interactive Assist opt-in, cleanup |
| [Container / headless Linux](docs/container.md) | Standard Linux container, headless Chromium, ports, profiles, readiness, and sandbox boundaries |
| [Troubleshooting](docs/troubleshooting.md) | Error codes and safe recovery procedures |
| [ChatGPT](docs/chatgpt.md) | Remote ChatGPT/App connection boundary and tool refresh |
| [Architecture](docs/architecture.md) | Runtime, CDP, state, queue/watchdog, semantic UI operation model |
| [Project positioning](docs/positioning.md) | Competitive category, Maps Web priority, official-interface overlap, and product direction |
| [V4 Maps Web Capability Inventory](docs/maps-web-capability-inventory.md) | Canonical unauthenticated capability coverage/status table and V4 slices |
| [MCP Apps portability](docs/mcp-apps.md) | Host-neutral UI contract, fallback, layout, security, deployment and compatibility evidence |
| [V5 authenticated workflows](docs/v5-authenticated-workflows.md) | Authenticated boundary, bounded saved-state/send scopes, and explicit approval gates |
| [Roadmap](docs/roadmap.md) | V4 closeout baseline plus MCP Apps portability status and future direction |
| [Compliance](docs/compliance.md) | Intended-use and non-goal boundaries |
| [Manual live E2E](docs/manual-e2e.md) | User-triggered Google Maps compatibility verification |
| [Release checklist](docs/release.md) | Pre-release CI, live check, security and tagging procedure |
| [Security Policy](SECURITY.md) | Security model and private vulnerability reporting |
| [Contributing](CONTRIBUTING.md) | Scope, PR rules, tests and security-sensitive changes |

## Contributing

Contributions are welcome within the project's constrained scope. Read **[CONTRIBUTING.md](CONTRIBUTING.md)** before opening a PR.

`main` is protected; changes should land through pull requests with the required CI and CodeQL checks.

## Release status

The repository metadata for the v0.3.1 release baseline is versioned as `0.3.1`. V5-A through V5-D are implemented but remain disabled by default behind the authenticated-workflow opt-in. `maps-browser-mcp` is not published to npm in this release; use the GitHub source tag/Release.

See **[Release checklist](docs/release.md)** before tagging or publishing.

## Security

Use GitHub Private Vulnerability Reporting for security issues. Do not publish exploit details, credentials, browser profiles, private locations, or tokens in public issues.

See **[SECURITY.md](SECURITY.md)**.

## Disclaimer

This is an independent open-source project and is not affiliated with or endorsed by Google. Google Maps and related marks are trademarks of their respective owner. Users are responsible for complying with applicable service terms and laws.

## License

MIT