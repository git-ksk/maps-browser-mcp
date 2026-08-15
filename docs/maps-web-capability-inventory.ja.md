# Google Maps Web Capability Inventory

[English](maps-web-capability-inventory.md) | [ロードマップ](roadmap.ja.md) | [Positioning](positioning.ja.md)

この文書は、**未ログインで利用できる Google Maps Web surface の V4 coverage inventory 正本**です。

V4 は次の位置づけとします。

> **V4 = broad semantic coverage of major Google Maps Web capabilities available without authentication**
>
> 認証なしで利用できる主要な Google Maps Web capability を、Maps-specific な semantic MCP operation として広くカバーする。

Google Maps Web に表示される control を無条件に全て再現することが目的ではありません。MCP tool として追加するのは、bounded state reading、identity validation、fail-closed、既存 Human Intervention 境界を維持したまま Maps 固有の semantic operation として表現できる機能だけです。

## 優先順位・分類

status は次の6分類を使います。

- **implemented** — 現在の public MCP surface で主要操作をすでにカバーしている
- **V4 high priority** — browser-native / UI-dependent で、Google Maps Web を直接操作する価値が高い
- **V4 normal priority** — browser workflow 完結には有用だが、browser 固有価値が比較的小さい、または既存実装で一部カバー済み
- **lower priority / official overlap** — 有用だが、公式 structured interface と価値がほぼ重なり browser 固有価値が薄い
- **login required** — V4 では実装せず V5 候補。credential 境界は既存 Human Intervention を維持する
- **out of scope** — Web UI に存在しても意図的に MCP surface へ出さない

Google Maps Platform / Google-managed Maps MCP と重なること自体は scope 除外理由ではなく、**優先順位を下げる要因**として扱います。

## 2026-08-13 実ブラウザ棚卸し

専用 Chromium window で Google Maps Web を開き、画面上に **「ログイン」** control がある未認証状態で bounded manual inventory を実施しました。専用 browser process が自然終了するまでに、次を実UIで確認しています。

- 初期 map のカテゴリ検索、現在地、zoom、layer、Street View entry point
- `カフェ` の search autocomplete と local search
- result feed、価格/評価/時間/全フィルタ、検索結果共有、`地図の移動後に結果を更新`
- place panel の写真、概要/クチコミ/「〜について」tab、ルート、保存、付近を検索、モバイルデバイスに送信、共有、営業時間、website、phone、Plus Code、Street View
- 未ログインで `保存` を実行すると Google Account sign-in へ遷移すること
- place の `共有` dialog が未ログインでも `https://maps.app.goo.gl/...` の共有リンクを生成すること
- 2駅間の transit directions で travel mode、出発地/目的地入れ替え、出発時刻control、オプション、route detail、route link copy、目的地周辺shortcut、mobile送信 control

Google Maps Web は locale、viewport、experiment、地域、account state などで変化します。以下の表は semantic product decision と観測結果を記録するものであり、同じ label / DOM shape が恒久的に存在することを前提にしません。

2026-08-15にJA/ENのplace panelとstandard/wide viewportでbounded再観測した結果、place-boundな概要/OverviewとAbout tabは確認できましたが、visibleなReviews tabは再現しませんでした。営業時間controlはinline accordion型とsame-place detail-surface型の両方を確認しています。以下の実装は、その再観測済みshapeだけに意図的に限定しています。

別の2026-08-15 V4-C bounded再観測では、search resultの `role=main` 外にvisibleな価格/Price、評価/Rating、時間/Hours、すべてのフィルタ/All filtersと、明示的な「地図の移動後に結果を更新」checkboxを確認しました。RatingがJA/ENとも最小かつ安定したsliceで、exact `評価` / `Rating` buttonからlabelled menuが開き、`2.0`〜`4.5` の固定 `menuitemradio` が見えます。Bounded再観測ではselected triggerが `2.0+`、`4.0+`、`4.5+` のようなnumeric chipへ変わることも確認できたため、実装はそのselected-chip stateとmenu closedをpostconditionにします。PriceとAll filtersは別surface、Hoursは曜日×時刻の大きいdialogなので引き続きobservation/design-gatedです。

