# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md) | [日本語ドキュメント](docs/README.ja.md)

Google Mapsのuser-visible Web UIを、専用Chrome / Chromiumセッションから限定的に操作する、制約重視・ExperimentalなMCP browser controllerです。

> **ステータス:** 現行の未認証scopeではV1〜V4を実装・closeout済みです。V5-A〜V5-D authenticated workflowも、default無効・fail-closed・single-user / dedicated-profile限定のOpt-in配下で実装済みです。V5-E historyは評価済みですが意図的にhistory toolを追加していません。残るpartial capabilityはguessで埋めずobservation/design-gatedとし、実UI依存のsemantic interaction / bounded visible-state readingはExperimentalです。

## このプロジェクトの狙い

汎用Browser MCPは強力ですが、Google Mapsの操作だけをしたい場合には公開する操作面が大きすぎます。`maps-browser-mcp` は逆に、機能を意図的に絞ります。

- MCPにはGoogle Maps専用ツールだけを公開
- 可能な限りGoogle公式Maps URLを使用
- Chrome DevTools Protocol (CDP) はローカルに閉じる
- 普段使いとは分離した専用ブラウザprofileを使用
- UI状態が曖昧ならfail closed
- 画面読み取りは明示Opt-in・bounded・デフォルトOFF
- スクレイピング、CAPTCHA回避、stealth、内部Maps API収集は実装しない

### このprojectの位置づけ

supported Google Maps Platform APIやGoogle-managed Maps MCPで、**render済みMaps Web体験を必要とせず**workflowを満たせる場合は、その公式structured interfaceを優先します。`maps-browser-mcp` はuser-visibleなMaps Web surfaceそのものが必要なbounded workflow向けです。公式interfaceとの重複は優先順位を下げる要因であって自動的なscope除外理由ではなく、browser pathをAPI利用回避の仕組みとして扱いません。

| Surface | 向いている用途 | このprojectの違い |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supportedなstructured Maps / grounding / place / route等のdata・operation | render済みMaps Webが不要ならこちらを優先。このprojectはboundedなuser-visible Maps browser sessionを操作する |
| General-purpose browser MCP | 幅広いWeb navigation・任意browser automation | Maps-specific actionだけを公開し、control surfaceを大幅に小さく保つ |
| Scraper / dataset harvester | bulk collection・persistent extraction | 明示的に対象外。visible-state readはbounded / transient / opt-in |

詳細は **[Project positioning 日本語版](docs/positioning.ja.md)**、**[V4 Maps Web Capability Inventory](docs/maps-web-capability-inventory.ja.md)**、**[Compliance / Safety 日本語版](docs/compliance.ja.md)** を参照してください。

## V4 closeoutとV5 authenticated workflowの方向性

V4はV1〜V3よりcoverageを広げますが、制約付きarchitectureは維持します。

> **V4 = broad semantic coverage of major Google Maps Web capabilities available without authentication**
>
> 認証なしで利用できる主要なGoogle Maps Web capabilityを、Maps-specificなsemantic MCP operationとして広くカバーする。

優先順位は、browser-native / UI-dependent機能を最優先、browser workflow完結に必要なsearch / directions / placeを次、公式structured interfaceとほぼ同等の機能をその次とします。

未認証capabilityのcanonical status表は **[Google Maps Web Capability Inventory](docs/maps-web-capability-inventory.ja.md)** です。Current **[V5 authenticated-workflows baseline](docs/v5-authenticated-workflows.ja.md)** は、V5-A identity-free readiness、V5-B bounded save-state read、V5-C exact existing-list Save、V5-D explicit one-shot MCP action approval付きbounded selected-route Send-to-phoneまで実装済みです。V5-E historyは、観測したHistory surfaceがMy Activityへcrossし、Maps-local Recentにもstableなbounded activity-row contractがないためtool追加を意図的にblockしています。V4 / V5ともraw DOM、raw Accessibility Tree、raw CDP、generic browser action、desktop action、shell executionをMCPへ公開しません。

## 5分クイックスタート

