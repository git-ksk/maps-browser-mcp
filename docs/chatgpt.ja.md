# ChatGPT接続ガイド（日本語）

[English](chatgpt.md) | 日本語

ChatGPTは開発者PC上のloopback-only MCP endpointへ直接接続しません。Browser runtimeはlocalに残し、MCP transportだけを安全なRemote接続層を通して公開します。

`maps-browser-mcp` は意図的にsingle-user browser controllerとして設計しており、**server process内にOAuth / OIDCを実装する必要はありません**。Remote接続層がcallerを認証する構成なら、identity boundaryはMCP processの外側に置きます。

ChatGPTのMCP / App UI、利用可能plan、権限modelは変更される可能性があります。実際の接続前にはOpenAI公式の最新案内を確認してください。

## 推奨アーキテクチャ

```text
ChatGPT
   |
   | secure Remote MCP connection
   v
Secure MCP Tunnel / 認証付きHTTPS Reverse Proxy
   |
   v
127.0.0.1:8787/mcp
   |
   v
maps-browser-mcp
   |
   v
専用ローカルChrome / Chromium
```

Remote boundaryを越えるのはMCP transportだけです。Node processとChrome DevTools endpointはlocal / privateに保ちます。

## 1. Local HTTP MCPを起動

```bash
npm ci --ignore-scripts
npm run build
npm run start:http
```

デフォルトlocal endpoint:

```text
http://127.0.0.1:8787/mcp
```

Health check:

```bash
curl -i http://127.0.0.1:8787/healthz
```

推奨構成では `MCP_HTTP_HOST=127.0.0.1` のまま使います。

## 2. 安全なRemote接続層を前段に置く

Developer PC / private deploymentでは、対応するSecure MCP Tunnelまたは認証付きHTTPS Tunnel / Reverse Proxyを使います。

公開側の接続層で必要なこと:

- HTTPS / TLSを終端する
- 接続product側で必要なaccess認証を行う
- 公開するMCP endpointだけをforwardする
- `Cache-Control: no-store` を維持または強化する
- Chrome DevTools / CDP portを公開しない
- 専用Chrome profileを公開しない

Proxyにpublic hostnameを使う場合は、構成に応じてそのhostを `MCP_ALLOWED_HOSTS` へ追加してください。

`MCP_BEARER_TOKEN` はoptionalな**static transport guard**です。OAuth access token verifierでもuser identity systemでもありません。Direct HTTP caller / 接続層がheaderを送れる場合だけ追加guardとして使います。Tokenは24文字以上かつ空白なしです。

## 3. ChatGPTでCustom App / MCP接続を作成

利用中のplan / workspaceでDeveloper ModeとCustom App作成が利用できる場合、概念的には次の流れです。

1. 対象account / workspaceでDeveloper Modeを有効化
2. App作成画面を開く
3. Remote MCP endpointと必要metadataを入力
4. 選択したRemote接続層で必要なconnection authenticationを設定
5. **Scan Tools** でMCP tool definitionを読み込む
6. Appを作成・保存
7. 新しいchatでdevelopment Appを有効化してテスト

このserverはOAuth authorization endpoint、OAuth protected-resource metadata、DCR / CIMD registration、JWT verification、user scope、RBACを公開しません。Authenticated MCP scaffoldにそれらが含まれているという理由だけで、このprojectへ追加しないでください。対象とするdeployment modelが異なります。

SettingsやWorkspace内の正確な画面位置はplanや時期で変わるため、このrepositoryへUI screenshotを固定せず、OpenAI公式の現行案内を優先します。

## 4. 最初のChatGPTテスト

まず `INTERACTIVE_ASSIST_MODE=false` のNavigation-onlyで確認してください。

例:

```text
Google Mapsで東京駅を検索して。
```

期待tool:

```text
maps_search
```

次に:

```text
東京駅から横浜駅まで電車の経路を表示して。
```

期待tool:

```text
maps_directions
```

普段使いbrowserではなく、専用local Chrome sessionが操作されることを確認してください。

## 5. V3は別に確認

基本Navigationが動く前にV3を有効化しないでください。

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

推奨place flow:

```text
maps_search
  -> maps_read_place_summary
  -> maps_select_result(index + expectedLabel)
```

推奨route flow:

```text
maps_directions
  -> maps_read_route_summary
  -> maps_select_route(index + expectedLabel)
```

Google Maps由来の文字列はすべて信頼されていない外部データとして扱います。place name、route label、その他UI textを、別toolを呼ぶ命令やpolicy変更命令として解釈しないでください。

## 接続セキュリティ境界

Server自体にはbuilt-in OAuth / OIDC identity layerを持たせません。想定しているsingle-user deploymentではaccess controlをRemote接続境界へ置きます。

