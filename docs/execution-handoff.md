# Execution handoff

This document describes the internal foundation for handing browser execution authority from the agent to a human and back without implementing CAPTCHA bypass.

## Status

The current implementation includes **V1 MCP MRTR handoff** and an opt-in **V2 remote/mobile human takeover broker**.

When Google Maps presents a CAPTCHA/access challenge, sign-in, consent, or another manual surface during an MCP operation, the server returns MCP `input_required`. By default, the user completes the sensitive step directly in the dedicated Chrome window. When V2 remote takeover is explicitly enabled, the same prompt also contains a phone-friendly takeover session URL served through the configured authenticated HTTPS gateway.

The MCP elicitation never asks for passwords, 2FA codes, CAPTCHA answers, cookies, or other credentials. The URL shown to MCP/LLM contains only a random session locator, not the takeover capability. After the authenticated takeover page loads, its same-origin script bootstraps the short-lived capability and keeps it in page memory for broker API calls.

Remote text input is carried by the takeover broker directly to the local Chrome CDP connection; it is not placed in MCP tool arguments or LLM-visible content. The local broker process necessarily handles that input in memory, so the external HTTPS gateway and the machine running the broker are part of the trusted computing boundary. The broker does not log input payloads.

After human control ends, the user returns to the MCP elicitation and chooses Continue. The remote capability is revoked before verification. The server then verifies the browser before returning execution authority to the agent.

The implementation is built on these primitives:

- exclusive execution authority,
- intervention metadata inside the browser runtime,
- a resource epoch that invalidates stale semantic state,
- an explicit resume policy for the canonical action,
- HMAC-protected MCP `requestState` bound to the originating tool invocation,
- a separate short-lived takeover capability bound to one intervention and resource epoch.

## State machine

```text
agent owns browser
      |
      | challenge / sign-in / consent
      v
awaiting_human   authority=none
      |
      | MCP input_required + explicit human claim
      v
human_active     authority=human
      |  \
      |   \ optional V2 phone broker: frame + bounded input
      |    \ capability scoped to intervention + epoch
      |
      | user closes remote control and chooses Continue
      v
verifying        authority=none, epoch++
      |
      | server verifies allowed Maps surface + no challenge
      | challenge remains -> new epoch-bound human round
      v
ready_to_resume  authority=none
      |
      | resume policy is evaluated
      v
agent owns browser again
```

There is never an `agent + human` authority state. While an intervention is active, normal agent CDP access is refused before the runtime touches the browser. Before verification starts, every remote takeover capability for that intervention is revoked.

## MCP multi-round-trip binding

The handoff uses the MCP 2026-07-28 multi-round-trip `input_required` flow. The client retries the original tool call with the elicitation response and the opaque `requestState` returned by the server.

`requestState` is HMAC-SHA256 protected with a random per-process 256-bit secret and expires after 10 minutes. The signed payload carries no search query, credentials, or page data. It binds the retry to:

- the originating tool name,
- a SHA-256 digest of canonicalized validated tool arguments,
- the active intervention id,
- the resource epoch,
- the resume strategy.

The runtime also records one owner per active intervention. A different or concurrently retried tool cannot adopt an intervention created by another tool invocation.

A per-process key is intentional for the current single-process runtime: if the process restarts, both the browser intervention state and its request-state verification context are invalid and the user must repeat the Maps action.

## Canonical action and resource epoch

When a challenge interrupts a known Maps navigation action, the runtime stores the canonical `MapsAction` before clearing semantic browser state. Current Maps navigation actions are side-effect-free, so their resume policy is `replay_safe`.

If no trustworthy canonical action exists, the intervention is `never_replay`.

The resource epoch advances whenever an intervention starts and again after human control completes. Navigation and semantic page transitions also advance it. Reusable DOM references, candidate indexes, snapshots, takeover capabilities, and future action approvals must be bound to the epoch that produced them and rejected after the epoch changes.

Human completion is not sufficient by itself. Before the agent can resume, the server verifies that the browser is back on an allowed Google Maps surface and that the known inline challenge indicators are absent. If a challenge is still present, authority returns to the human and a new MRTR round receives a takeover session bound to the new epoch.

## Tool resume strategy

The interrupted MCP tool and the canonical browser action are separate concepts. V1/V2 therefore use two tool-level strategies:

| Strategy | Current tools | Behavior after verified human intervention |
| --- | --- | --- |
| `retry_original` | `maps_search`, `maps_directions`, `maps_show`, `maps_streetview` | Re-run the same validated, side-effect-free navigation tool. |
| `require_fresh_semantic_action` | selection, travel-mode change, bounded reads | Refuse to continue from stale semantic state and require a fresh search/directions action. |

This prevents a CAPTCHA completion from implicitly authorizing a click against an old dynamic result index.

## Generic resume policies

The generic handoff core defines four policies:

| Policy | Meaning |
| --- | --- |
| `replay_safe` | Canonical action may be reconstructed and replayed after verification. |
| `revalidate` | Re-read current state and decide again before execution. |
| `confirm_before_execute` | Require a fresh user approval bound to the final action arguments. |
| `never_replay` | Do not automatically repeat the interrupted action. |

A human solving a challenge or completing sign-in is **not** approval for a later irreversible action. If this core is reused for purchasing, deletion, sending, booking, cloud administration, or similar side effects, takeover completion and action approval must remain separate events.

## V2 remote/mobile takeover

Remote takeover is disabled by default. Enabling it requires all of the following:

```bash
MCP_HTTP_HOST=127.0.0.1
MAPS_REMOTE_TAKEOVER=true
MAPS_TAKEOVER_PUBLIC_BASE_URL=https://maps-mcp.example.com
MAPS_TAKEOVER_TTL_SECONDS=300
```

`MAPS_TAKEOVER_PUBLIC_BASE_URL` must be an origin only: no credentials, path, query, or fragment. HTTPS is mandatory except for loopback development. The Node process refuses to enable V2 takeover when `MCP_HTTP_HOST` is non-loopback.

The public origin must be provided by a separately authenticated HTTPS gateway/tunnel/reverse proxy. **Protect `/takeover/*` with the same single-user access policy as the MCP workflow.** The takeover session URL is only a locator and is not a replacement for user authentication. Current V2 relies on the deployment gateway for principal binding; the Node broker does not yet cryptographically compare the gateway principal with the MCP principal. Direct principal binding is a V2.1 follow-up to the optional auth-provider work.

A generated MCP-visible link has this shape:

```text
https://maps-mcp.example.com/takeover/<random-session-id>
```

It contains no takeover capability in the path, query, or fragment. Once that page has passed the external gateway authentication, its same-origin script calls:

```text
GET /takeover/api/bootstrap/<random-session-id>
```

The bootstrap endpoint accepts only a browser request marked `Sec-Fetch-Site: same-origin`. It returns the short-lived capability to the page, which keeps it in memory and sends it only in the `Authorization: Takeover ...` header for later same-origin broker API requests. No CORS access is enabled. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

The capability is HMAC-derived from a per-process random 256-bit key and is bound to:

- takeover session id,
- intervention id,
- resource epoch,
- absolute expiry.

The server does not persist the raw capability. A new epoch creates a new takeover session and revokes the previous intervention capability. The default expiry is five minutes and is configurable only from 60 to 600 seconds.

### Remote control surface

The phone UI intentionally exposes only:

- periodic JPEG screenshots of the current viewport,
- tap,
- bounded vertical scroll,
- text insertion into the currently focused field,
- a strict key allowlist: Enter, Tab, Escape, Backspace, and arrow keys,
- Done, which revokes only the remote capability.

It does **not** expose:

- a browser address bar or arbitrary navigation API,
- raw CDP,
- DOM or accessibility-tree dumps,
- network requests/responses,
- cookies or browser storage,
- shell/terminal access,
- CAPTCHA solving or anti-bot bypass.

Every frame and input operation re-checks that the exact intervention id and resource epoch still own `human_active` authority. It also re-checks the current top-level surface. Remote control is allowed only on the normal Maps surface, recognized Google challenge URLs, `accounts.google.com`, and `consent.google.com`. Leaving those surfaces causes remote input to fail closed.

`Done` does not transition the MCP action to success and does not constitute approval. It only kills the phone capability. The user must still return to MCP and choose Continue, after which the server revokes any remaining capability and runs verification.

## Security boundary

V2 preserves these constraints:

- CDP remains local to the dedicated browser runtime and is never exposed to the human client or public network.
- Human and agent control are mutually exclusive.
- The agent/LLM does not receive DOM, network, screenshot, credential, 2FA, CAPTCHA-response data, or the takeover capability from the takeover path.
- The authenticated HTTPS gateway is required to bind the takeover page to the intended single user; a session locator by itself is not an acceptable authentication boundary.
- Takeover capability is short-lived, scoped to one intervention/resource epoch, revocable, and never written to application logs or MCP content.
- The broker exposes no arbitrary navigation primitive, reducing the risk of using takeover as an SSRF pivot toward localhost, private networks, link-local metadata services, `file:` URLs, or other privileged surfaces.
- Browser input is accepted only while human authority is active and the current top-level page is one of the explicitly allowed Google intervention surfaces.
- Human takeover never becomes CAPTCHA solving, anti-bot evasion, stealth/fingerprint spoofing, or proxy rotation.

A remote takeover deployment still has a trusted path: the phone, authenticated HTTPS gateway, local broker process, and dedicated Chrome session. Text typed into the phone UI is visible to those endpoints as needed to relay it, although it is not included in MCP/LLM content and the broker does not log it. Use a gateway and host you control.

## V2.1 direction

The next security layer is direct identity binding between the MCP authorization principal and the takeover request. The existing optional single-user auth-provider work is the intended integration point. Once rebased onto the current MRTR/runtime state, the broker should require an authenticated principal on every takeover page/API request and compare it to the principal that created the intervention.

Possible later improvements include a lower-latency WebRTC/WebTransport view, stronger device-bound proof, and MCP Tasks integration for long-lived/disconnected interventions. Those are transport improvements; they must not weaken the authority/epoch/resume rules above.

## CI boundary

Normal CI never waits for human takeover and does not intentionally trigger CAPTCHA or sign-in challenges. Deterministic tests cover the authority state machine, request-state binding helpers, takeover capability rotation/expiry/revocation, capability bootstrap, HTTP broker boundaries, and fail-closed configuration. The manual Live Maps E2E remains a fixed, low-volume compatibility check; a naturally occurring challenge is not something CI should bypass.

## Current upstream status

The generic control-plane implementation has been extracted to `git-ksk/mcp-execution-handoff`. Maps-specific URLs/surface classification, postcondition verification, and CDP execution remain in this repository. The Japan Cinema second-adapter validation is complete, the upstream is the formal source of truth, and `v0.1.0` exists as a source release. npm publication remains intentionally disabled; Maps consumes an immutable source-release commit.
