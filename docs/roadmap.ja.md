# ロードマップ

[English](roadmap.md) | [日本語ドキュメント](README.ja.md) | [V4 capability inventory](maps-web-capability-inventory.ja.md)

このロードマップは `maps-browser-mcp` の今後の方向性を記録するものです。すべての項目を実装すると約束するものではありません。今後も小さくuser-directedなworkflowを優先します。render済みGoogle Maps Web体験そのものが不要な場合はsupported structured interfaceを優先しますが、公式interfaceとの重複はbrowser scopeから自動除外する理由ではなく、優先順位を下げる要因として扱います。

## 現在のベースライン

現在の安定source releaseは **v0.3.3** です。Product baselineには、V4未ログインsemantic coverageのcloseout、V5-A〜V5-Dのbounded authenticated workflow、さらにdedicated profileが未ログイン/再認証になった時だけ使うoptionalなcredential-safe Human Handoffまで含まれます。

`main` は現在 **v0.4.0 release train** に入り、Cloud Run向けのfirst-class managed WebSocket fallback、bounded operator diagnostics、iPhone Safari keyboard/focus診断、stopped-profile durabilityなど、v0.3.3以降のHandoff/production hardeningを取り込んでいます。これらはまだstable releaseではなく、physical acceptanceとdistribution gateを通過してからv0.4.0としてまとめます。

V5に **WebRTC / Cloudflare / TURN / remote takeover製品は必須ではありません**。最も単純な構成は、HumanがローカルでログインしたpersistentなMaps専用Chrome profileです。WebRTC Handoffはcredential ceremony / recoveryのoptional transportであり、authenticated Maps toolの前提条件ではありません。

現在のserverは、意図的に2つの利用モードを分離しています。

- **Navigation-only** — render済みMaps contentを読まず、Google Mapsのsearch / directions / map / Street View surfaceを開く
- **Interactive Assist** — active route / place UIの小さなbounded summaryをOpt-inで読み、current-state / identity validation付きのMaps-specific semantic interactionを行う

既存browser pathは今後もboundedに保ち、bulk collection、crawling、review harvesting、Maps由来persistent datasetを目的にしません。詳細は [利用モードとユースケース](use-cases.ja.md) と [Compliance / Safety](compliance.ja.md) を参照してください。

## V4 — 未ログインGoogle Maps Webの広範なsemantic coverage

V4は次の位置づけです。

> **V4 = broad semantic coverage of major Google Maps Web capabilities available without authentication**
>
> 認証なしで利用できる主要なGoogle Maps Web capabilityを、Maps-specificなsemantic MCP operationとして広くカバーする。

機能単位のscope / coverage正本は [Google Maps Web Capability Inventory](maps-web-capability-inventory.ja.md) です。

**V4-F coverage closeoutは2026-08-15に完了済みです。** 現行未認証scopeのhigh/normal priority rowは、実装済み・既存semantic operationでstructurally covered・または明示的な再開条件付きobservation/design-gatedのいずれかへ確定しました。UI依存operationは今後もpermanent selector保証ではなくexperimental compatibility surfaceとして扱います。

優先順位:

1. browser-native / UI-dependentなGoogle Maps Web capability
2. browser workflow完結に必要なsearch / directions / place operation
3. 公式structured interfaceと価値がほぼ重なるcapability

browser control surfaceは引き続きMaps-specificに限定します。V4でもraw DOM、raw Accessibility Tree、raw CDP、pointer primitive、generic browser automation、desktop automation、shell executionをMCPへ公開しません。

V4は小さくreview可能なsliceとして実装・closeoutしました。

- **V4-A** — canonical inventoryと再利用可能なsemantic identity / stale-state primitive
- **V4-B** — place workflow: share link、nearby、photos、bounded panel interaction
- **V4-C** — search / map viewport: filter、search-this-area、現在地、semantic layer
- **V4-D** — directions UI: departure/arrival・transit option、route share、route edit/detail
- **V4-E** — Street View entryとMaps-specific semantic navigation
- **V4-F** — bounded live compatibility closeoutと最終coverage table

ログイン必須capabilityはV4へ入れずV5へ送ります。利用中にconsent / sign-in / CAPTCHA / access challengeが自然発生した場合は既存Human Interventionで停止し、突破しません。Human Intervention完了を別semantic actionのapprovalとはみなしません。

