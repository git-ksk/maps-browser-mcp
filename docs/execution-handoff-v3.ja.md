# Execution Handoff V3（日本語）

> ここでいうV3は **Execution Handoff subsystemのversion** です。repository内で既に使っているMaps V1〜V3のfeature labelとは別軸です。

Execution Handoff V3では、Human interventionをMaps専用Takeover機能から、再利用可能なcontrol-plane runtimeへ一段抽象化します。Mapsは最初のreal adapterとして維持します。

## 現在のlayer

| Layer | Status | 目的 |
| --- | --- | --- |
| Handoff V1 | 実装済み | MCP MRTR `input_required`、Agent/Human排他authority、resource epoch、安全なresume |
| Handoff V2 | 実装済み | private CDP + short-lived capabilityによるbounded remote/mobile browser takeover |
| Handoff V2.1 | 実装済み | authenticated MCP principalをMRTR state / takeover session / capabilityへbind |
| Handoff V2.2 | 手動検証待ち | authenticated HTTPS gateway経由のphone E2E |
| **Handoff V3** | 実装済み・durabilityはopt-in | generic adapter contract、live Maps durable control-plane checkpoint、exact-action approval分離、bounded audit metadata |

## V3 architecture

```text
MCP / Agent
    |
    v
Execution Handoff V3
    |-- principal binding
    |-- authority / resource epoch
    |-- durable control-plane checkpoint
    |-- exact-action approval envelope
    |-- secret-safe audit metadata
    |
    +---- adapter: browser.maps   (real + live checkpoint integration)
    +---- adapter: desktop.mock   (deterministic contract test)
    +---- adapter: terminal.mock  (deterministic contract test)
```

CoreはCDPや他adapter固有protocolを公開しません。将来Desktop / Terminal / Cloud Console / Device adapterを追加する場合も、native execution channelはadapterの内側に閉じたまま同じcontrol-plane contractを実装します。

## 排他的Remote Client Lease

Authenticated identityとremote-control concurrencyは別の境界として扱います。同じauthenticated principalがHuman interventionを所有していても、1つのintervention / resource epochで操作できる**active remote takeover clientは1つだけ**です。

Authenticated Takeover pageはWeb Cryptoでrandom client bindingを生成し、`sessionStorage`へ保持します。最初のsame-origin bootstrapがremote-client leaseをatomicにclaimします。同じpage contextの通常reloadでは同じbindingを再利用できますが、別device/tabが別bindingで同じactive takeover sessionをclaimすることは、同じauthenticated principalでもできません。

Short-lived takeover capabilityはsession locator、intervention id、resource epoch、principal binding、client binding、expiryへHMAC bindします。Frame/input/done requestにはcapabilityとmatching client bindingの両方が必要です。Resource epochが変わると新しいtakeover sessionになり、client leaseも新しくなります。

V3では裏側で勝手にclientをtransferする操作は提供しません。別deviceへ移す場合は現在のremote controlを終了/cancelし、fresh Human roundを使います。Client bindingはconcurrency leaseであってuser authenticationではなく、primary identity boundaryはauthenticated principalのままです。

## Durable recoveryは意図的に保守的

V3はsigned checkpointを永続化できますが、checkpointは**browser sessionやAgent sessionのserializeではありません**。保存対象はboundedなcontrol-plane metadataだけです。

- adapter kind
- intervention id
- intervention status
- resource epoch
- resume policy
- principal binding
- optional action digest
- timestamp / expiry

raw検索語、出発地/目的地、browser text、DOM/network data、credential、cookie、CAPTCHA/2FA response、approval receipt、raw action argumentsは保存しません。

Live Maps handoffではHuman intervention中だけcheckpointを書き込みます。verified resume、cancel、stale intervention、recover不能なverification failureでは削除します。一方、graceful process shutdownではactive checkpointを意図的に消さず、restart後にrecovery metadataが残るようにします。

Recovery結果は必ず次になります。

```text
recovery = reissue_and_revalidate
```

