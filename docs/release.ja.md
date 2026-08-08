# Release Checklist（日本語）

[English](release.md) | 日本語

Pre-1.0 release向けのchecklistです。Code、MCP metadata、package内容、browser互換性、GitHub security controlを揃えた状態でreleaseすることを目的にします。

## 1. Release Branchを準備

- 最新 `main` から開始
- Change setを必要範囲に限定
- User-visible behavior / configuration変更時はdocsも同PRで更新
- 明示的なsecurity / design reviewなしにMaps-only navigation boundary、V3 bounds、challenge handling、single-user/session前提を弱めない

## 2. Version整合性

`package.json` をrelease versionへ更新します。

Repository policy testは `src/server.ts` のMCP server versionと `package.json` versionが一致することを要求します。

```bash
npm run check
```

Package / server metadataと異なるversion tagを作らないでください。

## 3. Dependency / Build Verification

Lockfileをそのまま使います。

```bash
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
```

Transport / browser / packageも確認:

```bash
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
npm pack --dry-run
```

`npm pack --dry-run` の内容を確認します。Published packageへ以下を含めないでください。

- browser profile
- `.env`
- log / screenshot / trace
- credential
- local development artifact

## 4. GitHub必須Check

`main` はprotected branchです。Release PRはmerge前に現在のrequired checkをすべて通します。

- `check (20)`
- `check (22)`
- `check (24)`
- `Browser smoke (macos-15)`
- `Browser smoke (windows-2022)`
- `Analyze (JavaScript/TypeScript)`

CodeQL workflowはconfigured analysisでzero findingsを要求します。

Releaseのためにrequired checkをbypassしたり、`main` をforce pushしないでください。

## 5. Manual Live Google Maps互換性

通常push / PR CIはGoogle Mapsへアクセスしません。

以下へ変更があるreleaseでは、GitHub Actionsから **Live Maps E2E (manual)** を実行します。

- Maps URL compilation
- semantic place candidate extraction / selection
- semantic route candidate extraction / selection
- V3 visible-state reading
- browser challenge / navigation safety logic
- Live pageへ影響し得るChrome / CDP behavior

Workflowは意図的に `workflow_dispatch` onlyかつ低ボリュームです。

期待path:

```text
place search
  -> bounded place read
  -> index + expectedLabel place selection
  -> transit directions
  -> bounded route read
  -> index + expectedLabel route selection
```

記録するのはpass / failだけ。Repositoryへscreenshot、DOM dump、cookie、browser profile、review、location-result artifactを追加しないでください。

Docs-only等、明らかにruntimeへ影響しない変更では、Live compatibility baselineに疑いがない限り新しいLive Maps runは通常不要です。

## 6. Security / Repository Settings

Public release前と、その後も定期的に確認:

- `main` がprotectedのまま
- required status checkが設定されている
- admin enforcement有効
- force push / branch deletion無効
- linear history必須
- conversation resolution必須
- Private Vulnerability Reporting有効
- Dependabot configuration存在
- GitHub Actions dependencyがfull commit SHA固定

Sourceで表現できるworkflow pinning / manual-live invariantはrepository testで守ります。GitHub側settingsはcode外なので定期確認が必要です。

## 7. Documentation Review

以下がrelease内容と一致することを確認:

- `README.md`
- `README.ja.md`
- `.env.example`
- `docs/getting-started.md` / `.ja.md`
- `docs/troubleshooting.md` / `.ja.md`
- `docs/chatgpt.md` / `.ja.md`
- `docs/architecture.md` / `.ja.md`
- `docs/compliance.md` / `.ja.md`
- `docs/manual-e2e.md` / `.ja.md`
- `docs/release.md` / `.ja.md`
- `SECURITY.md` / `SECURITY.ja.md`
- `CONTRIBUTING.md` / `CONTRIBUTING.ja.md`

特にdefault値、tool name、environment variable、error / recovery guidance、Node / browser / platform前提、ChatGPT / Remote接続、safety / compliance boundaryを確認してください。

## 8. Merge / Tag

Protected `main` へrequired check通過後にmergeします。

Version `0.1.0` のtag:

```text
v0.1.0
```

TagはPR headではなく、実際にtestedされた `main` commitへ作成してください。

## 9. GitHub Release Notes

Release noteに含める内容:

- Projectが何をするか
- V1 / V2 / V3のstatus
- 主なsafety boundary
- Supported Node version
- Chrome / Chromium requirement
- Releaseに対してLive Maps E2Eを通したか
- Experimental / compatibility limitation
- Install / run手順、またはGetting Startedへのlink

V3を将来のGoogle Maps UIでも必ず動くと表現しないでください。

## 10. npm公開（有効化する場合）

Packageが実際に公開され、ownership / provenance setupを確認するまではREADMEでnpm install可能と案内しないでください。

公開前:

```bash
npm pack --dry-run
```

Release時点でregistryが対応するprovenance / 2FA-capable publishing practiceを優先します。npm account / package namespaceはGitHubとは別のSupply Chain security boundaryとして扱います。

公開後はclean environmentへpublished artifactをinstallし、少なくともnon-live smoke pathを通してから推奨install方法として案内してください。

## 11. Post Release

- GitHub tag / Releaseが意図したcommitを指すことを確認
- `main` CI greenを確認
- Dependabot / CodeQL / security alertを確認
- 今後のGoogle Maps UI変更検知用にManual Live E2Eを維持
- Security-sensitive regressionが見つかった場合、既存tagを書き換えず `SECURITY.md` に従ってpatch releaseを作成
