# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

Google Maps Platform APIに依存せず、専用ブラウザセッションを通してGoogle Mapsを操作する軽量MCPサーバーです。

> **ステータス:** 初期開発段階。V1〜V3は実装済みですが、Google MapsのUI構造に依存する操作はExperimentalです。

## できること

`maps-browser-mcp` は汎用ブラウザ操作ではなく、Google Maps向けの小さく明確なMCPツールだけを提供します。

- Google公式のMaps URLを使って検索・経路・地図・Street Viewを開く
- 専用Chrome / ChromiumプロファイルをChrome DevTools Protocol（CDP）で制御
- 任意の `click`、`type`、CSSセレクタ、JavaScript実行などをMCPツールとして公開しない
- 表示中の場所候補・経路候補を限定的に選択
- オプションで現在のMaps画面から小さく制限された要約を取得
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

画面読み取りは**デフォルトOFF**です。利用する場合のみ `INTERACTIVE_ASSIST_MODE=true` を明示的に設定します。

Readerは `items[{ index, label }]` と、少数の関連UIテキストを返します。候補を選択するときは、可能ならReaderが返した `label` を `expectedLabel` として一緒に渡してください。Google Maps側で候補順が変わっていた場合、別候補を誤クリックせず `UI_STATE_CHANGED` で停止します。

Google Mapsから読み取った文字列はすべて**信頼されていない外部データ**として返します。MCPクライアント側でも命令として扱わず、単なるデータとして扱ってください。

## アーキテクチャ

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
    +-- Operation Queue
    +-- Semantic UI Controller
    +-- Bounded Visible-State Reader（optional）
    |
    v
専用 Chrome / Chromium
    |
   CDP
    |
    v
Google Maps Web
```

通常の検索・経路表示は、できるだけ次の最短経路を使います。

```text
1 MCP call -> 1 Google公式Maps URL -> 1 CDP Page.navigate
```

1プロセスで1つのブラウザタブを操作するため、ブラウザ操作は内部キューで直列化します。キューにも上限を設け、同時リクエストによる画面競合や無制限な待ち行列を防ぎます。

詳細は [docs/architecture.md](docs/architecture.md) を参照してください。

## 必要環境

- Node.js 20以上
- Google Chrome または Chromium

macOS / Linux / Windowsの一般的なChromeインストール場所は自動検出します。必要なら `MAPS_CHROME_EXECUTABLE` を指定してください。

## インストール

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm install
npm run build
```

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

HTTP transportはMCP 2026-07-28の形に合わせ、`/mcp` は `POST` のみ受け付けます。`GET /mcp` は拒否します。`/healthz` は `GET` / `HEAD` に対応します。

## V3の画面読み取りを有効化

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

Readerは全DOM、Accessibility Tree全体、生HTML、ネットワークレスポンス、レビュー本文を返しません。

1. 専用タブが現在もGoogle Maps上にいることを確認
2. 検索/場所、または経路/ルートの有効な画面状態を確認
3. 選択処理と同じ限定ロジックで候補一覧を抽出
4. Google Mapsの `role=main` 領域だけを対象にする
5. Accessibility domainを読み取り中だけ有効化
6. ノード数・行数・文字数を制限
7. 制御文字や双方向テキスト制御文字を除去
8. 読み取り後すぐAccessibility domainを無効化

という制約付きの処理です。

デフォルト値:

```text
MAPS_MAX_AX_NODES=120
MAPS_MAX_READ_CHARS=1800
```

## 設定

サーバーは `.env` を自動ロードしません。シェル、プロセスマネージャー等から設定してください。利用可能な値は `.env.example` にも記載しています。

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | HTTP port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | 許可するHost名 |
| `MCP_ALLOWED_ORIGINS` | empty | Origin完全一致allowlist（任意） |
| `MCP_BEARER_TOKEN` | empty | Bearer tokenガード。設定時は24文字以上 |
| `MCP_TRUST_EXTERNAL_AUTH` | `false` | 前段proxyで認証済みであることを明示的に信頼 |
| `MCP_MAX_BODY_BYTES` | `262144` | MCP request bodyの最大サイズ |
| `MAPS_CHROME_EXECUTABLE` | 自動検出 | Chrome / Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | 専用Chrome profile |
| `MAPS_CDP_PORT` | unset | 上級者向け: 既存のローカルCDP endpointへ接続 |
| `MAPS_HEADLESS` | `false` | headless mode |
| `INTERACTIVE_ASSIST_MODE` | `false` | V3読み取りを有効化 |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | 1分あたりの操作上限 |
| `MAPS_MAX_PENDING_ACTIONS` | `8` | 待機可能なブラウザ操作数 |

