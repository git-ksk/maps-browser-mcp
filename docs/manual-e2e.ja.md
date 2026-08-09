# User-directed Live Google Maps E2E チェックリスト（日本語）

[English](manual-e2e.md) | 日本語

通常CIは意図的にGoogle Maps pageへアクセスしません。Google Maps実UIに依存するreleaseでは、repositoryの**manual-only** GitHub Actions workflow `Live Maps E2E (manual)`、またはcontrolled local environmentからこのchecklistを使って互換性を確認します。

Live workflowは `workflow_dispatch` からのみ起動します。固定・低ボリュームの2 scenarioだけを実行します。

- `Tokyo Station` 周辺のplace / category search
- `Tokyo Station` → `Yokohama Station` のtransit route

Screenshot、DOM / AX dump、review、cookie、browser profile、Maps result artifactは保存しません。

同じbounded scriptをGitHub-hosted runner上の `host` path、またはrepository Dockerfileからbuildしたimage内の `container` pathで実行できます。`container` はpackaged headless Chromium runtimeと実Google Maps UIの組み合わせを必要時だけ検証するためのもので、通常CIへlive Maps accessを追加するものではありません。

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

確認内容:

- Official Maps URL navigationがGoogle Maps web surface内に留まる
- Bounded V3 place readが限定UI dataだけを返し、untrustedとしてmarkする
- 少なくとも1件のselectable place candidateを検出
- `index + expectedLabel` で現在の同一place candidateを選択
- Transit directions requestがbounded route dataを返す
- 少なくとも1件のselectable route candidateを検出
- `index + expectedLabel` で現在の同一route candidateを選択
- Access challenge / non-Maps redirectを回避せずfailする

期待するLive path:

```text
place search
  -> bounded place read
  -> guarded place selection
  -> transit directions
  -> bounded route read
  -> guarded route selection
```

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

1. `maps_read_place_summary` または `maps_read_route_summary` をcall
2. `INTERACTIVE_ASSIST_DISABLED` が返り、page readしないことを確認

## 4. V3 Place Read / Select

`INTERACTIVE_ASSIST_MODE=true` で再起動します。

1. `maps_search` を1回実行
2. `maps_read_place_summary`
3. Resultが小さく `untrustedExternalText: true` を含むことを確認
4. Raw HTML、full DOM / AX dump、review body、cookie、network payloadを含まないことを確認
5. `items[{ index, label }]` から1件選ぶ
6. その `index` とexact `label` を `expectedLabel` として `maps_select_result`
7. 意図したplaceが開くことを確認

Step 6前にlistが変わった場合、期待動作はbest-effort clickではなく `UI_STATE_CHANGED` です。

## 5. V3 Route Read / Select

1. `maps_directions` を1回実行
2. `maps_read_route_summary`
3. Boundedな少数route-related label / lineだけ返ることを確認
4. `index + expectedLabel` で1 routeを選択
5. 意図したrouteが選択されることを確認

## 6. Manual Navigation / Stale-State Guard

1. MCP経由でMaps searchまたはdirectionsを開始
2. 専用browserを人間が別Maps surfaceへmanual navigation
3. 以前のsemantic operationを再実行（例: prior result select / travel mode変更）

期待結果: `UI_STATE_CHANGED`。元のsearch / directions actionを再実行するよう要求され、古いsemantic stateでは操作しません。

## 7. Human Intervention Boundary

同意、sign-in、CAPTCHA、その他access challengeが表示された場合:

1. MCPが `HUMAN_INTERVENTION_REQUIRED` で停止することを確認
2. CAPTCHA solving、stealth / fingerprint変更、proxy rotation、internal endpoint callを試みないことを確認
3. Userが手動解決した場合、古いstateから継続せず元のMaps actionを再実行

Test目的でaccess challengeを意図的に発生させないでください。Challenge URL / redirectのfail-closed境界はdeterministic repository testで確認し、live confirmationは自然発生時だけ行います。

## 8. Bulk Policy Boundary

広範囲の全店舗・全review収集など、明らかなbulk-oriented search requestを送ります。

期待結果: Browser navigation前に `POLICY_BLOCKED`。

拒否されたbulk requestを多数の小callへ分割して回避しないでください。

## Release Result

記録するのはpass / fail、選択したruntime（`host` / `container`）、確認時のGoogle Maps UI date / localeだけにしてください。

Public Issueへ以下を添付しないでください。

- account情報
- private location
- cookie
- browser profile
- personal identifier
- screenshot / logに含まれる機密情報

Candidate extractionがLive Maps UIと一致しなくなった場合、semantic selectorを更新してこのchecklistが再度passするまで対象toolをExperimental / disabledとして扱います。

Release全体の手順は [Release Checklist 日本語版](release.ja.md) を参照してください。
