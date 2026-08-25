# Changelog（日本語）

[English](CHANGELOG.md) | 日本語

`maps-browser-mcp` の主要な公開Release変更履歴です。

本projectはpre-1.0です。Public APIが安定するまでは、minor / patch releaseにも互換性・安全性hardeningが含まれる場合があります。Upgrade前に各Release内容を確認してください。

## [Unreleased]

### 追加

- Credential-safe Human control向けにLinux / container normal-browser `webrtc_takeover` host pathを追加。Isolated Xvfb / Openbox / xdotool / ffmpeg runtime、exact-window / PID binding、packaged Handoff helper実行、checked-in Linux container acceptance harnessまで含みます。
- Reference Cloud Run OAuth gatewayへdeployment-onlyなstopped-profile snapshot restore / checkpointを追加し、Cloud Storageのintegrity / generation guardを維持します。
- npm + Official MCP Registryの初回公開準備としてcanonical `mcpName`、version-matched `server.json.example`、publication gate、Maps ↔ Handoff責務overviewを追加します。

### 変更

- Pin済み `mcp-execution-handoff` integrationをLinux host readiness、packaged helper launch fix、provider-owned TURN、iOS keyboard editing、persistent touch keyboard mode、bounded WebRTC diagnosticsまで更新します。
- Mapsの `webrtc_takeover` をconsumer-localな `TakeoverBroker + SpawnedWebRtcRuntimeProvider + createWebRtcLink()` compositionから、Handoff first-class `BrowserHandoffAdapter` へ移行します。Mapsが渡すのはintervention / principal、normal Chrome PID、明示的なcredential-safe input policyだけとし、WebRTC runtime composition、route ownership、exact-window / focus fencing、disconnect / reload後のcompletion-only recovery、transport teardownはHandoffが所有します。
- Reference Cloud Run pathをlocal / container Linux WebRTC evidenceからproduction physical acceptanceまで進め、Cloudflare Realtime TURN、物理iPhone Safari `Live · relay`、real Human-only Google sign-inを確認しました。明示Done/revoke -> fresh `signed_in` -> stopped-profile checkpoint -> fresh restoreは#135で別追跡し、ここでは完了claimしません。
- Managed automation browserがphysical Google sign-inで拒否されたため、legacy `hosted_cdp` はcredential / consent / challenge Human controlでfail-closedを維持します。

### 修正

- Restricted container runtime向け既存Linux unsandboxed-Chromium明示Opt-inをcredential-safe normal browserにも適用しつつ、secure defaultは変更しません。
- npm `.bin` 経由packaged Handoff helper起動、stopped-profile Cloud Storage upload semantics、iOS text / Backspace、persistent touch keyboard focus mode、container ChromiumのCJK font表示を修正します。

### Test / Documentation

- 旧Maps-local Execution Handoff V1/V2文書を歴史的protocol referenceとして明確化し、V3切り出し記録を現行first-class `BrowserHandoffAdapter` の責務モデルへ同期しました。
- Linux normal-browser WebRTC container acceptanceをrequired CIへ正式組み込みし、H.264 media、bounded tap / text / Backspace / Enter、Human textのargv除外、CJK fallback、revoke / cleanup、profile unlockまで検証します。
- 現行stable versionを変更せずv0.3.4を初回publication targetとして明文化します。v0.3.3が引き続きlatest releaseで、明示authorizeされたrelease gate完了まではpackage未公開です。

## [v0.3.3] - 2026-08-21

### 追加

- Single-user macOS向けにopt-inの `webrtc_takeover` credential-safe Human transportを追加。同じdedicated profileをnormal Chromeで開き、Handoffのcapture/inputをexact Chrome PID/windowへbindし、短命Safari locatorだけを公開します。WebRTC signaling / RTP / DataChannel、ICE/TURN、framebuffer、raw Human inputはMapsへ持ち込みません。
- EN/JAのWebRTC Human Takeoverガイドを追加。Pin済みhelper build、macOS画面収録/アクセシビリティ権限、authenticated HTTPS operator origin、direct/relay挙動、Human sign-in flow、troubleshooting、将来のhosted control-plane/private-worker topologyまで記載します。

