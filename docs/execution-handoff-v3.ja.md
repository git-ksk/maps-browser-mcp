# Execution Handoff V3（日本語）

[English](execution-handoff-v3.md)

> ここでいうV3は **Execution Handoff subsystemのversion** で、repository内のMaps V1〜V4 feature labelとは別軸です。

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

upstream `TakeoverBroker` はtransport-onlyで、`{ id, epoch }`、明示的なnon-secret principal binding、Maps browser adapterだけを受け取ります。どのpageをHuman takeover対象にするか、各browser operationをactive intervention/epochに照らして許可するかはMaps runtime側の責務です。

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

two-real-adapter extraction gateは完了済みです。

1. `maps-browser-mcp` の `browser.maps` がgreen
2. second real adapterの `japan-cinema-browser-mcp` もgreen

`mcp-execution-handoff` はformal upstreamとなり、**v0.1.0 source release** も作成済みです。Consumerは引き続きimmutable source pinを使用し、npm publishは意図的に無効のままです。

## V2.2 manual mobile verification

live phone verificationにはauthenticated HTTPS gateway、dedicated Chrome session、phoneが必要です。通常CIでCAPTCHA/sign-in challengeを意図的に発生させません。

manual flowではsame-principal access、cross-principal reject、one-client lease、reload reclaim reject、Human-only authority、`Done != approval`、post-Human verification、stale epoch/capability/requestState reject、secret-free loggingを確認します。challengeをテスト目的で意図的に発生・回避しません。