Mapsは抽出済み `mcp-execution-handoff` upstreamをimmutable dependency pinでconsumerとして組み込みます。v0.3.3 baselineでは、same-LAN direct / cellular TURN relayのHandoff-owned Safari WebRTC pathまで物理acceptance済みですが、Maps自身はtransport-blindのままMaps-specificなHuman-intervention lifecycleだけを所有します。現在のv0.4.0 release trainではHandoff **v0.4.4 source release** (`57e4941a5cea9111b5618ce22d5281bd739b49ab`) をpinします。従来のexpiry fencingに加え、完了済みpublic-WSS correctness / immediate-hardening lineとしてHEAD probe保持、Safari IME収束、first-frame startup明示化、reconnect frame復元、healthy frame cadence改善、third-party iOS replacement対応、deterministic consumer refresh contractまで取り込みます。Japan Cinemaを含むtwo-real-adapter validationも完了済みで、この統合でMaps serverをgeneric browser / desktop / shell MCPへ広げません。

### V4最初の実装slice（完了済み）

`maps_get_place_share_link(expectedLabel)` は最初のbrowser-native semantic operationとして追加済みです。currently selected placeだけを対象にし、visible Share controlを押す直前にactive place identityを再検証し、boundedなGoogle Maps share URLだけを許可します。target missing / ambiguousはfail closedとし、Interactive Assistとvisible-read/action budgetの内側で動作します。

## 近い将来の方向性

### 1. Route / Place readingをboundedのまま実用化

bounded summary pathでは、accepted visible textに含まれているsignalだけを対象に、routeのduration / departure / arrivalやplaceのrating / open statusなどの保守的なsemantic annotationを追加しています。既存read boundaryを広げず、同じextraction boundaryを維持できる範囲だけsemantic qualityを改善します。

現在のinvariant:

- 既存のread budget、candidate上限、AX depth、node上限、line上限、response size上限を維持する
- raw bounded label / textをsource of truthとして残し、untrusted external dataとして扱う
- 明示的なvisible cueがない曖昧な数字や時刻に意味を推測で付けない
- Maps UIが想定外に変化した場合は引き続きfail closedにする

### 2. Structured routingはdocumented URL、browser-native routing optionはsemantic UI controlを使う

structured route pathは引き続き、推測したWeb parameterではなくdocumented Google Maps URL parameterを使用します。boundedなURL-backed route option surface:

- 順序付き `waypoints`（最大3件）
- `avoid` は `ferries` / `highways` / `tolls` のみ
- active travel mode変更時もこれらの条件を維持する

出発/到着時刻やtransit preferenceは、projectが使うdocumented Google Maps URLs directions parameterでは表現されない一方、未ログインGoogle Maps Webの重要なUI capabilityです。V4ではsame-day `depart_at|arrive_by` のbounded sliceを **visible Maps-specific semantic control + postcondition / identity validation** で実装済みです。Date / Last available / transit preferenceは明示的なobservation/design gateのまま維持します。undocumented URL parameterを推測したり、internal Maps API/XHRをinterceptしたり、generic DOM automationをMCPへ公開して到達することは禁止します。

## MCP Apps / Optional Interactive UI

MCP Appsを使ったGoogle Maps directionsのinline rendering PoCはportability / hardening milestoneまで完了しました。既存のtext / structured tool resultをbaselineとして維持し、host-neutral UI pathをstable 2026-01-26 lifecycleへhardening済みです。UIはsecond production hostでreal-key Google Maps Embed renderが成功するまではexperimentalとして扱います。

### 標準仕様としての位置づけ

可能な限りChatGPT専用UI contractではなく、**MCP Apps** extensionとして実装します。

MCP Appsは `io.modelcontextprotocol/ui` で識別されるoptionalなMCP拡張で、次を標準化しています。

- `ui://` UI resource
- `_meta.ui.resourceUri` によるtoolとUIの関連付け
- `text/html;profile=mcp-app` のHTML resource
- sandboxed iframe rendering
- MCP JSON-RPCを使ったHost / UI間の双方向通信
- Host / Server間のcapability negotiation

Host側の対応は一律ではありません。そのためUIは**progressive enhancement**として扱います。MCP Apps非対応hostでも、同じtoolが有用なtext / structured resultを返し続ける構成を必須とします。

OpenAIのApps SDK / Optional UIの先行実装はMCP Apps標準化にも影響を与えていますが、ロードマップでは不要なOpenAI固有依存を避け、同じserverを他のMCP Apps対応hostでも利用できる設計を優先します。

### Google Maps Embed PoC 検証結果

既存のRemote MCP URL接続のまま、ChatGPT内で公式Google Maps Embed directions surfaceを正常にrenderできることを確認しました。UI専用endpointや特殊な接続方式は不要で、同じMCP serverからHostが `ui://` resourceを取得する構成で動作します。