### 変更

- `mcp-execution-handoff` を `8a8a8db7c767bb0f1a9b1d9fda1c7991281c26a2` へpin。Same-LAN direct WebRTCとcellular/4G TURN relay、exact target-window再activation、text / Backspace / scroll、Done/revoke、stale locator拒否までの物理iPhone Safari acceptanceを正式記録した版です。
- V5自体にWebRTC / Cloudflare / TURN / remote takeoverは必須でないことを明確化。最も単純なV5構成はHumanがローカルでログインしたpersistentなMaps専用Chrome profileで、credential-safe handoffは後からsign-in / re-authentication、consent、challenge対応が必要な場合だけ使うoptional機構です。
- Native `thin_takeover` はphysically acceptedなWebRTC pathの前提ではなくoptional / experimental siblingへ整理し、`external` はbackward-compatibleなfail-closed transport defaultとして維持。
- Container / Cloud Run説明を修正。現行built-in Native/WebRTC capture/input executionはmacOS worker capabilityで、hosted control-plane/private-worker topologyはupstreamの別作業として扱います。

### セキュリティ

- Fresh `signed_out` → Human-only Google sign-in → Done/revoke + stale locator拒否 → fresh Agent attach → identity-free `signed_in` → bounded authenticated V5-B readまでreal V5 sign-in recovery acceptanceを完了。Account identityやcredential/session materialは露出しません。
- Acceptance-only public proxyのoutbound destinationをloopback host/portへ固定し、incoming request pathからupstream destinationを選べない形へhardening。Accepted PR headでCodeQL zero findingsを確認しています。

## [v0.3.2] - 2026-08-19

- credential-safe transportにopt-inの `cua_takeover` を追加。normal ChromeはCDP / remote-debuggingなしのまま、既存authenticated short-lived Takeover UIを再利用し、local Cua Driver MCP bridgeをexact dedicated Chrome PID + visible window 1件へbindする。Native capture/inputは固定7 tool allowlistだけ許可し、Human入力textをnorthbound Maps MCP / model context / process argv / repository logへ返さない。Benign local pageでframe、tap、scroll、text、Enter、outer Bearer coexistence、Done capability revoke、normal-Chrome teardownまでend-to-end live validation済み。

### 追加

- V5向けにdefault OFFのcredential-safe Human sign-in ceremonyを追加。`maps_request_human_sign_in` はGoogle Account選択、credential、MFAをHuman-onlyのまま維持し、server-owned CDP Chromeを完全停止→同じdedicated profileをremote-debugging / automation attachmentなしのnormal Chromeで起動→必要なら既存OS-level remote-access製品へのoperator locatorだけを提示→Human完了後にnormal browserを閉じてidentity-free readinessをfresh再検証、というflowを提供する。External remote-access製品自体はこのrepositoryで実装せず、pre-auth semantic stateもreplayしない。

### 変更

- 現行Google Maps live UIに対してV5-C existing-list Saveをhardening。Exact place / index / list / duplicate / `aria-checked` のfresh再検証は維持しつつ、対象rowのbounded click pointを検証してsynthetic DOM clickではなくCDP pointerを1回だけdispatchし、click後はexact targetのsaved状態を再取得するためのbounded UI settleだけ許可する。Release live validationではHumanが明示的に許可したexisting list 1件へexactly one saveを実行し、fresh readで同じ非公開listが `saved=true` になったことを確認した。
- Cua browser-takeover fallbackの入力focusをhardening。最後のHuman tap位置を保持し、bounded text/key入力前にその位置へfocusを戻す。Cua takeoverは引き続きfallbackで、credential入力はHuman-only、normal Chromeがcredential-safe surfaceのprimary path。
- v0.3.2向けV5 sequential release gateをdedicated signed-in profileで再実行。Identity-free readiness、bounded save-state read、existing-listへの1回save、approval Cancel/no-send、fresh route/device re-read、approved Send-to-phone activation 1回、physical iPhone到着まで確認した。1回のapproved activationからiOS側では同一通知3件が観測されたが、MCPはautomatic retryを行っておらず、approved invocationごとのdevice-click siteも1箇所のまま。

### セキュリティ

