# Managed Human Takeover — macOS/Linux + iPhone Safari

[English](webrtc-human-takeover.md) | 日本語

現在のsingle-user macOS / Linux-container構成向けbuilt-in **remote Human handoff**です。ただしV5自体にWebRTC / WebSocket relay / TURN / remote takeoverは必須ではありません。Remote Human controlが必要な場合、legacyな設定名 `webrtc_takeover` はHandoff-managed Safari surfaceを選択し、そのtransport policyはdirect WebRTC -> WebSocket relay -> optional WebRTC/TURN relayです。Mapsはそのtransportを選択しません。`MAPS_CREDENTIAL_SAFE_HANDOFF=true` と `MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover` を設定しない限り通常のMaps automation経路は変わりません。

物理Mac + iPhone Safariでsame-LAN direct WebRTC / cellular TURN / V5 Google sign-in recoveryまでacceptance済みです。LinuxもUbuntu/Xvfb acceptanceでnormal-browser exact-window capture/input、H.264/WebRTC、stdin経由focused text、Enter、teardownまでPASSし、Cloud Run production pathでは物理iPhone Safari relay + real Human-only Google sign-inまで完了しています。このproduction evidenceは、physical iPhone session-stability gate（#156）や未完の明示Done後checkpoint / fresh restore lifecycle（#135）までcloseしたとはclaimしません。Mobile keyboard / CJK polish（#134）は、実際の認証フローを止めない限り非blockerのgeneric Handoff follow-upとして別追跡します。Humanが操作するのはdedicated normal-Chrome windowだけで、Maps自体はframebuffer、raw Human input、SDP/ICE candidate、TURN credential、Google credential、MFA値、cookie、account identityを受け取りません。

## 1. 前提

- Mapsとdedicated Chrome profileを動かすmacOSまたはLinux host;
- Node.js 20+ とrepository checkout;
- macOS: `takeover-webrtc-host` build用Xcode Command Line Tools / Swift toolchain、および **画面収録** / **アクセシビリティ** 権限;
- Linux: isolated X11/Xvfb display、軽量window manager、`xdotool`、`ffmpeg`;
- Mapsが管理するdedicated non-default Chrome / Chromium profile;
- Safari WebRTCを利用できるiPhone / iPad browser;
- `/takeover/*` をloopback Maps/Handoff coreへproxyする **認証済みHTTPS operator origin**。CDPやloopback brokerを直接公開しないこと。

現行single-userのpublic auth / private core構成はversioned [reference OAuth gateway](../reference/oauth-gateway/README.ja.md) がrepository内のreferenceです。独自gatewayでもsame principalとtakeover security boundaryを維持してください。

Built-in Handoff runtimeはsame browser/session protocolの背後にmacOS / Linux別helperを持ちます。Windowsは未対応です。Linux/container詳細は [Container / headless Linux](container.ja.md) を参照してください。

## 2. Pin済みHandoff helperをbuild

まずexact lockfileをinstallします。

```bash
npm ci --ignore-scripts
```

MapsはHandoffをimmutable source commitでconsumeします。このsource dependencyにSwift runtimeも含まれるため、Handoff repositoryを別cloneする必要はありません。

```bash
HANDOFF_SWIFT_PACKAGE="$PWD/node_modules/mcp-execution-handoff/experiments/thin-takeover-runtime"

swift build \
  -c release \
  --package-path "$HANDOFF_SWIFT_PACKAGE" \
  --product takeover-webrtc-host

WEBRTC_HOST="$(swift build -c release --package-path "$HANDOFF_SWIFT_PACKAGE" --show-bin-path)/takeover-webrtc-host"
test -x "$WEBRTC_HOST"
```

`WEBRTC_HOST` のabsolute pathをMaps設定へ渡します。LinuxではSwift buildではなくpin済みpackage binaryを使います。

```bash
WEBRTC_HOST="$PWD/node_modules/.bin/handoff-linux-webrtc-host"
test -x "$WEBRTC_HOST"
export MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99
```

Linux displayはsame single-user runtimeが所有するlocal isolated X11 displayに限定します。

## 3. Maps coreを設定

V5 authenticated workflowとHuman handoffは明示Opt-inです。Core側の例:

```bash
export INTERACTIVE_ASSIST_MODE=true
export MAPS_V5_AUTHENTICATED_WORKFLOWS=true

export MAPS_CREDENTIAL_SAFE_HANDOFF=true
export MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover
export MAPS_REMOTE_TAKEOVER=true
export MAPS_TAKEOVER_PUBLIC_BASE_URL=https://maps-mcp.example.com
export MAPS_WEBRTC_TAKEOVER_HOST_EXECUTABLE="$WEBRTC_HOST"

export MAPS_CHROME_PROFILE_DIR="$HOME/.maps-browser-mcp/chrome-profile"
export MCP_HTTP_HOST=127.0.0.1
export MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,maps-mcp.example.com
```

Public operator originはHTTPSかつ認証必須です。V5の現行reference topologyではpublic userをgatewayで認証し、loopback coreへのprivate hopには独立 `static-bearer` を使います。Callerのpublic OAuth tokenをMaps browser runtimeへ転送しません。

Public gateway / private-core bearer設定は [Reference OAuth gateway](../reference/oauth-gateway/README.ja.md) を参照してください。

## 4. Managed fallbackとoptional TURN

Same-LAN sessionはdirect WebRTCを優先します。Direct establishmentが使えない場合、Handoffはそのgenerationを先にfenceして、same HTTPS operator origin上のauthenticated WebSocket relayへ切り替えます。TURNはoptionalで、WebSocket generationをfenceした後にだけ候補になります。Maps側にWebSocket選択やrelay provider選択用の環境変数は追加しません。

