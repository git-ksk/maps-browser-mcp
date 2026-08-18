# Reference OAuth gateway

This directory contains the isolated, single-user OAuth reference gateway tracked by maps-browser-mcp issue #74. It is a dogfood/reference deployment path, not part of the published root npm package and not a requirement for local or stdio use.

The reference keeps OAuth protocol and token state outside the Maps browser runtime:

```text
Remote MCP client
    |
    | HTTPS + OAuth access token
    v
reference/oauth-gateway  :8080
    |  validates public token
    |  replaces it with a separate private bearer
    v
maps-browser-mcp core    127.0.0.1:8081
    |
    v
Dedicated Chromium profile
```

The combined reference image runs the gateway and current checkout of the core as separate processes in one single-user container. The private core listens only on loopback. A public OAuth access token is never forwarded to the core or browser runtime.

## Status and boundary

This is intentionally narrow:

- exactly one allowed Firebase identity: immutable UID **or** verified email / one logical user;
- one gateway instance / one core browser runtime;
- OAuth Authorization Code + PKCE `S256`;
- exact RFC 8707 resource binding to `${MCP_PUBLIC_BASE_URL}/mcp`;
- OAuth Protected Resource Metadata plus Authorization Server Metadata;
- Client ID Metadata Documents (CIMD), with exact client-host allowlisting and SSRF-resistant metadata/JWKS fetching;
- `private_key_jwt` client authentication;
- `maps:use` as the only Maps resource scope;
- `offline_access` only as an Authorization Server scope for refresh-token requests;
- rotating refresh tokens with family revocation on reuse;
- `iss` in authorization responses;
- `no-store` OAuth responses;
- separate Firestore control-plane collections prefixed `_mapsBrowserMcpRefOAuth...`.

It deliberately does **not** expose Dynamic Client Registration, multi-user browser/profile sharing, generic browser automation, raw Google credentials, or public OAuth token passthrough.

`/takeover/*` is also not proxied by this initial reference gateway. Remote/mobile Human Takeover needs its own authenticated browser-session boundary before it can safely share the public gateway. Keep `MAPS_REMOTE_TAKEOVER=false` for this deployment. Human Intervention still remains available at the controlled browser host and remains separate from action approval.

## Current MCP authorization alignment

The reference follows the MCP 2026-07-28 authorization shape used by this project:

- protected resource metadata is public and advertises the Authorization Server;
- the 401 challenge includes `resource_metadata` and `scope="maps:use"`;
- authorization and token requests must carry the exact `resource`;
- PKCE `S256` is required;
- CIMD is preferred and DCR is intentionally absent;
- `offline_access` is advertised by the Authorization Server but not as a protected-resource requirement;
- access tokens are audience/resource-bound and never transited to the private core.

## Required environment

Gateway / OAuth:

```text
MCP_PUBLIC_BASE_URL=https://your-new-gateway.example.com
MCP_OAUTH_ALLOWED_CLIENT_HOSTS=chatgpt.com
MCP_OAUTH_TRANSACTION_SECRET=<32+ byte secret>
MCP_OAUTH_MAX_REQUESTS_PER_MINUTE=60

MCP_FIREBASE_PROJECT_ID=<project id>
MCP_FIREBASE_ALLOWED_UID=<exact immutable uid>
# Or use MCP_FIREBASE_ALLOWED_EMAIL=<exact single allowed email>; configure exactly one, never both.
MCP_FIREBASE_WEB_API_KEY=<Firebase web API key>
```

Private hop:

```text
MCP_CORE_URL=http://127.0.0.1:8081/mcp
MCP_CORE_BEARER_TOKEN=<24+ character independent random secret>
```

The core child process receives the private secret as its `MCP_BEARER_TOKEN`. Do not reuse an OAuth access token, Firebase token, or another public credential for this value.

Maps runtime settings are the normal root-package settings. In particular, enable V5 only when its existing single-user/dedicated-profile gate is satisfied:

```text
INTERACTIVE_ASSIST_MODE=true
MAPS_V5_AUTHENTICATED_WORKFLOWS=true
```

## Firebase setup

The reference uses Firebase Authentication only for the single human sign-in and Firestore only for OAuth control-plane state. It does not store Maps result datasets.