必要環境はNode.js 20以上とGoogle Chrome / Chromiumです。

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
npm start
```

これで**stdio** MCPがSafe Modeで起動します。最初のMaps操作時に専用Chrome profileを起動または再利用します。

Streamable HTTPで使う場合:

```bash
npm run start:http
```

デフォルトMCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

HTTP processのliveness確認:

```bash
curl -i http://127.0.0.1:8787/healthz
```

Google Mapsへアクセスせずmanaged Chromium + CDPまで確認するreadiness:

```bash
curl -i http://127.0.0.1:8787/readyz
```

初回起動、汎用MCPクライアント設定例、Interactive Assist有効化、profile cleanupまで含む詳しい手順は **[Getting Started 日本語版](docs/getting-started.ja.md)** を参照してください。

## 基本的な使い方

NavigationはInteractive Assistを有効にしなくても使えます。

```text
maps_search({ query: "東京駅" })
```

```text
maps_directions({
  origin: "東京駅",
  destination: "横浜駅",
  mode: "transit"
})
```

Interactive Assistを有効にした場合、場所候補は次の順序で扱うのを推奨します。

```text
maps_search(...)
  -> maps_read_place_summary()
  -> items[{ index, label }] から選ぶ
  -> maps_select_result({ index, expectedLabel: label })
```

V4-Cのsearch filterでもsearch identity chainを明示的に維持します。

```text
maps_search({ query })
  -> maps_set_search_rating({ expectedQuery: query, rating: "4.0" })
  -> maps_read_place_summary()
```

`maps_set_search_rating` が公開するのはlive再観測できた `2.0|2.5|3.0|3.5|4.0|4.5` のRating optionだけです。各bounded UI action直前にvisible search queryを再検証し、選択後はrequested numeric rating chip（例: `4.0+`）がexact-oneでvisibleかつRating menuがclosedであることを確認してからresource epochを更新します。価格、時間、すべてのフィルタはgeneric filter APIへまとめず、引き続きobservation/design-gatedです。

Autocompleteもgeneric browser inputにはせずboundedに扱います。

```text
maps_read_search_suggestions({ query: "Tokyo Station" })
  -> items[{ index, label }] から選ぶ
  -> maps_select_search_suggestion({ query: "Tokyo Station", index, expectedLabel: label })
```

`maps_read_search_suggestions` はfreshなMaps suggestion surfaceを開き、exact combobox-controlled gridからuniqueなcomposite visible identityを最大6件だけ返します。Primary nameは重複し得るため、`maps_select_search_suggestion` はsame active query + exact returned index/labelをactivate直前に再検証し、stale/reordered/duplicate identityはfail closedします。Suggestion gridがcloseしMapsがverified search/place viewへsettleした場合だけsuccessを受理します。Raw combobox/DOMは公開しません。

Active search-result listでは `maps_get_search_share_link({ expectedQuery })` がcanonical + exact visible queryを再検証し、live観測済みexact-one Shareをactivate、selected Send-link tabのallow-listed Maps-generated URLを1件だけ読み、semanticにdialogを閉じます。Clipboardは読まず、successでもsearch resource epochは変えません。

`maps_zoom_search({ expectedQuery, direction })` は `maps_show` を超えるstateful viewport valueとして安全に再観測できた最小sliceだけを追加します。`direction` は `"in" | "out"` 固定で、active search result限定です。Click直前にexact visible queryとexact-one visible enabled Zoom controlを再検証し、同じsearch/queryを維持したままpublic Maps viewport pathのzoom levelがちょうど1段変化したことをpostcondition確認します。Map center座標はstable identity扱いせず、generic pan/recenterやroot/place zoomは公開しません。

V4最初のbrowser-native workflowでは、このidentity chainをMaps生成のplace share URLまで延長します。

```text
maps_search(...)
  -> maps_read_place_summary()
  -> maps_select_result({ index, expectedLabel: label })
  -> maps_get_place_share_link({ expectedLabel: selectedPlaceLabel })
```

`maps_get_place_share_link` はvisibleな「共有」controlを操作する直前にactive placeを再検証し、place/share targetが変化・曖昧化していればfail closedします。同じverified-place modelを `maps_search_nearby`、`maps_open_place_photos`、`maps_select_place_tab`、`maps_expand_opening_hours` でも使います。Place tabは今回live再観測できた `overview` / `about` だけを公開し、Reviewsは引き続きobservation-gatedです。営業時間展開はstate transitionだけを検証し、週間営業時間datasetを返したり収集したりしません。

経路候補も同様です。

```text
maps_directions({ origin, destination, mode: "transit" })
  -> maps_set_transit_time({
       expectedOrigin: origin,
       expectedDestination: destination,
       mode: "depart_at",
       time: "13:30"
     })
  -> maps_read_route_summary()
  -> items[{ index, label }] から選ぶ
  -> maps_select_route({ index, expectedLabel: label })
