# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

A lightweight MCP server for interacting with Google Maps through a dedicated browser session, without relying on the Google Maps Platform API.

> **Status:** Early development. V1–V3 functionality is implemented; Google Maps UI-dependent interactions remain experimental.

## What it does

`maps-browser-mcp` gives MCP clients a small, Maps-specific tool surface instead of a general-purpose browser controller.

- Opens searches, directions, map views, and Street View through official Google Maps URLs.
- Runs a dedicated Chrome/Chromium profile over the Chrome DevTools Protocol (CDP).
- Keeps generic browser primitives such as `click`, `type`, selectors, and arbitrary JavaScript out of the MCP tool surface.
- Supports limited semantic selection of place and route results.
- Optionally reads a bounded summary of the current Maps accessibility state.
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

## Architecture

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
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

See [docs/architecture.md](docs/architecture.md) for details.

## Requirements

- Node.js 20+
- Google Chrome or Chromium

The server searches common Chrome/Chromium install locations on macOS, Linux, and Windows. Set `MAPS_CHROME_EXECUTABLE` if necessary.

## Install

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm install
```

### stdio

```bash
npm run dev
```

### Streamable HTTP

```bash
npm run dev:http
```

Default endpoint:

```text
http://127.0.0.1:8787/mcp
```

The HTTP server uses the current MCP TypeScript SDK v2 server packages and supports the modern MCP HTTP entry point with the SDK's legacy stateless compatibility behavior.

## V3 interactive assist

To allow the two read-summary tools:

```bash
INTERACTIVE_ASSIST_MODE=true npm run dev:http
```

The reader does **not** return a full DOM or a full accessibility tree. It locates the Maps main region, walks a bounded number of accessibility nodes, selects a small number of relevant text lines, enforces a character budget, and immediately disables the Accessibility domain again.

Defaults:

```text
MAPS_MAX_AX_NODES=120
MAPS_MAX_READ_CHARS=1800
```

## Configuration

Copy `.env.example` values into your runtime environment as needed. The server does not automatically load `.env`; use your shell, process manager, or preferred environment loader.

Important options:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | HTTP port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Accepted Host header names |
| `MCP_ALLOWED_ORIGINS` | empty | Optional exact Origin allowlist |
| `MCP_BEARER_TOKEN` | empty | Optional bearer-token guard |
| `MAPS_CHROME_EXECUTABLE` | auto-detect | Chrome/Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | Dedicated profile directory |
| `MAPS_CDP_PORT` | unset | Reuse an already-running CDP endpoint |
| `MAPS_HEADLESS` | `false` | Run Chrome headless |
| `INTERACTIVE_ASSIST_MODE` | `false` | Enable V3 bounded reading |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | Process-level action guard |

## Connecting a remote MCP client

The server binds to loopback by default. If a remote MCP client such as ChatGPT needs to reach it, place an HTTPS tunnel or reverse proxy in front of `/mcp`.

When doing so:

1. keep the Node server bound to loopback where possible,
2. add the public hostname to `MCP_ALLOWED_HOSTS`,
3. protect the public endpoint with authentication/access control,
4. never commit tunnel credentials, browser profiles, tokens, or local environment values.

`MCP_BEARER_TOKEN` is available as a simple optional server-side guard, but a production/public deployment should use an appropriate authenticated reverse proxy or identity layer.

## Safety and compliance boundaries

This project is designed as a constrained, user-directed browser agent. It is **not** intended to be:

- a Google Maps Platform API replacement,
- a general-purpose browser MCP,
- a bulk Google Maps scraper,
- a place/review/route dataset harvester,
- a CAPTCHA solver,
- an anti-bot bypass tool.

It intentionally does not implement Google Maps internal API interception, XHR/fetch harvesting, stealth plugins, fingerprint spoofing, proxy rotation, or persistent Maps datasets.

Obvious bulk-collection requests are rejected by the server-side policy layer, navigation is restricted to the Google Maps surface, and access challenges require human intervention.

See [docs/compliance.md](docs/compliance.md).

## Privacy

The project does not intentionally persist Google Maps result data. Browser state lives in the dedicated local Chrome profile. Tool handlers do not log search queries or Maps result contents by default.

Do not commit your Chrome profile, environment files, tunnel credentials, or tokens.

## Current limitations

- Google Maps UI structure can change, so semantic result/route selection may need maintenance.
- V3 visible-state reading is experimental and intentionally conservative.
- The current process model is designed primarily for one local user/browser session, not shared multi-tenant hosting.
- CAPTCHA, consent, or sign-in flows are not bypassed; manual browser interaction may be required.

## Development

```bash
npm run typecheck
npm test
npm run build
```

CI runs type checking, unit tests, and the TypeScript build on every push to `main` and on pull requests.

## Disclaimer

This is an independent open-source project and is not affiliated with or endorsed by Google. Google Maps and related marks are trademarks of their respective owner. Users are responsible for complying with applicable service terms and laws.

## License

MIT
