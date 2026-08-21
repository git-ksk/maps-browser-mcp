# WebRTC Human Takeover — macOS + iPhone Safari

[English](webrtc-human-takeover.md) | 日本語

現在の **single-user macOS** 構成で推奨するbuilt-in **remote Human handoff**です。ただしV5自体にWebRTC / Cloudflare / TURN / remote takeoverは必須ではありません。最も単純なV5構成は、Humanがローカルで一度ログインしたpersistentなMaps専用Chrome profileを使う形です。WebRTCは、後からsign-in / re-authentication、consent、challenge対応が必要になり、Humanが遠隔操作したい場合のoptional transportです。`MAPS_CREDENTIAL_SAFE_HANDOFF=true` と `MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover` を設定しない限り通常のMaps automation経路は変わりません。

物理Mac + iPhone Safariで、same-LAN direct WebRTCとcellular/4G TURN relayの両方、およびV5 Google sign-in recoveryまでacceptance済みです。Humanが操作するのはdedicated normal-Chrome windowだけで、Maps自体はframebuffer、raw Human input、SDP/ICE candidate、TURN credential、Google credential、MFA値、cookie、account identityを受け取りません。

## 1. 前提

- Mapsとdedicated Chrome profileを動かすmacOS host;
- Node.js 20+ とrepository checkout;
- `takeover-webrtc-host` build用Xcode Command Line Tools / Swift toolchain;
- Mapsが管理するdedicated non-default Chrome / Chromium profile;
- Handoff helperを起動するprocessへのmacOS **画面収録（Screen Recording）** と **アクセシビリティ（Accessibility）** 権限;
- Safari WebRTCを利用できるiPhone / iPad browser;
- `/takeover/*` をloopback Maps/Handoff coreへproxyする **認証済みHTTPS operator origin**。CDPやloopback brokerを直接公開しないこと。

現行single-userのpublic auth / private core構成はversioned [reference OAuth gateway](../reference/oauth-gateway/README.ja.md) がrepository内のreferenceです。独自gatewayでもsame principalとtakeover security boundaryを維持してください。

Built-in capture/input executionは現在macOS-onlyです。Linux/Windows hostやstandalone Cloud Run instanceをScreenCaptureKit/input workerとしては使えません。詳細は [Container / headless Linux](container.ja.md) を参照してください。

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

`WEBRTC_HOST` のabsolute pathをMaps設定へ渡します。

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

## 4. Cellular / 外部network向けoptional TURN

Same-LAN sessionはdirect WebRTCを優先します。WAN、cellular、CGNAT、制約Wi-Fiではrelayが必要になることがあります。

TURN設定はMapsではなく **mcp-execution-handoff** の責務です。現在のCloudflare Realtime TURN adapterはserver-sideで次のpairを読みます。

```bash
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_ID=...
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_API_TOKEN=...
```

両方設定するか、両方未設定にします。片方だけならfail closedです。Long-lived tokenはserver secret boundaryだけに置き、locator、browser profile、MCP args/result、log、repositoryへ入れません。

TURN設定時もHandoffは `iceTransportPolicy: all` を維持し、direct優先・relay fallback-onlyです。別vendorへsilent failoverしません。Provider-neutral relayはupstream `mcp-execution-handoff` #19で追跡します。

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

- Same LAN: 通常は `direct` pathを選択。
- Cellular / 外部network + TURN設定: direct不可時に `relay` を選択可能。
- Capture/input対象はexact dedicated Chrome windowだけ。Target windowがmissing/ambiguousならdesktopへ広げずfail closed。
- 別Mac appがfrontmostでも、Human input前にcaptured target windowを一意に解決・activateする。

Connectivity debugのためraw candidate、SDP、address、framebuffer、Human inputをlogしないでください。Supported diagnosticはcandidate type/count、peer state、selected direct/relay path、bounded timingだけです。

## 7. 現在の制約

- built-in WebRTC host runtimeはmacOS必須;
- iOS software keyboardがremote targetの一部を覆う場合がある;
- adaptive portrait/landscape target sizingと明示reload/reconnect UXはupstream Handoff #17のfollow-up;
- browser reloadでactive leaseが維持される前提にしない。Explicit recoveryできない場合はgeneration fencingを迂回せずrevoke/reissueする;
- `thin_takeover` Nativeは別物理acceptance完了までoptional / experimental sibling。

## 8. Troubleshooting

### Helperがpermission failureで終了する

Maps/Handoffを起動するTerminal / service / launcherへ画面収録とアクセシビリティ権限を付与し、そのprocessを完全再起動してください。HandoffはHuman authority開始前に両権限をpreflightし、無ければfail closedします。

### Locatorを開くとoperator authorizationが出る

Protected public originでは正常です。Operator authorizationはHandoff surface保護用で、Google認証とは別です。

### Wi-Fiでは動くがcellularで動かない

Server processにHandoff TURN変数が2つとも入っているか、review済みHTTPS operator originへ到達できるかを確認してください。TURN secretをMaps configやbrowserへコピーしないでください。

### Safari reload後にcontrolできない

One-client / generation fencingを弱めないでください。Supported explicit reconnectが使える場合はそれを使い、recoverできなければcancel/revokeしてfresh locatorを発行します。Mobile reload UXはupstreamでhardening中です。

### Videoは見えるが別appへinputされる

Current target-process modeはcaptured windowをexactに解決・activateできなければfail closedする設計です。異なる挙動はsecurity bugとして扱い、desktop-wide input fallbackを追加しないでください。

詳細は [Troubleshooting](troubleshooting.ja.md)、[V5 authenticated workflows](v5-authenticated-workflows.ja.md)、pin済みHandoff documentationを参照してください。
