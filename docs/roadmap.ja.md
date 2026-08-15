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

V4は小さくreview可能なsliceへ分割します。

- **V4-A** — canonical inventoryと再利用可能なsemantic identity / stale-state primitive
- **V4-B** — place workflow: share link、nearby、photos、bounded panel interaction
- **V4-C** — search / map viewport: filter、search-this-area、現在地、semantic layer
- **V4-D** — directions UI: departure/arrival・transit option、route share、route edit/detail
- **V4-E** — Street View entryとMaps-specific semantic navigation
- **V4-F** — bounded live compatibility closeoutと最終coverage table

ログイン必須capabilityはV4へ入れずV5へ送ります。利用中にconsent / sign-in / CAPTCHA / access challengeが自然発生した場合は既存Human Interventionで停止し、突破しません。Human Intervention完了を別semantic actionのapprovalとはみなしません。

Mapsは抽出済み `mcp-execution-handoff` upstreamのimmutable pre-release commitをconsumerとして組み込み済みです。Japan Cinemaを含むformal two-adapter upstream validationは別トラックのまま維持し、この統合でMaps serverをgeneric browser / desktop / shell MCPへ広げません。

### V4最初の実装slice

`maps_get_place_share_link(expectedLabel)` を最初のbrowser-native semantic operationとして追加します。currently selected placeだけを対象にし、visible Share controlを押す直前にactive place identityを再検証し、boundedなGoogle Maps share URLだけを許可します。target missing / ambiguousはfail closedとし、Interactive Assistとvisible-read/action budgetの内側で動作します。

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

出発/到着時刻やtransit preferenceは、projectが使うdocumented Google Maps URLs directions parameterでは表現されない一方、未ログインGoogle Maps Webの重要なUI capabilityです。そのためV4では、**boundedなvisible Maps-specific semantic control + postcondition / identity validation** で実装対象にできます。undocumented URL parameterを推測したり、internal Maps API/XHRをinterceptしたり、generic DOM automationをMCPへ公開して到達することは禁止します。

## MCP Apps / Optional Interactive UI

MCP Appsを使ったGoogle Maps directionsのinline rendering PoCは検証成功済みです。既存のtext/tool workflowをbaselineとして維持しつつ、UIは残るportability確認が完了するまではexperimentalとして扱います。

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

### 残るPortability検証

Production-readyと判断する前に、残りを確認します。

1. 可能なら別のMCP Apps対応host 1種類で検証する
2. 可能なら別の実MCP Apps非対応hostでもtext-only fallbackを確認する。protocol-level fallbackはsmoke testで検証済み
3. ChatGPT Webで成功した以外の対応host layout / container sizingも確認する

ChatGPT Webでの実render成功により当初のfeasibility確認は完了しています。MCP extension広告、capabilityを宣言するclientのsmoke、text / structured fallbackは検証済みで、残りはcross-host portabilityとhardeningです。

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