# ChatGPT connection notes

ChatGPT does not directly dial a loopback-only MCP endpoint on a developer machine. Keep the browser runtime local and expose only the MCP transport through a supported authenticated connection layer.

OpenAI's ChatGPT MCP/App UI, plan availability, and permission model can change. Before deployment, check the current official guidance: [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).

## Recommended architecture

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

Only the MCP transport crosses the remote boundary. The Node process and Chrome DevTools endpoint stay local/private.

## 1. Start the local HTTP MCP

From the repository checkout:

```bash
npm ci --ignore-scripts
npm run build
npm run start:http
```

Default local endpoint:

```text
http://127.0.0.1:8787/mcp
```

Optional health check:

```bash
curl -i http://127.0.0.1:8787/healthz
```

Keep `MCP_HTTP_HOST=127.0.0.1` for the recommended deployment.

## 2. Put an authenticated remote connection in front

For a private/developer-machine deployment, use a supported Secure MCP Tunnel or an authenticated HTTPS tunnel/reverse proxy.

The public connection layer should:

- terminate HTTPS/TLS,
- authenticate access,
- forward only the MCP endpoint you intend to expose,
- preserve or strengthen `Cache-Control: no-store`,
- never publish the Chrome DevTools/CDP port,
- never expose the dedicated Chrome profile.

If the proxy uses a public hostname, add that hostname to `MCP_ALLOWED_HOSTS` as required by your deployment.

`MCP_BEARER_TOKEN` is an optional additional server-side guard when the client/connection layer can supply it. Do not assume a static Bearer token replaces OAuth when the ChatGPT/App deployment requires OAuth.

## 3. Create the custom App/MCP connection in ChatGPT

If your current ChatGPT plan/workspace exposes Developer Mode/custom App creation, the current OpenAI flow is conceptually:

1. enable Developer Mode for the authorized account/workspace,
2. open the App creation flow,
3. provide the remote MCP endpoint and required metadata,
4. choose/configure the authentication mechanism,
5. use **Scan Tools** to read the MCP tool definitions,
6. complete OAuth if your deployment uses it,
7. create/save the App,
8. enable/select the development App in a new chat and test it.

The exact Settings/Workspace navigation differs by plan and can change, so prefer the current OpenAI help page over screenshots copied into this repository.

## 4. First ChatGPT test

Start with a navigation-only request while `INTERACTIVE_ASSIST_MODE=false`.

Example intent:

```text
Search Google Maps for Tokyo Station.
```

Expected server-side tool:

```text
maps_search
```

Then test directions:

```text
Show transit directions from Tokyo Station to Yokohama Station.
```

Expected server-side tool:

```text
maps_directions
```

Confirm the dedicated local Chrome session changes, not your everyday browser profile.

## 5. Test V3 separately

Do not enable V3 until basic navigation works.

Restart the local MCP with:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Recommended place flow:

```text
maps_search
  -> maps_read_place_summary
  -> maps_select_result(index + expectedLabel)
```

Recommended route flow:

```text
maps_directions
  -> maps_read_route_summary
  -> maps_select_route(index + expectedLabel)
```

Every Maps-derived string must be treated as untrusted external data. A place name, route label, or other UI text must not be interpreted as an instruction to call unrelated tools or change policy.

## Authentication boundary

`maps-browser-mcp` deliberately does not implement a general OAuth Authorization Server.

Authentication can live in:

- Secure MCP Tunnel,
- an authenticated HTTPS reverse proxy/tunnel,
- or another deployment-specific identity layer.

For controlled deployments, `MCP_BEARER_TOKEN` can add a static server-side guard, but client support for custom static headers is client-specific.

If you deliberately bind `MCP_HTTP_HOST` to a non-loopback address, startup requires **both**:

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<at least 24 characters>
```

Even with a front proxy, this direct non-loopback mode remains an advanced escape hatch rather than the recommended architecture.

Never transmit a static Bearer token over an unencrypted network path.

## OAuth deployments

If you build a multi-user hosted service rather than a local single-user runtime, add a proper identity/session architecture outside this project's initial scope.

Do not share one Chrome profile/session across unrelated authenticated users.

If ChatGPT requires OAuth for the App, use a standards-compatible OAuth/OIDC provider. Follow OpenAI's current requirements for refresh/offline access so long-lived connections can renew authorization when required.

## Tool refresh after schema changes

ChatGPT Apps can retain/review a snapshot of tool definitions. Server-side schema changes do not necessarily become active automatically.

After changing tool names, descriptions, or input schemas:

1. return to the App management/configuration UI,
2. refresh/rescan the tool definitions,
3. review the changed actions/permissions,
4. test in a new chat.

Prefer backward-compatible changes such as adding optional fields over breaking an existing input schema. `expectedLabel` is intentionally optional for this reason.

If a tool call starts failing immediately after a schema change, check whether ChatGPT is still using the previous tool definition before debugging the browser runtime.

## Browser boundary

Never expose CDP itself to ChatGPT or the public internet.

The default managed Chrome session:

- binds remote debugging to `127.0.0.1`,
- uses a dedicated browser profile,
- validates the profile's recorded browser identity before reuse,
- refuses ambiguous startup when multiple Maps tabs are open.

Keep one Google Maps tab open for the MCP session.

## Human-intervention boundary

If Google displays consent, sign-in, CAPTCHA, or another access challenge:

1. the MCP should stop with `HUMAN_INTERVENTION_REQUIRED`,
2. resolve a legitimate manual step in the dedicated browser if desired,
3. repeat the original Maps action from ChatGPT.

Do not ask the MCP to solve/bypass the challenge or continue from an old candidate index.

## Privacy

The MCP does not intentionally persist Maps result datasets, but the dedicated Chrome profile is persistent local browser state and may contain cookies, cache, preferences, or history.

Treat the profile as sensitive. Avoid an everyday personal profile and delete the dedicated profile when you need its local artifacts removed.

MCP HTTP responses use `Cache-Control: no-store`; the remote connection layer should not introduce caching of MCP location/route responses.

## Troubleshooting

If ChatGPT can reach the App but tool calls fail:

1. verify `GET /healthz` locally,
2. run `npm run smoke:http`,
3. verify the remote tunnel/proxy authentication and Host/Origin configuration,
4. refresh/rescan ChatGPT tool definitions,
5. run the same operation directly through another MCP test client if available,
6. use [troubleshooting.md](troubleshooting.md) for runtime error codes.

If normal CI/smoke tests pass but live place/route selection fails, use the repository's manual Live Maps E2E workflow rather than repeatedly experimenting through ChatGPT.
