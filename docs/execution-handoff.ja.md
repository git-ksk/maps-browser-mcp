# Execution Handoff（日本語）

この文書は、CAPTCHAを自動突破せずに、browserの実行権をAgentからHumanへ渡し、安全にAgentへ戻すための内部基盤を説明します。

## Status

現在の実装は **V0 infrastructureのみ** です。Remote takeover URL、Live View UI、credential form、新しいMCP toolはまだ公開しません。既存のchallenge境界はfail-closedのままで、CAPTCHA、sign-in、consent、想定外のnon-Maps surfaceでは通常のAgent操作を停止します。

V0では将来のHuman-in-the-loop flow向けに、次の4つを先に導入します。

- 排他的なexecution authority
- browser runtime内のintervention metadata
- stale semantic stateを失効させるresource epoch
- canonical actionごとの明示Resume Policy

## State Machine

```text
Agent owns browser
      |
      | challenge / sign-in / consent
      v
awaiting_human   authority=none
      |
      | Humanが明示的にclaim
      v
human_active     authority=human
      |
      | Humanが完了を通知
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

`agent + human` が同時にbrowser authorityを持つ状態は作りません。Interventionがactiveな間、通常のAgent CDP accessはbrowserへ触る前に拒否します。

## Canonical ActionとResource Epoch

既知のMaps action中にchallengeが発生した場合、runtimeはsemantic browser stateを消す前にcanonical `MapsAction` を保存します。現在のMaps navigation actionはside effectを持たないため、Resume Policyは `replay_safe` です。

信頼できるcanonical actionが存在しない場合は `never_replay` にします。

Resource epochはintervention開始時とHuman control完了後に進みます。Navigationやsemantic page transitionでも進みます。将来のadapterではDOM ref、candidate index、snapshot、action approvalなど再利用可能な値を生成時epochへbindし、epoch変更後はstaleとして拒否する必要があります。

Humanが「完了」としただけではAgentへ戻しません。Serverがbrowserが許可されたGoogle Maps surfaceへ戻っていることと、既知のinline challenge indicatorが消えていることを検証してからresume可能にします。

## Resume Policies

Generic handoff coreは4種類のpolicyを定義します。

| Policy | 意味 |
| --- | --- |
| `replay_safe` | Verification後、canonical actionを再構築してreplay可能。 |
| `revalidate` | 現在stateを再取得し、再判断してから実行。 |
| `confirm_before_execute` | 最終action argumentsへbindしたfresh user approvalを要求。 |
| `never_replay` | 中断されたactionを自動再実行しない。 |

現在Maps adapterが選ぶのは `replay_safe` と `never_replay` だけです。残りは将来coreを切り出す際、read-only以外のadapterでも安全に扱えるよう先に型として定義しています。

HumanがCAPTCHAを解いたことやsign-inを完了したことは、その後の不可逆actionへのapprovalではありません。購入、削除、送信、予約、Cloud管理などへ再利用する場合、takeover completionとaction approvalは必ず別eventとして扱います。

## Security Boundary

将来のtakeover transportは次を維持する必要があります。

- CDPはloopback-onlyを維持し、Human clientやpublic networkへ公開しない。
- HumanとAgentのcontrolは相互排他。
- Human所有中、AgentへDOM、Network、Screenshot、credential、2FA、CAPTCHA responseを返さない。
- Takeover endpointはworkflowを開始した同じuser/principalを再認証する。転送可能なBearer URLだけでは不十分。
- Takeover capabilityは短時間、1 intervention / 1 browser resourceへ限定し、revoke可能かつsecretを残さないauditを行う。
- Takeover中のnavigationでlocalhost、private network、link-local metadata service、`file:` URL等へのSSRF pivotを作らない。
- Human takeoverをCAPTCHA solver、anti-bot evasion、stealth/fingerprint spoofing、proxy rotationへ変質させない。

## MCP Integration Direction

Coreは現時点で特定のMCP interaction modelへ固定しません。将来adapterでは短時間のinterventionをcurrent MCP multi-round-trip input flowへmappingし、長時間・再接続可能なinterventionはclient/server対応状況に応じてTasks extensionへmappingできます。

Browser/runtime stateをsource of truthとし、MCP session IDだけをsecurity principalやexecution-authority leaseとして扱いません。

## CI Boundary

通常CIはHuman takeoverを待たず、CAPTCHAやsign-in challengeを意図的に発生させません。Authority/state machineとfail-closed境界はdeterministic testで確認します。Manual Live Maps E2Eは固定・低ボリュームの互換性確認のままとし、自然発生したchallengeはCIで突破する対象ではなくinconclusiveとして扱います。

## 別OSSへの切り出し条件

このcodeは、まず `maps-browser-mcp` 内でMaps adapterに対して有効性を実証します。次の要素が本当にgenericだと、少なくとももう1つのadapterで確認できてから別OSS化を検討します。

- authority lease / state machine
- intervention identity binding
- resource epoch
- completion verification
- resume policy
- action-approval binding
- audit event
- MCP MRTR / Tasks bridge

将来の抽象化対象はBrowser専用CAPTCHA/takeover libraryではなく、**execution handoff runtime** です。
