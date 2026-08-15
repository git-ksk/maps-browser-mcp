# MCP Apps Portability / Deployment

`maps-browser-mcp` ではMCP Appsをoptionalな **progressive enhancement** として扱います。Directionsのcore resultはtext + structured dataで、inline Google Maps Embed viewはdeployment側で明示的に設定した場合だけ追加されます。

この文書ではhost-neutralなcontract、security boundary、compatibility evidence、追加production hostに対する残るre-validation gateを整理します。

## Contract

| Surface | Behavior |
| --- | --- |
| Tool | `maps_render_directions` |
| Core result | 常に有用なtext + `{ origin, destination, mode }` structured contentを返す |
| UI resource | `ui://maps-browser-mcp/directions.html` |
| MIME type | `text/html;profile=mcp-app` |
| MCP Apps extension | `io.modelcontextprotocol/ui` |
| Tool/UI linkage | `_meta.ui.resourceUri`。Embed feature設定時のみ付与 |
| Nested frame CSP | `ui.csp.frameDomains = ["https://www.google.com"]` |
| Display mode | inlineのみ |
| Browser controllerへの影響 | なし。Dedicated Google Maps browser sessionをnavigate/mutateしない |

### `GOOGLE_MAPS_EMBED_API_KEY` 未設定時

`maps_render_directions` 自体は常に登録されます。Text / structured contentを返し、inline renderingが無効であることも明示します。このfeatureについてserverはMCP Apps extensionをadvertiseせず、toolへ `_meta.ui.resourceUri` を付けず、directions UI resourceも登録しません。

MCP Appsを必要としないhostやrenderできないhostでは、このfallback stateを利用できます。

### `GOOGLE_MAPS_EMBED_API_KEY` 設定時

同じtoolが同じtext / structured resultを維持したまま `ui://` resourceへlinkします。MCP Apps対応hostはinline renderでき、UI metadataを無視するhostでもcore resultは残ります。

Viewはstable MCP Apps `2026-01-26` lifecycleに合わせ、次を処理します。

- `ui/initialize` / `ui/notifications/initialized`
- complete tool input / tool result notification
- cancellation / error-result cleanup
- `ui/notifications/host-context-changed`
- theme、locale、host style variable、safe-area inset、container dimension
- `ui/notifications/size-changed`
- `ping`
- `ui/resource-teardown` cleanup

Viewが受理するmessage sourceはdirect parentだけです。Outboundの `postMessage(..., "*")` は意図的です。MCP Apps Viewはopaque-origin sandbox proxyの背後で動く場合があり、View自身が固定parent originを仮定できないためです。

## Layout behavior

Google Maps Embedは各dimension 200px未満をsupportしません。そのためnested mapのheightは200–520pxにboundedし、hostからcontainer height / max-heightが渡れば反映し、safe-area insetも考慮します。Host containerが極端に低い場合はmapを200px未満へ潰さず、outer View側をscroll可能にしてclipを避けます。

Flexible hostには `ui/notifications/size-changed` でcontent size変化を通知します。実際のcontainer sizeのauthorityはhost側にあります。

## Loading / Error / Cancellation / Teardown

Nested map準備前はboundedなstatus lineを表示します。Tool cancellationまたはerror resultを受けた場合、以前のiframe sourceをclearしてstale route UIを残しません。TeardownではResizeObserverをdisconnectし、frame/current routeをclearし、pending View requestをrejectしてから `ui/resource-teardown` に応答します。

Invalid/restricted API keyなどGoogle自身のiframe内で発生するMaps Embed errorはGoogle側error surfaceとして扱います。それを理由にbrowser controlへfallbackしたり、internal Maps APIを探索したりしません。

## Security / Deployment

`GOOGLE_MAPS_EMBED_API_KEY` はdeployment configurationです。実keyをrepository、生成artifact、screenshot、test fixture、logへcommit/記録しないでください。

このfeature専用keyを使い、**Maps Embed API** へのAPI restrictionを付けます。Application restrictionは実際のhost/referrer environmentに合わせ、production hostごとに検証してください。別hostを通すためだけにrestrictionを緩めないでください。Nested iframeにはGoogleがreferrer-based key restriction向けに推奨する `referrerpolicy="strict-origin-when-cross-origin"` を設定しています。

