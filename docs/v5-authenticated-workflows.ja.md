# V5 Authenticated Workflows — Design Baseline

V5は、userがsign-inした後にだけ存在するGoogle Maps Web stateを意図的に扱う最初のmilestoneです。この文書は **design baselineのみ** であり、implementation開始、authenticated toolの有効化、browser-control surface拡張を許可するものではありません。

V5でもagentが操作できるのはboundedなMaps-specific semantic operationだけです。Authentication、account selection、consent、MFA/OTP、CAPTCHA、その他sensitiveなaccount stepはHuman authorityのまま維持します。

## Scope Definition

V5の定義:

> **Bounded authenticated Google Maps Web workflows。最初はread-orientedかつlow-consequenceなreversible account stateを優先する。**

最初のimplementationでsigned-in Maps featureを広く網羅しません。Account-backed stateを、general account/browser automation surfaceへ広げず安全に扱えることを証明するのが目的です。

## Current Product Evidence

現行Google desktop Maps公式情報から、V5に関係する事実は次のように整理できます。

- signed-in userはplaceを保存し、saved listを利用できる
- saved place/listはaccount-backedで、sign-inしたdevice間で利用できる
- Maps historyはsigned-in desktop experienceから確認/管理できるが、通常のplace stateではなくaccount activityである
- desktop directionsはaccount/device条件とcurrent UI availabilityを満たせばsign-in済みphone/tabletへ送れる
- Google Maps Timelineは **computer版Mapsでは利用不可**。現行Timeline dataはdevice-basedでありMaps Web workflowとして扱わない

References:

- https://support.google.com/maps/answer/3184808?co=GENIE.Platform%3DDesktop&hl=ja
- https://support.google.com/maps/answer/7280933?co=GENIE.Platform%3DDesktop&hl=ja
- https://support.google.com/maps/answer/3137804?hl=ja
- https://support.google.com/maps/answer/7101463?co=GENIE.Platform%3DDesktop&hl=ja
- https://support.google.com/maps/answer/6258979?co=GENIE.Platform%3DDesktop&hl=ja

これらはproduct scopeの根拠です。UI-dependent semantic targetはimplementation前に必ずfresh live observationを行います。

## Authentication Boundary

### Sign-inはHuman、MCPはcredentialを扱わない

MCP surfaceで次を受け取ったり返したりしません。

- Google password
- MFA/OTP
- passkey / security-key material
- CAPTCHA/challenge answer
- Google cookie / session token
- OAuth token
- recovery code
- credential substituteとして使えるcopied account-page content

Authenticated workflowがsign-in、consent、account selection、MFA、CAPTCHA、その他challengeへ到達したら、既存Execution Handoff boundaryで停止します。Sensitive stepはHumanがdedicated browserまたはseparately authenticated Human takeover pathで直接完了します。

Human control後の `Done` / `Continue` はHuman stepをverifyしてよいという意味だけです。その後のsave、send、delete、share、その他account mutationへのapprovalではありません。

### Human Intervention後はFresh Reissue

Authenticated state-changing operationでは `require_fresh_semantic_action` semanticsを使います。

1. semantic action中にHuman-only surfaceが出る
2. Agent authorityを外す
3. Humanがsign-in / consent / account selectionを完了
4. Serverがallowed Maps surfaceへ戻ったことをverify
5. pre-auth semantic state / resource epochをinvalidate
6. MCP clientが意図したauthenticated actionをfresh reissue
7. current place/list/route identityをread/revalidateしてからaction

Human Intervention後にaccount mutationをsilent replayしません。

## Principal / Browser-session Isolation

MCP authorization principalとdedicated Chrome profile内でsign-inしているGoogle Accountは別identityです。既存Execution Handoff principal bindingは別MCP principalによるsame intervention takeoverを防ぎますが、MapsでどのGoogle Accountがactiveかをcryptographically proveするものではありません。

Account-backed stateではこの違いがsecurity上重要です。

### Initial V5 Deployment Gate

Per-principal browser/profile isolationを実装するまでは、authenticated V5 toolをsingle-user deployment/session modelだけで有効化します。

- local stdioのsingle user
- またはstableなauthenticated MCP principal 1つ + dedicated Maps browser profile 1つのremote deployment

Unrelatedな複数MCP principalをconcurrentに扱えるserverで、1つのshared Chrome profileをV5 account-backed toolへ公開してはいけません。

### Account Identity Exposure

Sign-in成功確認のためだけに、email、account name、profile photo、account ID、cookie、その他Google-account identifierをMCP responseへ返しません。

Implementationにaccount-continuity checkが必要なら、local opaque/HMAC bindingまたはcoarseな `signed_in | signed_out | unknown` semantic stateを優先します。より強いaccount identity mechanismは、raw identity dataをmodelへ返さず実現できるfresh live evidenceと別privacy/security reviewが必要です。

