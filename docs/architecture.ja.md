# Architecture（日本語）

[English](architecture.md) | 日本語

`maps-browser-mcp` は汎用Browser Automation MCPより意図的に狭い設計です。公開MCP toolはGoogle Maps上の意味的な操作だけを表し、低レベルbrowser primitiveは内部に閉じます。

未ログインGoogle Maps Webのcanonical coverageは [V4 Capability Inventory](maps-web-capability-inventory.ja.md)、browser / structured interfaceの優先順位は [Project positioning](positioning.ja.md) を参照してください。

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

1 processがrepository外の `~/.maps-browser-mcp/chrome-profile` にある専用Chrome / Chromium process/profileを所有します。browser lifecycleはconsumer側が所有し、`mcp-execution-handoff` はgenericなHuman authority/session boundaryだけを担ってChrome自体は所有しません。

Chromeは別 `--user-data-dir`、`--remote-debugging-address=127.0.0.1`、`--remote-debugging-port=0` で起動します。Project-managed endpointは `DevToolsActivePort` の数値portとbrowser WebSocket identityの両方がlive `/json/version` と一致する場合だけ再利用します。Unix系では専用profile directoryを現在userだけがアクセスできる権限へ制限します。

`MAPS_CDP_PORT` で既存**local** CDP endpointへattachする場合は `MAPS_ALLOW_EXTERNAL_CDP=true` が必要です。このadvanced escape hatchは専用profile isolationを弱め、credential-safe Human handoffとは意図的に併用不可です。Public reachable endpointや普段使いbrowserへ接続しないでください。

専用browserではGoogle Maps page targetを0または1枚だけ受け入れ、複数Maps tabがあれば推測せず拒否します。CDP targetがstale/reconnect/watchdog resetされた場合もsemantic stateを引き継ぎません。

通常Maps automationはprocess-owned Chrome + CDPを維持します。credential ceremonyでは `thin_takeover` Native経路を含め、Agent CDP authorityをdetachしautomation Chrome processを停止します。その後same dedicated profileをremote-debugging/automation flagなしのnormal Chromeで開きます。Human完了/revoke後はHuman surfaceとnormal Chromeを終了し、fresh automation Chrome process/CDP attachmentからreadinessを再検証します。invariantは **exclusive authorityとprovider-supported normal-browser credential ceremony** です。

Stealth plugin、fingerprint spoof、proxy rotation、CAPTCHA solver、hosted-browser provider API key、passkey bypassは使いません。Steelはruntime dependencyではなく、必要なら外部比較/UX benchmarkの参考に限定します。

## Navigation Fast Path

Search、directions、map view、coordinate-based Street ViewはGoogle公式Maps URLを使います。

```text
1 MCP call -> 1 URL compilation -> 1 CDP Page.navigate
```

これらの通常Navigationではpage discoveryやDOM scanは不要です。

## Semantic Interaction

MCP clientへgeneric `click`、`type`、任意selector、JavaScript実行、raw DOM、raw Accessibility Tree、raw CDP toolは公開しません。

Place / route candidateはboundedなMaps専用heuristicで抽出します。bounded readerでcandidate indexを列挙する処理とindexを選択する処理は**同じcandidate extraction logic**を共有します。

Selectionは任意の `expectedLabel` を受け取り、Google Maps側のdynamic listがread後に変化していた場合は `UI_STATE_CHANGED` でclickを拒否します。

Travel mode変更はUI clickを行いません。現在のofficial directions URLを指定modeで再compileし、直接navigateします。

### V4 browser-native semantic operation pattern

V4ではdocumented Maps URLだけでは十分に表現できないMaps Web機能も扱いますが、public surfaceはMaps-specific semantic operationのまま維持します。

```text
validated semantic state
  -> bounded target probe
  -> expected identity revalidation
  -> exactly one Maps-specific visible control/action
  -> bounded postcondition/result probe
  -> semantic result or fail closed
```

必須条件:

1. **State gate** — current Google Maps surfaceと期待semantic viewを確認する
2. **Identity gate** — 操作直前に対象identityを再取得する。並び替え・active place/route変更はactionを無効化する
3. **Scoped target** — verified Maps-specific surface内だけを操作し、page全体からgeneric controlを探さない
4. **Ambiguity refusal** — targetが0件、複数、conflict、staleなら推測せずsemantic error
5. **Bounded postcondition** — requested resultを証明する最小visible stateだけ読む
6. **Policy accounting** — UI stateを読むoperationはInteractive Assist、action limit、visible-read limitの内側で動作
7. **Human Intervention authority** — consent / sign-in / CAPTCHA / challengeを検出したらagent inputを停止。Human Intervention active中にcleanup CDP inputも送らない
8. **Fresh reissue after handoff** — Human完了を別actionのapprovalとせず、stateful semantic actionを自動replayしない
9. **No hidden data path** — internal Maps API/XHR harvesting、generic clipboard dump、undocumented endpoint抽出でvisible semantic interactionを置換しない