- `mcp-execution-handoff` をcredential-safe external Human surface実装済みupstream commitへ更新し、external sessionを既存Human authority lifecycleへbind。External CDPとの併用を拒否し、operator locatorのcredential/query/fragmentを禁止、automation authority復帰前のnormal-browser session revokeを必須化する。Humanが実際にはsign-inしていない状態でContinueしても成功扱いせず、fresh verification後にHuman controlへ戻す。

## [v0.3.1] - 2026-08-18

### Documentation

- Top-level EN/JA READMEをrelease済みV5-A〜V5-D tool surfaceへ同期し、日本語版で欠落していたbounded read toolも復旧。Registered MCP toolが両READMEから欠落した場合にrepository policy testで検出する。

## [v0.3.0] - 2026-08-18

### Documentation

- pre-v1 completion sequenceを定義。v0.3.0をV5 + clean remote-auth foundation、v0.4.0をMCP Apps production portability、v0.5.0をreliability / UI-change resilience / observabilityとし、v1.0.0は未決機能の詰め込みではなくstable昇格とする。
- V5 authenticated-workflows design baselineをimplementation有効化なしで定義。Human-only sign-in、single-user/per-principal browser isolation gate、bounded saved-state read、first mutation candidateとしてexisting-listへのSave、Send to phone前のexplicit ActionApproval、Maps-history privacy gate、Timelineのdesktop Web candidate除外を明文化。
- V5-E history privacy/surface gateをhistory tool追加なしでclose。Fresh live observationでMaps HistoryはMy Activityへcrossし、Maps-local Recentはmutation-adjacentかつbounded parseに使えるstable activity row semanticを欠くことを確認。My Activityはallowlist外、Recentはobservation gate、Timelineはdesktop Web roadmap外を維持する。

### 変更

- Cloud Run headless / Interactive Assistのdeployment profileを1 vCPU / 2Gi memory / concurrency 1 / max instance 1として明文化・回帰固定。1Gi instanceのOOMがHTTP 503となり、remote側ではUNKNOWN / TaskGroup transport exceptionとして見えた実障害に対応。

- Google MapsのAccessibility tree node IDが再描画で一時失効するケースに対してbounded visible-state readをhardening。fresh full snapshotの再取得を1回だけ許可し、連続stale時はgeneric `INTERNAL_ERROR` ではなく `UI_STATE_CHANGED` でfail closeする。

- MCP Runtime Firebase authorization pageを修正し、same-origin completion requestをCSPで許可しつつHttpOnly OAuth transaction cookieを送信する。Firebase credentialは引き続きIdentity Toolkitへだけ送る。


- Reference gatewayのhuman sign-inをshared MCP Runtime identity boundaryへ移行。BrowserからFirebase Identity Toolkitへemail/passwordを直接送りgatewayはID Tokenだけを受け取る形にし、MCP間ではimmutable Firebase UIDだけを共通化する。OAuth token/state、service account、private-hop bearer secret、Firestore namespaceはMCPごとに分離する。

- Reference OAuth gatewayのrefresh lifecycleを修正し、authorization-code直後の初回refresh-token recordにもrotation後と同じsingle-user account bindingを必須保存する。Identity binding欠落は共通record builderでfail closeする。

- Reference OAuth gatewayのprivate-hop header allowlistを修正し、caller credential / cookie / forwarding headerを除去したままMCP 2026-07-28のbounded `Mcp-Method` / `Mcp-Name` control headerを保持する。

- Issue #74向けにisolatedな `reference/oauth-gateway` dogfood実装を追加。MCP 2026-07-28 shapeのOAuth/CIMD + PKCE、`maps:use` resource scope、`offline_access` refresh、reference専用OAuth state、UIDまたはverified emailのexact single-user identity gate + allowlist変更時に旧tokenを無効化するderived binding、public OAuth credentialを除去してcurrent-main coreへ送るloopback `static-bearer` private hopを実装。Remote `/takeover/*` はbrowser-session auth boundaryを別途設計するまで意図的に無効のまま。

