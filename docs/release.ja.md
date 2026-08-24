# Release Checklist（日本語）

[English](release.md) | 日本語

Pre-1.0 release向けのchecklistです。Code、MCP metadata、package内容、browser互換性、container portability、GitHub security controlを揃えた状態でreleaseすることを目的にします。

## 1. Release Branchを準備

- 最新 `main` から開始
- Change setを必要範囲に限定
- User-visible behavior / configuration変更時はdocsも同PRで更新
- 明示的なsecurity / design reviewなしにMaps-only navigation boundary、V3 bounds、challenge handling、single-user/session前提を弱めない

## 2. Version整合性

`package.json` をrelease versionへ更新し、release metadataを変更した場合はprojectで使用するnpm majorで `package-lock.json` も再生成します。

Repository policy testは `src/server.ts` のMCP server versionと `package.json` versionが一致することを要求します。

```bash
npm run check
```

Tag作成前に `package-lock.json` のroot package metadataもrelease versionと一致することを確認してください。Official MCP Registry publication向けに実 `server.json` をmaterializeする場合、そのserver version / npm package versionも `package.json`、`package-lock.json`、`src/server.ts`、release tagとexact matchさせます。`server.json.example` は `main` が前stable metadataのままでも次publication予定versionを示せますが、actual release gateではexample / materialized recordをexact release versionへ更新します。Versionが食い違うtag / package / Registry recordを作成・publishしないでください。

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

Container/headless validationは独立したoptional jobではなく、既存のrequired `check (22)` 内で実行します。Container regressionは必ずrequired checkを失敗させる構成を維持してください。

CodeQL workflowはconfigured analysisでzero findingsを要求します。

Releaseのためにrequired checkをbypassしたり、`main` をforce pushしないでください。

## 5. Container / Headless Verification

Browser startup、HTTP transport、configuration、Dockerfile、container docsに変更があるreleaseでは、required Node 22 jobで次がpassすることを確認します。

- image buildとruntime version記録
- Chromium sandboxがdefaultで有効のまま
- sandbox-capable Chrome/CDP smoke
- 制約runtimeでsilent sandbox downgradeせずfail closed
- `MAPS_ALLOW_UNSANDBOXED_CHROMIUM=true` の明示compatibility smoke
- generic `PORT` fallback
- `/healthz` process liveness
- `/readyz` managed Chromium/CDP readiness（Google Maps navigationなし）

Node base imageはdigest固定を維持し、Docker dependencyはDependabot監視対象にします。一方、Chromium packageをbyte-for-byte再現性だけのため長期間freezeせず、CIで実browser versionを記録します。

## 6. Manual Live Google Maps互換性

通常push / PR CIはGoogle Mapsへアクセスしません。

以下へ変更があるreleaseでは、GitHub Actionsから **Live Maps E2E (manual)** を実行します。

- Maps URL compilation
- semantic place candidate extraction / selection
- semantic route candidate extraction / selection
- V3 visible-state reading
- browser challenge / navigation safety logic
- Live pageへ影響し得るChrome / CDP behavior

Workflowは意図的に `workflow_dispatch` onlyかつ低ボリュームです。通常runner pathは `host` を選択します。Dockerfile、headless Chromium startup、container profile / filesystem前提、container固有Chrome flagを実質的に変更したreleaseでは `container` を選び、同じbounded live scriptをbuild済みimage内でChromium sandboxを有効にしたまま実行します。具体的な互換性理由がない限り、両modeを同時に繰り返し実行しません。

V4全体releaseでの代表live path:

```text
bounded autocomplete read
  -> guarded suggestion selection
  -> search result 1件 + bounded search-share link
  -> bounded place read/select + representative place workflow 1件
  -> fresh simple transit directions
  -> Recommended/Best semantic selection
  -> bounded route read
  -> index + expectedLabel route selection
```

V4 toolが増えたことを理由にcapability-by-capability crawlerへ広げず、fixed / low-volumeを維持してください。

記録するのはpass / failと選択runtimeだけ。Repositoryへscreenshot、DOM dump、cookie、browser profile、review、location-result artifactを追加しないでください。

CAPTCHA、consent、sign-in、access challengeを意図的に発生させたり突破したりしないでください。通常testで `HUMAN_INTERVENTION_REQUIRED` のfail-closed境界を決定論的に確認し、live環境では自然発生した場合だけ再確認します。

Docs-only等、明らかにruntimeへ影響しない変更では、Live compatibility baselineに疑いがない限り新しいLive Maps runは通常不要です。

## 6.1. v0.3.2+ Impact-based V5 Live Release Gate

Releaseの変更影響に応じてV5 live gateを選びます。Credential handoff transportだけが変わったことを理由に、無関係なaccount mutationやdevice sendを毎回繰り返しません。

Canonical sliceは次のままです。

1. **V5-A readiness:** fresh Maps surfaceでidentity-free `signed_in` のみ確認。Account identityは記録しない。
2. **V5-B save-state read:** public place 1件についてbounded existing-list membershipをreadし、private list labelをpublic logへ出さない。
3. **V5-C existing-list Save:** exact safe target 1件を必須とする。Test-purpose listを優先するが、Humanがexisting list 1件の利用を明示許可してもよい。Save activationはexactly 1回、create/delete/unsave禁止、fresh readでsame hidden targetの `saved=true` を必須確認。
4. **V5-D Cancel:** fresh simple route + bounded device read後にexplicit approvalを要求し、1回Cancelしてsend actionなしを確認。
5. **V5-D approved send:** route/device stateを最初からfresh取得し、新しいexact Human approvalを得た上でdevice activationを1回だけ実行する。Ambiguous postcondition後はautomatic retryせず、Humanへphysical arrival確認を依頼する。

