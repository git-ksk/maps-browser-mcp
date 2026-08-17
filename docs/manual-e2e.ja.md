# User-directed Live Google Maps E2E チェックリスト（日本語）

[English](manual-e2e.md) | 日本語

通常CIは意図的にGoogle Maps pageへアクセスしません。Google Maps実UIに依存するreleaseでは、repositoryの**manual-only** GitHub Actions workflow `Live Maps E2E (manual)`、またはcontrolled local environmentからこのchecklistを使って互換性を確認します。

既存Live workflowは固定・低ボリュームのまま維持します。V4 capabilityごとの確認を広範なcrawlerへ拡張せず、変更したsemantic operationに必要なbounded scenarioだけを実行してください。

このworkflow / checklistをunattended crawlingへ拡張しないでください。各scenarioは通常requestを1件だけ使い、Googleがaccess challengeを表示した場合は停止します。

## GitHub Actionsから手動実行

1. GitHub Actionsで **Live Maps E2E (manual)** を開く
2. **Run workflow** を選択
3. confirmation inputへ `run-live-check` を指定
4. Execution environmentを1つ選択
   - 通常runner pathは `host`
   - buildしたcontainer imageで確認する場合は `container`
5. workflowを実行

Dockerfile、headless Chromium startup、browser profile path、container filesystem前提、container固有Chrome flagを実質的に変更したrelease前は `container` を選択してください。Routine activityのたびに両方を実行せず、live checkは低ボリュームかつ目的に応じて実行します。

固定workflowは、bounded autocomplete read/selectを1回、search-shareを1回、確立済みbounded place workflow（代表的なphoto / nearby / place-shareを含む）、fresh simple transit 1件でRecommended/Best後のbounded route read/selectを確認します。Result crawling、capability-by-capability probing、screenshot、review harvesting、persistenceへは広げません。

`container` pathはrepository Dockerfileをbuildし、同じbounded scriptをそのimage内で実行します。Chromium sandboxが使えるcontainer設定を使い、`MAPS_ALLOW_UNSANDBOXED_CHROMIUM` は有効化しません。どちらのpathにもartifact upload stepはありません。

## Full Manual Checklistの前提条件

- 普段使いprofileではなく `maps-browser-mcp` 専用Chrome profileを使用
- Chrome DevTools portをlocal / privateに維持
- 先に以下が通ることを確認

```bash
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run check
npm run build
npm run smoke:http
npm run smoke:browser
```

- 最初は `INTERACTIVE_ASSIST_MODE=false` で起動
- live checkはlow-frequency / bounded / user-directedなcompatibility確認に限定
- consent / sign-in / CAPTCHA / challengeをtest目的で意図的に発生させない

## 1. Search Navigation

1. `maps_search` で通常の公開place / category queryを1件実行
2. 専用browserがGoogle Maps searchを開くことを確認
3. MCPがnon-Maps pageへ遷移しないことを確認
4. Serverがresult contentをpersistent保存しないことを確認

期待結果: 1 MCP call → 1 Maps URL navigation。

Interactive Assist有効でV4 Rating-filter sliceを検証する場合:

1. Freshな `maps_search({ query })` result viewから開始
2. `maps_set_search_rating({ expectedQuery: query, rating: "4.0" })` をcall
3. 同じvisible query/search stateを維持し、初回の変更成功は `alreadyApplied: false` になることを確認
4. 同じcallを再実行し、`alreadyApplied: true` かつresource epochが再更新されないことを確認
5. 意図的に違う `expectedQuery`、missing/duplicate Rating target、option/menu変化、unexpected navigation、invalid selected-chip postconditionはfail closed。Filterが既に変わった可能性がある状態で検証失敗した場合、prior semantic contextを無効化すること
6. arbitrary filter text、raw DOM/AX payload、search-result harvesting、URL内部filter token解析を公開しないことを確認

Interactive Assist有効でV4 search-zoom sliceを検証する場合:

