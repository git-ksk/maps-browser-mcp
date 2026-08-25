# Execution Handoff V3

[日本語](execution-handoff-v3.ja.md)

> This document records the **Execution Handoff subsystem extraction and responsibility split**, not the Maps V1–V4 feature labels used elsewhere in this repository. The current consumer-facing Browser Handoff API is `BrowserHandoffAdapter`; low-level broker composition described in older revisions is historical.

The generic Execution Handoff runtime is now extracted to `git-ksk/mcp-execution-handoff`. `maps-browser-mcp` remains the first real consumer through the Maps-specific `browser.maps` adapter.

## Responsibility split

The upstream provides only the reusable control plane:

- exclusive Agent/Human authority,
- resource epochs and stale-state fencing,
- resume policy,
- generic adapter contract,
- principal + invocation + canonical-arguments ownership binding,
- signed durable checkpoint metadata with `reissue_and_revalidate` recovery,
- MCP MRTR `input_required` request-state helpers,
- optional browser-takeover transport with locator-only URLs, short-lived capabilities, one-client leases, memory-only client binding, `no-store` / `no-referrer`, and nonce-bound CSP assets.

This repository keeps all Maps-specific behavior:

- `MapsAction` / `MapsViewState`,
- Google Maps URL compilation and semantic-state handling,
- explicit Google intervention-surface classification,
- Maps-specific postcondition verification,
- Chrome/CDP execution and allowed takeover inputs,
- Maps-specific stale semantic-action guidance,
- the separate exact-action approval primitive used to preserve the rule that takeover completion is never approval for another action.

The upstream has no Maps URL, Google hostname, provider, CDP, or Maps action type in its public core contract.

## Security invariants preserved by the consumer

- the originating authenticated principal owns the handoff together with exact tool name, canonical argument digest, and resume strategy;
- ownership is established before another serialized browser operation can observe the new intervention;
- a missing owner cannot be rebound after the fresh `awaiting_human` state;
- Human and Agent authority are mutually exclusive;
- Human completion advances the resource epoch before verification;
- stale requestState, stale resource epoch, stale takeover capability, and cross-principal reuse fail closed;
- one remote client owns a takeover lease; reload/new-tab/new-device state with a fresh memory binding cannot reclaim it implicitly;
- the takeover locator contains no capability secret;
- `Done` revokes remote control only and never creates action approval;
- credentials, cookies, OTP/MFA values, CAPTCHA responses, payment data, raw browser content, and raw action arguments are excluded from MCP handoff state and durable checkpoints;
- state-changing semantic operations use fresh semantic reissue where required and are not silently replayed after Human intervention;
- CAPTCHA/challenge solving, anti-bot bypass, stealth/fingerprint spoofing, proxy rotation, raw CDP exposure, and arbitrary browser navigation remain out of scope.

## Durable recovery

Maps durability remains opt-in:

```text
MAPS_HANDOFF_CHECKPOINT_FILE=/absolute/private/path/handoff-checkpoint.json
MAPS_HANDOFF_CHECKPOINT_KEY=<32 random bytes encoded as canonical base64url>
MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS=900
```

The checkpoint contains bounded control-plane metadata only. It does not serialize the browser, requestState, credentials, challenge answers, takeover capabilities, or raw tool arguments.

After restart, recovery is only a marker. The same logical principal must reissue the same validated tool invocation; the matching digest may consume the marker, then execution starts again from current validated input. Old Agent/Human authority, DOM/semantic state, and remote capability are never restored from disk.

## Browser takeover remains optional

The canonical Maps WebRTC path now consumes upstream `BrowserHandoffAdapter`. Maps supplies its domain intervention/principal binding, the exact normal-browser PID (or reviewed exact window), and an explicit Human input policy. Handoff owns locator/session lifecycle, WebRTC runtime/signaling, direct-first/TURN transport, exact-window binding, reconnect generation fencing, completion/revoke, and bounded transport diagnostics. Missing or unusable WebRTC runtime state fails explicitly; the canonical adapter does not silently fall back to HTTP screenshot polling.

`TakeoverBroker` remains a low-level Handoff primitive/compatibility API and is no longer consumer composition in Maps. Maps still decides whether the current Google surface is eligible for intervention, owns browser/profile/auth semantics, and performs fresh post-Human verification.

The authenticated page uses one memory-only remote-client binding. Same-origin bootstrap returns a short-lived capability bound to session + intervention + epoch + principal + client binding + expiry. The public locator itself has no capability in its query string or fragment.

## Approval remains separate

Human takeover means only that a Human temporarily owns execution input. It does not authorize a later side effect.

```text
CAPTCHA complete != purchase approved
sign-in complete != delete approved
MFA complete != message approved
```

`maps-browser-mcp` keeps its exact-action approval primitive separate from the upstream handoff runtime. The generic upstream intentionally does not couple an approval API to Human completion. A future consequential-action consumer must provide an independently explicit approval mechanism bound to its exact final action and current state.

## Two-adapter extraction status

The two-real-consumer extraction gate is complete:

1. `maps-browser-mcp` migrated its WebRTC takeover from consumer-local broker/runtime composition to `BrowserHandoffAdapter`, and
2. `japan-cinema-browser-mcp` consumes the same adapter directly as an independent second browser MCP, including physical iPhone Safari/TURN acceptance.

`mcp-execution-handoff` is now the formal upstream and has a versioned **v0.1.0 source release**. Consumers still use immutable source pins; npm publication remains intentionally disabled.

## Physical mobile verification status

The canonical Browser Handoff path has passed physical iPhone Safari direct and cellular/TURN relay acceptance on the shared Handoff adapter. Maps additionally passed real Human-only Google sign-in recovery on the accepted normal-browser boundary. Remaining Maps-specific follow-ups are narrower lifecycle/UX work tracked separately (for example #135 post-Done checkpoint/restore and #134 keyboard/CJK polish), not blockers for the reusable Browser Handoff extraction itself.

Normal CI does not intentionally trigger CAPTCHA/sign-in challenges. Manual verification continues to check same-principal access, cross-principal rejection, one-client lease behavior, Human-only input authority, `Done != approval`, safe post-Human verification, stale generation/epoch/capability rejection, and secret-free logging. Do not deliberately trigger or bypass a challenge for this test.
