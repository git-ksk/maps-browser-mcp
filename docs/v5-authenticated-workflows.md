# V5 authenticated workflows — design baseline

V5 is the first milestone that may intentionally use Google Maps Web state which exists only after the user signs in. This document remains the design baseline and implementation record for authenticated semantics. V5-A and V5-B are implemented behind the explicit V5 opt-in, and V5-C adds the first bounded mutation only after the live-observation and deterministic safety gates described below.

V5 should preserve the project rule that the agent controls only bounded Maps-specific semantic operations. Authentication, account selection, consent, MFA/OTP, CAPTCHA, and other sensitive account steps remain Human authority.

## Scope definition

V5 is defined as:

> **Bounded authenticated Google Maps Web workflows, starting with read-oriented and low-consequence reversible account state.**

The first implementation should not attempt broad coverage of every signed-in Maps feature. It should prove that account-backed state can be used without turning the server into a general account/browser automation surface.

## Current product evidence

Google's current desktop Maps documentation supports these V5-relevant observations:

- signed-in users can save places and use saved lists;
- saved places/lists are account-backed and available across signed-in devices;
- Maps history can be viewed/managed from the signed-in desktop experience, but it is account activity rather than ordinary place state;
- desktop directions can be sent to a signed-in phone/tablet, subject to account/device requirements and current UI availability;
- Google Maps Timeline is **not available in Maps on a computer**; current Timeline data is device-based and should not be treated as a Maps Web workflow.

References:

- https://support.google.com/maps/answer/3184808?co=GENIE.Platform%3DDesktop&hl=en
- https://support.google.com/maps/answer/7280933?co=GENIE.Platform%3DDesktop&hl=en-en
- https://support.google.com/maps/answer/3137804
- https://support.google.com/maps/answer/7101463?co=GENIE.Platform%3DDesktop&hl=en
- https://support.google.com/maps/answer/6258979?co=GENIE.Platform%3DDesktop&hl=en

These references establish product scope only. Every UI-dependent semantic target still requires fresh live observation before implementation.

## Authentication boundary

### Human signs in; MCP never does

The MCP surface must never accept or return:

- Google passwords,
- MFA/OTP values,
- passkeys or security-key material,
- CAPTCHA/challenge answers,
- Google cookies or session tokens,
- OAuth tokens,
- recovery codes, or
- copied account-page content used as a credential substitute.

If an authenticated workflow reaches sign-in, consent, account selection, MFA, CAPTCHA, or another challenge, execution stops at the existing Execution Handoff boundary. The Human completes the sensitive step directly in the dedicated browser or through the separately authenticated Human takeover path.

`Done` or `Continue` after Human control means only that the Human step may be verified. It is not approval for a later save, send, delete, share, or other account mutation.

### Fresh reissue after Human Intervention

Authenticated state-changing operations use `require_fresh_semantic_action` semantics:

1. the original semantic action encounters a Human-only surface;
2. Agent authority is removed;
3. the Human completes sign-in/consent/account selection;
4. the server verifies that the browser returned to an allowed Maps surface;
5. the previous semantic state/resource epoch is invalidated;
6. the MCP client must reissue the intended authenticated action;
7. the operation re-reads and revalidates current place/list/route identity immediately before acting.

No account mutation is silently replayed after Human Intervention.

## Principal and browser-session isolation

The MCP authorization principal and the Google Account signed into the dedicated Chrome profile are different identities. Existing Execution Handoff principal binding prevents another MCP principal from taking over the same intervention, but it does **not** cryptographically prove which Google Account is active in Maps.

That distinction becomes security-relevant as soon as the browser contains account-backed state.

### Initial V5 deployment gate

Until the project has per-principal browser/profile isolation, authenticated V5 tools should be enabled only for a single-user deployment/session model:

- local stdio with one user, or
- a remote deployment with one stable authenticated MCP principal and one dedicated Maps browser profile.

A server that can concurrently serve multiple unrelated MCP principals must not expose V5 account-backed tools through one shared Chrome profile.

### Account identity exposure

The MCP response should not expose email addresses, account names, profile photos, account IDs, cookies, or other Google-account identifiers merely to prove that sign-in succeeded.

If implementation needs an account-continuity check, prefer a local opaque/HMAC binding or a coarse `signed_in | signed_out | unknown` semantic state. Any stronger account identity mechanism requires a separate privacy/security design review and live evidence that it can be implemented without returning raw identity data to the model.