2026-08-15のsearch-this-area bounded再観測では、専用Chrome profileのJA UIと明示的な `--lang=en-US` UIを使い、visible search queryを維持し、「地図の移動後に結果を更新 / Update results when map moves」をoffのまま手動panしました。map center/pathは変化しsearch identityも維持されましたが、どちらのUIでもone-shotの `このエリアを検索 / Search this area` controlはvisibleになりませんでした。残ったのはupdate-after-move checkboxだけです。このcheckboxは自動更新behaviorを変える設定であり、要求しているexplicit semantic actionの代替にはしません。したがって `maps_search_this_area` はselector/schemaを作らずobservation-gatedのままです。

2026-08-15のcurrent-location bounded観測では、geolocation permissionを事前許可していないfreshな専用Chrome profileを使用しました。Mapsにはexact-oneのvisible `現在地を表示` / Show Your Location semantic buttonがあり、`aria-pressed=false` でした。そのexact controlをactivateするとChromeのbrowser-level位置情報permission promptへ到達し、permission choiceは一切行っていません。Prompt中もpage controlはunpressed、map pathは不変、`navigator.permissions` は `prompt` のままでした。ユーザーのpermission判断なしでは成功postconditionを観測できず、現行のpage-state Human Intervention境界自体もbrowser permission promptをauthorize/autoresumeする設計ではないため、current-location MCP actionはまだ公開しません。再開条件は、manualにauthorizedされたsessionでMaps-native success stateを観測できること、またはdedicated permission-handoff modelを設計できることです。

2026-08-15のmap-layer bounded観測では、専用JA profileと明示的な `--lang=en-US` profileを使用しました。Visibleな `レイヤ` / `Layers` entry pointはoverlapするnested `div` 2件としてrenderされ、`role`、`aria-label`、`tabindex`などのsemantic control stateがなく、bounded accessibility-name queryでも `レイヤ` / `Layers` controlは0件でした。一方、manual hover後には `地形` / Terrain、`交通状況` / Traffic、`公共交通機関` / Transit、`自転車` / Bikingがそれぞれvisibleな `menuitemcheckbox`、`aria-checked=false` として確認でき、Trafficはexact-oneで `false -> true` のpostconditionまで検証できました。つまりoption側は安全に表現可能ですが、surface openerはnested DOM heuristicまたはpointer geometryなしにexactly-oneへ限定できません。Maps側でexact-one semantic/accessible Layers opener、または同等にboundedなMaps-native surface openerを観測できるまでmap-layer MCP actionは公開しません。

2026-08-15のviewport bounded観測では、1440×1000のJA search-result viewと1280×800のexplicit en-US search-result viewを使用しました。両UIでZoom in/outはexact-oneのvisible enabled `button`（hidden duplicateはvisible-only境界で除外）、visible queryはexactに維持され、public Maps search pathにはsettled integer zoom levelが現れました。1往復だけのbounded観測でJA `17z -> 18z -> 17z`、EN `16z -> 17z -> 16z` を確認しています。Results pane geometryの影響でzoom animation中にlongitudeが少し変化したため、map center完全一致はpostconditionにしません。`maps_zoom_search(expectedQuery, direction)` はactive verified search state限定の1-level `in|out` とし、same query + exact ±1 zoom transitionだけを成功条件にします。Generic pan/recenterとroot/place zoomはこのsliceへ含めません。

2026-08-15のV4-D transit-time bounded観測では、freshなsimple Tokyo Station -> Yokohama Station transit requestをJAとexplicit en-USで使用しました。`すぐに出発 / Leave now` はexact visible buttonで、menuには `出発時刻 / Depart at` と `到着時刻 / Arrive by` がexact `menuitemradio` として現れました。どちらかを選ぶとexact-oneのvisible `input[name="transit-time"]` が出現します。13:30へのbounded editではJA `13:30`、EN `1:30 PM` を確認し、visibleなresolved origin/destination input値はbyte-for-byteで不変、pageも `/maps/dir/` を維持しました。Time mode選択後にtransit-mode radio群が消えるUI変種があるため、radio stateはpostconditionにしません。`maps_set_transit_time(expectedOrigin, expectedDestination, mode, time)` はfresh simple documented transit requestからの当日 `depart_at|arrive_by` + 24時間 `HH:MM` のみに限定します。日付指定、`終電 / Last available`、transit preference optionは引き続きobservation/design-gatedです。UI-only scheduleは元のdocumented navigation actionだけでは完全表現できないため、成功時はresource epochを更新してreplayable actionを破棄しつつ、same sessionのcurrent directions viewはbounded route read/select用に維持します。

