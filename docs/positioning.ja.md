# Project positioning

[English](positioning.md) | [日本語](positioning.ja.md)

`maps-browser-mcp` は、**制約を強く設けたexperimentalなGoogle Maps browser controller for MCP** です。ユーザーが明示的に依頼した範囲で、表示中のGoogle Maps Web UIを操作するための小さなcontrol surfaceを提供します。

structuredなGoogle Maps公式interfaceとdata breadthで競うことや、general-purpose browser MCPのように任意Webを操作することは目的ではありません。

## 公式のstructured Maps interfaceで足りる場合はそちらを優先する

supported Google Maps Platform APIやGoogle-managed Maps MCPでapplicationの必要な情報・操作を満たせる場合は、その公式structured interfaceを優先します。

browser automationを使うのは、実際にuser-visibleなMaps Web surfaceが必要で、かつこのprojectのsafety / compliance boundaryに収まるbounded workflowに限るべきです。browser pathが存在することを、単にAPI利用を避けるため公式機能を複製する理由にはしません。

## このprojectの位置づけ

| Surface | 向いている用途 | `maps-browser-mcp` のboundary |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supportedなstructured Maps / grounding / place / route等のdata・operation | workflowを満たすならこちらを優先。このprojectはvisible Maps UIのbounded interaction向け |
| General-purpose browser MCP | 幅広いWeb navigation・任意browser automation | Maps-specific actionだけを公開し、control surfaceを大幅に小さく保つ |
| Scraper / dataset harvester | bulk collection・persistent extraction | 明示的に対象外。visible-state readはbounded / transient / opt-inでdataset APIではない |
| `maps-browser-mcp` | constrained user-directed Maps browser control | local dedicated browser、fail-closed semantic state、bounded read、bypass / harvesting機能なし |

## 守るべきdesign boundary

このprojectの差別化はMaps dataをより多く抽出することではありません。次の組み合わせが中心です。

- generic browser primitiveではなくMaps-specific MCP tool
- dedicated Chrome / Chromium profile
- defaultでloopback-onlyなCDP
- 実用上可能な範囲でofficial Maps URLを利用
- 1つのsemantic browser stateに対するoperation serialization
- visible UIが変化した場合のstale selection拒否
- bounded / opt-inなvisible-state read
- access challengeをbypassせずhuman handoffへ移す設計
- internal Maps API interception、stealth、proxy rotation、bulk crawlingを実装しない

## Compliance posture

このprojectは、すべてのbrowser-agent operationやbounded visible-state readがGoogleのterms、法律、すべてのjurisdictionで必ず許可されるとは主張しません。

Google Maps contentに対してAPIと同等の権利があるとも主張しません。

次の用途向け機能は意図的に設計しません。

- bulk feed / download
- persistent Maps dataset
- place / review / route harvesting
- full DOM / accessibility-tree export
- undocumented internal endpoint access
- CAPTCHA / anti-bot bypass
- stealth / fingerprint spoofing
- generic arbitrary-site browser automation

Google Maps UI、service terms、access behavior、supported official interfaceが変化した場合は、影響するbrowser workflowを再評価し、必要ならscopeを狭めるか無効化します。

## Product direction

優先するもの:

- supportedなvisible Maps workflowのsemantic stability
- UI stateが曖昧になった場合のdeterministic fail-closed behavior
- broad unattended crawlingではなくbounded compatibility E2E
- dedicated browser / CDP runtimeのportabilityとisolation
- 明確なpolicy / audit behavior
- official Google Maps API / MCP capabilitiesとの重複を定期的に見直すこと

優先しないもの:

- extraction volumeの拡大
- persistent content collection
- generic browser-control primitive
- access challengeのbypass
- 単にAPIを使わないためだけのofficial structured Maps capability複製

詳細なoperational boundaryは [Compliance and safety boundaries](compliance.ja.md) を参照してください。