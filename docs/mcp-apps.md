# MCP Apps portability and deployment

`maps-browser-mcp` treats MCP Apps as an optional **progressive enhancement**. The core directions result is text + structured data; an inline Google Maps Embed view is added only when the deployment explicitly configures it.

This document describes the host-neutral contract, security boundary, compatibility evidence, and the remaining re-validation gate for additional production hosts.

## Contract

| Surface | Behavior |
| --- | --- |
| Tool | `maps_render_directions` |
| Core result | Always returns useful text plus `{ origin, destination, mode }` structured content |
| UI resource | `ui://maps-browser-mcp/directions.html` |
| MIME type | `text/html;profile=mcp-app` |
| MCP Apps extension | `io.modelcontextprotocol/ui` |
| Tool/UI linkage | `_meta.ui.resourceUri`, only when the Embed feature is configured |
| Nested frame CSP | `ui.csp.frameDomains = ["https://www.google.com"]` |
| Display mode | Inline only |
| Browser-controller effect | None; the tool does not navigate or mutate the dedicated Google Maps browser session |

### When `GOOGLE_MAPS_EMBED_API_KEY` is not configured

`maps_render_directions` remains registered. It returns text and structured content and explicitly reports that inline rendering is disabled. The server does **not** advertise the MCP Apps extension for this feature, does not attach `_meta.ui.resourceUri` to the tool, and does not register the directions UI resource.

This is the preferred fallback state for hosts that do not need or cannot render MCP Apps.

### When `GOOGLE_MAPS_EMBED_API_KEY` is configured

The same tool keeps the same text/structured result and additionally links to the `ui://` resource. MCP Apps-capable hosts may render it; hosts that ignore the UI metadata still retain the core result.

The View uses the stable MCP Apps `2026-01-26` lifecycle and handles:

- `ui/initialize` / `ui/notifications/initialized`,
- complete tool input and tool result notifications,
- cancellation and error-result cleanup,
- `ui/notifications/host-context-changed`,
- theme, locale, host style variables, safe-area insets, and container dimensions,
- `ui/notifications/size-changed`,
- `ping`, and
- `ui/resource-teardown` cleanup.

The View accepts only messages from its direct parent. Outbound `postMessage(..., "*")` is deliberate: MCP Apps Views may run behind an opaque-origin sandbox proxy, so a fixed parent origin cannot be assumed by the View itself.

## Layout behavior

Google Maps Embed requires at least 200 px in each dimension. The View therefore keeps the nested map between 200 px and 520 px high, responds to host container height/max-height where available, accounts for safe-area insets, and lets the outer View scroll instead of clipping the map when a host gives it a very short container.

The View reports content size changes to flexible hosts with `ui/notifications/size-changed`. A host remains authoritative over its actual container size.

## Loading, errors, cancellation, and teardown

The View shows a bounded status line before the nested map is ready. A tool cancellation or error result clears any previous iframe source so stale route UI is not left visible. Teardown disconnects the resize observer, clears the frame, rejects pending View requests, and acknowledges `ui/resource-teardown`.

A Google Maps Embed error inside Google's own iframe, such as an invalid or restricted API key, remains a Google-rendered error surface. It does not authorize fallback browser control or any attempt to discover an internal Maps API.

## Security and deployment

`GOOGLE_MAPS_EMBED_API_KEY` is deployment configuration. Never commit a real key to this repository, generated artifacts, screenshots, test fixtures, or logs.

Use a dedicated key for this feature and apply an API restriction for the **Maps Embed API**. Apply an application restriction appropriate to the actual host/referrer environment and validate it on each production host. Do not weaken key restrictions merely to make another host pass. The nested iframe uses `referrerpolicy="strict-origin-when-cross-origin"`, which is the policy Google recommends for referrer-based key restrictions.

The key is necessarily delivered to the client-side MCP App HTML because Maps Embed API is an iframe/browser API. Treat it as a restricted client-side API key, not as an application credential. No account credential, password, MFA/OTP value, browser cookie, OAuth token, or Google Maps internal API response is relayed through this UI.

The resource CSP intentionally declares only the required nested-frame origin. The View has no need for generic `connectDomains`, external script/style origins, camera, microphone, geolocation, or clipboard permissions.

MCP Apps support does not widen the Maps controller surface. In particular, it does not add raw DOM/CDP/Accessibility access, generic clicks, arbitrary navigation, generic text entry, pointer primitives, scraping, review harvesting, or CAPTCHA handling.

## Transport note

MCP Apps is a UI extension; it does not require the MCP server itself to become a browser-CORS endpoint. The project's HTTP transport remains POST-only at `/mcp` and does not expose generic CORS preflight support merely for the UI feature.

The official `ext-apps` basic reference host runs its MCP client in a browser and therefore requires browser CORS. The project-level reference-host check used a temporary, localhost-only, exact-origin CORS adapter in front of the unchanged Maps MCP transport. That adapter is test infrastructure, not a supported production deployment mode and not part of this repository.

## Compatibility evidence

Status as of 2026-08-15:

| Host/client | Result | Scope |
| --- | --- | --- |
| ChatGPT Web | **PASS** | Existing project PoC rendered a real Google Maps Embed directions view through the Remote MCP connection. |
| Official `modelcontextprotocol/ext-apps` basic reference host | **PASS for MCP Apps pipeline** | Resource discovery, CSP propagation, sandbox/View lifecycle, tool input/result delivery, nested iframe creation, and responsive host container behavior reached the Google Embed surface. A deliberately dummy API key was rejected by Google, so this check does not claim a successful real map render. |
| Official `@modelcontextprotocol/sdk` client, no Embed key | **PASS** | `maps_render_directions` remained present with no UI linkage and returned useful text + structured route data. |
| VS Code Stable | **Not project-verified yet** | VS Code officially supports MCP Apps and matches the standard Tool + `ui://` resource model. This repository does not yet claim a real-key inline render in VS Code. |

The reference-host check used upstream `modelcontextprotocol/ext-apps` commit `10195ad91851502134930e9b80ec2c04e277a720` and the published 1.7.x host/SDK packages. It is a portability check, not a substitute for testing every production host.

## Portability milestone completion criteria

The MCP Apps portability/hardening milestone is considered complete when all of the following remain true:

1. the text/structured result works without MCP Apps and without an Embed key,
2. UI metadata/resource advertisement is conditional and cannot make the core tool unusable,
3. the View follows the stable MCP Apps lifecycle and host-context/sizing contract,
4. CSP and permissions remain minimal,
5. cancellation, error, and teardown states do not leave stale route UI,
6. one non-ChatGPT MCP Apps host/reference host exercises the UI pipeline,
7. at least one real non-UI client exercises the fallback, and
8. unsupported production-host combinations are documented rather than claimed.

These criteria are met by the current hardening track. The UI remains labeled **experimental** until a second production host completes a real-key Google Maps Embed render. Re-open production-host validation when such an environment is available or when the MCP Apps stable specification/host behavior changes materially.

## References

- MCP Apps stable specification: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- MCP Apps reference implementation: https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host
- VS Code MCP Apps developer guide: https://code.visualstudio.com/api/extension-guides/ai/mcp
- Google Maps Embed API: https://developers.google.com/maps/documentation/embed/embedding-map
