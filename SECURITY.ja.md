# Security Policy（日本語）

[English](SECURITY.md) | 日本語

## Scope

`maps-browser-mcp` はlocal browser sessionを制御します。MCP endpointは単なるlow-risk read-only APIではなく、**browser-control capability** として扱ってください。

デフォルト構成は意図的にlocal-onlyです。

- HTTPはloopbackへbind
- Google Maps navigationはallowlist制御
- Generic browser primitiveをMCP toolとして公開しない
- Visible-state readingはデフォルトOFF
- Browser operationは直列化しrate / queue制限
- V3 readには独立rolling hourly budget
- Operation timeout時はwatchdogがsessionをreset

## 安全なDeployment

`/mcp` をTunnel / Reverse Proxy経由で公開する場合:

1. 可能な限りNode processはloopbackのまま
2. Public HTTPS endpointを認証
3. 許可Host / Originを制限
4. Chrome DevTools portをpublic公開しない
5. 普段使いChrome profileを再利用しない
6. Tokenが漏れた場合は即rotate

Non-loopback bindはadvanced escape hatchです。非loopbackの `MCP_HTTP_HOST` には**両方**必要です。

```text
MCP_ALLOW_NONLOOPBACK=true
MCP_BEARER_TOKEN=<24文字以上>
```

Front proxy認証があっても、直接到達可能なnon-loopback Node portを無認証にはしません。Static Bearer tokenを暗号化されていないnetwork経路へ送らず、外部到達trafficはTLS / HTTPSで保護してください。

本projectが起動するChromeはremote debuggingを `127.0.0.1` へbindします。`MAPS_CDP_PORT` は `MAPS_ALLOW_EXTERNAL_CDP=true` がない限り拒否します。接続先は自分が管理するlocal専用Chrome / Chromiumだけにしてください。

CDPは強力なbrowser accessを提供するため、untrusted networkへ公開してはいけません。

Managed profileではChromeの `DevToolsActivePort` recordについて、数値portだけでなくbrowser WebSocket identityも検証します。古いrecordのport番号が無関係なChromeへ再利用されても誤接続しません。

専用profile内にGoogle Maps page targetが複数ある曖昧な状態では、先頭tabを勝手に選ばず起動を拒否します。

`MAPS_BROWSER_BACKEND=steel` を使う場合、Steel API keyとCDP WebSocketはDevTools endpointと同等のbrowser-control secretとして扱います。server-side限定で、logやMCPへ返しません。Credential-safe Human handoffではexact hosted browser sessionを維持したままautomation attachmentを閉じ、検証済みLive View locatorだけをHumanへ出します。URL credential/query/fragment付きlocatorはbearer/session secretがMCP boundaryを越える可能性があるため拒否します。Steel CAPTCHA solvingは無効で、CAPTCHA、MFA、consent、Passkey/WebAuthnはHuman/provider controlのままbypassしません。

## Runtime Failure Containment

1 processが1 semantic browser stateを管理するため、browser operationは直列化します。`MAPS_MAX_PENDING_ACTIONS` がqueue上限です。

`MAPS_OPERATION_TIMEOUT_MS` がactive operationの上限で、timeout時はqueueが次へ進む前にbrowser / CDP sessionをresetし、stale semantic stateを無効化します。

Watchdogはrecovery mechanismであり、任意third-party codeへの完全なcancellation保証ではありません。Timeoutしたpublic operationは失敗扱いとし、reset後に遅れて返るtask errorは破棄します。

## Single-user Boundary

現在Runtimeはsingle-user / single-session前提です。1 processが1 semantic browser stateと1 operation queueを所有します。

1 instanceをmulti-tenant shared-browser serviceとして公開したり、関係のないユーザー間で1 Chrome profileを共有しないでください。

## Untrusted Content / Prompt Injection

Google Mapsから返るtextは外部のuntrusted dataです。V3 Readerはその属性をresultへmarkします。

MCP clientはplace name、label、description等を、追加tool callやpolicy変更の命令として解釈してはいけません。

Server自身もMaps content中のinstructionを実行せず、任意JavaScript実行toolをMCP clientへ公開しません。

## Sensitive Data

Bug Report、log、commit、screenshotへ以下を含めないでください。

- browser profile / cookie
- Tunnel credential
- Bearer token
- Authorization header
- hosted-browser API key / CDP WebSocket URL
- MFA/OTP value、passkey material、challenge answer
- private location history
- 個人email address
- その他accountを特定できる情報

Repositoryは一般的なenvironment / profile / runtime fileをignoreしますが、公開前にstaged changeを必ず確認してください。

専用browser profileはpersistentなので、Chrome通常機能としてcookie、cache、preferences、history等を保持します。Maps datasetではありませんが、sensitive local stateです。専用profileを使い、不要になったら削除してください。

MCP / health / error HTTP responseにはlocation / route情報を含み得るため `Cache-Control: no-store` を付与します。Reverse Proxyもcacheせず、このpolicyを維持または強化してください。

## Dependency / CI / Repository Security

GitHub Actions dependencyはfull commit SHAへ固定しています。Dependabotでnpm / GitHub Actions dependencyを監視します。

CIでは:

- `npm ci --ignore-scripts`
- `npm audit --audit-level=moderate`
- stdio / HTTPのlegacy / modern MCP protocol path
- modern HTTP `Mcp-Method` / `Mcp-Name`
- Linux / macOS / WindowsでGoogle MapsへアクセスしないChrome / CDP startup

を検証します。

CodeQLはJavaScript / TypeScriptを解析します。Repository policy testはAction SHA pinningやLive Maps E2E manual-onlyなどsource-controlled release invariantも守ります。

`main` はprotected branchです。Required CI / CodeQL checkはadministratorにも適用し、force push / branch deletionを禁止、linear history必須、review conversation resolution必須です。

これらGitHub settingはsource code外なので、[Release Checklist 日本語版](docs/release.ja.md) に従って定期確認してください。

## Vulnerability Reporting

**GitHub Private Vulnerability Reportingはこのrepositoryで有効です。** Security reportはrepositoryのprivate vulnerability reporting / Security Advisory flowを使ってください。

Public Issueへsecret、exploit詳細、private location、browser profile、credentialを投稿しないでください。

GitHub側障害等でprivate reportingが一時利用できない場合、private contactが必要であることだけを示す最小public Issueを作成し、exploit詳細やsecretは書かないでください。

## Supported Versions

現在pre-1.0であり、長期backportは約束しません。

| Version | Security support |
| --- | --- |
| `0.2.0` | 現在のstable releaseとしてsupport |
| `0.1.1` | routine backportなし |
| `0.1.0` | routine backportなし |
| `main` | development branch。fixはまずここへ入る |

Security fixは最新 `main` で開発します。Supported stable releaseへ影響する場合、既存tagを書き換えず新しいpatch releaseとして公開します。
