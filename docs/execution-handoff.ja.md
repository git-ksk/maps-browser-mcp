# Execution Handoff（日本語）

この文書は、CAPTCHAを自動突破せずにbrowserの実行権をAgentからHumanへ渡し、安全にAgentへ戻す仕組みを説明します。

## Status

現在は **V1 MCP MRTR handoff** に加えて、opt-inの **V2 Remote / Mobile Human Takeover Broker** を実装しています。

Google Maps操作中にCAPTCHA / access challenge、sign-in、consent、その他のmanual surfaceが出た場合、ServerはMCP `input_required` を返します。通常は専用ChromeでHumanが直接操作します。V2 Remote Takeoverを明示的に有効化した場合は、同じpromptにスマホ向けTakeover session URLも追加されます。

MCP側ではpassword、2FA code、CAPTCHA answer、cookie等を入力させません。MCP/LLMへ表示するTakeover URLにcapability secretは含めず、random session locatorだけを載せます。認証済みTakeover pageが読み込まれた後、same-origin scriptがshort-lived capabilityをbootstrapし、page memory内だけでBroker API用に保持します。

スマホからのtext inputはTakeover Brokerからlocal Chrome/CDPへ直接中継され、MCP tool argumentやLLM-visible contentには入りません。ただしlocal Broker process自体は中継のため入力をmemory上で扱うため、外側のHTTPS gatewayとBrokerを動かすhostはtrusted computing boundaryに含まれます。Brokerはinput payloadをlogへ出しません。

Remote操作を終えたらMCPへ戻ってContinueを選択します。Serverはverification前にremote capabilityをrevokeし、browser状態を検証してからAgentへ実行権を戻します。

現在の基盤は以下です。

- 排他的なexecution authority
- browser runtime内のintervention metadata
- stale semantic stateを失効させるresource epoch
- canonical actionごとのResume Policy
- originating tool invocationへbindしたHMAC保護済みMCP `requestState`
- intervention id + resource epochへbindしたshort-lived takeover capability

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
      |  \
      |   \ optional V2 phone broker
      |    \ screenshot + bounded input
      |
      | Remote Done → MCPでContinue
      v
verifying        authority=none, epoch++
      |
      | Maps surface + challenge消失を検証
      | challenge継続 → 新epochでHumanへ戻す
      v
ready_to_resume  authority=none
      |
      | Resume Policy評価
      v