```

`maps_set_transit_time` はlive再観測できた当日 `depart_at|arrive_by` と24時間 `HH:MM` だけに限定します。Freshなsimple `maps_directions` transit requestを必須とし、mutation前にdocumented origin/destination identityを再検証します。その後、localized mode trigger、exact `transit-time` input、visible route endpoint値の不変、directions viewをpostcondition確認します。UI-onlyな時刻stateは元のdocumented navigation actionでは表現できないため、成功後はそのreplayable actionだけを破棄し、same browser sessionのcurrent route resultsはread/select可能なまま維持します。日付指定、終電、transit preference optionは別のobservation/design-gated sliceです。

`maps_set_recommended_travel_mode({ expectedOrigin, expectedDestination })` はlive観測済み `おすすめ / Best` radioをfresh simple **transit** request限定で扱います。Origin省略、waypoint、avoid、non-transit startは拒否し、exact radio + resolved endpoint不変 + directions surfaceを検証してからresource epochを進め、staleな `travelmode=transit` replayable actionだけを破棄します。Current route resultsはbounded read/select可能なまま維持し、元のdocumented URLがRecommended UI stateまで表現しているとは扱いません。

`maps_swap_route_endpoints({ expectedOrigin, expectedDestination })` は観測済みの出発地/目的地swap semanticsを、Mapsのswap buttonを自動操作せずに実装します。JA/en-US live観測ではexact semantic swap controlとvisible endpointの A/B -> B/A 遷移を確認できましたが、UI click後もcanonical URL/actionがA→Bのまま残ることも確認しました。そのためMCP operationはfresh simple documented directions requestだけを受け付け、expected canonical endpointを再検証し、origin省略/waypoint routeを拒否、travel modeとbounded avoidを維持したままdocumented Maps URLをB→Aで再構築します。

`maps_get_route_share_link({ expectedOrigin, expectedDestination })` はguarded `maps_select_route` 後のselected **transit** route share dialogからMaps-generated short linkを返します。Expected simple canonical transit identityを再検証し、live観測済みのexact `ルートを共有 / Share directions` を1回activate、selected `リンクを送信する / Send a link` tabとexact-oneのallow-listed visible Maps URL fieldを検証してから、semanticなCloseでdialogを閉じて返却します。Clipboard内容は一切読みません。未選択viewの `リンクをコピー / Copy link` surfaceは引き続き使わず、driving/その他modeはbounded再観測でvisible link fieldが安定しなかったためobservation-gatedです。

`expectedLabel` は重要です。Google Mapsが候補を動的に並べ替えたり置換した場合、別対象を誤操作せず `UI_STATE_CHANGED` で停止します。

## MCPツール

### Navigation

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`

### Semantic Interaction

- `maps_select_result`
- `maps_read_search_suggestions` — V4-F、最大6件のcomposite suggestion identity・bounded suggestion state、Interactive Assist必須
- `maps_select_search_suggestion` — V4-F、same active query + guarded `index/expectedLabel`、Interactive Assist必須
- `maps_get_search_share_link` — V4-F、active search-result Share dialog・clipboard-free、Interactive Assist必須
- `maps_set_search_rating` — V4、観測済みrating enum固定、Interactive Assist必須
- `maps_zoom_search` — V4、search限定1-level `in|out`、Interactive Assist必須
- `maps_get_place_share_link` — V4、Interactive Assist必須
- `maps_search_nearby` — V4、Interactive Assist必須
- `maps_open_place_photos` — V4、Interactive Assist必須
- `maps_select_place_tab` — V4、`overview|about` のみ、Interactive Assist必須
- `maps_expand_opening_hours` — V4、展開stateのみ検証、Interactive Assist必須
- `maps_select_route`
- `maps_set_travel_mode`
- `maps_set_recommended_travel_mode` — V4-F、fresh simple transit -> Best/おすすめ限定、Interactive Assist必須
- `maps_set_transit_time` — V4-D、当日 `depart_at|arrive_by`、Interactive Assist必須
- `maps_swap_route_endpoints` — V4-D、fresh simple route限定・documented URL再構築
- `maps_get_route_share_link` — V4-D、selected simple transit route share dialog、Interactive Assist必須

