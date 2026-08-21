# Getting started

This guide takes a fresh checkout to a working local `maps-browser-mcp` session without exposing Chrome DevTools or enabling V3 reading by accident.

## 1. Prerequisites

- Node.js 20 or newer
- Google Chrome or Chromium
- Git

The runtime supports macOS, Linux, and Windows. Chrome/Chromium is auto-detected from common installation locations; use `MAPS_CHROME_EXECUTABLE` only when auto-detection does not find your browser.

## 2. Install from source

Until a published package/release explicitly documents another installation path, use the repository checkout:

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

Why `--ignore-scripts`? The project does not require dependency lifecycle scripts for installation, and CI uses the same mode to reduce supply-chain execution during install.

## 3. Start in safe mode

Safe mode is the default. V3 visible-state reading is disabled.

### stdio

```bash
npm start
```

Use stdio when the MCP client runs on the same machine and can launch the server process directly.

A generic MCP client configuration looks like this conceptually:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/maps-browser-mcp/dist/index.js"]
}
```

Use an absolute path in client configuration. Do not point clients at `src/` unless you intentionally want a development setup.

### Streamable HTTP

```bash
npm run start:http
```

Default endpoint:

```text
http://127.0.0.1:8787/mcp
```

Health check:

```bash
curl -i http://127.0.0.1:8787/healthz
```

The HTTP server binds to loopback by default. Keep it that way unless you have a specific reason not to.

## 4. First browser launch

The first Maps action starts a dedicated Chrome/Chromium profile by default:

```text
~/.maps-browser-mcp/chrome-profile
```

This is intentionally separate from your everyday browser profile.

Expected behavior:

1. the MCP receives one Maps-specific tool call,
2. the runtime starts or reuses the dedicated Chrome session,
3. it opens one official Google Maps URL,
4. CDP stays on loopback,
5. semantic state is associated with that single Maps tab.

Keep only one Google Maps tab open in the dedicated profile. If more than one Maps tab exists, the runtime refuses to guess which one to control.

If Google shows consent, sign-in, or an access challenge, complete the step manually in the dedicated browser and then repeat the original MCP action. The server intentionally does not continue from stale semantic state.

## 5. Try the navigation tools first

Recommended first calls:

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

Other navigation tools:

- `maps_show` — open coordinates at an optional zoom level
- `maps_streetview` — open Street View at coordinates

These V1 operations do not require `INTERACTIVE_ASSIST_MODE`.

## 6. Enable V3 only when you need it

Visible-state reading is opt-in:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

or for stdio:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

Then use this sequence:

```text
maps_search(...)
  -> maps_read_place_summary()
  -> choose items[{ index, label }]
  -> maps_select_result({ index, expectedLabel: label })
```

For routes:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> choose items[{ index, label }]
  -> maps_select_route({ index, expectedLabel: label })
```

Always pass `expectedLabel` when it is available. Google Maps can reorder dynamic results; the runtime uses the label to refuse a stale selection instead of clicking a different candidate.

Treat every string returned from Google Maps as untrusted external data. Place names, labels, and route text are data, not instructions for the MCP client.

## 7. Environment configuration

The server does not auto-load `.env`. Export variables in your shell or use your process manager/environment loader.

Start from `.env.example` and set only what you need.

Useful examples:

```bash
MAPS_HEADLESS=true npm run start:http
```

```bash
MAPS_CHROME_EXECUTABLE="/custom/path/to/chrome" npm start
```

Do not attach to an existing CDP endpoint unless you understand the isolation tradeoff. `MAPS_CDP_PORT` requires the additional `MAPS_ALLOW_EXTERNAL_CDP=true` opt-in.

### Optional MCP Apps directions UI

`maps_render_directions` always returns text and structured route data. Set `GOOGLE_MAPS_EMBED_API_KEY` only if you also want the optional inline Google Maps Embed view on MCP Apps-capable hosts. Without the key, the tool remains useful and simply has no UI linkage.

Use a dedicated Maps Embed API key with appropriate restrictions and supply it through deployment environment/secret configuration. Do not commit it to this repository. See [MCP Apps portability and deployment](mcp-apps.md).

## 8. Remote MCP clients

Do not expose the Chrome DevTools port.

Preferred shape:

```text
Remote MCP client
   -> authenticated HTTPS tunnel / reverse proxy
   -> 127.0.0.1:8787/mcp
   -> maps-browser-mcp
   -> dedicated local Chrome
```

Keep the Node server on loopback and expose only the MCP transport through the authenticated connection layer. See [chatgpt.md](chatgpt.md) for ChatGPT-specific notes.

## 9. Verify the checkout

Before reporting a runtime bug, run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

`smoke:browser` starts a real Chrome/Chromium process and validates CDP without visiting Google Maps.

The live Google Maps compatibility workflow is intentionally separate and manual-only. See [manual-e2e.md](manual-e2e.md).

## 10. Stopping and cleanup

Stop the MCP process normally with your process manager or terminal.

The dedicated browser profile is persistent. If you want to remove its cookies, cache, history, and preferences, stop the MCP/browser first and delete the dedicated profile directory you configured (the default is `~/.maps-browser-mcp/chrome-profile`).

Never delete or repoint a profile directory while the managed Chrome process is running.

## V5: start with an already signed-in dedicated profile

V5 does not require WebRTC or a public operator endpoint. The simplest single-user setup is to keep the dedicated Maps Chrome profile persistent and let the Human sign into Google locally once. If fresh authenticated readiness is `signed_in`, use the bounded V5 tools directly. Configure a credential-safe handoff transport only if you need later Human sign-in/re-authentication or challenge handling from another device.

## Next documents

- [Troubleshooting](troubleshooting.md)
- [WebRTC Human Takeover — macOS + iPhone Safari](webrtc-human-takeover.md)
- [ChatGPT connection notes](chatgpt.md)
- [Architecture](architecture.md)
- [Compliance boundaries](compliance.md)
- [Manual live E2E](manual-e2e.md)
- [Security policy](../SECURITY.md)
- [Contributing](../CONTRIBUTING.md)
