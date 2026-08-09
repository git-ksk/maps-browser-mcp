# コンテナ / headless Linux

`maps-browser-mcp` は、Chromium を含む標準的な Linux コンテナで実行できます。用途は bounded・single-user・self-hosted を想定しており、ホスト型の Maps データ API、クローラ、マルチテナントのスクレイピングサービスとして提供することは想定していません。

## ビルド

```bash
docker build -t maps-browser-mcp .
```

このイメージは次の構成です。

- non-root の `mcp` ユーザーで実行
- `/usr/bin/chromium` を使用
- headless mode を有効化
- 専用の一時 profile `/tmp/maps-browser-mcp/chrome-profile` を使用
- Streamable HTTP transport を起動
- 明示的に変更しない限り、アプリ本来の loopback bind デフォルトを維持

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

## ポートの優先順位

HTTP port は次の順番で決まります。

1. `MCP_HTTP_PORT`
2. `PORT`
3. `8787`

`PORT` は一般的な runtime 向け fallback にすぎません。`MCP_HTTP_PORT` が指定されている場合は、必ずそちらが優先されます。

## Browser profile

イメージでは、次の一時専用 profile をデフォルトで使用します。

```text
/tmp/maps-browser-mcp/chrome-profile
```

single-user で profile の永続化が本当に必要な場合のみ `MAPS_CHROME_PROFILE_DIR` で変更してください。普段使いの browser profile を指定したり、複数ユーザー・複数instanceで1つの profile を共有したりしないでください。

## Health check

`GET /healthz` は小さな process-health response を返し、Google Maps へのアクセスや browser operation は実行しません。これは HTTP process の liveness 確認用であり、実Google Maps UIへ到達できることを保証する readiness check ではありません。

コンテナイメージにも、この endpoint を使用する `HEALTHCHECK` が含まれています。

## Shutdown

HTTP process は `SIGTERM` / `SIGINT` を処理し、MCP handler を閉じ、managed browser runtime を停止し、idle HTTP connection を閉じてから終了します。コンテナ停止時も通常のserver lifecycleに沿って終了します。

## セキュリティ

コンテナ環境でも既存の安全境界は維持されます。

- bind address のデフォルトは loopback のまま
- non-loopback bind には `MCP_ALLOW_NONLOOPBACK=true` が必要
- non-loopback bind には24文字以上の bearer token も必要
- external CDP attachment は引き続き明示的opt-in
- V3 visible-state reading も引き続きopt-in
- Maps由来テキストは untrusted external data として扱う
- CAPTCHA、sign-in、consent、access challenge を自動突破しない

コンテナ化によって、本プロジェクトの Google Maps 利用境界や利用規約上の考慮事項が変わるわけではありません。