古いAgent/Human authorityを復元せず、中断actionを自動replayしません。Restart後、同じauthenticated principalが元のMaps tool callを再発行し、そのfresh validated argumentsから作るaction digestが一致した場合だけcheckpointをconsumeします。その後のMaps actionは**現在のvalidated inputから最初から**実行します。古いMRTR requestState、DOM/semantic state、remote capability、browser authorityはdiskから復元しません。

Checkpointのintegrity検証に失敗した場合や期限切れの場合は破棄し、authorizationには使いません。その後のfresh user-directed tool invocationは通常どおり実行できます。

### Opt-in設定

Durable recoveryはデフォルトOFFです。次の2値を必ずセットで設定します。

```text
MAPS_HANDOFF_CHECKPOINT_FILE=/absolute/private/path/handoff-checkpoint.json
MAPS_HANDOFF_CHECKPOINT_KEY=<32 random bytes encoded as canonical base64url>
MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS=900
```

File pathはabsolute必須です。Signing keyはprocess restartを跨いで同一値を安全に保持し、commit/logへ出してはいけません。Checkpoint storeはfileをprivate permissionで書き込みます。

したがってV3が提供するのは**safe durable recovery metadata**であり、process restart後のtransparent continuationではありません。現在のlive MRTR request-state signing keyとbrowser intervention自体はprocess-localです。

## ApprovalとTakeoverを完全に分離

Human Takeoverは「Humanが一時的にexecution inputを所有する」ことだけを意味します。その後のside effectを承認したことにはなりません。

将来不可逆actionを持つadapter向けに、V3はexplicit approval envelopeを提供します。Approvalは次へbindされます。

- canonicalな最終action name + arguments
- current resource epoch
- authenticated principal binding
- expiry
- single use

Action arguments、principal、resource epochのいずれかが変わればapprovalは無効です。Approval receiptはHMACで保護し、1回だけconsumeできます。

つまり:

```text
CAPTCHA完了 != 購入承認
sign-in完了 != 削除承認
MFA完了 != メッセージ送信承認
```

現在のMaps navigation actionはside-effect-freeなので、現時点ではapproval managerを使用しません。

## Adapter切り出し基準

`browser.maps` が最初のreal adapterです。TypeScript contractがMaps固有でないことを確認するためnon-browser mock adapterもdeterministic testで動かしますが、mockだけでは2つ目のproduction adapterが成熟した証明にはしません。

別OSSへの切り出しはまだ行いません。DesktopやTerminal等の2つ目のreal adapterで次が再利用できることを確認してから検討します。

- adapter contract
- authority / epoch model
- principal binding
- checkpoint recovery semantics
- completion verification
- approval envelope
- audit/control-plane metadata
- MCP MRTR bridge

## V2.2 phone E2E

残るlive verificationには、実際のauthenticated HTTPS gateway、専用Chrome session、phoneが必要です。通常CIだけでは証明できません。

手動検証ではuser-directed workflowだけを使い、次を確認します。

1. MCP action開始者とTakeover page利用者が同じauthenticated principalである
2. 別principal / unauthenticated requestではpage/bootstrapへ入れない
3. Human authority中だけphoneからbounded frame確認と許可inputができる
4. 同じprincipalでも2つ目のremote clientは同じintervention epochをclaim/inputできない
5. `Done` はremote inputをrevokeするだけで、MCP actionをapproveしない
6. Continue後にbrowserをverifyし、安全にresumeするか、新しいHuman roundへ戻る
7. stale epoch / capability / request stateを拒否する
8. opt-in checkpointがcontrolled process restartを跨いでも残るが、同じprincipal + 同じ再発行tool-argument digestだけがrecovery markerをconsumeできる
9. account、private location、token、browser profile、checkpoint key、credential等を含むscreenshot/logをpublic issueへ添付しない

この検証のためにCAPTCHAを意図的に発生させたり、回避したりしません。

## Non-goals

V3でも以下は実装しません。

- CAPTCHA solver / anti-bot bypass
- stealth / fingerprint spoofing / proxy rotation
- public CDP
- Takeover UIからのarbitrary browser navigation
- DOM / network / cookie export
- irreversible actionのautomatic approval
- multi-tenant hosting
- process restart後のtransparent replay