2026-08-15のV4-D route-link bounded再観測では、UI settle後の未選択directions viewでJA/explicit en-USともexact-oneのvisible `リンクをコピー / Copy link` buttonを確認しました。ただしcontrolはvisible `href` / link valueを持たないplain buttonで、activateしてもcurrent Maps URLは変わらず、bounded visibleなlink field、share dialog、信頼できるcopied-state postconditionも現れませんでした。Guardedにroute candidateを選択した後の観測route viewではCopy link control自体がvisibleではありませんでした。Clipboard内容のread/interceptはclipboard boundaryに違反し、current URLをcopied linkと同一だと仮定するのも未検証です。したがってroute-link MCP actionは公開しません。Maps-generated linkをbounded visible semantic surfaceから取得できる、またはclipboard不要のpostconditionが成立する場合だけ再開します。

2026-08-15のV4-D route-swap bounded観測では、freshなJA/en-US transit directionsでexact-oneのvisible `出発地と目的地を入れ替える / Reverse starting point and destination` buttonを確認しました。1回だけactivateし、resolved visible endpoint値がexactに A/B -> B/A へ変化することを検証しました。一方、追加settle後もdocumented current URLとruntime canonical actionはA→Bのままで、UI clickをそのまま公開するとsemantic stateがstaleになります。そこで `maps_swap_route_endpoints(expectedOrigin, expectedDestination)` はUI controlをclickせず、同じsemantic intentをdocumented Maps directions parameterの再構築で実装します。Fresh simple route・explicit origin・waypointなしに限定し、expected canonical endpointを再検証、modeとbounded avoidを維持し、既存navigation pathでresource epoch更新と旧route candidate無効化を行います。Stateful stop editingは別sliceのままで、bounded documented waypoint自体は既存 `maps_directions` で対応済みです。

## Coverage table

