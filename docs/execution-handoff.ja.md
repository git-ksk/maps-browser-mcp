# Execution Handoff（日本語）

この文書は、CAPTCHAを自動突破せずにbrowserの実行権をAgentからHumanへ渡し、安全にAgentへ戻す仕組みを説明します。

## Status

現在は **V1 local human handoff** です。Google Maps操作中にCAPTCHA / access challenge、sign-in、consent、その他のmanual surfaceが出た場合、ServerはMCP `input_required` を返し、専用Chrome上でHumanに操作してもらえます。

MCP側ではpassword、2FA code、CAPTCHA answer、cookie等を入力させません。HumanがContinueを選んだ後、Serverがbrowser状態を検証してからAgentへ実行権を戻します。

V1ではRemote takeover URL、Live View UI、credential form、public CDP endpointは公開しません。スマホ等からのauthenticated remote takeoverは次のlayerとして分離します。

現在の基盤は以下です。

- 排他的なexecution authority
- browser runtime内のintervention metadata
- stale semantic stateを失効させるresource epoch
- canonical actionごとのResume Policy
- originating tool invocationへbindしたHMAC保護済みMCP `requestState`

## State Machine

```text
Agent owns browser
      |
      | challenge / sign-in / consent
      v
awaiting_human   authority=none
      |
      | MCP input_required + Human claim
      v
human_active     authority=human
      |
      | HumanがContinue
      v
verifying        authority=none, epoch++
      |
      | ServerがMaps surface + challenge消失を検証
      v
ready_to_resume  authority=none
      |
      | Resume Policy評価
      v
Agent owns browser again
```

`agent + human` が同時にauthorityを持つ状態は作りません。Interventionがactiveな間は通常のAgent CDP accessをbrowserへ触る前に拒否します。

## MCP Multi-Round-Trip Binding

HandoffはMCP 2026-07-28のmulti-round-trip `input_required` を使います。ClientはHuman responseとServerから返されたopaque `requestState` を付け、元のtool callをretryします。

`requestState` はprocessごとに生成する256-bit random keyでHMAC-SHA256保護し、有効期限は10分です。Signed payloadには検索語、credential、page dataを入れず、次だけをbindします。

- originating tool name
- canonical化したvalidated tool argumentsのSHA-256 digest
- intervention id
- resource epoch
- resume strategy

さらにactive interventionごとにownerを1つだけ保持します。別toolや並行callが、他のtool invocationから発生したhandoffを引き継ぐことはできません。

現在はsingle-process runtimeなのでkeyもprocess-localです。Process restart時はbrowser intervention state自体も失われるため、古い`requestState`は使わずMaps actionをやり直します。

## Canonical ActionとResource Epoch

既知のMaps navigation action中にchallengeが発生した場合、runtimeはsemantic stateを消す前にcanonical `MapsAction` を保存します。現在のMaps navigation actionはside effectを持たないため `replay_safe` です。

信頼できるcanonical actionが存在しない場合は `never_replay` にします。

Resource epochはintervention開始時、Human control完了後、navigationやsemantic page transition時に進みます。DOM ref、candidate index、snapshot、将来のaction approval等は生成時epochへbindし、epoch変更後はstaleとして拒否する前提です。

Humanが完了しただけではresumeしません。許可されたGoogle Maps surfaceへ戻っていることと、既知のinline challenge indicatorが消えていることをServerで検証します。

## Tool Resume Strategy

中断されたMCP toolとcanonical browser actionは別概念なので、V1ではtool側に2種類のresume strategyを持たせます。

| Strategy | 対象 | Human intervention検証後 |
| --- | --- | --- |
| `retry_original` | `maps_search`, `maps_directions`, `maps_show`, `maps_streetview` | 同じvalidated・side-effect-free navigation toolを再実行 |
| `require_fresh_semantic_action` | result/route選択、travel-mode変更、bounded read | stale stateを継続せず、fresh search/directionsを要求 |

これにより、CAPTCHAを解いたことを理由に古いdynamic result indexをそのままclickする事故を防ぎます。

## Generic Resume Policies

Generic handoff coreは以下を定義します。

| Policy | 意味 |
| --- | --- |
| `replay_safe` | Verification後、canonical actionを再構築してreplay可能 |
| `revalidate` | 現在stateを再取得して再判断してから実行 |
| `confirm_before_execute` | 最終action argumentsへbindしたfresh user approvalを要求 |
| `never_replay` | 中断actionを自動再実行しない |

HumanがCAPTCHAを解いたことやsign-inしたことは、その後の不可逆actionへのapprovalではありません。購入、削除、送信、予約、Cloud管理等へ再利用する場合、takeover completionとaction approvalは必ず分離します。

## Security Boundary

将来のtakeover transportでも以下を維持します。

- CDPはloopback-onlyで、Human client/public networkへ公開しない
- HumanとAgentのcontrolは相互排他
- Human所有中にAgentへDOM、Network、Screenshot、credential、2FA、CAPTCHA responseを返さない
- Takeover endpointではworkflow開始者と同じuser/principalを再認証する。転送可能なBearer URLだけに依存しない
- Capabilityは短時間・1 intervention / 1 browser resource限定・revoke可能にする
- localhost/private network/link-local metadata/`file:`等へのSSRF pivotを作らない
- CAPTCHA solver、anti-bot evasion、stealth/fingerprint spoofing、proxy rotationへ変質させない

## Remote Takeover Direction

MRTRによってlocal handoffのprotocol pause/resume layerはできました。Remote/mobile takeoverはこのstate machineの上へ載せます。

次のlayerではidentity binding、short-lived scoped capability、CDPを公開しないLive View/Input Broker、network egress restriction、secret-safe observation、明示的revokeが必要です。Protected takeover endpointが完成する前にURL-mode elicitationを追加せず、pre-authenticated transferable URLを近道として使いません。

## CI Boundary

通常CIはHuman takeoverを待たず、CAPTCHAやsign-in challengeを意図的に発生させません。Authority state machine、request-state binding helper、fail-closed境界はdeterministic testで確認します。Manual Live Maps E2Eで自然発生したchallengeもCIが突破する対象にはしません。

## 別OSSへの切り出し条件

まず `maps-browser-mcp` で実証し、少なくとももう1つのadapterで以下が本当にgenericだと確認できてから別OSS化を検討します。

- authority lease / state machine
- intervention identity binding
- resource epoch
- completion verification
- resume policy
- action-approval binding
- audit event
- MCP MRTR bridge

将来の抽象化対象はBrowser専用CAPTCHA/takeover libraryではなく、**execution handoff runtime** です。
