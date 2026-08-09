# Release / Versioning ガイド

[English](releases.md) | 日本語

安定版Releaseと現在の `main` をどう使い分けるかを整理したページです。

## 最新安定版

現在の最新公開GitHub Releaseは **v0.1.1** です。

- Release: https://github.com/git-ksk/maps-browser-mcp/releases/tag/v0.1.1
- Release commit: `27ab7c82e13f19730bb765b5bd6f2dd76c92ba89`
- Draft: いいえ
- Prerelease: いいえ
- npm: **未公開**

v0.1.1ではprovider非依存のcontainer / headless Linux対応に加え、runtime、CI、readiness、Chromium sandbox、challenge境界のhardeningを追加しています。

詳細な変更履歴は [CHANGELOG.md](../CHANGELOG.md) を参照してください。

## 安定版を使う場合

検証・公開されたsourceをそのまま使う場合はrelease tagをcheckoutしてください。

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/git-ksk/maps-browser-mcp.git
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