### Credential-safe Human sign-in ceremony

When `MAPS_CREDENTIAL_SAFE_HANDOFF=true` is enabled, `maps_request_human_sign_in` provides an explicit Human-only entry path from `signed_out`. The tool never clicks Sign in, selects a Google Account, enters credentials/MFA on behalf of the Human, reads account identity, or exports cookies/tokens. Instead it enters the existing Execution Handoff boundary, fully stops the server-owned CDP Chrome, and opens the same dedicated non-default profile in normal Chrome without remote-debugging/automation attachment.

Two transports are available. The default `MAPS_CREDENTIAL_SAFE_TRANSPORT=external` points the Human at an existing OS-level remote-access surface. `cua_takeover` reuses the authenticated short-lived browser Takeover UI, but swaps its backend from CDP to a local Cua Driver native capture/input bridge. That bridge is bound to the exact dedicated normal-Chrome PID and exactly one visible window; it requests a maximally bounded screenshot state and exposes only bring-to-front, PID-filtered window discovery, frame capture, tap, scroll, text and key delivery. Other Cua tools are rejected by a fixed runtime allowlist. Human-entered text is not returned through the northbound Maps MCP, model context, process argv, or repository logging; for this transport it is transiently carried from the Takeover broker to the local `cua-driver mcp` process over stdin. `cua_takeover` additionally requires authenticated Remote Takeover to be enabled.

Human completion is not proof that a particular Google Account is active. The normal browser and local Cua transport are revoked before automation resumes, the dedicated profile must be released, the CDP runtime is relaunched fresh, and the client must call `maps_read_authenticated_readiness` again. Pre-auth semantic state is never replayed. No third-party remote-desktop product is required by `cua_takeover`; `external` remains available for deployments that prefer one.

Multi-account/account-switching UI is Human-only in the initial V5 design. The agent does not select Google Accounts.

## Proposed V5 slices

### V5-A live readiness evidence (2026-08-18)

Fresh observation of the dedicated server-owned Chrome profile confirmed both signed-out and signed-in Maps states without returning account identity to MCP. The readiness probe uses only coarse Maps controls.

- signed out: a visible Sign in surface is present and no Google Account control is present
- signed in: the Sign in surface is absent and a Google Account control is present
- contradictory, incomplete, or non-Maps states fail closed to `unknown`

`maps_read_authenticated_readiness` is exposed only when the V5 opt-in is enabled and returns only `signed_in | signed_out | unknown`. It does not read or return email, account name, profile photo, account ID, cookies, or tokens.

### V5-A — authenticated-session foundation

Goal: prove the authentication boundary without account mutation.

Design work:

- add an explicit V5 opt-in, disabled by default;
- define a coarse authenticated Maps readiness state (`signed_in | signed_out | unknown`) only if a stable live semantic target can be observed;
- keep account selection and sign-in Human-only;
- require single-user browser/profile isolation as described above;
- invalidate pre-auth semantic state after Human Intervention;
- ensure no credential/account identifier enters MCP output, execution audit logs, durable handoff checkpoints, or error messages;
- add deterministic tests for signed-out, Human Intervention, principal mismatch, stale epoch/requestState, and fresh reissue.

Completion gate:

- no authenticated mutation tools yet;
- no raw account identity in MCP;
- Human sign-in can be verified only as coarse browser readiness;
- post-Human action replay remains impossible.

### V5-B — bounded saved-state reads

Goal: read only the minimum account state needed to support a future safe Save workflow.

Candidate semantic operations:

- `maps_read_place_save_state(expectedLabel)` — for the currently selected place, return only bounded existing save-list choices/membership required for a user-directed Save decision;
- optionally `maps_read_saved_lists()` — return a bounded list of existing list identities, without reading all places contained in those lists.

Required constraints:

- Interactive Assist + V5 opt-in required;
- selected place identity revalidated first;
- list results capped and non-paginating;
- list labels treated as untrusted user/account text;
- duplicate/ambiguous list labels fail closed;
- raw list contents, notes/comments, collaborators, sharing settings, and full Saved-library traversal are out of scope;
- no persistence or dataset construction;
- list names/raw user content are not written to durable audit/checkpoint logs.

