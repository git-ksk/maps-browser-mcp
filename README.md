# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

A lightweight MCP server for interacting with Google Maps through a dedicated browser session, without relying on the Google Maps Platform API.

> **Status:** Early development. V1–V3 are implemented; Google Maps UI-dependent interactions remain experimental.

## What it does

`maps-browser-mcp` exposes a small Maps-specific MCP surface instead of a general-purpose browser controller.

- Opens search, directions, map, and Street View pages through official Google Maps URLs.
- Runs a dedicated Chrome/Chromium profile over Chrome DevTools Protocol (CDP).
- Keeps generic browser primitives such as arbitrary `click`, `type`, selectors, and JavaScript execution out of the MCP tool surface.
- Supports bounded semantic selection of place and route candidates.
- Optionally reads a small, bounded summary from the active Maps UI.
- Does not require a Google Maps Platform API key.

## Tools

### Navigation

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`

### Interaction

- `maps_select_result`
- `maps_select_route`
- `maps_set_travel_mode`

### Optional V3 visible-state reading

- `maps_read_place_summary`
- `maps_read_route_summary`

Visible-state reading is **disabled by default**. Enable it explicitly with `INTERACTIVE_ASSIST_MODE=true`.

The read tools return bounded `items[{ index, label }]` plus a small set of relevant UI lines. When selecting an item, pass the returned `label` as `expectedLabel` when possible. If Google Maps dynamically reorders the list, the server refuses the stale click with `UI_STATE_CHANGED` instead of selecting a different item.

All text returned from Google Maps is marked as **untrusted external data**. MCP clients should treat it as data, never as instructions.

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
   CDP
    |
    v
Google Maps Web
```

The normal navigation path is intentionally short:

```text
1 MCP call -> 1 official Maps URL -> 1 CDP Page.navigate
```

Browser operations are serialized because one process controls one browser tab. A bounded pending queue prevents concurrent MCP requests from racing the page or growing an unlimited backlog. A watchdog resets the browser session if one operation exceeds `MAPS_OPERATION_TIMEOUT_MS`, so a stuck CDP operation cannot permanently wedge the queue.

See [docs/architecture.md](docs/architecture.md) for details.

## Requirements

- Node.js 20+
- Google Chrome or Chromium

The server searches common Chrome/Chromium install locations on macOS, Linux, and Windows. Set `MAPS_CHROME_EXECUTABLE` if necessary.

## Install

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

This package is distributed as a CLI (`maps-browser-mcp`); it does not expose the process-starting CLI entrypoint as a library export.

### stdio

```bash
npm start
```

### Streamable HTTP

```bash
npm run start:http
```

Default endpoint:

```text
http://127.0.0.1:8787/mcp
```

The HTTP entry supports both the MCP 2025-era stateless handshake and the MCP `2026-07-28` modern `server/discover` / per-request `_meta` path through the official v2 server entry. `/mcp` accepts `POST`; `GET /mcp` is rejected. `/healthz` supports `GET`/`HEAD`. HTTP responses are marked `Cache-Control: no-store` because MCP responses can contain location/route information.

## V3 interactive assist

To allow the two read-summary tools:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

The reader does **not** return a full DOM, full accessibility tree, raw HTML, network payloads, or review bodies. It:

1. verifies that the dedicated tab is still on the Google Maps web surface,
2. requires an active search/place or directions/route state,
3. extracts a small candidate list using the same bounded logic used by selection,
4. locates the Maps `role=main` region without widening the scan to the whole document,
5. enables the Accessibility domain only for the bounded read,
6. enforces node, line, character, and hourly read limits,
7. strips control/bidirectional formatting characters,
8. immediately disables the Accessibility domain again.

Defaults:

```text
MAPS_MAX_AX_NODES=120
MAPS_MAX_READ_CHARS=1800
MAPS_MAX_VISIBLE_READS_PER_HOUR=30
```

The hourly visible-read budget is separate from the general per-minute action rate. It provides a server-side collection bound even when a request does not match a bulk-request keyword pattern.

## Configuration

The server does not automatically load `.env`; use your shell, process manager, or preferred environment loader. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | HTTP port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Accepted Host header names |
| `MCP_ALLOWED_ORIGINS` | empty | Optional exact Origin allowlist |
| `MCP_BEARER_TOKEN` | empty | Bearer-token guard; required for non-loopback binds; minimum 24 chars |
| `MCP_MAX_BODY_BYTES` | `262144` | Maximum MCP request body size |
| `MAPS_CHROME_EXECUTABLE` | auto-detect | Chrome/Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | Dedicated profile directory |
| `MAPS_ALLOW_EXTERNAL_CDP` | `false` | Explicit opt-in before attaching to an existing CDP endpoint |
| `MAPS_CDP_PORT` | unset | Advanced: attach to an existing local Chrome CDP endpoint |
| `MAPS_HEADLESS` | `false` | Run Chrome headless |
| `INTERACTIVE_ASSIST_MODE` | `false` | Enable V3 bounded reading |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | Process-level action guard |
| `MAPS_MAX_VISIBLE_READS_PER_HOUR` | `30` | Independent V3 read budget |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | Maximum queued browser operations |
| `MAPS_OPERATION_TIMEOUT_MS` | `25000` | Per-operation watchdog; resets browser session on timeout |

