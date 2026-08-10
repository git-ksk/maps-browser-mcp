# Firebase OAuth adapter (optional)

This repository includes an **optional, single-user** Firebase OAuth adapter for remote `maps-browser-mcp` deployments. The root package remains Firebase-free, and local/stdio users do not need this adapter.

The adapter is intentionally scoped to one MCP owner, one dedicated browser profile, and one browser state. Authentication does **not** turn the browser runtime into a multi-user service.

> Status: repository-local/experimental until the public-container + ChatGPT live dogfood is complete. The adapter package is currently marked `private` and is not published separately.

## What it provides

- Firebase Authentication for the interactive Google sign-in step
- exact Firebase UID allowlist (`MCP_FIREBASE_ALLOWED_UID`)
- OAuth Protected Resource Metadata and Authorization Server Metadata
- Client ID Metadata Documents (CIMD)
- exact client-metadata hostname allowlist before any outbound fetch
- DNS/IP SSRF checks plus DNS-pinned HTTPS metadata/JWKS retrieval
- same-origin client JWKS requirement
- `private_key_jwt` client authentication with RS256
- client assertion issuer/subject/audience/time/JTI validation and replay protection
- PKCE `S256`
- RFC 8707 resource binding to the exact `/mcp` resource
- Firestore-backed authorization codes, opaque access tokens, refresh tokens, token families, and consumed client assertions
- signed HttpOnly authorization-transaction cookies, so unauthenticated `/oauth/authorize` requests do not create Firestore records
- bounded OAuth endpoint request rate per process
- one-hour access tokens
- rotating refresh tokens with token-family revocation on reuse
- `iss` in authorization responses
- no Dynamic Client Registration endpoint

The current MCP authorization specification prefers CIMD over DCR for clients and servers without a pre-existing registration relationship. This adapter advertises `client_id_metadata_document_supported=true` and deliberately exposes no `registration_endpoint`.

## Required configuration

```text
MCP_AUTH_PROVIDER=module
MCP_AUTH_PROVIDER_MODULE=file:///app/adapters/auth-firebase/index.mjs
MCP_PUBLIC_BASE_URL=https://your-mcp.example.com

# Exact CIMD metadata hostnames only. No wildcards.
MCP_OAUTH_ALLOWED_CLIENT_HOSTS=chatgpt.com

# Stable 32+ byte random secret, provided from your secret manager.
MCP_OAUTH_TRANSACTION_SECRET=replace-with-a-long-random-secret
# Optional; default 60, accepted range 10..600.
MCP_OAUTH_MAX_REQUESTS_PER_MINUTE=60

MCP_FIREBASE_PROJECT_ID=your-project-id
MCP_FIREBASE_ALLOWED_UID=exact-firebase-uid
MCP_FIREBASE_WEB_API_KEY=...
MCP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
MCP_FIREBASE_WEB_APP_ID=...
```

For a public container bind:

```text
MCP_HTTP_HOST=0.0.0.0
MCP_ALLOW_NONLOOPBACK=true
MCP_ALLOWED_HOSTS=your-mcp.example.com
```

Do **not** configure `MCP_BEARER_TOKEN` at the same time as module auth. OAuth access tokens use the same `Authorization: Bearer ...` header.

## Firebase setup

1. Enable Google sign-in in Firebase Authentication.
2. Register the Firebase web app values used above.
3. Add the public MCP hostname to Firebase Authentication's authorized domains when required by the Firebase web flow.
4. Create Firestore.
5. Run the server with Application Default Credentials from a dedicated service account with only the permissions required by this deployment.

`verifyIdToken(..., true)` performs revocation-aware Firebase token verification, so the runtime identity must be able to perform the corresponding Firebase Auth verification/user lookup operations in addition to its Firestore access.

The adapter stores only OAuth control-plane state. It does not store Google Maps result datasets. Raw authorization codes, access tokens, refresh tokens, and client assertion JTIs are never used as Firestore document IDs; SHA-256 derived keys are stored instead.

For collections containing an `expiresAt` Firestore Timestamp, enabling Firestore TTL is recommended so expired OAuth control-plane records are reclaimed automatically.

## Repository installation

For development from this checkout:

```bash
npm install --no-save --package-lock=false ./adapters/auth-firebase
```

For a container image that already includes the adapter and its dependencies:

```bash
docker build -f adapters/auth-firebase/Dockerfile -t maps-browser-mcp:firebase .
```

The adapter-specific image defaults to module auth and a non-loopback HTTP bind, but still fails closed until the required Firebase/OAuth environment is supplied.

## OAuth endpoints

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/authorize
/oauth/firebase/complete
/oauth/token
```

There is intentionally no `/register` or `/oauth/register` DCR endpoint.

The protected resource is exactly `${MCP_PUBLIC_BASE_URL}/mcp`. The resource-required scope is `maps:use`. `offline_access` is advertised by the authorization server for clients that need refresh tokens, but is intentionally not advertised as a resource-required scope.

## CIMD security boundary

The authorization endpoint treats `client_id` as untrusted input. Before fetching a metadata document, the adapter requires an HTTPS client ID URL with a path, an exact hostname match, public DNS results only, a DNS-pinned HTTPS connection, exact `client_id` metadata equality, an exact redirect URI, `private_key_jwt`, and inline JWKS or a same-origin HTTPS `jwks_uri`.

Never replace the exact client-host allowlist with a broad wildcard merely to make an unknown client connect.

## Abuse boundary

Unauthenticated authorization requests are kept in an integrity-protected HttpOnly/Secure/SameSite cookie, not Firestore. Firestore authorization-code creation starts only after the configured Firebase UID successfully authenticates. The three state-changing OAuth endpoints also share a bounded in-process request rate.

For public container deployments, additionally cap platform-level instance count/concurrency to match the single-browser runtime. The in-process limiter is defense in depth, not a substitute for platform-level cost/traffic controls.

## Operational boundary

Keep the deployment at one logical user and one dedicated browser runtime. Use HTTPS. Never log raw OAuth access tokens, refresh tokens, Firebase ID tokens, private-key JWTs, Authorization headers, transaction secrets, or Firebase credentials.
