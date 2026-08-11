# Execution handoff

This document describes the internal foundation for handing browser execution authority from the agent to a human and back without implementing CAPTCHA bypass.

## Status

The current implementation is **V1 local human handoff**. When Google Maps presents a CAPTCHA/access challenge, sign-in, consent, or another manual surface during an MCP operation, the server can return MCP `input_required` and ask the user to complete the sensitive step directly in the dedicated Chrome window.

The elicitation never asks for passwords, 2FA codes, CAPTCHA answers, cookies, or other credentials. After the user chooses Continue, the server verifies the browser before returning execution authority to the agent.

V1 does **not** expose a remote takeover URL, live-view UI, credential form, or public CDP endpoint. Authenticated mobile/live-view takeover is a separate future layer.

The implementation is built on these primitives:

- exclusive execution authority,
- intervention metadata inside the browser runtime,
- a resource epoch that invalidates stale semantic state,
- an explicit resume policy for the canonical action,
- HMAC-protected MCP `requestState` bound to the originating tool invocation.

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
      |
      | user chooses Continue
      v
verifying        authority=none, epoch++
      |
      | server verifies allowed Maps surface + no challenge
      v
ready_to_resume  authority=none
      |
      | resume policy is evaluated
      v
agent owns browser again
```

There is never an `agent + human` authority state. While an intervention is active, normal agent CDP access is refused before the runtime touches the browser.

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

The resource epoch advances whenever an intervention starts and again after human control completes. Navigation and semantic page transitions also advance it. Reusable DOM references, candidate indexes, snapshots, and future action approvals must be bound to the epoch that produced them and rejected after the epoch changes.

Human completion is not sufficient by itself. Before the agent can resume, the server verifies that the browser is back on an allowed Google Maps surface and that the known inline challenge indicators are absent.

## Tool resume strategy

The interrupted MCP tool and the canonical browser action are separate concepts. V1 therefore uses two tool-level strategies:

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

## Security boundary

Future takeover transports must preserve these constraints:

- CDP remains loopback-only and is never exposed to the human client or public network.
- Human and agent control are mutually exclusive.
- During human ownership, the agent must not receive DOM, network, screenshot, credential, 2FA, or CAPTCHA-response data.
- A takeover endpoint must authenticate the same user/principal that initiated the workflow. A transferable bearer URL is not sufficient.
- Takeover capability must be short-lived, scoped to one intervention/browser resource, revocable, and auditable without logging secrets.
- Navigation during takeover must not turn the browser into an SSRF pivot toward localhost, private networks, link-local metadata services, `file:` URLs, or other privileged surfaces.
- Human takeover must never become CAPTCHA solving, anti-bot evasion, stealth/fingerprint spoofing, or proxy rotation.

## Remote takeover direction

MRTR now provides the protocol pause/resume layer for local handoff. A future remote/mobile takeover layer should sit behind that state machine rather than replace it.

The next layer needs authenticated identity binding, a short-lived scoped capability, a live-view/input broker that does not expose CDP, network egress restrictions, secret-safe observation controls, and explicit takeover revocation. URL-mode elicitation should only be added once that protected takeover endpoint exists; a transferable pre-authenticated URL is not an acceptable shortcut.

## CI boundary

Normal CI never waits for human takeover and does not intentionally trigger CAPTCHA or sign-in challenges. Deterministic tests cover the authority state machine, request-state binding helpers, and fail-closed boundaries. The manual Live Maps E2E remains a fixed, low-volume compatibility check; a naturally occurring challenge is not something CI should bypass.

## Extraction criteria

This code stays inside `maps-browser-mcp` until it has proven useful in the Maps adapter. A separate OSS should be considered only after at least one additional adapter demonstrates that the following pieces are genuinely generic:

- authority lease/state machine,
- intervention identity binding,
- resource epochs,
- completion verification,
- resume policy,
- action-approval binding,
- audit events,
- MCP MRTR bridge.

The intended future abstraction is an **execution handoff runtime**, not another browser-specific CAPTCHA/takeover library.
