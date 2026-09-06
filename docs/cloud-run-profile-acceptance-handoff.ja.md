# Cloud Run profile acceptance handoff

[English](cloud-run-profile-acceptance-handoff.md) | [ロードマップ](roadmap.ja.md)

この文書は、v0.4.0のCloud Run / Human Handoff / Chrome profile durability受入試験を、別セッションから安全に再開するための現在地です。credential、account identity、cookie/token、Human入力内容、takeover内部IDは記録しません。

## Canonical working line

- repository: `git-ksk/maps-browser-mcp`
- local worktree: `/private/tmp/maps-181-183-combined`
- branch: `test/181-183-combined`
- implementation baseline: `c1d575c` — `fix(auth): require stable signed-in verification (#196)`
- `main` はこの検証ラインをまだ含まず、直近確認時点で `1230c61`。acceptanceが終わる前にmainへ混ぜない。

主要commit:

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

Do not assume the current revision/traffic is unchanged after a session boundary. Re-read Cloud Run state before making changes. Always pass `--project mcp-runtime-ksk --region us-central1` to Maps Cloud Run commands.

## What is already proven

### #195 — closed

Physical iPhone Safari acceptance passed the Linux exact-window/WSS path. The bounded cold-start settle fixed the prior exact-window startup failure. WSS could carry the Human session and reach Done without the earlier exact-window blocker.

### #196 — implementation proven, final durability acceptance still open

`c1d575c` changed post-Human verification from a single positive readiness sample to one continuous second of coarse `signed_in`. Any `signed_out` or `unknown` sample resets the streak. The verifier remains identity-free and content-free.

Regression at implementation time: 382 total / 377 pass / 0 fail / 5 skip.

Repeated physical Cloud Run runs under #196 correctly failed closed: when stable `signed_in` was not established, no new durable profile checkpoint was published. The durable pointer remained at generation `1788663068754194` during the latest runs.

## Current failing sequence

Observed sequence:

1. Agent Maps session starts `signed_out`.
2. Human-only credential-safe takeover starts on the same dedicated profile.
3. Human completes Google sign-in and Maps visibly shows a signed-in state.
4. Human presses Done.
5. Human authority is revoked.
6. Human Chrome is closed; Linux profile process quiescence is awaited.
7. 旧baselineではfresh Agent verification前にlocal stopped-profile archive→restore round-tripを実施していた。
8. Fresh Agent Chrome starts and navigates to Maps.
9. Stable readiness does not reach `signed_in`; the flow returns to Human / fails closed.
10. Durable Cloud Storage checkpoint is **not** advanced.

A deliberate acceptance run waited about 10 seconds after Maps visibly showed signed-in before pressing Done. It failed the same way. Therefore “Done was pressed too quickly” is not the primary explanation.

Increasing Cloud Run from 1 vCPU / 2 GiB to 2 vCPU / 4 GiB improved takeover responsiveness, but did not fix the auth-state transition. Resource pressure is therefore a real UX/performance factor but is not sufficient to explain the profile failure.

## Profile persistence model

The live Chrome profile is local to the Cloud Run instance, normally under `MAPS_CHROME_PROFILE_DIR` (reference default `/tmp/maps-browser-mcp/chrome-profile`). Cloud Storage is a durable **snapshot/checkpoint store**, not a filesystem mounted directly as the Chrome profile.

Expected lifecycle:

```text
published Cloud Storage snapshot
  -> restore into Cloud Run local profile
  -> Agent/Human Chrome uses local profile
  -> Human Done
  -> Human Chrome close + quiescence
  -> stage unpublished candidate snapshot
  -> unchanged local profileでfresh Agent stable signed_in verification
  -> Agent Chrome stop + quiescence
  -> exact staged candidateをcurrentへatomic promote
  -> fresh Cloud Run restore acceptance
  -> fresh Maps surface
```

Combined acceptance lineではこの境界を二相candidate方式へ置換済み。Human Chrome close/quiescence直後に同時点profileをCloud Storageへ未公開candidateとしてstageし、local profileは一切restore/置換せずfresh Agentへ渡す。stable `signed_in`成功後のみAgentを停止し、stage済みcandidateをstage時pointer generationのprecondition付きでcurrentへpromoteする。unpublished candidateはrestore fallbackにせずbounded retentionする。root 384件（379 pass / 0 fail / 5 skip）、reference OAuth gateway 48/48、build、diff checkはgreen。まだCloud Run deploy/physical acceptance前。

## Next decisive test

新immutable Cloud Run candidateへこの二相方式をdeployし、物理iPhoneで1回だけA/B/C isolationを実施する:

```text
Human Chrome signed in
  -> Done
  -> revoke Human authority
  -> graceful Human Chrome close
  -> wait for exact-profile process quiescence
  -> stage unpublished GCS candidate（current pointer不変）
  -> DO NOT local tar->restore
  -> launch fresh Agent Chrome against the unchanged profile directory
  -> classify stable signed_in / signed_out / unknown
  -> stable signed_inのみcandidate promote
  -> fresh Cloud Run revision restoreでstable signed_inを再確認
```

Interpretation:

- A=`signed_in`, fresh restore C=`signed_out`: archive/restore round-tripが主因候補。
- A=`signed_out`: GCS stage/restoreは主因ではない。Human Chrome shutdown/flush、Linux/Cloud Run restart、Google session behaviorへ絞る。
- A=`signed_in`, C=`signed_in`: candidate方式成立。current promotion + fresh-revision durability acceptance成功。

The diagnostic candidate must preserve the durable safety boundary: **do not checkpoint/publish unless fresh Agent stable `signed_in` succeeds**.

## Safety / execution rules for resumption

- Never inspect or log account identity, cookie/token contents, credentials, Human-entered text, browser/frame content, or takeover secrets.
- Never publish an unverified profile as current.
- Never automatically replay a failed/interrupted Maps action after Human takeover. Require a fresh user-directed invocation.
- Do not repeatedly make the Human redo sign-in after the same failure has reproduced; capture bounded diagnostics and isolate one variable at a time.
- Do not roll traffic back to an older tagged revision just to resume acceptance. Inspect the active revision and use an immutable image digest for new candidates.
- Keep old tagged Cloud Run revisions unless cleanup is separately reviewed.

## Open acceptance issues

- #135 — final Done/revoke/checkpoint/fresh-restore lifecycle acceptance
- #181 — managed WSS-only Cloud Run policy acceptance
- #183 — stopped Human profile staging / durability
- #189 — browser/CDP recovery after Human teardown
- #194 — resident takeover / idle scale-down behavior
- #196 — stable signed-in evidence before durable checkpoint
- #195 — closed; bounded Linux exact-window settle physically accepted

## Resume checklist

1. `git status` in `/private/tmp/maps-181-183-combined`; confirm `test/181-183-combined` contains implementation baseline `c1d575c` plus this handoff documentation.
2. Read Cloud Run latest ready revision, active traffic, CPU/memory, min/max scale and immutable image digest.
3. Confirm no active Human takeover; cancel stale takeover rather than attempting completion if ownership is unclear.
4. Confirm durable profile pointer metadata only; do not inspect snapshot contents.
5. Candidate implementation/tests are complete on the combined branch; review diff and commit/push without merging main.
6. Deploy from a new immutable digest/revision, run fresh signed-out -> Human sign-in acceptance once, and record only bounded readiness/candidate/pointer metadata.
7. If same-revision stable `signed_in` promotes the candidate, create a genuinely fresh revision from the same immutable image and require stable `signed_in` after restore.
