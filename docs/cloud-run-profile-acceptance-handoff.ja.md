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

Combined acceptance lineではこの境界を二相candidate方式へ置換済み。Human Chrome close/quiescence直後に同時点profileをCloud Storageへ未公開candidateとしてstageし、local profileは一切restore/置換せずfresh Agentへ渡す。stable `signed_in`成功後のみAgentを停止し、stage済みcandidateをstage時pointer generationのprecondition付きでcurrentへpromoteする。unpublished candidateはrestore fallbackにせずbounded retentionする。root 384件（379 pass / 0 fail / 5 skip）、reference OAuth gateway 48/48、build、diff checkはgreen。Cloud Run deployと物理A/B isolationまで実施済みで、結果は下記のとおり。

## 2026-09-06 physical A/B result

新immutable candidate上で物理iPhoneのHuman sign-inを再実施し、Human側ではMapsへのログイン完了後にDoneまで到達した。Done後の二相candidateフローでは、stopped-profile candidateのstage自体は成功したが、同じlocal profile directoryを使うfresh Agent A判定は `signed_out` だった。

- A: `signed_out`
- B: unpublished candidate stage成功
- candidate object generation: `1788676961530905`
- candidate size: `34172641` bytes
- current pointer generation: `1788663068754194` のまま
- promotion: 実施されず
- C: Aが失敗したため未実施

この結果により、archive/restore round-tripやGCS restoreは今回のA失敗の主因ではない。candidate方式の安全境界は期待どおり機能し、fresh Agentでstable `signed_in` を得られなかったprofileはcurrentへ公開されなかった。次の切り分けはHuman Chromeのgraceful shutdown/flush境界、同一profileをfresh Chromeで再起動した際のsession materialization、Linux/Cloud Run固有のChrome profile behaviorへ絞る。

一時的にtakeover画面の更新停止も見えたが、利用端末側の電波状況によるものと確認できたため、本acceptanceではWSS regression evidenceとして扱わない。

## 2026-09-06 fact matrix before the next Human trial

次のHuman sign-inを行う前に、これまでの実測を以下で固定する。

### 確定事実

- Macローカルでは同系統のprofile再利用が成立した一方、Cloud Run combined acceptanceではHuman側ログイン完了/Done後のfresh Agent Aが複数回 `signed_out` になった。
- Human Chrome stop後のunpublished candidate stageは成功しており、archive structure / bounded SQLite `quick_check` / GCS upload metadata verificationは通っている。
- AはGCS restoreを一度も行わず、**同じCloud Run instance内の変更していないlocal profile directory**をfresh Agentが開いた時点で失敗した。したがってGCS restore round-tripはA失敗より後段であり、主因候補から外れる。
- `current.json` pointerはA失敗時に進まず、未検証candidateはcurrentへpromoteされていない。fail-closed境界は期待どおり。
- fresh Agentをheadedで動かしてもA=`signed_out`だったため、headed → headless切替は主因候補から外れる。
- Human Chromeのgraceful close待機を2秒から10秒へ延長しても、10秒後にSIGTERM escalationが再現した。
- Human Chromeへ `--disable-background-mode` を追加しても、10秒後のSIGTERM escalationとA=`signed_out`が再現した。background mode単独原因説は弱い。
- takeover画面更新停止の一件は利用端末側の電波状況によるものと確認済みで、今回のprofile durability原因として扱わない。

### まだ未確定

- `xdotool windowclose` が正常に受理された後、exact X11 windowが500ms/10s時点で実際に消えているか。
- windowが消えているのにbrowser root processだけが残るのか、window自体が残っているのか。
- 10秒待機中にChromiumのdescendant/process-role構成がどう変化しているか。
- Human Chrome close前後でprofile core metadata、Cookie DB file metadata、WAL/SHM sidecar、Singleton lockがどう変化するか。
- SIGTERM後にNode `ChildProcess` が `exitCode` と `signalCode` のどちらで終了を表しているか。現行制御は既存挙動を変えず、診断では両方を区別する。
- candidate stage直後のfresh Agentで、readinessが `unknown → signed_out` なのか、最初から継続して `signed_out` なのか、途中にtransient `signed_in` が出るのか。
- Aが成功した場合のAgent clean stop → candidate promotion → fresh Cloud Run Cは未実施。

## One-shot comprehensive diagnostic gate

次回は場当たり的な追加診断をせず、以下の全境界を1回で取得してから判断する。診断はすべてcontent-freeで、PID/window ID/profile path/account identity/cookie値/token/credential/Human入力/browser contentは記録しない。

1. **Pre-Human profile baseline**
   - core profile file presence/aggregate bytes
   - Cookie DB file presence/aggregate bytes
   - Cookie WAL/SHM sidecar presence/aggregate bytes
   - Singleton lock count
2. **Human Chrome startup / exact-window bind**
   - normal Chrome start success
   - `--disable-background-mode` enabled fact
   - profile-bound process count
   - descendant count + bounded role counts (`renderer/gpu/utility/zygote/other`)
   - exact X11 window bound success
3. **Done/revoke → graceful close**
   - `windowclose` accepted yes/no
   - 500ms sample: exact-window state (`owned|missing|reowned|unavailable`), process summary, profile metadata
   - 10s sample: same fields before any signal escalation
4. **Signal escalation**
   - whether SIGTERM was sent
   - 2s post-SIGTERM: root state (`running|exited_code|exited_signal`), process summary, profile metadata
   - whether SIGKILL was sent under the current existing control semantics
   - 1s post-SIGKILL equivalent sample
5. **Exact-profile quiescence**
   - no profile-bound Chromium process remaining
   - post-quiescence profile metadata + lock count
6. **Candidate stage**
   - archive bytes
   - archive entry count
   - required-profile-file count
   - bounded SQLite check count
   - base durable pointer generation
   - current pointer remains unchanged until verification
7. **Fresh Agent A**
   - fresh CDP start/ready boundary
   - readiness state-transition sequence only (`signed_in|signed_out|unknown`)
   - final elapsed time, sample counts, transition count
8. **Only if A=`signed_in`**
   - Agent checkpoint stop boundary
   - exact candidate promotion
   - then fresh revision C restore acceptance

### One-run interpretation matrix

- `windowclose accepted=false` → X11 exact-window close request pathが第一原因候補。
- `accepted=true` かつ10秒後も `windowState=owned` → X11/Openbox/Chromium window shutdown pathを第一候補。
- `windowState=missing` かつroot/processがrunning → Chromium internal keepalive/process-lifecycleを第一候補。
- SIGTERM後 `rootState=exited_signal` なのに現行制御がさらにSIGKILLへ進む → Node `exitCode` / `signalCode` 判定バグを独立fix対象として確定。
- post-quiescence profile metadataがHuman開始前から変化していない → Human session materialization/flushがprofileへ反映されていない可能性が高い。
- profile metadataが明確に更新済みでA=`signed_out` → fresh Agent再起動時のLinux Chromium session materialization / cookie decryption / profile compatibility側へ絞る。
- A=`signed_in` → shutdown/profile materialization境界は突破。candidate promotion後にCへ進む。

次のHuman操作は、この診断入りimmutable Cloud Run revisionがReadyかつtraffic/config差分確認済みになるまで実施しない。

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
