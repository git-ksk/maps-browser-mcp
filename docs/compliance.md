# Compliance and safety boundaries

This project is designed for constrained, user-directed interaction with Google Maps Web. It is not a legal opinion and does not guarantee that every use is permitted under every applicable term, law, or jurisdiction.

## Preferred behavior

- Prefer official Google Maps URLs for search, directions, map views, and Street View.
- Perform actions only in response to a user's active request.
- Keep browser automation restricted to the Google Maps web surface.
- Keep visible-state reads small, transient, and bounded.
- Stop when Google presents an access challenge that requires human interaction.
- Keep Google Maps content out of persistent datasets.

## Explicit non-goals

The project does not intentionally provide features for:

- bulk scraping or crawling,
- harvesting place, route, or review datasets,
- background collection,
- full DOM or full accessibility-tree extraction,
- interception of Google Maps XHR/fetch traffic,
- direct calls to undocumented Google Maps internal endpoints,
- CAPTCHA solving,
- bot-detection bypass,
- stealth or browser-fingerprint spoofing,
- proxy rotation for access-control avoidance.

## Policy enforcement

`PolicyEngine` provides process-level guards:

- a fixed action-rate limit,
- rejection of obvious bulk-collection search requests,
- navigation restriction to Google Maps URLs,
- explicit opt-in for visible-state reading.

These checks are intentionally enforced server-side instead of relying only on the model or prompt.

## Interactive assist mode

The V3 visible-state tools are disabled by default. They are enabled with:

```bash
INTERACTIVE_ASSIST_MODE=true
```

When enabled, the server exposes only bounded summaries from the currently active Maps UI. The reader has independent node and character limits configured with `MAPS_MAX_AX_NODES` and `MAPS_MAX_READ_CHARS`.

## Access challenges

If navigation reaches a Google access challenge, CAPTCHA, consent flow, or sign-in surface instead of the requested Maps page, the MCP does not attempt to circumvent it. The tool returns a human-intervention error and leaves the dedicated browser available for the user to handle the step manually.

## Deployment

The HTTP server binds to loopback by default. If it is exposed through a tunnel or reverse proxy, configure host restrictions and authentication at the proxy and/or use the optional `MCP_BEARER_TOKEN` guard. Do not expose an unauthenticated browser-control endpoint to the public internet.

## Project status

Google Maps UI structure and applicable service terms can change. Maintainers and users should periodically re-check both behavior and terms before relying on interactive reading in production.
