# maps-browser-mcp

[English](README.md) | [日本語](README.ja.md)

Google Maps を専用ブラウザセッション経由で操作する、軽量な MCP サーバーです。

> **ステータス:** 計画 / 初期開発段階

## 目的

汎用的なブラウザ自動化インターフェースを公開せず、MCP クライアントから Google Maps に対して必要最小限の操作を実行できるようにすることを目的としています。

ユーザーが明示的に依頼した操作を、その場でインタラクティブに実行する設計です。地図を開く、場所を検索する、経路を表示する、表示中の候補を選択する、必要に応じて現在表示されている状態を最小限だけ読み取る、といった用途を想定しています。

## 設計原則

- 検索、経路、地図表示、Street View では Google Maps の公式 URL を優先して利用します。
- Google Maps 専用の Chromium プロファイルと永続セッションを使用します。
- `click`、`type`、任意 JavaScript 実行のような汎用操作ではなく、意味の明確な MCP ツールを公開します。
- ブラウザ自動操作の対象を Google Maps に限定します。
- DOM / Accessibility Tree の読み取りを最小限にし、ページ全体の抽出は行いません。
- Google Maps の非公開内部 API は使用しません。
- CAPTCHA、Bot 検知、その他のアクセス制御を回避しません。
- 大量収集、バックグラウンド巡回、Google Maps データセットの永続構築は行いません。

## 予定しているツール

### ナビゲーション

- `maps_search`
- `maps_directions`
- `maps_show`
- `maps_streetview`

### 操作

- `maps_select_result`
- `maps_select_route`
- `maps_set_travel_mode`

### オプションの表示状態読み取り

- `maps_read_place_summary`
- `maps_read_route_summary`

表示状態の読み取りは、ユーザーから明示的に依頼された場合に限定し、オプションかつ実験的な機能として扱います。

## 想定アーキテクチャ

```text
MCP Client
    |
    v
maps-browser-mcp
    |
    +-- Maps URL Compiler
    +-- Policy Engine
    +-- Browser Session Manager
    +-- Semantic UI Controller
    +-- Optional Visible-State Reader
    |
    v
Dedicated Chromium / CDP
    |
    v
Google Maps
```

## 対象外

このプロジェクトは、以下を目的としていません。

- Google Maps Platform API の代替
- 汎用ブラウザ MCP
- Google Maps スクレイパー
- 店舗、口コミ、経路などの大量収集ツール
- CAPTCHA や Bot 対策の回避ツール

## ロードマップ

1. MCP サーバーの基本構成（TypeScript）
2. Google Maps 公式 URL コンパイラ
3. 専用 Chromium + CDP Runtime
4. Google Maps 向けセマンティック UI 操作
5. Policy / Domain / Rate Guard
6. オプションの Visible-State Reader
7. パフォーマンスベンチマーク
8. ChatGPT Developer Mode での E2E 検証
9. OSS 公開向けの強化とドキュメント整備

## 免責事項

本プロジェクトは独立したオープンソースプロジェクトであり、Google とは提携しておらず、Google による承認・推奨を受けたものではありません。本ソフトウェアを利用する際は、適用される Google Maps および Google の利用規約を利用者自身で遵守してください。

## ライセンス

MIT