WebSocket bootstrapはprincipal/generation-boundなshort-lived Handoff ticketを返し、SafariはWebSocket subprotocol handshakeだけに載せます。Public gatewayはoperator sessionを認証し、public OAuth/cookie materialを除去し、bounded Handoff handshakeと独立private-core bearerだけを転送します。GatewayはWebSocket payloadやticketをlog/persistしません。

Optional TURN設定はMapsではなく **mcp-execution-handoff** の責務です。現在のCloudflare Realtime TURN adapterはserver-sideで次のpairを読みます。

```bash
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_ID=...
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_API_TOKEN=...
```

両方設定するか、両方未設定にします。片方だけならfail closedです。Long-lived tokenはserver secret boundaryだけに置き、locator、browser profile、MCP args/result、log、repositoryへ入れません。

TURN設定時もcomplete staged planはHandoffが所有します。TURNがWebSocket fallbackより前に移動することはなく、Mapsにprovider-specific TURN/WebSocket branchはありません。Fallback / Done / revoke後にstale direct/WSS generationがinput authorityを取り戻すこともありません。

## 5. Human sign-inを使う

1. Maps coreとauthenticated operator gatewayを起動。
2. Fresh Maps surfaceで `maps_read_authenticated_readiness` を読む。
3. `signed_out` なら `maps_request_human_sign_in` を呼ぶ。
4. 返されたshort-lived locatorをiPhone Safariで開く。
5. 必要なら **operator gateway** の認証を完了。これはtarget Google Accountとは別。
6. Streamされたdedicated Chrome window内でGoogle Account選択/password/MFA/passkeyをHumanが手動操作。
7. Target browser上で意図したsign-in後状態を目視確認してから **Done**。
8. MapsはHuman surfaceをrevokeしnormal Chromeを終了、fresh Agent-owned Chrome/CDPを起動して `maps_read_authenticated_readiness` を再実行する。

`Done` は **Human authorityを終了する操作** です。Google認証成功の証明でも、Save/Send等semantic actionのapprovalでもありません。

## 6. 期待するnetwork動作

- Same LAN: 通常はdirect WebRTCを維持。
- Cloud Run / WANでdirect WebRTC不可: Handoffがdirectをfenceして、TURNなしでもWebSocket relayを選択。
- Optional TURN: WebSocket generationをfenceした後にだけHandoffがWebRTC/TURNを利用可能。
- Capture/input対象はexact dedicated Chrome windowだけ。Target windowがmissing/ambiguousならdesktopへ広げずfail closed。
- 別Mac appがfrontmostでも、Human input前にcaptured target windowを一意に解決・activateする。

Connectivity debugのためraw candidate、SDP、address、framebuffer、WebSocket payload/capability、Human inputをlogしないでください。Supported diagnosticはtarget/account identityを含まないbounded transport/state categoryとtimingだけです。

Managed fallbackでは、Handoffがbounded transition / failure eventを出した時に `managed_handoff_diagnostics` operator recordも自動出力します。RecordはHandoffのstrict `ManagedOperatorDiagnosticsSnapshot` だけから構築し、unknown / extra fieldはlog前にrejectします。Physical acceptanceでは takeover開始前、fallback後、failure直後、completion後の同じsnapshotを取得します。このlog pathにより、MCP clientが新しいdiagnostic tool schemaをまだcacheしていない場合でもproduction diagnosisを継続できます。

## 7. 現在の制約

- macOS / Linuxは別Handoff helperで対応。Windowsは未対応;
- Linux Cloud Run core transport / sign-inは物理iPhone Safari relay + real Google sign-inまでacceptance済み。明示Done後のcheckpoint / fresh restore lifecycleは#135で継続追跡;
- iOS software keyboardがremote targetの一部を覆う場合がある;
- adaptive portrait/landscape target sizingと明示reload/reconnect UXはupstream Handoff #17のfollow-up;
- browser reloadでactive leaseが維持される前提にしない。Explicit recoveryできない場合はgeneration fencingを迂回せずrevoke/reissueする;
- `thin_takeover` Nativeは別物理acceptance完了までoptional / experimental sibling。

## 8. Troubleshooting

### Helperがpermission failureで終了する

Maps/Handoffを起動するTerminal / service / launcherへ画面収録とアクセシビリティ権限を付与し、そのprocessを完全再起動してください。HandoffはHuman authority開始前に両権限をpreflightし、無ければfail closedします。

### Locatorを開くとoperator authorizationが出る

Protected public originでは正常です。Operator authorizationはHandoff surface保護用で、Google認証とは別です。

### Cloud Run / cellularでdirect WebRTCが使えない

まずreview済みHTTPS operator originでauthenticated `/takeover/*` HTTPSとWebSocket upgradeが通ることを確認してください。Managed WebSocket fallbackはTURNなしで動作する設計です。TURNはHandoffのoptionalな後段fallbackとしてだけ設定し、TURN secretをMaps configやbrowserへコピーしないでください。

### Safari reload後にcontrolできない

One-client / generation fencingを弱めないでください。Supported explicit reconnectが使える場合はそれを使い、recoverできなければcancel/revokeしてfresh locatorを発行します。Mobile reload UXはupstreamでhardening中です。

### Videoは見えるが別appへinputされる

Current target-process modeはcaptured windowをexactに解決・activateできなければfail closedする設計です。異なる挙動はsecurity bugとして扱い、desktop-wide input fallbackを追加しないでください。

詳細は [Troubleshooting](troubleshooting.ja.md)、[V5 authenticated workflows](v5-authenticated-workflows.ja.md)、pin済みHandoff documentationを参照してください。
