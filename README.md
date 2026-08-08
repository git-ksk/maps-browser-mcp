# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

A lightweight MCP server for interacting with Google Maps through a dedicated browser session.

> **Status:** Planning / early development

## Goal

Provide MCP clients with a small, purpose-built set of Google Maps actions without exposing a general-purpose browser automation interface.

The project is designed around user-directed, interactive use: open a map, search for a place, show directions, select visible results, and optionally read a minimal summary of the currently displayed state.

## Design principles

- Prefer official Google Maps URLs for search, directions, map views, and Street View.
- Use a dedicated Chromium profile and persistent Maps session.
- Expose semantic MCP tools instead of generic `click`, `type`, or arbitrary JavaScript execution.
- Keep browser automation narrowly scoped to Google Maps.
- Minimize DOM / accessibility-tree reads and avoid full-page extraction.
- Do not use undocumented Google Maps internal APIs.
- Do not bypass CAPTCHA, bot detection, or other access controls.
- Do not perform bulk collection, background crawling, or build persistent Maps datasets.

## Planned tools

### Navigation

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`

### Interaction

- `maps_select_result`
- `maps_select_route`
- `maps_set_travel_mode`

### Optional visible-state reading

- `maps_read_place_summary`
- `maps_read_route_summary`

Visible-state reading will be limited, user-directed, and treated as an optional/experimental capability.

## Planned architecture

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
    +-- Browser Session Manager
    +-- Semantic UI Controller
    +-- Optional Visible-State Reader
    |
    v
Dedicated Chromium / CDP
    |
    v
Google Maps
```

## Non-goals

This project is **not** intended to be:

- a Google Maps Platform API replacement
- a general-purpose browser MCP
- a Google Maps scraper
- a bulk place / review / route collection tool
- a CAPTCHA or anti-bot bypass tool

## Roadmap

1. MCP server skeleton (TypeScript)
2. Official Maps URL compiler
3. Dedicated Chromium + CDP runtime
4. Semantic Maps UI controls
5. Policy / domain / rate guards
6. Optional visible-state reader
7. Performance benchmarks
8. ChatGPT Developer Mode E2E validation
9. OSS hardening and documentation

## Disclaimer

This is an independent open-source project and is not affiliated with or endorsed by Google. Users are responsible for complying with applicable Google Maps and Google terms when using the software.

## License

MIT