1. Freshな `maps_search({ query })` result viewから開始し、public Maps search pathのsettled integer zoom levelを確認
2. `maps_zoom_search({ expectedQuery: query, direction: "in" })` をcallし、same visible query/search stateのままzoom levelがexact 1段増えることを確認
3. `maps_zoom_search({ expectedQuery: query, direction: "out" })` をcallし、same visible query/search stateのままzoom levelがexact 1段減ることを確認。Map center座標のbyte-level完全一致は要求しない
4. 意図的に違う `expectedQuery`、missing/duplicate/disabled Zoom control、unexpected navigation、opposite/overshoot zoom transition、invalid postconditionはfail closed。Click済みの可能性がある状態で検証失敗した場合、prior semantic contextを無効化すること
5. このtoolからcoordinates、arbitrary zoom level、generic pan/drag、root-map zoom、place-view zoomを公開しないことを確認

Interactive Assist有効でV4-F autocomplete sliceを検証する場合:

1. `maps_read_search_suggestions({ query: "Tokyo Station" })` をcallし、fresh suggestion stateを開いて最大6件の `items[{ index, label }]` と `untrustedExternalText: true` だけを返すことを確認
2. Mapsがsame primary nameを複数出す場合、secondary visible identityを含むcomposite labelで区別され、raw combobox/DOM/AX payloadを返さないことを確認
3. Rereadせず `maps_select_search_suggestion({ query, index, expectedLabel: "deliberately wrong" })` をcallし、`UI_STATE_CHANGED`、row未activate、resource epoch不変、same suggestion state維持を確認
4. Exact returned `index + expectedLabel` で再callし、controlled suggestion gridがclose、Mapsがverified search/place viewへsettle、adopt時にresource epochがexact 1回進むことを確認
5. Duplicate composite identity、reorder/missing target、active query変化、unexpected navigation、unverifiable postconditionはfail closed。Primary textだけ、expected identityなしのDOM position、pointer geometry、hidden suggestion IDへfallbackしない

V4-F search-result shareを検証する場合:

1. Freshな `maps_search({ query })` result viewから開始
2. `maps_get_search_share_link({ expectedQuery: "deliberately wrong" })` は `UI_STATE_CHANGED`、Share未activate、resource epoch不変であること
3. `maps_get_search_share_link({ expectedQuery: query })` はexact visible search identity、exact-one Share、selected Send-link tab、exact-one visible allow-listed Maps URLを必須とすること
4. Success後はShare dialogがsemanticにcloseされ、元のsearch action/viewが利用可能、resource epoch不変であること
5. Clipboard read/intercept、current browser URLの代用、network interception、raw DOM/AX outputを使わないこと

## 2. Directions Navigation

1. 公開origin / destinationと `mode=transit` で `maps_directions`
2. Google Maps directions viewが開くことを確認
3. `maps_set_travel_mode` を1回実行
4. Generic UI clickではなくdirections URLが再compileされることを確認

## 3. Safe Mode

`INTERACTIVE_ASSIST_MODE=false` の状態で:

1. `maps_read_place_summary`、`maps_read_route_summary`、または `maps_get_place_share_link` のようなV4 UI-native operationをcall
2. Rendered UIをread / actする前に `INTERACTIVE_ASSIST_DISABLED` が返ることを確認

## 4. Place Read / Select

`INTERACTIVE_ASSIST_MODE=true` で再起動します。

1. `maps_search` を1回実行
2. `maps_read_place_summary`
3. Resultが小さく `untrustedExternalText: true` を含むことを確認
4. Raw HTML、full DOM / AX dump、review body、cookie、network payloadを含まないことを確認
5. `items[{ index, label }]` から1件選ぶ
6. その `index` とexact `label` を `expectedLabel` として `maps_select_result`
7. 意図したplaceが開くことを確認

Step 6前にlistが変わった場合、期待動作はbest-effort clickではなく `UI_STATE_CHANGED` です。

## 5. V4 Selected-Place Share Link

V4 place-share semantic operationを検証するときだけ実行します。

1. Step 4でverified placeを選択した状態から続ける
2. Current test中だけselected placeのvisible heading / labelを確認し、place datasetとして永続化しない
3. そのexact active-place identityを `expectedLabel` として `maps_get_place_share_link({ expectedLabel })` をcall
4. 返却 `placeLabel` がselected placeを引き続き識別することを確認
5. 返却URLがHTTPSで、`maps.app.goo.gl` share linkまたは `www.google.com/maps...` Maps URLであることを確認
6. 成功後にShare dialogが開きっぱなしにならないことを確認
7. Clipboard dump、unrelated page text、cookie、network response、internal Maps endpoint、raw DOM / AX payloadを返さないことを確認

