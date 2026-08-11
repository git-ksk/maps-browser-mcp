# Project positioning

[English](positioning.md) | [日本語](positioning.ja.md)

`maps-browser-mcp` is a **constrained, experimental Google Maps browser controller for MCP**. Its purpose is to provide a deliberately small control surface for user-directed interaction with the visible Google Maps web UI.

It is not intended to compete with supported structured Google Maps interfaces on data breadth, nor with general-purpose browser MCPs on arbitrary web automation.

## Prefer official structured Maps interfaces when they fit

If a supported Google Maps Platform API or Google-managed Maps MCP already provides the information or operation an application needs, prefer that supported structured interface.

Browser automation is appropriate here only for bounded workflows that genuinely require the user-visible Maps web surface and fit this project's safety/compliance boundaries. The existence of a browser path should not be treated as a reason to duplicate official structured functionality merely to avoid API usage.

## Where this project fits

| Surface | Best fit | `maps-browser-mcp` boundary |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supported structured Maps, grounding, place, route, or related data where available | prefer these when they satisfy the workflow; this project is for bounded interaction with the visible Maps UI |
| General-purpose browser MCPs | broad web navigation and arbitrary browser automation | exposes only Maps-specific actions and keeps a substantially smaller capability surface |
| Scrapers / dataset harvesters | bulk collection and persistent extraction | explicitly out of scope; visible-state reading is bounded, transient, opt-in, and not a dataset API |
| `maps-browser-mcp` | constrained user-directed Maps browser control | local dedicated browser, fail-closed semantic state, bounded reads, no bypass/harvesting features |

## Defensible design boundary

The project's differentiation is not richer Maps data extraction. It is the combination of:

- Maps-specific MCP tools instead of generic browser primitives;
- a dedicated Chrome/Chromium profile;
- loopback-only CDP by default;
- official Maps URLs where practical;
- serialized operations against one semantic browser state;
- stale-selection refusal when the visible UI changes;
- bounded, opt-in visible-state reads;
- explicit human handoff for access challenges rather than bypass;
- no internal Maps API interception, stealth, proxy rotation, or bulk crawling.

## Compliance posture

This project does **not** claim that every browser-agent operation or bounded visible-state read is guaranteed permitted under Google terms, laws, or every jurisdiction.

It also does not claim API-equivalent rights to Google Maps content.

The project intentionally avoids designing features for:

- bulk feeds/downloads;
- persistent Maps datasets;
- place/review/route harvesting;
- full DOM or accessibility-tree export;
- undocumented internal endpoint access;
- CAPTCHA or anti-bot bypass;
- stealth/fingerprint spoofing;
- generic arbitrary-site browser automation.

If Google changes the Maps UI, service terms, access behavior, or supported official interfaces, maintainers should re-evaluate the affected browser workflow and narrow or disable it when appropriate.

## Product direction

Prioritize:

- semantic stability across supported visible Maps workflows;
- deterministic fail-closed behavior when UI state becomes ambiguous;
- bounded compatibility E2E rather than broad unattended crawling;
- dedicated-browser/CDP portability and isolation;
- clear policy/audit behavior;
- periodic review of overlap with official Google Maps API/MCP capabilities.

Do not prioritize:

- broader extraction volume;
- persistent content collection;
- generic browser-control primitives;
- bypassing access challenges;
- duplicating official structured Maps capabilities merely to avoid using them.

See [Compliance and safety boundaries](compliance.md) for the detailed operational boundary.