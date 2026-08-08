# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

Google Maps Platform APIに依存せず、専用ブラウザセッションを通してGoogle Mapsを操作する軽量MCPサーバーです。

> **ステータス:** V1〜V3実装済み。Google MapsのUI構造に依存する操作はExperimentalです。

## できること

`maps-browser-mcp` は汎用Browser MCPではなく、Google Maps向けの小さく明確なツールだけを公開します。

- Google公式Maps URLによる検索・経路・地図・Street View表示
- 専用Chrome / ChromiumプロファイルをCDPで制御
- 汎用 `click` / `type` / selector / JavaScript実行をMCPとして公開しない
- 場所候補・経路候補の限定的なsemantic selection
- オプションのbounded Visible-State Reader
- Google Maps Platform APIキー不要

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

画面読み取りは**デフォルトOFF**です。`INTERACTIVE_ASSIST_MODE=true` の場合のみ有効になります。

Readerは小さな `items[{ index, label }]` と関連UIテキストだけを返します。候補選択時は、可能ならReaderが返した `label` を `expectedLabel` として渡してください。Google Maps側で候補順が変化していた場合、別候補を誤クリックせず `UI_STATE_CHANGED` で停止します。

Google Mapsから読み取った文字列はすべて**信頼されていない外部データ**として扱います。MCPクライアント側でも命令ではなくデータとして扱ってください。

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
   CDP
    |
    v
