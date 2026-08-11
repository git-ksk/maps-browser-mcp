# Execution handoff

This document describes the internal foundation for handing browser execution authority from the agent to a human and back without implementing CAPTCHA bypass.

## Status

The current implementation is **V0 infrastructure only**. It does not expose a remote takeover URL, live-view UI, credential form, or new MCP tool. Existing challenge behavior remains fail-closed: CAPTCHA, sign-in, consent, or an unexpected non-Maps surface still stops normal agent control.

V0 adds four primitives that can later support a standards-aligned human-in-the-loop flow:

- exclusive execution authority,
- durable intervention metadata inside the browser runtime,
- a resource epoch that invalidates stale semantic state,
- an explicit resume policy for the canonical action.

## State machine

```text
agent owns browser
      |
      | challenge / sign-in / consent
      v
awaiting_human   authority=none
      |
      | explicit human claim
      v
human_active     authority=human
      |
      | human reports completion
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

## Canonical action and resource epoch

When a challenge interrupts a known Maps action, the runtime stores the canonical `MapsAction` before clearing semantic browser state. Current Maps navigation actions are side-effect-free, so their resume policy is `replay_safe`.

If no trustworthy canonical action exists, the intervention is `never_replay`.

The resource epoch advances whenever an intervention starts and again after human control completes. Navigation and semantic page transitions also advance it. Future adapters must bind any reusable DOM reference, candidate index, snapshot, or action approval to the epoch that produced it and reject stale values after the epoch changes.

Human completion is not sufficient by itself. Before the agent can resume, the server verifies that the browser is back on an allowed Google Maps surface and that the known inline challenge indicators are absent.

## Resume policies

The generic handoff core defines four policies:

| Policy | Meaning |
| --- | --- |
| `replay_safe` | Canonical action may be reconstructed and replayed after verification. |
| `revalidate` | Re-read current state and decide again before execution. |
| `confirm_before_execute` | Require a fresh user approval bound to the final action arguments. |
| `never_replay` | Do not automatically repeat the interrupted action. |

Only `replay_safe` and `never_replay` are currently selected by the Maps adapter. The additional policies exist so the core can later be extracted without assuming every adapter is read-only.

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

## MCP integration direction

The core intentionally does not depend on one MCP interaction model yet. A later adapter can map short interventions to the current MCP multi-round-trip input flow and use the Tasks extension for longer, reconnectable interventions when client/server support is available.

The browser/runtime state remains the source of truth. MCP session identifiers must not be treated as the security principal or as the execution-authority lease by themselves.

## CI boundary

Normal CI must never wait for human takeover and must not intentionally trigger CAPTCHA or sign-in challenges. Deterministic tests cover the authority/state machine and fail-closed boundaries. The manual Live Maps E2E remains a fixed, low-volume compatibility check; a naturally occurring challenge makes that run inconclusive rather than something CI should bypass.

## Extraction criteria

This code should stay inside `maps-browser-mcp` until it has proven useful in the Maps adapter. A separate OSS should be considered only after at least one additional adapter demonstrates that the following pieces are genuinely generic:

- authority lease/state machine,
- intervention identity binding,
- resource epochs,
- completion verification,
- resume policy,
- action-approval binding,
- audit events,
- MCP MRTR/Tasks bridges.

The intended future abstraction is an **execution handoff runtime**, not another browser-specific CAPTCHA/takeover library.
