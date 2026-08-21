# Reference OAuth gateway

This directory contains the isolated, single-user OAuth reference gateway tracked by maps-browser-mcp issue #74. It is a dogfood/reference deployment path, not part of the published root npm package and not a requirement for local or stdio use.

The reference keeps OAuth protocol/token state and the Human Takeover operator boundary outside the Maps browser runtime:

```text
Remote MCP client                         Human operator / mobile browser
    |                                                  |
    | HTTPS + OAuth access token                       | HTTPS + operator session
    v                                                  v
reference/oauth-gateway  :8080  <---------------- /takeover/*
    | validates public MCP token                       |
    | validates one allowed Human operator             |
    | replaces either public boundary with             |
    | one separate private core bearer                 |
    v                                                  v
maps-browser-mcp core    127.0.0.1:8081
    |
    v
Dedicated Chromium profile
```

The combined reference image runs the gateway and current checkout of the core as separate processes in one single-user container. The private core listens only on loopback. Public OAuth access tokens, the operator cookie, Firebase credentials, and takeover locators are never forwarded as core/browser credentials; the gateway injects only its independent private core bearer.

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
- separate Firestore control-plane collections prefixed `_mapsBrowserMcpRefOAuth...`;
- optional remote/mobile `/takeover/*` proxy for `thin_takeover`, gated by a separate short-lived Human operator session;
- operator session cookie is HttpOnly, Secure, SameSite=Strict, scoped to `/takeover`, account-bound, signed, and short-lived;
- public/operator Authorization or Cookie headers are stripped before the loopback hop;
- only the bounded takeover request/response headers required by the Handoff broker are forwarded;
- frame streams remain streaming responses through the gateway and are not intentionally buffered or persisted.

It deliberately does **not** expose Dynamic Client Registration, multi-user browser/profile sharing, generic browser automation, raw Google credentials, takeover capabilities in the locator URL, public OAuth token passthrough, CAPTCHA bypass, or passkey/WebAuthn proxying.

## Remote/mobile credential-safe takeover

When `MAPS_REMOTE_TAKEOVER=true`, the public gateway can host the credential-safe Handoff operator surface safely instead of exposing the loopback broker directly.

The initial visit to a valid `/takeover/<opaque-id>` locator does **not** grant browser control by itself. If the browser has no valid operator session, the gateway presents a single-user Firebase authorization page. Email/password is sent directly to Firebase Identity Toolkit; the password field is cleared; the gateway receives only the resulting Firebase ID token, verifies the configured allowed account, then issues the short-lived `/takeover` operator cookie.

After operator authorization, the same locator reloads and the gateway proxies the bounded broker page/API to the private core using `MCP_CORE_BEARER_TOKEN`. The core still enforces the Handoff session capability, client binding, principal/intervention/epoch fencing, one-live-client rules, same-origin input, revoke/Done, and active stream abort.

This operator login is only the gateway access boundary. It is separate from the **target Google account** sign-in performed inside the dedicated Chromium surface. Target Google password/MFA/passkey material must remain Human-controlled and must never be copied into the gateway, MCP request, model context, logs, argv, or repository artifacts.

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

Remote/mobile credential-safe takeover:

```text
MAPS_REMOTE_TAKEOVER=true
MAPS_TAKEOVER_PUBLIC_BASE_URL=https://your-new-gateway.example.com
MCP_TAKEOVER_OPERATOR_SECRET=<independent 32+ byte secret>
MCP_TAKEOVER_OPERATOR_SESSION_SECONDS=900
MAPS_CREDENTIAL_SAFE_HANDOFF=true
MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover
```

Use a different secret for `MCP_TAKEOVER_OPERATOR_SECRET` and `MCP_OAUTH_TRANSACTION_SECRET`. The core child process receives only `MCP_CORE_BEARER_TOKEN` as its private HTTP auth token.

For the controlled V5 signed-out acceptance environment:

```text
INTERACTIVE_ASSIST_MODE=true
MAPS_V5_AUTHENTICATED_WORKFLOWS=true
```

Do not enable this acceptance shape against a normal browser profile. Use the disposable/dedicated profile required by V5.

## Firebase setup

The reference uses Firebase Authentication for both public OAuth authorization and, when enabled, the single Human operator authorization. Firestore is used only for OAuth control-plane state. It does not store Maps result datasets, target Google credentials, or takeover frame content.

1. Enable Firebase Email/Password Authentication in the shared MCP Runtime identity project. Prefer `MCP_FIREBASE_ALLOWED_UID` so every MCP can bind to the same immutable human identity; email mode remains available for isolated single-user deployments.
2. Configure the Firebase Web API key. Browser email/password is sent directly to Firebase Identity Toolkit and cleared immediately; the gateway receives only the short-lived Firebase ID token.
3. Ensure Firestore exists for this MCP's namespaced OAuth control-plane state.
4. Run with a dedicated per-MCP service account that can perform Firebase Auth verification and access only this MCP's required Firestore state.
5. Configure Firestore TTL for `expiresAt` fields if desired so expired control-plane state is reclaimed.

For a shared MCP Runtime project, centralize **human identity only**. Keep OAuth codes/tokens, private-hop bearer secrets, operator signing secrets, service accounts, and Firestore namespaces separate per MCP.

Never place Firebase credentials, transaction/operator secrets, private core bearer values, OAuth access/refresh tokens, target Google credentials, or browser profiles in the repository or container image.

## Local tests

This package requires Node 22 or newer.

```bash
cd reference/oauth-gateway
npm ci --ignore-scripts
npm test
```

