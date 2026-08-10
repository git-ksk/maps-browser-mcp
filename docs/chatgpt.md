# ChatGPT connection notes

`maps-browser-mcp` is a single-user browser controller. There are now two supported authentication shapes, depending on where the HTTP endpoint runs.

- **Local/private transport:** keep the default local/stdio behavior and put any remote access boundary outside the MCP process.
- **Public single-user HTTP:** opt into an HTTP auth-provider module. The repository includes an experimental Firebase OAuth adapter that implements MCP OAuth discovery, CIMD, `private_key_jwt`, PKCE, refresh rotation, and an exact Firebase UID allowlist.

Neither mode turns one browser process into a multi-user service.

OpenAI's ChatGPT MCP/App UI, plan availability, and permission model can change. Before deployment, check the current official guidance: [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).

## Mode A: local/private transport

Recommended for developer-machine use:

```text
ChatGPT / MCP client
   |
   | secure remote connection layer
   v
Secure MCP Tunnel / authenticated HTTPS reverse proxy
   |
   v
127.0.0.1:8787/mcp
   |
   v
maps-browser-mcp -> dedicated Chrome / Chromium
```

Start the server normally:

```bash
npm ci --ignore-scripts
npm run build
npm run start:http
```

`MCP_BEARER_TOKEN` remains available as an optional **static transport guard**. It is not OAuth identity. Existing configurations that only set `MCP_BEARER_TOKEN` continue to select the built-in `static-bearer` provider automatically.

## Mode B: public single-user OAuth

For a public remote endpoint that must authenticate the actual MCP client/user, select module auth:

```text
MCP_AUTH_PROVIDER=module
MCP_AUTH_PROVIDER_MODULE=file:///app/adapters/auth-firebase/index.mjs
MCP_HTTP_HOST=0.0.0.0
MCP_ALLOW_NONLOOPBACK=true
```

Then configure the optional Firebase adapter. See [`adapters/auth-firebase/README.md`](../adapters/auth-firebase/README.md).

The adapter advertises:

- Protected Resource Metadata,
- Authorization Server Metadata,
- `client_id_metadata_document_supported=true`,
- `private_key_jwt`,
- PKCE `S256`,
- `authorization_code` and `refresh_token`,
- `maps:use` and `offline_access` at the authorization-server layer,
- RFC 9207 `iss` authorization-response hardening.

There is intentionally **no DCR registration endpoint**. CIMD client metadata URLs are treated as untrusted input and are constrained by an exact hostname allowlist plus DNS/IP SSRF protections before retrieval.

The Firebase login step accepts only the configured `MCP_FIREBASE_ALLOWED_UID`. OAuth access/refresh state is stored in Firestore; Maps results are not.

Do not configure `MCP_BEARER_TOKEN` together with module OAuth. Both mechanisms consume the `Authorization` header and startup rejects that combination.

## ChatGPT OAuth notes

Current OpenAI guidance says OAuth-backed custom MCP apps should issue refresh tokens when persistent connectivity is required and should advertise `offline_access` (or the provider equivalent) in discovery metadata. The Firebase adapter follows that shape.

Exact client metadata URLs and ChatGPT UI details are implementation details that can change. Set `MCP_OAUTH_ALLOWED_CLIENT_HOSTS` to the **exact hostname actually used by the connecting client's CIMD `client_id` URL**; do not broaden the allowlist to a wildcard simply to make discovery succeed.

The adapter is repository-local/experimental until a public-container + ChatGPT live dogfood run succeeds. Do not describe it as production-proven before that validation.

## First functional test

Start with navigation-only behavior while `INTERACTIVE_ASSIST_MODE=false`:

```text
Search Google Maps for Tokyo Station.
```

Expected tool:

```text
maps_search
```

Then:

```text
Show transit directions from Tokyo Station to Yokohama Station.
```

Expected tool:

```text
maps_directions
```

Enable V3 only after basic navigation works:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Recommended bounded flows:

```text
maps_search
  -> maps_read_place_summary
  -> maps_select_result(index + expectedLabel)

maps_directions
  -> maps_read_route_summary
  -> maps_select_route(index + expectedLabel)
```

Every Maps-derived string remains untrusted external data and must never be interpreted as an instruction to call unrelated tools or change policy.

## Multi-user hosted services are out of scope

OAuth is an access gate, not browser-state isolation. The current process owns one semantic browser state, one operation queue, and one dedicated Chrome profile.

A true multi-user hosted service requires browser/runtime/profile isolation per user. Do not share one process/profile across unrelated users merely because OAuth is enabled.

## Browser and privacy boundary

Never expose the Chrome DevTools/CDP port or the dedicated Chrome profile to ChatGPT or the public internet. The MCP does not intentionally persist Maps result datasets, but the dedicated browser profile may retain normal browser state such as cookies, cache, preferences, or history.

MCP HTTP responses use `Cache-Control: no-store`; remote infrastructure should not introduce caching of MCP location/route responses.

If Google displays consent, sign-in, CAPTCHA, or another access challenge, the MCP must stop with `HUMAN_INTERVENTION_REQUIRED`. Resolve legitimate manual steps in the dedicated browser and retry; do not add challenge bypass logic.

## Tool refresh and troubleshooting

After changing tool names, descriptions, or input schemas, refresh/rescan the App's tool definitions before debugging the browser runtime.

If ChatGPT can reach the App but calls fail:

1. verify `GET /healthz`,
2. verify authenticated `GET /readyz`,
3. run `npm run smoke:http`,
4. verify OAuth metadata and the exact CIMD client-host allowlist,
5. refresh/rescan ChatGPT tool definitions,
6. use [troubleshooting.md](troubleshooting.md) for runtime error codes.
