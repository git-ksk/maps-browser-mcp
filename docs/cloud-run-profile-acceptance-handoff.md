# Cloud Run profile acceptance handoff

[日本語](cloud-run-profile-acceptance-handoff.ja.md) | [Roadmap](roadmap.md)

This document records the current v0.4.0 Cloud Run / Human Handoff / Chrome profile durability acceptance state so a later session can resume safely. Do not record credentials, account identity, cookie/token contents, Human input, or takeover-internal identifiers here.

## Canonical working line

- repository: `git-ksk/maps-browser-mcp`
- local worktree: `/private/tmp/maps-181-183-combined`
- branch: `test/181-183-combined`
- implementation baseline: `c1d575c` — `fix(auth): require stable signed-in verification (#196)`
- `main` does not yet contain this acceptance line; it was at `1230c61` when this handoff was written. Do not mix the line into main before acceptance is complete.

Key commits:

- `1e1e301` — #195 bounded Linux exact-window settle
- `4bd3528` — #189 browser startup / operation watchdog ordering
- `ec25861` — #194 Cloud Run resident takeover (`minScale=1`)
- `d6fa50f` / `eb51de7` — #183 stopped-profile checkpoint / fresh Maps reconstruction
- `c1d575c` — #196 stable signed-in verification

## Current Cloud Run acceptance environment

- project: `mcp-runtime-ksk`
- region: `us-central1`
- immutable image digest: `sha256:e6aebad5fc33e2eaebb25fd528c8e441c7e52aa5af8d8b4d6c43ea80ab93117e`
- active resource candidate: `maps-browser-mcp-cpu2mem4`
- traffic: 100% to the 2 vCPU / 4 GiB candidate at the last acceptance run
- service invariants: `concurrency=1`, `maxScale=1`, `minScale=1`
- operator observation: 2 vCPU / 4 GiB is noticeably smoother than 1 vCPU / 2 GiB

Do not assume revision/traffic state survives a session boundary. Re-read Cloud Run before any change. Always pass `--project mcp-runtime-ksk --region us-central1` to Maps Cloud Run commands.

## Proven state

### #195 — closed

Physical iPhone Safari acceptance passed the Linux exact-window/WSS path after the bounded cold-start settle change. The earlier exact-window startup blocker is no longer the active issue.

### #196 — implementation proven, final durability acceptance open

`c1d575c` requires one continuous second of coarse `signed_in` after Human completion. `signed_out` or `unknown` resets the streak. The verifier remains identity-free and content-free.

Implementation regression: 382 total / 377 pass / 0 fail / 5 skip.

Repeated physical Cloud Run runs under #196 correctly failed closed: no durable profile checkpoint was published when stable `signed_in` could not be established. The durable pointer remained at generation `1788663068754194` during the latest runs.

## Current failing sequence

1. Agent Maps starts `signed_out`.
2. Human-only credential-safe takeover starts against the same dedicated profile.
3. Human completes Google sign-in and Maps visibly appears signed in.
4. Human presses Done.
5. Human authority is revoked.
6. Human Chrome closes and exact-profile Linux process quiescence is awaited.
7. The prior baseline performed a local stopped-profile archive/restore round-trip before fresh Agent verification.
8. Fresh Agent Chrome starts and navigates to Maps.
9. Stable readiness does not reach `signed_in`; the flow returns to Human / fails closed.
10. The durable Cloud Storage checkpoint does **not** advance.

A deliberate physical run waited about 10 seconds after the Maps surface visibly showed signed-in before Done and failed identically. An early Done is therefore not the primary explanation.

Raising Cloud Run from 1 vCPU / 2 GiB to 2 vCPU / 4 GiB materially improved takeover responsiveness but did not fix the authentication-state transition. Resource pressure is a real performance factor, not a sufficient root cause.

## Profile persistence model

The live Chrome profile is local to the Cloud Run instance under `MAPS_CHROME_PROFILE_DIR` (reference default `/tmp/maps-browser-mcp/chrome-profile`). Cloud Storage is a durable snapshot/checkpoint store, not the directly mounted live profile filesystem.

Expected lifecycle:

```text
published Cloud Storage snapshot
  -> restore into Cloud Run local profile
  -> Agent/Human Chrome uses local profile
  -> Human Done
  -> Human Chrome close + quiescence
  -> stage unpublished candidate snapshot
  -> fresh Agent stable signed_in against unchanged local profile
  -> Agent Chrome stop + quiescence
  -> atomically promote the exact staged candidate to current
  -> fresh Cloud Run restore acceptance
  -> fresh Maps surface
```

The combined acceptance line now replaces that boundary with a two-phase candidate lifecycle: stage one unpublished Cloud Storage candidate immediately after Human Chrome stop/quiescence, leave the local profile untouched, verify fresh Agent stable `signed_in` against that same directory, then stop Agent Chrome and promote the exact staged candidate using the pointer generation captured at staging. Unpublished candidates are bounded and never restore fallbacks. Root 384 tests (379 pass / 0 fail / 5 skip), reference OAuth gateway 48/48, build, and diff check are green; Cloud Run deployment/physical acceptance is still pending.

## Next decisive test

Deploy this two-phase implementation as a new immutable Cloud Run candidate and run one physical iPhone A/B/C isolation:

```text
Human Chrome signed in
  -> Done
  -> revoke Human authority
  -> graceful Human Chrome close
  -> wait for exact-profile process quiescence
  -> stage unpublished GCS candidate (current pointer unchanged)
  -> DO NOT local tar->restore
  -> launch fresh Agent Chrome against the unchanged profile directory
  -> classify stable signed_in / signed_out / unknown
  -> promote only on stable signed_in
  -> verify stable signed_in after a genuinely fresh Cloud Run restore
```

Interpretation:

- A=`signed_in`, C=`signed_out`: archive/restore remains the primary suspect.
- A=`signed_out`: GCS staging/restore is not the primary cause; focus on Human Chrome shutdown/flush, Linux/Cloud Run restart behavior, or Google session behavior.
- A=`signed_in`, C=`signed_in`: the candidate lifecycle is accepted; current promotion plus fresh-revision durability succeeds.
The diagnostic must preserve the durable safety boundary: **never checkpoint/publish unless fresh Agent stable `signed_in` succeeds**.

## Safety / execution rules

- Never inspect or log account identity, cookie/token contents, credentials, Human-entered text, browser/frame content, or takeover secrets.
- Never publish an unverified profile as current.
- Never auto-replay a failed/interrupted Maps action after Human takeover; require a fresh user-directed invocation.
- Do not repeatedly ask the Human to redo sign-in after the same failure has reproduced; capture bounded diagnostics and isolate one variable at a time.
- Do not roll traffic back to an older tagged revision just to resume acceptance. Inspect active state and create new candidates from immutable image digests.
- Keep old tagged Cloud Run revisions unless cleanup is separately reviewed.

## Open acceptance issues

- #135 — final Done/revoke/checkpoint/fresh-restore lifecycle acceptance
- #181 — managed WSS-only Cloud Run policy acceptance
- #183 — stopped Human profile staging/durability
- #189 — browser/CDP recovery after Human teardown
- #194 — resident takeover / idle scale-down behavior
- #196 — stable signed-in evidence before durable checkpoint
- #195 — closed; bounded Linux exact-window settle physically accepted

## Resume checklist

1. Run `git status` in `/private/tmp/maps-181-183-combined`; confirm `test/181-183-combined` contains implementation baseline `c1d575c` plus this handoff documentation.
2. Read Cloud Run latest ready revision, active traffic, CPU/memory, min/max scale, and immutable image digest.
3. Confirm no active Human takeover; cancel a stale takeover instead of completing it if ownership is unclear.
4. Read durable profile pointer metadata only; do not inspect snapshot contents.
5. Candidate implementation/tests are complete on the combined branch; review, commit, and push without merging main.
6. Deploy a new immutable digest/revision, run fresh signed-out -> Human sign-in acceptance once, and record only bounded readiness/candidate/pointer metadata.
7. If same-revision stable `signed_in` promotes the candidate, create a genuinely fresh revision from the same immutable image and require stable `signed_in` after restore.
