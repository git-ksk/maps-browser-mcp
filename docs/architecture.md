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
   +-- OperationQueue
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

The design is for a single local user/browser session. Multi-user hosting would require an isolated policy engine, queue, browser process/profile, and semantic state per authenticated principal; that is out of scope for the initial design.

## Browser lifecycle

By default, the runtime starts or reuses a dedicated Chrome/Chromium process/profile outside the repository at `~/.maps-browser-mcp/chrome-profile`.

Chrome is launched with a separate `--user-data-dir` and `--remote-debugging-port=0`; the actual loopback DevTools port is read from `DevToolsActivePort`. CDP endpoint identity is checked before reuse.

A caller may instead set `MAPS_CDP_PORT` to attach to an existing **local** CDP endpoint. This is an advanced escape hatch and weakens the dedicated-profile isolation guarantee. It should never point to a publicly reachable or everyday personal browser instance.

If the CDP target becomes stale or reconnects, semantic state is invalidated rather than assuming that the newly attached page still represents the previous search/directions operation.

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
9. enforces a total character budget,
10. disables Accessibility immediately afterwards.

The result explicitly marks Maps labels/text as untrusted external data. The server does not execute instructions contained in page content.

It does not return full DOM/AX dumps, raw HTML, review bodies, network responses, or Google Maps internal API payloads.

## HTTP transport

The HTTP server uses the MCP 2026-07-28 single `POST /mcp` entry point. It includes:

- loopback bind by default,
- Host allowlisting,
- optional exact Origin allowlisting,
- optional constant-time Bearer token guard,
- startup refusal for unauthenticated non-loopback binding unless external auth is explicitly trusted,
- bounded request body size,
- request/header/keep-alive timeouts,
- client-abort propagation,
- streamed response backpressure handling.

`/healthz` is separate and supports `GET`/`HEAD`.

## CI boundary

CI runs unit tests, dependency audit, MCP HTTP initialization/security smoke tests, a real headless Chrome/CDP startup test, package dry-run, and Node.js 20/22/24 builds.

CI intentionally does **not** automate visits to Google Maps pages. UI-dependent compatibility therefore remains experimental and requires user-directed/manual E2E validation.
