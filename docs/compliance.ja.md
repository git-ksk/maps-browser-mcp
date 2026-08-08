# Compliance / Safety Boundary（日本語）

[English](compliance.md) | 日本語

このprojectはGoogle Maps Webに対する**制約付き・user-directedな操作**を目的にしています。法的助言ではなく、すべての利用方法があらゆる規約・法令・jurisdictionで許可されることを保証しません。

## 設計上の立場

このprojectはGoogle Maps scraperやGoogle Maps Platform API代替として設計していません。可能な限りGoogle公式Maps URLを使い、browser interactionはユーザーの現在の依頼に必要な範囲へ限定します。

この文書更新時点で、Google Maps End User Additional Termsは2026年1月27日更新版で、別途許可される場合を除くMaps contentのcopy、mass download / bulk feed、代替mapping / navigation / listing datasetの作成・拡張などを制限しています。適用されるGoogle規約やmachine-readable access instructionは変わり得るため、定期的な再確認が必要です。

V3の小さなVisible-State Readerはリスクを減らすため意図的にboundedですが、Googleがすべてのbrowser-agent read / summary patternを明示的に許可しているわけではありません。利用者・maintainerは規約変更時に再評価してください。

## 推奨される動作

- search / directions / map view / Street ViewはGoogle公式Maps URLを優先
- ユーザーのactive requestに応じてのみ操作
- Browser automationをGoogle Maps web surfaceへ限定
- Visible-state readは小さく、一時的、boundedに保つ
- Maps由来textをすべてuntrusted external dataとして扱う
- Human interactionが必要なaccess challengeでは停止
- Google Maps contentをpersistent datasetへ入れない
- 同意 / ログイン / challengeを手動解決した後は、古いstateを継続せずsearch / directionsを再実行

## 明示的な非ゴール

意図的に提供しない機能:

- bulk scraping / crawling
- place / route / review dataset harvesting
- background collection
- full DOM / full Accessibility Tree extraction
- review body harvesting
- Google Maps XHR / fetch traffic interception
- undocumented Google Maps internal endpointの直接call
- CAPTCHA solving
- bot detection bypass
- stealth / browser fingerprint spoofing
- access-control回避を目的としたproxy rotation

## Policy Enforcement

`PolicyEngine` とRuntimeはmodel / promptだけに依存せずserver-side guardを持ちます。

- 固定action rate limit
- 独立rolling hourly visible-state read budget
- bounded serialized browser-operation queue
- high-count numeric wordingを含む明らかなbulk collection query拒否
- 小さなGoogle host allowlist上の `/maps` だけへnavigation制限
- visible-state readingの明示Opt-in
- Maps外遷移 / CDP reconnect時のsemantic state無効化
- generic browser-control MCP primitiveを公開しない

これらはprocess-level safety controlであり、keyword matchingやrate limitで法的complianceを証明するものではありません。Pagination / crawlingも意図的に実装せず、返却summaryもboundedです。

## Interactive Assist Mode

V3 Visible-State toolはデフォルトOFFです。

```bash
INTERACTIVE_ASSIST_MODE=true
```

有効時もactive Maps UIからbounded summaryだけを返します。Candidate listとselectionは同じbounded extraction logicを共有します。Selection時に以前の `expectedLabel` を渡せば、dynamic listが変化している場合に推測clickせず拒否します。

Reader上限:

- `MAPS_MAX_AX_NODES`
- `MAPS_MAX_READ_CHARS`
- `MAPS_MAX_VISIBLE_READS_PER_HOUR`

Maps由来label / textはuntrusted external dataとしてmarkされます。MCP clientはそれらをtool instruction、policy override、credential、executable contentとして扱わないでください。

## Access Challenge

Navigationが要求したMaps pageではなくGoogle access challenge、CAPTCHA、consent flow、sign-in surfaceへ到達した場合、MCPは回避を試みません。

Semantic stateをclearし、human-intervention errorを返します。ユーザーが手動で必要stepを完了した後、元のMaps actionを最初から再実行してください。

## Deployment

HTTP serverはデフォルトloopback bindです。Tunnel / Reverse Proxyで公開する場合も、可能な限りNode processはloopbackのまま、host restrictionと認証付きaccessを設定します。

Non-loopback bindはapplication-level `MCP_BEARER_TOKEN` がない限り拒否します。Front proxy認証だけを理由に、direct reachableなnon-loopback Node portを無認証にはできません。

Chrome DevTools endpointをuntrusted / public networkへ公開しないでください。本projectが起動するChromeはremote debuggingを `127.0.0.1` へbindします。

`MAPS_CDP_PORT` はadvanced local escape hatchで、既存endpointへattachするには `MAPS_ALLOW_EXTERNAL_CDP=true` が必要です。

## Testing Boundary

通常push / PR CIはGoogle Maps pageへアクセスしません。Maps trafficなしでLinux / macOS / Windows上のbrowser / CDP runtimeを検証します。

`Live Maps E2E (manual)` は `workflow_dispatch` でのみ明示起動できます。固定・低ボリュームのplace search/read/selectとtransit route/read/select互換性だけを確認し、screenshot、DOM/AX dump、review harvesting、artifact、persistent resultを保存しません。

Access challengeが出た場合は回避せず停止します。

この分離により、実Maps automationをuser-triggeredに保ちながら、UI-dependent release前にrepeatableなregression checkを行えます。

## Project Status

Google Maps UI構造、machine-readable access instruction、service termsは変更される可能性があります。Interactive readingをproduction用途で使う前に、maintainer / userはbehaviorとtermsを定期的に再確認してください。
