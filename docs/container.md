# Container / headless Linux

`maps-browser-mcp` can run in a standard Linux container with Chromium installed. This is intended for bounded, single-user, self-hosted use; it is not a hosted Maps data API, crawler, or multi-tenant scraping service.

## Build

```bash
docker build -t maps-browser-mcp .
```

The image:

- runs as a non-root `mcp` user
- uses `/usr/bin/chromium`
- installs Chromium's sandbox helper
- enables headless mode
- uses the dedicated ephemeral profile `/tmp/maps-browser-mcp/chrome-profile`
- keeps Chromium config/cache state under writable `/tmp/maps-browser-mcp` paths
- starts the Streamable HTTP transport
- keeps the application's normal loopback bind default unless you explicitly override it

## Run locally through a published container port

A process bound to `127.0.0.1` inside a container is not reachable through a published host port. To publish the MCP endpoint, explicitly opt in to non-loopback binding and configure a strong application bearer token:

```bash
TOKEN="$(openssl rand -hex 24)"

docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_ALLOW_NONLOOPBACK=true \
  -e MCP_BEARER_TOKEN="$TOKEN" \
  maps-browser-mcp
```

Keep the published host port on loopback when possible and place authenticated HTTPS/TLS infrastructure in front if a remote MCP client needs access. Configure `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` for the exact public routing setup when needed.

Do not expose the Chrome DevTools/CDP port.

## Chromium sandbox compatibility

Chromium's sandbox remains enabled by default. Some isolated container runtimes prohibit the Linux namespace operations Chromium needs for that sandbox. In such an environment, browser operations can fail even though `/healthz` succeeds.

Prefer a runtime configuration that allows Chromium's own sandbox. If that is not available and this is a dedicated, isolated, single-user runtime, an explicit compatibility mode is available:

```bash
-e MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true
```

This adds Chromium's `--no-sandbox` flag. It removes an important browser isolation layer, so it is **disabled by default, never enabled automatically, and not appropriate for shared or multi-tenant execution**. The server emits a warning when the mode is actually used.

For example, when a restricted runtime requires this explicit fallback:

```bash
TOKEN="$(openssl rand -hex 24)"

docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_ALLOW_NONLOOPBACK=true \
  -e MCP_BEARER_TOKEN="$TOKEN" \
  -e MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true \
  maps-browser-mcp
```

The project does not silently retry with `--no-sandbox` after a sandbox failure.

## Port selection

HTTP port precedence is:

1. `MCP_HTTP_PORT`
2. `PORT`
3. `8787`

`PORT` exists only as a generic runtime fallback. `MCP_HTTP_PORT` remains the project-specific configuration and takes precedence whenever both are present.

## Browser profile

The image defaults to an ephemeral dedicated profile:

```text
/tmp/maps-browser-mcp/chrome-profile
```

Override it with `MAPS_CHROME_PROFILE_DIR` only when you have a specific single-user persistence requirement. Never point the server at an everyday browser profile, and never share one profile across concurrent users or instances.

## Health check

`GET /healthz` returns a small local process-health response and does not access Google Maps or start a browser operation. Treat it as HTTP-process liveness, not as proof that Chromium or the live Google Maps UI is reachable.

The image includes a container `HEALTHCHECK` using this endpoint.

## Shutdown

The HTTP process handles `SIGTERM` and `SIGINT`, closes the MCP handler, shuts down the managed browser runtime, closes idle HTTP connections, and then exits. This keeps container shutdown aligned with the normal server lifecycle.

## Security notes

The normal safety invariants remain in force in containers:

- default bind address remains loopback
- non-loopback binding requires `MCP_ALLOW_NONLOOPBACK=true`
- non-loopback binding also requires a bearer token of at least 24 characters
- Chromium sandbox disabling requires a separate explicit opt-in
- external CDP attachment remains opt-in
- V3 visible-state reading remains opt-in
- Maps-derived text remains untrusted external data
- CAPTCHA, sign-in, consent, and access challenges are not bypassed

Containerization does not change the project's Google Maps usage boundaries or terms-of-service considerations.
