# ChatGPT connection notes

ChatGPT connects to remote MCP servers; it does not directly dial a loopback-only MCP endpoint on a developer machine.

For `maps-browser-mcp`, keep the browser runtime local and expose only the MCP transport through an authenticated connection layer.

## Preferred shape

```text
ChatGPT
   |
   | authenticated remote MCP connection
   v
Secure MCP Tunnel / HTTPS reverse proxy
   |
   v
127.0.0.1:8787/mcp
   |
   v
maps-browser-mcp
   |
   v
Dedicated local Chrome / Chromium
```

A local/private MCP deployment should keep the Node process and Chrome DevTools endpoint off the public network. A custom hosted app can instead use an OAuth-capable remote deployment.

## Authentication boundary

`maps-browser-mcp` deliberately does not implement a general OAuth Authorization Server. Authentication can be provided by:

- an authenticated MCP tunnel,
- an authenticated HTTPS reverse proxy/tunnel,
- or, for controlled deployments, the server-side `MCP_BEARER_TOKEN` guard.

The static Bearer guard is a defense-in-depth/server option; whether a particular MCP client can configure that header is client-specific. Do not assume it replaces OAuth when OAuth is required by a deployment or client.

Keep the Node server on loopback behind a tunnel/reverse proxy whenever possible. If you deliberately bind `MCP_HTTP_HOST` to a non-loopback address, **both** `MCP_ALLOW_NONLOOPBACK=true` and a sufficiently long `MCP_BEARER_TOKEN` are mandatory, even when a front proxy also performs authentication. This is an explicit advanced escape hatch rather than the recommended architecture.

Do not send a static Bearer token across an unencrypted network path. Externally reachable MCP traffic should be protected by TLS/HTTPS.

## Browser boundary

Only the MCP transport should cross the remote connection boundary. Never expose the Chrome DevTools port itself to ChatGPT or the public internet.

The default project-managed Chrome session binds CDP to `127.0.0.1`, uses a dedicated browser profile, validates the profile's recorded browser identity before reuse, and refuses to guess between multiple open Google Maps tabs. Keep one Maps tab open for the MCP session.

## OAuth deployments

If you build a multi-user hosted service rather than a local single-user runtime, add a proper identity/session architecture outside this project's initial scope. ChatGPT's OAuth flow expects a standards-compatible OAuth/OIDC provider; deployments that need long-lived access should support refresh/offline access as required by the client.

Do not share one Chrome profile/session across unrelated authenticated users.

## Tool refresh

MCP clients can cache or review tool definitions. When tool schemas change, refresh/rescan the custom app before testing. Backward-compatible optional fields (such as `expectedLabel`) are preferable to breaking schema changes during development.

## Privacy

The server does not intentionally persist Maps result datasets, but the dedicated Chrome profile is persistent local browser state and may contain cookies, cache, preferences, or history. Treat that profile as sensitive, avoid using an everyday personal profile, and remove the dedicated profile if you need its local artifacts deleted.

MCP HTTP responses are marked `Cache-Control: no-store`; the HTTPS tunnel/reverse proxy should preserve or strengthen that behavior rather than caching MCP traffic.