検証済みflow:

```text
user request
  -> 必要に応じて既存のdata / navigation tool
  -> maps_render_directions
  -> Hostが ui:// resourceを取得
  -> sandboxed MCP Apps View
  -> 公式Google Maps Embed surface
```

PoCで確認済み:

- `maps_render_directions` は `ui://maps-browser-mcp/directions.html` に紐づくdisplay-only render tool
- Viewは `text/html;profile=mcp-app` とMCP Apps lifecycleを使用
- nested Google Maps Embed iframeは、既存Remote MCP接続経由でChatGPT Web内に正常renderされた
- UI metadataを使わないHost向けにもtext / structured contentを返すfallbackを維持
- Embed feature設定時だけ、serverは標準の `io.modelcontextprotocol/ui` extension と `text/html;profile=mcp-app` をMCP extension capabilityとしてadvertiseする
- stdio smokeで、UI extensionを宣言しないclientへのtext / structured fallbackと、UI extensionを宣言するclientの `ui://` resource pathを両方検証済み
- V4はMCP Apps render boundaryを変えず、Maps-specific browser toolを追加する
- 実Google Maps Embed API keyはdeployment設定にのみ置き、repositoryには絶対にcommitしない。専用restricted keyとdeployment secret / environment mechanismを使う

引き続き維持する設計条件:

- 現在のMCP endpointと確立済みtool behaviorをbaselineとして維持する
- map renderingとbrowser-based visible-state reading / interactionを分離する
- portabilityが上がるならdata toolとrender/UI toolを分離する
- MCP Apps非対応host向けに有用なtext fallbackを維持する
- Embedに必要な最小限のCSP originだけ宣言する
- View内でnested iframeを使う場合、必要originをMCP Apps標準の `ui.csp.frameDomains` で宣言する。未宣言のnested frameはデフォルト拒否される
- UI対応をscraping / crawling / persistence / review collectionのscope拡張理由にしない
- 実装時にGoogle Maps Embedの利用条件、CSP要件、Host互換性を再確認する

### Portability Hardening Status

Portability baselineはcompleteです。

1. Embed key / MCP Apps UIなしでも `maps_render_directions` は有用なtext + structured dataを返す
2. UI resource/linkage/extension advertisementはconditionalで、optional UI設定がcore display resultを消さない
3. Viewはstable host context、safe-area/container dimension、size change、cancellation/error cleanup、teardownを処理する
4. Official MCP Apps basic reference hostでresource discovery、CSP propagation、sandbox/View lifecycle、tool input/result delivery、nested Google Embed frame pathを実行済み。Dummy keyを意図的に使ったためsecond real-key map render成功とは主張しない
5. Official MCP SDK clientでno-key / no-UI fallbackをreal clientとして実行済み
6. ChatGPT Webはreal Google Maps Embed render成功をproject検証済みのproduction host。VS Codeは公式にMCP Apps対応だが、このrepositoryではproject-level real-key render成功をまだ主張しない

残るのはunfinished core portability workではなく **production-host re-validation gate** です。Suitableなsecond production host + restricted keyが利用可能になった時にreal Embed renderを検証し、experimental labelを再評価します。Stable MCP Apps specification、Google Embed requirement、host sandbox/CSP behaviorがmaterialに変わった場合はそれより早くre-openします。

Canonical contract / security rule / evidence / completion criteriaは [MCP Apps portability / deployment](mcp-apps.ja.md) を参照してください。

## pre-v1 release progression

Roadmapは、完了済みcapability baselineと次のevidence-driven release themeが分かれる形へ整理します。Version labelはplanning targetであり、必ずそのversionでshipする約束ではありません。Live Google Maps Web behavior、MCP host support、安全性制約の観測結果に応じてscopeは移動できます。

### 完了済み — v0.3.x capability baseline

- **V4未ログインsemantic coverage** — V4-F closeoutまで完了。
- **V5-A〜V5-D authenticated workflow** — fail-closed Opt-in / Interactive Assist boundary配下で実装済み。V5-E Historyは意図的にevaluated / blockedのままで、scopeを暗黙に広げない。
- **Clean remote-auth / OAuth reference boundary** — Maps専用OAuth gateway + loopback private hopを確立し、historical derived serviceもretire済み。
- **Credential-safe Human Handoff baseline** — v0.3.3ではsame-LAN direct / cellular TURN、exact-window fencing、Human-only Google sign-in後のfresh `signed_in` + bounded V5-B readまで物理acceptance済み。