Live implementation status (2026-08-18): `maps_read_place_save_state(expectedLabel)` is implemented behind the V5 opt-in. Fresh observation confirmed a bounded `Save to list` menu whose existing-list rows use `role=menuitemradio` with `aria-checked=true|false`. The tool revalidates signed-in readiness and exact place identity, returns at most 10 existing list names plus membership, does not paginate, never selects a row or creates a list, and closes the chooser with Escape. List-name identity is taken from the first stable visible text leaf inside each row; privacy/count metadata is intentionally excluded. Flattened, duplicate, missing, or otherwise ambiguous row structure fails closed. `maps_read_saved_lists()` remains unimplemented because the current workflow does not require Saved-library traversal.

### V5-C — save a place to an existing list

Goal: introduce one low-consequence account mutation with an explicit postcondition.

Initial mutation candidate:

- save the currently selected, revalidated place to **one already-existing list** chosen from a fresh bounded save-state read.

Recommended semantic shape:

```text
maps_search / maps_select_result
  -> maps_read_place_save_state(expectedLabel)
  -> choose one unique returned list identity
  -> maps_save_place_to_list({
       expectedPlaceLabel,
       listIndex,
       expectedListLabel
     })
```

Safety rules:

- no generic text-entry primitive;
- no new-list creation in the first implementation;
- no list rename/description/edit/share operation;
- no place removal/unsave in the first implementation;
- exact active-place identity, resource epoch, list index, and unique expected label are revalidated immediately before the click;
- already-saved is an idempotent success, not an extra toggle;
- success requires an exact visible saved-membership postcondition;
- state change advances the semantic resource epoch;
- sign-in/consent/challenge causes Human Intervention and requires a fresh semantic reissue before any save attempt.

Implementation status (2026-08-18): `maps_save_place_to_list({ expectedPlaceLabel, listIndex, expectedListLabel })` is implemented behind the V5 opt-in and Interactive Assist. Every invocation opens a fresh bounded save chooser, revalidates signed-in readiness, exact selected-place identity, the captured resource epoch, and both list index plus expected list label immediately before the single permitted row action. A target already observed as saved — including a race where it becomes saved immediately before the click — is an idempotent no-toggle success. A real mutation succeeds only after the exact target row is freshly observed with `aria-checked=true`; only then does the semantic resource epoch advance. Missing/reordered/duplicate/flattened list identity, new-list controls, postcondition failure, or stale state fail closed. The tool never creates a list, unsaves a place, traverses Saved-library contents, reads account identity/credentials, or automatically rolls back by removal. Human Intervention completion remains separate from action approval, and this V5-C slice does not add an ActionApproval requirement that the design reserves for V5-D.

Fresh live compatibility observation on 2026-08-18 confirmed the signed-in selected-place Save surface, one bounded `role=menu` chooser, existing-list `role=menuitemradio` rows, and `aria-checked=false` membership without exposing private list labels. A live account mutation was intentionally **BLOCKED** because no uniquely identifiable existing test-purpose list was present. No user list was guessed, no new list was created, and no cleanup/remove semantic was added merely to make the live test convenient.

Why `save` only: removing a saved place may discard associated per-list user state such as comments/notes or otherwise create data-loss semantics that are not safely assumed reversible. Removal therefore needs its own later observation and consequence review.

### V5-D — Send to phone, only after explicit approval integration

Current Google Maps documentation confirms a signed-in desktop route can be sent to a phone/tablet and that the desktop/mobile devices must use the same Google Account. It also documents current route constraints such as no multiple destinations for Send to phone.

Sending crosses devices and produces an external side effect that cannot be silently undone. It therefore does **not** belong in the initial reversible Save slice.

Before implementation:

- integrate the existing `ActionApprovalManager` with a real MCP approval flow;
- bind approval to authenticated MCP principal + resource epoch + exact route + exact selected device target;
- require one-shot consumption and expiry;
- keep Human Intervention completion separate from action approval;
- fresh-reissue/revalidate after any sign-in or consent step;
- expose only bounded currently visible device choices;
- do not allow free-form recipient/email/phone entry;
- do not auto-enable notifications or account/device settings.

The initial route-send surface accepts only a simple single-destination route whose current semantic identity is revalidated immediately before delivery.