Google Maps Web
```

通常の検索・経路表示は次の最短経路を使います。

```text
1 MCP call -> 1 Google公式Maps URL -> 1 CDP Page.navigate
```

ブラウザ操作は内部キューで直列化し、待ち行列にも上限を設けます。1操作が `MAPS_OPERATION_TIMEOUT_MS` を超えた場合はwatchdogがブラウザ/CDPセッションをリセットしてから次の操作へ進むため、1回のCDP停止でキュー全体が永久に詰まることを防ぎます。

詳細は [docs/architecture.md](docs/architecture.md) を参照してください。

## 必要環境

- Node.js 20以上
- Google Chrome または Chromium

macOS / Linux / Windowsの一般的なChromeインストール場所は自動検出します。必要なら `MAPS_CHROME_EXECUTABLE` を指定してください。

## インストール

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

本パッケージは `maps-browser-mcp` コマンドとして配布するCLIです。プロセスを起動するentrypointをライブラリexportとしては公開しません。

### stdio

```bash
npm start
```

### Streamable HTTP

```bash
npm run start:http
```

デフォルト:

```text
http://127.0.0.1:8787/mcp
```

HTTP entryは公式MCP TypeScript SDK v2のserver entryを使い、2025系の `initialize` 経路と、`2026-07-28` の `server/discover` / requestごとの `_meta` を使うmodern経路の両方に対応します。`/mcp` は `POST` のみ、`GET /mcp` は拒否します。`/healthz` は `GET` / `HEAD` に対応します。位置・経路情報を含み得るため、HTTP応答には `Cache-Control: no-store` を付与します。

## V3の画面読み取り

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Readerは全DOM、Accessibility Tree全体、生HTML、ネットワークレスポンス、レビュー本文を返しません。

1. 専用タブがGoogle Maps上にいることを確認
2. 検索/場所または経路/ルートのsemantic stateを確認
3. 選択処理と同じ限定ロジックで候補を抽出
4. `role=main` 領域だけを対象にする
5. Accessibility domainを読み取り中だけ有効化
6. ノード数・行数・文字数・1時間あたりの読み取り回数を制限
7. 制御文字・双方向テキスト制御文字を除去
8. 読み取り後すぐAccessibility domainを無効化

デフォルト:

```text
MAPS_MAX_AX_NODES=120
MAPS_MAX_READ_CHARS=1800
MAPS_MAX_VISIBLE_READS_PER_HOUR=30
```

V3読み取り上限は通常の1分あたり操作上限とは別です。ただし、これらのrate/read counterは**プロセス内の安全ガード**であり、プロセス再起動でリセットされます。永続的な利用量計測や法的コンプライアンス保証を目的にはしていません。

## 設定

サーバーは `.env` を自動ロードしません。シェルやプロセスマネージャーから設定してください。例は `.env.example` にあります。

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | HTTP port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | 許可Host名 |
| `MCP_ALLOWED_ORIGINS` | empty | Origin完全一致allowlist（任意） |
| `MCP_ALLOW_NONLOOPBACK` | `false` | 非loopback bindの明示Opt-in |
| `MCP_BEARER_TOKEN` | empty | Bearer token。非loopback時も必須、24文字以上 |
| `MCP_MAX_BODY_BYTES` | `262144` | MCP request body最大サイズ |
| `MAPS_CHROME_EXECUTABLE` | 自動検出 | Chrome / Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | 専用Chrome profile |
| `MAPS_ALLOW_EXTERNAL_CDP` | `false` | 既存CDP endpoint接続の明示Opt-in |
| `MAPS_CDP_PORT` | unset | 上級者向け: 既存ローカルCDP endpoint |
| `MAPS_HEADLESS` | `false` | headless mode |
| `INTERACTIVE_ASSIST_MODE` | `false` | V3読み取りを有効化 |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | プロセス内の操作上限 |
| `MAPS_MAX_VISIBLE_READS_PER_HOUR` | `30` | プロセス内のV3独立読み取り上限 |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | 待機可能なブラウザ操作数 |
| `MAPS_OPERATION_TIMEOUT_MS` | `25000` | 1操作のwatchdog。超過時にセッションをリセット |

不正なboolean/整数値は曖昧に解釈せず、起動時に失敗します。

### CDPの安全境界

`MAPS_CDP_PORT` は上級者向けのescape hatchです。`MAPS_ALLOW_EXTERNAL_CDP=true` がない限り拒否します。設定すると、MCPが自分で専用Chromeを起動せず、既に動作中の**ローカル**CDP endpointへ接続します。

普段使いの個人ブラウザへの接続は推奨しません。専用profileによる分離境界が弱くなるためです。

本プロジェクトが起動するChromeのremote debugging endpointは明示的に `127.0.0.1` へbindし、Unix系OSではprofileディレクトリを現在ユーザーだけがアクセスできる権限にします。既存の専用profileを再利用する場合は、Chromeの `DevToolsActivePort` に記録された**portとbrowser identityの両方**が現在のendpointと一致することを確認するため、古いファイルのport番号が偶然別Chromeに再利用されても誤接続しません。

また、専用profile内にGoogle Mapsタブが複数ある場合は、先頭タブを勝手に選ばず停止します。MCPで使うMapsタブは1枚にしてください。

## ChatGPTなどRemote MCP Clientから接続する場合

推奨構成は、Nodeサーバーをloopbackのままにして、`/mcp` の前段に認証付きHTTPS Tunnel / Reverse Proxyを置く形です。

1. Nodeサーバーはloopback bindのまま
2. 公開proxyのhostを `MCP_ALLOWED_HOSTS` に追加
3. HTTPS Tunnel / Reverse Proxy側で認証・アクセス制御
4. 必要なら追加防御として `MCP_BEARER_TOKEN`
5. credential / token / Chrome profile / ローカル環境値をcommitしない

意図的に非loopbackへbindする場合は、**`MCP_ALLOW_NONLOOPBACK=true` と24文字以上の `MCP_BEARER_TOKEN` の両方**が必須です。これは推奨構成ではなく上級者向けescape hatchです。Bearer tokenを暗号化されていないネットワーク経路へ流さず、外部到達トラフィックはTLS/HTTPSで保護してください。

## 安全性・利用方針

このプロジェクトはユーザーから明示的に依頼された操作を代行する**制約付きGoogle Mapsブラウザエージェント**です。

以下を目的にはしていません。

- Google Maps Platform APIの代替
- 汎用Browser MCP
- Google Mapsの大量スクレイピング
- 店舗・口コミ・経路データセットの収集
- CAPTCHA solver
- bot検知回避

Google Maps内部API、XHR/fetch収集、stealth plugin、fingerprint偽装、proxy rotation、Mapsデータセットの永続化は意図的に実装しません。

明らかな大量収集要求はPolicy Engineで拒否し、V3には独立したrolling hourly budgetを設け、遷移先はGoogle Maps web surfaceに限定します。アクセスチャレンジが表示された場合は自動突破せず、人間の操作が必要なエラーで停止します。

V3の限定読み取りはリスクを抑えた設計ですが、Googleがすべてのブラウザエージェント用途を明示的に許可しているわけではありません。利用者は適用されるGoogle Maps / Google規約と法令を確認する必要があります。詳細は [docs/compliance.md](docs/compliance.md) を参照してください。

## プライバシー

Google Maps結果の**データセット**を意図的に永続保存しません。一方、専用Chrome profile自体は継続利用できるようpersistentです。そのためChromeは通常のブラウザと同様に、cookie、cache、設定、閲覧履歴などのローカルbrowser artifactを保持する場合があります。

専用profileを使い、不要ならGoogleアカウントへログインせず、ローカルbrowser artifactを削除したい場合は専用profile自体を削除してください。

通常のツール処理では検索語やMaps結果本文をログ出力しません。Remote MCPクライアントには内部詳細を一般化したエラーとして返し、HTTP応答は `Cache-Control: no-store` にします。

Chrome profile、`.env`、Tunnel credential、token等をGitへcommitしないでください。

## 現在の制限

- Google MapsのUI変更により候補選択ロジックの保守が必要になる可能性があります。
- V3 Visible-State ReaderはExperimentalです。
- 現在は1人・1ローカルブラウザセッション向けで、マルチテナント共有ホスティング向けではありません。
- CAPTCHA、同意、ログイン画面を自動突破しません。
- 通常のpush / PR CIからGoogle Mapsへアクセスしません。`Live Maps E2E (manual)` だけがユーザーの明示操作時に固定・低ボリュームの実UI互換性確認を行います。

## 開発・検証

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

CIではNode.js 20 / 22 / 24、依存脆弱性、型チェック、Unit Test、Build、**2025系と2026-07-28系の両方のstdio round-trip**、9ツール登録、modern HTTPの `Mcp-Method` / `Mcp-Name` validationと実 `tools/call`、HTTPセキュリティ / `no-store`、npm package内容、実Chrome/Chromiumのheadless起動とCDP接続を検証します。Google Mapsへアクセスしないbrowser smokeはLinux、GitHub-hosted macOS 15 arm64、Windowsで実行します。GitHub Actionsは完全なcommit SHAへpinし、npmとActions依存はDependabotで監視します。

セキュリティ方針は [SECURITY.md](SECURITY.md) を参照してください。

## 免責事項

本プロジェクトは独立したOSSであり、Googleによる提供・承認・提携を受けたものではありません。Google Mapsその他の名称・商標は各権利者に帰属します。利用者は適用されるサービス規約および法令を遵守する責任があります。

## ライセンス

MIT