V5-C/V5-D mutation実装、action-approval semantics、save-list / route / device抽出・postcondition、mutation dispatch、またはC/D actionへ影響し得るshared runtime/state logicを変更したreleaseでは **A -> Dをfull sequential実行**します。

**Credential-safe handoffだけ、またはpre-auth transportだけを変更**したreleaseでは、fresh automation recoveryを通して最低V5-A + V5-Bまでlive再実行します。V5-C/V5-Dの過去evidenceを再利用できるのは、releaseごとに `docs/manual-e2e.ja.md` へ次を記録した場合だけです。

- 再利用するexact prior release/evidence;
- そのbaselineからV5-C/V5-Dとaction-approval実装fileがunchangedであること;
- shared runtime変更がnon-mutation mechanicsとしてreview済みで、deterministic C/D testが引き続きPASSすること;
- 変更したhandoff pathからrevoke/re-attach後にfresh `signed_in` + bounded V5-B readまで到達したこと;
- skipしたmutation/sendを今回新たに実行したようなrelease claimをしないこと。

このreuse ruleは、変更境界のlive coverageを保ちながら不要なaccount mutation/device sendを減らすためのものです。影響範囲が曖昧ならfull sequenceを使います。

Approved MCP activation 1回からdownstream platform notificationが重複した場合は別観測として記録し、agent/MCP replayとdownstream delivery duplicationを区別します。新しいHuman approvalなしに調査目的の再sendを行いません。

## 7. Security / Repository Settings

Public release前と、その後も定期的に確認:

- `main` がprotectedのまま
- required status checkが設定されている
- container validationがrequired `check (22)` 内で実行されている
- admin enforcement有効
- force push / branch deletion無効
- linear history必須
- conversation resolution必須
- Private Vulnerability Reporting有効
- Dependabot configurationがnpm / GitHub Actions / Dockerを監視
- GitHub Actions dependencyがfull commit SHA固定

Sourceで表現できるworkflow pinning / manual-live / container-gating invariantはrepository testで守ります。GitHub側settingsはcode外なので定期確認が必要です。

## 8. Documentation Review

以下がrelease内容と一致することを確認:

- `README.md` / `README.ja.md`
- `.env.example`
- `CHANGELOG.md` / `CHANGELOG.ja.md`
- `docs/getting-started.md` / `.ja.md`
- `docs/releases.md` / `.ja.md`
- `docs/roadmap.md` / `.ja.md`
- `docs/container.md` / `.ja.md`
- `docs/webrtc-human-takeover.md` / `.ja.md`
- `docs/v5-authenticated-workflows.md` / `.ja.md`
- `docs/handoff-overview.md` / `.ja.md`
- Package / Registry publicationがscopeなら `docs/official-mcp-registry.md`
- `docs/troubleshooting.md` / `.ja.md`
- `docs/chatgpt.md` / `.ja.md`
- `docs/architecture.md` / `.ja.md`
- `docs/compliance.md` / `.ja.md`
- `docs/manual-e2e.md` / `.ja.md`
- Registry publicationがscopeなら `server.json` / `server.json.example`
- `SECURITY.md`
- `CONTRIBUTING.md`

特にdefault値、tool name、environment variable、health / readiness behavior、error / recovery guidance、Node / browser / platform前提、ChatGPT / Remote接続、safety / compliance boundaryを確認してください。

## 9. Merge / Tag

Protected `main` へrequired check通過後にmergeします。

Version `<version>` のtag:

```text
v<version>
```

TagはPR headではなく、実際にtestedされた `main` commitへ作成してください。

## 10. GitHub Release Notes

Release noteに含める内容:

- Projectが何をするか
- V1 / V2 / V3 / V4のstatus
- 主なsafety boundary
- Supported Node version
- Chrome / Chromium requirement
- Releaseに対してLive Maps E2Eを通したか、および使用runtime（`host` / `container`）
- Experimental / compatibility limitation
- Install / run手順、またはGetting Startedへのlink

V3を将来のGoogle Maps UIでも必ず動くと表現しないでください。

## 11. npm + Official MCP Registry公開（有効化する場合）

Exact releaseのpublish / verifyが終わるまで、READMEでnpmまたはOfficial MCP Registry利用可能と表現しないでください。初回publication gateの正本は [Official MCP Registry publication](official-mcp-registry.md) とします。Publicationにはmaintainerの明示authorizeが必要で、metadata準備やrelease PR作成自体をpublish許可とみなしません。

Publish前に `package.json`、`package-lock.json`、`src/server.ts`、release tag、packed npm artifact、materialized `server.json` のpackage/server recordが1つのexact versionで一致することを確認します。

公開前:

```bash
npm pack --dry-run
```

Release時点でregistryが対応するprovenance / 2FA-capable publishing practiceを優先します。npm account / package namespaceはGitHubとは別のSupply Chain security boundaryとして扱います。

npm公開後はclean environmentへexact published artifactをinstallし、少なくともnon-live stdio smokeを実行します。その後same versionを `mcp-publisher` でauthenticate / publishし、Official MCP Registryで `io.github.git-ksk/maps-browser-mcp` をqueryしてversion、npm package record、stdio transportを検証してから、どちらのdistribution channelも案内します。

## 12. Post Release

- GitHub tag / Releaseが意図したcommitを指すことを確認
- `main` CI greenを確認
- Dependabot / CodeQL / security alertを確認
- npm / Registry publicationを行った場合、両public recordがexact release version / package identityへresolveすることを確認
- 今後のGoogle Maps UI変更検知用にManual Live E2Eを維持
- Security-sensitive regressionが見つかった場合、既存tagを書き換えず `SECURITY.md` に従ってpatch releaseを作成
