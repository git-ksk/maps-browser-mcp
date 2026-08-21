# Release checklist

Use this checklist for pre-1.0 releases. The goal is to keep code, MCP metadata, package contents, browser compatibility, container portability, and GitHub security controls aligned.

## 1. Prepare the release branch

- Start from current `main`.
- Keep the change set focused.
- Update documentation for any user-visible behavior or configuration changes.
- Do not weaken the Maps-only navigation boundary, V3 bounds, challenge handling, or single-user/session assumptions without an explicit security/design review.

## 2. Version consistency

Update `package.json` to the intended version and regenerate `package-lock.json` with the same npm major used by the project when release metadata changes.

The repository policy test requires the MCP server version in `src/server.ts` to match `package.json`.

Run:

```bash
npm run check
```

Before tagging, also verify the root package metadata in `package-lock.json` matches the intended version. Do not create a tag whose version disagrees with package/server metadata.

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

Container/headless validation intentionally runs inside the existing required `check (22)` job. A container regression must therefore fail a required check rather than an optional standalone job.

The CodeQL workflow is expected to require zero findings for its configured analysis.

Do not bypass required checks or force-push `main` to ship a release.

## 5. Container/headless verification

For releases that change browser startup, HTTP transport, configuration, Dockerfile, or container documentation, confirm the required Node 22 job passes all container stages:

- image build and runtime version reporting
- default Chromium sandbox remains enabled
- sandbox-capable Chrome/CDP smoke
- restricted-runtime fail-closed behavior without silent sandbox downgrade
- explicit `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` compatibility smoke
- generic `PORT` fallback
- `/healthz` process liveness
- `/readyz` managed Chromium/CDP readiness without Google Maps navigation

The Node base image should remain digest-pinned and Docker dependencies should remain covered by Dependabot. Chromium package updates should not be frozen indefinitely merely for byte-for-byte image reproduction; record the actual browser version in CI instead.

## 6. Manual live Google Maps compatibility

Normal push/PR CI does not visit Google Maps.

Before a release that changes any of these areas, run **Live Maps E2E (manual)** from GitHub Actions:

- Maps URL compilation,
- semantic place candidate extraction/selection,
- semantic route candidate extraction/selection,
- V3 visible-state reading,
- browser challenge/navigation safety logic,
- Chrome/CDP behavior that could affect the live page.

The workflow is deliberately `workflow_dispatch`-only and low-volume. Choose `host` for the normal runner path. If the release materially changes the Dockerfile, headless Chromium startup, container profile/filesystem behavior, or container-specific Chrome flags, choose `container` so the same bounded live script runs inside the built image with Chromium sandboxing enabled. Do not run both modes without a concrete compatibility reason.

Expected representative live path for a V4-wide release:

```text
bounded autocomplete read
  -> guarded suggestion selection
  -> one search result + bounded search-share link
  -> bounded place read/select + one representative place workflow
  -> fresh simple transit directions
  -> Recommended/Best semantic selection
  -> bounded route read
  -> index + expectedLabel route selection
```

Keep this fixed and low-volume. Do not expand it into capability-by-capability crawling merely because more V4 tools exist.

Record pass/fail and the selected runtime only. Do not add screenshots, DOM dumps, cookies, browser profiles, reviews, or location-result artifacts to the repository.

Do not deliberately trigger or attempt to bypass CAPTCHA, consent, sign-in, or access challenges. The deterministic test suite covers fail-closed `HUMAN_INTERVENTION_REQUIRED` boundaries; live challenge handling is rechecked opportunistically only when such a screen occurs naturally.

For documentation-only or obviously non-runtime changes, a new live Maps run is normally unnecessary unless the live compatibility baseline is already in doubt.

## 6.1. Impact-based V5 live release gate for v0.3.2+

Use the live V5 gate according to the release impact. Do not repeat an account mutation or device send merely because an unrelated credential-handoff transport changed.

The canonical slices remain:

