# Architecture

`maps-browser-mcp` is intentionally narrower than a general browser automation MCP. The public tool surface describes Google Maps actions; low-level browser primitives remain internal.

See [V4 Google Maps Web Capability Inventory](maps-web-capability-inventory.md) for the canonical unauthenticated feature coverage and [Project positioning](positioning.md) for the browser-vs-structured-interface priority model.

## Layers

```text
MCP client
   |
   v
MCP tools
   |
   +-- MapsUrlCompiler
   +-- PolicyEngine
   +-- OperationQueue + Watchdog
   +-- SemanticController
   +-- VisibleStateReader (optional)
   |
   v
MapsBrowserRuntime
   |
   v
Chrome DevTools Protocol
   |
   v
Dedicated Chrome / Chromium profile
   |
   v
Google Maps Web
```

## Process model

One process owns one semantic Maps browser session. Browser-affecting MCP operations are serialized by a bounded `OperationQueue`, preventing concurrent calls from racing the single page and preventing an unlimited pending backlog.

Each queued browser operation also has a watchdog (`MAPS_OPERATION_TIMEOUT_MS`, default 25 seconds). If an operation exceeds the limit, the queue resets the browser/CDP session before releasing the next operation and returns `OPERATION_TIMEOUT`. This prevents one unresolved CDP call from permanently wedging the single-session queue.

The design is for a single local user/browser session. Multi-user hosting would require an isolated policy engine, queue, browser process/profile, and semantic state per authenticated principal; that is out of scope for the initial design.

## Browser lifecycle

By default, the runtime starts or reuses a dedicated Chrome/Chromium process/profile outside the repository at `~/.maps-browser-mcp/chrome-profile`.

Chrome is launched with a separate `--user-data-dir`, `--remote-debugging-address=127.0.0.1`, and `--remote-debugging-port=0`. The project-managed endpoint is read from Chrome's `DevToolsActivePort` record and is reused only when **both** the numeric port and browser WebSocket identity match the live `/json/version` endpoint. This avoids trusting a stale profile file if an unrelated Chrome process later reuses the same numeric port. On Unix-like systems, the dedicated profile directory is restricted to the current user.

A caller may instead set `MAPS_CDP_PORT` to attach to an existing **local** CDP endpoint, but only when `MAPS_ALLOW_EXTERNAL_CDP=true` is also set. This is an advanced escape hatch and weakens the dedicated-profile isolation guarantee. It should never point to a publicly reachable or everyday personal browser instance.

When connecting to the dedicated browser, the runtime accepts zero or one Google Maps page target. If more than one Maps tab is open, it refuses to guess which tab to control and returns an error. This preserves the one-process/one-semantic-session invariant.

If the CDP target becomes stale, reconnects, or is reset by the watchdog, semantic state is invalidated rather than assuming that the newly attached page still represents the previous search/directions operation.

No stealth plugins, fingerprint spoofing, proxy rotation, or CAPTCHA solvers are used.

## Navigation fast path

Search, directions, map views, and coordinate-based Street View use official Google Maps URLs. The normal path is:

```text
1 MCP call -> 1 URL compilation -> 1 CDP Page.navigate
```

No page discovery or DOM scan is needed for these operations.

## Semantic interaction

The MCP does not expose generic `click`, `type`, arbitrary selector, JavaScript-execution, raw DOM, raw Accessibility Tree, or raw CDP tools to the model.

Place and route candidates are extracted through bounded Maps-specific heuristics. The **same candidate extraction logic** is used when the bounded reader lists indexed candidates and when selection acts on an index. Selection optionally accepts `expectedLabel`; if the dynamic Google Maps list changed after reading, the click is refused with `UI_STATE_CHANGED`.

Changing travel mode does not click the page. The server recompiles the active official directions URL with the requested travel mode and navigates directly.

### V4 browser-native semantic operation pattern

V4 broadens coverage into Maps Web functions that cannot be represented adequately by documented Maps URLs, while keeping the public surface semantic and Maps-specific.

A V4 UI-native operation should follow this pattern:

```text
validated semantic state
  -> bounded target probe
  -> expected identity revalidation
  -> exactly one Maps-specific visible control/action
  -> bounded postcondition/result probe
  -> semantic result or fail closed
```

Required properties:

