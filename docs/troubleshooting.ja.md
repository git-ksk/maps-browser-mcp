# Troubleshooting（日本語）

[English](troubleshooting.md) | 日本語

この文書では、よくある実行時症状やMCPエラーコードと、安全側に倒した復旧手順を対応付けます。

## まず基本チェック

リポジトリrootで実行:

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

ここがすべて通る場合、残る原因はbrowser state、client設定、またはGoogle Maps実UI互換性である可能性が高いです。

## `BROWSER_UNAVAILABLE`

主な原因:

- Chrome / Chromiumが自動検出対象の場所にない
- `MAPS_CHROME_EXECUTABLE` が存在しない、または実行できないpathを指している
- 専用profileを作成・openできない
- 既存CDP endpointが利用できない
- 専用profileでGoogle Maps tabが複数開いている

復旧:

1. 専用profileの余分なMaps tabを閉じる
2. Chrome単体が通常起動することを確認
3. `npm run smoke:browser` を実行
4. 自動検出が失敗する場合だけ `MAPS_CHROME_EXECUTABLE` を設定
5. 自分でChromeを管理する明確な理由がなければ `MAPS_CDP_PORT` を使わない

runtimeが明示的にrecoverableと判定したprocess / CDP接続断では、Maps Browser MCPがstaleなbrowser stateをfenceし、**同じservice instance内で同じ専用profileを使うautomation Chrome / CDPを再構築**して `UI_STATE_CHANGED` を返します。その後、目的のMaps toolをfresh invocationとして再実行してください。失敗したactionを自動replayすることはありません。複数Maps tabのような構造的fail-closedエラーは、Chrome再起動で自動的に消し込みません。

期限切れのexplicit Human sign-in surfaceも、同じauthenticated principalに限って同じ境界で処理します。stale Human generationをrevoke / cancelし、browser runtimeを再構築したうえでfresh readiness / tool invocationを要求します。Cloud Run revisionの差し替えは最後の運用fallbackであり、通常のbrowser recovery手段ではありません。

## `MAPS_NOT_OPEN`

制御対象tabがblank、または想定するMaps surface上にいません。

復旧: 元の `maps_search` / `maps_directions` / `maps_show` / `maps_streetview` を再実行してください。古いcandidate indexを再利用しないでください。

## `UI_STATE_CHANGED`

これは必ずしも不具合ではなく、安全停止です。

前回candidate listを生成した時と現在のUI stateが一致しない場合に返ります。

例:

- Googleが検索結果順を変更した
- route listが変わった
- ユーザーが専用browserを手動操作した
- browser sessionが再接続された
- `expectedLabel` と現在のindexが一致しない

復旧:

```text
maps_search / maps_directions を再実行
  -> V3有効ならsummaryを読み直す
  -> 新しい index + expectedLabel を使う
```

古いindexだけをblind retryしないでください。

## `UI_ELEMENT_NOT_FOUND`

期待するboundedなMaps UI elementが見つかりません。

主な原因:

- Google Maps UI構造が変わった
- pageが期待stateまで到達していない
- 指定indexがなくなった
- locale / layout差でselector pathが一致しない

まず元のnavigation actionを再実行してください。Manual Live Maps E2Eでも再現する場合は、機密情報を含まない最小再現情報だけでIssueを作成してください。cookie、browser profile、account screenshot、私的なlocation情報は添付しないでください。

## `HUMAN_INTERVENTION_REQUIRED`

Google Maps以外へ遷移した、または同意、ログイン、CAPTCHA、access challengeが表示されています。

これは停止するのが正常動作です。

復旧:

1. 専用browserを人間が確認
2. 必要なら正規の同意・ログイン操作を手動で完了
3. CAPTCHA solverやbot回避を自動化しない
4. 手動操作後、元のMaps actionを最初から再実行

これらの遷移では古いsemantic stateを無効化します。

Built-in `webrtc_takeover` を使う場合は [WebRTC Human Takeover](webrtc-human-takeover.ja.md) を参照してください。Public Safari locatorにはauthenticated HTTPS operator originが必要で、macOS helperには画面収録とアクセシビリティ権限も必要です。Same-LAN directとcellular TURN relayはいずれも物理acceptance済みです。Browser reload / mobile viewport UXはupstream follow-upのため、stale page復旧目的でgeneration fencingを弱めないでください。

## `INTERACTIVE_ASSIST_DISABLED`