Multi-account / account-switching UIはinitial V5ではHuman-onlyです。AgentはGoogle Accountを選択しません。

## Proposed V5 Slices

### V5-A — Authenticated-session Foundation

Goal: account mutationなしでauthentication boundaryを証明する。

Design work:

- V5 explicit opt-inを追加しdefault OFF
- stable live semantic targetが確認できた場合だけcoarse authenticated Maps readiness (`signed_in | signed_out | unknown`) を定義
- account selection / sign-inはHuman-only
- 上記single-user browser/profile isolationを必須化
- Human Intervention後にpre-auth semantic stateをinvalidate
- credential/account identifierをMCP output、execution audit log、durable handoff checkpoint、errorへ入れない
- signed-out、Human Intervention、principal mismatch、stale epoch/requestState、fresh reissueをdeterministic test化

Completion gate:

- authenticated mutation toolはまだ追加しない
- raw account identityをMCPへ返さない
- Human sign-inはcoarse browser readinessとしてのみverify
- post-Human replayは不可能なまま

### V5-B — Bounded Saved-state Reads

Goal: future Save workflowに必要な最小account stateだけを読む。

Candidate semantic operation:

- `maps_read_place_save_state(expectedLabel)` — currently selected placeについて、user-directed Save判断に必要なbounded existing save-list choice / membershipだけを返す
- optional `maps_read_saved_lists()` — existing list identityをboundedに返すが、各list内の全placeは読まない

Required constraints:

- Interactive Assist + V5 opt-in必須
- selected place identityを先にrevalidate
- list resultはcapしpaginationしない
- list labelはuntrusted user/account textとして扱う
- duplicate/ambiguous list labelはfail closed
- raw list contents、note/comment、collaborator、sharing settings、Saved library全体traversalはscope外
- persistence / dataset化禁止
- list name/raw user contentをdurable audit/checkpoint logへ書かない

Exact tool name / capはlive observationでsemantic UI structureを確認するまでdesign candidateです。

### V5-C — Existing ListへのPlace Save

Goal: exact postcondition付きのlow-consequence account mutationを1つ導入する。

Initial mutation candidate:

- fresh bounded save-state readから選んだ **既存list 1つ** へ、currently selected/revalidated placeをsaveする

Recommended semantic shape:

```text
maps_search / maps_select_result
  -> maps_read_place_save_state(expectedLabel)
  -> uniqueなreturned list identityを1つ選択
  -> maps_save_place_to_list({
       expectedPlaceLabel,
       listIndex,
       expectedListLabel
     })
```

Safety rules:

- generic text-entry primitiveなし
- first implementationでnew-list creationなし
- list rename/description/edit/shareなし
- first implementationでplace removal/unsaveなし
- exact active-place identity、resource epoch、list index、unique expected labelをclick直前に再検証
- already-savedは追加toggleせずidempotent success
- exact visible saved-membership postconditionをsuccess条件にする
- mutation成功時semantic resource epochをadvance
- sign-in/consent/challenge発生時はHuman Interventionへ移り、fresh semantic reissueまでsaveしない

`save`だけに絞る理由: saved placeのremovalはper-list comment/note等のuser stateを失う可能性があり、安全にreversibleと仮定できません。Removalは別のobservation / consequence reviewが必要です。

### V5-D — Send to PhoneはExplicit Approval統合後

現行Google Maps公式情報では、signed-in desktop routeをphone/tabletへ送れ、desktop/mobileがsame Google Accountであること等が条件です。Send to phoneではmultiple destinationsを使えない等の現行制約もあります。

Sendingはdeviceを跨ぐexternal side effectでsilent undoできません。そのためinitial reversible Save sliceには含めません。

Implementation前に:

- 既存 `ActionApprovalManager` をreal MCP approval flowへ統合
- approvalをauthenticated MCP principal + resource epoch + exact route + exact selected device targetへbind
- one-shot consume + expiry
- Human Intervention completionとaction approvalを分離
- sign-in / consent後はfresh reissue/revalidate
- currently visible device choiceだけをboundedに返す
- free-form recipient/email/phone entry禁止
- notification/account/device settingをauto-enableしない

Route-send toolは最初、current semantic identityをsend直前にrevalidateできるsimple single-destination routeだけを対象にします。

“Send place to phone” はMaps-specific desktop place control/postconditionをfresh re-observeするまでobservation/design gateです。Googleはgeneral featureを文書化していますが、Search等の別surfaceからMaps place workflowを推測しません。

### V5-E — Maps HistoryはSeparate Privacy / Surface Gate

Googleはdesktopのaccount-backed Maps historyとしてsearch、directions、viewed place、shared link、call等を文書化しています。Single selected placeのsave membershipよりprivacy-sensitiveです。

