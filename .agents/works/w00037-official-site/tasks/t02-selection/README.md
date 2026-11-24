---
schema: nbook.task/v2
taskId: t02-selection
status: active
updated: 2026-11-24
---

# 选型：身份库、数据库访问与测试里的 PostgreSQL

## 目标与范围

用真实探针核对身份库能否满足第一版（Google 与 GitHub 登录、对外提供 OAuth 服务、验旧站的 scrypt 哈希、保留数字用户 id、注册码闸门、对外合同不绑在库上），并定数据库访问方式与合同测试怎样取得 PostgreSQL。

合同：只做选型，行为合同未变。

## 当前状态

2026-11-24 选型做完：身份库用 Better Auth，数据库访问用 Kysely 加 `pg`，合同测试用真实 PostgreSQL 容器。两轮探针都通过，备选方案的资料调研已回来。开发者定了账号要邮箱、llmlint 已废弃，下面“要迁就的地方”第 1、3 条因此不再是障碍。

## 身份库：Better Auth 的探针结论

版本 better-auth 1.7.27（MIT）。探针在真实 PostgreSQL 上经 HTTP 请求跑，输出与脚本见 [evidences/better-auth-spike.txt](evidences/better-auth-spike.txt)。

| 要求 | 结果 |
|---|---|
| 表建在自己的 schema 里 | 成立：`database.schemaName`，建出 12 张表；也能导出成纯 SQL 文件 |
| 数字用户 id、迁移时保留旧 id | 成立：`generateId: "serial"`；按旧 id 插入后调整序列，新注册接着往后排 |
| 用旧站的 scrypt 哈希登录 | 成立：自定义 `password.verify` 按前缀分流，旧密码登录成功、错密码 401 |
| 注册码闸门 | 成立：`databaseHooks.user.create.before` 里拒绝，没有留下用户行；社交登录首次注册可用 `disableImplicitSignUp` 加 `additionalData` 带码（文档有同类示例，未探） |
| 对外提供 OAuth 服务 | 成立：发现文档、授权码加 S256 PKCE、`client_secret_basic`、不透明访问令牌、`/userinfo` 可加自定义字段（返回了 llmlint 要的 `id` 数字、`username`、`displayName`、`status`）、授权码重放被拒 |
| 自家路由包一层 | 成立：自己的 `/api/identity/v1/login` 内部调 `auth.api.signInUsername`，转发 Set-Cookie |
| 管理员封禁、列用户 | 成立：封禁后原会话失效、再登录 401；非管理员调用 403 |
| 内存 | 初始化后空闲 85 MB；跑过 argon2 哈希后 165 MB |

要迁就的地方：

1. **每个账号必须有邮箱。** `user.email` 是非空唯一列，注册不带邮箱直接 400。官方文档写明“目前每条用户记录都要求邮箱”，没有邮箱时的官方做法是填 `<稳定 id>@….invalid` 的占位邮箱。开发者已定新站账号要邮箱；旧站账号导入时填占位邮箱。
2. **内置的 GitHub、Google 登录把上游地址写死在库里。** 改用它的通用 OAuth 插件（地址可配），生产与测试走同一条代码路径；第二轮探针已走通。
3. **OAuth 客户端的 `client_id` 由库生成**，传入的值被忽略；客户端密钥在库里是摘要。llmlint 废弃后没有要保留的旧客户端，不用处理。
4. **库一共登记了 83 个端点**（第二轮探针的插件组合下）。对外只放行标准 OAuth 端点与社交登录回调，其余经自家路由调用，挂载处要写白名单。

## 第二轮探针：仿真上游与授权续接

输出与脚本见 [evidences/better-auth-spike-2.txt](evidences/better-auth-spike-2.txt)。上游是脚本里起的仿真 HTTP 服务，库经真实网络请求换令牌、取用户信息。

| 场景 | 结果 |
|---|---|
| 上游账号没注册过，只点登录 | 被拒，跳到错误页并带 `signup_disabled`（`disableImplicitSignUp`） |
| 带注册意图但没有注册码 | 被拒，带 `REGISTRATION_CODE_REQUIRED`，没有留下用户行 |
| 带注册意图、注册码与用户名 | 建出账号（用户名取自随流程带回的数据，邮箱取自上游），当场有会话 |
| 同一上游账号再次登录 | 直接登录 |
| 上游邮箱撞上已有的密码账号 | 被拒，带 `account_not_linked`；没有自动合并，已有账号上仍只有密码这一种登录方式 |
| 授权中途要登录 | 库把授权请求带签名转到登录页；自家登录路由把签名参数原样传给库，库返回下一步地址（授权确认页）；确认后拿到授权码，换令牌成功 |

注册码与用户名随流程带回的那份数据来自浏览器，库的文档要求当作不可信输入校验；探针里注册码在建用户前校验，用户名的格式与唯一性校验留给实现。

## 备选（资料调研，2026-11-24）

由子代理联网查官方文档、官方仓库与 npm 登记，逐条记录与来源见 [research/alternatives-survey.md](research/alternatives-survey.md)。主会话只抽查了一条（npm 上 arctic 3.7.0 标着已弃用，属实），其余未复核。

- **自己写账号核心、协议部分用小库**：OAuth 客户端库 arctic 已被作者弃用（最后一版 2025-05）。授权服务器的库里，oidc-provider 功能最全、有 OpenID 认证，但建在 Koa 上、没有 PostgreSQL 适配器，官方没有 Bun 或 Hono 的说明；@jmondi/oauth2-server 支持原生 Request/Response、存储全部自己接、没有设备码；@node-oauth/oauth2-server 不兼容 Fetch 的 Request；OpenAuth 停在 0.4.3，换令牌时不校验客户端密钥。这条路要自己写会话、社交登录、管理接口与存储，还要自己接授权服务器。
- **单独部署现成的身份服务**：Logto（官方最低推荐 8 GiB）、Keycloak（基础内存约 1.25 GB）、Zitadel、Authentik（官方写至少 2 核 2 GB）在 2 核 2 GB 上与本站和 PostgreSQL 同机放不下或基本占满。Casdoor（Go，自带邀请码）、Ory Kratos 加 Hydra（Go，注册前可挂钩子）可能放得下，官方没给内存数字。Pocket ID 没有密码登录。这条路的界面与注册流程要按它们的模型来，用不上 nb-ui。

选 Better Auth 的理由：第一版要的每一项都经探针走通，表在自己的 schema 里、能导出纯 SQL，对外只暴露标准端点与自家路由；代价是上面四处迁就，以及换语言重写时账号模块要整体换实现（对外合同是标准 OAuth 加自家接口，由合同测试守住）。

## 数据库访问与测试里的 PostgreSQL

- 数据库访问：Kysely 加 `pg`。Better Auth 内置适配器就是这一对，自己的表用同一个连接池与同一种写法；迁移是纯 SQL 文件。
- 合同测试：本机与 CI 各起一个 PostgreSQL 容器，每个测试文件建一个随机名的库、跑迁移、用完删掉；不用内存里的仿真数据库。

## 下一步

无。结论写进 [t03](../t03-architecture/README.md) 的提案。