- V5-D bounded Send to phoneを追加。`maps_read_route_send_targets` はexact selected simple routeについてcurrently visible device targetを最大6件だけ返し、email / notification settingを除外する。`maps_send_route_to_device` はreal MCP 2026-07-28 form elicitationとone-shot + expiry付き `ActionApprovalManager` を使い、approvalをprincipal + resource epoch + exact route/deviceへbindする。Fresh live read / approval / cancel compatibilityを確認後、explicitly approvedなlive sendを1回実行しtarget iOS deviceへのdeliveryを確認。初期 `aria-live` postcondition matcherはfail closeしretryしなかったため、click前baseline、duplicate announcement dedupe、click後のnew exact-device + send-semantic confirmation 1件だけをsuccessとする形へhardeningし、approved invocationごとのdevice-click siteをexact 1箇所に固定した。
- V5-C bounded existing-list Saveを追加。`maps_save_place_to_list` はfresh chooserからsigned-in readiness、exact place identity、resource epoch、list index + expected labelを再検証する。Already-savedはtoggleしないidempotent successとし、実mutationはexact `aria-checked=true` postcondition確認後だけsuccessにする。New-list creation、unsave/remove、bulk save、Saved-library traversal、account/credential露出は対象外のまま。Fresh live UI compatibilityはPASSしたが、一意にtest-purposeと判定できるexisting listが無かったためreal mutation dogfoodは意図的にBLOCKEDとした。
- V5-B bounded save-state readを追加。`maps_read_place_save_state` はrevalidate済みselected placeについてexisting list name + membershipを最大10件だけ返し、privacy/count metadataは除外する。signed-in readiness必須、list選択/new list作成なし、paginationなし、read後はchooserを閉じる。
- V5-A readinessを追加。V5 Opt-in時のみ `maps_read_authenticated_readiness` を公開し、identity-freeな `signed_in | signed_out | unknown` だけを返す。signed-out / signed-in両方を専用server-owned profileでlive確認済み。
- V5-A foundation gateを開始。default offの `MAPS_V5_AUTHENTICATED_WORKFLOWS` Opt-inを追加し、Interactive Assist、server-ownedなabsolute dedicated profile、現行single-user principal shapeを必須化。per-principal profile isolation実装前はexternal CDP / module authを拒否する。Authenticated semantic toolはこのV5 opt-in有効時だけ公開する。

- ExperimentalなMCP Apps directions Viewをhost差異に対してhardening。Stable 2026-01-26 host context、safe-area/container sizing、size notification、cancellation/error cleanup、teardown、Google推奨Embed referrer policyを反映。
- Embed API key未設定でも `maps_render_directions` をtext/structured display toolとして維持。UI resource/linkage/extension advertisementだけをconditionalにする。
- Official MCP Apps basic reference hostでUI pipeline、official MCP SDK clientでno-UI fallbackを検証。Second production hostでのreal-key render成功は未検証として明示し、UIのexperimental labelを維持。

### Security

- MCP Apps CSPを必要なGoogle nested-frame origin 1つだけに維持し、専用/restricted Embed key deploymentを文書化。Browser-control surfaceやcredential surfaceは追加しない。

## [v0.2.0] - 2026-08-15

V4の未認証Google Maps Web coverage完了と、Execution Handoff upstream consumer化をまとめたminor releaseです。

### 追加

- 現行未認証Google Maps Web scopeに対する広いV4 Maps-specific semantic coverage。boundedなplace share / nearby / photos / tabs / opening hours、search rating / viewport zoom、same-day transit time、endpoint swap、selected transit-route share、bounded autocomplete read/select、search-result share、Recommended/Best transit selectionを含みます。
- `ui://maps-browser-mcp/directions.html` を使うexperimentalなMCP Apps directions rendering。UI非対応host向けの有用なtext / structured fallbackは維持します。
- V4 capability inventoryのcanonical evidenceと、未対応・不安定surfaceに対する明示的なobservation/design gate + re-open condition。

### 変更