V3 read toolはデフォルトOFFです。

stdio:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

HTTP:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Navigationだけで足りる場合はV3を有効化する必要はありません。

## `POLICY_BLOCKED`

local safety boundaryに反するrequestです。典型的にはbulk collection / scrapingと判定された場合や、query制約を超えた場合です。

拒否されたbulk taskを細かいcallへ分割して回避しないでください。このprojectはuser-directedな対話的Maps操作向けで、dataset収集向けではありません。

## `NAVIGATION_BLOCKED`

生成・指定されたdestinationがallowlistされたGoogle Maps HTTPS surface外です。

これはhard boundaryです。トラブル回避のために任意Google pageやthird-party siteへallowlistを広げないでください。

## `RATE_LIMITED`

process-localなaction / V3 read budgetへ到達しました。

デフォルト:

```text
MAPS_MAX_ACTIONS_PER_MINUTE=30
MAPS_MAX_VISIBLE_READS_PER_HOUR=30
```

rolling windowが空くまで待ってください。limit引き上げをbulk collection用途に使わないでください。

## `SERVER_BUSY`

直列browser operation queueが満杯です。

デフォルト:

```text
MAPS_MAX_PENDING_ACTIONS=8
```

client側の同時call数を減らしてください。1processが1つのsemantic browser stateを管理するため、高並列実行は意図的にサポートしません。

## `OPERATION_TIMEOUT`

操作が `MAPS_OPERATION_TIMEOUT_MS` を超え、Runtimeがbrowser / CDP sessionをresetしました。

デフォルト:

```text
MAPS_OPERATION_TIMEOUT_MS=25000
```

元のnavigation actionを再実行してください。以前のsearch / route stateが残っている前提で操作しないでください。

頻繁に発生する場合はtimeout値を上げる前にlocal Chromeの起動・性能を確認してください。

## 非loopback addressでHTTP serverが起動しない

意図した安全制約です。非loopback bindには両方必要です。

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<24文字以上>
```

推奨はNode serverをloopbackに維持し、前段へ認証付きHTTPS Tunnel / Reverse Proxyを置く構成です。

## HTTPで401/403相当のaccess failure

確認項目:

- `MCP_BEARER_TOKEN` を設定している場合はtoken一致
- request `Host` が `MCP_ALLOWED_HOSTS` に含まれるか
- `MCP_ALLOWED_ORIGINS` を設定している場合は `Origin` が完全一致するか
- Tunnel / Reverse Proxy側の認証

公開endpointを通すためだけにHost / Origin / auth checkを無効化しないでください。

## ChatGPTで更新したToolが見えない

Custom MCP / App clientはtool definitionをcache・snapshot化する場合があります。

Tool名、description、input schemaを変更した場合は、ChatGPT側でtoolをrefresh / rescanしてください。breaking schema changeよりoptional field追加を優先します。

詳しくは [ChatGPT接続ガイド](chatgpt.ja.md) を参照してください。

## Chrome profileの問題

デフォルト専用profile:

```text
~/.maps-browser-mcp/chrome-profile
```

普段使いChrome profileを再利用しないでください。

専用profileが壊れ、local browser stateが不要なら:

1. `maps-browser-mcp` を停止
2. managed Chromeが閉じていることを確認
3. 専用profile directoryだけをmove / delete
4. MCPを再起動してfresh profileを作成

profile自体をIssueへ添付しないでください。

## 通常CIは通るがLive Maps E2Eだけ失敗する

build / runtimeは正常でも、Google Mapsの現在UIとExperimental semantic selectorが一致しなくなった可能性があります。

[Manual Live E2E](manual-e2e.ja.md) でplace selection、route selection、bounded readingのどこが変わったか切り分けてください。Live checkが戻るまでは対象UI-dependent機能をExperimental扱いのままにします。

## Bug Reportに含めるもの

含めてよい情報:

- OS / version
- Node major version
- Chrome / Chromium version
- `maps-browser-mcp` commit / tag
- error code
- 呼び出したtool
- 通常smoke testの成否
- Manual Live Maps E2Eで再現するか

含めない情報:

- cookie
- browser profile
- Authorization header
- Tunnel token
- account identifier
- 自宅・職場等のprivate location
- 個人情報を含むscreenshot

Security issueは詳細なpublic Issueを作らず、[Security Policy 日本語版](../SECURITY.ja.md) に従ってください。
