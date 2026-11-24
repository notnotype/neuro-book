# 备选方案调研（联网，2026-11-24）

## A1 arctic
- 状态：已弃用。作者 2026-07-29 的博客声明弃用 npm 包 arctic（"I haven't touched the project in nearly a year"），网站与 README 现在只给替代用的示例代码（仓库 /code 目录：authorization_request(-pkce).ts、authorization_code_exchange(-pkce).ts、refresh_request.ts、token_revocation_request.ts）。来源：https://pilcrowonpaper.com/blog/18 ，https://github.com/pilcrowonpaper/arctic/blob/main/README ，https://arcticjs.dev/
- 最新版 3.7.0，发布 2025-05-21；npm 版本时间线与 GitHub releases 一致，无 3.7 之后的发布。来源：https://registry.npmjs.org/arctic ，https://api.github.com/repos/pilcrowonpaper/arctic/releases
- 许可证 MIT。依赖 @oslojs/jwt、@oslojs/crypto、@oslojs/encoding（其中 @oslojs/encoding 之外的 Oslo 包同时被弃用）。来源：https://registry.npmjs.org/arctic/latest ，博客同上
- Google 与 GitHub 都有 provider（v3.7.0 文档 providers/google.md、providers/github.md；Google 只支持机密客户端、带 PKCE）。来源：https://raw.githubusercontent.com/pilcrowonpaper/arctic/v3.7.0/docs/pages/providers/google.md ，.../github.md
- Bun：v3 文档写明基于 Fetch API、runtime-agnostic，Bun 不需要 Web Crypto polyfill。来源：https://raw.githubusercontent.com/pilcrowonpaper/arctic/v3.7.0/docs/pages/index.md
- 结论（事实层面）：不再维护；可参照其 /code 示例自写授权码流程（用 fetch + PKCE），Google/GitHub 的端点自己配。

## A2a oidc-provider（panva/node-oidc-provider）
- 最新版 9.15.1，发布 2026-11-20；许可证 MIT；运行时依赖 koa ^3.3.0、jose ^6.2.17、debug。来源：https://registry.npmjs.org/oidc-provider/latest ，https://raw.githubusercontent.com/panva/node-oidc-provider/main/package.json
- 框架：基于 Koa；文档的挂载示例只有 connect、express、fastify、hapi、koa（用 `provider.callback()` 走 node:http 的 req/res）。没有 Hono 或 Web Standards Request/Response 的挂载说明；在该仓库 README、docs/README.md 与 issues 标题/正文里搜 bun，只命中 4 个无关的依赖升级 PR，没有官方声明支持 Bun。来源：https://raw.githubusercontent.com/panva/node-oidc-provider/main/docs/README.md （Mounting oidc-provider 一节）
- 协议：授权码、PKCE（RFC 7636，可配 pkce.required）、client_secret_basic（clientAuthMethods 默认含）、设备码 RFC 8628（features.deviceFlow，默认关，要自写输入页等 source 函数）、OIDC Discovery、userinfo、动态客户端注册、令牌撤销与内省等。来源：https://raw.githubusercontent.com/panva/node-oidc-provider/main/README.md ，docs/README.md 的 features.deviceFlow、pkce、clientAuthMethods 各节
- 存储：默认是内存适配器，文档写明生产必须自带适配器（Mongo、Redis 例子在 discussions，没有官方的 PostgreSQL 适配器，在 README/docs 内没查到）。来源：docs/README.md 的 adapter 一节
- OpenID 认证：作者声明通过 OpenID Certification：Basic、Implicit、Hybrid、Config、Form Post、3rd Party-Init，Back-Channel Logout、RP-Initiated Logout，FAPI 1.0、FAPI CIBA、FAPI 2.0。来源：https://raw.githubusercontent.com/panva/node-oidc-provider/main/README.md （Certification 一节）
- 安全维护：只支持 v9.x，单人维护者。来源：https://raw.githubusercontent.com/panva/node-oidc-provider/main/SECURITY.md
- 用户登录页、账户体系（findAccount）、同意页都要自己写（交互 URL 由 interactions 配置）。来源：docs/README.md 的 interactions 与 findAccount 各节

