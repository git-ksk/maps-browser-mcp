# Execution Handoff V3（日本語）

[English](execution-handoff-v3.md)

> この文書は **Execution Handoff subsystemの切り出しと責務分離** を記録するもので、repository内のMaps V1〜V4 feature labelとは別軸です。現在のconsumer-facing Browser Handoff APIは `BrowserHandoffAdapter` で、旧revisionのlow-level broker compositionは歴史的説明です。

generic Execution Handoff runtimeは `git-ksk/mcp-execution-handoff` へ切り出しました。`maps-browser-mcp` はMaps固有 `browser.maps` adapterとしてfirst real consumerを維持します。

## 責務分離

upstreamが提供するのは再利用可能なcontrol planeだけです。

- Agent/Human authorityの排他制御
- resource epochとstale-state fencing
- resume policy
- generic adapter contract
- principal + invocation + canonical args ownership binding
- `reissue_and_revalidate` のみを許すsigned durable checkpoint metadata
- MCP MRTR `input_required` requestState helper
- locator-only URL、short-lived capability、one-client lease、memory-only client binding、`no-store` / `no-referrer`、nonce-bound CSP assetを持つoptional browser takeover transport

このrepositoryにはMaps固有処理を残します。

- `MapsAction` / `MapsViewState`
- Google Maps URL compilation / semantic state
- Google intervention surfaceのexplicit classification
- Maps固有postcondition verification
- Chrome/CDP executionと許可takeover input
- stale semantic action向けMaps固有guidance
- Human takeover完了を別action approvalにしないためのseparate exact-action approval primitive

upstream public core contractへMaps URL、Google hostname、provider、CDP、Maps action typeは持ち込みません。

## 維持するsecurity invariant

- originating authenticated principalをexact tool name / canonical args digest / resume strategyと一緒にhandoff ownerへbindする
- 新規interventionのownerは別serialized browser operationが観測する前に確定する
- fresh `awaiting_human` を過ぎたmissing ownerを後からrebindしない
- Human/Agent authorityは同時に成立しない
- Human completion後、verification前にresource epochを進める
- stale requestState / stale epoch / stale capability / cross-principal reuseはfail closed
- takeover leaseはremote client 1つだけで、reload/new tab/new deviceのfresh memory bindingから暗黙reclaimしない
- takeover locatorへcapability secretを含めない
- `Done` はremote controlをrevokeするだけでaction approvalを作らない
- credential / cookie / OTP/MFA / CAPTCHA response / payment data / raw browser content / raw action argsをMCP handoff stateやdurable checkpointへ入れない
- state-changing semantic operationは必要に応じてfresh semantic reissueを要求し、Human intervention後にsilent replayしない
- CAPTCHA/challenge solving、anti-bot bypass、stealth/fingerprint spoofing、proxy rotation、raw CDP、arbitrary browser navigationは追加しない

## Durable recovery

Maps durabilityは引き続きopt-inです。

```text
MAPS_HANDOFF_CHECKPOINT_FILE=/absolute/private/path/handoff-checkpoint.json
MAPS_HANDOFF_CHECKPOINT_KEY=<32 random bytes encoded as canonical base64url>
MAPS_HANDOFF_CHECKPOINT_TTL_SECONDS=900
```

checkpointはbounded control-plane metadataだけを保存します。browser、requestState、credential、challenge answer、takeover capability、raw tool argsはserializeしません。

restart後のrecoveryはmarkerだけです。同じlogical principalが同じvalidated tool invocationをreissueし、digest一致時だけmarkerをconsumeできます。その後はcurrent validated inputから実行し直します。old Agent/Human authority、DOM/semantic state、remote capabilityはdiskから復元しません。

## Browser takeoverはoptional

現在のcanonical Maps WebRTC pathはupstream `BrowserHandoffAdapter` をconsumeします。Mapsが渡すのはdomain intervention/principal binding、exact normal-browser PID（またはreview済みexact window）、明示的Human input policyです。Locator/session lifecycle、WebRTC runtime/signaling、direct-first/TURN transport、exact-window binding、reconnect generation fencing、completion/revoke、bounded transport diagnosticsはHandoffが所有します。WebRTC runtimeがmissing/unusableなら明示的にfailし、canonical adapterからHTTP screenshot pollingへsilent fallbackしません。

`TakeoverBroker` はHandoff内部のlow-level primitive/compatibility APIとして残りますが、Mapsのconsumer compositionではありません。Google surfaceのintervention eligibility、browser/profile/auth semantics、Human後のfresh verificationは引き続きMapsが所有します。

authenticated pageはmemory-only remote-client bindingを1つ使います。同一origin bootstrapで返すshort-lived capabilityはsession + intervention + epoch + principal + client binding + expiryへbindされます。public locator自体のquery/hashにはcapabilityを含めません。

## Approvalは別系統

Human takeoverはHumanが一時的にexecution inputを所有する意味だけで、後続side effectの承認ではありません。

```text
CAPTCHA完了 != purchase承認
sign-in完了 != delete承認
MFA完了 != message承認
```

`maps-browser-mcp` のexact-action approval primitiveはupstream handoff runtimeから分離したまま残します。generic upstreamはHuman completionとapproval APIを結合しません。将来consequential actionを持つconsumerは、exact final actionとcurrent stateへbindした独立のexplicit approval mechanismを持つ必要があります。

## Two-adapter extraction status

two-real-consumer extraction gateは完了済みです。

1. `maps-browser-mcp` はconsumer-localなWebRTC broker/runtime compositionから `BrowserHandoffAdapter` へ移行済み
2. `japan-cinema-browser-mcp` は独立した2つ目のbrowser MCPとして同じadapterを直接consumeし、物理iPhone Safari/TURN acceptanceまで完了

`mcp-execution-handoff` はformal upstreamとなり、**v0.1.0 source release** も作成済みです。Consumerは引き続きimmutable source pinを使用し、npm publishは意図的に無効のままです。

## Physical mobile verification status

canonical Browser Handoff pathはshared Handoff adapter上で物理iPhone Safariのdirectとcellular/TURN relay acceptanceを通過済みです。Mapsではaccepted normal-browser boundary上のreal Human-only Google sign-in recoveryも完了しています。残るMaps固有follow-up（例: #135 post-Done checkpoint/restore、#134 keyboard/CJK polish）はより狭いlifecycle/UX課題で、reusable Browser Handoff切り出し自体のblockerではありません。

通常CIでCAPTCHA/sign-in challengeを意図的に発生させません。Manual verificationではsame-principal access、cross-principal reject、one-client lease、Human-only authority、`Done != approval`、post-Human verification、stale generation/epoch/capability reject、secret-free loggingを引き続き確認します。challengeをテスト目的で意図的に発生・回避しません。