| Capability | V4 status | 現在のcoverage / 目標semantic behavior |
|---|---|---|
| user-directed search を開く | implemented | `maps_search` が documented Maps search URL を開く。 |
| search/place results を bounded に読む | implemented | `maps_read_place_summary` が bounded visible label/text と保守的annotationを返す。 |
| visible search result を選択 | implemented | `maps_select_result(index, expectedLabel)` が identity を再検証し、並び替え時は fail closed。 |
| search autocomplete / suggestion 選択 | V4 high priority | suggestion を bounded に read/select する Maps-specific semantics を追加。raw combobox/DOM は公開しない。 |
| search result filter（価格/評価/時間/全フィルタ） | partial / Rating implemented | `maps_set_search_rating(expectedQuery, rating)` でlive再観測済みRating menuだけを実装し、`2.0`〜`4.5` のhalf-step固定optionに限定する。各action前にexact visible queryを再検証し、選択後はexact requested numeric rating chipとRating menu closedをpostcondition確認する。価格/時間/全フィルタはobservation/design-gatedのままでgeneric filter string APIは公開しない。 |
| このエリアを検索 / 地図移動後に更新 | observation-gated | 2026-08-15のJA / explicit en-US manual-pan再観測ではone-shotの `このエリアを検索 / Search this area` controlを確認できなかった。visibleな「地図の移動後に結果を更新 / Update results when map moves」checkboxは自動更新設定でありexplicit semantic actionの代替にしない。one-shot controlを観測できるまで `maps_search_this_area` selector/schemaは公開しない。 |
| 初期画面カテゴリ探索（レストラン/ホテル等） | V4 normal priority | semantic category search は有用だが通常 search と重なる。 |
| search result list の共有 | V4 high priority | visible search state を再検証して Maps-generated share URL を返す。 |
| result から place を開く | implemented | `maps_select_result` が verified search state から place state へ遷移。 |
| place summary を bounded に読む | implemented | full-detail harvesting をせず visible place text を扱う。 |
| place 写真を開く | implemented | `maps_open_place_photos(expectedLabel)` がactive placeを再検証し、allow-list済みphoto entry controlをちょうど1つだけ操作する。Maps photo viewerとexpected place headingを検証後、古いplace semantic stateを無効化する。image harvestingは行わない。Interactive Assist必須。 |
| photo category navigation | V4 high priority | viewer上で実際にbounded観測したcategoryだけをidentity/postcondition付きで移動する。bulk image harvestingは行わない。 |
| place の概要 / クチコミ / About tab | partial / observation-gated | `maps_select_place_tab(expectedLabel, tab)` はlive再観測できた `overview` / `about` enumのみ実装し、place-bound tab identityと `aria-selected` postconditionを検証する。2026-08-15のJA/EN再観測ではReviews tabがvisibleでなかったため、Reviews selector/schemaは公開しない。review body harvestingは引き続きout of scope。 |
| place → directions | V4 normal priority | `maps_directions` でworkflowは構造的にカバー済み。current-place convenience は identity を保てる場合のみ追加。 |
| place → 付近を検索 | implemented | `maps_search_nearby(expectedLabel, query)` がactive placeを再検証し、allow-list済みのNearby controlを1つだけ操作する。その後はNearby label付きinput、またはその操作で生成された一意のfocused/empty Maps comboboxだけを受理し、requested queryとMaps search-result pathの両方を検証できた場合だけ遷移を受理する。Interactive Assist必須。 |
| place share / Maps share URL | implemented | `maps_get_place_share_link(expectedLabel)` がvisible Shareを1回操作する直前にactive placeを再検証し、boundedなallow-list済みGoogle Maps share URLだけを返す。Interactive Assist必須。 |
| 営業時間展開 | implemented | `maps_expand_opening_hours(expectedLabel)` がactive placeとlive観測済みhours controlのexact-oneを再検証する。inline展開はobserved expanded stateを検証してplace semanticsを維持し、JAで観測したdetail-surface variantはsame-place URL identityとbounded hours markerを検証後に古いplace stateを無効化する。週間営業時間harvestingは公開しない。 |
| website / phone / address / Plus Code のcopy/open | lower priority / official overlap | panel action としては有用だが、data価値の多くは structured place interface と重なる。 |
| place保存 / saved list | login required | 実ブラウザで未ログイン Save が Google Account sign-in へ遷移。V5。 |
| recent/history のaccount同期 | login required | account-backed history はV5。ephemeral browser historyを public dataset にはしない。 |
| place を mobile に送信 | login required | account/device linked として扱う。credential は MCP で扱わない。 |
| directions を開く | implemented | `maps_directions` が documented Maps URL と bounded waypoint/avoid を使用。 |
| route candidate を bounded に読む | implemented | `maps_read_route_summary`。 |
| route candidate を選択 | implemented | `maps_select_route(index, expectedLabel)` が current route identity を検証。 |
| travel mode変更 | implemented | `maps_set_travel_mode` が driving/walking/bicycling/transit と既存制約を維持。 |
| おすすめ/automatic travel mode | V4 normal priority | UI固有mode chooser。heuristic guessなしでpostcondition検証可能な場合のみ追加。 |
| 出発地/目的地入れ替え | documented URL再構築で実装済み | `maps_swap_route_endpoints(expectedOrigin, expectedDestination)` がfresh simple canonical directions requestを再検証し、origin省略/waypointを拒否、mode/avoidを維持してdocumented Maps URL parameterを逆順に再構築する。Live UI swapはcanonical URL/actionがstaleに残るため自動化しない。 |
| waypoint追加/並び替え/削除 | V4 normal priority | bounded waypoints は URL path で既に利用可能。stateful UI editing は次段。 |
| driving avoid（ferries/highways/tolls） | implemented | bounded documented route option を実装済み。mode変更時も維持。 |
| 出発/到着時刻・transit preference | partial / 当日transit time実装済み | `maps_set_transit_time(expectedOrigin, expectedDestination, mode, time)` はfresh simple transit routeの `mode=depart_at|arrive_by` と当日24時間 `HH:MM` のみ実装。Mutation前にdocumented route identityを再検証し、exact localized time controlとvisible resolved endpoint値不変をpostcondition確認後、staleなreplayable navigation actionだけを破棄してroute read/selectを維持する。日付、終電、transit preference optionはobservation/design-gated。 |
| route detail / step expansion | V4 normal priority | bounded route-detail interaction。bulk itinerary extraction はしない。 |
| route link copy/share | observation-gated / clipboard boundary | JA/en-US再観測で未選択directions viewのexact Copy link buttonは確認したが、visible link value / reliable visible postconditionはなく、guarded route選択後はcontrolもvisibleでなかった。Clipboard read/interceptやcurrent URL=copy値という推測は行わない。bounded visibleなgenerated-link surfaceを観測できるまで保留。 |
| route view から目的地周辺shortcut | V4 normal priority | current destination をscopeにしたcategory search。 |
| route を mobile に送信 | login required | account/device-linked workflow はV5。 |
| coordinates/zoomで map表示 | implemented | `maps_show` が documented coordinate-centered Maps URL を開く。 |
| stateful zoom in/out | partial / verified search zoom implemented | `maps_zoom_search(expectedQuery, direction)` はactive search-resultの `in|out` のみ対応。Mutation直前にexact visible query + exact-one visible enabled Zoom buttonを再検証し、same search/query + public Maps pathのexact 1-level zoom changeをpostcondition確認する。Center完全一致は要求しない。root/place zoomは未実装。 |
| semantic map pan/recenter | observation/design-gated | verified search-zoom sliceには含めない。pointer座標やgeneric dragを公開せず、別途Maps-specific semantic target/postconditionを観測できた場合のみ再開する。 |
| 現在地 | observation-gated / permission boundary observed | fresh profileでexact visible location buttonをactivateするとChrome geolocation permissionへ到達した。Permissionは意図的にgrantせずsafeなsuccess postconditionは未確立。Promptを出すだけのaction、自動grant、permission後のautomatic replayは公開せず、manual authorized session + verified Maps-native success state、またはdedicated permission-handoff設計が成立するまで保留する。 |
| map layer / map type / traffic / transit / bicycling / terrain | observation-gated / option toggles verified | JA/en-USでTerrain/Traffic/Transit/Bikingのexact semantic `menuitemcheckbox` とTraffic `false -> true` を確認した。一方、visible Layers openerはrole/ARIA/AX identityのないoverlap nested `div` 2件で、安全にopenするにはDOM/geometry heuristicが必要。exact-one semantic/accessible openerまたは同等のbounded Maps-native surfaceを観測できるまでlayer actionは公開しない。 |
| coordinatesから Street View を開く | implemented | `maps_streetview` が documented Street View parameter を利用。 |
| active place/map から Street View へ入る | V4 high priority | place/viewport identity を再検証してから遷移。 |
| Street View rotate/zoom/navigation | V4 high priority | Maps-specific movement semantics のみ。raw pointer/CDP tool は公開しない。 |
| Street View imagery/date選択 | V4 normal priority | safely identifiable な範囲で bounded navigation。bulk historical imagery harvesting はしない。 |
| current map/view の共有URL | V4 high priority | generic browser URL/clipboard tool ではなく Maps-generated share state として扱う。 |
| sign-in / account切替 / credential入力 | login required | 自然発生したsign-inは Human Intervention へhandoff可能だが、MCPはcredentialを扱わない。 |
| Timeline / account list / synced saved place | login required | V5。 |
| contribution / rating / review / edit / public photo upload | login required | account-backed state-changing contribution はV4外。 |
| CAPTCHA / access challenge解決 | out of scope | Human handoffのみ。solver/bypass禁止。 |
| raw DOM / AX tree / raw CDP / generic browser action | out of scope | 内部実装detail。MCP toolとして公開しない。 |
| bulk scraping / crawling / review harvesting / dataset化 | out of scope | 引き続き禁止。 |
| internal Maps API / XHR interception / undocumented endpoint harvesting | out of scope | 引き続き禁止。 |
| generic desktop / shell automation | out of scope | Issue #36等のadapter作業でも general computer-use MCP には広げない。 |