## A2b @node-oauth/oauth2-server
- 最新版 5.3.1，发布 2026-10-13（5.3.0 为 2026-04-15）；许可证 MIT；依赖 type-is、basic-auth、@node-oauth/formats；engines node >=16。来源：https://registry.npmjs.org/@node-oauth/oauth2-server/latest ，https://api.github.com/repos/node-oauth/node-oauth2-server/releases
- 框架：官方说明是框架无关，只给 Express 官方适配器（Koa 的不是他们维护）；库有自己的 Request/Response 对象，需要你把框架请求拷进去、再把结果拷出来。来源：https://raw.githubusercontent.com/node-oauth/node-oauth2-server/master/README.md ，https://raw.githubusercontent.com/node-oauth/node-oauth2-server/master/docs/guide/compliance.md
- Web Standards Request/Response：不直接支持。issue #356（用户在 Bun 1.2.15 上报告传 Fetch Request 报 Missing parameter: query）仍是 open；维护者 dhensby 2026-06-16 的结论是需要写适配器（构造函数是同步的、要求已解析好的 body），不是 1:1 兼容。没有官方的 Bun 或 Hono 声明。来源：https://github.com/node-oauth/node-oauth2-server/issues/356
- 协议：授权码、client_credentials、refresh_token、password（文档标为已废弃）、扩展授权类型（可自写 grant，例如设备码，但库本身没有 RFC 8628，在文档 grant-types.md 与 issues 标题里没搜到设备码）；PKCE 自 4.3.0；令牌端点读 Authorization: Basic（依赖 basic-auth，源码 token-handler.js 里处理 WWW-Authenticate: Basic），即支持 client_secret_basic。来源：https://raw.githubusercontent.com/node-oauth/node-oauth2-server/master/docs/guide/grant-types.md ，docs/guide/pkce.md ，lib/handlers/token-handler.js
- OIDC：只做 OAuth 2.0 协议核心；在 README 与文档里没查到 id_token、userinfo、发现文档，需要自己实现；没有 OpenID 认证。（据此判断为自写部分，标注为从文档范围内没查到。）
- 存储：自己实现 model 接口（getClient、saveToken、saveAuthorizationCode 等），库不带存储。来源：https://node-oauthoauth2-server.readthedocs.io/en/master/model/spec.html ，docs/guide/model.md
- 限流、TLS、重定向与发送响应都要自己做。来源：compliance.md

## A2c @openauthjs/openauth（SST OpenAuth，仓库现为 anomalyco/openauth）
- 最新版 0.4.3，npm 与 GitHub release 均为 2025-03-04；仓库 master 最后一次代码提交 2025-04-09（仓库 pushed_at 到 2026-11-14，但最近的提交列表停在 2025-04）；README 自称 beta。来源：https://registry.npmjs.org/@openauthjs/openauth ，https://api.github.com/repos/anomalyco/openauth/releases ，https://api.github.com/repos/anomalyco/openauth/commits
- 许可证：仓库 LICENSE 为 MIT（Copyright SST）；npm 包 package.json 里没有 license 字段（npm latest 的 license 为空）。来源：https://raw.githubusercontent.com/anomalyco/openauth/master/LICENSE ，https://registry.npmjs.org/@openauthjs/openauth/latest
- 框架：本身就是 Hono 应用（issuer() 返回 Hono app），README 声明可部署在 Node.js、Bun、Lambda、Workers；peerDependencies 是 hono ^4 与 arctic ^2.2.2（arctic 已弃用，见 A1）。来源：https://raw.githubusercontent.com/anomalyco/openauth/master/README.md ，packages/openauth/package.json
- 协议（读 packages/openauth/src/issuer.ts）：token 端点只处理 authorization_code、refresh_token、client_credentials 三种 grant_type，没有设备码；授权码 PKCE 有（含 S256），且只在授权请求带了 challenge 时才校验；授权码换令牌时只比对 client_id、redirect_uri，没有校验 client_secret，client_secret_basic 没查到（源码里没有 Basic 处理，client_credentials 也是从表单读 client_secret）；发现文档只有 /.well-known/oauth-authorization-server（字段只有 issuer、authorization_endpoint、token_endpoint、jwks_uri、response_types_supported），有 /userinfo 但读的是自家 subject 属性，不是标准 OIDC claims；客户端是否允许通过 issuer 的 allow 钩子判断，没有客户端注册表。来源：https://raw.githubusercontent.com/anomalyco/openauth/master/packages/openauth/src/issuer.ts
- 存储：KV 接口（get、set、remove、scan），自带 memory、Cloudflare KV、DynamoDB 实现，PostgreSQL 要自己写适配器；README 明说不做用户管理，登录成功后回调里自己建用户。来源：https://raw.githubusercontent.com/anomalyco/openauth/master/packages/openauth/src/storage/storage.ts ，README
- OpenID 认证：没有。