Implementation status (2026-08-18): `maps_read_route_send_targets({ expectedOrigin, expectedDestination, expectedRouteIndex, expectedRouteLabel })` and `maps_send_route_to_device(...)` are implemented behind the V5 opt-in + Interactive Assist gate. A selected route now retains only its bounded index + label as ephemeral semantic state. The target-read operation requires signed-in readiness, the exact canonical simple directions request, and the exact selected route identity; it opens the selected-route Send-to-phone dialog, returns at most six visible device labels, excludes email targets and the notification checkbox, does not paginate, and closes the dialog without sending.

The send operation uses the real MCP 2026-07-28 `input_required` / form-elicitation flow. Before an approval record is created, the client must advertise form elicitation support. Approval is bound to the authenticated MCP principal, exact resource epoch, exact route arguments, and exact device index + expected label. The approval requestState carries only bounded control-plane identifiers/digests rather than raw route/device text; the user-facing approval form contains the exact final action so the Human can make an informed choice. Approval is one-shot and expiring, and is consumed immediately before the single exact device click only after a fresh route/device revalidation. Human Intervention completion never creates or satisfies this approval and any Human Intervention requires a fresh semantic reissue.

Fresh live observation on 2026-08-18 confirmed the selected-route generic Send-to-phone control, one visible `role=dialog`, bounded device-button target(s), and a separate notification checkbox. The new read tool returned one current device target in the dedicated signed-in profile and closed the dialog. A real MCP approval round was live-validated through `input_required`, signed requestState, exact `action-approval` elicitation, and an explicit cancel round-trip; cancellation performed no send. After a fresh explicit Human approval, one live route-send invocation was then executed and delivery was independently observed on the target iOS device. The original visible-confirmation probe failed closed because the current Maps `aria-live` confirmation wording/duplication was broader than the initial exact phrase matcher. No automatic retry was performed. The postcondition was hardened from that live observation to capture a bounded pre-click live-region baseline, deduplicate repeated DOM announcements, and accept only one newly-observed exact-device send-semantic announcement. The corrected postcondition is deterministic-test covered; it was intentionally not re-fired as a second external send merely to validate the parser. Multiple notifications were observed across the overall live V5-D session, but earlier Send-surface observations prevent attributing those notifications to one approved invocation; the implementation itself contains exactly one device-click site per approved invocation and never retries delivery after postcondition failure.

“Send place to phone” remains an observation/design gate until the Maps-specific desktop place control and postcondition are freshly re-observed. Google documents the general feature, but V5 does not infer a Maps place workflow from a Search/other surface.

### V5-E — Maps history is a separate privacy/surface gate

Google documents account-backed Maps history on desktop, including searches, directions, viewed places, shared links, and calls. That makes the surface substantially more privacy-sensitive than a single selected place's save membership.

Fresh live observation on 2026-08-18 confirmed three distinct signed-in entry points rather than one reusable Maps dataset:

- the Maps menu exposes a History menu item, but activating it leaves the Maps origin and enters `myactivity.google.com/search-services/history/maps`;
- the Maps menu also exposes a Recent menu item that remains on the Maps surface; however, the current Recent main surface is mutation-adjacent and semantically weak for bounded extraction: the observed structure contained 15 checkboxes plus Delete/More controls and a scrollable container, while the activity entries themselves did not expose stable `listitem`/`row` semantics that could be bound without relying on DOM ordering or private labels;
- `Your data in Maps` is an explicit `myaccount.google.com` account-surface link and is not an implicit extension of the Maps allowlist.

Accordingly **no V5-E history read tool is implemented**. History is currently `BLOCKED: separate account-surface threat model required`. The Maps-local Recent surface remains observation-gated rather than treated as a safe substitute: the project will not parse private activity by DOM position, click through adjacent deletion controls, auto-scroll, paginate, or infer row identity from opaque/internal attributes.

Re-open only if one of these conditions is met:

- a separate account-surface threat model and explicit top-level allowlist review approves a narrowly bounded My Activity read surface; or
- Maps Recent exposes a freshly observed stable semantic row/container model that can be capped without scrolling/pagination and can be parsed without account identity, private-label selectors, generic DOM exposure, or mutation-adjacent ambiguity.

Any reopened slice remains read-only first, requires explicit user invocation, uses a strict small hard cap, performs no bulk export/persistence or deletion, and never reuses history content to silently influence unrelated Maps actions.

### Timeline — removed from the Web roadmap

Timeline is not a current Maps-on-computer capability. It is device-based and unavailable in Maps on desktop according to current Google documentation. Fresh live observation on 2026-08-18 did expose a Maps-menu link targeting `/maps/timeline`, but direct navigation did not remain on a dedicated Timeline route and resolved back to the ordinary Maps surface; no bounded desktop Timeline target was observed.

