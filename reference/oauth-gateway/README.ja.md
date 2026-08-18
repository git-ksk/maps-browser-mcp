# Reference OAuth Gateway

このdirectoryは maps-browser-mcp Issue #74 のための、分離されたsingle-user OAuth reference gatewayです。Remote dogfood / reference deployment用であり、root npm packageには含めず、local / stdio利用にも必須ではありません。

```text
Remote MCP client
    |
    | HTTPS + OAuth access token
    v
reference/oauth-gateway  :8080
    |  public tokenを検証
    |  別のprivate bearerへ置換
    v
maps-browser-mcp core    127.0.0.1:8081
    |
    v
Dedicated Chromium profile
```

Reference imageではgatewayとcurrent checkoutのcoreを別processとして1つのsingle-user container内で動かします。Coreはloopbackだけでlistenし、public OAuth access tokenをcore/browser runtimeへ転送しません。

## Status / Boundary

対象は意図的に狭くしています。

- Firebase identityはimmutable UIDまたはverified emailのどちらかexact 1つ / logical user 1人
- gateway instance 1つ / browser runtime 1つ
- Authorization Code + PKCE `S256`
- `${MCP_PUBLIC_BASE_URL}/mcp` へのexact RFC 8707 resource binding
- Protected Resource Metadata + Authorization Server Metadata
- Client ID Metadata Documents (CIMD)。client host exact allowlist + SSRF-resistant metadata/JWKS fetch
- `private_key_jwt` client authentication
- Maps resource scopeは `maps:use` のみ
- `offline_access` はrefresh token用Authorization Server scopeだけ。resource-required scopeにはしない
- rotating refresh token + reuse時token-family revoke
- authorization responseの `iss`
- OAuth responseは `no-store`
- Firestore control-plane stateは `_mapsBrowserMcpRefOAuth...` prefixで旧PoCと分離

DCR、multi-user profile共有、generic browser automation、raw Google credential、public OAuth token passthroughは実装しません。

Initial reference gatewayでは `/takeover/*` もproxyしません。Remote/mobile Human Takeoverをpublic gatewayへ載せるには、別途authenticated browser-session boundaryが必要です。このdeploymentでは `MAPS_REMOTE_TAKEOVER=false` を維持します。Human Interventionとaction approvalの分離はcore側でそのまま維持されます。

## MCP Authorization整合

このreferenceはprojectが採用するMCP 2026-07-28 authorization shapeに合わせます。

- public Protected Resource MetadataからAuthorization Serverをadvertise
- 401 challengeに `resource_metadata` と `scope="maps:use"`
- authorization/token requestの両方でexact `resource` 必須
- PKCE `S256` 必須
- CIMD優先、DCR endpointなし
- `offline_access` はAuthorization Server側だけにadvertise
- access tokenはresource-boundで、private coreへtransitしない

## Required Environment

Gateway / OAuth:

```text
MCP_PUBLIC_BASE_URL=https://your-new-gateway.example.com
MCP_OAUTH_ALLOWED_CLIENT_HOSTS=chatgpt.com
MCP_OAUTH_TRANSACTION_SECRET=<32+ byte secret>
MCP_OAUTH_MAX_REQUESTS_PER_MINUTE=60

MCP_FIREBASE_PROJECT_ID=<project id>
MCP_FIREBASE_ALLOWED_UID=<exact immutable uid>
# または MCP_FIREBASE_ALLOWED_EMAIL=<exact single allowed email>。両方同時には設定しない。
MCP_FIREBASE_WEB_API_KEY=<Firebase web API key>
```

Private hop:

```text
MCP_CORE_URL=http://127.0.0.1:8081/mcp
MCP_CORE_BEARER_TOKEN=<24+ character independent random secret>
```

Core child processにはこのprivate secretを `MCP_BEARER_TOKEN` として渡します。OAuth access token / Firebase token / その他public credentialを再利用しないでください。

V5を使う場合もroot packageの既存gateをそのまま使います。

```text
INTERACTIVE_ASSIST_MODE=true
MAPS_V5_AUTHENTICATED_WORKFLOWS=true
```

## Firebase Setup