## A2d @jmondi/oauth2-server（ts-oauth2-server）
- 最新版 5.0.0，发布 2026-08-21（此前 rc.5、rc.6 在 2026-08）；许可证 MIT；运行时依赖 ms、jsonwebtoken；要求 node >= 22；h3 是可选 peer。来源：https://registry.npmjs.org/@jmondi/oauth2-server/latest ，https://api.github.com/repos/jasonraimondi/ts-oauth2-server/releases
- 框架：官方适配器有 vanilla（原生 Request/Response）、Express、Fastify、H3；vanilla 适配器文档的示例就是 Hono（requestFromVanilla、responseToVanilla、handleVanillaError）。没有明确写支持 Bun；在 README 与文档里搜 bun 没有命中。来源：https://raw.githubusercontent.com/jasonraimondi/ts-oauth2-server/main/docs/docs/adapters/vanilla.md ，README
- 协议：授权码（默认强制 PKCE，默认拒绝 plain，只收 S256）、client_credentials、refresh、implicit、password，另有 token exchange（RFC 8693）、自定义 grant（CustomGrant 类）；README 的规范列表有 RFC 7009 撤销、7662 内省、9068；设备码 RFC 8628 没有（只有一个 2022 年关闭未合并的 WIP PR #31；README 与文档里没列出）。来源：README，docs/docs/grants/authorization_code.md，https://github.com/jasonraimondi/ts-oauth2-server/pull/31
- 客户端认证：源码 abstract.grant.ts 里读取 Basic 凭据（getBasicAuthCredentials）并回退到表单字段，即支持 client_secret_basic 与 client_secret_post。来源：https://raw.githubusercontent.com/jasonraimondi/ts-oauth2-server/main/src/grants/abstract/abstract.grant.ts
- OIDC：5.0 起内置可选 OIDC 层（ID Token RS256、UserInfo、JWKS、Discovery 文档、getUserClaims 钩子，需自己挂路由）。没有 OpenID 认证；文档只给了用 openid-client 做的冒烟脚本（oidc_conformance）。来源：https://raw.githubusercontent.com/jasonraimondi/ts-oauth2-server/main/docs/docs/oidc/getting_started.md ，docs/docs/endpoints/oidc_conformance.md
- 存储：库不带存储，自己实现 clientRepository、accessTokenRepository、scopeRepository 等接口（文档有 Prisma 示例的说法在本次没核）。来源：docs/docs/authorization_server/configuration.md
- 单人维护项目（仓库 312 星，最近推送 2026-09-02）。来源：https://api.github.com/repos/jasonraimondi/ts-oauth2-server


# B 类：现成身份服务

## B1 Logto
- 语言与许可：TypeScript（Node.js）；许可证 MPL-2.0；最新 release v1.46.0（2026-11-05）。来源：https://api.github.com/repos/logto-io/logto ，https://api.github.com/repos/logto-io/logto/releases/latest
- 数据库：PostgreSQL ^14.0（也要 Node.js ^26 才能 npm init 部署；Docker 镜像另算）。来源：https://docs.logto.io/logto-oss/get-started-with-oss
- 内存：官方写的是「最低推荐硬件」2 vCPU、8 GiB 内存、256 GiB 磁盘；没有查到常驻内存的实测数字（第三方模板站写 512 MB 最低，非官方，未采信）。来源：https://docs.logto.io/logto-oss/get-started-with-oss
- 用户名无邮箱：支持，注册标识可只选 Username（用户名格式可由 username policy 定制）。来源：https://docs.logto.io/end-user-flows/sign-up-and-sign-in/sign-up
- 注册码或邀请码：文档明说 Logto 没有内置邀请流程；可关闭公开注册，再用 Management API 建用户（推荐的邀请链接方式是魔法链接，需邮箱或手机，没核对用户名账号能否用）。在文档范围内没查到「注册时校验自定义注册码」的钩子。来源：https://docs.logto.io/end-user-flows/sign-up-and-sign-in/disable-user-registration
- 设备码：支持（原生应用类型的 Device flow，端点 /oidc/device/auth，grant 为 device_code；v1.38.0 加入）。来源：https://docs.logto.io/quick-starts/device-flow ，https://github.com/logto-io/logto/releases/tag/v1.38.0
- 对外提供 OAuth/OIDC：有「Third-party app (OAuth / OIDC)」功能。来源：https://docs.logto.io/integrate-logto/third-party-applications