## V4 implementation slices

V4 は大きな DOM automation 1本ではなく、小さくreview可能なまとまりで進めます。

### V4-A — inventory / semantic identity primitives

- この inventory を英日同期の正本として維持
- dynamic selection/actionには `expectedLabel` と同等の identity check を再利用/拡張
- Human handoff、unexpected navigation、resource epoch change があれば以前のsemantic stateを無効化

### V4-B — place workflow

優先順:

1. place share link — `maps_get_place_share_link(expectedLabel)` として実装済み
2. nearby search — verified active placeからの `maps_search_nearby(expectedLabel, query)` として実装済み
3. place photo opener — verified viewer transitionとstale place-state invalidation付きの `maps_open_place_photos(expectedLabel)` として実装済み
4. photo category navigation — remaining。viewer上でbounded観測したcontrolからのみ設計
5. place tab — `maps_select_place_tab(expectedLabel, tab)` で `overview|about` のみ実装。Reviewsはcurrent controlを再観測できていないためobservation-gated
6. opening hours — `maps_expand_opening_hours(expectedLabel)` として実装。inline/detail postconditionとstale-state invalidationを含む

### V4-C — search / map viewport

優先順:

1. result filter — Ratingは `maps_set_search_rating(expectedQuery, rating)` として実装。価格/時間/全フィルタはobservation/design-gated
2. search-this-area / update-after-move — JA/en-US manual pan後もexplicit one-shot controlを再観測できず。auto-update checkboxを代替せずobservation-gated
3. permission-safe current-location action — browser permission boundaryを観測済み。manual authorized success postconditionまたはdedicated permission-handoff modelが成立するまでobservation-gated
4. semantic layer toggle — option toggleはverifiedだがLayers openerがnon-semantic/ambiguous。exact-one semantic openerが成立するまでobservation-gated
5. bounded viewport movement — search-result one-level zoomを `maps_zoom_search(expectedQuery, direction)` として実装。root/place zoomとsemantic pan/recenterは別途observation/design-gated