Fail-closed確認:

- 既にopenしているplaceに対して意図的に違う `expectedLabel` を渡す → `UI_STATE_CHANGED`、Shareをactivateしない
- readとactionの間にactive placeが変化した場合 → `UI_STATE_CHANGED`
- visible Share targetまたはresult share URLがmissing / ambiguousな場合 → 推測click/linkではなくsemantic error

Sign-in / consent / CAPTCHA / challengeをこのoperationのtest目的で意図的に発生させないでください。自然発生した場合だけ下記Human Intervention確認へ移行します。Handoff完了後はplace workflowをfreshにreissueし、identityを再検証します。旧share actionを自動replayしません。

## 6. V4 Selected-Place Tab / Opening Hours

Interactive Assist有効かつfreshにverifiedされたactive placeからだけ実行します。

1. `maps_select_place_tab({ expectedLabel, tab: "about" })` の後に `maps_select_place_tab({ expectedLabel, tab: "overview" })` をcall
2. State-changingな成功ごとにrequested tabのselected state、same-place identity、resource epoch更新を確認。既にselectedならidempotentであること
3. Reviews enumはtestしない。current visible Reviews tabを再観測できるまで意図的にschemaへ含めない
4. FreshなOverview placeから `maps_expand_opening_hours({ expectedLabel })` をcallし、返却が展開stateだけで週間営業時間textを返さないことを確認
5. `placeStateRetained: true` なら再実行が `alreadyExpanded: true` かつepoch不変になることを確認。`placeStateRetained: false` ならprior place semantic stateが無効化され、次のsemantic action前にplaceを再取得すること
6. Wrong identity、missing/duplicate control、unexpected navigation、invalid postconditionはfail closed。Click後にpostconditionを検証できなければprior semantic stateを利用可能なまま残さない

## 7. Route Read / Select

### V5-D Send to Phone Approval Boundary

`MAPS_V5_AUTHENTICATED_WORKFLOWS=true`、Interactive Assist有効、signed-in dedicated single-user profile、2026-07-28 form elicitationをadvertiseするmodern MCP clientでだけ実行します。Personal route/deviceをunattended mutation targetにしません。

1. Explicit origin、waypointなし、avoidなしのfresh simple single-destination `maps_directions({ origin, destination, mode })` を開始
2. `maps_read_route_summary` で1 routeを選び、exact `index + expectedLabel` でselect
3. `maps_read_route_send_targets({ expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel })` をcall。Device targetが最大6件、email/free-form recipientとnotification checkboxは返らず、paginationなし、sendせずSend-to-phone dialogをcloseすることを確認
4. Exact returned deviceの `index + expectedDeviceLabel` で `maps_send_route_to_device(...)` をcall。Device click前にMCPが `input_required` とsingle `action-approval` formを返し、signed requestStateがexact principal / epoch / route / deviceへbindされること。Form elicitation非対応clientはapproval record作成/send attempt前にfailすること
5. Approvalを1回cancelし、`action_approval_cancelled` かつsend 0件を確認。Human Intervention completionはaction approvalを満たさないこと
6. Humanがapproval formに表示されたexact route + exact deviceを明示承認した場合だけaccepted approvalでretry。Device click直前にsigned-in readiness、canonical route identity、selected route index+label、resource epoch不変、exact device index+labelをfresh revalidateし、approvalをsingle exact device click直前にone-shot consumeすること
7. Successはexact deviceへのvisible Send-to-phone confirmationを必須化。Confirmation missing/ambiguousまたはstate change時はfailure + stale semantic state invalidateとし、**sendをautomatic retryしない**
8. Email/phone text entry、account switching、notification setting mutation、Maps internal API/XHR interception、credential/account identity read、generic browser primitiveが公開されていないことを確認

Exact Human approvalが無いlive compatibility checkはstep 5で停止してよく、その場合external-send postconditionをlive-validatedとclaimしません。

