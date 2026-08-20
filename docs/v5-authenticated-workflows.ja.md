# V5 Authenticated Workflows — Design Baseline

V5は、userがsign-inした後にだけ存在するGoogle Maps Web stateを意図的に扱う最初のmilestoneです。この文書はauthenticated semanticsのdesign baselineとimplementation recordです。V5-A / V5-Bはexplicit V5 opt-inの背後で実装済みで、V5-Cは下記live-observation / deterministic safety gateを満たした上で最初のbounded mutationを追加します。

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


### Credential-safe Human sign-in ceremony

`MAPS_CREDENTIAL_SAFE_HANDOFF=true` の場合、`maps_request_human_sign_in` が `signed_out` から明示的なHuman-only entry pathを提供します。Sign in click、Google Account選択、Humanに代わるcredential/MFA入力、account identity読取、cookie/token exportは行いません。既存Execution Handoff boundaryへ入り、server-owned CDP Chromeを完全停止し、同じdedicated non-default profileをremote-debugging/automation attachmentなしのnormal Chromeで開きます。

Transportは4種類です。defaultの `MAPS_CREDENTIAL_SAFE_TRANSPORT=external` は既存OS-level remote-access surfaceへHumanを案内し、`cua_takeover` はlocal fallback/reference bridgeです。`thin_takeover` はNative credential pathで、automation Chrome停止後にsame dedicated profileをnormal Chromeで開き、Mapsは既存authenticated Handoff brokerからshort-lived Native-only locatorだけを発行します。MapsがHandoffへ渡すcapture ownership情報は、自分が起動したnormal ChromeのPIDだけです。HandoffはそのPIDからeligibleなwindowを厳密に1つ解決し、そのwindowだけへcapture/inputをscopeし、missing/ambiguousならdesktopへ広げずfail closedします。ScreenCaptureKit / VideoToolbox / CoreGraphics media/input runtime、generationごとのroot key、reconnect fencing、immediate revokeは `mcp-execution-handoff` 内に留め、Mapsは実装詳細を所有しません。Human入力textはHuman plane内だけを通りnorthbound MCP/model/logへ返しません。

Human completionは特定Google Accountのactive証明ではありません。automation再開前にnormal browserとactive Human transportをrevokeしdedicated profile解放を確認、CDP runtimeをfreshに再起動し、clientは `maps_read_authenticated_readiness` を再実行します。pre-auth semantic stateはreplayしません。`cua_takeover` では追加remote-desktop製品は不要で、既存製品を使いたいdeployment向けには `external` を残します。

Multi-account / account-switching UIはinitial V5ではHuman-onlyです。AgentはGoogle Accountを選択しません。

## Proposed V5 Slices

### V5-A Live Readiness Evidence（2026-08-18）

専用server-owned Chrome profileでsigned-out / signed-inの両状態をfresh observationしました。MCPへaccount identityを返さず、Maps surface上のcoarse controlだけで判定できます。

- signed-out: visible Sign in導線あり、Google Account controlなし
- signed-in: Sign in導線なし、Google Account controlあり
- contradictory / incomplete / non-Maps stateは `unknown` へfail closed

`maps_read_authenticated_readiness` はV5 Opt-in時だけ公開し、`signed_in | signed_out | unknown` のみ返します。Email、account name、profile photo、account ID、cookie、tokenは読取・返却しません。

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

Live implementation status (2026-08-18): `maps_read_place_save_state(expectedLabel)` をV5 Opt-in配下で実装済み。Fresh observationでboundedな「リストに保存」menuと、existing-list rowの `role=menuitemradio` + `aria-checked=true|false` を確認した。Toolはsigned-in readinessとexact place identityを再検証し、existing list name + membershipを最大10件だけ返す。paginationせず、row選択/new list作成をせず、read後はEscapeでchooserを閉じる。List identityは各row内の最初のstable visible text leafから取得し、privacy/count metadataは意図的に除外する。Flatten/duplicate/missing等でrow structureが曖昧ならfail closed。`maps_read_saved_lists()` はcurrent workflowにSaved-library traversalが不要なため未実装のまま。

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

