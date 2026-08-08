# Troubleshooting

This page maps common runtime symptoms and MCP error codes to the safest recovery action.

## Start with the basics

From the repository root:

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

If these pass, the remaining issue is usually browser state, client configuration, or live Google Maps UI compatibility.

## `BROWSER_UNAVAILABLE`

Typical causes:

- Chrome/Chromium is not installed in a detected location.
- `MAPS_CHROME_EXECUTABLE` points to a missing/non-executable file.
- the configured profile cannot be created or opened.
- an existing CDP endpoint is unavailable.
- multiple Google Maps tabs are open in the dedicated profile.

Recovery:

1. close extra Maps tabs in the dedicated profile,
2. confirm Chrome launches normally,
3. run `npm run smoke:browser`,
4. set `MAPS_CHROME_EXECUTABLE` only if auto-detection still fails,
5. avoid `MAPS_CDP_PORT` unless you intentionally manage that Chrome instance yourself.

## `MAPS_NOT_OPEN`

The controlled tab is blank or no longer on the expected Maps surface.

Recovery: run the original `maps_search`, `maps_directions`, `maps_show`, or `maps_streetview` action again. Do not try to reuse old candidate indexes.

## `UI_STATE_CHANGED`

This is a safety stop, not necessarily a defect.

It means the current browser UI no longer matches the semantic state that produced the previous candidate list. Examples:

- Google reordered search results,
- a route list changed,
- the user manually navigated the dedicated browser,
- the browser session reconnected,
- a previous `expectedLabel` no longer matches the selected index.

Recovery:

```text
repeat maps_search/maps_directions
  -> read the summary again if V3 is enabled
  -> use the new index + expectedLabel
```

Do not retry an old index blindly.

## `UI_ELEMENT_NOT_FOUND`

The expected bounded Maps UI element was not present.

Possible causes:

- Google Maps changed its UI structure,
- the page has not reached the expected state,
- the selected index no longer exists,
- the locale/layout differs from a currently supported selector path.

First rerun the original navigation action. If the problem reproduces with the manual Live Maps E2E workflow, open an issue with only non-sensitive reproduction details. Do not attach cookies, browser profiles, account screenshots, or private locations.

## `HUMAN_INTERVENTION_REQUIRED`

The browser left the permitted Maps surface or Google presented a consent, sign-in, CAPTCHA, or access challenge.

Expected behavior is to stop.

Recovery:

1. inspect the dedicated browser manually,
2. complete a legitimate consent/sign-in step yourself if desired,
3. do not automate CAPTCHA solving or anti-bot bypass,
4. repeat the original Maps action after the manual step.

The server intentionally invalidates stale semantic state around these transitions.

## `INTERACTIVE_ASSIST_DISABLED`

V3 read tools are disabled by default.

Enable them explicitly:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

or:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Do not enable V3 if navigation-only behavior is sufficient for your use case.

## `POLICY_BLOCKED`

The request violates a local safety boundary, commonly because it looks like bulk collection/scraping or exceeds supported query constraints.

Do not work around this by splitting a bulk task into many calls. This project is designed for user-directed interactive Maps use, not dataset collection.

## `NAVIGATION_BLOCKED`

The requested/generated destination is outside the allowlisted Google Maps HTTPS surface.

This is a hard boundary. Do not broaden it to arbitrary Google pages or third-party sites as a troubleshooting workaround.

## `RATE_LIMITED`

A process-local action or V3 read budget was reached.

Defaults:

```text
MAPS_MAX_ACTIONS_PER_MINUTE=30
MAPS_MAX_VISIBLE_READS_PER_HOUR=30
```

Wait for the rolling window to clear. Increasing limits should be deliberate and should not be used to turn the project into a bulk collector.

## `SERVER_BUSY`

The serialized browser operation queue is full.

Default:

```text
MAPS_MAX_PENDING_ACTIONS=8
```

Reduce concurrent client calls. One process controls one semantic browser state; high parallelism is intentionally not supported.

## `OPERATION_TIMEOUT`

An operation exceeded `MAPS_OPERATION_TIMEOUT_MS` and the runtime reset the browser/CDP session.

Default:

```text
MAPS_OPERATION_TIMEOUT_MS=25000
```

Recovery: repeat the original navigation action. Do not assume previous search/route state survived the reset.

If timeouts are frequent, check local Chrome startup/performance before raising the timeout.

## HTTP server will not start on a non-loopback address

This is intentional. A non-loopback bind requires both:

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<at least 24 characters>
```

The recommended deployment is still to keep the Node server on loopback and place an authenticated HTTPS tunnel/reverse proxy in front of it.

## HTTP returns 401/403-like access failures

Check:

- `MCP_BEARER_TOKEN` if configured,
- the request `Host` against `MCP_ALLOWED_HOSTS`,
- the request `Origin` against `MCP_ALLOWED_ORIGINS` when that allowlist is configured,
- authentication at the tunnel/reverse proxy layer.

Do not disable host/origin/auth checks just to make a public endpoint reachable.

## ChatGPT cannot see updated tools

Custom MCP/App clients may cache or freeze tool definitions.

After changing tool names or schemas, refresh/rescan the app/tool definitions in the client. Prefer backward-compatible optional fields over breaking schema changes.

See [chatgpt.md](chatgpt.md) for the ChatGPT-specific lifecycle.

## Chrome profile problems

The default dedicated profile is:

```text
~/.maps-browser-mcp/chrome-profile
```

Do not reuse your everyday Chrome profile.

If the dedicated profile is corrupted and you do not need its local browser state:

1. stop `maps-browser-mcp`,
2. make sure the managed Chrome process is closed,
3. move or delete only the dedicated profile directory,
4. start the MCP again to create a fresh profile.

Never publish the profile in an issue or attach it to a bug report.

## Live Maps E2E fails while normal CI passes

That usually means the runtime/build is healthy but Google Maps' current UI no longer matches an experimental semantic selector.

Use [manual-e2e.md](manual-e2e.md) to identify whether place selection, route selection, or bounded reading changed. Keep the affected UI-dependent feature experimental until the live check passes again.

## What to include in a bug report

Useful:

- OS and version,
- Node major version,
- Chrome/Chromium version,
- `maps-browser-mcp` commit/tag,
- error code,
- which tool was called,
- whether normal smoke tests pass,
- whether the manual Live Maps E2E reproduces the problem.

Do not include:

- cookies,
- browser profiles,
- authorization headers,
- tunnel tokens,
- account identifiers,
- private/home/work locations,
- screenshots containing personal data.

For security issues, follow [SECURITY.md](../SECURITY.md) instead of opening a detailed public issue.