1. Enable Firebase Email/Password Authentication in the shared MCP Runtime identity project. Prefer `MCP_FIREBASE_ALLOWED_UID` so every MCP can bind to the same immutable human identity; email mode remains available for isolated single-user deployments.
2. Configure the Firebase Web API key. The browser sends email/password directly to Firebase Identity Toolkit and clears the password field immediately; the gateway receives only the resulting short-lived Firebase ID Token.
3. Ensure Firestore exists for this MCP's namespaced OAuth control-plane state.
4. Run with a dedicated per-MCP service account that can perform Firebase Auth verification and access only this MCP's required Firestore state.
5. Configure Firestore TTL for `expiresAt` fields if desired so expired control-plane state is reclaimed.

For a shared MCP Runtime project, centralize **human identity only**. Keep OAuth codes/tokens, private-hop bearer secrets, service accounts, and Firestore namespaces separate per MCP. Do not share one MCP's resource tokens with another MCP.

Never place Firebase credentials, transaction secrets, private core bearer values, OAuth access/refresh tokens, or browser profiles in the repository or container image.

## Local tests

This package requires Node 22 or newer.

```bash
cd reference/oauth-gateway
npm ci --ignore-scripts
npm test
```

The tests cover PKCE, CIMD host/SSRF boundaries, OAuth transaction integrity, scope metadata separation, exact private-core URL validation, header allowlisting, public-token stripping, private-bearer replacement, and private-core auth failure isolation.

## Container build

Build from the repository root so the image contains a traceable checkout of both the reference gateway and the core:

```bash
docker build \
  -f reference/oauth-gateway/Dockerfile \
  -t maps-browser-mcp-oauth-reference .
```

The image exposes only gateway port `8080`. The core is forced to loopback port `8081` with `static-bearer` auth.

## Cloud Run dogfood

Deploy this image as a **new service alongside** the historical `map-browser-mcp-test`. Do not update that service in place while clients may still hold refresh tokens for it.

Recommended constraints for the new service:

- dedicated service account;
- secrets supplied from Secret Manager;
- `1` vCPU and at least `2Gi` memory when Chromium + Interactive Assist run in the same Cloud Run instance;
- max instances `1`;
- concurrency `1`, matching the single-browser runtime;
- HTTPS only;
- no public access except through the OAuth-protected `/mcp` workflow and required public metadata/authorization endpoints;
- no `MAPS_REMOTE_TAKEOVER` until a browser-session auth boundary is designed and tested.

For the reference deployment, keep the capacity boundary explicit rather than relying on Cloud Run defaults:

```bash
gcloud run services update maps-browser-mcp \
  --cpu=1 \
  --memory=2Gi \
  --concurrency=1 \
  --max-instances=1
```

A `1Gi` instance was observed to cross its memory limit during repeated headless `maps_search` + `maps_read_place_summary` calls, causing Cloud Run to terminate the container and return HTTP `503`. The remote MCP client surfaced that transport failure as an `UNKNOWN`/TaskGroup-style exception. This is a deployment-capacity failure, not a bounded-reader exception to catch inside the MCP process.

The default container Chrome profile is ephemeral. That is acceptable for OAuth/protocol dogfood, but it is **not durable signed-in Maps state**. Do not bake a signed-in Chrome profile, cookies, or account credentials into an image. If persistent authenticated Maps workflows are required, use a controlled single-user runtime with an appropriate persistent profile strategy and the same V5 isolation rules.

## Migration / validation checklist

Before retiring the historical service:

1. build from a recorded maps-browser-mcp commit;
2. deploy the new service under a distinct name/URL;
3. verify Protected Resource Metadata and Authorization Server Metadata;
4. verify unauthenticated `/mcp` returns a Maps-specific `WWW-Authenticate` challenge;
5. verify authorization-code + PKCE + exact `resource`;
6. verify refresh-token rotation and `offline_access` behavior;
7. verify the public OAuth token is not forwarded to the loopback core;
8. run MCP interoperability/Inspector checks against the new URL;
9. connect the target ChatGPT app/client to the new URL and verify reconnect/refresh behavior;
10. confirm current local/stdio use is unchanged;
11. observe that the historical service no longer receives legitimate MCP or refresh-token traffic;
12. only then retire the historical service.
