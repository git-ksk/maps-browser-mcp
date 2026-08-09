# Changelog（日本語）

[English](CHANGELOG.md) | 日本語

`maps-browser-mcp` の主要な公開Release変更履歴です。

本projectはpre-1.0です。Public APIが安定するまでは、minor / patch releaseにも互換性・安全性hardeningが含まれる場合があります。Upgrade前に各Release内容を確認してください。

## [v0.1.1] - 2026-08-09

Container / headless portabilityとRelease hardeningを中心としたpatch releaseです。

### 追加

- Provider非依存のLinux container / headless実行対応
- non-root Chromium container image
- `MCP_HTTP_PORT` を優先したgeneric `PORT` fallback
- `/healthz` process liveness endpoint
- Google Mapsへ遷移せずmanaged Chromium/CDPを確認する `/readyz`
- Restricted Linux runtime向けの明示的 `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` compatibility mode
- Docker dependency監視とNode base image digest固定
- BoundedなLive Google Maps E2Eをcontainerで実行できるmanual-only path

### 変更

- Container validationをrequired Node 22 CI check内へ統合
- bearer token設定時は `/readyz` も認証必須
- package / lockfile / MCP server metadataを `0.1.1` に同期
- 日英container / release documentationを拡充

### Safety / Validation

- Chromium sandboxはdefault有効のまま。`--no-sandbox` へのsilent downgradeなし
- Restricted runtimeではfail closedを検証
- CAPTCHA / anti-bot bypassを追加せず `HUMAN_INTERVENTION_REQUIRED` 境界testを強化
- Release commitでNode 20/22/24 CI、macOS browser smoke、Windows browser smoke、container smoke、CodeQLがPASS
- Release commit `27ab7c82e13f19730bb765b5bd6f2dd76c92ba89` でManual Container + Live Google Maps E2EがPASS
- Live workflow artifactは0件

GitHub Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.1

Live validation run: https://github.com/git-ksk/maps-browser-mcp/actions/runs/31310463642

**npm:** 未公開

## [v0.1.0] - 2026-08-09

初回Public Releaseです。

### 追加

- Search / directions / map display / Street View / semantic selection / travel-mode変更 / bounded visible-state readingを行うMaps専用MCP tool 9種類
- stdio / Streamable HTTP transports
- 専用Chrome / Chromium profile isolationとlocal CDP boundary
- Google Maps-only navigation policy
- `untrustedExternalText: true` を付与するbounded V3 place / route summary
- `index + expectedLabel` guardと `UI_STATE_CHANGED` stale-state rejection
- consent / sign-in / CAPTCHA / challenge向けhuman-intervention boundary
- bounded queue、operation watchdog、guarded external CDP、rate/read safety limit
- 英語・日本語documentation

### Validation

- Node 20/22/24 CI、macOS / Windows browser smoke、CodeQLがPASS
- Apple Silicon macOSでuser-directed Live Google Maps E2EがPASS

GitHub Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.0

**npm:** 未公開

## Versioning方針

- GitHub ReleasesをPublic Releaseの正本として扱う
- `main` は最新tagより先行した未Release変更を含む場合がある
- 再現可能な安定版利用では `main` ではなくRelease tagを使う
- 公開済みtagを書き換えず、security-sensitive fixは新しいpatch releaseとして出す
