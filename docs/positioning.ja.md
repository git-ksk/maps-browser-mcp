# Project positioning

[English](positioning.md) | [日本語](positioning.ja.md) | [V4 capability inventory](maps-web-capability-inventory.ja.md)

`maps-browser-mcp` は、**制約を強く設けたexperimentalなGoogle Maps browser controller for MCP** です。ユーザーが明示的に依頼した範囲で、表示中のGoogle Maps Web UIを操作するための、boundedでMaps-specificなcontrol surfaceを提供します。

structuredなGoogle Maps公式interfaceとdata breadthで競うことや、general-purpose browser MCPのように任意Webを操作することは目的ではありません。

## 公式のstructured Maps interfaceで足りる場合はそちらを優先する

supported Google Maps Platform APIやGoogle-managed Maps MCPでapplicationの必要な情報・操作を満たせて、Google Maps Webそのものを使う必要がない場合は、その公式structured interfaceを優先します。

browser automationを使うのは、実際にuser-visibleなMaps Web surfaceを使い、かつこのprojectのsafety / compliance boundaryに収まるbounded workflowに限るべきです。browser pathが存在することを、単にAPI利用を避けるため公式機能を複製する理由にはしません。

ただし、このofficial interface優先は **priority signalであり、hardなscope exclusionではありません**。公式structured interfaceと機能が重複していても、Google Maps Web上の一貫したworkflowを成立させるsemantic primitiveとして必要なら `maps-browser-mcp` のscopeに含めます。

## Product scopeと実装優先度

長期的なproduct directionは、projectのMaps-onlyなcapability surfaceとsafety boundaryを維持しながら、**Google Maps Webでユーザーが意味のある形で実行できる主要operationを広くsemanticにカバーすること**です。

V4ではこれを次のmilestoneとして明確化します。

> **V4 = broad semantic coverage of major Google Maps Web capabilities available without authentication**
>
> 認証なしで利用できる主要なGoogle Maps Web capabilityを、Maps-specificなsemantic MCP operationとして広くカバーする。

V4のimplemented / remaining / login-required coverage正本は [Google Maps Web Capability Inventory](maps-web-capability-inventory.ja.md) です。認証必須workflowは未ログインcoverage milestoneへ混ぜず、V4より後へ送ります。

scopeは「公式API / Google-managed MCPでもできることを全部引いた残り」として定義しません。公式機能との重複は、scopeからの除外ではなく実装優先度に反映します。

1. **最優先 — browser-native / UI-dependentなMaps capability。** 実際のMaps Web experienceやvisible browser stateに価値がある操作を優先します。visibleな検索結果・routeの選択/再選択、UI mode変更、Street View interaction、Maps-specificなmulti-step workflow、visible-state verification、正当なmanual interventionが必要な場合のsafe Human handoffなどです。
2. **通常優先 — browser workflow完結に必要な重複capability。** search、directions、place / route summary等はstructured interfaceと重複し得ますが、visible Maps workflowの開始・継続・検証・完了に必要なsemantic primitiveなら実装対象です。
3. **低優先 — browser固有価値が薄いstructured/data-equivalent capability。** pure geocoding系utility、bulk calculation、広範なdata lookupなど、supported structured interface以上のbrowser-specificな価値が小さいものは、browser-nativeな開発を押しのけてまで優先しません。scope外と自動判定はしませんが、単なるfeature parityではなく具体的なMaps Web workflow上の理由を必要とします。

要約すると、**official overlapはpriorityを下げるが、featureを自動的にscope外にはしない** という方針です。Google Maps Webの有用なexperienceに対するfeature coverageは長期方向ですが、structured Maps data APIとのfeature parity自体は目的にしません。

## このprojectの位置づけ

| Surface | 向いている用途 | `maps-browser-mcp` のboundary |
| --- | --- | --- |
| Google Maps Platform / Google-managed Maps MCP | supportedなstructured Maps / grounding / place / route等のdata・operation | workflowがstructured dataだけで完結するならこちらを優先。ただしMaps Web workflowに必要なbrowser semantic primitiveまでscope外にはしない |
| General-purpose browser MCP | 幅広いWeb navigation・任意browser automation | Maps-specific actionだけを公開し、domain capability surfaceを大幅に小さく保つ |
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

Google Maps Webのcoverageを広げる場合も、raw browser / CDP primitiveを公開するのではなく、**semanticなMaps operationを追加する形**で進めます。

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

- usefulなGoogle Maps Web workflowのsemantic coverage拡大
- structured-data-equivalent featureよりbrowser-native / UI-dependent capabilityを先に進めること
- supportedなvisible Maps workflowのsemantic stability
- UI stateが曖昧になった場合のdeterministic fail-closed behavior
- broad unattended crawlingではなくbounded compatibility E2E
- dedicated browser / CDP runtimeのportabilityとisolation
- 明確なpolicy / audit behavior
- official Google Maps API / MCP capabilitiesとの重複をpriority判断材料として定期的に見直すこと

優先しないもの:

- structured APIとのfeature parity自体を目的にすること
- extraction volumeの拡大
- persistent content collection
- generic browser-control primitive
- access challengeのbypass
- 単にAPIを使わないためだけのofficial structured Maps capability複製

詳細なoperational boundaryは [Compliance and safety boundaries](compliance.ja.md) を参照してください。