V5 must not add a browser workaround, mobile automation, internal API access, synced Timeline scraping, or another mechanism to recreate it. Re-open only if Google officially restores a supported desktop Maps surface and a bounded semantic target can be observed.

## Explicitly deferred account mutations

The initial V5 milestone does not implement:

- unsave/remove place,
- create/rename/delete/share lists,
- collaborator management,
- private labels or Home/Work changes,
- Maps history deletion,
- Timeline access,
- account switching,
- notification/account setting changes,
- review posting,
- rating posting,
- map/place edits,
- public photo upload,
- public contribution workflows, or
- any payment/booking/purchase flow.

Review/rating/edit/photo contribution work remains outside the initial V5 direction even if a signed-in UI is technically observable.

## Semantic identity and postcondition rules

Authenticated state does not weaken V4's semantic identity discipline.

Every V5 operation must:

1. start from a current known Maps semantic surface;
2. revalidate the active place/route/account-ready state;
3. read a bounded exact candidate set;
4. reject stale, reordered, missing, duplicate, or ambiguous identities;
5. perform exactly one Maps-specific semantic action;
6. verify an exact postcondition;
7. invalidate/advance resource state on mutation;
8. stop on any sign-in/consent/challenge transition; and
9. never convert a Human-completed intervention into implicit approval.

No generic DOM selector/click/type API is added to MCP to support V5.

## Logging and privacy

Authenticated account state is more sensitive than public Maps UI. V5 logs should remain control-plane oriented.

Allowed examples:

- tool name,
- operation class (`read_account_state`, `reversible_save`, `send_external`),
- outcome/error code,
- duration,
- resource epoch,
- principal binding/hash already used by the control plane,
- candidate/result counts where useful.

Do not log:

- account email/name/ID,
- saved-list names,
- saved place notes/comments,
- device names,
- raw route/place text solely because it came from an authenticated surface,
- credentials/tokens/cookies,
- takeover frames,
- challenge answers, or
- raw action arguments in durable handoff state.

## Testing strategy for a future implementation

### Deterministic tests

Every slice should have fixture-first tests for:

- signed-out / signed-in / unknown state,
- sign-in causing Human Intervention,
- no automatic replay after Human completion,
- principal mismatch,
- stale resource epoch/requestState,
- missing/duplicate/reordered list identity,
- idempotent already-saved state,
- exact save postcondition,
- audit/log redaction,
- no account identifier/credential leakage,
- action-approval principal/epoch/action binding for any send operation.

### Live tests

Authenticated Live Maps E2E must be manual-only and low-frequency.

Use a dedicated test Google Account/profile where practical. Do not intentionally trigger CAPTCHA/MFA/challenges in CI. Do not store credentials in environment variables, fixtures, workflows, logs, or MCP arguments.

Suggested order:

1. Human signs in manually if needed;
2. bounded signed-in readiness observation;
3. bounded save-state read on one known public place;
4. only after the read path is stable, one Save-to-existing-test-list mutation;
5. verify saved membership;
6. cleanup, if needed, is Human/manual until automated removal has its own reviewed semantics.

Do not crawl Saved lists or history merely to increase coverage.

## V5 authenticated-semantic implementation entry gate

Foundational fail-closed configuration/isolation enforcement may land before the first authenticated semantic tool. Implementing or exposing authenticated Maps readiness, saved-state reads, or mutations should not begin until all of these are true:

1. the current Google Maps authenticated UI has been freshly observed for the proposed first slice;
2. a stable signed-in/coarse readiness semantic can be verified without exposing account identity;
3. the single-user/per-principal browser isolation rule is enforced by design/config;
4. the existing-list save chooser has a bounded unique semantic identity and exact postcondition;
5. Human sign-in + fresh reissue behavior is covered by deterministic tests before real account mutation;
6. logs/checkpoints remain secret-free and user-content-minimal;
7. EN/JA docs describe the exact enabled account surface and non-goals;
8. no V5 implementation depends on raw DOM/CDP/AX, generic text entry, internal Maps APIs/XHR, or credential handling.

Until this gate is satisfied, V5 authenticated **semantic tools remain design-only**. The configuration/isolation foundation does not itself authorize account-state reads or mutations.
