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

The combined acceptance line now replaces that boundary with a two-phase candidate lifecycle: stage one unpublished Cloud Storage candidate immediately after Human Chrome stop/quiescence, leave the local profile untouched, verify fresh Agent stable `signed_in` against that same directory, then stop Agent Chrome and promote the exact staged candidate using the pointer generation captured at staging. Unpublished candidates are bounded and never restore fallbacks. Root 384 tests (379 pass / 0 fail / 5 skip), reference OAuth gateway 48/48, build, and diff check are green. Cloud Run deployment and physical A/B isolation have now been run; the result is recorded below.

## 2026-09-06 physical A/B result

A fresh physical-iPhone Human sign-in was completed on the immutable candidate through Done. In the two-phase candidate flow, staging the stopped-profile candidate succeeded, but fresh Agent verification A against the unchanged local profile directory classified the session as `signed_out`.

- A: `signed_out`
- B: unpublished candidate staged successfully
- candidate object generation: `1788676961530905`
- candidate size: `34172641` bytes
- current pointer generation: unchanged at `1788663068754194`
- promotion: not performed
- C: not run because A failed

This isolates the failure ahead of any archive/restore or GCS restore step. The candidate safety boundary behaved correctly: a profile that did not regain stable `signed_in` under a fresh Agent was not published as current. The next isolation target is Human Chrome graceful shutdown/flush, session materialization when reopening the exact same profile with a fresh Chrome process, and Linux/Cloud Run-specific Chrome profile behavior.

A transient takeover refresh problem was also observed, but the operator confirmed poor client network conditions; it is therefore not counted as WSS regression evidence in this acceptance result.

## 2026-09-06 fact matrix before the next Human trial

Freeze the observed evidence before asking the Human to sign in again.

### Confirmed facts

- The equivalent profile-reuse path works on the Mac-side acceptance, while Cloud Run combined acceptance has repeatedly classified fresh Agent A as `signed_out` after the Human completed Google Maps sign-in and Done.
- Unpublished candidate staging succeeds after Human Chrome stop; archive structure, bounded SQLite `quick_check`, and GCS upload metadata verification pass.
- A fails before any GCS restore: fresh Agent opens the unchanged local profile directory in the same Cloud Run instance. GCS restore round-trip is therefore downstream of the observed A failure.
- `current.json` never advances when A fails, and the unverified candidate is not promoted.
- Running fresh Agent headed did not change A, so headed-to-headless switching is not the primary suspect.
- Extending graceful close from 2s to 10s still resulted in SIGTERM escalation.
- Adding `--disable-background-mode` to Human Chrome still resulted in the same 10s SIGTERM escalation and A=`signed_out`, weakening the background-mode-only hypothesis.
- The previously observed takeover refresh stall was confirmed as poor client network conditions and is not treated as profile-durability evidence.

### Still unknown

- Whether `xdotool windowclose` is accepted and whether the exact X11 window is actually gone at 500ms and 10s.
- Whether the window disappears while the browser root process remains alive, or whether the window itself remains.
- How the bounded Chromium descendant/process-role shape changes during the 10s graceful-close interval.
- How core profile metadata, Cookie DB file metadata, WAL/SHM sidecars, and Singleton locks change before/after Human Chrome close.
- Whether post-SIGTERM Node `ChildProcess` termination is represented by `exitCode` or `signalCode`. The next diagnostic build preserves existing control behavior while observing both.
- The exact fresh-Agent readiness transition sequence, including whether any transient `signed_in` sample occurs.
- Agent clean stop, candidate promotion, and fresh Cloud Run C remain untested because A has not succeeded.

## One-shot comprehensive diagnostic gate

Do not add more ad-hoc probes after the next Human run. The next immutable candidate must capture all of these content-free boundaries in one pass. No PID/window id/profile path/account identity/cookie value/token/credential/Human input/browser content is logged.

1. Pre-Human profile baseline: bounded profile/file metadata, Cookie DB/WAL/SHM presence and aggregate bytes, Singleton lock count.
2. Human Chrome startup and exact-window bind: start success, background-mode-disabled fact, bounded process/role counts, exact-window bind success.
3. Done/revoke to graceful close: `windowclose` acceptance plus 500ms and 10s window/process/profile samples.
4. Signal escalation: whether SIGTERM/SIGKILL were sent and bounded post-signal root/process/profile states.
5. Exact-profile quiescence: no profile-bound Chromium process plus post-quiescence metadata/lock count.
6. Candidate stage: archive bytes/entries, required-profile-file count, SQLite check count, base pointer generation, with current unchanged until verification.
7. Fresh Agent A: fresh CDP start/ready plus only coarse readiness state transitions and bounded final sample counts/timing.
8. Only after stable A=`signed_in`: Agent checkpoint stop, exact candidate promotion, then fresh-revision C.

### One-run interpretation matrix

- `windowclose accepted=false`: isolate the exact X11 close-request path.
- accepted=true but `windowState=owned` at 10s: isolate X11/Openbox/Chromium window shutdown.
- `windowState=missing` while root/process remains running: isolate Chromium internal keepalive/process lifecycle.
- SIGTERM yields `rootState=exited_signal` while current control still proceeds toward SIGKILL: confirm a separate Node `exitCode`/`signalCode` decision bug.
- Post-quiescence profile metadata unchanged from pre-Human: suspect Human-session materialization/flush never reached durable profile files.
- Profile metadata changed but A remains `signed_out`: narrow to fresh-process Linux Chromium session materialization, cookie decryption, or profile compatibility.
- A=`signed_in`: shutdown/materialization boundary passes; promote the exact candidate and run C.

Do not request another Human sign-in until this diagnostic build is deployed as an immutable Ready Cloud Run revision and its runtime shape is confirmed unchanged.

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
