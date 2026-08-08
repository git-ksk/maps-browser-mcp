# Architecture

`maps-browser-mcp` is intentionally narrower than a general browser automation MCP. The public tool surface describes Google Maps actions, while browser primitives stay internal.

## Layers

```text
MCP client
   |
   v
MCP tools
   |
   +-- MapsUrlCompiler
   +-- PolicyEngine
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

## Browser lifecycle

The runtime starts or reuses one dedicated Chrome/Chromium process and one page target. The default profile is outside the repository at `~/.maps-browser-mcp/chrome-profile`.

Chrome is launched with a separate `--user-data-dir` and `--remote-debugging-port=0`. The actual local DevTools port is read from Chrome's `DevToolsActivePort` file. A caller may instead provide an already-running CDP port with `MAPS_CDP_PORT`.

No stealth plugins, fingerprint spoofing, proxy rotation, or CAPTCHA solvers are used.

## Navigation fast path

Search, directions, map views and Street View use official Google Maps URLs. The normal path is therefore:

```text
1 MCP call -> 1 URL compilation -> 1 CDP Page.navigate
```

No page discovery or DOM scan is needed for these operations.

## Semantic interaction

The MCP never exposes generic `click`, `type`, selector, or arbitrary-JavaScript tools to the model. Internally, a small controller can select bounded place or route candidates. These selectors are implementation details and may require maintenance as Google Maps changes.

Changing travel mode does not click the page. The server recompiles the active official directions URL with the requested travel mode and navigates directly.

## Visible-state reading (V3)

Visible-state reading is optional and disabled by default. When enabled, the reader:

1. locates the page's `role=main` region,
2. enables the Chrome Accessibility domain only for the read,
3. walks a bounded number of accessibility nodes,
4. keeps a small set of relevant text lines,
5. enforces a character budget,
6. disables the Accessibility domain immediately afterwards.

It does not return a full DOM dump, a full accessibility-tree dump, raw HTML, network responses, or Google Maps internal API payloads.

## Process model

The browser runtime and policy engine are process-scoped. MCP server objects may be created per request by the modern stateless Streamable HTTP handler, while the dedicated browser session is shared by that process.

This is designed primarily for a single user's local browser session. Multi-user hosting would require isolated browser/profile runtimes per authenticated principal and is not part of the initial design.