Implementation status (2026-08-18): `maps_save_place_to_list({ expectedPlaceLabel, listIndex, expectedListLabel })` をV5 opt-in + Interactive Assistの背後で実装しました。各invocationはfresh bounded save chooserを開き、signed-in readiness、exact selected-place identity、captured resource epoch、さらにlist index + expected list labelの両方をsingle row action直前に再検証します。Fresh read時点ですでにsaved、またはclick直前のraceでsavedへ変化したtargetはtoggleせずidempotent successです。実際にmutationした場合は、exact target rowをfreshに `aria-checked=true` と確認できた場合だけsuccessとし、その時点でのみsemantic resource epochをadvanceします。Missing / reorder / duplicate / flattened list identity、new-list control、postcondition failure、stale stateはfail closeします。New list作成、unsave、Saved library traversal、account identity / credential read、cleanup目的のautomatic removalは実装しません。Human Intervention completionとaction approvalは別概念のままで、V5-DにreserveしているActionApproval requirementをV5-Cへ勝手に追加しません。

2026-08-18のfresh live compatibility observationでは、signed-in selected-place Save surface、boundedな `role=menu` chooser、existing-listの `role=menuitemradio` row、`aria-checked=false` membershipをprivate list label非露出で確認しました。Live account mutationは、明確にtest-purposeと一意判定できるexisting listが存在しなかったため意図的に **BLOCKED** としました。User listを推測して変更せず、新規listも作成せず、live testのcleanup都合だけでremove semanticを追加していません。

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

Initial route-send surfaceは、delivery直前にcurrent semantic identityをrevalidateできるsimple single-destination routeだけを対象にします。

Implementation status (2026-08-18): `maps_read_route_send_targets({ expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel })` と `maps_send_route_to_device(...)` をV5 opt-in + Interactive Assist gateの背後へ実装しました。Selected routeはboundedなindex + labelだけをephemeral semantic stateとして保持します。Target readはsigned-in readiness、exact canonical simple directions request、exact selected-route identityを要求し、selected-routeのSend-to-phone dialogを開いてcurrently visible device labelを最大6件だけ返します。Email targetとnotification checkboxは除外し、paginationせず、sendせずにdialogを閉じます。

Send operationはreal MCP 2026-07-28 `input_required` / form elicitation flowを使います。Approval record作成前にclientのform-elicitation capabilityを必須化し、approvalをauthenticated MCP principal + exact resource epoch + exact route args + exact device index / expected labelへbindします。Approval requestStateにはraw route/device textを入れずbounded control-plane identifier/digestだけを保持し、Human向けapproval formにはfinal exact actionを表示します。Approvalはone-shot + expiry付きで、fresh route/device revalidation完了後、single exact device clickの直前にだけconsumeします。Human Intervention completionはapprovalを作成・充足せず、Human Intervention後は必ずfresh semantic reissueです。

2026-08-18のfresh live observationでは、selected-routeのgeneric Send-to-phone control、visibleな `role=dialog` 1つ、bounded device-button target、独立したnotification checkboxを確認しました。新しいread toolはdedicated signed-in profileでcurrent device 1件をboundedに返し、dialogをcloseしました。Real MCP approval roundも `input_required` + signed requestState + exact `action-approval` elicitation + explicit cancel round-tripまでlive確認し、cancelではsend 0件です。その後freshなexplicit Human approvalを取得し、live route-send invocationを1回だけ実行して、target iOS device側でdeliveryを独立確認しました。初期のvisible-confirmation probeは、現行Mapsの `aria-live` confirmation文言/重複DOMが想定よりbroaderだったためfail closeしました。Automatic retryは行っていません。このlive observationを基にpostconditionをhardeningし、click前のbounded live-region baselineを取得、同一announcementをdeduplicateし、click後に新規出現したexact-device + send-semantic announcementが1件だけの場合にsuccessとする形へ変更しました。修正版postconditionはdeterministic testでcoverageし、parser確認のためだけの2回目external sendは意図的に行っていません。V5-D live session全体では複数notificationを観測しましたが、先行するSend-surface observationがあるためsingle approved invocation由来とは断定していません。Implementation上はapproved invocationごとのdevice-click siteをexact 1箇所に固定し、postcondition failure後のdelivery retryは行いません。