## B2 Zitadel
- 语言与许可：Go；仓库许可证 AGPL-3.0（GitHub 识别）；最新 v4.20.5（2026-11-18）。来源：https://api.github.com/repos/zitadel/zitadel ，https://api.github.com/repos/zitadel/zitadel/releases/latest
- 数据库：PostgreSQL（文档写“Prefer PostgreSQL”，CockroachDB 已提供迁移指南）。来源：https://zitadel.com/docs/self-hosting/manage/production
- 内存：官方生产文档写“ZITADEL 本身约需 512MB 内存、不到一个 CPU 核”；数据库另算，约每核 4GB 内存（负载口径为每 100 req/s 一核）；最小高可用集群建议 3 节点各 4 核 16GB，精简后各 4 核 8GB；改密码哈希时建议有 4 核避免 CPU 尖峰。来源：https://zitadel.com/docs/self-hosting/manage/production
- 用户名无邮箱：文档的人类用户资料写“Has an email address”；v2 AddHumanUser 接口里 email 为必填项（username 可选，不填则用邮箱）；论坛有人回复称放宽要求计划在 v5。v3 CreateUser 的文档页没有抓到字段（页面太短），没核对是否允许无邮箱。来源：https://zitadel.com/docs/guides/manage/console/users ，https://zitadel.com/docs/apis/resources/user_service_v2/user-service-create-user ，https://questions.zitadel.com/m/1383421801215823932
- 注册码或钩子：有 Actions v2（Request/Response/Function/Event 条件，调用你的外部 HTTP 端点），官方举例包括“创建用户前做领域数据校验”“限制哪些邮箱域可注册”；没有查到内置“注册码”功能（有“为用户创建邀请码”接口，用于预建用户后邀请，不是公开注册时校验）；相关社区讨论 #6871 提到 pre-creation 钩子可返回错误但提示不友好。来源：https://zitadel.com/docs/concepts/features/actions_v2 ，https://github.com/zitadel/zitadel/discussions/6871
- 设备码：支持，官方文档“OAuth 2.0 Device Authorization Flow（RFC 8628）”。来源：https://zitadel.com/docs/guides/integrate/login/oidc/device-authorization

## B3 Casdoor
- 语言与许可：Go（Beego 后端 + React 前端）；Apache-2.0；最新 v4.30.0（2026-11-21）。来源：https://api.github.com/repos/casdoor/casdoor ，https://raw.githubusercontent.com/casdoor/casdoor/master/README.md
- 数据库：通过 XORM 支持 MySQL、PostgreSQL、SQLite、SQL Server 等；默认配置是 MySQL；README 还给了单容器 SQLite 的试用方式（不建议生产）。来源：README，https://raw.githubusercontent.com/casdoor/casdoor/master/conf/app.conf
- 内存：官方 README 与安装文档里没查到最低或常驻内存的数字（在 README、casdoor.ai 的 server-installation 页范围内没查到）。
- 用户名无邮箱：注册表单由 Signup items 配置（默认项含 ID、Username、Display name、Password、Confirm password、Email、Phone、Agreement，每项可设 Visible、Required），可只留用户名与密码。来源：https://casdoor.ai/docs/application/signup-items-table
- 注册码：内置 Invitation 功能，在应用的 Signup items 加 Invitation code 项并设 Visible+Required 后，注册必须带有效邀请码；邀请码在 Invitations 页建，可设额度、过期时间、正则；可配合“禁用自助注册”。来源：https://casdoor.ai/docs/application/invitation-code ，https://casdoor.ai/docs/invitation/overview
- 设备码：支持。源码 controllers/token.go 里处理 urn:ietf:params:oauth:grant-type:device_code；2026 年仍有设备码修复的 PR（#5987、#5988）。来源：https://raw.githubusercontent.com/casdoor/casdoor/master/controllers/token.go ，https://github.com/casdoor/casdoor/pull/5988
- 对外提供 OAuth：官方文档的 OAuth 页列授权码等多种 grant，授权码默认开，其它在应用的 Grant types 里开。来源：https://casdoor.ai/docs/how-to-connect/oauth