1. **V5-A readiness:** fresh Maps surface, identity-free `signed_in` only. Never record account identity.
2. **V5-B save-state read:** one public place, bounded existing-list membership read, no private list labels in public logs.
3. **V5-C existing-list Save:** require one exact safe target. A clearly test-purpose list is preferred; a Human may explicitly authorize one existing list instead. Perform exactly one save activation, never create/delete/unsave, and require a fresh read confirming the same hidden target as `saved=true`.
4. **V5-D Cancel:** fresh simple route + bounded device read, request explicit approval, Cancel once, and verify no send action.
5. **V5-D approved send:** reacquire route/device state from scratch, obtain a new exact Human approval, activate the exact device once, never automatically retry after ambiguous postcondition, and ask the Human to confirm physical arrival.

Run the **full A -> D sequence** when the release changes V5-C/V5-D mutation code, action-approval semantics, save-list/route/device extraction or postconditions, mutation dispatch, or shared runtime/state logic that can change those actions.

For a **credential-safe handoff-only or pre-auth transport change**, rerun the live path through fresh automation recovery and at least V5-A + V5-B. Prior V5-C/V5-D evidence may be reused only when all of the following are recorded in `docs/manual-e2e.md` for the release:

- the exact prior release/evidence being reused;
- the V5-C/V5-D and action-approval implementation files are unchanged from that evidence baseline;
- any shared runtime changes are reviewed as non-mutation mechanics and the deterministic C/D tests still pass;
- the changed handoff path reaches fresh `signed_in` and a bounded V5-B read after revoke/re-attach;
- no release claim implies that a skipped mutation/send was newly re-executed.

This reuse rule deliberately minimizes unnecessary account mutations and device sends while keeping live coverage on the changed boundary. If impact is ambiguous, use the full sequence.

If one approved MCP activation results in duplicated downstream platform notifications, record the observation separately. The release gate must distinguish agent/MCP replay from downstream delivery duplication and must not issue an investigative re-send without a new Human approval.

## 7. Security/repository settings

Before the first public release and periodically afterward, confirm:

- `main` remains protected,
- required status checks remain configured,
- container validation still executes inside the required `check (22)` job,
- admin enforcement remains enabled,
- force pushes and branch deletion remain disabled,
- linear history remains required,
- conversation resolution remains required,
- Private vulnerability reporting remains enabled,
- Dependabot configuration covers npm, GitHub Actions, and Docker,
- GitHub Actions dependencies remain pinned to full commit SHAs.

Repository tests enforce the workflow pinning/manual-live/container-gating invariants that can be represented in source. GitHub-hosted repository settings still need periodic verification outside the codebase.

## 8. Documentation review

Confirm the following still match the release:

- `README.md`
- `README.ja.md`
- `.env.example`
- `docs/getting-started.md`
- `docs/container.md`
- `docs/troubleshooting.md`
- `docs/chatgpt.md`
- `docs/architecture.md`
- `docs/compliance.md`
- `docs/manual-e2e.md`
- `SECURITY.md`
- `CONTRIBUTING.md`

In particular, verify defaults, tool names, environment variables, health/readiness behavior, error/recovery guidance, and plan/client-specific statements that may become stale.

## 9. Merge and tag

Merge through the protected `main` branch after all required checks pass.

For version `<version>`, the tag should be:

```text
v<version>
```

Create the tag from the exact tested `main` commit, not from an earlier PR head.

## 10. GitHub Release notes

Release notes should include:

- what the project does,
- status of V1/V2/V3/V4,
- notable safety boundaries,
- supported Node versions,
- Chrome/Chromium requirement,
- whether live Maps E2E passed for the release and which runtime (`host` or `container`) was used,
- known experimental/compatibility limitations,
- install/run instructions or a link to Getting Started.

Do not describe V3 as guaranteed compatible with future Google Maps UI versions.

## 11. npm publication, if/when enabled

Do not imply npm availability in README until the package has actually been published and the package ownership/provenance setup is verified.

Before publishing:

```bash
npm pack --dry-run
```

Prefer provenance/2FA-capable publishing practices supported by the registry at release time. Treat the npm account/package namespace as a separate supply-chain security boundary.

After publication, install the published artifact in a clean environment and run at least the non-live smoke path before advertising it as the recommended installation method.

## 12. Post-release

- Verify the GitHub tag/release points to the intended commit.
- Verify `main` CI remains green.
- Check Dependabot/CodeQL/security alerts.
- Keep the manual live E2E available for future Google Maps UI changes.
- If a security-sensitive regression is discovered, follow `SECURITY.md` and cut a new patch release rather than rewriting an existing tag.
