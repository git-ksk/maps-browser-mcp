# コンテナ / headless Linux

`maps-browser-mcp` は、Chromium を含む標準的な Linux コンテナで実行できます。用途は bounded・single-user・self-hosted を想定しており、ホスト型の Maps データ API、クローラ、マルチテナントのスクレイピングサービスとして提供することは想定していません。

## ビルド

```bash
docker build -t maps-browser-mcp .
```

このイメージは次の構成です。

- non-root の `mcp` ユーザーで実行
- `/usr/bin/chromium` を使用
- Chromium の sandbox helper をインストール
- headless mode を有効化
- 専用の一時 profile `/tmp/maps-browser-mcp/chrome-profile` を使用
- Chromium の config/cache も writable な `/tmp/maps-browser-mcp` 配下に配置
- Streamable HTTP transport を起動
- 明示的に変更しない限り、アプリ本来の loopback bind デフォルトを維持

Node base image は digest 固定し、同じ Dockerfile が意図せず別base imageへ移動しないようにします。Docker dependency は Dependabot で監視します。一方Chromiumはセキュリティ更新を長期間凍結しないため、build時点のDebian Bookworm packageを追従します。CIではbuildされたimageのNode / Chromium実バージョンを記録します。

## ホストへポート公開して実行する

コンテナ内部で `127.0.0.1` に bind したプロセスは、通常の published port 経由ではホストから到達できません。MCP endpoint を公開する場合は、non-loopback bind を明示的に許可し、十分に強い application bearer token を設定してください。

```bash
TOKEN="$(openssl rand -hex 24)"

docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_ALLOW_NONLOOPBACK=true \
  -e MCP_BEARER_TOKEN="$TOKEN" \
  maps-browser-mcp
```

可能な限り、ホスト側の公開ポートは loopback に限定してください。remote MCP client から接続する必要がある場合は、認証付き HTTPS/TLS の仕組みを前段に置き、必要に応じて `MCP_ALLOWED_HOSTS` と `MCP_ALLOWED_ORIGINS` を実際のルーティングに合わせて設定してください。

Chrome DevTools/CDP port は公開しないでください。

## Chromium sandbox の互換モード

Chromium sandbox はデフォルトで有効のままです。一部の隔離された container runtime では、Chromium sandbox が必要とする Linux namespace 操作が禁止されており、`/healthz` は成功しても `/readyz` や browser operation が失敗する場合があります。

可能であれば Chromium 自身の sandbox を利用できる runtime 設定を優先してください。それが利用できず、かつ dedicated・isolated・single-user な環境に限り、次の明示的な互換モードを使用できます。

```bash
-e MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true
```

この設定は Chromium に `--no-sandbox` を追加します。browser isolation の重要な防御層を外すため、**デフォルトでは無効で、自動的に有効化されることもなく、共有・マルチテナント環境には適しません**。実際に使用された場合は server log に警告を出します。

制約のある runtime で明示的に fallback する例:

```bash
TOKEN="$(openssl rand -hex 24)"

docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_ALLOW_NONLOOPBACK=true \
  -e MCP_BEARER_TOKEN="$TOKEN" \
  -e MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true \
  maps-browser-mcp
```

sandbox 起動に失敗した場合でも、project側が勝手に `--no-sandbox` で再試行することはありません。

## ポートの優先順位

HTTP port は次の順番で決まります。

1. `MCP_HTTP_PORT`
2. `PORT`
3. `8787`

`PORT` は一般的な runtime 向け fallback にすぎません。`MCP_HTTP_PORT` が指定されている場合は、必ずそちらが優先されます。

## Container deploymentとcredential-safe takeover

Container / Cloud RunはMCP control planeとprocess-owned Chromium automationをhostできます。credential-safe Human controlの共通ルールは変わらず、**automation browserを停止し、same dedicated profileをremote-debugging / automation authorityなしのnormal browserで開く**必要があります。pin済みHandoffにはLinux X11/Xvfb normal-browser WebRTC hostが入り、Ubuntu/Xvfb acceptanceでexact-window capture、CPU H.264/WebRTC、tap、helper stdin経由のfocused Human text（argv / clipboard / logへ出さない）、Enter、bounded teardownまでPASSしています。Core Cloud Run transport / sign-in pathもCloudflare Realtime TURN、物理iPhone Safari `Live · relay`、real Human-only Google sign-inまでproduction physical acceptance済みです。実際のsign-inまでのphysical iPhone Human-session stabilityは#156、Post-Done revoke / checkpoint / fresh restoreは#135をv0.4 gateとして維持します。Mobile keyboard / CJK UXの#134は非blockerのgeneric Handoff follow-upで、通常のMaps操作はMCP / Agent planeに残します。

Linux/container `webrtc_takeover` ではisolated local X11 displayとHandoff Linux helper executable/wrapperを用意します。Linuxでは `MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME` が必須です。legacy `hosted_cdp` はHuman credential / consent / challenge controlで引き続き無効です。

```bash
MAPS_CREDENTIAL_SAFE_HANDOFF=true
MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover
MAPS_HANDOFF_TRANSPORT_ORDER=websocket_relay
MAPS_REMOTE_TAKEOVER=true
MAPS_TAKEOVER_PUBLIC_BASE_URL=https://maps-mcp.example.com
MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE=$PWD/node_modules/.bin/handoff-linux-webrtc-host
MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99
MAPS_HEADLESS=true
# Maps起動前にisolated X11 display/window managerを起動し、public operator boundaryは認証必須
```

