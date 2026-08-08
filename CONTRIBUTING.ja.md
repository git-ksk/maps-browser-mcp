# Contributing（日本語）

[English](CONTRIBUTING.md) | 日本語

`maps-browser-mcp` へのcontributionを歓迎します。

このprojectはscopeを意図的に狭く保っています。専用browser sessionを通したuser-directed Google Maps interaction、小さなMCP tool surface、明示的なsafety boundaryが基本方針です。

## 変更を出す前に読むもの

- [README 日本語版](README.ja.md)
- [Architecture 日本語版](docs/architecture.ja.md)
- [Compliance / Safety 日本語版](docs/compliance.ja.md)
- [Security Policy 日本語版](SECURITY.ja.md)

Setup / debugging:

- [Getting Started 日本語版](docs/getting-started.ja.md)
- [Troubleshooting 日本語版](docs/troubleshooting.ja.md)

## Scope

歓迎するcontribution:

- 既存semantic toolのGoogle Maps UI互換性修正
- Chrome / CDP reliability、cross-platform behavior改善
- Security / policy boundary強化
- MCP protocol compatibility改善
- Test、documentation、accessibility、error handling
- Collection behaviorを広げないperformance改善

意図的にscope外の変更:

- MCP clientへgeneric `click` / `type` / DOM query / JavaScript executionを公開
- Google Maps内部・undocumented API intercept
- XHR / fetch harvesting
- bulk scraping / crawling / dataset extraction
- review harvesting
- CAPTCHA solving / bypass
- stealth / fingerprint spoofing
- bot evasion目的のproxy rotation
- 別security architectureなしのmulti-tenant shared-browser hosting

これらboundaryを変更するproposalは、大きなimplementation PRを出す前にdiscussionしてください。

## Development Setup

```bash
git clone https://github.com/git-ksk/maps-browser-mcp.git
cd maps-browser-mcp
npm ci --ignore-scripts
npm run build
```

主なcommand:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:stdio
npm run smoke:http
npm run smoke:browser
```

Browser smokeは実Chrome / Chromiumを起動しますがGoogle Mapsにはアクセスしません。

## Branch / Pull Request

`main` はprotectedです。Branchで変更してPull Requestを作成してください。

PRはfocusを絞り、reviewerが次を判断できるようにします。

1. 何が変わるか
2. どのsafety / security boundaryへ影響するか
3. どうtestしたか
4. Live Maps compatibility runが必要か
5. Documentation / configuration更新が必要か

Required checkを回避するために `main` へforce pushしないでください。

## Required Checks

Protected branchでは現在、Node、cross-platform browser、CodeQL checkを要求します。

CI範囲:

- Node.js 20 / 22 / 24
- dependency audit
- type checking
- unit test
- build
- stdio MCP smoke
- Streamable HTTP MCP smoke
- Chrome / CDP smoke
- package dry-run
- macOS / Windows browser startup
- CodeQL JavaScript / TypeScript analysis

GitHub Actions dependencyはimmutable full commit SHAへ固定し、Dependabotで監視します。

## Tests

Behavior変更には可能な限りtestを追加・更新してください。

Google Mapsへアクセスしないdeterministic testを優先します。通常CIはLive Maps websiteに依存させません。

Live UI-dependent変更では [Manual Live E2E 日本語版](docs/manual-e2e.ja.md) のmanual-only workflowを使います。Scheduled / push-triggered Maps crawlingを追加しないでください。

## Google Maps UI変更

Semantic selectorは次を守ります。

- 現在Maps surfaceへ狭くscope
- result countをbounded
- read / selectで整合が必要なcandidate extraction logicを共有
- dynamic candidate selectionでは `expectedLabel` を使う
- ambiguous stateではfail closed

壊れたsemantic selectorをfull DOM dumpやgeneric browser primitiveで置き換えないでください。

## Security-sensitive Code

特に注意が必要な変更:

- URL / host / path allowlist
- HTTP bind / authentication
- Host / Origin handling
- CDP endpoint handling
- browser profile isolation
- challenge / CAPTCHA detection
- operation queue / watchdog
- V3 read bounds
- untrusted text handling

Security変更は不確実な場合fail closedを優先します。

Vulnerabilityは詳細なpublic Issueを作らず、[Security Policy 日本語版](SECURITY.ja.md) とGitHub Private Vulnerability Reportingを使ってください。

## Dependencies

Node.jsまたは既存stackで十分実装できる場合、依存追加を避けてください。

Dependency追加 / 更新時:

- なぜ必要か説明
- runtime dependencyを最小化
- lockfile更新
- audit / check / build実行
- lifecycle script / Supply Chain影響を検討

具体的な理由とreviewなしに `npm ci --ignore-scripts` のCI behaviorを弱めないでください。

## Documentation

以下を変更した場合、同PRでdocsも更新します。

- tool名 / input schema
- environment variable / default
- install / start command
- error behavior
- Node / browser / platform support
- ChatGPT / Remote connection behavior
- safety / compliance boundary

User-visible functionalityについて `README.md` と `README.ja.md` を同期し、英語docsと日本語docsにも重要な差異が残らないようにしてください。

## Commit / PR Hygiene

Commitしないもの:

- `.env`
- token / credential
- browser profile / cookie
- 個人情報を含むlocal machine path
- account / location dataを含むscreenshot / trace / log
- 生成したMaps dataset

Public commit metadataへ個人emailを出したくない場合はGitHub noreply emailを使用してください。

## Release関連

Releaseに関係するPRは [Release Checklist 日本語版](docs/release.ja.md) に従ってください。

Packageが実際に公開・検証されるまではnpm install可能と案内しないでください。