1. **State gate** — verify the current Google Maps surface and expected semantic view before action.
2. **Identity gate** — re-read the intended target immediately before mutation/interaction. Dynamic ordering or a changed active place/route must invalidate the action.
3. **Scoped target** — operate only inside the verified Maps-specific surface; do not search/click arbitrary page controls.
4. **Ambiguity refusal** — zero, duplicate, conflicting, or stale targets return a semantic error instead of selecting heuristically.
5. **Bounded postcondition** — inspect only the minimum visible state needed to prove the requested result.
6. **Policy accounting** — Interactive Assist, action limits, and visible-read limits remain applicable when the operation reads UI state.
7. **Human Intervention authority** — if consent, sign-in, CAPTCHA, or another challenge is detected, agent input stops. Cleanup code must not send further CDP input while a Human Intervention is active.
8. **Fresh reissue after handoff** — completion of Human Intervention is not approval for another action and does not authorize automatic replay of a stateful semantic operation.
9. **No hidden data path** — do not substitute internal Maps API/XHR harvesting, generic clipboard dumps, or undocumented endpoint extraction for visible semantic interaction.

The first V4 operation, `maps_get_place_share_link(expectedLabel)`, applies this pattern to the selected place panel: it verifies place state, revalidates the active place heading, requires exactly one visible Share control in that verified panel, accepts only a bounded Maps share URL from the resulting dialog, and closes the dialog only while agent authority remains active.

## Visible-state reading

Visible-state reading is optional and disabled by default. When enabled, the reader:

1. verifies that the active page is still on the Google Maps web surface,
2. verifies compatible semantic state (search/place or directions/route),
3. extracts a bounded candidate list using the selection logic,
4. requires the Maps `role=main` region instead of falling back to the whole document,
5. enables Chrome Accessibility only for the bounded read,
6. walks a bounded number of accessibility nodes,
7. keeps a small set of relevant text lines,
8. strips control/bidirectional formatting characters,
9. enforces a total character budget and an independent rolling hourly read budget,
10. disables Accessibility immediately afterwards.

The result explicitly marks Maps labels/text as untrusted external data. The server does not execute instructions contained in page content.

It does not return full DOM/AX dumps, raw HTML, review bodies, network responses, or Google Maps internal API payloads.

The action/read counters are process-local safety guards and reset when the process restarts. They are not persistent accounting or a claim of legal compliance.

## Human Intervention boundary

Naturally occurring consent, sign-in, CAPTCHA, and access-challenge surfaces suspend agent authority through the existing Execution Handoff path.

The boundary is deliberately separate from semantic action approval:

- MCP never receives account credentials,
- challenges are not solved or bypassed,
- completing human control does not approve the pending or a different action,
- state-changing/state-dependent semantic operations require fresh reissue and revalidation,
- reconnect/restart never automatically replays an older semantic operation,
- V4 operation cleanup must test intervention state before sending any best-effort UI input.

## HTTP transport

The HTTP endpoint is backed by the official MCP TypeScript v2 server entry and supports both protocol eras handled by that entry:

- the 2025-era `initialize` flow,
- the `2026-07-28` `server/discover` / request `_meta` flow, including standardized `Mcp-Method` and `Mcp-Name` validation.

The Node HTTP bridge includes:

- loopback bind by default,
- Host allowlisting,
- optional exact Origin allowlisting,
- optional constant-time Bearer token guard,
- an explicit `MCP_ALLOW_NONLOOPBACK=true` gate plus mandatory application Bearer protection for deliberate non-loopback binding,
- bounded request body size,
- request/header/keep-alive timeouts,
- client-abort propagation,
- streamed response backpressure handling,
- `Cache-Control: no-store` on success, health, and error responses.

Non-loopback binding is an advanced escape hatch. The preferred remote architecture keeps Node on loopback behind an authenticated HTTPS tunnel/reverse proxy. A static Bearer token must not be transmitted over an unencrypted network path.

`/mcp` accepts `POST`; `GET /mcp` is rejected. `/healthz` is separate and supports `GET`/`HEAD`.

## Persistent browser state

The server does not intentionally persist Maps result datasets. The dedicated Chrome profile itself is persistent, however, and Chrome may retain normal local browser artifacts such as cookies, cache, preferences, and browsing history. That profile should be treated as sensitive local state and should not be committed or shared.

## CI boundary

Normal CI runs dependency audit, type/unit checks, Node.js 20/22/24 builds, real stdio MCP round trips/tool registration for both the 2025 and 2026-07-28 eras, legacy and modern HTTP protocol smoke tests (including a real modern `tools/call` with `Mcp-Name` and rejection of malformed modern headers), HTTP security/no-store checks, package dry-run, and real headless Chrome/CDP startup tests.

Chrome/CDP startup is exercised without Google Maps traffic on GitHub-hosted Linux, macOS 15 arm64, and Windows runners.

Normal push/PR CI intentionally does **not** automate visits to Google Maps pages. A separate manual-only `Live Maps E2E` workflow performs fixed, low-volume real-UI compatibility probes when explicitly triggered by a maintainer/user. V4 live checks remain bounded, user-directed, and must never deliberately generate or bypass CAPTCHA/challenge flows.