また `maps.google.com` からGoogle My Activity/account surfaceへ移る可能性があり、current allowed top-level browser boundaryを広げることになります。

そのためMaps historyは **first V5 implementation sliceに含めません**。

将来re-openする場合:

- read-only first
- explicit user request必須
- strict small result cap、automatic paginationなし
- bulk export / persistence禁止
- same milestoneでhistory deletionを扱わない
- `myactivity.google.com` 等のaccount surface追加はseparate threat-model / allowlist reviewなしに行わない
- history contentをunrelated Maps actionへsilent利用しない

### Timeline — Web Roadmapから除外

Timelineは現行Maps-on-computer capabilityではありません。Google公式情報ではdevice-basedで、desktop Mapsでは利用不可です。

V5でbrowser workaround、mobile automation、internal API access、synced Timeline scraping等を追加して再現しません。Googleがsupported desktop Maps surfaceを公式に復活させ、bounded semantic targetを観測できた場合だけre-openします。

## Explicitly Deferred Account Mutations

Initial V5では次を実装しません。

- unsave/remove place
- create/rename/delete/share list
- collaborator management
- private label / Home / Work変更
- Maps history deletion
- Timeline access
- account switching
- notification/account setting変更
- review posting
- rating posting
- map/place edit
- public photo upload
- public contribution workflow
- payment/booking/purchase flow

Review/rating/edit/photo contributionはsigned-in UIが技術的に観測できてもinitial V5方向から外します。

## Semantic Identity / Postcondition Rules

Authenticated stateでもV4のsemantic identity disciplineを弱めません。

すべてのV5 operationは:

1. current known Maps semantic surfaceから開始
2. active place/route/account-ready stateをrevalidate
3. bounded exact candidate setをread
4. stale / reordered / missing / duplicate / ambiguous identityをreject
5. exactly one Maps-specific semantic actionを実行
6. exact postconditionをverify
7. mutation時resource stateをinvalidate/advance
8. sign-in/consent/challenge transitionで停止
9. Human-completed interventionをimplicit approvalへ変換しない

V5のためにgeneric DOM selector/click/type APIをMCPへ追加しません。

## Logging / Privacy

Authenticated account stateはpublic Maps UIよりsensitiveです。V5 logはcontrol-plane orientedに維持します。

Allowed examples:

- tool name
- operation class (`read_account_state`, `reversible_save`, `send_external`)
- outcome/error code
- duration
- resource epoch
- control planeで既に使うprincipal binding/hash
- 必要なcandidate/result count

Logしないもの:

- account email/name/ID
- saved-list name
- saved place note/comment
- device name
- authenticated surface由来というだけでraw route/place text
- credential/token/cookie
- takeover frame
- challenge answer
- durable handoff state内のraw action args

## Future Implementation Testing Strategy

### Deterministic Tests

各sliceで最低限fixture-firstに確認するもの:

- signed-out / signed-in / unknown
- sign-in -> Human Intervention
- Human completion後automatic replayなし
- principal mismatch
- stale resource epoch/requestState
- missing/duplicate/reordered list identity
- already-saved idempotency
- exact save postcondition
- audit/log redaction
- account identifier/credential leakageなし
- send operationのaction-approval principal/epoch/action binding

### Live Tests

Authenticated Live Maps E2Eはmanual-only / low-frequencyに限定します。

可能ならdedicated test Google Account/profileを使用します。CIでCAPTCHA/MFA/challengeを意図的にtriggerしません。Credentialをenvironment variable、fixture、workflow、log、MCP argumentへ保存しません。

Suggested order:

1. 必要ならHumanがmanual sign-in
2. bounded signed-in readiness observation
3. known public place 1件でbounded save-state read
4. read path安定後だけexisting test listへのSave mutation 1件
5. saved membershipをverify
6. cleanupが必要ならautomated removal semanticsがreviewされるまではHuman/manualで実施

Coverage目的でSaved list/historyをcrawlしません。

## V5 Implementation Entry Gate

次をすべて満たすまでimplementation開始しません。

1. proposed first sliceについてcurrent Google Maps authenticated UIをfresh observation済み
2. account identityを露出せずstable signed-in/coarse readiness semanticをverify可能
3. single-user/per-principal browser isolation ruleをdesign/configでenforce可能
4. existing-list save chooserにbounded unique semantic identity + exact postconditionがある
5. real account mutation前にHuman sign-in + fresh reissueをdeterministic test化
6. log/checkpointがsecret-freeかつuser-content-minimal
7. exact enabled account surface / non-goalをEN/JA同期
8. raw DOM/CDP/AX、generic text entry、internal Maps API/XHR、credential handlingへ依存しない

このgateを満たすまではV5は **design-only** です。
