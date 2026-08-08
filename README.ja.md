# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

Google Maps Platform APIに依存せず、専用ブラウザセッションを通してGoogle Mapsを操作する軽量MCPサーバーです。

> **ステータス:** 初期開発段階。V1〜V3の機能は実装済みですが、Google MapsのUI構造に依存する操作はExperimentalです。

## できること

`maps-browser-mcp` は汎用ブラウザ操作ではなく、Google Maps向けの小さく明確なMCPツールだけを提供します。

- Google公式のMaps URLを使って検索・経路・地図・Street Viewを開く
- 専用Chrome / ChromiumプロファイルをChrome DevTools Protocol（CDP）で制御
- `click`、`type`、任意CSSセレクタ、任意JavaScript実行などの汎用ブラウザ機能をMCPに公開しない
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

## アーキテクチャ

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
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
```

### stdio

```bash
npm run dev
```

### Streamable HTTP

```bash
npm run dev:http
```

デフォルト:

```text
http://127.0.0.1:8787/mcp
```

## V3の画面読み取りを有効化

```bash
INTERACTIVE_ASSIST_MODE=true npm run dev:http
```

Readerは全DOMやAccessibility Tree全体を返しません。

1. Google Mapsの `role=main` 領域を取得
2. Accessibility domainを読み取り中だけ有効化
3. 最大ノード数まで探索
4. 必要そうなテキストだけ少数抽出
5. 最大文字数を強制
6. Accessibility domainをすぐ無効化

という制約付きの処理です。

デフォルト値:

```text
MAPS_MAX_AX_NODES=120
MAPS_MAX_READ_CHARS=1800
```

## 設定

`.env.example` に利用可能な環境変数を記載しています。サーバー自体は `.env` を自動ロードしないため、シェルやプロセスマネージャー等から設定してください。

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `8787` | HTTP port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1` | 許可するHost名 |
| `MCP_ALLOWED_ORIGINS` | empty | Origin allowlist（任意） |
| `MCP_BEARER_TOKEN` | empty | Bearer tokenガード（任意） |
| `MAPS_CHROME_EXECUTABLE` | 自動検出 | Chrome / Chromium executable |
| `MAPS_CHROME_PROFILE_DIR` | `~/.maps-browser-mcp/chrome-profile` | 専用Chrome profile |
| `MAPS_CDP_PORT` | unset | 既存CDP endpointを利用 |
| `MAPS_HEADLESS` | `false` | headless mode |
| `INTERACTIVE_ASSIST_MODE` | `false` | V3読み取りを有効化 |
| `MAPS_MAX_ACTIONS_PER_MINUTE` | `30` | 1分あたりの操作上限 |

## ChatGPTなどのRemote MCP Clientから接続する場合

サーバーはデフォルトでloopbackにだけbindします。ChatGPTなど外部のMCPクライアントから接続する場合は、`/mcp` の前段にHTTPS Tunnel / Reverse Proxyを置いてください。

その場合は最低限、

1. Nodeサーバー自体は可能な限りloopback bindのままにする
2. 公開ホスト名を `MCP_ALLOWED_HOSTS` に追加する
3. Tunnel / Reverse Proxy側で認証・アクセス制御する
4. Tunnel credential、token、Chrome profile、ローカル環境情報をGitへcommitしない

ことを推奨します。

`MCP_BEARER_TOKEN` も簡易ガードとして利用できますが、公開運用では適切なIdentity / Access Controlレイヤーを前段に置いてください。

## 安全性・利用方針

このプロジェクトは、ユーザーから明示的に依頼された操作を代行する**制約付きGoogle Mapsブラウザエージェント**として設計しています。

以下を目的にはしていません。

- Google Maps Platform APIの代替
- 汎用Browser MCP
- Google Mapsの大量スクレイピング
- 店舗・口コミ・経路データセットの収集
- CAPTCHA突破
- Bot検知回避

Google Maps内部APIの直接利用、XHR/fetchレスポンスの収集、Stealth Plugin、Fingerprint Spoofing、Proxy Rotation、Mapsデータの永続DB化も実装しません。

明らかな大量収集要求はPolicy Engine側で拒否し、ブラウザ遷移先もGoogle Maps面に限定します。Google側からCAPTCHA等のAccess Challengeが表示された場合は、自動突破せずユーザー操作を要求します。

詳細は [docs/compliance.md](docs/compliance.md) を参照してください。

## プライバシー

Google Mapsの検索結果データを永続保存する設計ではありません。ブラウザ状態は専用のローカルChrome profileに保持されます。また、通常のTool Handlerは検索ワードやMaps検索結果をログへ出力しません。

Chrome profile、`.env`、Tunnel credential、各種Tokenを公開リポジトリへcommitしないでください。

## 現在の制約

- Google MapsのUI変更により、候補選択ロジックの調整が必要になる可能性があります。
- V3 Visible-State ReaderはExperimentalで、意図的に取得量を小さく制限しています。
- 現在のプロセスモデルは基本的に1ユーザー・1ローカルブラウザセッション向けです。
- CAPTCHA・同意画面・ログイン画面は自動突破せず、人間の操作が必要になる場合があります。

## 開発

```bash
npm run typecheck
npm test
npm run build
```

`main`へのpushおよびPull Requestで、GitHub ActionsがTypeScript型チェック・Unit Test・Buildを実行します。

## 免責事項

本プロジェクトは独立したオープンソースプロジェクトであり、Googleによる公式提供・提携・推奨を受けたものではありません。Google Mapsおよび関連する名称・商標は各権利者に帰属します。利用者は適用される利用規約・法令を確認したうえで使用してください。

## License

MIT
