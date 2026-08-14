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

2026-08-15にJA/ENのplace panelとstandard/wide viewportでbounded再観測した結果、place-boundな概要/OverviewとAbout tabは確認できましたが、visibleなReviews tabは再現しませんでした。以下のtab実装は、その再観測済みshapeだけに意図的に限定しています。

## Coverage table

| Capability | V4 status | 現在のcoverage / 目標semantic behavior |
|---|---|---|
| user-directed search を開く | implemented | `maps_search` が documented Maps search URL を開く。 |
| search/place results を bounded に読む | implemented | `maps_read_place_summary` が bounded visible label/text と保守的annotationを返す。 |
| visible search result を選択 | implemented | `maps_select_result(index, expectedLabel)` が identity を再検証し、並び替え時は fail closed。 |
| search autocomplete / suggestion 選択 | V4 high priority | suggestion を bounded に read/select する Maps-specific semantics を追加。raw combobox/DOM は公開しない。 |
| search result filter（価格/評価/時間/全フィルタ） | V4 high priority | allow-list された bounded filter surface と postcondition validation で実装。 |
| このエリアを検索 / 地図移動後に更新 | V4 high priority | query identity を維持し、visible area に対する明示的 search action として実装。 |
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
| 営業時間展開 | V4 normal priority | bounded visible-place interaction。persistent place dataset は作らない。 |
| website / phone / address / Plus Code のcopy/open | lower priority / official overlap | panel action としては有用だが、data価値の多くは structured place interface と重なる。 |
| place保存 / saved list | login required | 実ブラウザで未ログイン Save が Google Account sign-in へ遷移。V5。 |
| recent/history のaccount同期 | login required | account-backed history はV5。ephemeral browser historyを public dataset にはしない。 |
| place を mobile に送信 | login required | account/device linked として扱う。credential は MCP で扱わない。 |
| directions を開く | implemented | `maps_directions` が documented Maps URL と bounded waypoint/avoid を使用。 |
| route candidate を bounded に読む | implemented | `maps_read_route_summary`。 |
| route candidate を選択 | implemented | `maps_select_route(index, expectedLabel)` が current route identity を検証。 |
| travel mode変更 | implemented | `maps_set_travel_mode` が driving/walking/bicycling/transit と既存制約を維持。 |
| おすすめ/automatic travel mode | V4 normal priority | UI固有mode chooser。heuristic guessなしでpostcondition検証可能な場合のみ追加。 |
| 出発地/目的地入れ替え | V4 normal priority | stateful route edit。old candidate state は無効化する。 |
| waypoint追加/並び替え/削除 | V4 normal priority | bounded waypoints は URL path で既に利用可能。stateful UI editing は次段。 |
| driving avoid（ferries/highways/tolls） | implemented | bounded documented route option を実装済み。mode変更時も維持。 |
| 出発/到着時刻・transit preference | V4 high priority | documented Maps URL parameter では表現できない重要UI操作。visible semantic control 経由で実装し、推測したweb parameterは使わない。 |
| route detail / step expansion | V4 normal priority | bounded route-detail interaction。bulk itinerary extraction はしない。 |
| route link copy/share | V4 high priority | verified active route の Maps-generated link を返す。raw clipboard access は使わない。 |
| route view から目的地周辺shortcut | V4 normal priority | current destination をscopeにしたcategory search。 |
| route を mobile に送信 | login required | account/device-linked workflow はV5。 |
| coordinates/zoomで map表示 | implemented | `maps_show` が documented coordinate-centered Maps URL を開く。 |
| stateful zoom in/out | V4 normal priority | `maps_show` を超える価値がある範囲で追加。結果viewportを検証。 |
| semantic map pan/recenter | V4 normal priority | Maps-specific viewport operation のみ。pointer座標やgeneric dragは公開しない。 |
| 現在地 | V4 high priority | browser-native。permission/consent が必要なら Human Intervention で停止し bypass しない。 |
| map layer / map type / traffic / transit / bicycling / terrain | V4 high priority | browser-native価値が高い。allow-list semantic layer model と verified toggle で実装。 |
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
6. opening hours — remaining。bounded live observationでexact target/postconditionが成立した場合だけ実装

### V4-C — search / map viewport

優先順:

1. result filter
2. search-this-area / update-after-move
3. permission-safe current-location action
4. semantic layer toggle
5. `maps_show` 以上の価値がある bounded viewport movement

### V4-D — directions UI

優先順:

1. departure/arrival time / transit option
2. route link share
3. origin/destination swap・stop edit
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