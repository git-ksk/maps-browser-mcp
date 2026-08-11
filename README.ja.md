# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md) | [日本語ドキュメント](docs/README.ja.md)

Google Mapsのuser-visible Web UIを、専用Chrome / Chromiumセッションから限定的に操作する、制約重視・ExperimentalなMCP browser controllerです。

> **ステータス:** V1〜V3実装済み。Google Mapsの実UIに依存するsemantic interactionと限定Visible-State Readerは、UI変更の影響を受けるためExperimentalです。

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

supported Google Maps Platform APIやGoogle-managed Maps MCPでworkflowを満たせる場合は、その公式structured interfaceを優先します。`maps-browser-mcp` は、実際にuser-visibleなMaps Web surfaceを必要とするbounded workflow向けであり、browser pathをAPI利用回避の仕組みとして扱いません。

| Surface | 向いている用途 | このprojectの違い |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supportedなstructured Maps / grounding / place / route等のdata・operation | workflowを満たすならこちらを優先。このprojectはboundedなuser-visible Maps browser sessionを操作する |
| General-purpose browser MCP | 幅広いWeb navigation・任意browser automation | Maps-specific actionだけを公開し、control surfaceを大幅に小さく保つ |
| Scraper / dataset harvester | bulk collection・persistent extraction | 明示的に対象外。visible-state readはbounded / transient / opt-in |

詳細は **[Project positioning 日本語版](docs/positioning.ja.md)** と **[Compliance / Safety 日本語版](docs/compliance.ja.md)** を参照してください。

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

初回起動、汎用MCPクライアント設定例、V3有効化、profile cleanupまで含む詳しい手順は **[Getting Started 日本語版](docs/getting-started.ja.md)** を参照してください。

## 基本的な使い方

NavigationはV3を有効にしなくても使えます。

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

V3を有効にした場合、場所候補は次の順序で扱うのを推奨します。

```text
maps_search(...)
  -> maps_read_place_summary()
  -> items[{ index, label }] から選ぶ
  -> maps_select_result({ index, expectedLabel: label })
```

経路候補も同様です。

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> items[{ index, label }] から選ぶ
  -> maps_select_route({ index, expectedLabel: label })
```

`expectedLabel` は重要です。Google Mapsが候補順を動的に並べ替えた場合、別候補を誤クリックせず `UI_STATE_CHANGED` で停止します。

## MCPツール

### Navigation

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`

### Interaction

- `maps_select_result`
- `maps_select_route`
- `maps_set_travel_mode`

### V3: 限定Visible-State Reader

- `maps_read_place_summary`
- `maps_read_route_summary`

V3の画面読み取りは**デフォルトOFF**です。必要な場合だけ有効化します。

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

または:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Readerが返すのはboundedな `items[{ index, label }]` と必要最小限のUIテキストです。生HTML、DOM全体、Accessibility Tree全体、network payload、cookie、レビュー本文の収集は行いません。

Google Mapsから返る文字列はすべて**信頼されていない外部データ**として扱います。MCPクライアントでも命令ではなくデータとして扱ってください。

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

Google側で同意、ログイン、CAPTCHA、アクセスチャレンジが表示された場合は `HUMAN_INTERVENTION_REQUIRED` で停止します。必要な手作業を専用browser上で行い、その後に元のMaps操作を最初から実行してください。

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
| `MAPS_CHROME_EXECUTABLE` | 自動検出 | Chrome / Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | 専用Chrome profile |
| `MAPS_ALLOW_EXTERNAL_CDP` | `false` | 既存CDP endpoint接続の明示Opt-in |
| `MAPS_CDP_PORT` | unset | 上級者向け既存ローカルCDP endpoint |
| `MAPS_HEADLESS` | `false` | headless mode |
| `MAPS_ALLOW_UNSANDBOXED_CHROMIUM` | `false` | Linuxの制約runtime向け最終手段。明示時のみ `--no-sandbox` |
| `INTERACTIVE_ASSIST_MODE` | `false` | V3読み取りを有効化 |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | process-local操作上限 |
| `MAPS_MAX_VISIBLE_READS_PER_HOUR` | `30` | V3独立読み取り上限 |
| `MAPS_MAX_AX_NODES` | `120` | V3 Accessibility node上限 |
| `MAPS_MAX_READ_CHARS` | `1800` | V3返却text上限 |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | 待機可能なbrowser操作数 |
| `MAPS_OPERATION_TIMEOUT_MS` | `25000` | 1操作watchdog |