## B4 Keycloak
- 语言与许可：Java（Quarkus）；Apache-2.0；最新 26.8.2（2026-11-05）。来源：https://api.github.com/repos/keycloak/keycloak/releases/latest
- 数据库：支持 PostgreSQL 14 到 18 等；默认的 dev-file（H2）仅开发用。来源：https://www.keycloak.org/server/db
- 内存：官方 HA 规模文档：单个 Pod 含 Realm 缓存与 10000 个缓存会话的“基础内存”为 1250 MB，容器内堆为内存上限的 70%，另有约 300 MB 非堆内存；没有查到单机最低值（官方安装页里没有写“最低 xxx MB”）。容器默认 MaxRAMPercentage=70、InitialRAMPercentage=50。来源：https://www.keycloak.org/high-availability/single-cluster/concepts-memory-and-cpu-sizing ，https://www.keycloak.org/server/containers
- 用户名无邮箱：支持思路明确——User Profile 里 email 属性可设为可选（Required 开关），登录只用用户名；Realm 的“Email as username”“Login with email”可关。来源：https://www.keycloak.org/docs/latest/server_admin/index.html （User Profile 一节）
- 注册码：没有内置注册码；可以用 Server Developer 文档里的 “Modifying or extending the registration form / FormAction SPI” 写 Java 扩展，在注册流程里加校验步骤。来源：https://www.keycloak.org/docs/latest/server_development/index.html
- 设备码：支持（客户端开关 OAuth 2.0 Device Authorization Grant，端点 /realms/{realm}/protocol/openid-connect/auth/device）。来源：https://www.keycloak.org/docs/latest/server_admin/index.html

## B5 Authentik
- 语言与许可：Python（Django）为主，另有 Go 组件（server、outpost 一类，本次未逐项核）；仓库 LICENSE 为 MIT，但 authentik/enterprise/ 目录另有企业许可，website/ 为 CC BY-SA 4.0（GitHub 识别为 NOASSERTION）；最新 version/2026.8.6（2026-11-20）。来源：https://raw.githubusercontent.com/goauthentik/authentik/main/LICENSE ，https://api.github.com/repos/goauthentik/authentik/releases/latest
- 数据库：PostgreSQL（官方 compose 用 postgres:16-alpine，compose 里没有 Redis；用户 2026.2 的 issue 里仍写了 Redis 8.6.0，是否仍需 Redis 以所用版本的文档为准，本次没核对）。来源：https://docs.goauthentik.io/compose.yml ，https://github.com/goauthentik/authentik/issues/20537
- 内存：官方 Docker Compose 文档写“至少 2 CPU 核、2 GB 内存”（含同机的 PostgreSQL，且标注为测试与小规模生产）。用户实测：2026.2.0 升级后 worker 内存由约 466 到 511 MiB 涨到约 1014 到 1033 MiB，server 约 500 到 800 MiB（K8s、非官方实测，已 closed 的 issue #20537，多人跟帖复现，有人因内存不足回退）。来源：https://docs.goauthentik.io/install-config/install/docker-compose/ ，https://github.com/goauthentik/authentik/issues/20537
- 用户名无邮箱：本次没找到专门说明；注册靠可配置的 enrollment flow（Prompt stage 自选字段），原则上可只收用户名与密码，未逐项核实。
- 注册码：内置 Invitation stage（管理员发邀请令牌，用链接 ?itoken=… 进入注册流程，可带预设字段，可设“无邀请码不能继续”）；是链接令牌不是让用户手输的短码，是否可改成手输没查到。来源：https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/invitation/
- 设备码：支持（OAuth2 Provider 文档列出 device code 与 /application/o/device/ 端点，另有 “Device code flow” 页）。来源：https://docs.goauthentik.io/add-secure-apps/providers/oauth2/