- 現行未認証scopeのV4をcloseoutし、high / normal priorityの未解決rowを0件にしました。
- Mapsを `mcp-execution-handoff` のfirst real adapterとして維持し、Japan Cinemaとのtwo-real-adapter validation完了後のimmutableなupstream v0.1.0 source-release commitへ同期しました。
- Manual Live Maps E2Eのrelease pathを、代表的なautocomplete / search-share / place workflow 1組と、Recommended/Bestを含むfresh simple transit workflow 1組へ更新しました。Fixed / low-volumeの原則は維持します。
- package / lockfile / MCP server metadataを `0.2.0` に同期しました。

### Safety / Compatibility

- raw browser / CDP / DOM / Accessibility Tree、generic browser action、arbitrary navigation、generic text entry、pointer primitive、clipboard dump、Maps internal API/XHR harvesting、bulk scraping、review harvestingは引き続きpublic MCP surfaceへ公開しません。
- consent / sign-in / CAPTCHA / access challengeはfail-closedなHuman Intervention境界のままです。Human完了をapprovalとみなさず、state-changing actionを自動replayしません。
- UI依存Maps operationとMCP Apps renderingは、将来のGoogle Maps / host UI変更に対する永久保証ではなくcompatibility-sensitive / experimental surfaceとして扱います。
- `mcp-execution-handoff` はsource releaseからconsumeし、このreleaseで同packageや `maps-browser-mcp` をnpm publishしません。

Validation詳細とexact release commit / live runはv0.2.0 GitHub Releaseへ記録します。

**npm:** 未公開

## [v0.1.1] - 2026-08-09

Container / headless portabilityとRelease hardeningを中心としたpatch releaseです。

### 追加

- Provider非依存のLinux container / headless実行対応
- non-root Chromium container image
- `MCP_HTTP_PORT` を優先したgeneric `PORT` fallback
- `/healthz` process liveness endpoint
- Google Mapsへ遷移せずmanaged Chromium/CDPを確認する `/readyz`
- Restricted Linux runtime向けの明示的 `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` compatibility mode
- Docker dependency監視とNode base image digest固定
- BoundedなLive Google Maps E2Eをcontainerで実行できるmanual-only path

### 変更

- Container validationをrequired Node 22 CI check内へ統合
- bearer token設定時は `/readyz` も認証必須
- package / lockfile / MCP server metadataを `0.1.1` に同期
- 日英container / release documentationを拡充

### Safety / Validation

- Chromium sandboxはdefault有効のまま。`--no-sandbox` へのsilent downgradeなし
- Restricted runtimeではfail closedを検証
- CAPTCHA / anti-bot bypassを追加せず `HUMAN_INTERVENTION_REQUIRED` 境界testを強化
- Release commitでNode 20/22/24 CI、macOS browser smoke、Windows browser smoke、container smoke、CodeQLがPASS
- Release commit `27ab7c82e13f19730bb765b5bd6f2dd76c92ba89` でManual Container + Live Google Maps E2EがPASS
- Live workflow artifactは0件

GitHub Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.1

Live validation run: https://github.com/git-ksk/maps-browser-mcp/actions/runs/31310463642

**npm:** 未公開

## [v0.1.0] - 2026-08-09

初回Public Releaseです。

### 追加

- Search / directions / map display / Street View / semantic selection / travel-mode変更 / bounded visible-state readingを行うMaps専用MCP tool 9種類
- stdio / Streamable HTTP transports
- 専用Chrome / Chromium profile isolationとlocal CDP boundary
- Google Maps-only navigation policy
- `untrustedExternalText: true` を付与するbounded V3 place / route summary
- `index + expectedLabel` guardと `UI_STATE_CHANGED` stale-state rejection
- consent / sign-in / CAPTCHA / challenge向けhuman-intervention boundary
- bounded queue、operation watchdog、guarded external CDP、rate/read safety limit
- 英語・日本語documentation

### Validation

- Node 20/22/24 CI、macOS / Windows browser smoke、CodeQLがPASS
- Apple Silicon macOSでuser-directed Live Google Maps E2EがPASS

GitHub Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.0

**npm:** 未公開

## Versioning方針

- GitHub ReleasesをPublic Releaseの正本として扱う
- `main` は最新tagより先行した未Release変更を含む場合がある
- 再現可能な安定版利用では `main` ではなくRelease tagを使う
- 公開済みtagを書き換えず、security-sensitive fixは新しいpatch releaseとして出す
