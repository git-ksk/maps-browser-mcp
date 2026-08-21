# Reference OAuth Gateway

このdirectoryは maps-browser-mcp Issue #74 のための、分離されたsingle-user OAuth reference gatewayです。Remote dogfood / reference deployment用であり、root npm packageには含めず、local / stdio利用にも必須ではありません。

OAuth protocol/token stateとHuman Takeover operator boundaryをMaps browser runtimeの外へ分離します。

```text
Remote MCP client                         Human operator / mobile browser
    |                                                  |
    | HTTPS + OAuth access token                       | HTTPS + operator session
    v                                                  v
reference/oauth-gateway  :8080  <---------------- /takeover/*
    | public MCP tokenを検証                           |
    | allowed Human operatorを検証                     |
    | public側credentialを捨てて                       |
    | independent private core bearerへ置換            |
    v                                                  v
maps-browser-mcp core    127.0.0.1:8081
    |
    v
Dedicated Chromium profile
```

Reference imageではgatewayとcurrent checkoutのcoreを別processとして1つのsingle-user container内で動かします。Coreはloopbackだけでlistenします。Public OAuth token、operator cookie、Firebase credential、takeover locatorをcore/browser credentialとして転送せず、gatewayが独立したprivate core bearerだけを注入します。

## Status / Boundary

対象は意図的に狭くしています。

- Firebase identityはimmutable UIDまたはverified emailのどちらかexact 1つ / logical user 1人
- gateway instance 1つ / browser runtime 1つ
- Authorization Code + PKCE `S256`
- `${MCP_PUBLIC_BASE_URL}/mcp` へのexact RFC 8707 resource binding
- Protected Resource Metadata + Authorization Server Metadata
- Client ID Metadata Documents (CIMD)、client host exact allowlist、SSRF-resistant metadata/JWKS fetch
- `private_key_jwt` client authentication
- Maps resource scopeは `maps:use` のみ
- `offline_access` はrefresh token用Authorization Server scopeだけ
- rotating refresh token + reuse時token-family revoke
- authorization responseの `iss`
- OAuth responseは `no-store`
- Firestore control-plane stateは `_mapsBrowserMcpRefOAuth...` prefix
- credential-safe takeover用のoptional remote/mobile `/takeover/*` proxy
- `/takeover` は別のshort-lived Human operator sessionで保護
- operator cookieはHttpOnly / Secure / SameSite=Strict / Path=`/takeover` / account-bound / signed / short-lived
- public/operator Authorization/Cookie headerはloopback coreへ渡さない
- Handoff brokerに必要なbounded takeover headerだけallowlistでforward
- frame streamはgatewayで意図的にbuffer/persistせずstreamingのまま通す

DCR、multi-user profile共有、generic browser automation、raw Google credential、locator URLへのtakeover capability埋め込み、public OAuth token passthrough、CAPTCHA bypass、passkey/WebAuthn proxyは実装しません。

## Remote / Mobile Credential-safe Takeover

`MAPS_REMOTE_TAKEOVER=true` の場合、loopback brokerを直接public exposeせず、同じpublic gateway origin上でcredential-safe Handoff operator surfaceを提供できます。

有効な `/takeover/<opaque-id>` を開いただけではbrowser controlは付与されません。Operator sessionが無ければsingle-user Firebase authorization pageを表示します。Email/passwordはbrowserからFirebase Identity Toolkitへ直接送り、password fieldをclearします。Gatewayはshort-lived Firebase ID Tokenだけを受け取り、configured allowed accountを検証した後、短命な `/takeover` operator cookieを発行します。

Operator認証後に同じlocatorをreloadし、gatewayがprivate bearerへ置換してbounded broker page/APIをloopback coreへproxyします。Core側のHandoff session capability、client binding、principal/intervention/epoch fencing、one-live-client、same-origin input、Done/revoke、active stream abortはそのまま有効です。

このoperator loginはgateway access用です。Dedicated Chromium内で行う **target Google account** のsign-inとは別物です。Target Google password/MFA/passkey materialをgateway、MCP request、model context、log、argv、repository artifactへ入れません。

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

Remote/mobile WebRTC Takeover:

```text
MAPS_REMOTE_TAKEOVER=true
MAPS_TAKEOVER_PUBLIC_BASE_URL=https://your-new-gateway.example.com
MCP_TAKEOVER_OPERATOR_SECRET=<independent 32+ byte secret>
MCP_TAKEOVER_OPERATOR_SESSION_SECONDS=900
MAPS_CREDENTIAL_SAFE_HANDOFF=true
MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover
MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99
MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE=/app/node_modules/.bin/handoff-linux-webrtc-host
```

reference containerは `webrtc_takeover` 選択時だけisolated local Xvfb/Openbox surfaceを起動します。X11 TCP listenerは開かず、Handoffはnormal browserのexact PID/windowだけへcapture/inputをscopeします。

`MCP_TAKEOVER_OPERATOR_SECRET` と `MCP_OAUTH_TRANSACTION_SECRET` は別secretにしてください。Core child processへHTTP authとして渡すのは `MCP_CORE_BEARER_TOKEN` だけです。

Controlled V5 signed-out acceptanceでは:

```text
INTERACTIVE_ASSIST_MODE=true
MAPS_V5_AUTHENTICATED_WORKFLOWS=true
```

通常利用のChrome profileではなく、V5用disposable/dedicated profileだけで使います。

## Firebase Setup

Firebase Authenticationはpublic OAuth authorizationと、remote takeover有効時のsingle Human operator authorizationに使います。FirestoreはOAuth control-plane stateだけです。Maps result、target Google credential、takeover frameは保存しません。

1. Firebase Email/Password Authenticationを有効化。全MCPを同じimmutable human identityへbindする場合は `MCP_FIREBASE_ALLOWED_UID` 推奨
2. Firebase Web API keyを設定。Email/passwordはbrowserからIdentity Toolkitへ直接送信し、gatewayが受け取るのはshort-lived ID Tokenだけ
3. このMCP専用namespaceのOAuth control-plane state用にFirestoreを用意
4. Firebase Auth verificationと必要なFirestore stateだけへアクセスできるper-MCP service accountで実行
5. 必要なら `expiresAt` にFirestore TTLを設定

共通MCP Runtime projectでは **human identityだけを一元化** し、OAuth code/token、private bearer、operator signing secret、service account、Firestore namespaceはMCPごとに分離します。

Firebase credential、transaction/operator secret、private core bearer、OAuth access/refresh token、target Google credential、browser profileをrepository/container imageへ入れないでください。

## Local Tests

Node 22以上が必要です。

```bash
cd reference/oauth-gateway
npm ci --ignore-scripts
npm test
```

PKCE、CIMD host/SSRF boundary、OAuth transaction integrity、private-core URL、public-token stripping、private bearer replacementに加え、operator-session tamper/expiry、takeover header allowlist、Cookie/Auth stripping、stream passthroughも確認します。

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
- Chromium + Interactive Assistを同一Cloud Run instanceで動かす場合は `1` vCPU / 最低 `2Gi` memory
- max instances `1`
- concurrency `1`
- HTTPS only
- core `8081` は外部公開しない
- `MAPS_TAKEOVER_PUBLIC_BASE_URL` はpublic gatewayと同一origin
- remote takeoverはsingle-user controlled deploymentだけで有効化し、`MCP_TAKEOVER_OPERATOR_SECRET` を設定
- maintainerの通常Chrome profileやsigned-in profile/cookieをimageへ焼き込まない

```bash
gcloud run services update maps-browser-mcp \
  --cpu=1 \
  --memory=2Gi \
  --concurrency=1 \
  --max-instances=1
```

`1Gi` instanceではheadless `maps_search` + `maps_read_place_summary` の繰り返しでmemory limitを超えHTTP `503` になった実測があります。Remote MCP clientではこのtransport failureが `UNKNOWN` / TaskGroup系exceptionとして見えます。これはdeployment capacity failureです。

Default container Chrome profileはephemeralです。Protocol/transport dogfoodやdisposable signed-out Google acceptanceには使えますが、durable signed-in Maps stateではありません。

## Googleログイン直前のAcceptance Checklist

Target Google credentialを入力する前に:

1. PR #107のrecorded commitからdistinct single-user gatewayへbuild/deploy
2. remote takeover設定とindependent secretをSecret Managerで構成
3. `/mcp` OAuthが継続動作し、public OAuth tokenがcoreへ届かないことを確認
4. benign Human interventionを作り、予定しているmobile browserから `/takeover/<id>` を開く
5. broker page表示前にoperator loginが必須であることを確認
6. operator cookie/Firebase ID Tokenがcoreへforwardされないことを確認
7. benign allowed surfaceでpush frame、tap/scroll/text/keyを確認
8. slow/recreated clientがfail closed、またはHandoff reconnect ruleでのみrecoverすることを確認
9. Done/revokeでactive frame streamが閉じ、stale capability/client generationが使えないことを確認
10. fresh Agent-owned CDP reattachとfresh readiness必須を確認
11. ここまで通ってから maps-browser-mcp #104 をdisposable dedicated `signed_out` profileで実行

実際のtarget Google sign-inはHuman acceptanceであり、このgatewayでは自動化しません。

## Cloud Runでsigned-in Chrome profileだけを永続化

single-user本番構成では、永続化対象を**専用Chrome profileだけ**に限定します。Browser/action/Handoffの途中状態は保存せず、Cloud Run再起動後はfreshなMaps navigationとsemantic revalidationから冪等に再実行します。

Chromiumのlive profile filesystemとしてCloud Storage FUSEやNFSは使いません。実行中は従来どおりlocal ephemeralな `MAPS_CHROME_PROFILE_DIR` を使用し、deployment layerがprivate core起動前に停止済みprofile archiveをrestoreし、Chromiumがprofile ownershipを手放した安全点だけでcheckpointします。

Cloud Run service accountのApplication Default Credentialsで有効化します:

```bash
MAPS_PROFILE_SNAPSHOT_BUCKET=private-maps-profile-bucket
MAPS_PROFILE_SNAPSHOT_PREFIX=maps-browser-mcp/profile
MAPS_PROFILE_SNAPSHOT_KEEP=2
MAPS_PROFILE_SNAPSHOT_MAX_BYTES=268435456
```

`MAPS_PROFILE_SNAPSHOT_REQUIRED=false` がdefaultです。初回起動でsnapshotが無い場合は空の専用profileでsigned-out起動します。snapshot欠落/破損時に起動自体を止めたい運用だけ `true` にします。

`MAPS_PROFILE_SNAPSHOT_BUCKET` 設定時、entrypointは `MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE` をreference checkpoint providerへ自動配線します。これはcredential-safe transport共通です。Human surfaceをrevokeしてnormal Human browserを閉じた後、fresh Agent CDPで `signed_in` を確認し、Agent browserをclean stopしてprofileをcheckpointした**後**にだけHandoffをresumableにします。checkpoint失敗時は未永続化sign-inを成功扱いせずfail closedします。legacy `hosted_cdp` はcredential-safe Human controlでは無効のままです。

snapshot helperは以下を保証します。

- `maps-browser-mcp` 起動前にrestore
- immutableなgeneration archiveと、previous generationも保持する小さな `current.json` pointer
- 展開前にpath traversal、symbolic link、hard linkを拒否
- 再生成可能cache、crash data、CDP runtime file、Chromium singleton fileを除外
- cookie/token/account identifierを個別抽出・ログ出力しない
- checkpointには `--browser-stopped` の明示が必要

reference entrypointはCloud Runのgraceful `SIGTERM` 時も、private coreのbrowser shutdown完了後にcheckpointを試みます。core/gatewayのunexpected crashでは新snapshotを作りません。signed-in durabilityの主checkpointはcredential-safe Human authority revoke後、normal Human browser close、fresh `signed_in` verification、Agent Chromium clean stopを経た安全点へ結線済みです。これによりGoogleログイン直後のprofileを確実に保存できます。

停止済みbrowser deployment container内でのmaintenance command:

```bash
node reference/oauth-gateway/profile-snapshot.mjs restore
node reference/oauth-gateway/profile-snapshot.mjs checkpoint --browser-stopped
```

専用private bucket/prefixを使い、object accessはMaps Cloud Run runtime service accountだけに付与します。`concurrency=1` / `max-instances=1` は維持します。profileを永続化してもsingle browser runtimeをmulti-user化してはいけません。
