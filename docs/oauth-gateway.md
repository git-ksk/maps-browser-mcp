# OAuth gateway pattern for remote MCP clients

`maps-browser-mcp` is intentionally a bounded, single-user browser controller. OAuth must not be treated as a switch that turns one browser/runtime/profile into a shared multi-user service.

The core server now has a pluggable HTTP auth-provider contract so an authenticated caller can be represented by a stable principal and Human Takeover can remain bound to the originating principal. That contract does **not** make OAuth Authorization Server or public Resource Server protocol handling a browser-runtime responsibility.

When a remote MCP client requires OAuth, keep the OAuth protocol boundary in an external gateway or independently maintained auth adapter in front of the browser controller.

## Recommended shape

```text
Remote MCP client
      |
      | HTTPS + OAuth access token
      v
OAuth-capable MCP gateway / auth adapter
  - Protected Resource Metadata
  - Authorization Server discovery
  - access-token validation
  - admission / principal mapping
      |
      | private/loopback MCP transport
      | + stable single-user principal
      v
maps-browser-mcp
      |
      +-- semantic Maps policy
      +-- principal-bound Human Takeover
      v
Dedicated Chrome / Chromium profile
```

The gateway/adapter may run as a separate service, sidecar, or separate process inside the same single-user deployment boundary. The important property is that OAuth protocol, token persistence, consent/account lifecycle, and provider-specific identity logic do not become browser-control concerns.

## MCP authorization requirements belong at the OAuth boundary

For an HTTP MCP endpoint protected by OAuth, the public gateway/adapter is the OAuth Resource Server boundary. Follow the current MCP Authorization specification rather than copying framework defaults blindly.

At minimum, that boundary should:

- expose OAuth Protected Resource Metadata and identify the corresponding Authorization Server,
- return a `WWW-Authenticate` challenge with `resource_metadata` on `401` responses as required by the MCP specification,
- advertise Authorization Server metadata through a supported discovery mechanism,
- support the client-registration mechanism appropriate for the target MCP client,
- require Authorization Code + PKCE for delegated interactive authorization,
- honor the OAuth `resource` parameter and bind issued access tokens to the public MCP resource,
- validate issuer, audience/resource, expiry, and required authorization before admitting an MCP request,
- use HTTPS for public authorization endpoints.

The MCP Authorization specification also forbids accepting or passing through tokens intended for another resource. Treat the public OAuth token as a credential for the public MCP resource only.