### 次 — v0.4.0: Managed WSS Cloud Run + distribution closeout

v0.4.0は、v0.3.3以降に積み上がったCloud Run / Handoff改善を「実装済み」から「productionで再現可能に受入済み」へ上げるreleaseです。新しいMaps semantic scopeを広げるreleaseではありません。

Release blockers:

1. **#161 Cloud Run startup contract** — fresh candidate revisionでremote takeover HTTP auth-provider contractを復元し、candidateが`Ready=True`になるまでproductionをfail-safeに維持する。
2. **#181 WSS-only managed transport policy** — PR #182の明示`websocket_relay`-only candidateをstageし、public-origin / WSS preflightと物理iPhone Human sign-in acceptanceを通してからguarded cutoverする。
3. **#183 / #135 post-Human profile lifecycle** — PR #184のstopped-profile staging boundaryを取り込み、Done → Human fencing → fresh identity-free `signed_in` → stopped-profile checkpoint → fresh restore → Agent resumeをDOM/page/action/intervention stateのreplayなしでacceptする。
4. **#170 guarded Cloud Run rollout** — 0%-traffic candidate health / cutover / rollback手順をproduction昇格前のcanonical procedureにする。
5. **#117 usage liability boundary** — proven pre-meter precondition refusalをcompleted browser workとして暗黙課金しない境界を確定する。
6. **#141 first broad distribution** — maintainerが明示authorizeした場合のみ、version metadata、packed artifact、clean-consumer smoke、npm、Official MCP Registry、repository discovery metadataを一括確認して公開する。

**非blockerのUX follow-up:** #134はMaps consumerで観測したgeneric Handoff mobile keyboard / CJK / scroll polishを追跡します。Generic input defectが実際のGoogle認証フロー自体を止めない限り、Maps v0.4 blockerにはしません。通常のMaps検索、scroll、zoom、place selection、ログイン後actionはAgent-owned MCP operationのままです。

v0.4.0で維持するproduction invariants:

- Cloud Runはsingle interactive browser authorityを守るため `concurrency=1` / `maxScale=1` を維持する。
- remote takeover authを弱めず、startup failureはfail closedのまま扱う。
- Handoff diagnosticsはenum/bounded/content-freeとし、credential、Human-entered text、browser/frame content、account identity、session/transport secretを記録しない。
- failed Human inputを自動replayせず、duplicate side effectを作らない。
- Mapsはtransport-blindのまま、generic browser/desktop MCPへscopeを広げない。

**#143 CI docs-only efficiencyはv0.4.0 release blockerではありません。** Required check名とbranch protectionを維持したまま、純docs変更の重いbrowser/container matrixを短絡できる時だけ改善します。

### 次 — v0.5.0: MCP Apps production portability

- 既存host-neutral MCP Apps surfaceを、適切な **second production host** + real restricted Google Maps Embed keyで再検証する。
- Real render、CSP / sandbox、lifecycle、text / structured fallbackを確認し、rich UIをcore必須にしない。
- Production-host evidenceが揃った後だけ `experimental` labelを再評価する。

### その次 — v0.6.0: reliability / UI-change resilience / observability

- fail-closed behaviorを維持したままGoogle Maps Web UI driftの検知・診断を強化する。
- 共通semantic identity / postcondition、failure classification、live compatibility evidence、locale差・A/B variation耐性を改善する。
- Diagnosticsはbounded / privacy-safeを維持し、generic browser automationへ広げない。
- #143のCI効率化も、required checksを弱めず実施可能ならこのhardening laneで回収する。

### v1.0.0へ向けて

それ以降のpre-v1 releaseは、実利用で得たevidenceに基づくsemantic capability gapやhardeningのため意図的に未確定とします。**v1.0.0は未決機能を最後に詰め込むreleaseにはしません**。すでに完成してbounded・documented・operationally matureになったproduct surfaceをstableへ昇格するreleaseとします。

## V5 — Authenticated Google Maps Web Workflows

