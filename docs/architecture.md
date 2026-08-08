# Architecture

`maps-browser-mcp` is intentionally narrower than a general browser automation MCP. The public tool surface describes Google Maps actions; low-level browser primitives remain internal.

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

Chrome is launched with a separate `--user-data-dir`, `--remote-debugging-address=127.0.0.1`, and `--remote-debugging-port=0`; the actual loopback DevTools port is read from `DevToolsActivePort`. CDP endpoint identity is checked before reuse. On Unix-like systems, the dedicated profile directory is restricted to the current user.

A caller may instead set `MAPS_CDP_PORT` to attach to an existing **local** CDP endpoint, but only when `MAPS_ALLOW_EXTERNAL_CDP=true` is also set. This is an advanced escape hatch and weakens the dedicated-profile isolation guarantee. It should never point to a publicly reachable or everyday personal browser instance.

If the CDP target becomes stale, reconnects, or is reset by the watchdog, semantic state is invalidated rather than assuming that the newly attached page still represents the previous search/directions operation.

No stealth plugins, fingerprint spoofing, proxy rotation, or CAPTCHA solvers are used.

## Navigation fast path

Search, directions, map views, and Street View use official Google Maps URLs. The normal path is:

```text
1 MCP call -> 1 URL compilation -> 1 CDP Page.navigate
```

No page discovery or DOM scan is needed for these operations.

## Semantic interaction

The MCP does not expose generic `click`, `type`, arbitrary selector, or JavaScript-execution tools to the model.

Place and route candidates are extracted through bounded Maps-specific heuristics. The **same candidate extraction logic** is used when V3 lists indexed candidates and when V2 selects an index. Selection optionally accepts `expectedLabel`; if the dynamic Google Maps list changed after reading, the click is refused with `UI_STATE_CHANGED`.

Changing travel mode does not click the page. The server recompiles the active official directions URL with the requested travel mode and navigates directly.

## Visible-state reading (V3)

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

## HTTP transport

The HTTP endpoint is backed by the official MCP TypeScript v2 server entry and supports both protocol eras handled by that entry:

- the 2025-era `initialize` flow,
- the `2026-07-28` `server/discover` / request `_meta` flow, including standardized MCP HTTP header validation.

The Node HTTP bridge includes:

- loopback bind by default,
- Host allowlisting,
- optional exact Origin allowlisting,
- optional constant-time Bearer token guard,
- mandatory application Bearer protection when deliberately binding to a non-loopback address,
- bounded request body size,
- request/header/keep-alive timeouts,
- client-abort propagation,
- streamed response backpressure handling,
- `Cache-Control: no-store` on success, health, and error responses.

`/mcp` accepts `POST`; `GET /mcp` is rejected. `/healthz` is separate and supports `GET`/`HEAD`.

## CI boundary

Normal CI runs dependency audit, type/unit checks, Node.js 20/22/24 builds, real stdio MCP round trips/tool registration, legacy and modern HTTP protocol smoke tests, HTTP security/no-store checks, package dry-run, and real headless Chrome/CDP startup tests.

Chrome/CDP startup is exercised without Google Maps traffic on GitHub-hosted Linux, macOS 15 arm64, and Windows runners.

Normal push/PR CI intentionally does **not** automate visits to Google Maps pages. A separate manual-only `Live Maps E2E` workflow performs the fixed, low-volume real-UI compatibility probe when explicitly triggered by a maintainer/user.
