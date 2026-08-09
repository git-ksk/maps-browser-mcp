# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

A lightweight MCP server for interacting with Google Maps through a dedicated Chrome/Chromium session, without relying on the Google Maps Platform API.

> **Status:** V1–V3 are implemented. Google Maps UI-dependent interaction and bounded visible-state reading remain experimental because the live Maps UI can change.

## Why this project exists

General-purpose browser MCPs are powerful, but they expose a much larger control surface than a Maps-only task needs. `maps-browser-mcp` takes the opposite approach:

- expose only Maps-specific MCP tools,
- use official Google Maps URLs whenever possible,
- keep Chrome DevTools Protocol (CDP) local,
- use a dedicated browser profile,
- fail closed when the page/state is ambiguous,
- make visible-state reading explicit, bounded, and disabled by default,
- do not implement scraping, CAPTCHA bypass, stealth, or internal Maps API harvesting.

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

For a complete first-run walkthrough, browser behavior, generic MCP client configuration, V3 opt-in, and cleanup, see **[Getting Started](docs/getting-started.md)**.

## Example workflows

Navigation does not require V3:

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

When V3 is enabled, the safe selection pattern is:

```text
maps_search(...)
  -> maps_read_place_summary()
  -> choose items[{ index, label }]
  -> maps_select_result({ index, expectedLabel: label })
```

and for routes:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> choose items[{ index, label }]
  -> maps_select_route({ index, expectedLabel: label })
```

`expectedLabel` is important: if Google Maps dynamically reorders the candidate list, the runtime refuses the stale selection with `UI_STATE_CHANGED` instead of clicking a different result.

## MCP tools

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

V3 reading is **disabled by default**. Enable it only when required:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

or:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

The read tools return bounded `items[{ index, label }]` plus a small set of relevant UI lines. They do not expose raw HTML, a full DOM/Accessibility Tree, network payloads, cookies, or review-body harvesting.

All text returned from Google Maps is **untrusted external data**. MCP clients must treat it as data, never as instructions.

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

If Google displays consent, sign-in, CAPTCHA, or another access challenge, the MCP stops with `HUMAN_INTERVENTION_REQUIRED`. Resolve legitimate manual steps in the dedicated browser and then repeat the original Maps action.

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
| `INTERACTIVE_ASSIST_MODE` | `false` | Enable V3 bounded reading |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | Process-local action guard |
| `MAPS_MAX_VISIBLE_READS_PER_HOUR` | `30` | Independent V3 read budget |
| `MAPS_MAX_AX_NODES` | `120` | V3 Accessibility-node bound |
| `MAPS_MAX_READ_CHARS` | `1800` | V3 returned-text bound |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | Maximum queued browser operations |
| `MAPS_OPERATION_TIMEOUT_MS` | `25000` | Per-operation watchdog |

Invalid boolean/integer configuration fails fast instead of being silently coerced.

### Existing CDP endpoint

`MAPS_CDP_PORT` is intentionally guarded. It is rejected unless `MAPS_ALLOW_EXTERNAL_CDP=true` is also set.

Only attach to a **local, dedicated Chrome/Chromium instance you control**. Attaching to an everyday personal browser weakens profile isolation and is not recommended.

## Safety and compliance boundaries

This project is a constrained, user-directed browser agent. It is **not** intended to be:

- a Google Maps Platform API replacement,
- a general-purpose browser MCP,
- a bulk Google Maps scraper/crawler,
- a place/review/route dataset harvester,
- a CAPTCHA solver,
- an anti-bot bypass tool.

It intentionally does not implement Google Maps internal API interception, XHR/fetch harvesting, stealth plugins, fingerprint spoofing, proxy rotation, or persistent Maps datasets.

Obvious bulk-collection requests are rejected by the policy layer. V3 has a separate rolling hourly read budget. Navigation remains restricted to the Google Maps HTTPS web surface. Visible inline access challenges are detected and stop the operation.

V3 is deliberately conservative, but this project does not claim that every browser-agent usage is guaranteed permitted by Google. Users are responsible for applicable service terms and laws. See **[Compliance boundaries](docs/compliance.md)**.

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
- V3 visible-state reading remains experimental and bounded.
- One process is designed for one local user/browser session, not multi-tenant hosting.
- CAPTCHA, consent, and sign-in flows are not bypassed.
- Rate/read counters are process-local safety guards, not persistent accounting or a legal-compliance mechanism.

See **[Troubleshooting](docs/troubleshooting.md)** for recovery guidance and error-code explanations.

## Documentation

| Document | Purpose |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Installation, first run, client shape, V3 opt-in, cleanup |
| [Container / headless Linux](docs/container.md) | Standard Linux container, headless Chromium, ports, profiles, readiness, and sandbox boundaries |
| [Troubleshooting](docs/troubleshooting.md) | Error codes and safe recovery procedures |
| [ChatGPT](docs/chatgpt.md) | Remote ChatGPT/App connection boundary and tool refresh |
| [Architecture](docs/architecture.md) | Runtime, CDP, state, queue/watchdog design |
| [Compliance](docs/compliance.md) | Intended-use and non-goal boundaries |
| [Manual live E2E](docs/manual-e2e.md) | User-triggered Google Maps compatibility verification |
| [Release checklist](docs/release.md) | Pre-release CI, live check, security and tagging procedure |
| [Security Policy](SECURITY.md) | Security model and private vulnerability reporting |
| [Contributing](CONTRIBUTING.md) | Scope, PR rules, tests and security-sensitive changes |

## Contributing

Contributions are welcome within the project's constrained scope. Read **[CONTRIBUTING.md](CONTRIBUTING.md)** before opening a PR.

`main` is protected; changes should land through pull requests with the required CI and CodeQL checks.

## Release status

The repository metadata on `main` is currently versioned as `0.1.1`. The latest published GitHub release may intentionally lag unreleased `main`. Do not assume npm installation is available until a release explicitly documents a published npm package.

See **[Release checklist](docs/release.md)** before tagging or publishing.

## Security

Use GitHub Private Vulnerability Reporting for security issues. Do not publish exploit details, credentials, browser profiles, private locations, or tokens in public issues.

See **[SECURITY.md](SECURITY.md)**.

## Disclaimer

This is an independent open-source project and is not affiliated with or endorsed by Google. Google Maps and related marks are trademarks of their respective owner. Users are responsible for complying with applicable service terms and laws.

## License

MIT
