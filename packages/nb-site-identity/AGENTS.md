# nb-site-identity 包入口

本包位于 `packages/nb-site-identity`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-identity` 是官方站的账号模块（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md)、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md)）：自己的 SQLite 库 `identity.db` 与它的迁移、挂在 `IDENTITY_API_PREFIX` 下的 Hono 子应用。行为合同是 [`site/accounts.md`](../../docs/specs/site/accounts.md)。

## 边界

- 工作区依赖只许自己的合同包 `nb-site-identity-contract`（devDependencies 另许测试支持包）；第三方通用包不限。由 `nb-site-server/src/architecture.test.ts` 检查。
- 不导入 `nb-site-server`：公开入口 `src/index.ts` 导出迁移清单、`parseIdentityConfig` 与 `createIdentityModule`，选项与返回值的类型由本包声明，进程入口的适配器对上形状。
- 只经交进来的连接读写自己的库，不附加别的库文件（`ATTACH`），由同一个架构测试检查源码与迁移。
- 迁移放 `migrations/NNNN_<小写下划线名>.sql`，在 `src/migrations.ts` 里按编号逐个导入；写法见入口包的“迁移”一节。

## Better Auth 的升级清单

版本钉在 1.7.27（`better-auth` 与 `@better-auth/core`）。模块自己做登录、注册与管理，库只发会话、认 Cookie、清 Cookie，但仍依赖下表这些不受库承诺的接口与行为（[ADR 0063](../../docs/adr/0063-official-site-identity-own-routes-library-sessions.md)）。升级时先跑本包的 `bun test`，每一项对着一条用例；用例失败就按“失败说明什么”改代码，再改这张表。

| 类 | 依赖的东西 | 用例 | 失败说明什么 |
|---|---|---|---|
| 内部接口 | 插件端点的 `metadata.SERVER_ONLY`：经 `auth.handler` 是 404，只能经 `auth.api` 调 | `auth.test.ts` “只供服务端调用的端点” | 模块自己的发会话、发 Cookie、清 Cookie 端点能从外部调到 |
| 内部接口 | `internalAdapter.findUserById`、`createSession`，`setSessionCookie`（`better-auth/cookies`）；`createSession` 从这次调用的请求头取 `User-Agent` 填进 `userAgent`；建会话前的 `databaseHooks.session.create.before` 改写的时间与列（`userAgent` 换成浏览器概要，`user-agent.ts`）如实落库 | `auth.test.ts` “发会话”两条 | 会话的 Cookie 名字或属性、时间取哪只时钟、来源地址与浏览器标识的存法变了；原始的浏览器标识落库，或会话列表里浏览器与系统全是空 |
| 内部接口 | `internalAdapter.findSession` 加 `setSessionCookie` 重发同一个令牌的 Cookie | `session.test.ts` “满一天后延长一次并重发同一个令牌的 Cookie” | 延长后浏览器拿不到新的 `Max-Age` |
| 内部接口 | `deleteSessionCookie`（`better-auth/cookies`） | `app.test.ts` “只结束当前会话”；`session.test.ts` “按模块的时钟过了会话时长” | 登出与到期清不掉 Cookie |
| 内部接口 | 库的事务与“当前适配器”的异步上下文（`runWithTransaction`、`getCurrentDBAdapterAsyncLocalStorage`）；库里不取当前事务的调用（已知 `reserveVerificationValue`） | `db/connection.test.ts` “库的事务跨 await 开着时”“用错了的立即失败” | 队列的重入判断或自锁检测失效（`db/connection.ts` 文件头） |
| 内部接口 | `context.checkSchema` 存在，表不对时以 `code: "SCHEMA_MISMATCH"` 失败 | `auth.test.ts` “结构检查” | 表少了列时模块照样启动、第一个请求才失败 |
| 存法 | 库导出的表结构 | `db/schema.test.ts` “库的表与基准文件” | 库要的表变了：写新的迁移，基准文件跟着换 |
| 存法 | 模块用自己的 SQL 写 `user`、`account` 的行与库写的逐列一样，库读回也一样；时间是 `toISOString()` 的文本，布尔是 0 与 1 | `db/library-rows.test.ts` 两条 | `library-rows.ts` 与 `session.ts` 里的 SQL 要跟着库的存法改 |
| 库内行为 | 没有会话缓存（`cookieCache` 关着）：直接删会话行之后 `getSession` 立即读不到 | `auth.test.ts` “直接删掉会话行之后……立即读不到” | 封禁、登出、改密码后旧会话还能用一阵：核对库有没有给会话加缓存 |
| 库内行为 | `deferSessionRefresh` 打开时以 GET 的方式调 `getSession` 不写库：按系统时间到期的会话只回空、不删行 | `session.test.ts` “账号库被别的连接占着写时照常回答” | 问身份在写锁下变成 503（`site.accounts` 输出 7） |
| 库内行为 | `getSession` 把数据库错误包成 `APIError`，原错误在 `cause` 里 | `session.test.ts` “账号库不可读时回 503 unavailable” | 出错出口认不出“库不可用”，回成 500 |
| 库内行为 | `onAPIError.throw` 打开时，经 `handler` 的非 `APIError` 从 `handler` 抛出，不打印到标准错误 | `auth.test.ts` “撞写锁的数据库错误从 handler 抛出” | 错误的堆栈与路径进了进程的标准错误（t08 挂上 `handler` 之后才对外可见） |
| 库内行为 | admin 插件在建会话前拒绝被封禁的账号，抛 `APIError` 且 `body.code` 是 `"BANNED_USER"`（`login.ts` 的 `isBannedUserError`） | `login.test.ts` “库给被封禁账号建会话时抛的错误认得出” | 登录在发会话的事务里撞到封禁时回成 500，不是 `account_banned` |
| 内部接口 | `emailAndPassword.password` 的 `hash`、`verify` 成为库上下文的 `password.hash`、`password.verify`（库的 admin 插件等处算哈希走它） | `auth.test.ts` “库碰密码时用模块的哈希” | 库在自己的路径上写出缺省的 `hexsalt:hexkey` 格式，或认不出模块写的哈希 |
| 库内行为 | 库的 `signOut` 吞掉删行的失败、照样清 Cookie，所以登出不用它 | `app.test.ts` “账号库被别的连接占着写时回 503” | 只在有人把登出改回 `signOut` 时失败；升级时顺带看新版本的 `signOut` 是否还这样 |

## 完成门禁

```text
bun run typecheck
bun test
```

改了本包，另跑 `nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