Agent owns browser again
```

`agent + human` が同時にauthorityを持つ状態は作りません。Interventionがactiveな間は通常のAgent CDP accessをbrowserへ触る前に拒否します。Verificationへ移る前に、そのintervention向けRemote Takeover capabilityもすべてrevokeします。

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

Resource epochはintervention開始時、Human control完了後、navigationやsemantic page transition時に進みます。DOM ref、candidate index、snapshot、takeover capability、将来のaction approval等は生成時epochへbindし、epoch変更後はstaleとして拒否します。

Humanが完了しただけではresumeしません。許可されたGoogle Maps surfaceへ戻っていることと、既知のinline challenge indicatorが消えていることをServerで検証します。Challengeが残っていればHumanへauthorityを返し、新しいepochへbindしたTakeover sessionで次のMRTR roundを開始します。

## Tool Resume Strategy

中断されたMCP toolとcanonical browser actionは別概念なので、V1/V2ではtool側に2種類のresume strategyを持たせます。

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

## V2 Remote / Mobile Takeover

Remote Takeoverはdefault OFFです。有効化する場合は以下の境界を必須にします。

```bash
MCP_HTTP_HOST=127.0.0.1
MAPS_REMOTE_TAKEOVER=true
MAPS_TAKEOVER_PUBLIC_BASE_URL=https://maps-mcp.example.com
MAPS_TAKEOVER_TTL_SECONDS=300
```

`MAPS_TAKEOVER_PUBLIC_BASE_URL` はoriginだけを指定します。credential、path、query、fragmentは禁止です。Loopback開発以外はHTTPS必須です。また、V2を有効にした状態でNodeをnon-loopback bindしようとすると設定時点でfail-closeします。

外部公開は別のauthenticated HTTPS gateway / tunnel / reverse proxyで行い、**`/takeover/*` をMCP workflowと同じsingle-user access policyで保護してください。** MCPへ表示されるTakeover session URLはlocatorにすぎず、user authenticationの代替ではありません。現V2はprincipal bindingをgateway deploymentへ依存しており、Node内でMCP principalとgateway principalを直接比較するところまでは未実装です。これはauth-provider統合後のV2.1対象です。

MCP/LLMへ表示するURLは以下です。

```text
https://maps-mcp.example.com/takeover/<random-session-id>
```

Path、query、fragmentのどこにもtakeover capabilityは含めません。外側のgateway authenticationを通ってpageが読み込まれた後、same-origin scriptが次を呼びます。

```text
GET /takeover/api/bootstrap/<random-session-id>
```

Bootstrap endpointはbrowserが付与する `Sec-Fetch-Site: same-origin` のrequestだけを受け付けます。そこでshort-lived capabilityをpageへ返し、page memory内で保持して、その後のsame-origin Broker APIにだけ `Authorization: Takeover ...` headerとして送ります。CORSは公開しません。Responseは`Cache-Control: no-store`、`Referrer-Policy: no-referrer`です。

Capabilityはprocess-localな256-bit random keyからHMAC生成し、以下へbindします。

- takeover session id
- intervention id
- resource epoch
- absolute expiry

Raw capabilityはpersistent storageへ保存しません。Epochが変われば旧sessionをrevokeして新しいcapabilityを発行します。TTL defaultは5分、設定可能範囲は60〜600秒です。

### スマホ側へ公開する操作

公開するのは以下だけです。

- current viewportのbounded JPEG screenshot
- tap
- bounded vertical scroll
- 現在focus中fieldへのtext insert
- Enter / Tab / Escape / Backspace / Arrow keyだけのstrict allowlist
- Remote capabilityだけを終了するDone

公開しません。

- browser address bar / arbitrary navigation API
- raw CDP
- DOM / AX dump
- Network request/response
- cookie / browser storage
- shell / terminal
- CAPTCHA solver / anti-bot bypass

Frame取得とinputのたびに、intervention id・resource epoch・`human_active` authorityを再検証します。さらにtop-level pageも確認し、通常Maps、認識済みGoogle challenge、`accounts.google.com`、`consent.google.com` 以外へ出た場合はremote controlをfail-closeします。

`Done`はMCP actionの成功やapprovalを意味しません。Remote capabilityをrevokeするだけです。その後MCPへ戻ってContinueを選択し、Server verificationを通して初めてAgentへauthorityを戻します。

## Security Boundary

V2でも以下を維持します。

- CDPはlocal dedicated browser runtimeだけで使い、Human client/public networkへ公開しない
- HumanとAgentのcontrolは相互排他
- Takeover経路のDOM、Network、Screenshot、credential、2FA、CAPTCHA response、takeover capabilityをAgent/LLMへ返さない
- Takeover pageはauthenticated HTTPS gatewayでworkflow開始者と同じsingle userへ限定し、session locator単体をauthentication boundaryにしない
- Capabilityはshort-lived・1 intervention/resource epoch限定・revoke可能で、application logやMCP contentへ出さない
- arbitrary navigation primitiveを持たせず、localhost/private network/link-local metadata/`file:`等へのSSRF pivotを作らない
- Human authority中かつ許可済みGoogle intervention surface上だけinputを受け付ける
- CAPTCHA solver、anti-bot evasion、stealth/fingerprint spoofing、proxy rotationへ変質させない

Remote takeover時のtrusted pathはphone、authenticated HTTPS gateway、local Broker process、dedicated Chromeです。スマホで入力したtextは中継のためこれらendpointで扱われますが、MCP/LLM contentには含めず、Brokerはpayloadをlogしません。自分でcontrolできるgateway/hostを使用してください。

## V2.1 Direction

次はMCP authorization principalとTakeover requestのdirect identity bindingです。既存のoptional single-user auth-provider実装をcurrent MRTR/runtimeへrebaseし、Takeover page/API requestごとにauthenticated principalを取得して、intervention作成者と一致することをServer側でも検証する想定です。

その後の候補はWebRTC/WebTransportによるlow-latency view、device-bound proof、長時間/切断跨ぎ向けMCP Tasks integrationです。ただしtransportを進化させてもauthority / epoch / resume ruleは弱めません。

## CI Boundary

通常CIはHuman takeoverを待たず、CAPTCHAやsign-in challengeを意図的に発生させません。Authority state machine、request-state binding、takeover capabilityのrotation/expiry/revoke、capability bootstrap、Broker HTTP boundary、fail-closed configをdeterministic testで確認します。Manual Live Maps E2Eで自然発生したchallengeもCIが突破する対象にはしません。

## Upstream化の現在地

generic control-plane実装は `git-ksk/mcp-execution-handoff` へ切り出しました。Maps固有URL/surface classification、postcondition verification、CDP executionはこのrepositoryに残します。Japan Cinemaをsecond real adapterとして検証済みで、upstreamはformal source of truthになりました。`v0.1.0` はsource releaseとして作成済みですが、npm publishは意図的に無効のままです。Mapsはimmutableなsource-release commitをconsumeします。