“Send place to phone” はMaps-specific desktop place control/postconditionをfresh re-observeするまでobservation/design gateです。Googleはgeneral featureを文書化していますが、Search等の別surfaceからMaps place workflowを推測しません。

### V5-E — Maps HistoryはSeparate Privacy / Surface Gate

Googleはdesktopのaccount-backed Maps historyとしてsearch、directions、viewed place、shared link、call等を文書化しています。Single selected placeのsave membershipよりprivacy-sensitiveです。

2026-08-18のfresh live observationでは、1つの再利用可能なMaps datasetではなく、signed-in entry pointが3系統に分かれていることを確認しました。

- Maps menuのHistory menu itemは、activateするとMaps originを離れて `myactivity.google.com/search-services/history/maps` へ遷移する
- Maps menuにはRecent menu itemもありMaps surface内に残るが、current Recent main surfaceはmutation-adjacentかつbounded extraction向けsemanticが弱い。観測時は15個のcheckbox、Delete / More control、scrollable containerが同居する一方、activity entry自体にはDOM順序やprivate labelへ依存せずbindできるstableな `listitem` / `row` semanticを確認できなかった
- `Your data in Maps` は明示的な `myaccount.google.com` account-surface linkであり、Maps allowlistの暗黙拡張とは扱わない

このため **V5-Eのhistory read toolは実装しません**。Historyは現時点で `BLOCKED: separate account-surface threat model required` とします。Maps-local Recentもsafe substituteとはみなさずobservation gateを維持し、private activityをDOM positionでparseしたり、adjacentなdelete controlを跨いだり、auto-scroll / paginationしたり、opaque/internal attributeからrow identityを推測しません。

Re-open条件は次のどちらかです。

- separate account-surface threat model + explicit top-level allowlist reviewによりnarrowなMy Activity read surfaceを許可できる
- Maps Recentでstableなsemantic row/container modelをfresh observationでき、scroll/paginationなしのhard cap、account identity/private-label selector/generic DOM exposure/mutation-adjacent ambiguityなしでparseできる

Re-open後もread-only first、explicit user invocation必須、strict small hard cap、bulk export / persistence / deletionなし、unrelated Maps actionへのsilent reuse禁止を維持します。

### Timeline — Web Roadmapから除外

Timelineは現行Maps-on-computer capabilityではありません。Google公式情報ではdevice-basedで、desktop Mapsでは利用不可です。2026-08-18のfresh live observationではMaps menuに `/maps/timeline` targetのlink自体は見えましたが、direct navigation後はdedicated Timeline routeに留まらず通常Maps surfaceへ戻り、bounded desktop Timeline targetは確認できませんでした。

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

## V5 Authenticated-Semantic Implementation Entry Gate

最初のauthenticated semantic toolより前に、fail-closedなconfiguration / isolation foundationを実装して構いません。authenticated Maps readiness、saved-state read、mutationを実装・公開する前には次をすべて満たします。

1. proposed first sliceについてcurrent Google Maps authenticated UIをfresh observation済み
2. account identityを露出せずstable signed-in/coarse readiness semanticをverify可能
3. single-user/per-principal browser isolation ruleをdesign/configでenforce可能
4. existing-list save chooserにbounded unique semantic identity + exact postconditionがある
5. real account mutation前にHuman sign-in + fresh reissueをdeterministic test化
6. log/checkpointがsecret-freeかつuser-content-minimal
7. exact enabled account surface / non-goalをEN/JA同期
8. raw DOM/CDP/AX、generic text entry、internal Maps API/XHR、credential handlingへ依存しない

このgateを満たすまではV5 authenticated **semantic toolはdesign-only** です。configuration / isolation foundation自体はaccount-state readやmutationを許可しません。
