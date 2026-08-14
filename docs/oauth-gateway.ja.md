# Remote MCP向け OAuth Gateway パターン

`maps-browser-mcp` は意図的に bounded / single-user の browser controller として設計されています。OAuthを追加するだけで1つのbrowser/runtime/profileをshared multi-user serviceへ変える設計ではありません。

現在のcore serverにはpluggable HTTP auth-provider contractがあり、認証済みcallerをstable principalとして表現し、Human Takeoverを元のprincipalへbindできます。ただしこれは、OAuth Authorization Serverや公開Resource Server protocol処理をbrowser runtimeの責務にするという意味ではありません。

Remote MCP clientがOAuthを必要とする場合は、OAuth protocol boundaryをbrowser controllerの前段にあるexternal gatewayまたは独立管理するauth adapterへ置きます。

## 推奨構成

```text
Remote MCP client
      |
      | HTTPS + OAuth access token
      v
OAuth対応 MCP gateway / auth adapter
  - Protected Resource Metadata
  - Authorization Server discovery
  - access-token validation
  - admission / principal mapping
      |
      | private / loopback MCP transport
      | + stable single-user principal
      v
maps-browser-mcp
      |
      +-- semantic Maps policy
      +-- principal-bound Human Takeover
      v
専用 Chrome / Chromium profile
```

Gateway / adapterは別service、sidecar、または同じsingle-user deployment boundary内の別processとして実装できます。重要なのは、OAuth protocol、token persistence、consent/account lifecycle、provider固有identity logicをbrowser controlの責務にしないことです。

## MCP Authorization要件はOAuth boundary側で処理する

OAuthで保護されたHTTP MCP endpointでは、公開gateway / adapterがOAuth Resource Server boundaryになります。Frameworkのdefaultをそのまま流用せず、現行のMCP Authorization仕様に従います。

最低限、そのboundaryでは次を扱います。

- OAuth Protected Resource Metadataを公開し、対応するAuthorization Serverを示す
- MCP仕様に従い、`401` responseの`WWW-Authenticate`に`resource_metadata`を含める
- 対応するdiscovery方式でAuthorization Server metadataを公開する
- 対象MCP clientに適したclient registration方式をサポートする
- delegated interactive authorizationではAuthorization Code + PKCEを使う
- OAuthの`resource` parameterを扱い、access tokenを公開MCP resourceへbindする
- MCP requestを受け入れる前にissuer、audience/resource、expiry、必要なauthorizationを検証する
- 公開Authorization endpointはHTTPSに限定する

現行MCP Authorization仕様では、別resource向けtokenの受け入れやpass-throughも禁止されています。公開OAuth tokenは公開MCP resource専用credentialとして扱います。