不正なboolean/整数値は曖昧に解釈せず、起動時にfail fastします。

### 既存CDP endpoint

`MAPS_CDP_PORT` は `MAPS_ALLOW_EXTERNAL_CDP=true` がない限り拒否します。

接続する場合も、**自分で管理するローカル専用Chrome / Chromium** に限定してください。普段使いの個人browserへのattachはprofile isolationを弱めるため推奨しません。

## 安全性・利用境界

このプロジェクトは、ユーザーから明示的に依頼された操作を代行する**制約付きGoogle Maps browser agent**です。

以下を目的にはしていません。

- Google Maps Platform APIの代替
- 汎用Browser MCP
- Google Mapsのbulk scraper / crawler
- 店舗・口コミ・経路dataset収集
- CAPTCHA solver
- bot検知回避

Google Maps内部API intercept、XHR/fetch収集、stealth plugin、fingerprint偽装、proxy rotation、Maps dataset永続化は意図的に実装しません。

明らかなbulk collection要求はPolicy Engineで拒否します。V3には独立したrolling hourly read budgetがあります。navigation先はGoogle Maps HTTPS web surfaceに限定し、visibleなinline access challengeも検出して操作を停止します。

V3はリスクを抑えた設計ですが、すべてのbrowser-agent用途についてGoogleから許可を保証されたものではありません。利用者は適用される規約・法令を確認してください。supported structured Google Maps interfaceでworkflowを満たせる場合はbrowser automationよりそちらを優先します。詳細は **[Compliance / Safety 日本語版](docs/compliance.ja.md)** を参照してください。

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
- V3 Visible-State ReaderはExperimentalかつboundedです。
- 1processは1人・1local browser session向けで、multi-tenant hosting向けではありません。
- CAPTCHA、同意、ログインflowを自動突破しません。
- rate/read counterはprocess-local safety guardで、永続的な利用量計測や法的compliance mechanismではありません。

エラー別の復旧手順は **[Troubleshooting 日本語版](docs/troubleshooting.ja.md)** を参照してください。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [日本語ドキュメント一覧](docs/README.ja.md) | 日本語版ドキュメントの目次 |
| [Getting Started](docs/getting-started.ja.md) | install、初回起動、client形、V3、cleanup |
| [Container / headless Linux](docs/container.ja.md) | 標準Linux container、headless Chromium、port/profile/readiness/sandbox境界 |
| [Troubleshooting](docs/troubleshooting.ja.md) | error code別の安全な復旧手順 |
| [ChatGPT](docs/chatgpt.ja.md) | ChatGPT/App接続境界とtool refresh |
| [Architecture](docs/architecture.ja.md) | runtime、CDP、state、queue/watchdog |
| [Project positioning](docs/positioning.ja.md) | 競合category、公式interface優先、product direction |
| [Compliance / Safety](docs/compliance.ja.md) | 利用目的・非目的・規約境界 |
| [Manual Live E2E](docs/manual-e2e.ja.md) | 実Google Maps user-triggered互換性確認 |
| [Release Checklist](docs/release.ja.md) | release前CI、Live check、security、tag手順 |
| [Security Policy](SECURITY.ja.md) | security modelとprivate vulnerability reporting |
| [Contributing](CONTRIBUTING.ja.md) | scope、PR、test、security-sensitive change |

## Contributing

Project scope内のcontributionは歓迎です。PR前に **[Contributing 日本語版](CONTRIBUTING.ja.md)** を参照してください。

`main` はprotectedです。変更はbranch + Pull Request + 必須CI/CodeQL経由で入れてください。

## Release Status

`main` のrepository metadata上のversionは現在 `0.1.1` です。公開済みGitHub Releaseが未リリースの`main`より古い状態はあり得ます。Releaseでnpm package公開が明示されるまでは、npm install可能と仮定しないでください。

Tag / publish前は **[Release Checklist 日本語版](docs/release.ja.md)** を参照してください。

## Security

Security issueはGitHub Private Vulnerability Reportingを使用してください。exploit detail、credential、browser profile、private location、tokenをpublic Issueへ投稿しないでください。

詳細は **[Security Policy 日本語版](SECURITY.ja.md)** を参照してください。

## Disclaimer

本プロジェクトは独立したOSSであり、Googleによる公式提供・承認・提携を意味しません。Google Maps等の名称・商標は各権利者に帰属します。利用者は適用される利用規約・法令を確認してください。

## License

MIT