# Architecture（日本語）

[English](architecture.md) | 日本語

`maps-browser-mcp` は汎用Browser Automation MCPより意図的に狭い設計です。公開MCP toolはGoogle Maps上の意味的な操作だけを表し、低レベルbrowser primitiveは内部に閉じます。

## レイヤー構成

```text
MCP client
   |
   v
MCP tools
   |
   +-- MapsUrlCompiler
   +-- PolicyEngine
   +-- OperationQueue + Watchdog
   +-- SemanticController
   +-- VisibleStateReader (optional)
   |
   v
MapsBrowserRuntime
   |
   v
Chrome DevTools Protocol
   |
   v
専用 Chrome / Chromium profile
   |
   v
Google Maps Web
```

## Process Model

1 processが1つのsemantic Maps browser sessionを所有します。Browserへ影響するMCP操作はboundedな `OperationQueue` で直列化し、同時callによる単一pageのraceと、無制限なpending backlogを防ぎます。

各browser operationにはwatchdogがあります。`MAPS_OPERATION_TIMEOUT_MS` のデフォルトは25秒です。上限を超えると、次の操作へ進む前にbrowser / CDP sessionをresetし、`OPERATION_TIMEOUT` を返します。これにより1つの未解決CDP callでsingle-session queueが永久に詰まることを防ぎます。

設計対象はsingle local user / single browser sessionです。Multi-user hostingには認証主体ごとにPolicy Engine、queue、browser process/profile、semantic stateを分離する設計が必要で、初期scope外です。

## Browser Lifecycle

デフォルトではrepository外の次の専用profileでChrome / Chromiumを起動または再利用します。

```text
~/.maps-browser-mcp/chrome-profile
```

Chromeは別 `--user-data-dir`、`--remote-debugging-address=127.0.0.1`、`--remote-debugging-port=0` で起動します。

Project-managed endpointはChromeの `DevToolsActivePort` から取得し、**数値portとbrowser WebSocket identityの両方**がlive `/json/version` endpointと一致する場合だけ再利用します。古いprofile fileのport番号が後から無関係なChromeに再利用されても誤接続しないためです。

Unix系OSでは専用profile directoryを現在userだけがアクセスできる権限へ制限します。

`MAPS_CDP_PORT` を指定して既存**local** CDP endpointへattachすることもできますが、`MAPS_ALLOW_EXTERNAL_CDP=true` が必要です。これはadvanced escape hatchであり、専用profile isolation保証を弱めます。Public reachable endpointや普段使いbrowserへ接続しないでください。

専用browserへ接続するとき、Google Maps page targetは0または1枚だけ受け入れます。複数Maps tabがある場合はどれを操作するか推測せずerrorにします。これで1 process / 1 semantic session invariantを維持します。

CDP targetがstale、再接続、watchdog resetされた場合、以前のsearch / directions状態を新しいpageへ引き継がずsemantic stateを無効化します。

Stealth plugin、fingerprint spoof、proxy rotation、CAPTCHA solverは使いません。

## Navigation Fast Path

Search、directions、map view、Street ViewはGoogle公式Maps URLを使います。

```text
1 MCP call -> 1 URL compilation -> 1 CDP Page.navigate
```

これらの通常Navigationではpage discoveryやDOM scanは不要です。

## Semantic Interaction

MCP clientへgeneric `click`、`type`、任意selector、JavaScript実行toolは公開しません。

Place / route candidateはboundedなMaps専用heuristicで抽出します。V3でcandidate indexを列挙する処理とV2でindexを選択する処理は**同じcandidate extraction logic**を共有します。

Selectionは任意の `expectedLabel` を受け取り、Google Maps側のdynamic listがread後に変化していた場合は `UI_STATE_CHANGED` でclickを拒否します。

Travel mode変更はUI clickを行いません。現在のofficial directions URLを指定modeで再compileし、直接navigateします。

## V3 Visible-State Reader

Visible-state readingはoptionalかつデフォルトOFFです。有効時は:

1. active pageがGoogle Maps web surface上か確認
2. compatible semantic state（search/place または directions/route）を確認
3. selectionと同じlogicでbounded candidate listを抽出
4. document全体fallbackをせずMapsの `role=main` 領域を要求
5. bounded read中だけChrome Accessibilityを有効化
6. accessibility node数を制限
7. 関連する少数text lineだけ保持
8. control / bidirectional formatting文字を除去
9. total character budgetと独立rolling hourly read budgetを適用
10. 読み取り後すぐAccessibilityを無効化

ResultはMaps由来label / textを明示的にuntrusted external dataとして示します。Serverはpage content内の命令を実行しません。

Full DOM / AX dump、生HTML、review body、network response、Google Maps内部API payloadは返しません。

Action / read counterはprocess-local safety guardであり、再起動でresetされます。永続accountingや法的compliance保証ではありません。

## HTTP Transport

HTTP endpointは公式MCP TypeScript v2 server entryを使用し、entryが扱う両protocol eraに対応します。

- 2025系 `initialize`
- `2026-07-28` `server/discover` / request `_meta`、標準 `Mcp-Method` / `Mcp-Name` validation

Node HTTP bridgeには以下があります。

- デフォルトloopback bind
- Host allowlist
- optional exact Origin allowlist
- optional constant-time Bearer token guard
- 非loopback時の `MCP_ALLOW_NONLOOPBACK=true` gate + application Bearer必須
- request body上限
- request/header/keep-alive timeout
- client abort propagation
- streamed response backpressure handling
- success / health / errorすべて `Cache-Control: no-store`

非loopback bindはadvanced escape hatchです。推奨remote構成ではNodeはloopbackのまま、認証付きHTTPS Tunnel / Reverse Proxyを前段に置きます。Static Bearer tokenを暗号化されていない経路で送らないでください。

`/mcp` は `POST` のみ。`GET /mcp` は拒否します。`/healthz` は別endpointで `GET` / `HEAD` に対応します。

## Persistent Browser State

ServerはMaps結果datasetを意図的に永続保存しません。ただし専用Chrome profile自体はpersistentで、Chrome通常機能としてcookie、cache、preferences、history等を保持する場合があります。

このprofileはsensitive local stateとして扱い、commit / shareしないでください。

## CI Boundary

通常CIでは以下を確認します。

- dependency audit
- type / unit check
- Node.js 20 / 22 / 24 build
- 2025系 / 2026-07-28系の実stdio MCP round trip / tool registration
- legacy / modern HTTP protocol smoke
- modern `tools/call` と `Mcp-Name`
- malformed modern header拒否
- HTTP security / no-store
- package dry-run
- 実headless Chrome / CDP startup

Chrome / CDP startupはGoogle Mapsへtrafficを出さず、GitHub-hosted Linux、macOS 15 arm64、Windows runnerで実行します。

通常push / PR CIは意図的にGoogle Maps pageへアクセスしません。実UI互換性は、maintainer / userが明示起動するmanual-only `Live Maps E2E` workflowで固定・低ボリュームに確認します。