参照: [MCP Authorization specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## Callerのtokenをbrowser runtimeへpass-throughしない

OAuth boundaryでcallerのaccess tokenを検証した後、そのtokenを変更せずbrowser controllerやdownstream serviceへforwardしないでください。

Private hopでは次のどちらかを使います。

1. `maps-browser-mcp` をloopback / private networkだけでlistenさせ、そのruntimeへ1つのlogical userだけをadmitし、必要ならprivate hop専用credentialを使う
2. externalで認証済みのidentityをcore serverのstable principal contractへ変換する独立管理auth-provider adapterを使い、OAuth protocol処理をMaps/browser codeへ露出しない

Single-user deploymentでは `static-bearer` がprivate hop上の1 logical principalを表現できますが、これはtransport credentialであり、end-user OAuth identityとして説明してはいけません。

この分離によりtoken passthroughを避け、confused-deputy riskを下げ、OAuth credentialをbrowser-control pathから外せます。

## Principal bindingとHuman Takeover

現在の `main` はhandoff ownershipとremote Human Takeoverをauthenticated principalへbindします。これはsecurity invariantであり、multi-user hosting機能ではありません。

公開OAuth boundaryとprivate-hop adapterでは次を維持してください。

- interventionのlifetime中は1つのstable logical principalを維持する
- 別principalがinterventionをreuse / resumeしようとしたらfail closed
- Human authorityがclaimされたactive interventionを別principalへrebindしない
- Takeover page / APIも元のMCP requestと同じlogical-principal boundaryで認証する
- takeover capabilityはshort-livedかつintervention / resource epochへscopeする
- Human TakeoverをCAPTCHA、sign-in、consent、その他challenge policyのbypassに使わない

CAPTCHA、sign-in、consentは引き続きHuman Intervention surfaceです。Agentは停止し、solver / bypass pathはありません。

## Single-user runtime境界を維持する

OAuth認証に成功しても、1つの `maps-browser-mcp` processが無関係な複数userに対してsafeになるわけではありません。

1 processは1つのsemantic browser state、1つのoperation queue、1つの専用Chrome profileを所有します。OAuth boundaryは次のどちらかを強制してください。

- 1 deployment / runtimeにつき1人のauthorized human identity
- authorized userごとに独立した `maps-browser-mcp` runtime / profile

GatewayがOAuth principalを区別できても、無関係なprincipalを1つのbrowser/runtimeへmultiplexしないでください。

## Scopeは必要になるまでMaps protocolへ入れない

Remote client / gatewayがOAuth scopeを使う場合は、そのdeploymentで必要な最小scopeにします。Scope名はdeployment-specificであり、Maps capability自身が解釈する必要がない限りsemantic Maps tool protocolへ追加しません。

Core runtimeはOAuth scopeとは独立してbrowser safety、operation policy、principal ownership、Human Interventionを引き続き強制します。

## Refresh tokenとChatGPT

ChatGPTをRemote MCP clientとしてOAuth接続する場合、現在のOpenAI guidanceではaccess-token expiry後も接続を維持できるよう、OAuth / OpenID Connect providerがrefresh tokenを発行する構成が推奨されています。OIDC providerでは、providerが対応しdiscovery metadataでadvertiseしている場合に `offline_access` を使う方式が案内されています。

OAuth metadataやtool definitionを変更した後は、browser runtimeをdebugする前に必要に応じてChatGPT Appを再作成またはrescanしてください。ChatGPT側に以前scanしたtool definitionやOAuth metadataが残る場合があります。

参照: [ChatGPT のデベロッパーモードと MCP アプリ](https://help.openai.com/ja-jp/articles/12584461)

## Container / Cloud Run型deployment

Single-user containerでも、複数processを同じcontainerにpackageしつつ責務分離できます。

```text
container public port
        |
        v
OAuth gateway / auth-adapter process
        |
        | 127.0.0.1:<private-port>
        v
maps-browser-mcp --http
        |
        v
headless Chromium
```

この構成では次を守ります。

- 公開するのはOAuth-facing public portだけ
- MCP backend portとCDP portはprivateにする
- Chrome profileをinstance / user間で共有しない
- 無関係な2 callerが1つのbrowser runtimeを共有しないようinstance concurrency / scalingを制限する
- sensitiveなOAuth / MCP responseでは `Cache-Control: no-store` を維持する
- Authorization Server / adapter secretをrepositoryへ置かず、deployment platformのsecret機構から注入する

Browser / container側の制約は [Container / headless Linux 日本語版](container.ja.md) も参照してください。

## なぜbuilt-in OAuth providerではなくdocumentationなのか

OAuth providerの選択、user store、consent UI、client registration policy、token persistence、refresh-token lifecycle、account lifecycleはdeployment-specificです。Concrete providerをbrowser controllerへ組み込むとsecurity surfaceが広がり、現在のsingle-user browser boundaryも曖昧になります。

再利用するcore contractはより狭く、stable authenticated principalを受け取り、handoff / takeover stateをそれへbindし、Maps/browser safetyをlocalで強制し、OAuth protocol / token処理をexternal gatewayまたはadapter boundaryへ置く、という形です。
