# Execution Handoff V3

> This document versions the **execution-handoff subsystem**, not the Maps V1–V3 feature labels used elsewhere in this repository.

Execution Handoff V3 moves the human-intervention work from a Maps-specific takeover feature toward a reusable control-plane runtime while keeping Maps as the first real adapter.

## Current layers

| Layer | Status | Purpose |
| --- | --- | --- |
| Handoff V1 | implemented | MCP MRTR `input_required`, exclusive Agent/Human authority, resource epoch, safe resume |
| Handoff V2 | implemented | bounded remote/mobile browser takeover with private CDP and short-lived capability |
| Handoff V2.1 | implemented | authenticated MCP principal is bound to MRTR state, takeover session and capability |
| Handoff V2.2 | manual verification pending | end-to-end phone verification through a configured authenticated HTTPS gateway |
| **Handoff V3 core** | implemented | generic adapter contract, durable control-plane checkpoint, exact-action approval separation |

## V3 architecture

```text
MCP / Agent
    |
    v
Execution Handoff V3
    |-- principal binding
    |-- authority / resource epoch
    |-- durable control-plane checkpoint
    |-- exact-action approval envelope
    |
    +---- adapter: browser.maps   (real)
    +---- adapter: desktop.mock   (deterministic contract test)
    +---- adapter: terminal.mock  (deterministic contract test)
```

The core never exposes CDP or another adapter-native protocol. A future desktop, terminal, cloud-console, or device adapter implements the same control-plane contract while keeping its native execution channel behind the adapter.

## Durable recovery is deliberately conservative

V3 can persist a signed checkpoint, but the checkpoint is **not a serialized browser or Agent session**. It contains only bounded control-plane metadata:

- adapter kind,
- intervention id,
- intervention status,
- resource epoch,
- resume policy,
- principal binding,
- optional action digest,
- timestamps and expiry.

It must not contain raw search terms, origins/destinations, browser text, DOM/network data, credentials, cookies, CAPTCHA/2FA responses, approval receipts, or raw action arguments.

A recovered checkpoint always produces:

```text
recovery = reissue_and_revalidate
```

It never restores stale Agent/Human authority and never silently replays the interrupted action. The original action must be reissued under the same authenticated principal and evaluated against current resource state.

This means V3 provides **durable recovery metadata**, not transparent process-restart continuation. The current MRTR request-state signing key and live browser intervention remain process-local.

## Approval is separate from takeover

Human takeover means only that a Human temporarily owns execution input. It does not authorize a later side effect.

For future adapters with irreversible actions, V3 provides an explicit approval envelope bound to:

- canonical final action name and arguments,
- current resource epoch,
- authenticated principal binding,
- expiry,
- single use.

Changing the action arguments, principal, or resource epoch invalidates the approval. An approval receipt is HMAC-protected and can be consumed once.

Therefore:

```text
CAPTCHA solved != purchase approved
sign-in complete != delete approved
MFA complete != message approved
```

Current Maps navigation actions are side-effect-free, so they do not use the approval manager today.

## Adapter extraction rule

`browser.maps` is the first real adapter. The repository also contains deterministic non-browser mock adapters to prove the TypeScript contract is resource-agnostic, but mocks are not evidence that a second production adapter is mature.

Do not extract a separate OSS yet. Consider extraction only after a second real adapter (for example a desktop or terminal integration) demonstrates that these pieces remain generic:

- adapter contract,
- authority/epoch model,
- principal binding,
- checkpoint recovery semantics,
- completion verification,
- approval envelopes,
- audit/control-plane metadata,
- MCP MRTR bridge.

## V2.2 manual mobile verification

The remaining live verification requires a real authenticated HTTPS gateway, a dedicated Chrome session, and a phone. It cannot be proven by normal repository CI.

The manual run should verify a user-directed workflow only:

1. the same authenticated principal starts the MCP action and opens the takeover page;
2. another/unauthenticated principal cannot open or bootstrap the takeover session;
3. the phone can view the bounded frame and send permitted input while Human owns authority;
4. `Done` revokes remote input but does not approve the MCP action;
5. Continue verifies the browser and either resumes safely or returns to a new Human round;
6. stale epoch/capability/request state is rejected;
7. no screenshot/log containing accounts, private locations, tokens, browser profiles, or credentials is attached to a public issue.

Do not deliberately trigger or bypass CAPTCHA during this verification.

## Non-goals

V3 does not add:

- CAPTCHA solving or anti-bot bypass,
- stealth/fingerprint spoofing or proxy rotation,
- public CDP,
- arbitrary browser navigation from the takeover UI,
- DOM/network/cookie export,
- automatic approval of irreversible actions,
- multi-tenant hosting,
- transparent replay after process restart.
