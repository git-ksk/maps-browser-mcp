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

OpenAI's current ChatGPT developer-mode guidance recommends Secure MCP Tunnel when an MCP server runs on a developer machine/private network. A custom app can also use an OAuth-capable remote deployment.

## Authentication boundary

`maps-browser-mcp` deliberately does not implement a general OAuth Authorization Server. Authentication can be provided by:

- Secure MCP Tunnel,
- an authenticated reverse proxy/tunnel,
- or, for controlled deployments, the optional server-side `MCP_BEARER_TOKEN` guard.

The static Bearer guard is a defense-in-depth/server option; whether a particular MCP client can configure that header is client-specific. Do not assume it replaces OAuth when OAuth is required by a deployment or client.

If an external proxy performs authentication and the Node server must bind to a non-loopback interface, set `MCP_TRUST_EXTERNAL_AUTH=true` deliberately. Keep network access to that bind address restricted to the trusted proxy.

## OAuth deployments

If you build a multi-user hosted service rather than a local single-user runtime, add a proper identity/session architecture outside this project's initial scope. ChatGPT's OAuth flow expects a standards-compatible OAuth/OIDC provider; deployments that need long-lived access should support refresh/offline access as required by the client.

Do not share one Chrome profile/session across unrelated authenticated users.

## Tool refresh

MCP clients can cache or review tool definitions. When tool schemas change, refresh/rescan the custom app before testing. Backward-compatible optional fields (such as `expectedLabel`) are preferable to breaking schema changes during development.

## Security

Treat the MCP endpoint as browser-control authority. Never expose the Chrome DevTools port itself to ChatGPT or the public internet. Only the MCP transport should cross the remote connection boundary.