### Optional bounded visible-state reading

- `maps_read_place_summary`
- `maps_read_route_summary`

### V5 authenticated workflows（Opt-in）

以下は `MAPS_V5_AUTHENTICATED_WORKFLOWS=true` がdedicated-profile / single-user gateを満たした場合だけ登録されます。

- `maps_request_human_sign_in` — credential-safeなHuman-only sign-in ceremony。V5と `MAPS_CREDENTIAL_SAFE_HANDOFF=true` の両方が有効な場合だけ登録し、credential入力やaccount選択は一切自動化しない
- `maps_read_authenticated_readiness` — V5-A、identity-freeな `signed_in | signed_out | unknown` readinessのみ
- `maps_read_place_save_state` — V5-B、revalidate済みselected placeのbounded existing-list membership
- `maps_save_place_to_list` — V5-C、1つのrevalidated selected placeをexact existing list 1件へ保存。create / unsave / removeなし
- `maps_read_route_send_targets` — V5-D、exact selected simple routeに対するbounded visible device target
- `maps_send_route_to_device` — V5-D、one-shot MCP form approval後のexact device 1件へのsend。credential / generic text-entry surfaceなし

### Display-only / Optional MCP Apps UI

- `maps_render_directions` — 常にtext + structured route dataを返します。`GOOGLE_MAPS_EMBED_API_KEY` 設定時はMCP Apps対応hostが `ui://maps-browser-mcp/directions.html` を追加renderできます。Dedicated browser sessionのnavigate/mutateは行いません。

Interactive Assistは**デフォルトOFF**です。必要な場合だけ有効化します。

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

または:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Readerが返すのはboundedな `items[{ index, label }]` と必要最小限のUIテキストです。V4 semantic UI operationも同じくboundedなMaps-specific state / identity checkを使います。生HTML、DOM全体、Accessibility Tree全体、network payload、cookie、clipboard dump、レビュー本文の収集は行いません。

Google Mapsから返る文字列はすべて**信頼されていない外部データ**として扱います。MCPクライアントでも命令ではなくデータとして扱ってください。

### Navigation-onlyとInteractive Assistの使い分け

`INTERACTIVE_ASSIST_MODE=false` でも検索、経路、地図表示、Street Viewを開く操作はできます。専用Chrome画面が見えるLocal環境では、MCPが遷移し、表示結果をユーザー自身が読む使い方に向きます。Remote / headless環境でもNavigationは動きますが、callerは通常render済み画面のroute / place詳細を確認できません。

`INTERACTIVE_ASSIST_MODE=true` にすると、bounded read toolとV4 semantic UI operationがactive Maps UIを扱えます。identity validationとread/action budgetは維持します。このOpt-inはproduct / safety boundaryであり、「Googleの利用規約上 `false` が必須」という意味ではありません。また、有効化してもscraping、crawling、bulk extraction、dataset harvestingが許容use caseになるわけではありません。

具体的なLocal / Remoteのflowは [利用モードとユースケース](docs/use-cases.ja.md)、現在のV4 coverageは [Capability Inventory](docs/maps-web-capability-inventory.ja.md)、設計上の制約は [Compliance / Safety](docs/compliance.ja.md) を参照してください。

## アーキテクチャ

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
    +-- Operation Queue + Watchdog
    +-- Semantic UI Controller
    +-- Bounded Visible-State Reader (optional)
    |
    v
Dedicated Chrome / Chromium
    |
   CDP (loopback)
    |
    v