以前の `hosted_cdp` experimentはAgent authorityをfenceしていましたが、Humanがmanaged automation ChromiumをHuman-owned CDP経由で操作する形でした。Cloud Run + iPhone Safariの物理acceptanceでは、Google sign-inが「安全でないbrowser/app」として拒否され、takeover UIもgeneric HTTP controlへdegradeすることを確認したため、credential / consent / challenge Human stepではこの経路を無効化します。Linux側はexact-window normal-browser capture/inputを実装済みで、HandoffのWebRTC session / generation / TURN / revoke / stale-client fencingを再利用します。Replacement normal-browser Cloud Run pathのreal Google sign-in acceptanceは完了済みで、残るdurability gateは明示Done/revoke後のfresh Agent verification、stopped-profile checkpoint、fresh-instance restore（#135）です。

Co-locatedな物理Macでは `webrtc_takeover` がrecommended built-in low-latency mobile pathで、物理iPhone Safariにてsame-LAN direct WebRTC / cellular TURN relay、およびreal V5 Google sign-in recoveryまでacceptance済みです。`thin_takeover` はNative appの別物理acceptanceが完了するまでoptional / experimental siblingとして残します。どちらもhosted-browser vendor API keyは不要です。

browser / Handoff authorityはprocess / worker-localのままです。instance終了・replacement時に別workerへresumeしたふりをせずfail closedします。durable browser/profile stateはtakeover authorityと分離し、停止済み専用profileだけをsnapshot対象にします。raw credentialやactive Handoff authorityは永続化しません。

## Browser profile

イメージでは、次の一時専用 profile をデフォルトで使用します。

```text
/tmp/maps-browser-mcp/chrome-profile
```

single-user で profile の永続化が本当に必要な場合のみ `MAPS_CHROME_PROFILE_DIR` で変更してください。普段使いの browser profile を指定したり、複数ユーザー・複数instanceで1つの profile を共有したりしないでください。Reference OAuth gatewayでは `MAPS_PROFILE_SNAPSHOT_BUCKET` により停止済みprofileをrestore/checkpointできますが、live Chromiumはlocal ephemeral storageだけを使います。このsnapshot layer有効時はentrypointがdeployment-onlyな `MAPS_BROWSER_STOPPED_CHECKPOINT_MODULE` を配線します。credential-safe Human transportをrevokeした後にfresh Agent `signed_in` verificationが成功した場合だけautomation browserを停止し、そのstopped profileだけをcheckpointします。

## Health / Readiness

`GET /healthz` はprocessのlivenessのみ確認します。Chromiumは起動せず、Google Mapsにもアクセスしません。

`GET /readyz` はmanaged Chromiumとlocal CDP endpointが利用可能かを確認します。必要なら専用Chromium sessionを起動または再利用しますが、**Google Mapsへnavigateしません**。browser startup / CDPに失敗した場合はHTTP `503`と最小限のavailability statusだけを返し、詳細はlocal server logに残します。

`/readyz` はChromiumを能動的に起動できるため、`MCP_BEARER_TOKEN` が設定されている場合は同じbearer認証を必須にします。non-loopbackではbearer token自体が必須なので、外部から未認証でbrowser resourceを起動できません。`/healthz` はHost検証後のpassiveなunauthenticated livenessのままです。

Loopback-onlyでbearer tokenを設定していない場合:

```bash
curl -i http://127.0.0.1:8787/healthz
curl -i http://127.0.0.1:8787/readyz
```

`MCP_BEARER_TOKEN` を設定している場合:

```bash
curl -i http://127.0.0.1:8787/healthz
curl -i \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8787/readyz
```

Dockerfileの `HEALTHCHECK` は純粋なprocess livenessとして意図的に `/healthz` を使い続けます。browser readinessが必要なruntimeではauthenticated `/readyz` を別途利用できます。

## CI coverage

Container検証は独立したoptional jobではなく、repositoryの既存required Node 22 checkへ組み込んでいます。CIでは次を確認します。

- image build
- Node / Chromium version記録
- imageがunsandboxed Chromiumをデフォルト有効化していないこと
- sandbox-capableなbrowser/CDP path
- 制約runtimeでsandboxを勝手に無効化せずfail closedすること
- `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` の明示fallback
- `PORT` fallback、`/healthz`、authenticated `/readyz`、bearer設定時のunauthenticated active readiness拒否

通常のcontainer CIはGoogle Mapsへアクセスしません。

## Shutdown

HTTP process は `SIGTERM` / `SIGINT` を処理し、MCP handler を閉じ、managed browser runtime を停止し、idle HTTP connection を閉じてから終了します。コンテナ停止時も通常のserver lifecycleに沿って終了します。

## セキュリティ

コンテナ環境でも既存の安全境界は維持されます。

- bind address のデフォルトは loopback のまま
- non-loopback bind には `MCP_ALLOW_NONLOOPBACK=true` が必要
- non-loopback bind には24文字以上の bearer token も必要
- active `/readyz` browser probeは設定済みbearer tokenを要求
- Chromium sandbox を無効化する場合も別の明示的opt-inが必要
- external CDP attachment は引き続き明示的opt-in
- V3 visible-state reading も引き続きopt-in
- Maps由来テキストは untrusted external data として扱う
- CAPTCHA、sign-in、consent、access challenge を自動突破しない

コンテナ化によって、本プロジェクトの Google Maps 利用境界や利用規約上の考慮事項が変わるわけではありません。
