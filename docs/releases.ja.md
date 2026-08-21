# Release / Versioning ガイド

[English](releases.md) | 日本語

安定版Releaseと現在の `main` をどう使い分けるかを整理したページです。

## 最新安定版

この文書で扱うrelease baselineは **v0.3.2** です。Exact tested release commitはGitHub tag / Releaseを正本とします。

- Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.3.2
- Draft: いいえ
- Prerelease: いいえ
- npm: **未公開**

v0.3.2ではcredential-safe Cuaのfocus handlingとlive V5-C existing-list Saveのactivation / postcondition pathをhardeningし、dedicated signed-in profileでV5-A〜Dのsequential release gateを再実行します。Approved Send-to-phoneはMCP側device activation 1回・retryなしで、HumanがiPhone到着を確認しました。同じ1 activationからiOS側で同一通知3件を観測したため、external delivery duplicationとして記録します。v0.3.0でbounded V5 authenticated workflow（A〜D）を追加し、v0.3.1でtop-level README tool inventoryを同期しました。V5はdefault無効、account-backed automationはsingle-user / dedicated-profile限定、npmは引き続き未公開です。

詳細な変更履歴は [CHANGELOG 日本語版](../CHANGELOG.ja.md) を参照してください。

## Current `main` / v0.3.3 release candidate

Current release-candidate branchのrepository metadataは `0.3.3` です。First-class credential-safe WebRTC Human takeover、物理acceptance済みHandoff runtime/docs pin、macOS + iPhone Safari向け利用者Quick Startを追加します。Real `signed_out` -> Human-only Google sign-in -> revoke / stale-locator fence -> fresh `signed_in` -> bounded V5-B read acceptanceはPASS済みです。

**v0.3.3はまだ公開Releaseではありません。** Exact tested `main` commitへtagを作る前に、release checklistのsequential V5-A〜V5-D gate（別途Human approvalが必要なV5-C Save / V5-D send mutationを含む）を完了する必要があります。

## 安定版を使う場合

検証・公開されたsourceをそのまま使う場合はrelease tagをcheckoutしてください。

```bash
git clone --branch v0.3.2 --depth 1 https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

stdioで起動:

```bash
npm start
```

Streamable HTTPで起動:

```bash
npm run start:http
```

Release tagを指定すると、今後 `main` に未releaseの変更が入った場合でも意図せず取り込まずに済みます。

## `main` を使う場合

最新のmerge済み開発状態を意図的に使いたい場合だけ `main` を利用してください。

`main` はprotected branchで、変更はrequired CI / CodeQL経由でmergeされます。ただし、将来の `main` は最新公開tagより先行する可能性があります。`main` のcommitがGitHub Releaseとして公開済みとは限りません。

Contributorは特別な指示がない限り現在の `main` からbranchを作成してください。

## v0.3.2 検証記録

v0.3.2はruntime hardening patchです。Exact release commitにNode.js 20/22/24 required CI、macOS / Windows browser smoke、CodeQL、package / repository policy check、local stdio / HTTP / browser / package release validationを要求します。Authenticated V5 gateもlocalでsequential再実行し、A readiness PASS、B bounded save-state PASS、C Human-authorized existing-listへの1回save + fresh `saved=true` PASS、D approval Cancel/no-send PASS、その後approved route/device activationを1回だけ実行してretryせず、HumanがiPhone到着を確認しました。1 activationから同一iOS通知3件が出た点はMCP replayではなくdownstream duplicationとして記録します。

## v0.3.0 検証記録

v0.3.0では、exact release commitに対してNode.js 20/22/24 required CI、macOS / Windows browser smoke、CodeQL、package / repository policy check、およびこのruntime releaseに適したbounded manual Live Maps compatibility pathを通すrelease procedureを要求します。Protected branch merge前にはexact commitが存在しないため、commitとworkflow runはGitHub Releaseを正本として記録します。

Remote dogfood acceptanceにはclean MCP Runtime OAuth deployment、ChatGPT reconnect / tool execution、bounded headless read、traffic観測後のhistorical Monokura-derived Maps service retirementも含みます。V5 account-backed toolはopt-inのままで、public dogfood deploymentでは無効を維持します。

## v0.2.0 検証記録

v0.2.0では、exact release commitに対してNode.js 20/22/24 required CI、macOS / Windows browser smoke、CodeQL、package / repository policy check、fixedなmanual-only Live Maps E2E代表pathを通すrelease procedureを要求します。Protected branch merge前にはexact commitが存在しないため、commitとworkflow runはこの文書へ先書きせずGitHub Releaseを正本として記録します。

代表live pathは意図的にboundedです。Autocomplete read/select 1回、search-share 1回、representative place workflow 1組、Recommended/Best後のguarded route read/selectを含むfresh simple transit 1件だけを確認し、crawlerやcapability-by-capability sweepにはしません。

## v0.1.1 検証記録

v0.1.1のRelease commitでは以下がPASSしています。

- Node.js 20 / 22 / 24 CI
- macOS browser smoke
- Windows browser smoke
- container image build / runtime checks
- sandboxed Chromium/CDP smoke
- restricted-runtime fail-closed checks
- 明示restricted-runtime compatibility smoke
- HTTP liveness / 認証付きbrowser readiness / `PORT` fallback
- CodeQL zero findings

Manual-onlyのContainer + 実Google Maps E2EもRelease commit上でPASSしています。

- Workflow run: https://github.com/git-ksk/maps-browser-mcp/actions/runs/31310463642
- Runtime: container
- Chromium sandbox: 有効
- `MAPS_ALLOW_UNSANDBOXED_CHROMIUM`: 未使用
- `--no-sandbox`: 未使用
- Workflow artifact: 0件

Live workflowはrepositoryで固定したboundedなplace search / transit route scenarioだけを実行します。通常のpush / PR CIには組み込みません。

## 現在配布していないもの

現時点ではnpm packageを公開していません。将来のReleaseでnpm公開完了が明示されるまでは、次のようなinstall方法を前提にしないでください。

```text
npm install maps-browser-mcp
```

また、このrepositoryはmulti-user向けのhosted Maps serviceを公開するものではありません。引き続きbounded / user-directed / single-user / self-hosted利用を基本設計とします。

## Release方針

- 公開済みtagを書き換えない
- Release後のfixは既存tag移動ではなく新しいpatch versionで出す
- Tag前にpackage metadata / lockfile root metadata / MCP server versionを一致させる
- 通常CIからGoogle Mapsへアクセスしない
- Live Maps互換性確認は明示的なmanual-only / bounded / non-persistent運用を維持する
- CAPTCHA / consent / sign-in / access challengeを意図的に発生・突破しない

Release前後の完全な手順は [Release Checklist 日本語版](release.ja.md) を参照してください。