Google Maps Web
```

通常Navigationの経路は意図的に短くしています。

```text
1 MCP call -> 1 Google公式Maps URL -> 1 CDP Page.navigate
```

V4のUI-native operationでもCDPは内部実装detailのままです。MCPにはMaps-specific semantic operationだけを公開し、操作直前に対象identity/stateを再検証し、bounded postconditionを確認し、曖昧ならfail closedします。

1プロセスが1つのsemantic browser stateを管理します。ブラウザ操作は直列化し、待ち行列には上限を設け、1操作がtimeoutした場合はwatchdogがbrowser/CDP sessionをresetします。

詳細は **[Architecture 日本語版](docs/architecture.ja.md)** を参照してください。

## 必要環境・対応OS

- Node.js 20以上
- Google ChromeまたはChromium
- macOS / Linux / Windows

一般的なChrome / Chromiumのinstall pathは自動検出します。必要な場合だけ `MAPS_CHROME_EXECUTABLE` を指定してください。

通常CIではNode.js 20 / 22 / 24を検証し、実Chrome/CDP startupも確認します。macOSおよびWindows runnerでもBrowser smokeを実行します。既存のrequired `check (22)` 内でcontainer image build、sandboxed / restricted-runtime browser path、`/healthz`、`/readyz` まで検証します。

## 専用Chrome profile

デフォルトprofile:

```text
~/.maps-browser-mcp/chrome-profile
```

普段使いのChrome profileを指定しないでください。

本プロジェクトが起動するCDP endpointは `127.0.0.1` にbindします。managed profile再利用時はbrowser identityを検証し、Google Mapsタブが複数ある場合はどれかを勝手に選ばず停止します。

Google側で同意、ログイン、CAPTCHA、アクセスチャレンジが表示された場合は `HUMAN_INTERVENTION_REQUIRED` で停止します。既存Human Intervention flowで必要な手作業を完了してください。Human完了を別actionのapprovalとはみなさず、stateful semantic operationは自動replayせずfresh reissue / revalidationを要求します。

## HTTP / Remote MCP client

HTTP serverはデフォルトでloopback bindです。

```text
127.0.0.1:8787
```

推奨構成:

```text
Remote MCP client
   -> 認証付きHTTPS Tunnel / Reverse Proxy
   -> 127.0.0.1:8787/mcp
   -> maps-browser-mcp
   -> 専用ローカルChrome
```

remote boundaryを越えるのはMCP transportだけにしてください。**Chrome DevTools portを公開しないでください。**

意図的にNode serverを非loopbackへbindする場合は、次の両方が必須です。

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<24文字以上>
```

これは推奨構成ではなく上級者向けescape hatchです。

ChatGPT固有の接続・tool refreshについては **[ChatGPT接続ガイド 日本語版](docs/chatgpt.ja.md)** を参照してください。

## 設定

サーバーは `.env` を自動ロードしません。shell、process manager、任意のenvironment loaderから設定してください。例は [.env.example](.env.example) にあります。

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | project固有HTTP port。`PORT` より優先 |
| `PORT` | unset | `MCP_HTTP_PORT` 未指定時だけ使う汎用port fallback |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | 許可Host名 |
| `MCP_ALLOWED_ORIGINS` | empty | Origin完全一致allowlist（任意） |
| `MCP_ALLOW_NONLOOPBACK` | `false` | 非loopback bindの明示Opt-in |
| `MCP_BEARER_TOKEN` | empty | optional guard。非loopback時は必須、24文字以上 |
| `MCP_MAX_BODY_BYTES` | `262144` | MCP request body最大サイズ |
| `MAPS_CHROME_EXECUTABLE` | 自動検出 | process-owned専用browser session用Chrome / Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | process-owned専用Chrome profile |
| `MAPS_ALLOW_EXTERNAL_CDP` | `false` | 既存local CDP endpoint接続用明示Opt-in。credential-safe handoffとは併用不可 |
| `MAPS_CDP_PORT` | unset | 上級者向け既存ローカルCDP endpoint |
| `MAPS_HEADLESS` | `false` | headless mode |
| `MAPS_ALLOW_UNSANDBOXED_CHROMIUM` | `false` | Linuxの制約runtime向け最終手段。明示時のみ `--no-sandbox` |
| `INTERACTIVE_ASSIST_MODE` | `false` | bounded visible-state readingと必要なV4 semantic UI operationを有効化 |
| `MAPS_V5_AUTHENTICATED_WORKFLOWS` | `false` | fail-closedなbounded V5 authenticated toolを有効化。Interactive Assistと専用single-user profile gateも必須 |
| `MAPS_CREDENTIAL_SAFE_HANDOFF` | `false` | Google sign-in / consent / challenge向けHuman-only handoff |
| `MAPS_CREDENTIAL_SAFE_TRANSPORT` | `external` | `external` はlocal OS-level surface、`cua_takeover` はlocal Cua、`thin_takeover` はNative Thin Takeover runtime、`webrtc_takeover` はinstall不要のiPhone Safari WebRTC takeover |
| `MAPS_CREDENTIAL_SAFE_OPERATOR_URL` | unset | local `external` transport専用fixed HTTPS locator。credential/query/fragment付きURLは拒否 |
| `MAPS_CUA_DRIVER_COMMAND` | `cua-driver` | `cua_takeover` 専用Cua Driver executable。Human transport用の固定7 tool allowlist以外は呼ばない |
| `MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE` | unset | `webrtc_takeover` で必須のHandoff `takeover-webrtc-host` 絶対path |
| `MAPS_WEBRTC_TAKEOVER_DISPLAY_ID` | unset | WebRTC capture対象のoptional macOS display ID |
| `GOOGLE_MAPS_EMBED_API_KEY` | unset | MCP Apps directions view用のoptional restricted Maps Embed API key。未設定でもtext/structured render toolは利用可能 |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | process-local操作上限 |
| `MAPS_MAX_VISIBLE_READS_PER_HOUR` | `30` | 独立したbounded visible-state/UI read上限 |
| `MAPS_MAX_AX_NODES` | `120` | bounded visible-state readingのAccessibility node上限 |
| `MAPS_MAX_READ_CHARS` | `1800` | bounded visible-state readingの返却text上限 |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | 待機可能なbrowser操作数 |
| `MAPS_OPERATION_TIMEOUT_MS` | `25000` | 1操作watchdog |