## B6 Ory Kratos + Hydra
- 语言与许可：均为 Go，Apache-2.0；两者最新 release 都是 v26.2.0（2026-03-20；之前 v25.4.0 为 2025-11-07，采用新版本号方案）。来源：https://api.github.com/repos/ory/kratos/releases ，https://api.github.com/repos/ory/hydra/releases
- 数据库：PostgreSQL、MySQL、CockroachDB（README 列出；SQLite 的说明本次没核）。来源：https://raw.githubusercontent.com/ory/hydra/master/README.md ，https://raw.githubusercontent.com/ory/kratos/master/README.md
- 内存：官方文档与 README 里没查到最低或常驻内存数字（kratos 仓库只有一条 2020 年的“空闲内存高”issue #945）。
- 部件：账号（Kratos）与 OAuth 服务器（Hydra）是两个独立进程，另需自己写（或用官方示例）登录与同意界面；Hydra 的登录与同意要由你自己的应用实现。来源：https://www.ory.sh/docs/kratos/hooks/configure-hooks （Ory Actions）与 Hydra 的 v25.4.0 release 说明里“需要在登录/同意应用里加两个屏幕”
- 用户名无邮箱：Kratos 用 identity schema（JSON Schema）定义字段，文档示例有 username 字段、可把某个 trait 标为登录 identifier；required 项由你的 schema 决定，不强制 email。来源：https://www.ory.sh/docs/kratos/manage-identities/customize-identity-schema
- 注册码：官方文档在 Ory Actions 一节明确写到可在注册前用 web_hook 做“邀请制注册”检查（can_interrupt 可中断流程）。来源：https://www.ory.sh/docs/kratos/hooks/configure-hooks
- 设备码：Hydra v25.4.0 起支持 RFC 8628（端点 /oauth2/device/auth，需要自己写验证与成功两个页面）；官方站上的独立文档页本次没查到（只在 release 说明与 PR 里）。来源：https://github.com/ory/hydra/releases/tag/v25.4.0 ，https://github.com/ory/hydra/pull/3912

## B7 Pocket ID
- 语言与许可：Go（单个程序，前端内嵌）；BSD-2-Clause；最新 v2.19.3（2026-11-15）；声明 OpenID Connect Certified。来源：https://api.github.com/repos/pocket-id/pocket-id ，https://raw.githubusercontent.com/pocket-id/pocket-id/main/README.md
- 数据库：内置 SQLite，也可用 DB_CONNECTION_STRING 接 PostgreSQL；同一数据库同时只能一个实例。来源：https://pocket-id.org/docs/setup/installation ，https://pocket-id.org/docs/configuration/environment-variables
- 内存：官方文档没查到内存数字（在安装页、环境变量页、README 范围内）。
- 用户名加密码：不支持——文档写明只支持无密码方式（主要是 Passkey，另有“另一台设备登录”、登录码、邮件登录码），没有密码登录。来源：https://pocket-id.org/docs/ ，https://pocket-id.org/docs/guides/sign-in-methods
- 无邮箱：环境变量 REQUIRE_USER_EMAIL 默认 true，可改为不强制邮箱（没有邮箱的用户不能用发邮件的功能）。来源：https://pocket-id.org/docs/configuration/environment-variables
- 注册码：ALLOW_USER_SIGNUPS 可设 disabled、withToken（注册链接令牌）、open；令牌是管理员生成的注册链接，不是自定义校验钩子；没查到可插入自定义校验的钩子。来源：同上
- 设备码：支持，release v0.50.0（2025-04-27）加入“device authorization endpoint”，之后多个版本在修补。来源：https://api.github.com/repos/pocket-id/pocket-id/releases
- 对外提供 OAuth：它本身就是 OIDC/OAuth 提供方；OIDC 客户端认证的页面本次没抓到细节（client_secret_basic 没核对）。

# C 简要结论（事实层面，不是推荐）
- 2c2g 同机还要放本站后端与 PostgreSQL 时，明显放不下的是：Logto（官方“最低推荐”2 vCPU/8 GiB）、Keycloak（HA 文档的单 Pod 基础内存 1250 MB 加约 300 MB 非堆）、Zitadel（本体约 512 MB，但数据库另算，官方推荐的生产与 HA 规模远大于此）；Authentik 官方就写“至少 2 核 2 GB”并且 worker 在 2026.2 后实测约 1 GB，整机基本占满。能放下的候选是 Casdoor、Pocket ID、Ory（Go 单进程，但没查到官方内存数字，须自测）；其中 Pocket ID 只有 Passkey，不满足“用户名加密码”。
