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
7. Before fresh Agent verification, `prepareProfileForFreshAgentVerification()` performs a **local stopped-profile archive/restore round-trip** against the same profile directory.
8. Fresh Agent Chrome starts and navigates to Maps.
9. Stable readiness does not reach `signed_in`; the flow returns to Human / fails closed.
10. The durable Cloud Storage checkpoint does **not** advance.

A deliberate physical run waited about 10 seconds after the Maps surface visibly showed signed-in before Done and failed identically. An early Done is therefore not the primary explanation.

Raising Cloud Run from 1 vCPU / 2 GiB to 2 vCPU / 4 GiB materially improved takeover responsiveness but did not fix the authentication-state transition. Resource pressure is a real performance factor, not a sufficient root cause.

## Profile persistence model

The live Chrome profile is local to the Cloud Run instance under `MAPS_CHROME_PROFILE_DIR` (reference default `/tmp/maps-browser-mcp/chrome-profile`). Cloud Storage is a durable snapshot/checkpoint store, not the directly mounted live profile filesystem.

Expected lifecycle:

```text
Cloud Storage snapshot
  -> restore into Cloud Run local profile
  -> Agent/Human Chrome uses local profile
  -> Human Done
  -> Human Chrome close + quiescence
  -> fresh Agent signed_in verification
  -> Agent Chrome stop
  -> durable Cloud Storage checkpoint
  -> fresh Maps surface
```

The current implementation additionally performs a local tar->restore preparation step between Human close and fresh Agent verification. This is the highest-value unisolated boundary.

## Next decisive test

Build a narrow diagnostic candidate that changes only the pre-verification preparation boundary:

```text
Human Chrome signed in
  -> Done
  -> revoke Human authority
  -> graceful Human Chrome close
  -> wait for exact-profile process quiescence
  -> DO NOT local tar->restore here
  -> launch fresh Agent Chrome against the unchanged profile directory
  -> classify stable signed_in / signed_out / unknown
```

Interpretation:

- `signed_in`: isolate the defect to the pre-verification archive/restore round-trip or its interaction with Cloud Run local filesystem semantics.
- `signed_out`: archive/restore is not needed to reproduce; investigate Human Chrome shutdown/flush behavior, Linux/Cloud Run Chrome startup differences, or Google session behavior across the Human->Agent process restart.

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
5. Implement the one-variable “skip local pre-verification tar->restore” diagnostic candidate with tests.
6. Deploy a new revision, run one fresh signed-out -> Human sign-in acceptance, and record only coarse readiness plus pointer generation.
7. If same-revision stable `signed_in` succeeds, only then test a genuinely fresh Cloud Run revision restoring the newly published checkpoint.