### V4-D — directions UI

優先順:

1. departure/arrival time / transit option — 当日 `depart_at|arrive_by` は `maps_set_transit_time` として実装。日付/終電/preferencesはobservation/design-gated
2. route link share — exact Copy link controlは観測したが、clipboardなしでgenerated link/postconditionを検証できないためobservation-gated
3. origin/destination swap・stop edit — endpoint swapは `maps_swap_route_endpoints` として実装。stateful stop editはobservation/design-gated（bounded waypointは既存 `maps_directions` で対応済み）
4. bounded route detail expansion
5. destination-nearby shortcut

### V4-E — Street View

- active place/map からenter
- semantic turn/zoom/navigation
- safely identifiable な bounded imagery/date choice

### V4-F — coverage closeout

- user-directed compatibility確認に必要な範囲だけ low-frequency / bounded live E2E を再実行
- 残る V4 high/normal priority gap を閉じる
- login-required はV5へ送る
- official overlap は browser workflow 完結に必要な場合を除いて lower priority のまま維持
- 最終 implemented/remaining coverage をこの文書へ反映

## 新規V4 operationの必須invariant

- dedicated Chrome/Chromium + loopback CDPのみ
- serialized semantic browser stateを1つに限定
- mutation前に stale-state / expected-identity validation
- missing / duplicate / reordered / ambiguous target は fail closed
- visible read と action count は bounded
- secret / credential / clipboard dump / unrelated page text をoutput/logへ出さない
- consent / sign-in / CAPTCHA / challenge は Human Intervention で停止
- Human Intervention完了を別actionのapprovalとみなさない
- restart/reconnect後に以前のstate-changing semantic operationを自動replayしない
- CAPTCHA / anti-bot bypass禁止
- scraping / bulk harvesting / internal Maps API/XHR harvesting / raw browser・DOM・CDP MCP tool禁止

## Issue #36との境界

Issue #36（second real Execution Handoff adapter proof）は別トラックです。V4 Maps coverage のために `maps-browser-mcp` を generic browser / desktop / shell MCP へ広げません。