V4-F Recommended/Best travel-mode sliceは、explicit origin・waypointなし・avoidなしのfresh simple `maps_directions({ origin, destination, mode: "transit" })` requestから開始します。

1. `maps_set_recommended_travel_mode({ expectedOrigin: "deliberately wrong", expectedDestination: destination })` はUI mutation前に `UI_STATE_CHANGED`、resource epoch不変であること
2. `maps_set_recommended_travel_mode({ expectedOrigin: origin, expectedDestination: destination })` を1回callし、exact-one `おすすめ / Best` selected、resolved visible origin/destination不変、directions surface維持を確認
3. Successでresource epochがexact 1回進み、stale replayable canonical directions actionが破棄され、current directions viewは維持されること
4. Bounded settle後も `maps_read_route_summary` とguarded `maps_select_route(index, expectedLabel)` がsame sessionで利用可能なこと
5. Origin省略、waypoint、avoid、non-transit、missing/duplicate Recommended control、unexpected navigation、invalid postconditionはfail closed。Stale `travelmode=transit` URLやopaque `/data=` payloadからRecommended stateを推測しない

V4-Dの当日transit-time sliceを検証する場合、Interactive Assist有効でfreshなsimple `maps_directions({ origin, destination, mode: "transit" })` requestから開始します。

1. `maps_set_transit_time({ expectedOrigin: origin, expectedDestination: destination, mode: "depart_at", time: "13:30" })` をcall。`arrive_by` pathの互換性確認が必要な場合だけ別fresh routeで実行
2. Wrong expected origin/destinationはUI mutation前にfailし、resource epochを更新しないことを確認
3. Successではvisible resolved origin/destination値不変、localized selected time mode + exact transit-time input、directions view維持を検証し、resource epochが1回だけ進むことを確認
4. Success後は元のreplayable navigation actionが破棄されることを確認。staleなpre-time stateから `maps_set_travel_mode` や別UI-only route mutationを自動適用しない
5. Route list settle後、same browser sessionで `maps_read_route_summary` とguarded `maps_select_route(index, expectedLabel)` が使えることを確認。Requested timeに運行がないケースは正当なのでroute candidate 1件以上をtime-setting postconditionにはしない
6. Missing/duplicate control、stale route endpoint、unexpected navigation、invalid time postcondition、Human Interventionはfail closed。Opaque `/data=` route payloadを解析せず、generic text entryも公開しない
7. 日付指定、終電、transit preference optionはこのsliceに含めない

V4-D selected transit-route shareは、fresh simple `maps_directions({ origin, destination, mode: "transit" })` からroute candidateを読み、guarded `maps_select_route(index, expectedLabel)` で1件選択して開始します。

1. `maps_get_route_share_link({ expectedOrigin: origin, expectedDestination: destination })` をcall
2. Wrong expected endpointはshare dialogを開く前にfailし、resource epochを更新しないことを確認
3. Successではselected-route detail view、exact Share directions control、selected Send-link tab、exact-one visible allow-listed Maps share URLを必須とし、clipboard read/interceptを使わないことを確認
4. Exact Close semanticsでdialogを閉じ、route view/canonical actionが維持され、このread-only semantic operationではresource epochが進まないことを確認
5. Driving/その他mode、waypoint/avoid route、未選択directionsのCopy link surfaceはこのsliceに含めない

V4-D endpoint swapは、explicit origin・waypointなしのfresh simple `maps_directions({ origin, destination, mode })` requestから開始します。

1. `maps_swap_route_endpoints({ expectedOrigin: origin, expectedDestination: destination })` をcall
2. Wrong expected endpointはnavigation前にfailし、resource epochを更新しないことを確認
3. Successではdocumented Maps URLのorigin/destinationが逆順に再構築され、travel modeとbounded avoidを維持、canonical directions actionも更新、resource epochがexact 1回進むことを確認
4. Origin省略またはwaypoint routeはreversal semanticsを推測せずfail closedすること
5. 観測済みMaps swap UI controlを実装がclickしないことを確認。Live観測ではvisible inputはswapする一方、canonical URL/actionがstaleに残ったためUI actionは採用しない