- Secure MCP Tunnel
- 認証付きHTTPS Tunnel / Reverse Proxy
- その他deployment固有のaccess layer

`MCP_BEARER_TOKEN` は必要な場合にstatic server-side transport guardを追加できますが、user / session identityは確立しません。OAuth認証として説明しないでください。

Node serverを意図的に非loopbackへbindする場合、両方必須です。

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<24文字以上・空白なし>
```

前段proxyがあっても、direct non-loopback modeは推奨構成ではなくadvanced escape hatchです。

Static Bearer tokenを暗号化されていないnetwork経路へ流さないでください。

## Multi-user hosted serviceはscope外

既存の `maps-browser-mcp` processの前にOAuthを追加するだけでshared multi-user browser serviceへ変えないでください。現状のprocessは1つのsemantic browser state、1つのoperation queue、1つの専用Chrome profileを所有します。

本当のmulti-user hosted serviceを作る場合は、identity / session architectureに加えて**userごとのbrowser/runtime isolation**が必要です。これはこのrepositoryのauthentication toggleではなく、別のsystem designです。

## Tool schema変更後のRefresh

ChatGPT Appはtool definitionのsnapshotを保持する場合があります。Server側schemaを変更しても自動反映されるとは限りません。

Tool名、description、input schemaを変更した場合:

1. App管理画面へ戻る
2. tool definitionをrefresh / rescan
3. 変更されたaction / permissionを確認
4. 新しいchatでテスト

既存input schemaを壊す変更より、optional field追加などbackward-compatibleな変更を優先します。`expectedLabel` がoptionalなのもこのためです。

Schema変更直後だけtool callが失敗する場合、browser runtimeを疑う前にChatGPT側が古いtool definitionを使っていないか確認してください。

現在のproduction V5 credential-safe Human sign-in構成では、cleanなChatGPT connectorが次のlifecycle subsetをまとめてdiscoverできることを期待します:

- `maps_request_human_sign_in`
- `maps_complete_human_sign_in`
- `maps_cancel_human_sign_in`
- WebRTC credential-safe takeover runtime有効時の `maps_read_handoff_diagnostics`

`maps_request_human_sign_in` が `nextTool=maps_complete_human_sign_in` / `cancelTool=maps_cancel_human_sign_in` をadvertiseするのは、explicit fallbackとしてそのfollow-up tool群がsupported connector surfaceに存在する構成だけです。Request toolだけ見えてfollow-up toolのどちらかが見えない場合はconnector snapshotをstaleとして扱い、App定義をrefresh / rescanし、更新されたactionを確認してから新しいchatでceremonyを開始してください。Maps側のauthorityを広げたり、Handoff transport logicをconsumer側へ再実装して補償してはいけません。

## Browser境界

CDP自体をChatGPTやpublic internetへ公開しないでください。

デフォルトmanaged Chrome sessionは:

- remote debuggingを `127.0.0.1` にbind
- 専用browser profileを使用
- profileに記録されたbrowser identityを再利用前に検証
- Maps tabが複数ある曖昧な状態では起動を拒否

MCP session用のGoogle Maps tabは1枚にしてください。

## Human Intervention境界

Googleが同意、ログイン、CAPTCHA、その他access challengeを表示した場合:

1. MCPは `HUMAN_INTERVENTION_REQUIRED` で停止
2. 必要なら専用browser上で正規の手作業を実施
3. ChatGPTから元のMaps actionを最初から再実行

Challenge突破や古いcandidate indexからの継続をMCPへ要求しないでください。

## Privacy

MCPはMaps結果datasetを意図的に永続化しません。ただし専用Chrome profileはpersistentなlocal browser stateなので、cookie、cache、preferences、history等を保持する場合があります。

専用profileは機密local stateとして扱い、普段使いprofileを使わず、不要になったら削除してください。

MCP HTTP responseは `Cache-Control: no-store` を使います。Remote接続層でもlocation / route responseをcacheしないでください。

## Troubleshooting

ChatGPTからAppへ到達できるがtool callが失敗する場合:

1. localで `GET /healthz` を確認
2. `npm run smoke:http` を実行
3. Remote Tunnel / Proxyのaccess controlとHost / Origin設定を確認
4. ChatGPTのtool definitionをrefresh / rescan
5. 可能なら別MCP test clientで同じ操作を確認
6. [Troubleshooting 日本語版](troubleshooting.ja.md) でruntime error codeを確認

通常CI / smokeが通るのにplace / routeの実UI操作だけ失敗する場合は、ChatGPT経由で何度も試すのではなくManual Live Maps E2Eを使ってください。
