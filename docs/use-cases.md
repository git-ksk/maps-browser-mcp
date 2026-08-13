# Usage modes and examples

[日本語](use-cases.ja.md) | [Documentation](README.md) | [V4 capability inventory](maps-web-capability-inventory.md)

`maps-browser-mcp` supports two intentionally different usage modes:

- **Navigation-only** — the MCP opens or changes the Google Maps web surface, while a human reads the visible result.
- **Interactive assist** — the MCP may additionally read a small, bounded summary of the currently visible Maps UI and perform bounded Maps-specific semantic UI operations for the user's active request.

The difference is controlled by `INTERACTIVE_ASSIST_MODE`. The default is `false`.

This setting is an explicit product/safety boundary. `false` should not be described as a Google-terms requirement, and `true` should not be described as blanket permission to automate or extract Google Maps content. See [Compliance and safety boundaries](compliance.md) for the applicable design constraints.

V4 expands **Interactive Assist** toward broad semantic coverage of major unauthenticated Google Maps Web capabilities. It does not expose generic browser primitives. See the [canonical V4 capability inventory](maps-web-capability-inventory.md).

## Choosing a mode

| Deployment / workflow | `INTERACTIVE_ASSIST_MODE=false` | `INTERACTIVE_ASSIST_MODE=true` |
| --- | --- | --- |
| Local MCP with visible Chrome | Good fit when the MCP navigates and the user reads the Maps UI directly | Good fit when the client also needs a bounded summary or Maps-specific semantic UI interaction |
| Remote / headless deployment | Navigation still works, but the caller normally cannot see the resulting Maps UI, so usefulness is limited | Better fit when the client must answer from or safely interact with the currently visible route/place state |
| URL-driven search, directions, map view, Street View | Supported | Supported |
| Read route/place labels or small visible summaries | Not available | Supported through bounded read tools |
| V4 UI-native operations such as verified place-share link generation | Not available | Supported where implemented |
| Bulk collection, crawling, dataset harvesting | Not supported | Not supported |

## Navigation-only mode

Navigation-only mode is the default:

```bash
INTERACTIVE_ASSIST_MODE=false npm start
```

or for HTTP:

```bash
INTERACTIVE_ASSIST_MODE=false npm run start:http
```

This mode is useful when the MCP is acting as a **Maps navigator** rather than a Maps-content reader/controller.

### Example: local directions

User request:

```text
Open public-transit directions from Tokyo Station to Shinagawa Station.
```

Typical flow:

```text
maps_directions({
  origin: "Tokyo Station",
  destination: "Shinagawa Station",
  mode: "transit"
})
```

The dedicated Chrome session opens the official Google Maps directions URL. The user can then inspect the visible route candidates directly in that browser window.

The MCP does **not** call `maps_read_route_summary`, so it cannot report the visible duration, fare, line names, or candidate labels back to the client from the rendered page.

### What still works with reading disabled

The following operations do not require interactive-assist reading:

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`
- `maps_set_travel_mode`

The semantic selection tools (`maps_select_result` and `maps_select_route`) also remain exposed, but without a fresh bounded summary the caller normally lacks a reliable current `index + expectedLabel` pair. Prefer the read-then-select flow when the client itself needs to choose among dynamic candidates.

V4 operations that depend on visible UI state, including `maps_get_place_share_link`, remain disabled when Interactive Assist is off.

## Interactive-assist mode

Enable bounded visible-state reading/interaction explicitly:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

or for HTTP:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

This enables bounded read tools such as:

- `maps_read_place_summary`
- `maps_read_route_summary`

and V4 UI-native operations as they are implemented, starting with:

- `maps_get_place_share_link`

### Example: answer from the current route UI

User request:

```text
How long does it take to get from Tokyo Station to Shinagawa Station by public transit?
```

Typical flow:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> summarize the bounded visible result for the user
```

If the user asks to choose a displayed candidate:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> choose items[{ index, label }]
  -> maps_select_route({ index, expectedLabel: label })
```

`expectedLabel` is important because Google Maps may reorder candidates dynamically. If the label no longer matches, the runtime returns `UI_STATE_CHANGED` instead of guessing which candidate to click.

### V4 example: get the share link for the selected place

User request:

```text
Find Tokyo Station, select the result I mean, and give me the Google Maps share link.
```

Safe semantic flow:

```text
maps_search({ query: "Tokyo Station" })
  -> maps_read_place_summary()
  -> choose items[{ index, label }]
  -> maps_select_result({ index, expectedLabel: label })
  -> maps_get_place_share_link({ expectedLabel: selectedPlaceLabel })
```

The last call does not expose a generic click/DOM/clipboard tool. It verifies that a selected place is active, revalidates the expected place identity immediately before opening Share, requires one unambiguous visible Share target, and returns only a bounded allow-listed Google Maps share URL. If the active place changed, the UI is ambiguous, or a challenge/sign-in interrupts the flow, the operation fails closed or enters the existing Human Intervention boundary.

After Human Intervention, the caller must reissue the semantic workflow and revalidate the target; human completion never approves automatic replay of the old share action.

## Why reading/semantic UI interaction is opt-in

The opt-in boundary has several goals:

- make browser-visible content reading/interaction an explicit deployment decision,
- keep navigation-only installations simple,
- prevent accidental expansion from user-directed navigation into content extraction or generic browser automation,
- preserve a clear place to enforce independent read budgets and size limits,
- keep remote/headless deployments honest about when they are actually consuming rendered Maps UI.

It is **not** a statement that Google requires this environment variable to be `false`. Conversely, enabling it does not make scraping, crawling, bulk extraction, persistence, or dataset construction acceptable project use cases.

When enabled, bounded reading remains constrained by settings such as `MAPS_MAX_AX_NODES`, `MAPS_MAX_READ_CHARS`, and `MAPS_MAX_VISIBLE_READS_PER_HOUR`. V4 UI-native operations also consume action/read policy budgets where appropriate and keep their own target/result probes bounded. They do not expose raw HTML, a full DOM or accessibility tree, cookies, network payloads, clipboard dumps, or review-body harvesting.

## Deployment guidance

### Local visible-browser use

Navigation-only mode can be useful by itself because the user can see the dedicated Chrome window. A request can therefore end after `maps_search` or `maps_directions` and the human can inspect the result.

### Remote / Cloud Run / headless use

A remote client normally cannot inspect the dedicated browser UI directly. In that architecture, navigation-only mode may still be useful for workflows that only need to drive the Maps surface, but it cannot by itself turn rendered route/place content into an MCP response or safely complete UI-native V4 interactions.

If the remote client must answer questions about or safely interact with the current visible Maps result, Interactive Assist is the intended bounded mechanism. Remote exposure also has separate authentication, browser-profile, and deployment constraints; see [ChatGPT connection notes](chatgpt.md), [Container / headless Linux](container.md), and [Compliance and safety boundaries](compliance.md).

## Non-goals in both modes

Neither mode turns this project into a general-purpose browser automation or Maps extraction service. In particular, the project intentionally does not support:

- raw DOM / raw Accessibility Tree / raw CDP MCP tools,
- generic browser, desktop, or shell MCP operations,
- bulk scraping or crawling,
- place/route/review dataset harvesting,
- background collection,
- review-body harvesting,
- interception of Maps internal network traffic,
- CAPTCHA solving or bot-detection bypass.

For application workflows already covered by a supported Google Maps Platform API or Google-managed Maps MCP interface **without requiring the Maps Web experience**, prefer that supported structured interface. Official overlap remains lower priority rather than an automatic V4 scope exclusion.