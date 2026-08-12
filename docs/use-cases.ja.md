# 利用モードとユースケース

[English](use-cases.md) | [日本語ドキュメント](README.ja.md)

`maps-browser-mcp` には、意図的に分けた2つの利用モードがあります。

- **Navigation-only** — MCPはGoogle Maps Webを開く・切り替えるところまで担当し、表示結果は人間が確認する
- **Interactive Assist** — ユーザーの現在の依頼に必要な範囲で、表示中Maps UIの小さなbounded summaryもMCPが読み取れる

この違いは `INTERACTIVE_ASSIST_MODE` で制御し、デフォルトは `false` です。

この設定は明示的なproduct / safety boundaryです。`false` を「Googleの利用規約上必須」と説明したり、`true` を「Google Maps contentを自由に自動取得してよい許可」と説明したりしないでください。設計上の制約は [Compliance / Safety](compliance.ja.md) を参照してください。

## どちらを選ぶか

| Deployment / workflow | `INTERACTIVE_ASSIST_MODE=false` | `INTERACTIVE_ASSIST_MODE=true` |
| --- | --- | --- |
| Local MCP + 画面が見えるChrome | MCPが遷移し、ユーザー自身がMaps画面を読む用途に向く | Client側でもbounded summaryや候補labelが必要な場合に向く |
| Remote / headless deployment | Navigationは動くが、通常callerからMaps画面が見えないため用途は限定的 | 表示中のroute / place状態をclientが回答へ使う場合に向く |
| URLベースの検索・経路・地図表示・Street View | 利用可能 | 利用可能 |
| Route / placeのlabelや小さなvisible summaryの読み取り | 利用不可 | V3 read toolで利用可能 |
| Bulk collection / crawling / dataset harvesting | 非対応 | 非対応 |

## Navigation-only mode

Navigation-onlyはデフォルトです。

```bash
INTERACTIVE_ASSIST_MODE=false npm start
```

HTTPの場合:

```bash
INTERACTIVE_ASSIST_MODE=false npm run start:http
```

このモードは、MCPをMaps content readerではなく**Maps navigator**として使う場合に向いています。

### 例: Localで経路を開く

ユーザーの依頼:

```text
東京駅から品川駅まで公共交通機関の経路を開いて。
```

代表的なflow:

```text
maps_directions({
  origin: "東京駅",
  destination: "品川駅",
  mode: "transit"
})
```

専用Chrome sessionにGoogle公式Maps経路URLが開きます。Local環境でChrome画面が見えていれば、ユーザー自身が表示された経路候補を確認できます。

この状態では `maps_read_route_summary` を呼べないため、MCP clientへrender済み画面から所要時間、運賃、路線名、候補labelなどを返すことはできません。

### Reading OFFでもできること

以下はInteractive Assistを必要としません。

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`
- `maps_set_travel_mode`

`maps_select_result` / `maps_select_route` もtool自体は公開されたままですが、V3 summaryなしではcallerが現在の信頼できる `index + expectedLabel` を通常取得できません。Client自身が動的な候補から選ぶ必要がある場合は、readしてからselectするflowを推奨します。

## Interactive Assist mode

Visible-state readingを明示的に有効化します。

```bash
INTERACTIVE_ASSIST_MODE=true npm start
```

HTTPの場合:

```bash
INTERACTIVE_ASSIST_MODE=true npm run start:http
```

これにより次のtoolが利用可能になります。

- `maps_read_place_summary`
- `maps_read_route_summary`

### 例: 表示中の経路から回答する

ユーザーの依頼:

```text
東京駅から品川駅まで電車で何分？
```

代表的なflow:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> boundedな表示結果をユーザー向けに要約
```

表示中の候補を選択する場合:

```text
maps_directions(...)
  -> maps_read_route_summary()
  -> items[{ index, label }] から選ぶ
  -> maps_select_route({ index, expectedLabel: label })
```

`expectedLabel` は重要です。Google Mapsが候補順を動的に変更した場合、runtimeは推測clickせず `UI_STATE_CHANGED` を返します。

## なぜReadingをOpt-inにしているか

Opt-in境界には次の目的があります。

- browser-visible contentの読み取りをdeployment時の明示的な判断にする
- Navigation-only構成を単純に保つ
- user-directed navigationからcontent extractionへ意図せずscopeが広がるのを防ぐ
- read専用budgetと返却サイズ上限を独立して適用する
- Remote / headless環境でrender済みMaps UIを消費しているかを構成上明確にする

これは、**Googleがこの環境変数を `false` にすることを要求している、という意味ではありません**。逆に `true` にしても、scraping、crawling、bulk extraction、永続保存、dataset構築がこのprojectの許容use caseになるわけではありません。

有効時もReaderは `MAPS_MAX_AX_NODES`、`MAPS_MAX_READ_CHARS`、`MAPS_MAX_VISIBLE_READS_PER_HOUR` などでboundedです。raw HTML、DOM全体、Accessibility Tree全体、cookie、network payload、レビュー本文は公開しません。

## Deployment別の考え方

### Local + visible browser

Navigation-onlyだけでも有用です。専用Chrome windowをユーザーが直接見られるため、`maps_search` や `maps_directions` の後に人間が結果を確認できます。

### Remote / Cloud Run / headless

Remote clientから専用browser UIは通常直接見えません。そのためNavigation-onlyでもMaps surfaceを操作する用途には使えますが、renderされたroute / place contentをMCP responseへ変換することはできません。

Remote clientが現在表示中のMaps結果について回答する必要がある場合、Interactive Assistがそのためのboundedな仕組みです。Remote公開には認証、browser profile、deploymentの別の制約もあるため、[ChatGPT 接続ガイド](chatgpt.ja.md)、[Container / headless Linux](container.ja.md)、[Compliance / Safety](compliance.ja.md) も参照してください。

## 両モード共通の非ゴール

どちらのモードでも、このprojectを汎用browser automationやMaps extraction serviceとして扱うことは意図していません。特に次は非対応です。

- bulk scraping / crawling
- place / route / review dataset harvesting
- background collection
- full DOM / full Accessibility Tree extraction
- review body harvesting
- Maps内部network trafficのinterception
- CAPTCHA solving / bot-detection bypass

Applicationのworkflowがsupported Google Maps Platform APIやGoogle-managed Maps MCPで満たせる場合は、その公式structured interfaceを優先してください。
