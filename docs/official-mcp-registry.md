# Official MCP Registry publication

This document records the publication gate for `maps-browser-mcp`.

The current stable source release remains **v0.3.3** and is not published to npm. Registry work must not retroactively republish or reinterpret the v0.3.3 tag.

## Next distribution version

The first npm + Official MCP Registry publication target is **v0.3.4**.

Before publication, all of the following must refer to exactly the same version:

- `package.json`
- root package metadata in `package-lock.json`
- MCP server runtime/version metadata
- `server.json`
- Git tag / GitHub Release
- npm package
- Official MCP Registry record

`server.json.example` records the intended v0.3.4 shape. It is intentionally an example until the repository is actually bumped to v0.3.4; keeping it as an example avoids claiming that an unpublished npm package already exists.

## Ownership identity

The canonical Official MCP Registry server name is:

```text
io.github.git-ksk/maps-browser-mcp
```

`package.json` must keep:

```json
"mcpName": "io.github.git-ksk/maps-browser-mcp"
```

The final `server.json` `name` must match that value exactly. This is the npm ownership-verification boundary used by the Official MCP Registry.

## Intended package record

The first publication uses the existing unscoped npm package name and stdio transport:

```json
{
  "registryType": "npm",
  "identifier": "maps-browser-mcp",
  "version": "0.3.4",
  "transport": {
    "type": "stdio"
  }
}
```

The registry metadata does not widen the server's runtime capability surface. HTTP/self-hosted deployment remains documented separately; the package record describes the installable local stdio package.

## Pre-publication gate

Do not publish merely because the metadata exists. The publication candidate must pass all normal protected-branch checks plus a distribution-specific gate:

1. bump all repository version surfaces to the same release version;
2. rename/materialize `server.json.example` as version-matched `server.json`;
3. run the normal `npm run check` and build;
4. run `npm pack --dry-run` and inspect the file list;
5. create the actual tarball with `npm pack` and install it into a clean temporary consumer directory;
6. start the packed package over stdio and verify MCP initialization + `tools/list`;
7. verify the packed `package.json` contains the expected `mcpName`, repository, license, engines, and bin metadata;
8. confirm no credentials, browser profiles, local state, test artifacts, or unrelated files are included;
9. only then authorize npm publication;
10. verify the exact npm version after publication before authenticating/publishing with `mcp-publisher`;
11. publish the same version to the Official MCP Registry;
12. query the registry for `io.github.git-ksk/maps-browser-mcp` and verify the returned version/package/transport fields.

## Fail-closed rules

Abort publication if any of these are true:

- package/tag/registry versions differ;
- the npm name is not controlled by this maintainer at publication time;
- `mcpName` and `server.json.name` differ;
- the packed artifact differs materially from the reviewed candidate;
- the clean-consumer stdio smoke fails;
- protected CI / CodeQL is not green;
- npm publication or Registry publication was not explicitly authorized.

## GitHub repository metadata

Repository description/topics are discovery metadata rather than release artifacts. The intended values are tracked in issue #141. They should be updated when an authenticated repository-settings mutation path is available, without blocking the safe preparation work above.