不正なboolean/整数値は曖昧に解釈せず、起動時にfail fastします。

### V5 authenticated workflow Opt-in

`MAPS_V5_AUTHENTICATED_WORKFLOWS=true` はbounded authenticated V5 semantics用の追加fail-closed Opt-inです。`INTERACTIVE_ASSIST_MODE=true` と組み合わせると、V5 baselineのidentity-free readiness、bounded selected-place save-state read、exact existing-list Save、bounded selected-route Send-to-phone target read、approval-gated single-device sendだけを公開します。`MAPS_CREDENTIAL_SAFE_HANDOFF=true` も有効な場合、`maps_request_human_sign_in` がGoogle sign-in用Human-only ceremonyを追加し、自然発生したconsent / CAPTCHA / access-challengeも同じHuman boundaryへ送ります。credential、MFA/OTP、passkey material、cookie、browser-session bearer material、provider API keyはMCP/model/logへ出さず、Passkey/WebAuthn ceremonyをbypassしません。

credential-safe transportはすべてprofile-switch lifecycleを使います。managed CDP Chromeを停止し、same dedicated profileをremote-debugging/automation flagなしのnormal Chromeで開き、Human surface revoke後にfresh readinessを確認してautomationを再起動します。`external` はOS-level Human surface、`cua_takeover` はlocal fallback/reference、`thin_takeover` は低遅延Native runtime、`webrtc_takeover` はHandoff-ownedなSafari direct-touch surfaceです。Native/WebRTC credential takeoverでMapsが渡すcapture ownership情報は、自分が起動したnormal ChromeのPIDだけです。Handoffはeligible windowが厳密に1つであることを要求し、desktop全体ではなくそのwindowだけへcapture/inputをscopeします。ScreenCaptureKit / VideoToolbox / WebRTC signaling・RTP・DataChannel / reconnect fencing / input deliveryはMapsへ持ち込みません。Done/revokeはHuman authorityを停止してnormal Chromeを閉じますが、それ自体を認証成功とは扱いません。

運用上、現在のmacOS single-user deploymentでは `webrtc_takeover` をbuilt-in mobile pathとして推奨します。物理iPhone Safariでsame-LAN direct WebRTCとcellular TURN relayの両方、およびreal Google sign-in recoveryまでacceptance済みです。`external` は既存deploymentを壊さないfail-closedな設定defaultとして維持します。`thin_takeover` はoptional / experimental siblingとして残し、Native app経路の物理acceptanceは `mcp-execution-handoff` #13で追跡します。

WebRTCはdirect-firstで、ICE policyもHandoff側だけが所有します。Safari/browser peerはhost-only (`iceServers: []`) のまま、Node/werift peerはdependency内部の暗黙third-party STUN defaultを避けるためCloudflare STUNを明示利用します。Cloudflare Realtime TURN設定時はpeerごとのshort-lived TURN credentialを追加し、`iceTransportPolicy: all` のままsame-LAN/direct ICEを優先しつつWAN/CGNATではrelayへfallbackできます。long-lived TURN tokenはserver-sideだけに保持し、Maps / Chrome / browser client / helperへ渡しません。MapsはICE/STUN/TURN detail、candidate/address data、SDP、RTP、framebuffer、raw Human inputを処理しません。vendor browser API keyやhosted-browser backendは不要です。Steelは外部比較/UX benchmarkの参考に限定し、runtime dependencyにはしません。

