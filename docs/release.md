# Release checklist

Use this checklist for pre-1.0 releases. The goal is to keep code, MCP metadata, package contents, browser compatibility, and GitHub security controls aligned.

## 1. Prepare the release branch

- Start from current `main`.
- Keep the change set focused.
- Update documentation for any user-visible behavior or configuration changes.
- Do not weaken the Maps-only navigation boundary, V3 bounds, challenge handling, or single-user/session assumptions without an explicit security/design review.

## 2. Version consistency

Update `package.json` to the intended version.

The repository policy test requires the MCP server version in `src/server.ts` to match `package.json`.

Run:

```bash
npm run check
```

Do not create a tag whose version disagrees with package/server metadata.

## 3. Dependency and build verification

Use the lockfile exactly:

```bash
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
```

Then verify transport/browser/package behavior:

```bash
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
npm pack --dry-run
```

Review `npm pack --dry-run` output. The published package must not contain browser profiles, `.env` files, logs, screenshots, traces, credentials, or development-only local artifacts.

## 4. Required GitHub checks

`main` is protected. A release PR should pass all required checks before merge:

- `check (20)`
- `check (22)`
- `check (24)`
- `Browser smoke (macos-15)`
- `Browser smoke (windows-2022)`
- `Analyze (JavaScript/TypeScript)`

The CodeQL workflow is expected to require zero findings for its configured analysis.

Do not bypass required checks or force-push `main` to ship a release.

## 5. Manual live Google Maps compatibility

Normal push/PR CI does not visit Google Maps.

Before a release that changes any of these areas, run **Live Maps E2E (manual)** from GitHub Actions:

- Maps URL compilation,
- semantic place candidate extraction/selection,
- semantic route candidate extraction/selection,
- V3 visible-state reading,
- browser challenge/navigation safety logic,
- Chrome/CDP behavior that could affect the live page.

The workflow is deliberately `workflow_dispatch`-only and low-volume.

Expected live path:

```text
place search
  -> bounded place read
  -> index + expectedLabel place selection
  -> transit directions
  -> bounded route read
  -> index + expectedLabel route selection
```

Record pass/fail only. Do not add screenshots, DOM dumps, cookies, browser profiles, reviews, or location-result artifacts to the repository.

For documentation-only or obviously non-runtime changes, a new live Maps run is normally unnecessary unless the live compatibility baseline is already in doubt.

## 6. Security/repository settings

Before the first public release and periodically afterward, confirm:

- `main` remains protected,
- required status checks remain configured,
- admin enforcement remains enabled,
- force pushes and branch deletion remain disabled,
- linear history remains required,
- conversation resolution remains required,
- Private vulnerability reporting remains enabled,
- Dependabot configuration is present,
- GitHub Actions dependencies remain pinned to full commit SHAs.

Repository tests enforce the workflow pinning/manual-live invariants that can be represented in source. GitHub-hosted repository settings still need periodic verification outside the codebase.

## 7. Documentation review

Confirm the following still match the release:

- `README.md`
- `README.ja.md`
- `.env.example`
- `docs/getting-started.md`
- `docs/troubleshooting.md`
- `docs/chatgpt.md`
- `docs/architecture.md`
- `docs/compliance.md`
- `docs/manual-e2e.md`
- `SECURITY.md`
- `CONTRIBUTING.md`

In particular, verify defaults, tool names, environment variables, error/recovery guidance, and plan/client-specific statements that may become stale.

## 8. Merge and tag

Merge through the protected `main` branch after all required checks pass.

For version `0.1.0`, the tag should be:

```text
v0.1.0
```

Create the tag from the exact tested `main` commit, not from an earlier PR head.

## 9. GitHub Release notes

Release notes should include:

- what the project does,
- status of V1/V2/V3,
- notable safety boundaries,
- supported Node versions,
- Chrome/Chromium requirement,
- whether live Maps E2E passed for the release,
- known experimental/compatibility limitations,
- install/run instructions or a link to Getting Started.

Do not describe V3 as guaranteed compatible with future Google Maps UI versions.

## 10. npm publication, if/when enabled

Do not imply npm availability in README until the package has actually been published and the package ownership/provenance setup is verified.

Before publishing:

```bash
npm pack --dry-run
```

Prefer provenance/2FA-capable publishing practices supported by the registry at release time. Treat the npm account/package namespace as a separate supply-chain security boundary.

After publication, install the published artifact in a clean environment and run at least the non-live smoke path before advertising it as the recommended installation method.

## 11. Post-release

- Verify the GitHub tag/release points to the intended commit.
- Verify `main` CI remains green.
- Check Dependabot/CodeQL/security alerts.
- Keep the manual live E2E available for future Google Maps UI changes.
- If a security-sensitive regression is discovered, follow `SECURITY.md` and cut a new patch release rather than rewriting an existing tag.
