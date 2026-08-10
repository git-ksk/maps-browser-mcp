# ChatGPT接続ガイド（日本語）

[English](chatgpt.md) | 日本語

`maps-browser-mcp` はsingle-userのbrowser controllerです。HTTP endpointの置き場所に応じて、認証は2つの形を使えます。

- **Local / private transport:** 従来どおりlocal/stdioを使い、Remote accessの認証境界はMCP processの外側に置く。
- **Public single-user HTTP:** HTTP auth provider moduleを明示的に有効化する。Repositoryには、MCP OAuth discovery、CIMD、`private_key_jwt`、PKCE、refresh rotation、Firebase UID allowlistを実装したexperimentalなFirebase adapterを同梱する。

どちらも1つのbrowser processをmulti-user serviceには変えません。

ChatGPTのMCP / App UI、利用可能plan、権限modelは変更される可能性があります。実際の接続前にはOpenAI公式の最新案内を確認してください: [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt)

## Mode A: Local / private transport

Developer machineではこの構成を推奨します。

```text
ChatGPT / MCP client
   |
   | secure remote connection layer
   v
Secure MCP Tunnel / 認証付きHTTPS reverse proxy
   |
   v
127.0.0.1:8787/mcp
   |
   v
maps-browser-mcp -> 専用Chrome / Chromium
```

通常起動:

```bash
npm ci --ignore-scripts
npm run build
npm run start:http
```

`MCP_BEARER_TOKEN` はoptionalな**static transport guard**として残ります。OAuth identityではありません。従来どおり `MCP_BEARER_TOKEN` だけを設定した構成は、自動的にbuilt-in `static-bearer` providerとして扱われます。

## Mode B: Public single-user OAuth

Public Remote MCPで実際のMCP client/userを認証する場合はmodule authを選択します。

```text
MCP_AUTH_PROVIDER=module
MCP_AUTH_PROVIDER_MODULE=file:///app/adapters/auth-firebase/index.mjs
MCP_HTTP_HOST=0.0.0.0
MCP_ALLOW_NONLOOPBACK=true
```

その上でoptional Firebase adapterを設定します。詳細は [`adapters/auth-firebase/README.md`](../adapters/auth-firebase/README.md) を参照してください。

Adapterは以下を公開・実装します。

- Protected Resource Metadata
- Authorization Server Metadata
- `client_id_metadata_document_supported=true`
- `private_key_jwt`
- PKCE `S256`
- `authorization_code` / `refresh_token`
- Authorization Server側の `maps:use` / `offline_access`
- RFC 9207のauthorization response `iss`

**DCR registration endpointは意図的に公開しません。** CIMDのclient metadata URLはuntrusted inputとして扱い、取得前にexact hostname allowlistとDNS/IP SSRF防御を通します。

Firebase loginは設定された `MCP_FIREBASE_ALLOWED_UID` だけ許可します。OAuth access/refresh stateはFirestoreへ保存しますが、Google Mapsの結果datasetは保存しません。

Module OAuthと `MCP_BEARER_TOKEN` は同時設定しないでください。どちらも `Authorization` headerを使うため、serverはこの組み合わせを起動時に拒否します。

## ChatGPT OAuthの注意点

OpenAIの現行案内では、OAuthを使うCustom MCP Appで接続を維持するにはrefresh tokenが重要で、`offline_access`（またはprovider相当）をdiscovery metadataへ出すことが案内されています。このFirebase adapterもその形に合わせています。

ChatGPTのclient metadata URLやUIの細部は変更される可能性があります。`MCP_OAUTH_ALLOWED_CLIENT_HOSTS` には、接続時に実際に使われるCIMD `client_id` URLの**exact hostname**だけを設定してください。接続を通す目的でwildcardへ広げないでください。

Firebase adapterはpublic container + ChatGPTのlive dogfoodが完了するまではrepository-local / experimental扱いです。検証前にproduction-provenとは扱いません。

## 最初の機能テスト

まず `INTERACTIVE_ASSIST_MODE=false` のnavigation-onlyで確認します。

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

基本navigationが動いてからV3を有効化します。

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

推奨bounded flow:

```text
maps_search
  -> maps_read_place_summary
  -> maps_select_result(index + expectedLabel)

maps_directions
  -> maps_read_route_summary
  -> maps_select_route(index + expectedLabel)
```

Google Maps由来の文字列はすべてuntrusted external dataとして扱い、別toolの呼び出し命令やpolicy変更命令として解釈しません。

## Multi-user hosted serviceはscope外

OAuthはaccess gateであり、browser state isolationではありません。現在のprocessは1つのsemantic browser state、1つのoperation queue、1つの専用Chrome profileを所有します。

本当のmulti-user hosted serviceにはuserごとのbrowser/runtime/profile isolationが必要です。OAuthを有効にしただけで、無関係な複数ユーザーへ同じprocess/profileを共有しないでください。

## Browser / Privacy境界

Chrome DevTools/CDP portや専用Chrome profileをChatGPT/public internetへ公開しません。MCPはMaps結果datasetを意図的に永続化しませんが、専用browser profileには通常のcookie、cache、preferences、history等が残る場合があります。

MCP HTTP responseは `Cache-Control: no-store` を使います。Remote infrastructureでもlocation / route responseをcacheしないでください。

Googleが同意、ログイン、CAPTCHA、その他access challengeを表示した場合、MCPは `HUMAN_INTERVENTION_REQUIRED` で停止します。正規の手作業を専用browserで行ってから再試行し、challenge bypassを追加しません。

## Tool refresh / Troubleshooting

Tool名、description、input schemaを変更した場合は、browser runtimeを疑う前にChatGPT側のtool definitionをrefresh / rescanします。

ChatGPTからAppへ到達できるのにcallが失敗する場合:

1. `GET /healthz` を確認
2. 認証付き `GET /readyz` を確認
3. `npm run smoke:http` を実行
4. OAuth metadataとexact CIMD client-host allowlistを確認
5. ChatGPTのtool definitionをrefresh / rescan
6. [Troubleshooting 日本語版](troubleshooting.ja.md) でruntime error codeを確認
