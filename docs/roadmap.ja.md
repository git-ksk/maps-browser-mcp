# ロードマップ

[English](roadmap.md) | [日本語ドキュメント](README.ja.md) | [V4 capability inventory](maps-web-capability-inventory.ja.md)

このロードマップは `maps-browser-mcp` の今後の方向性を記録するものです。すべての項目を実装すると約束するものではありません。今後も小さくuser-directedなworkflowを優先します。render済みGoogle Maps Web体験そのものが不要な場合はsupported structured interfaceを優先しますが、公式interfaceとの重複はbrowser scopeから自動除外する理由ではなく、優先順位を下げる要因として扱います。

## 現在のベースライン

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

Mapsは抽出済み `mcp-execution-handoff` formal upstreamのimmutableなv0.1.0 source-release commitをconsumerとして組み込み済みです。Japan Cinemaを含むtwo-real-adapter validationも完了済みで、この統合でMaps serverをgeneric browser / desktop / shell MCPへ広げません。

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

残る主要なpre-v1 workは、現時点では次のrelease themeへ対応付けます。これは各項目を必ずそのversionでshipすると約束するものではありません。Live Google Maps Web behavior、MCP host support、安全性制約の観測結果に応じてscopeは移動できます。

- **v0.3.0 — V5 authenticated workflows + clean remote-auth foundation**
  - broad signed-in browser automationを有効化せず、下記V5を段階的に実装する。
  - Issue #74のclean external OAuth reference gatewayをこのreleaseのfoundation / pre-workとして扱う。Versionedなisolated reference implementationでMaps専用OAuth boundary + current-checkout coreへのloopback private hopまでは追加済み。#74 close前にlive deployment、MCP interoperability / target client検証、historicalなMonokura由来dogfood gatewayからの安全なmigrationを完了する。
- **v0.4.0 — MCP Apps production portability**
  - 既存host-neutral MCP Apps surfaceを、適切なsecond production host + real restricted Google Maps Embed keyで再検証する。
  - production-host evidenceが揃った後だけexperimental labelを再評価し、text / structured fallbackを維持してrich UIをcore必須にはしない。
- **v0.5.0 — reliability / UI-change resilience / observability**
  - fail-closed behaviorを維持したままGoogle Maps Web UI driftの検知・診断を強化する。
  - generic browser automationへ広げず、共通semantic identity / postcondition、failure classification、live compatibility evidence、locale差・A/B variation耐性を改善する。

それ以降のpre-v1 releaseは、実利用で得たevidenceに基づくsemantic capability gapやhardeningのため意図的に未確定とします。**v1.0.0は未決機能を最後に詰め込むreleaseにはしません**。すでに完成してbounded・documented・operationally matureになったproduct surfaceをstableへ昇格するreleaseとします。

## V5 / v0.3.0 — Authenticated Google Maps Web Workflows

V5は **bounded authenticated Google Maps Web workflow。最初はread-orientedかつlow-consequenceなreversible account stateを優先** と定義します。V5-A〜V5-Dは既存のfail-closed Opt-in / Interactive Assist boundary配下で実装済み、V5-Eはprivacy/browser-surface gateとして評価完了しhistory toolは意図的に追加していません。

Current ordering / status:

1. **V5-A authenticated-session foundation — implemented** — Human-only sign-in/account selection、coarse account readiness、single-user/per-principal browser isolation gate、Human Intervention後fresh reissue
2. **V5-B bounded saved-state reads — implemented** — selected-place save membership / existing list identityだけ。Saved-library crawlなし
3. **V5-C existing listへのSave — implemented** — revalidated place 1件をexisting list 1件へexact postcondition付きで追加。First mutation sliceではnew-list text entry / unsave/removeなし
4. **V5-D Send to phone — implemented** — principal + epoch + exact-action approvalをreal MCP form-elicitation flowへ統合済み。Human Intervention completionとsend approvalは分離
5. **V5-E Maps history — evaluated / blocked** — HistoryはMy Activityへcrossするためseparate account-surface threat modelが必要。Maps-local Recentもcurrent surfaceにstableなbounded activity-row semanticがないためobservation gateを維持

Timelineは、現行Google Maps公式情報でcomputer版Mapsでは利用不可のためV5 Web candidateから外します。Review/rating/edit/public-photo contribution workflowもinitial V5方向には含めません。

MCP authorization principalとdedicated browserでactiveなGoogle Accountは別identityです。Per-principal browser/profile isolationができるまではV5 account-backed toolをsingle-user deployment/profileだけで扱うdesignとします。Sign-in確認だけのためにraw Google account identifierをMCP outputへ返しません。

Entry gate、proposed semantic shape、logging/privacy rule、test plan、explicit deferralは [V5 authenticated workflows — design baseline](v5-authenticated-workflows.ja.md) を参照してください。

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