Maps Embed APIはbrowser/iframe APIなので、keyはclient-side MCP App HTMLへ渡されます。Application credentialではなくrestricted client-side API keyとして扱います。Account credential、password、MFA/OTP、browser cookie、OAuth token、Google Maps internal API responseはこのUI経由でrelayしません。

Resource CSPはnested frameに必要なoriginだけを宣言します。Genericな `connectDomains`、external script/style origin、camera、microphone、geolocation、clipboard permissionは不要です。

MCP Apps対応を理由にMaps controller surfaceは広げません。Raw DOM/CDP/Accessibility、generic click、arbitrary navigation、generic text entry、pointer primitive、scraping、review harvesting、CAPTCHA handlingは追加しません。

## Transport note

MCP AppsはUI extensionであり、MCP server自体をbrowser-CORS endpointへ変更する必要はありません。このprojectのHTTP transportは `/mcp` のPOST-onlyを維持し、UI featureのためだけにgeneric CORS preflightを公開しません。

Official `ext-apps` basic reference hostはbrowser内でMCP clientを実行するためbrowser CORSが必要です。Project-level reference-host checkでは、変更していないMaps MCP transportの前段にtemporary / localhost-only / exact-origin CORS adapterを置きました。このadapterはtest infrastructureであり、supported production deployment modeではなくrepositoryにも含めません。

## Compatibility evidence

2026-08-15時点:

| Host/client | Result | Scope |
| --- | --- | --- |
| ChatGPT Web | **PASS** | 既存project PoCでRemote MCP接続からreal Google Maps Embed directions viewのrender成功を確認済み |
| Official `modelcontextprotocol/ext-apps` basic reference host | **MCP Apps pipeline PASS** | Resource discovery、CSP propagation、sandbox/View lifecycle、tool input/result delivery、nested iframe作成、responsive host container behaviorからGoogle Embed surface到達まで確認。意図的なdummy API keyはGoogleにrejectされたため、real map render成功は主張しない |
| Official `@modelcontextprotocol/sdk` client / Embed keyなし | **PASS** | `maps_render_directions` がUI linkageなしでも存在し、有用なtext + structured route dataを返すことを確認 |
| VS Code Stable | **project未検証** | VS Code公式はMCP Appsとstandard Tool + `ui://` resource modelをsupport。現時点でこのrepositoryはVS Code上のreal-key inline render成功を主張しない |

Reference-host checkはupstream `modelcontextprotocol/ext-apps` commit `10195ad91851502134930e9b80ec2c04e277a720` とpublished 1.7.x host/SDK packageを使用しました。これはportability checkであり、すべてのproduction host検証の代替ではありません。

## Portability milestone completion criteria

MCP Apps portability / hardening milestoneは、次をすべて維持できればcomplete扱いです。

1. MCP Apps / Embed keyなしでもtext / structured resultが有用
2. UI metadata/resource advertisementがconditionalで、UI設定がcore toolを利用不能にしない
3. Viewがstable MCP Apps lifecycleとhost-context/sizing contractに従う
4. CSP / permissionが最小
5. cancellation / error / teardownでstale route UIを残さない
6. ChatGPT以外のMCP Apps host/reference host 1つでUI pipelineを実行
7. real non-UI client 1つでfallbackを実行
8. 未検証production-host combinationを互換済みと主張せずdocsへ明記

Current hardening trackはこのcriteriaを満たします。ただしUIの **experimental** labelは、second production hostでreal-key Google Maps Embed renderが成功するまで維持します。適切なenvironmentが利用可能になった時、またはMCP Apps stable specification / host behaviorがmaterialに変わった時だけproduction-host validationをre-openします。

## References

- MCP Apps stable specification: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- MCP Apps reference implementation: https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host
- VS Code MCP Apps developer guide: https://code.visualstudio.com/api/extension-guides/ai/mcp
- Google Maps Embed API: https://developers.google.com/maps/documentation/embed/embedding-map
