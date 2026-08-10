# Firebase OAuth adapter (optional)

This adapter adds a **single-user** OAuth 2.1 authorization boundary for remote `maps-browser-mcp` deployments. It is intentionally separate from the root package so local/stdio users do not install Firebase.

It is designed for one MCP owner, one browser profile, and one browser state. It is **not** a multi-user hosting layer.

## What it provides

- Firebase Authentication for the interactive Google sign-in step
- exact Firebase UID allowlist (`MCP_FIREBASE_ALLOWED_UID`)
- Firestore-backed authorization transactions, authorization codes, opaque access tokens, refresh tokens, and token families
- PKCE `S256`
- RFC 8707 resource binding to the exact `/mcp` resource
- OAuth Protected Resource Metadata and Authorization Server Metadata
- `iss` in authorization responses
- one-hour access tokens
- rotating refresh tokens with token-family revocation on reuse
- pre-registered OAuth client only; no DCR endpoint

The MCP specification permits pre-registration as a client-registration mechanism. DCR is deliberately not enabled here because it is deprecated in the current MCP authorization specification and adds unnecessary surface area for a single-user deployment.

## Required configuration

```text
MCP_AUTH_PROVIDER=module
MCP_AUTH_PROVIDER_MODULE=@maps-browser-mcp/auth-firebase
MCP_PUBLIC_BASE_URL=https://your-mcp.example.com

MCP_FIREBASE_PROJECT_ID=your-project-id
MCP_FIREBASE_ALLOWED_UID=exact-firebase-uid
MCP_FIREBASE_WEB_API_KEY=...
MCP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
MCP_FIREBASE_WEB_APP_ID=...

MCP_OAUTH_CLIENT_ID=maps-browser-mcp-client
MCP_OAUTH_CLIENT_SECRET=<32+ random non-whitespace characters>
MCP_OAUTH_REDIRECT_URIS=https://exact-client-callback.example/callback
```

For a public container bind, also configure:

```text
MCP_HTTP_HOST=0.0.0.0
MCP_ALLOW_NONLOOPBACK=true
MCP_ALLOWED_HOSTS=your-mcp.example.com
```

Do **not** configure `MCP_BEARER_TOKEN` at the same time as module auth. OAuth access tokens use the same `Authorization: Bearer ...` header.

## Firebase setup

Enable Google sign-in in Firebase Authentication, register the web app values above, and create Firestore. The server-side Admin SDK uses Application Default Credentials; on Cloud Run, use a dedicated service account with only the Firebase Auth verification / Firestore access needed by this deployment.

The adapter stores only OAuth control-plane state in Firestore. It does not store Google Maps result datasets.

## Installation from this repository

Until this adapter is published separately, install it into a checkout without saving it into the root package:

```bash
npm install --no-save ./adapters/auth-firebase
```

The root `maps-browser-mcp` package remains Firebase-free.

## OAuth endpoints

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/authorize
/oauth/firebase/complete
/oauth/token
```

The protected resource is exactly:

```text
${MCP_PUBLIC_BASE_URL}/mcp
```

The resource-required scope is `maps:use`. `offline_access` is advertised by the authorization server for clients that need refresh tokens, but is intentionally not advertised as a resource-required scope.

## Operational boundary

Keep Cloud Run (or another host) at one logical user and one dedicated browser runtime. Authentication does not make the existing single-browser process safe for unrelated users. Do not share one browser profile/session across users.

Use HTTPS. Never log or persist raw OAuth access tokens, refresh tokens, Firebase ID tokens, client secrets, or Authorization headers. Stored OAuth bearer values are SHA-256 keyed in Firestore.
