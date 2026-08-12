# ロードマップ

[English](roadmap.md) | [日本語ドキュメント](README.ja.md)

このロードマップは `maps-browser-mcp` の今後の方向性を記録するものです。すべての項目を実装すると約束するものではありません。今後も小さくuser-directedなworkflowを優先し、supported structured interfaceでuse caseを満たせる場合はそちらを優先します。

## 現在のベースライン

現在のserverは、意図的に2つの利用モードを分離しています。

- **Navigation-only** — render済みMaps contentを読まず、Google Mapsのsearch / directions / map / Street View surfaceを開く
- **Interactive Assist** — active route / place UIの小さなbounded summaryをOpt-inで読み、`index + expectedLabel` により現在の候補を安全側で選択する

既存browser pathは今後もboundedに保ち、bulk collection、crawling、review harvesting、Maps由来persistent datasetを目的にしません。詳細は [利用モードとユースケース](use-cases.ja.md) と [Compliance / Safety](compliance.ja.md) を参照してください。

## 近い将来の方向性

### 1. Route / Place readingをboundedのまま実用化

Extraction boundaryを広げず改善できる範囲でsemantic qualityを上げます。候補:

- active UIですでに見えているroute情報の構造化を明確にする
- active UIですでに見えているplace情報の構造化を明確にする
- 現在のread budget / response size上限を維持する
- Maps UIが想定外に変化した場合は引き続きfail closedにする

### 2. 安全に表現できる経路条件を追加

出発・到着時刻など、ユーザーが明示したroute optionを候補とします。探索的なDOM操作より、Google公式URL/API parameterやdocumented interfaceを優先します。

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
- 既存9個のbrowser / navigation toolは変更していない
- 実Google Maps Embed API keyはdeployment設定にのみ置き、repositoryには絶対にcommitしない。専用restricted keyとdeployment secret / environment mechanismを使う

引き続き維持する設計条件:

- 現在のMCP endpointとtool behaviorをbaselineとして維持する
- map renderingとbrowser-based visible-state readingを分離する
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

UIを追加しても、次の境界は変えません。

- bulk scraping / crawlingをしない
- route / place / review datasetをharvestしない
- full DOM / full Accessibility Treeを抽出しない
- review bodyを収集しない
- undocumented Maps internal API trafficをinterceptしない
- CAPTCHA solving / bot-detection bypassをしない
- core MCP tool functionalityをrich UI必須にしない

## 参考

- [MCP Apps 公式repository](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