両lifecycleともHuman handoff後のstale automatic replayは禁止です。credential-safe ownershipとexisting-CDP attachの併用は拒否し、V5の `MCP_AUTH_PROVIDER=module` はper-principal isolationまで引き続き拒否します。Send mutationにはmodern MCP 2026-07-28 clientのform elicitation supportも必要です。

現在のremote single-user設計では、public MCP clientの認証はexternal gatewayで行い、このcore serverへのprivate hopは `static-bearer` を使います。callerのpublic OAuth access tokenをbrowser runtimeへ転送しません。Versionedな [reference OAuth gateway](reference/oauth-gateway/README.ja.md) がこの構成をisolated dogfood packageとして実装しますが、published root npm packageには含めません。詳細は [V5 authenticated workflows](docs/v5-authenticated-workflows.ja.md) と [OAuth gateway pattern](docs/oauth-gateway.ja.md) を参照してください。

### 既存CDP endpoint

`MAPS_CDP_PORT` は `MAPS_ALLOW_EXTERNAL_CDP=true` がない限り拒否します。

接続する場合も、**自分で管理するローカル専用Chrome / Chromium** に限定してください。普段使いの個人browserへのattachはprofile isolationを弱めるため推奨しません。

## 安全性・利用境界

このプロジェクトは、ユーザーから明示的に依頼された操作を代行する**制約付きGoogle Maps browser agent**です。

以下を目的にはしていません。

- 汎用Browser MCP
- Google Mapsのbulk scraper / crawler
- 店舗・口コミ・経路dataset収集
- CAPTCHA solver
- bot検知回避

Google Maps Platform / Google-managed Maps MCPとの重複自体はscope外理由ではありませんが、browser実装はuser-visible Maps Web workflowへ固有価値がある機能から優先します。

Google Maps内部API intercept、XHR/fetch収集、stealth plugin、fingerprint偽装、proxy rotation、Maps dataset永続化、raw DOM/CDP MCP tool、generic desktop control、shell controlは意図的に実装しません。

明らかなbulk collection要求はPolicy Engineで拒否します。Interactive Assistには独立したrolling hourly read budgetがあります。navigation先はGoogle Maps HTTPS web surfaceに限定し、visibleなinline access challengeも検出して操作を停止します。

本projectは、すべてのbrowser-agent用途についてGoogleから許可を保証するものではありません。利用者は適用される規約・法令を確認してください。Maps Web体験を必要とせずsupported structured Google Maps interfaceでworkflowを満たせる場合はそちらを優先します。詳細は **[Compliance / Safety 日本語版](docs/compliance.ja.md)** を参照してください。

## プライバシー

MCP serverはGoogle Maps結果datasetを意図的に永続保存しません。一方、専用Chrome profileはpersistentなlocal browser stateなので、通常のChromeと同様にcookie、cache、設定、閲覧履歴を保持する場合があります。

専用profileを使用し、不要ならGoogleアカウントへログインせず、browser artifactを削除したい場合はMCP/Chromeを停止したうえで専用profileを削除してください。

通常tool handlerでは検索語やMaps結果本文をログしません。unexpected errorはremote clientへlocal pathやenvironment detailsを漏らさないgeneralized errorとして返します。HTTP responseは `Cache-Control: no-store` です。

Browser profile、`.env`、Tunnel credential、token、個人情報を含むscreenshot/trace、生成したMaps datasetをcommitしないでください。

## テスト・CI

ローカル検証:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

通常CIは意図的に**Google Maps本番へアクセスしません**。MCP protocol、package、security、Chrome/CDP、cross-platform、container/headless portabilityをMaps自動アクセスなしで検証します。

Container検証は独立したoptional jobではなく、既存のrequired `check (22)` に組み込みます。imageがデフォルトで `--no-sandbox` を有効にしていないこと、sandbox-capable path、制約runtimeでのfail-closed、明示compatibility mode、`/healthz`、`/readyz`、`PORT` fallbackを確認します。