Invalid boolean/integer configuration values fail fast instead of being silently coerced.

### Existing CDP endpoint warning

`MAPS_CDP_PORT` is an advanced escape hatch. It is rejected unless `MAPS_ALLOW_EXTERNAL_CDP=true` is also set. When enabled, the server attaches to an already-running **local** Chrome/Chromium endpoint instead of launching its own dedicated profile. Only use a CDP endpoint you control. Attaching to a personal everyday browser weakens the profile-isolation boundary and is not recommended.

Chrome instances launched by this project explicitly bind their remote-debugging endpoint to `127.0.0.1`, and the dedicated profile directory is restricted to the current user on Unix-like systems.

## Connecting a remote MCP client

The server binds to loopback by default. If a remote MCP client such as ChatGPT needs to reach it, place an HTTPS tunnel or reverse proxy in front of `/mcp`.

Recommended setup:

1. keep the Node server bound to loopback,
2. add the public proxy hostname to `MCP_ALLOWED_HOSTS`,
3. enforce authentication/access control at the tunnel or reverse proxy,
4. optionally configure `MCP_BEARER_TOKEN` as an additional server-side guard,
5. never commit tunnel credentials, browser profiles, tokens, or local environment values.

If you deliberately bind `MCP_HTTP_HOST` to a non-loopback address, the process refuses to start unless `MCP_BEARER_TOKEN` is configured. Front-proxy authentication alone is not treated as sufficient protection for a directly reachable non-loopback Node port.

## Safety and compliance boundaries

This project is designed as a constrained, user-directed browser agent. It is **not** intended to be:

- a Google Maps Platform API replacement,
- a general-purpose browser MCP,
- a bulk Google Maps scraper,
- a place/review/route dataset harvester,
- a CAPTCHA solver,
- an anti-bot bypass tool.

It intentionally does not implement Google Maps internal API interception, XHR/fetch harvesting, stealth plugins, fingerprint spoofing, proxy rotation, or persistent Maps datasets.

Obvious bulk-collection requests are rejected by the server-side policy layer, V3 reads have a separate rolling hourly budget, navigation is restricted to the Google Maps web surface, and access challenges require human intervention.

V3 visible-state reading is deliberately conservative, but Google does not explicitly guarantee that every browser-agent usage is permitted. Users remain responsible for applicable Google Maps/Google terms and laws. See [docs/compliance.md](docs/compliance.md).

## Privacy

The project does not intentionally persist Google Maps result data. Browser state lives in the dedicated local Chrome profile. Tool handlers do not log search queries or Maps result contents by default. Unexpected internal errors are logged locally, while remote MCP clients receive a generic error to avoid leaking local paths or environment details. HTTP responses use `Cache-Control: no-store`.

Do not commit your Chrome profile, environment files, tunnel credentials, or tokens.

## Current limitations

- Google Maps UI structure can change, so semantic result/route selection may need maintenance.
- V3 visible-state reading is experimental and intentionally conservative.
- The current process model is designed for one local user/browser session, not shared multi-tenant hosting.
- CAPTCHA, consent, or sign-in flows are not bypassed; manual browser interaction may be required.
- Normal push/PR CI intentionally does not visit Google Maps pages. The separate `Live Maps E2E (manual)` workflow performs a fixed, low-volume user-triggered compatibility check.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

CI verifies Node.js 20, 22, and 24, dependency audit, type checking, unit tests, build, real stdio round trips/tool registration, both the legacy 2025-era and modern `2026-07-28` HTTP paths, HTTP security/no-store behavior, package contents, and real Chrome/CDP startup without visiting Google Maps. Browser startup is additionally smoke-tested on GitHub-hosted Linux, macOS 15 arm64, and Windows runners. GitHub Actions dependencies are pinned to full commit SHAs, and Dependabot monitors both npm and Actions dependencies.

See [SECURITY.md](SECURITY.md) for security guidance.

## Disclaimer

This is an independent open-source project and is not affiliated with or endorsed by Google. Google Maps and related marks are trademarks of their respective owner. Users are responsible for complying with applicable service terms and laws.

## License

MIT