V5は **bounded authenticated Google Maps Web workflow。最初はread-orientedかつlow-consequenceなreversible account stateを優先** と定義します。V5-A〜V5-Dは既存のfail-closed Opt-in / Interactive Assist boundary配下で実装済み、V5-Eはprivacy/browser-surface gateとして評価完了しhistory toolは意図的に追加していません。物理V5 sign-in acceptanceもHandoff-owned Safari WebRTC経路（direct / cellular TURN）で、fresh `signed_out` → Human-only Google sign-in → revoke / stale-locator fencing → fresh `signed_in` readiness → bounded V5-B readまで完了済みです。Generic mobile input / session-liveness hardeningはHandoff v0.4.4 baselineへ取り込み済みで、従来のMaps #156 managed-WSS `Session unavailable` blockerはclose済みです。残るrelease作業は#181/#183/#135のWSS-only candidate / post-Human profile lifecycleで、#134は非blockerのgeneric Human-input UX follow-upです。新しいMaps semantic capability gapではありません。

Current ordering / status:

1. **V5-A authenticated-session foundation — implemented** — Human-only sign-in/account selection、coarse account readiness、single-user/per-principal browser isolation gate、Human Intervention後fresh reissue
2. **V5-B bounded saved-state reads — implemented** — selected-place save membership / existing list identityだけ。Saved-library crawlなし
3. **V5-C existing listへのSave — implemented** — revalidated place 1件をexisting list 1件へexact postcondition付きで追加。First mutation sliceではnew-list text entry / unsave/removeなし
4. **V5-D Send to phone — implemented** — principal + epoch + exact-action approvalをreal MCP form-elicitation flowへ統合済み。Human Intervention completionとsend approvalは分離
5. **V5-E Maps history — evaluated / blocked** — HistoryはMy Activityへcrossするためseparate account-surface threat modelが必要。Maps-local Recentもcurrent surfaceにstableなbounded activity-row semanticがないためobservation gateを維持

Timelineは、現行Google Maps公式情報でcomputer版Mapsでは利用不可のためV5 Web candidateから外します。Review/rating/edit/public-photo contribution workflowもinitial V5方向には含めません。

MCP authorization principalとdedicated browserでactiveなGoogle Accountは別identityです。Per-principal browser/profile isolationができるまではV5 account-backed toolをsingle-user deployment/profileだけで扱うdesignとします。Sign-in確認だけのためにraw Google account identifierをMCP outputへ返しません。

Entry gate、proposed semantic shape、logging/privacy rule、test plan、explicit deferralは [V5 authenticated workflows — design baseline](v5-authenticated-workflows.ja.md) を参照してください。

## Cross-repository Handoff follow-up — Maps release blockerとの境界

Mapsはtransport logicを再実装せず、`mcp-execution-handoff` のnarrowなstart/revoke/diagnostics lifecycleをconsumerとして使います。v0.4.0では、Maps consumer acceptanceを止めるupstream defectだけをrelease trainへ反映し、provider-neutral architecture workは別laneに保ちます。

- **解決済みupstream baseline:** Handoff #172 / #143 / #177 / #226で追跡したlifecycle / reconnect fixに加え、完了済みv0.4.3 / v0.4.4 public-WSS hardeningをpin済みv0.4.4 source releaseへ取り込みます。Maps #156はclose済みで、#181をWSS-only consumer acceptance gate、#183/#135をpost-Human profile / durability gateとして維持します。#134は実際の認証フローを止めない限り、非blockerのgeneric mobile-input UX evidenceとしてOPENのまま追跡します。
- [`mcp-execution-handoff` #19](https://github.com/git-ksk/mcp-execution-handoff/issues/19) — provider-neutral relay ownership。Cloudflare Realtime TURNはreference pathだが、Mapsはrelay providerを知らないまま維持する。v0.4.0 blockerではない。
- [`mcp-execution-handoff` #12](https://github.com/git-ksk/mcp-execution-handoff/issues/12) — provider-neutral hosted control-plane / private execution-worker topology。現在のCloud Run Maps deploymentを成立させるための必須条件ではなく、将来のtopology分離課題。

adaptive mobile viewport / safe reconnectとThin Takeoverの初期issueはすでにupstreamでclose済みです。今後は古いissue番号をroadmap上の未完了項目として残さず、現行open issueだけをrelease blocker判定に使います。

## ロードマップでも維持する非ゴール

V4 coverageやUI追加でも、次の境界は変えません。

- bulk scraping / crawlingをしない
- route / place / review datasetをharvestしない
- full DOM / full Accessibility Treeを抽出しない
- review bodyを収集しない
- undocumented Maps internal API trafficをinterceptしない
- CAPTCHA solving / bot-detection bypassをしない
- raw DOM / raw CDP / generic browser MCP surfaceを公開しない
- core MCP tool functionalityをrich UI必須にしない

## 参考

- [V4 Google Maps Web Capability Inventory](maps-web-capability-inventory.ja.md)
- [MCP Apps 公式repository](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)