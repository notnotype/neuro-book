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

2026-11-24：身份库的探针跑完，结论见下。开发者定了账号要邮箱，下面第 1 条不再是障碍；开发者说明 llmlint 已废弃，第 3 条不用处理。主会话据此选 Better Auth。备选方案的资料调研在后台进行，回来后补“备选”一节，供提案写取舍。

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

不成立或要迁就的地方：

1. **每个账号必须有邮箱。** `user.email` 是非空唯一列，注册不带邮箱直接 400。官方文档写明“目前每条用户记录都要求邮箱”，没有邮箱时的官方做法是填 `<稳定 id>@….invalid` 的占位邮箱，取消这条限制的需求挂在它的 issue 9124 上。旧站账号只有用户名、没有邮箱。
2. **内置的 GitHub、Google 登录把上游地址写死在库里。** 黑盒合同测试要把上游指向仿真服务，得改用它的通用 OAuth 插件（地址可配），生产与测试走同一条代码路径。通用插件的配置项已确认存在，完整流程未探。
3. **OAuth 客户端的 `client_id` 由库生成**，传入的 `llmlint-web` 被忽略；客户端密钥在库里是摘要。迁移时要么直接改表里的 `clientId`，要么改 llmlint 的配置；密钥要重新签发一次。
4. **授权流程中途要登录时**，库把请求带着签名参数转到登录页，登录后由它的客户端插件接着走。用自家登录路由时怎样续上还没探。

## 数据库访问与测试里的 PostgreSQL（主会话倾向，未写进提案）

- 数据库访问：Kysely 加 `pg`。Better Auth 内置适配器就是这一对，自己的表用同一个连接池与同一种写法；迁移是纯 SQL 文件。
- 合同测试：本机与 CI 各起一个 PostgreSQL 容器，每个测试文件建一个随机名的库、跑迁移、用完删掉；不用内存里的仿真数据库。

## 下一步

- 备选方案调研回来后补“备选”一节。
- 探完剩下两处：通用 OAuth 插件接仿真上游的完整流程；授权中途要登录时怎样接上自家登录路由。
