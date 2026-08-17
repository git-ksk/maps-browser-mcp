# Changelog（日本語）

[English](CHANGELOG.md) | 日本語

`maps-browser-mcp` の主要な公開Release変更履歴です。

本projectはpre-1.0です。Public APIが安定するまでは、minor / patch releaseにも互換性・安全性hardeningが含まれる場合があります。Upgrade前に各Release内容を確認してください。

## [Unreleased]

### Documentation

- pre-v1 completion sequenceを定義。v0.3.0をV5 + clean remote-auth foundation、v0.4.0をMCP Apps production portability、v0.5.0をreliability / UI-change resilience / observabilityとし、v1.0.0は未決機能の詰め込みではなくstable昇格とする。
- V5 authenticated-workflows design baselineをimplementation有効化なしで定義。Human-only sign-in、single-user/per-principal browser isolation gate、bounded saved-state read、first mutation candidateとしてexisting-listへのSave、Send to phone前のexplicit ActionApproval、Maps-history privacy gate、Timelineのdesktop Web candidate除外を明文化。

### 変更

- ExperimentalなMCP Apps directions Viewをhost差異に対してhardening。Stable 2026-01-26 host context、safe-area/container sizing、size notification、cancellation/error cleanup、teardown、Google推奨Embed referrer policyを反映。
- Embed API key未設定でも `maps_render_directions` をtext/structured display toolとして維持。UI resource/linkage/extension advertisementだけをconditionalにする。
- Official MCP Apps basic reference hostでUI pipeline、official MCP SDK clientでno-UI fallbackを検証。Second production hostでのreal-key render成功は未検証として明示し、UIのexperimental labelを維持。

### Security

- MCP Apps CSPを必要なGoogle nested-frame origin 1つだけに維持し、専用/restricted Embed key deploymentを文書化。Browser-control surfaceやcredential surfaceは追加しない。

## [v0.2.0] - 2026-08-15

V4の未認証Google Maps Web coverage完了と、Execution Handoff upstream consumer化をまとめたminor releaseです。

### 追加

- 現行未認証Google Maps Web scopeに対する広いV4 Maps-specific semantic coverage。boundedなplace share / nearby / photos / tabs / opening hours、search rating / viewport zoom、same-day transit time、endpoint swap、selected transit-route share、bounded autocomplete read/select、search-result share、Recommended/Best transit selectionを含みます。
- `ui://maps-browser-mcp/directions.html` を使うexperimentalなMCP Apps directions rendering。UI非対応host向けの有用なtext / structured fallbackは維持します。
- V4 capability inventoryのcanonical evidenceと、未対応・不安定surfaceに対する明示的なobservation/design gate + re-open condition。

### 変更

- 現行未認証scopeのV4をcloseoutし、high / normal priorityの未解決rowを0件にしました。
- Mapsを `mcp-execution-handoff` のfirst real adapterとして維持し、Japan Cinemaとのtwo-real-adapter validation完了後のimmutableなupstream v0.1.0 source-release commitへ同期しました。
- Manual Live Maps E2Eのrelease pathを、代表的なautocomplete / search-share / place workflow 1組と、Recommended/Bestを含むfresh simple transit workflow 1組へ更新しました。Fixed / low-volumeの原則は維持します。
- package / lockfile / MCP server metadataを `0.2.0` に同期しました。

### Safety / Compatibility

- raw browser / CDP / DOM / Accessibility Tree、generic browser action、arbitrary navigation、generic text entry、pointer primitive、clipboard dump、Maps internal API/XHR harvesting、bulk scraping、review harvestingは引き続きpublic MCP surfaceへ公開しません。
- consent / sign-in / CAPTCHA / access challengeはfail-closedなHuman Intervention境界のままです。Human完了をapprovalとみなさず、state-changing actionを自動replayしません。
- UI依存Maps operationとMCP Apps renderingは、将来のGoogle Maps / host UI変更に対する永久保証ではなくcompatibility-sensitive / experimental surfaceとして扱います。
- `mcp-execution-handoff` はsource releaseからconsumeし、このreleaseで同packageや `maps-browser-mcp` をnpm publishしません。

Validation詳細とexact release commit / live runはv0.2.0 GitHub Releaseへ記録します。

**npm:** 未公開

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
