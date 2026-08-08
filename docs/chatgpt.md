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
- an authenticated reverse proxy/tunnel,
- or, for controlled deployments, the server-side `MCP_BEARER_TOKEN` guard.

The static Bearer guard is a defense-in-depth/server option; whether a particular MCP client can configure that header is client-specific. Do not assume it replaces OAuth when OAuth is required by a deployment or client.

Keep the Node server on loopback behind a tunnel/reverse proxy whenever possible. If you deliberately bind `MCP_HTTP_HOST` to a non-loopback address, `MCP_BEARER_TOKEN` is mandatory even when a front proxy also performs authentication. This prevents accidental direct access to an otherwise trusted-proxy-only port.

## OAuth deployments

If you build a multi-user hosted service rather than a local single-user runtime, add a proper identity/session architecture outside this project's initial scope. ChatGPT's OAuth flow expects a standards-compatible OAuth/OIDC provider; deployments that need long-lived access should support refresh/offline access as required by the client.

Do not share one Chrome profile/session across unrelated authenticated users.

## Tool refresh

MCP clients can cache or review tool definitions. When tool schemas change, refresh/rescan the custom app before testing. Backward-compatible optional fields (such as `expectedLabel`) are preferable to breaking schema changes during development.

## Security

Treat the MCP endpoint as browser-control authority. Never expose the Chrome DevTools port itself to ChatGPT or the public internet. Only the MCP transport should cross the remote connection boundary.
