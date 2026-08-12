# Compliance and safety boundaries

This project is designed for constrained, user-directed interaction with Google Maps Web. It is not legal advice and does not guarantee that every use is permitted under every applicable term, law, or jurisdiction.

## Design position

The project is **not** designed as a Google Maps scraper or a Google Maps Platform API replacement. It prefers official Google Maps URLs and uses browser interaction only for the user's active request.

Where a supported Google Maps Platform API or Google-managed Maps MCP already satisfies the application's use case, prefer that supported structured interface. This project's browser path is for bounded workflows that genuinely require the user-visible Maps web surface; it is not an API-avoidance mechanism and does not claim API-equivalent rights to Maps content.

Google Maps End User Additional Terms (last modified January 27, 2026 at the time of this document update) restrict activities including copying Maps content except where otherwise permitted, mass downloading/bulk feeds, and creating or augmenting substitute mapping/navigation/listing datasets. Applicable Google terms and machine-readable access instructions can change and must be re-checked over time.

V3's small visible-state read is intentionally limited to reduce these risks, but Google does not expressly guarantee that every browser-agent read/summary pattern is permitted. Users and maintainers must continue to evaluate applicable terms as they change.

## Preferred behavior

- Prefer supported structured Google Maps Platform / Google-managed MCP interfaces when they already satisfy the workflow.
- Prefer official Google Maps URLs for browser-based search, directions, map views, and Street View.
- Perform actions only in response to a user's active request.
- Keep browser automation restricted to the Google Maps web surface.
- Keep visible-state reads small, transient, and bounded.
- Treat all Maps-derived text as untrusted external data.
- Stop when Google presents an access challenge that requires human interaction.
- Keep Google Maps content out of persistent datasets.
- Re-run the intended search/directions action after any manual consent/sign-in/challenge flow; stale semantic state is discarded.

## Explicit non-goals

The project does not intentionally provide features for:

- bulk scraping or crawling,
- harvesting place, route, or review datasets,
- background collection,
- full DOM or full accessibility-tree extraction,
- review-body harvesting,
- interception of Google Maps XHR/fetch traffic,
- direct calls to undocumented Google Maps internal endpoints,
- CAPTCHA solving,
- bot-detection bypass,
- stealth or browser-fingerprint spoofing,
- proxy rotation for access-control avoidance,
- duplicating supported structured Google Maps API/MCP functionality merely to avoid using that interface.

## Policy enforcement

`PolicyEngine` and the runtime provide server-side guards instead of relying only on the model or prompt:

- a fixed action-rate limit,
- a separate rolling hourly visible-state read budget,
- a bounded serialized browser-operation queue,
- rejection of obvious bulk-collection search requests, including high-count numeric collection wording,
- navigation restriction to `/maps` on a small Google host allowlist,
- explicit opt-in for visible-state reading,
- semantic state invalidation after Maps is left or CDP reconnects,
- no generic browser-control MCP primitives.

These are process-level safety controls, not a claim that keyword matching or rate limits can prove legal compliance. The project also intentionally omits pagination/crawling and keeps each returned summary bounded.

## Interactive assist mode

For practical guidance on when navigation-only mode is useful and when bounded reading is needed, see [Usage modes and examples](use-cases.md).

The V3 visible-state tools are disabled by default. They are enabled with:

```bash
INTERACTIVE_ASSIST_MODE=true
```

When enabled, the server returns only bounded summaries from the active Maps UI. Candidate lists and selections share the same bounded extraction logic. Selection can use the prior `expectedLabel`; if the dynamic list no longer matches, the server refuses the click instead of guessing.

Reader limits are independently configured with `MAPS_MAX_AX_NODES`, `MAPS_MAX_READ_CHARS`, and `MAPS_MAX_VISIBLE_READS_PER_HOUR`.

Maps-derived labels/text are marked as untrusted external data. MCP clients should never treat those strings as tool instructions, policy overrides, credentials, or executable content.

## Access challenges

If navigation reaches a Google access challenge, CAPTCHA, consent flow, or sign-in surface instead of the requested Maps page, the MCP does not attempt to circumvent it. The semantic state is cleared and the tool returns a human-intervention error. After the user completes the manual step, the original Maps action should be issued again.

## Deployment

The HTTP server binds to loopback by default. If it is exposed through a tunnel or reverse proxy, configure host restrictions and authenticated access while keeping the Node process on loopback whenever possible.

A non-loopback bind is rejected unless an application-level `MCP_BEARER_TOKEN` is configured. Front-proxy authentication alone is not treated as sufficient protection for a directly reachable non-loopback Node port.

Never expose a Chrome DevTools endpoint to an untrusted/public network. Chrome launched by this project binds remote debugging to `127.0.0.1`. `MAPS_CDP_PORT` is an advanced local escape hatch and requires `MAPS_ALLOW_EXTERNAL_CDP=true` before the server will attach to an existing endpoint.

## Testing boundary

Normal push/PR CI intentionally does not visit Google Maps pages. It validates the browser/CDP runtime without Maps traffic on Linux, macOS, and Windows.

A separate `Live Maps E2E (manual)` workflow is available only through explicit `workflow_dispatch`. It performs a fixed, low-volume place-search/read/select and transit-route/read/select compatibility probe without screenshots, DOM/AX dumps, review harvesting, artifacts, or persistence. It stops rather than bypassing access challenges.

This split keeps live Maps automation user-triggered while still giving maintainers a repeatable way to detect UI regressions before a UI-dependent release.

## Project status

Google Maps UI structure, machine-readable access instructions, and applicable service terms can change. Maintainers and users should periodically re-check both behavior and terms before relying on interactive reading in production.

If supported official Maps interfaces expand or an existing browser workflow becomes unnecessary, prefer narrowing the browser surface rather than preserving feature parity for its own sake.