booleanや整数に不正な値が指定された場合は、曖昧に解釈せず起動時にエラーにします。

### `MAPS_CDP_PORT` の注意

`MAPS_CDP_PORT` は上級者向けのescape hatchです。設定すると、MCPが自分で専用Chromeプロファイルを起動せず、既に動いているローカルChrome / ChromiumのCDP endpointへ接続します。

**普段使いの個人ブラウザへ接続するのは推奨しません。** 専用profileによる分離境界が弱くなるため、自分で管理している専用CDP endpointだけを指定してください。

## ChatGPTなどのRemote MCP Clientから接続する場合

サーバーはデフォルトでloopbackにだけbindします。ChatGPTなど外部のMCPクライアントから接続する場合は、`/mcp` の前段にHTTPS Tunnel / Reverse Proxyを置いてください。

推奨構成:

1. Nodeサーバー自体は可能な限りloopback bindのままにする
2. 公開proxyのホスト名を `MCP_ALLOWED_HOSTS` に追加する
3. Tunnel / Reverse Proxy側で認証・アクセス制御する
4. 必要なら追加防御として `MCP_BEARER_TOKEN` も利用する
5. Tunnel credential、token、Chrome profile、ローカル環境情報をGitへcommitしない

非loopbackの `MCP_HTTP_HOST` は、`MCP_BEARER_TOKEN` が設定されているか、`MCP_TRUST_EXTERNAL_AUTH=true` を明示しない限り起動を拒否します。

## 安全性・利用方針

このプロジェクトは、ユーザーから明示的に依頼された操作を代行する**制約付きGoogle Mapsブラウザエージェント**として設計しています。

以下を目的にはしていません。

- Google Maps Platform APIの代替
- 汎用Browser MCP
- Google Mapsの大量スクレイピング
- 店舗・口コミ・経路データセットの収集
- CAPTCHA solver
- bot検知回避

Google Maps内部API、XHR/fetchの収集、stealth plugin、fingerprint偽装、proxy rotation、Mapsデータの永続データセット化は意図的に実装しません。

明らかな大量収集要求はサーバー側Policy Engineで拒否し、遷移先はGoogle Maps web surfaceに限定します。Googleがアクセスチャレンジを表示した場合は自動突破せず、人間の操作が必要なエラーで停止します。

V3の限定読み取りはリスクを抑えた設計ですが、Googleがすべてのブラウザエージェント用途を明示的に許可しているわけではありません。利用者はGoogle Maps / Googleの適用規約および法令を確認する必要があります。詳細は [docs/compliance.md](docs/compliance.md) を参照してください。

## プライバシー

Google Mapsの検索結果を意図的に永続保存しません。ブラウザ状態はローカルの専用Chrome profile内にあります。通常のツール処理では検索語やMapsの結果本文をログ出力しません。

予期しない内部エラーの詳細はローカルログにだけ出し、Remote MCPクライアントには一般化したエラーを返すことで、ローカルパスや環境情報の漏えいを避けます。

Chrome profile、`.env`、Tunnel credential、token等をGitへcommitしないでください。

## 現在の制限

- Google MapsのUI構造変更により、候補選択ロジックのメンテナンスが必要になる可能性があります。
- V3 Visible-State ReaderはExperimentalです。
- 現在のプロセスモデルは1人・1ローカルブラウザセッション向けで、マルチテナント共有ホスティング向けではありません。
- CAPTCHA、同意、ログイン画面を自動突破しません。必要に応じて専用ブラウザ上で手動操作してください。
- CIからGoogle Mapsページへ自動アクセスすることは意図的に行いません。そのため、実際のMaps UIとの互換性はリリース前にユーザー指示による実E2E確認が必要です。

## 開発・検証

```bash
npm run typecheck
npm test
npm run build
npm run smoke:http
npm run smoke:browser
```

CIではNode.js 20 / 22 / 24、依存脆弱性、型チェック、Unit Test、Build、MCP HTTP initializeとHTTPセキュリティ、実Chrome/Chromiumのheadless起動とCDP接続（Google Mapsにはアクセスしない）、npm package内容を検証します。

セキュリティ方針は [SECURITY.md](SECURITY.md) を参照してください。

## 免責事項

本プロジェクトは独立したオープンソースプロジェクトであり、Googleによる提供・承認・提携を受けたものではありません。Google Mapsその他の名称・商標は各権利者に帰属します。利用者は適用されるサービス利用規約および法令を遵守する責任があります。

## ライセンス

MIT
