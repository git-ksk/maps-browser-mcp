# Managed Human Takeover — macOS/Linux + iPhone Safari

[日本語](webrtc-human-takeover.ja.md)

This is the built-in **remote Human handoff** path for current single-user macOS and Linux/container deployments. It is optional: V5 does **not** require WebRTC, WebSocket relay, TURN, or any remote takeover when the dedicated Maps Chrome profile is already signed in. When remote Human control is needed, the legacy configuration name `webrtc_takeover` now selects a Handoff-managed Safari surface whose transport policy is direct WebRTC -> WebSocket relay -> optional WebRTC/TURN relay. Maps does not choose among those transports. The normal Maps automation path remains unchanged until `MAPS_CREDENTIAL_SAFE_HANDOFF=true` and `MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover` are configured.

Physical acceptance has passed with a real Mac + iPhone Safari on both same-LAN direct WebRTC and cellular/4G TURN relay, including the V5 Google sign-in recovery sequence. Linux separately passes Ubuntu/Xvfb acceptance for normal-browser exact-window capture/input, H.264/WebRTC, focused text over stdin, Enter, and teardown, and the Cloud Run production path has passed physical iPhone Safari relay plus real Human-only Google sign-in. That production evidence intentionally does not claim the still-open explicit post-Done checkpoint/fresh-restore lifecycle (#135) or final mobile keyboard/CJK UX regression (#134). The Human controls only the dedicated normal-Chrome window; Maps itself never receives framebuffer bytes, raw Human input, SDP/ICE candidates, TURN credentials, Google credentials, MFA values, cookies, or account identity.

## 1. Prerequisites

- macOS or Linux host running Maps and the dedicated Chrome profile;
- Node.js 20+ and the repository checkout;
- macOS: Xcode Command Line Tools / Swift toolchain to build `takeover-webrtc-host`, plus **Screen Recording** and **Accessibility** permission;
- Linux: isolated X11/Xvfb display, a lightweight window manager, `xdotool`, and `ffmpeg`;
- Chrome/Chromium managed by Maps, using a dedicated non-default profile;
- an iPhone/iPad browser compatible with Safari WebRTC;
- an **authenticated HTTPS operator origin** that proxies `/takeover/*` to the loopback Maps/Handoff core without exposing CDP or the loopback broker directly.

The versioned [reference OAuth gateway](../reference/oauth-gateway/README.md) is the repository example for the current single-user public-auth/private-core topology. A custom gateway must preserve the same principal and takeover security boundaries.

The built-in Handoff runtime supports macOS and Linux with different platform helpers behind the same browser/session protocol. Windows remains unsupported. Linux/container details are documented in [Container / headless Linux](container.md).

## 2. Install and build the pinned Handoff helper

Install the exact lockfile first:

```bash
npm ci --ignore-scripts
```

Maps consumes Handoff through an immutable source commit. The source dependency includes the Swift runtime used by this transport, so a second Handoff checkout is not required.

```bash
HANDOFF_SWIFT_PACKAGE="$PWD/node_modules/mcp-execution-handoff/experiments/thin-takeover-runtime"

swift build \
  -c release \
  --package-path "$HANDOFF_SWIFT_PACKAGE" \
  --product takeover-webrtc-host

WEBRTC_HOST="$(swift build -c release --package-path "$HANDOFF_SWIFT_PACKAGE" --show-bin-path)/takeover-webrtc-host"
test -x "$WEBRTC_HOST"
```

Keep `WEBRTC_HOST` as an absolute path for the Maps configuration. On Linux, use the pinned package binary instead of the Swift build:

```bash
WEBRTC_HOST="$PWD/node_modules/.bin/handoff-linux-webrtc-host"
test -x "$WEBRTC_HOST"
export MAPS_WEBRTC_TAKEOVER_DISPLAY_NAME=:99
```

The Linux display must be a local isolated X11 display owned by the same single-user runtime.

## 3. Configure the Maps core

V5 authenticated workflows and the Human handoff remain explicit opt-ins. Example core settings:

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

The public operator origin must be HTTPS and authenticated. For V5, the current reference topology authenticates the public user at the gateway and uses an independent `static-bearer` private hop to the loopback core. Do not forward the caller's public OAuth token into the Maps browser runtime.

See [Reference OAuth gateway](../reference/oauth-gateway/README.md) for the public gateway variables and private-core bearer setup.

## 4. Managed fallback and optional TURN

Same-LAN sessions prefer direct WebRTC. If direct establishment is unavailable, Handoff first fences that generation and switches to the authenticated WebSocket relay on the same HTTPS operator origin. TURN is optional and is considered only after the WebSocket generation is fenced. No Maps environment variable selects WebSocket or chooses a relay provider.

The WebSocket bootstrap returns a short-lived, principal/generation-bound Handoff ticket. Safari carries it only in the WebSocket subprotocol handshake; the public gateway authenticates the operator session, strips public OAuth/cookie material, and forwards only the bounded Handoff handshake plus the independent private-core bearer. The gateway never logs or persists WebSocket payloads or the ticket.

Optional TURN configuration belongs to **mcp-execution-handoff**, not Maps. The current Cloudflare Realtime TURN adapter recognizes this server-side pair:

```bash
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_ID=...
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_API_TOKEN=...
```

Set both or neither. A partial pair fails closed. Keep the long-lived token in the server secret boundary; never place it in a locator, browser profile, MCP arguments/results, logs, or repository files.

With TURN configured, Handoff still owns the complete staged plan. TURN never moves ahead of WebSocket fallback, and Maps has no provider-specific TURN/WebSocket branch. A stale direct or WebSocket generation cannot regain input authority after fallback, Done, or revoke.

## 5. Use the Human sign-in flow

1. Start the Maps core and authenticated operator gateway.
2. Read `maps_read_authenticated_readiness` on a fresh Maps surface.
3. If the result is `signed_out`, call `maps_request_human_sign_in`.
4. Open the returned short-lived locator in iPhone Safari.
5. Complete any **operator-gateway** authorization if prompted. This is separate from the target Google account.
6. In the streamed dedicated Chrome window, perform Google account selection/password/MFA/passkey interaction manually.
7. Tap **Done** only after the target browser visibly shows the intended post-sign-in state.
8. Maps revokes the Human surface, closes normal Chrome, starts a fresh Agent-owned Chrome/CDP session, and must re-read `maps_read_authenticated_readiness`.

`Done` means **stop Human authority**. It is never proof that Google accepted authentication, and it never approves a Save/Send or any other semantic action.

## 6. Expected network behavior

- Same LAN: Handoff should normally stay on direct WebRTC.
- Cloud Run/WAN when direct WebRTC is unavailable: Handoff should fence direct and select the WebSocket relay without requiring TURN.
- Optional TURN: Handoff may use WebRTC/TURN only after the WebSocket generation has been fenced.
- Only the exact dedicated Chrome window is eligible for capture/input. Missing or ambiguous target-window identity fails closed instead of widening to the desktop.
- If another Mac app is frontmost, Handoff resolves and activates the exact captured target window before accepting Human input.

Do not enable raw candidate, SDP, address, framebuffer, WebSocket payload/capability, or Human-input logging to debug connectivity. The supported diagnostics stay bounded to transport/state categories and timings without target or account identity.

Managed fallback also emits one automatic `managed_handoff_diagnostics` operator record whenever Handoff reports a bounded transition/failure event. The record is built only from Handoff's strict `ManagedOperatorDiagnosticsSnapshot`; unknown or extra fields are rejected before logging. Physical acceptance should capture this same snapshot before takeover, after fallback, immediately after failure, and after completion. This log path exists specifically so production diagnosis does not depend on the MCP client discovering a newly added diagnostic tool.

## 7. Current limitations

- macOS and Linux are supported by separate Handoff helpers; Windows is not supported;
- Linux Cloud Run core transport/sign-in is physically accepted with iPhone Safari relay and real Google sign-in; the explicit post-Done checkpoint/fresh-restore lifecycle remains tracked in #135;
- the iOS software keyboard can still obscure part of the remote target in some layouts;
- adaptive portrait/landscape target sizing and polished explicit reload/reconnect UX are follow-up work in upstream Handoff issue #17;
- do not rely on browser reload to preserve an active lease. If the Human surface cannot recover explicitly, revoke/reissue a fresh takeover rather than trying to bypass generation fencing;
- `thin_takeover` Native remains an optional/experimental sibling pending its separate physical acceptance.

## 8. Troubleshooting

### Helper exits with a permission failure

Grant Screen Recording and Accessibility to the terminal/service/launcher that runs Maps/Handoff, then fully restart that process. Handoff preflights both permissions and fails closed before Human authority starts.

### Locator opens but asks for operator authorization

Expected on a protected public origin. Operator authorization protects the Handoff surface; it is not Google authentication.

### Direct WebRTC is unavailable on Cloud Run or cellular

First confirm that the reviewed HTTPS operator origin can complete the authenticated `/takeover/*` HTTPS and WebSocket upgrade path. The managed WebSocket fallback should work without TURN. Configure Handoff TURN only as an optional later fallback; never copy TURN secrets into Maps configuration or the browser.

### Safari reload loses control

Do not weaken one-client/generation fencing. Use the supported explicit reconnect path when available; otherwise cancel/revoke and request a fresh locator. Mobile reload UX is being hardened upstream.

### Video is visible but input targets the wrong app

Current target-process mode should fail closed unless the exact captured window can be resolved and activated. Treat any contrary behavior as a security bug; do not add desktop-wide input fallback.

See [Troubleshooting](troubleshooting.md), [V5 authenticated workflows](v5-authenticated-workflows.md), and the pinned Handoff documentation for deeper architecture/security details.