Tests cover PKCE, CIMD host/SSRF boundaries, OAuth transaction integrity, scope separation, exact private-core URL validation, public-token stripping, private-bearer replacement, operator-session tamper/expiry fencing, takeover request/response header allowlists, cookie/auth stripping, streaming body passthrough, and private-core auth failure isolation.

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

Recommended constraints:

- dedicated service account;
- secrets supplied from Secret Manager;
- `1` vCPU and at least `2Gi` memory when Chromium + Interactive Assist run in the same Cloud Run instance;
- max instances `1`;
- concurrency `1`, matching the single-browser runtime;
- HTTPS only;
- expose the gateway only; never expose core port `8081`;
- `MAPS_TAKEOVER_PUBLIC_BASE_URL` must equal the same public gateway origin;
- enable remote takeover only for a controlled single-user deployment with `MCP_TAKEOVER_OPERATOR_SECRET` configured;
- do not use the maintainer's normal Chrome profile or bake a signed-in profile/cookies into the image.

For the reference deployment, keep the capacity boundary explicit rather than relying on Cloud Run defaults:

```bash
gcloud run services update maps-browser-mcp \
  --cpu=1 \
  --memory=2Gi \
  --concurrency=1 \
  --max-instances=1
```

A `1Gi` instance was observed to cross its memory limit during repeated headless `maps_search` + `maps_read_place_summary` calls, causing Cloud Run to terminate the container and return HTTP `503`. The remote MCP client surfaced that transport failure as an `UNKNOWN`/TaskGroup-style exception. This is a deployment-capacity failure, not a bounded-reader exception to catch inside the MCP process.

The default container Chrome profile is ephemeral. That is acceptable for protocol/transport dogfood and a disposable signed-out Google acceptance run, but it is **not durable signed-in Maps state**. If persistent authenticated Maps workflows are required later, use a controlled single-user runtime with an appropriate persistent profile strategy and the same V5 isolation rules.

## Thin Takeover pre-Google acceptance checklist

Before entering any real target Google credential:

1. build/deploy a recorded PR #107 commit under a distinct single-user gateway URL;
2. configure the remote takeover variables above and independent secrets in Secret Manager;
3. confirm `/mcp` OAuth still works and public OAuth tokens do not reach the core;
4. create a benign Human intervention and open its `/takeover/<id>` locator from the intended mobile browser;
5. confirm the operator login is required before the broker page appears;
6. confirm no operator cookie/Firebase ID token is forwarded to the core;
7. confirm push-frame streaming renders and tap/scroll/text/key input works on a benign allowed surface;
8. confirm slow/recreated clients fail closed or recover only through the Handoff reconnect rules;
9. confirm Done/revoke closes the active frame stream and stale capability/client generation no longer works;
10. confirm fresh Agent-owned CDP reattach succeeds and fresh readiness is required;
11. only then run maps-browser-mcp #104 with a disposable dedicated profile starting `signed_out`.

The actual target Google sign-in remains a Human acceptance step and is intentionally not automated by this gateway.

## Durable signed-in Chrome profile on Cloud Run

For the single-user production shape, persist **only** the dedicated Chrome profile. Browser/action/Handoff state remains disposable and is rebuilt from fresh Maps navigation and semantic revalidation after a restart.

Do not use Cloud Storage FUSE or NFS as Chromium's live profile filesystem. Chromium continues to use the local ephemeral `MAPS_CHROME_PROFILE_DIR`; the deployment layer restores a stopped-profile archive before the private core starts and checkpoints only after Chromium has relinquished the profile.

Enable the snapshot layer with Application Default Credentials from the Cloud Run service account:

```bash
MAPS_PROFILE_SNAPSHOT_BUCKET=private-maps-profile-bucket
MAPS_PROFILE_SNAPSHOT_PREFIX=maps-browser-mcp/profile
MAPS_PROFILE_SNAPSHOT_KEEP=2
MAPS_PROFILE_SNAPSHOT_MAX_BYTES=268435456
```

`MAPS_PROFILE_SNAPSHOT_REQUIRED=false` is the default. A first boot with no object therefore starts with an empty dedicated profile. Set it to `true` only when an operator intentionally wants a missing/invalid snapshot to prevent startup.

The snapshot helper:

- restores before `maps-browser-mcp` starts;
- stores immutable generation archives plus a small `current.json` pointer retaining the previous good generation;
- rejects path traversal and symbolic/hard-link archive entries before extraction;
- excludes regenerable caches, crash data, CDP runtime files, and Chromium singleton files;
- never extracts or logs individual cookies/tokens/account identifiers;
- requires an explicit `--browser-stopped` acknowledgement for checkpoints.

The reference entrypoint also attempts a checkpoint after a graceful container `SIGTERM`, after the private core has completed its browser shutdown. An unexpected core/gateway crash does **not** create a new snapshot. The primary signed-in durability checkpoint should be wired to the hosted Human-Takeover `Done` lifecycle once the Linux takeover transport is available, so the freshly authenticated profile is captured immediately at a known browser-authority boundary.

Manual maintenance command inside a stopped-browser deployment container:

```bash
node reference/oauth-gateway/profile-snapshot.mjs restore
node reference/oauth-gateway/profile-snapshot.mjs checkpoint --browser-stopped
```

Use a dedicated private bucket/prefix and grant object access only to the Maps Cloud Run runtime service account. Keep `concurrency=1` and `max-instances=1`; profile persistence does not turn one browser runtime into a multi-user service.
