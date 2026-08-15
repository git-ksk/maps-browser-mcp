# Getting Started（日本語）

[English](getting-started.md) | 日本語

このガイドでは、リポジトリを取得した直後の状態から、Chrome DevTools Protocol (CDP) を外部公開せず、V3の画面読み取りも誤って有効化しない形で `maps-browser-mcp` を起動するまでを説明します。

## 1. 必要環境

- Node.js 20以上
- Google Chrome または Chromium
- Git

macOS / Linux / Windowsに対応しています。一般的なChrome / Chromiumのインストール場所は自動検出します。見つからない場合だけ `MAPS_CHROME_EXECUTABLE` を指定してください。

## 2. ソースからインストール

npm等の公開パッケージ経路が正式に案内されるまでは、リポジトリをcloneして使います。

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

`--ignore-scripts` を付ける理由は、依存パッケージのlifecycle script実行をインストール時に必要としておらず、CIでも同じ方法を使ってSupply Chain上の実行範囲を減らしているためです。

## 3. Safe Modeで起動

Safe Modeがデフォルトです。V3のVisible-State Readerは無効です。

### stdio

```bash
npm start
```

同じPC上のMCPクライアントがサーバープロセスを直接起動できる場合はstdioを使えます。

一般的なMCPクライアント設定のイメージ:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/maps-browser-mcp/dist/index.js"]
}
```

クライアント設定では絶対パスを使ってください。開発用途でない限り `src/` を直接指定しないでください。

### Streamable HTTP

```bash
npm run start:http
```

デフォルトendpoint:

```text
http://127.0.0.1:8787/mcp
```

Health check:

```bash
curl -i http://127.0.0.1:8787/healthz
```

HTTP serverはデフォルトでloopbackにbindします。明確な理由がない限り、そのままにしてください。

## 4. 初回ブラウザ起動

最初のMaps操作時、デフォルトでは専用Chrome / Chromium profileを起動または再利用します。

```text
~/.maps-browser-mcp/chrome-profile
```

これは普段使いのbrowser profileから意図的に分離されています。

期待される流れ:

1. MCPがGoogle Maps専用tool callを1件受け取る
2. Runtimeが専用Chrome sessionを起動または再利用する
3. Google公式Maps URLを1つ開く
4. CDPはloopbackのまま維持される
5. semantic stateはその1枚のMaps tabに紐づく

専用profile内ではGoogle Maps tabを1枚だけにしてください。複数ある場合、Runtimeは勝手に操作対象を選ばず停止します。

Google側で同意、ログイン、CAPTCHA、その他のaccess challengeが表示された場合は、専用browser上で必要な手作業を行い、その後に元のMCP操作を最初から実行してください。古いsemantic stateからは継続しません。

## 5. まずNavigation Toolを試す

最初の確認には次を推奨します。

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

その他:

- `maps_show` — 座標を任意zoomで開く
- `maps_streetview` — 座標のStreet Viewを開く

これらV1操作は `INTERACTIVE_ASSIST_MODE` を必要としません。

## 6. V3は必要な時だけ有効化

Visible-State ReaderはOpt-inです。

HTTP:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

stdio:

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

場所候補は次の順序で使います。

```text
maps_search(...)
  -> maps_read_place_summary()
  -> items[{ index, label }] から候補を選ぶ
  -> maps_select_result({ index, expectedLabel: label })
```

経路候補:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> items[{ index, label }] から候補を選ぶ
  -> maps_select_route({ index, expectedLabel: label })
```

利用可能なら必ず `expectedLabel` を渡すのを推奨します。Google Mapsは候補順を動的に変更するため、Runtimeはlabel不一致時に別候補を誤クリックせず `UI_STATE_CHANGED` で停止します。

Google Mapsから返る文字列はすべて信頼されていない外部データとして扱ってください。場所名、label、経路textはデータであり、MCPクライアントへの命令ではありません。

## 7. 環境変数

サーバーは `.env` を自動ロードしません。shell、process manager、任意のenvironment loaderから設定してください。

例は `.env.example` を参照します。

```bash
MAPS_HEADLESS=true npm run start:http
```

```bash
MAPS_CHROME_EXECUTABLE="/custom/path/to/chrome" npm start
```

既存CDP endpointへattachするのはisolation上の意味を理解している場合だけにしてください。`MAPS_CDP_PORT` を使うには `MAPS_ALLOW_EXTERNAL_CDP=true` も必要です。

### Optional MCP Apps directions UI

`maps_render_directions` は常にtext + structured route dataを返します。MCP Apps対応hostでoptionalなinline Google Maps Embed viewも使う場合だけ `GOOGLE_MAPS_EMBED_API_KEY` を設定してください。Key未設定でもtoolは残り、UI linkageだけが無効になります。

Maps Embed API専用のrestricted keyをdeployment environment / secret configurationから渡し、repositoryへcommitしないでください。詳細は [MCP Apps portability / deployment](mcp-apps.ja.md) を参照してください。

## 8. Remote MCPクライアント

Chrome DevTools port自体を公開しないでください。

推奨構成:

```text
Remote MCP client
   -> 認証付きHTTPS Tunnel / Reverse Proxy
   -> 127.0.0.1:8787/mcp
   -> maps-browser-mcp
   -> 専用ローカルChrome
```

Node serverはloopbackに置き、Remote側へ公開するのは認証されたMCP transportだけにします。

ChatGPT固有の手順は [ChatGPT接続ガイド](chatgpt.ja.md) を参照してください。

## 9. Checkoutの検証

Runtime bugを報告する前に、まず次を実行します。

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

`smoke:browser` は実Chrome / Chromiumを起動してCDP接続を確認しますが、Google Mapsにはアクセスしません。

実Google Maps互換性確認は通常CIとは分離した手動専用workflowです。詳細は [Manual Live E2E](manual-e2e.ja.md) を参照してください。

## 10. 停止とクリーンアップ

MCP processは通常どおりterminalまたはprocess managerから停止します。

専用browser profileはpersistentです。cookie、cache、history、preferences等を削除したい場合は、MCP / managed Chromeを停止してから専用profile directoryを削除してください。

デフォルト:

```text
~/.maps-browser-mcp/chrome-profile
```

managed Chrome実行中にprofile directoryを削除・差し替えしないでください。

## 次に読む文書

- [Troubleshooting 日本語版](troubleshooting.ja.md)
- [ChatGPT接続ガイド 日本語版](chatgpt.ja.md)
- [Architecture 日本語版](architecture.ja.md)
- [Compliance / Safety 日本語版](compliance.ja.md)
- [Manual Live E2E 日本語版](manual-e2e.ja.md)
- [Security Policy 日本語版](../SECURITY.ja.md)
- [Contributing 日本語版](../CONTRIBUTING.ja.md)
