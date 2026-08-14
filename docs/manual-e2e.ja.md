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

固定workflowは、確立済みsearch/read/select path、**V4 selected-place share-link operationをちょうど1回**、確立済みtransit route read/select pathを確認します。Result crawling、screenshot、review harvesting、persistenceへは広げません。

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

## 6. V4 Selected-Place Tab

Interactive Assist有効かつfreshにverifiedされたactive placeからだけ実行します。

1. `maps_select_place_tab({ expectedLabel, tab: "about" })` の後に `maps_select_place_tab({ expectedLabel, tab: "overview" })` をcall
2. State-changingな成功ごとにrequested tabのselected state、same-place identity、resource epoch更新を確認。既にselectedならidempotentであること
3. Reviews enumはtestしない。current visible Reviews tabを再観測できるまで意図的にschemaへ含めない
4. Wrong identity、missing/duplicate control、unexpected navigation、invalid postconditionはfail closed。Click後にpostconditionを検証できなければprior semantic stateを利用可能なまま残さない

## 7. Route Read / Select

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