1. `maps_directions` を1回実行
2. `maps_read_route_summary`
3. Boundedな少数route-related label / lineだけ返ることを確認
4. `index + expectedLabel` で1 routeを選択
5. 意図したrouteが選択されることを確認

## 8. Manual Navigation / Stale-State Guard

1. MCP経由でMaps searchまたはdirectionsを開始
2. 専用browserを人間が別Maps surfaceへmanual navigation
3. 以前のsemantic operationを再実行（例: prior result select / prior place share / prior route travel mode変更）

期待結果: `UI_STATE_CHANGED`。適切なsemantic workflowを再実行するよう要求され、古いsemantic stateでは操作しません。

## 9. Human Intervention Boundary

同意、sign-in、CAPTCHA、その他access challengeが自然発生した場合:

1. MCPが `HUMAN_INTERVENTION_REQUIRED` で停止することを確認
2. CAPTCHA solving、stealth / fingerprint変更、proxy rotation、credential入力、internal endpoint callを試みないことを確認
3. Human Intervention active中はcleanup click / key / CDP inputもagentが送らないことを確認
4. Userが手動解決した場合、古いstateから継続・replayせず、意図したMaps operationをfreshにreissueしてtarget identityを再検証

Test目的でaccess challengeを意図的に発生させないでください。Challenge URL / redirectのfail-closed境界はdeterministic repository testで確認し、live confirmationは自然発生時だけ行います。

## 10. Bulk Policy Boundary

広範囲の全店舗・全review収集など、明らかなbulk-oriented search requestを送ります。

期待結果: Browser navigation前に `POLICY_BLOCKED`。

拒否されたbulk requestを多数の小callへ分割して回避しないでください。

## 11. V5-C Existing-list Save

Dedicated signed-in V5 profileで `MAPS_V5_AUTHENTICATED_WORKFLOWS=true` と `INTERACTIVE_ASSIST_MODE=true` の両方を有効にした場合だけ実行します。Account mutation checkなので、最初はread-onlyで観測し、targetを推測しません。

1. Bounded place workflowでexact selected placeを1件確立する。
2. `maps_read_place_save_state({ expectedLabel })` を呼び、signed-in readiness、bounded existing-list chooser、かつ明確にtest用と判断できる `saved=false` candidateを確認する。Private list labelはpublish / persistしない。
3. Safeなexisting test-purpose targetをexactly 1件に絞れない場合はそこで停止し、live mutationを **BLOCKED** と記録する。Personal listを推測せず、testのためだけにnew listを作らない。
4. Safe targetがexactly 1件ある場合だけ、freshに返ったindex + labelをそのまま使い `maps_save_place_to_list({ expectedPlaceLabel, listIndex, expectedListLabel })` を1回だけ呼ぶ。
5. Exact targetが `aria-checked=true` とverifyされた場合だけsuccessとする。その後 `maps_read_place_save_state` をfreshに1回実行し、same targetが `saved=true` であることを独立確認する。
6. Already-saved targetはno-click idempotent successとし、stale index/label、duplicate/missing/flattened row、changed place、changed resource epoch、signed-out/unknown readiness、unverifiable postconditionはfail closeする。
7. Cleanup目的のunsave/removeを自動化しない。意図的なdogfood後にcleanupが必要なら、MCP mutation surface外でHumanがmanualに行う。

Account name/email/profile identifier、cookie/token、chooser dump、raw private place/list contentをdurable checkpointやpublic validation logへ残しません。Human Intervention completionはaction approvalと別概念のまま、old Save attemptをreplayせずfresh semantic reissueを要求します。

## Release Result

記録するのはpass / fail、選択したruntime（該当する場合 `host` / `container`）、確認したsemantic operation、確認時のGoogle Maps UI date / localeだけにしてください。

Public Issueへ以下を添付しないでください。

- account情報
- private location
- cookie
- browser profile
- personal identifier
- screenshot / logに含まれる機密情報

Semantic targetがLive Maps UIと一致しなくなった場合、bounded selector / identity logicを更新してこのchecklistが再度passするまで対象toolをExperimental / disabledとして扱います。

V4 feature statusは [Capability Inventory](maps-web-capability-inventory.ja.md)、release全体の手順は [Release Checklist 日本語版](release.ja.md) を参照してください。