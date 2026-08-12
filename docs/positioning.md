# Project positioning

[English](positioning.md) | [日本語](positioning.ja.md)

`maps-browser-mcp` is a **constrained, experimental Google Maps browser controller for MCP**. Its purpose is to provide a deliberately bounded, Maps-specific control surface for user-directed interaction with the visible Google Maps web UI.

It is not intended to compete with supported structured Google Maps interfaces on data breadth, nor with general-purpose browser MCPs on arbitrary web automation.

## Prefer official structured Maps interfaces when they fit

If a supported Google Maps Platform API or Google-managed Maps MCP already provides the information or operation an application needs, prefer that supported structured interface when the workflow does not require the Google Maps web experience.

Browser automation is appropriate here only for bounded workflows that genuinely use the user-visible Maps web surface and fit this project's safety/compliance boundaries. The existence of a browser path should not be treated as a reason to duplicate official structured functionality merely to avoid API usage.

This preference is a **priority signal, not a hard scope exclusion**. A capability may still belong in `maps-browser-mcp` when it overlaps with an official structured interface but is needed to make a coherent Google Maps Web workflow possible.

## Product scope and implementation priority

The long-term product direction is **broad semantic coverage of user-directed operations that are meaningfully available in Google Maps Web**, while preserving the project's constrained Maps-only capability surface and safety boundaries.

The project does not define its scope by subtracting everything that an official API or Google-managed MCP can also do. Instead, overlap changes implementation priority:

1. **Highest priority — browser-native and UI-dependent Maps capabilities.** Prioritize operations whose value comes from the actual Maps web experience or visible browser state: selecting/reselecting visible results and routes, changing UI modes, Street View interaction, Maps-specific multi-step workflows, visible-state verification, and safe Human handoff when legitimate manual intervention is required.
2. **Normal priority — overlapping capabilities required to complete a browser workflow.** Search, directions, place/route summaries, and similar operations may overlap with structured interfaces, but remain appropriate when they are semantic primitives needed to start, continue, verify, or complete the visible Maps workflow.
3. **Lower priority — mostly structured/data-equivalent capabilities with little browser-specific value.** Pure geocoding-style utilities, bulk calculations, broad data lookup, or other functionality that adds little beyond a supported structured interface should not displace browser-native work. They are not automatically forbidden, but require a concrete Maps Web workflow reason rather than feature-parity pressure.

In short: **official overlap lowers priority; it does not automatically remove a feature from scope**. Feature parity with the useful Google Maps Web experience is a long-term direction, while parity with structured Maps data APIs for its own sake is not.

## Where this project fits

| Surface | Best fit | `maps-browser-mcp` boundary |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supported structured Maps, grounding, place, route, or related data where available | prefer these when the workflow only needs structured data; overlap does not exclude a browser semantic primitive needed for a Maps Web workflow |
| General-purpose browser MCPs | broad web navigation and arbitrary browser automation | exposes only Maps-specific actions and keeps a substantially smaller domain capability surface |
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

Broader Google Maps Web coverage should be added by expanding **semantic Maps operations**, not by exposing raw browser/CDP primitives.

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

- expanding semantic coverage of useful Google Maps Web workflows;
- browser-native/UI-dependent capabilities before structured-data-equivalent features;
- semantic stability across supported visible Maps workflows;
- deterministic fail-closed behavior when UI state becomes ambiguous;
- bounded compatibility E2E rather than broad unattended crawling;
- dedicated-browser/CDP portability and isolation;
- clear policy/audit behavior;
- periodic review of overlap with official Google Maps API/MCP capabilities as a prioritization input.

Do not prioritize:

- structured API feature parity for its own sake;
- broader extraction volume;
- persistent content collection;
- generic browser-control primitives;
- bypassing access challenges;
- duplicating official structured Maps capabilities merely to avoid using them.

See [Compliance and safety boundaries](compliance.md) for the detailed operational boundary.