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
| **Handoff V3** | implemented, opt-in durability | generic adapter contract, live Maps durable control-plane checkpoint, exact-action approval separation, bounded audit metadata |

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
    |-- secret-safe audit metadata
    |
    +---- adapter: browser.maps   (real + live checkpoint integration)
    +---- adapter: desktop.mock   (deterministic contract test)
    +---- adapter: terminal.mock  (deterministic contract test)
```

The core never exposes CDP or another adapter-native protocol. A future desktop, terminal, cloud-console, or device adapter implements the same control-plane contract while keeping its native execution channel behind the adapter.

## Exclusive remote client lease

Authenticated identity and remote-control concurrency are separate boundaries. The same authenticated principal may own the Human intervention, but one intervention/resource epoch permits only **one active remote takeover client**.

The authenticated takeover page creates a random client binding with Web Crypto and keeps it only in page memory. The first same-origin bootstrap atomically claims the remote-client lease. Reloading the page or opening the same locator in another device/tab creates a different binding and therefore cannot reclaim the active takeover session, even for the same authenticated principal. If the active page is lost, return to MCP and start a fresh Human round rather than transferring the lease implicitly.

The short-lived takeover capability is HMAC-bound to the session locator, intervention id, resource epoch, principal binding, client binding, and expiry. Frame/input/done requests must present both the capability and the matching client binding. A resource-epoch change creates a new takeover session and therefore a fresh client lease.

V3 intentionally does not provide a hidden client-transfer operation. The client binding is a concurrency lease, not user authentication; the authenticated principal remains the primary identity boundary.

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

The live Maps handoff writes the checkpoint only while a Human intervention is active. Verified resume, cancellation, stale intervention state, and non-recoverable verification failure clear it. Graceful process shutdown deliberately does **not** clear an active checkpoint so recovery metadata can survive a restart.

A recovered checkpoint always produces:

```text
recovery = reissue_and_revalidate
```

It never restores stale Agent/Human authority and never silently replays the interrupted action. After restart, the same authenticated principal can reissue the original Maps tool call. If the fresh validated tool arguments produce the same action digest, the checkpoint is consumed and the Maps action runs again from those current validated inputs. Old MRTR request state, DOM/semantic state, remote capability, and browser authority are never restored from disk.

If checkpoint integrity validation fails or the record expired, it is discarded and is not used as authorization. A fresh user-directed tool invocation can still execute normally.

### Opt-in configuration

Durable recovery is disabled by default. Configure both values together:

```text
MAPS_HANDOFF_CHECKPOINT_FILE=/absolute/private/path/handoff-checkpoint.json
MAPS_HANDOFF_CHECKPOINT_KEY=<32 random bytes encoded as canonical base64url>
MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS=900
```

The file path must be absolute. The signing key must remain stable across process restarts and must not be committed or logged. The checkpoint file is written with private filesystem permissions by the checkpoint store.

This means V3 provides **safe durable recovery metadata**, not transparent process-restart continuation. The current live MRTR request-state signing key and browser intervention remain process-local.

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
4. a second remote client for the same principal cannot claim/send input for the same intervention epoch, and reload does not silently transfer the lease;
5. `Done` revokes remote input but does not approve the MCP action;
6. Continue verifies the browser and either resumes safely or returns to a new Human round;
7. stale epoch/capability/request state is rejected;
8. an opt-in checkpoint survives a controlled process restart but only the same principal + same reissued tool-argument digest can consume the recovery marker;
9. no screenshot/log containing accounts, private locations, tokens, browser profiles, checkpoint keys, or credentials is attached to a public issue.

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