実Google Maps UI互換性は、`workflow_dispatch` 専用の **Live Maps E2E (manual)** で固定・低ボリュームのuser-triggered checkとして確認します。詳細は **[Manual Live E2E 日本語版](docs/manual-e2e.ja.md)** を参照してください。consent / sign-in / CAPTCHA / challengeを意図的に発生・突破するテストは行わず、自然発生時のみ実環境で再確認し、通常CIではno-bypass境界を決定論的に検証します。

GitHub Actions dependencyはfull commit SHA固定、Dependabotでnpm / Actions / container base imageを監視、CodeQLでJavaScript/TypeScriptを解析します。`main` はprotected branchで、設定済みCI/CodeQL checksを通してからmergeします。

## 現在の制限

- Google Maps UI変更でExperimentalなsemantic selectorが壊れる可能性があります。
- 現行未認証scopeのV4 coverage closeoutは完了済みで、canonical inventoryにimplemented / partial / 明示observation/design-gated capabilityと再開条件を記録します。
- bounded visible-state/UI interactionはExperimentalかつOpt-inです。
- 1processは1人・1local browser session向けで、multi-tenant hosting向けではありません。
- CAPTCHA、同意、ログインflowを自動突破しません。
- rate/read counterはprocess-local safety guardで、永続的な利用量計測や法的compliance mechanismではありません。

エラー別の復旧手順は **[Troubleshooting 日本語版](docs/troubleshooting.ja.md)** を参照してください。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [日本語ドキュメント一覧](docs/README.ja.md) | 日本語版ドキュメントの目次 |
| [Getting Started](docs/getting-started.ja.md) | install、初回起動、client形、Interactive Assist、cleanup |
| [Container / headless Linux](docs/container.ja.md) | 標準Linux container、headless Chromium、port/profile/readiness/sandbox境界 |
| [Troubleshooting](docs/troubleshooting.ja.md) | error code別の安全な復旧手順 |
| [ChatGPT](docs/chatgpt.ja.md) | ChatGPT/App接続境界とtool refresh |
| [Architecture](docs/architecture.ja.md) | runtime、CDP、state、queue/watchdog、semantic UI operation model |
| [Project positioning](docs/positioning.ja.md) | 競合category、Maps Web priority、公式interface重複、product direction |
| [V4 Maps Web Capability Inventory](docs/maps-web-capability-inventory.ja.md) | 未ログインcapabilityのcanonical coverage/status表とV4 slice |
| [MCP Apps portability](docs/mcp-apps.ja.md) | Host-neutral UI contract、fallback、layout、security、deployment、compatibility evidence |
| [V5 authenticated workflows](docs/v5-authenticated-workflows.ja.md) | Authenticated boundary、bounded saved-state / send scope、explicit approval gate |
| [Roadmap](docs/roadmap.ja.md) | V4 closeout baselineとMCP Apps portability status / future direction |
| [Compliance / Safety](docs/compliance.ja.md) | 利用目的・非目的・規約境界 |
| [Manual Live E2E](docs/manual-e2e.ja.md) | 実Google Maps user-triggered互換性確認 |
| [Release Checklist](docs/release.ja.md) | release前CI、Live check、security、tag手順 |
| [Security Policy](SECURITY.ja.md) | security modelとprivate vulnerability reporting |
| [Contributing](CONTRIBUTING.ja.md) | scope、PR、test、security-sensitive change |

## Contributing

Project scope内のcontributionは歓迎です。PR前に **[Contributing 日本語版](CONTRIBUTING.ja.md)** を参照してください。

`main` はprotectedです。変更はbranch + Pull Request + 必須CI/CodeQL経由で入れてください。

## Release Status

v0.3.2 release baselineのrepository metadataは `0.3.2` です。V5-A〜V5-Dは実装済みですがauthenticated-workflow Opt-in配下でdefault無効を維持します。このreleaseでは `maps-browser-mcp` をnpm公開せず、GitHub source tag / Releaseを配布物とします。

Tag / publish前は **[Release Checklist 日本語版](docs/release.ja.md)** を参照してください。

## Security

Security issueはGitHub Private Vulnerability Reportingを使用してください。exploit detail、credential、browser profile、private location、tokenをpublic Issueへ投稿しないでください。

詳細は **[Security Policy 日本語版](SECURITY.ja.md)** を参照してください。

## Disclaimer

本プロジェクトは独立したOSSであり、Googleによる公式提供・承認・提携を意味しません。Google Maps等の名称・商標は各権利者に帰属します。利用者は適用される利用規約・法令を確認してください。

## License

MIT