Firebase Authenticationはsingle human sign-in、FirestoreはOAuth control-plane stateだけに使います。Maps result datasetは保存しません。

1. 共通MCP Runtime identity projectでFirebase Email/Password Authenticationを有効化する。全MCPを同じimmutable human identityへbindする場合は `MCP_FIREBASE_ALLOWED_UID` を推奨し、email modeはisolated single-user deployment向けに残す
2. Firebase Web API keyを設定する。email/passwordはbrowserからFirebase Identity Toolkitへ直接送信し、password fieldは直後にclearする。Gatewayが受け取るのはshort-lived Firebase ID Tokenだけ
3. このMCP専用namespaceのOAuth control-plane state用にFirestoreを用意する
4. Firebase Auth verificationとこのMCPに必要なFirestore stateだけへアクセスできるper-MCP専用service accountで実行する
5. 必要なら `expiresAt` にFirestore TTLを設定する

共通MCP Runtime projectでは **human identityだけを一元化** する。OAuth code/token、private-hop bearer secret、service account、Firestore namespaceはMCPごとに分離し、別MCPのresource tokenを共有しない

Firebase credential、transaction secret、private core bearer、OAuth access/refresh token、browser profileをrepository/container imageへ入れないでください。

## Local Tests

Node 22以上が必要です。

```bash
cd reference/oauth-gateway
npm ci --ignore-scripts
npm test
```

PKCE、CIMD host/SSRF boundary、OAuth transaction integrity、scope metadata separation、private core URL、header allowlist、public-token stripping、private bearer replacement、private-core auth failure isolationを確認します。

## Container Build

Repository rootからbuildします。

```bash
docker build \
  -f reference/oauth-gateway/Dockerfile \
  -t maps-browser-mcp-oauth-reference .
```

Publicはgateway `8080` だけ。Coreはloopback `8081` + `static-bearer` に固定します。

## Cloud Run Dogfood

Historical `map-browser-mcp-test` は更新せず、**別serviceとして並行deploy**します。

推奨:

- dedicated service account
- secretはSecret Manager
- Chromium + Interactive Assistを同一Cloud Run instanceで動かす場合は `1` vCPU / **最低 `2Gi` memory**
- max instances `1`
- single-browser runtimeに合わせて concurrency `1`
- HTTPS only
- `MAPS_REMOTE_TAKEOVER` はbrowser-session auth boundaryが完成するまで無効

Reference deploymentではCloud Run default任せにせず、capacity boundaryを明示します:

```bash
gcloud run services update maps-browser-mcp \
  --cpu=1 \
  --memory=2Gi \
  --concurrency=1 \
  --max-instances=1
```

`1Gi` instanceではheadlessの `maps_search` + `maps_read_place_summary` を繰り返した際にmemory limitを超え、Cloud Runがcontainerを終了してHTTP `503` を返す事象を実観測しました。Remote MCP clientではこのtransport failureが `UNKNOWN` / TaskGroup系exceptionとして見えます。これはMCP process内でcatchすべきbounded-reader exceptionではなく、deployment capacity failureです。

Default container Chrome profileはephemeralです。OAuth/protocol dogfoodには使えますが、durableなsigned-in Maps stateではありません。Signed-in profile/cookie/account credentialをimageへ焼き込まないでください。Persistent authenticated Maps workflowが必要なら、V5 isolation ruleを維持できるcontrolled single-user runtimeでpersistent profile strategyを別途用意します。

## Migration / Validation Checklist

旧service retirement前に:

1. recorded maps-browser-mcp commitからbuild
2. distinct service name / URLへdeploy
3. Protected Resource Metadata / Authorization Server Metadata確認
4. unauthenticated `/mcp` のMaps-specific `WWW-Authenticate` 確認
5. authorization-code + PKCE + exact `resource` 確認
6. refresh rotation / `offline_access` 確認
7. public OAuth tokenがloopback coreへforwardされないことを確認
8. MCP interoperability / Inspector check
9. target ChatGPT app/clientでnew URLへ接続しreconnect/refresh確認
10. local/stdioが無影響であることを確認
11. historical serviceのlegitimate MCP/refresh traffic停止を確認
12. その後だけhistorical serviceをretire
