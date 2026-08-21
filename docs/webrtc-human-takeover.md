# WebRTC Human Takeover — macOS + iPhone Safari

[日本語](webrtc-human-takeover.ja.md)

This is the recommended built-in **remote Human handoff** path for the current **single-user macOS** deployment. It is optional: V5 does **not** require WebRTC, Cloudflare, TURN, or any remote takeover when the dedicated Maps Chrome profile is already signed in. The simplest V5 deployment is a persistent dedicated profile that the Human signs into locally once; WebRTC is for later sign-in/re-authentication, consent, or challenge handling when the Human needs remote access. The normal Maps automation path remains unchanged until `MAPS_CREDENTIAL_SAFE_HANDOFF=true` and `MAPS_CREDENTIAL_SAFE_TRANSPORT=webrtc_takeover` are configured.

Physical acceptance has passed with a real Mac + iPhone Safari on both same-LAN direct WebRTC and cellular/4G TURN relay, including the V5 Google sign-in recovery sequence. The Human controls only the dedicated normal-Chrome window; Maps itself never receives framebuffer bytes, raw Human input, SDP/ICE candidates, TURN credentials, Google credentials, MFA values, cookies, or account identity.

## 1. Prerequisites

- macOS host running Maps and the dedicated Chrome profile;
- Node.js 20+ and the repository checkout;
- Xcode Command Line Tools / Swift toolchain to build `takeover-webrtc-host`;
- Chrome/Chromium managed by Maps, using a dedicated non-default profile;
- macOS **Screen Recording** and **Accessibility** permission for the process that launches the Handoff helper;
- an iPhone/iPad browser compatible with Safari WebRTC;
- an **authenticated HTTPS operator origin** that proxies `/takeover/*` to the loopback Maps/Handoff core without exposing CDP or the loopback broker directly.

The versioned [reference OAuth gateway](../reference/oauth-gateway/README.md) is the repository example for the current single-user public-auth/private-core topology. A custom gateway must preserve the same principal and takeover security boundaries.

Current built-in capture/input execution is macOS-only. A Linux/Windows host or a standalone Cloud Run instance cannot act as the ScreenCaptureKit/input worker; see [Container / headless Linux](container.md).

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

Keep `WEBRTC_HOST` as an absolute path for the Maps configuration.

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

## 4. Optional TURN for cellular / external networks

Same-LAN sessions prefer direct WebRTC. WAN, cellular, CGNAT, or restrictive Wi-Fi commonly need a relay.

TURN configuration belongs to **mcp-execution-handoff**, not Maps. The current Cloudflare Realtime TURN adapter recognizes this server-side pair:

```bash
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_ID=...
export MCP_HANDOFF_CLOUDFLARE_TURN_KEY_API_TOKEN=...
```

Set both or neither. A partial pair fails closed. Keep the long-lived token in the server secret boundary; never place it in a locator, browser profile, MCP arguments/results, logs, or repository files.

With TURN configured, Handoff keeps `iceTransportPolicy: all`: direct remains preferred and relay is fallback-only. There is no silent cross-vendor relay failover. Provider-neutral relay work is tracked upstream in `mcp-execution-handoff` issue #19.

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

- Same LAN: Handoff should normally select a `direct` path.
- Cellular/external network with TURN configured: Handoff may select `relay` when direct connectivity is unavailable.
- Only the exact dedicated Chrome window is eligible for capture/input. Missing or ambiguous target-window identity fails closed instead of widening to the desktop.
- If another Mac app is frontmost, Handoff resolves and activates the exact captured target window before accepting Human input.

Do not enable raw candidate, SDP, address, framebuffer, or Human-input logging to debug connectivity. The supported diagnostics are intentionally limited to candidate type/count, peer state, selected direct/relay path, and bounded timings.

## 7. Current limitations

- macOS is required for the built-in WebRTC host runtime;
- the iOS software keyboard can still obscure part of the remote target in some layouts;
- adaptive portrait/landscape target sizing and polished explicit reload/reconnect UX are follow-up work in upstream Handoff issue #17;
- do not rely on browser reload to preserve an active lease. If the Human surface cannot recover explicitly, revoke/reissue a fresh takeover rather than trying to bypass generation fencing;
- `thin_takeover` Native remains an optional/experimental sibling pending its separate physical acceptance.

## 8. Troubleshooting

### Helper exits with a permission failure

Grant Screen Recording and Accessibility to the terminal/service/launcher that runs Maps/Handoff, then fully restart that process. Handoff preflights both permissions and fails closed before Human authority starts.

### Locator opens but asks for operator authorization

Expected on a protected public origin. Operator authorization protects the Handoff surface; it is not Google authentication.

### Works on Wi-Fi but not cellular

Confirm both Handoff TURN variables are present in the server process and that the reviewed HTTPS operator origin is reachable. Do not copy TURN secrets into Maps configuration or the browser.

### Safari reload loses control

Do not weaken one-client/generation fencing. Use the supported explicit reconnect path when available; otherwise cancel/revoke and request a fresh locator. Mobile reload UX is being hardened upstream.

### Video is visible but input targets the wrong app

Current target-process mode should fail closed unless the exact captured window can be resolved and activated. Treat any contrary behavior as a security bug; do not add desktop-wide input fallback.

See [Troubleshooting](troubleshooting.md), [V5 authenticated workflows](v5-authenticated-workflows.md), and the pinned Handoff documentation for deeper architecture/security details.
