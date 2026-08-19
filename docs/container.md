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

The Node base image is digest-pinned so an unchanged Dockerfile does not silently move to a different base image. Dependabot monitors Docker dependencies. Chromium itself intentionally follows the current Debian Bookworm package available at build time so security updates are not frozen indefinitely; CI records the actual Node and Chromium versions used by the built image.

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

Chromium's sandbox remains enabled by default. Some isolated container runtimes prohibit the Linux namespace operations Chromium needs for that sandbox. In such an environment, `/healthz` can succeed while `/readyz` and browser operations fail.

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

## Keyless Thin Takeover for Cloud Run

Cloud/container deployments use the same process-owned Chromium + Thin Takeover lifecycle as Mac. No hosted-browser provider or vendor API key is required. A reference credential-safe configuration is:

```bash
MAPS_CREDENTIAL_SAFE_HANDOFF=true
MAPS_CREDENTIAL_SAFE_TRANSPORT=thin_takeover
MAPS_REMOTE_TAKEOVER=true
MAPS_TAKEOVER_PUBLIC_BASE_URL=https://<authenticated-takeover-origin>
MAPS_HEADLESS=true
# configure the existing authenticated HTTP principal boundary as documented above
```

During Human authority the Chromium process/session remains alive inside the same service instance. Agent-owned automation CDP/input authority is detached and fenced; the Thin Takeover Runtime opens an intervention/epoch-bound Human CDP attachment for Phase 1 JPEG screencast capture and bounded Human input. Revocation aborts active frame streams and closes that Human attachment before automation creates a fresh CDP attachment and revalidates Maps readiness.

Phase 1 is intentionally CPU/simple-transport friendly: `Page.startScreencast` JPEG is passed through `FramePipeline` without decode/re-encode and pushed over the authenticated broker stream. A later Phase 2 may replace capture/transport with raw compositor/native frames, optional hardware encoding, WebRTC video, and DataChannel input without changing the Handoff authority contract.

Because the browser session is process/instance-local, instance termination or replacement loses the in-memory browser/Handoff session and must fail closed rather than pretending a takeover can resume elsewhere. Keep the current single-browser deployment boundary (`concurrency=1`, `max-instances=1`) and treat a restart during Human control as a fresh workflow. Durable browser/profile strategy, if needed, is separate from takeover authority and must not persist raw credentials through MCP/Handoff state.

The pending live Google sign-in acceptance test remains separate and manual; this runtime path does not by itself mark that acceptance as passed.

## Browser profile

The image defaults to an ephemeral dedicated profile:

```text
/tmp/maps-browser-mcp/chrome-profile
```

Override it with `MAPS_CHROME_PROFILE_DIR` only when you have a specific single-user persistence requirement. Never point the server at an everyday browser profile, and never share one profile across concurrent users or instances.

## Health and readiness

`GET /healthz` returns a small process-liveness response. It does not start Chromium and does not access Google Maps.

`GET /readyz` verifies that the managed Chromium process and its local CDP endpoint are usable. It may start/reuse the dedicated Chromium session, but it does **not** navigate to Google Maps. A browser startup/CDP failure returns HTTP `503` with only a bounded availability status; detailed local errors remain in server logs.

Because `/readyz` can actively start Chromium, it is protected by `MCP_BEARER_TOKEN` whenever a bearer token is configured. This is especially important for non-loopback deployments, where a bearer token is already mandatory. `/healthz` remains a passive unauthenticated liveness endpoint after Host validation.

Without a configured bearer token on a loopback-only server:

```bash
curl -i http://127.0.0.1:8787/healthz
curl -i http://127.0.0.1:8787/readyz
```

When `MCP_BEARER_TOKEN` is configured:

```bash
curl -i http://127.0.0.1:8787/healthz
curl -i \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8787/readyz
```

The image's Docker `HEALTHCHECK` intentionally continues to use `/healthz` as pure process liveness. Runtime orchestration can use authenticated `/readyz` separately when browser readiness is required.

## CI coverage

Container validation is part of the repository's existing required Node 22 CI job rather than a separate optional job. CI:

- builds the image
- records Node/Chromium versions
- verifies that unsandboxed Chromium is not enabled by the image
- exercises a sandbox-capable browser/CDP path
- verifies restricted runtimes do not silently downgrade the sandbox
- exercises the explicit `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` fallback
- verifies `PORT` fallback, `/healthz`, authenticated `/readyz`, and rejection of unauthenticated active readiness checks when a bearer token is configured

Normal container CI never visits Google Maps.

## Shutdown

The HTTP process handles `SIGTERM` and `SIGINT`, closes the MCP handler, shuts down the managed browser runtime, closes idle HTTP connections, and then exits. This keeps container shutdown aligned with the normal server lifecycle.

## Security notes

The normal safety invariants remain in force in containers:

- default bind address remains loopback
- non-loopback binding requires `MCP_ALLOW_NONLOOPBACK=true`
- non-loopback binding also requires a bearer token of at least 24 characters
- active `/readyz` browser probes require the configured bearer token
- Chromium sandbox disabling requires a separate explicit opt-in
- external CDP attachment remains opt-in
- V3 visible-state reading remains opt-in
- Maps-derived text remains untrusted external data
- CAPTCHA, sign-in, consent, and access challenges are not bypassed

Containerization does not change the project's Google Maps usage boundaries or terms-of-service considerations.