Reference: [MCP Authorization specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Do not pass the caller token through to the browser runtime

After the OAuth boundary validates the caller's access token, do not forward that token unchanged through the browser controller or to downstream services.

Use one of these private-hop patterns instead:

1. keep `maps-browser-mcp` on loopback/private networking and admit exactly one logical user to that runtime, using a separate private-hop credential where authentication is required, or
2. use an independently maintained auth-provider adapter that converts the externally authenticated identity into the stable principal contract expected by the core server without exposing OAuth protocol handling to Maps/browser code.

For a single-user deployment, `static-bearer` may represent one logical principal on the private hop, but it is only a transport credential and must not be described as end-user OAuth identity.

This separation avoids token passthrough, reduces confused-deputy risk, and keeps OAuth credentials out of the browser-control path.

## Principal binding and Human Takeover

Current `main` binds handoff ownership and remote Human Takeover to the authenticated principal. This is a security invariant, not a multi-user hosting feature.

The public OAuth boundary and any private-hop adapter should therefore preserve these properties:

- one stable logical principal for the lifetime of an intervention,
- fail closed if a different principal attempts to reuse or resume the intervention,
- do not rebind an active intervention after Human authority has been claimed,
- authenticate takeover page/API access through the same logical-principal boundary used for the originating MCP request,
- keep takeover capabilities short-lived and scoped to the intervention/resource epoch,
- never use Human Takeover to bypass CAPTCHA, sign-in, consent, or other challenge policy.

CAPTCHA, sign-in, and consent remain Human Intervention surfaces. The agent must stop; there is no solver or bypass path.

## Preserve the single-user runtime boundary

Successful OAuth authentication does **not** make one `maps-browser-mcp` process safe for unrelated users.

A process owns one semantic browser state, one operation queue, and one dedicated Chrome profile. The OAuth boundary should therefore enforce one of these models:

- one authorized human identity per deployment/runtime, or
- one isolated `maps-browser-mcp` runtime/profile per authorized user.

Do not multiplex unrelated principals into one browser/runtime merely because the gateway can distinguish their OAuth identities.

## Scopes: keep them outside the Maps protocol unless required

If the remote client or gateway uses OAuth scopes, use the smallest set needed for that deployment. Scope names are deployment-specific and should not be added to the semantic Maps tool protocol unless a Maps capability actually needs to interpret them.

The core runtime continues to enforce browser safety, operation policy, principal ownership, and Human Intervention independently of OAuth scopes.

## Refresh tokens and ChatGPT

If ChatGPT is the remote MCP client and OAuth is enabled, current OpenAI guidance says the OAuth/OpenID Connect provider should be configured to issue refresh tokens so connectivity can survive access-token expiry. For OIDC providers, OpenAI documents `offline_access` as the standard mechanism when the provider supports it and advertises it in discovery metadata.

After changing OAuth metadata or tool definitions, recreate or rescan the ChatGPT app as appropriate before debugging the browser runtime; ChatGPT can retain previously scanned tool definitions and OAuth metadata.

Reference: [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461).

## Container / Cloud Run-style deployment

A single-user container deployment can keep the same separation while packaging multiple processes together:

```text
container public port
        |
        v
OAuth gateway / auth-adapter process
        |
        | 127.0.0.1:<private-port>
        v
maps-browser-mcp --http
        |
        v
headless Chromium
```

For this shape:

- expose only the OAuth-facing public port,
- keep the MCP backend and CDP ports private,
- do not share the Chrome profile across instances or users,
- cap instance concurrency/scaling so two unrelated callers do not accidentally share one browser runtime,
- preserve `Cache-Control: no-store` on sensitive OAuth/MCP responses,
- keep Authorization Server and adapter secrets outside the repository and inject them through the deployment platform's secret facility.

See [Container / headless Linux](container.md) for the browser/container constraints that still apply.

## Why this is documentation, not a built-in OAuth provider

OAuth provider choice, user store, consent UI, client registration policy, token persistence, refresh-token lifecycle, and account lifecycle are deployment-specific concerns. Building a concrete provider into the browser controller would enlarge the security surface and blur the current single-user browser boundary.

The reusable core contract is narrower: accept a stable authenticated principal, bind handoff/takeover state to it, enforce Maps/browser safety locally, and keep OAuth protocol/token handling at the external gateway or adapter boundary.

## Versioned reference gateway (#74)

The repository now contains an isolated [reference OAuth gateway](../reference/oauth-gateway/README.md) for remote single-user dogfood. It runs the public OAuth boundary and current-checkout Maps core as separate processes, forces the core onto a loopback `static-bearer` hop, and strips the caller's public OAuth credential before proxying MCP traffic. The reference source is intentionally outside the root package's published npm `files` set.

For deployments that host several MCPs in one Firebase project, the shared boundary is **human identity only**: each MCP may validate the same immutable Firebase UID, while authorization codes, access/refresh tokens, token families, private-hop bearer secrets, service accounts, and Firestore namespaces remain per-MCP. The reference browser login sends email/password directly to Firebase Identity Toolkit and submits only the returned short-lived ID Token to the gateway; the gateway never receives the password.

The initial reference keeps `/takeover/*` disabled rather than inventing a browser-session authentication mechanism. This does not weaken the core Human Intervention or principal-binding machinery; it means remote/mobile takeover is not part of the first clean gateway migration. A future public takeover path must authenticate the browser session as the same logical single user before proxying takeover page/API traffic.

The historical `map-browser-mcp-test` deployment is migration input only. Do not replace it in place while legitimate MCP/refresh traffic may still depend on its token state. The clean reference uses separate OAuth control-plane collections and should be deployed under a distinct service URL before client reconnection and traffic retirement checks.
