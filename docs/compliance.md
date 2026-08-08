# Compliance and safety boundaries

This project is designed for constrained, user-directed interaction with Google Maps Web. It is not legal advice and does not guarantee that every use is permitted under every applicable term, law, or jurisdiction.

## Design position

The project is **not** designed as a Google Maps scraper or a Google Maps Platform API replacement. It prefers official Google Maps URLs and uses browser interaction only for the user's active request.

Current Google Maps terms restrict activities such as copying/redistributing Maps content beyond allowed cases, mass downloading/bulk feeds, and creating or augmenting substitute mapping/listing datasets. Current Google terms also prohibit misuse such as bypassing protective measures and automated access that conflicts with machine-readable instructions.

V3's small visible-state read is intentionally limited to reduce these risks, but Google does not expressly guarantee that every browser-agent read/summary pattern is permitted. Users and maintainers must continue to evaluate applicable terms as they change.

## Preferred behavior

- Prefer official Google Maps URLs for search, directions, map views, and Street View.
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
- proxy rotation for access-control avoidance.

## Policy enforcement

`PolicyEngine` and the runtime provide server-side guards instead of relying only on the model or prompt:

- a fixed action-rate limit,
- a bounded serialized browser-operation queue,
- rejection of obvious bulk-collection search requests,
- navigation restriction to `/maps` on a small Google host allowlist,
- explicit opt-in for visible-state reading,
- semantic state invalidation after Maps is left or CDP reconnects,
- no generic browser-control MCP primitives.

## Interactive assist mode

The V3 visible-state tools are disabled by default. They are enabled with:

```bash
INTERACTIVE_ASSIST_MODE=true
```

When enabled, the server returns only bounded summaries from the active Maps UI. Candidate lists and selections share the same bounded extraction logic. Selection can use the prior `expectedLabel`; if the dynamic list no longer matches, the server refuses the click instead of guessing.

Reader limits are independently configured with `MAPS_MAX_AX_NODES` and `MAPS_MAX_READ_CHARS`.

Maps-derived labels/text are marked as untrusted external data. MCP clients should never treat those strings as tool instructions, policy overrides, credentials, or executable content.

## Access challenges

If navigation reaches a Google access challenge, CAPTCHA, consent flow, or sign-in surface instead of the requested Maps page, the MCP does not attempt to circumvent it. The semantic state is cleared and the tool returns a human-intervention error. After the user completes the manual step, the original Maps action should be issued again.

## Deployment

The HTTP server binds to loopback by default. If it is exposed through a tunnel or reverse proxy, configure host restrictions and authenticated access.

A non-loopback bind is rejected unless a Bearer token is configured or the operator explicitly sets `MCP_TRUST_EXTERNAL_AUTH=true` to acknowledge that authentication is enforced externally.

Never expose a Chrome DevTools endpoint to an untrusted/public network. `MAPS_CDP_PORT` is intended only for a local dedicated Chrome instance under the user's control.

## Testing boundary

Automated CI intentionally does not visit Google Maps pages. It validates the browser/CDP runtime without Maps traffic. This avoids turning CI into unattended Maps automation, but it also means Google Maps UI compatibility cannot be guaranteed by CI alone.

Before a UI-dependent release is considered stable, maintainers should perform a small, user-directed E2E check against the live Maps interface and re-check applicable terms.

## Project status

Google Maps UI structure, machine-readable access instructions, and applicable service terms can change. Maintainers and users should periodically re-check both behavior and terms before relying on interactive reading in production.