最初のV4 operation `maps_get_place_share_link(expectedLabel)` はこのpatternをplace panelへ適用します。place stateを確認し、active place headingを再検証し、そのverified panel内でvisible Share controlがちょうど1つであることを要求し、result dialogからboundedなMaps share URLだけを受け入れます。dialog cleanupもagent authorityがactiveな場合だけ行います。

## Visible-State Reading

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

## Human Intervention Boundary

自然発生したconsent / sign-in / CAPTCHA / access challengeは既存Execution Handoffでagent authorityを停止します。

- MCPはaccount credential、MFA/OTP、passkey material、cookie、browser-session bearer material、provider API keyを受け取らない
- challengeをsolve / bypassせず、Passkey/WebAuthn ceremonyはHuman/provider controlのまま
- Human control完了をpending actionや別actionのapprovalとみなさない
- state-changing / state-dependent semantic operationはfresh reissue / revalidationを要求
- reconnect / restart後に旧semantic operationを自動replayしない
- V4 cleanupはintervention stateを確認し、handoff activeならUI inputを送らない

Credential-safe Human controlは同じ `ExternalHumanSurfaceProvider` contractの背後で1つのprofile-switch lifecycleを使い、Human transportだけを差し替えます。

```text
Agent-owned automation CDP Chrome
  -> Human authority
  -> automation Chrome終了
  -> same dedicated profileをAgent CDP authorityなしnormal Chromeで開く
  -> Handoff transport
       external / optional Cua
       Native `thin_takeover`
       browser `webrtc_takeover`
  -> Human transport revoke + normal Chrome終了
  -> fresh automation Chrome + fresh CDP attachment
  -> fresh readiness / semantic validation
```

`thin_takeover` ではNative ScreenCaptureKit / VideoToolbox / CoreGraphics data planeと短命Native locatorをHandoffが所有します。`webrtc_takeover` ではScreenCaptureKit -> H.264 -> RTP/WebRTC video、direct-touch / keyboard DataChannel、generation-bound reconnect、browser session teardownをHandoffが所有します。MapsがHandoffへ渡すのは、自分が直前に起動したnormal ChromeのPIDというbounded ownership hintだけです。HandoffはそのPIDからeligibleなon-screen windowを厳密に1つだけ解決し、そのwindowだけへcaptureをcropしてpointer inputも同じboundsへmapし、missing/ambiguousならfail closedします。MapsはScreenCaptureKitのwindow探索を所有せず、SDP / ICE / RTP / framebuffer bytes / raw Human inputも扱いません。WebRTC-only locatorから旧HTTP frame/input UIへのfallbackも不可です。

初期Safari経路はsame-network専用で、Handoffはhost ICE candidateのみ（`iceServers: []`）を使います。TURN / WAN / cellular relayは別の明示的relay trust-policy設計が必要です。Human Doneはteardownであり認証成功証明ではないため、その後Mapsはfresh automation attachとcoarse authenticated-readiness確認を必ず行います。

## MCP Apps Render Boundary

`maps_render_directions` はbrowser controller pathから意図的に分離しています。

```text
MCP client / host
   |
   +-- maps_render_directions
   |      +-- text + structured route data（常時）
   |      +-- optional ui://maps-browser-mcp/directions.html
   |             -> sandboxed MCP Apps View
   |             -> official Google Maps Embed iframe
   |
   +-- Maps browser tools
          -> Policy / semantic controller
          -> MapsBrowserRuntime / CDP
```

Display toolは `MapsBrowserRuntime` を呼ばず、dedicated browser stateを読まず、Google Maps tabもmutateしません。MCP Apps resourceはEmbed API key設定時だけadvertiseし、未設定時も同じtoolのtext / structured resultは残ります。

Viewはstable MCP Apps host-context lifecycleに合わせ、theme / locale / style variables、safe-area inset、container dimensions、size-change notification、cancellation/error cleanup、teardownを処理します。Nested-frame CSPは `https://www.google.com` のみに限定します。詳細は [MCP Apps portability / deployment](mcp-apps.ja.md) を参照してください。

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

通常push / PR CIは意図的にGoogle Maps pageへアクセスしません。実UI互換性は、maintainer / userが明示起動するmanual-only `Live Maps E2E` workflowで固定・低ボリュームに確認します。V4 live checkもbounded / user-directedとし、CAPTCHA/challengeを意図的に発生・突破しません。