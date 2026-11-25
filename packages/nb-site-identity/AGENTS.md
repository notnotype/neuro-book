# nb-site-identity 包入口

本包位于 `packages/nb-site-identity`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-identity` 是官方站的账号模块（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md)、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md)）：自己的 SQLite 库 `identity.db` 与它的迁移、挂在 `IDENTITY_API_PREFIX` 下的 Hono 子应用。行为合同是 [`site/accounts.md`](../../docs/specs/site/accounts.md)。

## 边界

- 工作区依赖只许自己的合同包 `nb-site-identity-contract`（devDependencies 另许测试支持包）；第三方通用包不限。由 `nb-site-server/src/architecture.test.ts` 检查。
- 不导入 `nb-site-server`：公开入口 `src/index.ts` 导出迁移清单、`parseIdentityConfig` 与 `createIdentityModule`，选项与返回值的类型由本包声明，进程入口的适配器对上形状。
- 只经交进来的连接读写自己的库，不附加别的库文件（`ATTACH`），由同一个架构测试检查源码与迁移。
- 迁移放 `migrations/NNNN_<小写下划线名>.sql`，在 `src/migrations.ts` 里按编号逐个导入；写法见入口包的“迁移”一节。

## Better Auth 的升级清单

版本钉在 1.7.27（`better-auth`、`@better-auth/core` 与 `@better-auth/oauth-provider`）。模块自己做登录、注册与管理，库只发会话、认 Cookie、清 Cookie，但仍依赖下表这些不受库承诺的接口与行为（[ADR 0063](../../docs/adr/0063-official-site-identity-own-routes-library-sessions.md)）。升级时先跑本包的 `bun test`，每一项对着一条用例；用例失败就按“失败说明什么”改代码，再改这张表。

| 类 | 依赖的东西 | 用例 | 失败说明什么 |
|---|---|---|---|
| 内部接口 | 插件端点的 `metadata.SERVER_ONLY`：经 `auth.handler` 是 404，只能经 `auth.api` 调 | `auth.test.ts` “只供服务端调用的端点” | 模块自己的发会话、发 Cookie、清 Cookie 端点能从外部调到 |
| 内部接口 | `internalAdapter.findUserById`、`createSession`，`setSessionCookie`（`better-auth/cookies`）；`createSession` 从这次调用的请求头取 `User-Agent` 填进 `userAgent`；建会话前的 `databaseHooks.session.create.before` 改写的时间与列（`userAgent` 换成浏览器概要，`user-agent.ts`）如实落库 | `auth.test.ts` “发会话”两条 | 会话的 Cookie 名字或属性、时间取哪只时钟、来源地址与浏览器标识的存法变了；原始的浏览器标识落库，或会话列表里浏览器与系统全是空 |
| 内部接口 | `internalAdapter.findSession` 加 `setSessionCookie` 重发同一个令牌的 Cookie | `session.test.ts` “满一天后延长一次并重发同一个令牌的 Cookie” | 延长后浏览器拿不到新的 `Max-Age` |
| 内部接口 | `deleteSessionCookie`（`better-auth/cookies`） | `app.test.ts` “只结束当前会话”；`session.test.ts` “按模块的时钟过了会话时长” | 登出与到期清不掉 Cookie |
| 内部接口 | 库的事务与“当前适配器”的异步上下文（`runWithTransaction`、`getCurrentDBAdapterAsyncLocalStorage`）；库里不取当前事务的调用（已知 `reserveVerificationValue`） | `db/connection.test.ts` “库的事务跨 await 开着时”“用错了的立即失败” | 队列的重入判断或自锁检测失效（`db/connection.ts` 文件头） |
| 内部接口 | `context.checkSchema` 存在，表不对时以 `code: "SCHEMA_MISMATCH"` 失败 | `auth.test.ts` “结构检查” | 表少了列时模块照样启动、第一个请求才失败 |
| 存法 | 库导出的表结构（含 `jwt`、`oauthProvider` 插件的八张表） | `db/schema.test.ts` “库的表与基准文件” | 库要的表变了：写新的迁移，基准文件跟着换 |
| 存法 | 模块用自己的 SQL 写 `user`、`account` 的行与库写的逐列一样，库读回也一样；时间是 `toISOString()` 的文本，布尔是 0 与 1 | `db/library-rows.test.ts` 两条 | `library-rows.ts` 与 `session.ts` 里的 SQL 要跟着库的存法改 |
| 库内行为 | 没有会话缓存（`cookieCache` 关着）：直接删会话行之后 `getSession` 立即读不到 | `auth.test.ts` “直接删掉会话行之后……立即读不到” | 封禁、登出、改密码后旧会话还能用一阵：核对库有没有给会话加缓存 |
| 库内行为 | `deferSessionRefresh` 打开时以 GET 的方式调 `getSession` 不写库：按系统时间到期的会话只回空、不删行 | `session.test.ts` “账号库被别的连接占着写时照常回答” | 问身份在写锁下变成 503（`site.accounts` 输出 7） |
| 库内行为 | `getSession` 把数据库错误包成 `APIError`，原错误在 `cause` 里 | `session.test.ts` “账号库不可读时回 503 unavailable” | 出错出口认不出“库不可用”，回成 500 |
| 库内行为 | `onAPIError.throw` 打开时，经 `handler` 的非 `APIError` 从 `handler` 抛出，不打印到标准错误 | `auth.test.ts` “撞写锁的数据库错误从 handler 抛出” | 错误的堆栈与路径进了进程的标准错误（t08 挂上 `handler` 之后才对外可见） |
| 库内行为 | admin 插件在建会话前拒绝被封禁的账号，抛 `APIError` 且 `body.code` 是 `"BANNED_USER"`（`login.ts` 的 `isBannedUserError`） | `login.test.ts` “库给被封禁账号建会话时抛的错误认得出” | 登录在发会话的事务里撞到封禁时回成 500，不是 `account_banned` |
| 内部接口 | `emailAndPassword.password` 的 `hash`、`verify` 成为库上下文的 `password.hash`、`password.verify`（库的 admin 插件等处算哈希走它） | `auth.test.ts` “库碰密码时用模块的哈希” | 库在自己的路径上写出缺省的 `hexsalt:hexkey` 格式，或认不出模块写的哈希 |
| 库内行为 | 库的 `signOut` 吞掉删行的失败、照样清 Cookie，所以登出不用它 | `app.test.ts` “账号库被别的连接占着写时回 503” | 只在有人把登出改回 `signOut` 时失败；升级时顺带看新版本的 `signOut` 是否还这样 |
| 签名钥 | jwt 插件签名时只挑没过期的钥里 `createdAt` 最新的一把，按系统时间判过期；过期钥在宽限期里仍列在 `/jwks`；私钥用库上下文的 `secretConfig` 加密，存成 `symmetricEncrypt` 结果的 JSON 字符串；`createJwk` 只用端点上下文里的 `context`（`oauth/signing-key.ts`） | `oauth/signing-key.test.ts` “换了会话密钥后启动” | 换会话密钥后令牌端点 500，或换之前签的 id_token 验不过、客户端缓存的公钥对不上 |
| 签名钥 | 宽限期按 `jwks.gracePeriod`（秒）生效，按系统时间从钥的 `expiresAt` 算起；`auth.ts` 显式写 30 天（`JWKS_GRACE_SECONDS`），与库的缺省相同 | `oauth/signing-key.test.ts` “换下来的公钥在过期后 30 天内仍列在公钥地址里” | 选项改了名字或单位、库不再读它：旧公钥提前或推迟消失，客户端缓存的旧 kid 验不过 |
| 签名钥 | 找不到配置算法的钥时，库退回“最新的任意一把”签名（第六轮问 2），所以启动检查拒绝别的算法的钥 | `oauth/signing-key.test.ts` “表里有一把别的算法的钥匙时启动失败”“第一次启动后恰有一把 RS256 钥” | 表里混进别的算法时 id_token 不再是 RS256；或启动时没建钥、第一次签发时才建 |
| 寿命 | `oauthProvider` 的 `codeExpiresIn`、`accessTokenExpiresIn` 缺省是 600 与 3600 秒（`auth.ts` 不写，`LIBRARY_CODE_SECONDS`、`LIBRARY_ACCESS_TOKEN_SECONDS` 记着）；授权码存在 `verification` 表里 | `oauth/provider.test.ts` “寿命” | 库改了缺省：在 `oauthProvider` 的选项里显式写回 Spec 的值 |
| 客户端密钥 | `storeClientSecret: {hash}` 只给 `hash` 时，库登记客户端与换码时都调它，换码按“哈希相等”认密钥；`generateClientSecret` 发新密钥 | `oauth/provider.test.ts` “客户端密钥”两条；`admin/oauth-clients.test.ts` “换密钥” | 已登记客户端的密钥失效，或自家换密钥（计划 3.9）写的哈希库不认 |
| 回调地址的两套规则 | 库登记客户端时按 `application_type`（不给时按 `web`）走 `validateClientRedirectUri` 的两套规则：`web` 只许主机不是回环的 `https`，`native` 另许原始写法的主机恰为 `localhost`、`127.0.0.1`、`[::1]` 的 `http`；拒收时抛 `APIError`，`body.error` 是 `invalid_redirect_uri`，带片段的被请求体 schema 拒收（`body.code` 为 `VALIDATION_ERROR`）。模块的 `oauth/clients.ts` 只比它严，登记显式传 `application_type`（`admin/oauth-clients.ts`） | `oauth/clients.test.ts` “规则只比库严”；`admin/oauth-clients.test.ts` “库拒收自家规则放过的回调地址” | 库收紧了规则：管理员登记合规的地址撞上 `identity.oauth_client_rule_drift`，`clients.ts` 要跟着收紧；或库换了拒收的错误形状，登记回成 500 |
| 内部接口 | `adminCreateOAuthClient` 在 `withLibTransaction` 里调：插入走当前事务，与操作者的复核、审计一起提交或回滚；库从请求头的 Cookie 认登记者、按系统时间判会话没过期，记进 `oauthClient.userId` | `admin/oauth-clients.test.ts` “写审计失败时登记不生效” | 写审计失败时客户端照样登记进去（库的插入没进当前事务），或登记因自锁卡住 |
| 存法 | 改动客户端用自家 SQL 写 `oauthClient` 的 `name`、`redirectUris`（JSON 数组文本）、`skipConsent`、`disabled`（0 与 1）、`updatedAt`（取整到秒的 ISO 文本），与库的 `adminUpdateOAuthClient` 写的逐列一样、库读回也一样；种类按 `tokenEndpointAuthMethod` 是不是 `none` 判 | `admin/oauth-clients.test.ts` “改动的存法与库一样” | `admin/oauth-clients.ts` 的 SQL 与读法要跟着库的存法改 |
| 撤销 | 删会话行时外键把 `oauthAccessToken.sessionId` 置空，库只在它不为空时查会话，所以直接删会话不让令牌失效；`revoked` 不为空时库的用户信息回 401（`oauth/revoke.ts` 文件头） | `oauth/revoke.test.ts` “一次会话结束”“账号名下的全部失效”“自己改密码”各条的令牌一项 | 结束会话、封禁、改密码之后对外令牌照用：核对库判令牌失效的条件，`revoke.ts` 写的列跟着改 |
| 撤销 | 没用掉的授权码是 `verification` 的一行，`value` 的 JSON 里 `type` 为 `"authorization_code"`、`userId` 与 `sessionId` 是数字 id 的字符串、`query.client_id` 是客户端 id；删掉这一行换码得 `invalid_grant` | `oauth/revoke.test.ts` 各条的授权码一项，尤其“自己改密码”与“按授权、按客户端撤”（会话没删，只有删码这一道）；“verification 表里另有库别的行”三条（社交 state 照库的写法造） | 撤销之后码照样换得出：`revoke.ts` 的 JSON 路径跟着库的存法改；或库的 state 等别的行改了形状、被撤销删掉或让撤销报错 |
| 存法 | `verification`、`oauthAccessToken` 的 `expiresAt` 是库的 ISO 文本；清理任务按模块的时钟删过期的行（`revoke.ts` 的 `purgeExpiredOAuthRows`），库不认过期的行 | `oauth/revoke.test.ts` “清理任务删过期的授权码与访问令牌” | 过期的行删不掉、表一直长，或时间写法变了，按文字比较不再是按时间比较 |
| 撤销 | 库自带的 `session.delete` 前后钩子存在但本模块不依赖：模块不调库删会话（不调 `deleteSession`、`deleteSessions`，库删会话的端点经 `handler` 是 404）。库若开始在模块用到的别的路径上删会话，撤销会变成提交之后在后台做、且不删授权码（实现审查第 5 条实测 `/sign-out`、`/revoke-sessions` 时是这样） | `architecture.test.ts` “删会话只经 session.ts 的一组函数”；`oauth/provider.test.ts` “关掉的库端点” | 有删会话的路不经 `session.ts`，对外令牌晚一步失效、授权码照样换得出：核对库新版本里哪些调用会删会话 |
| 关掉的路径 | `better-auth/api` 的 `getEndpoints` 用同一份选项给出的端点与 `auth.api`、`handler` 的路由是同一组（库的 `betterAuth` 与路由都由它得出），端点带 `path` 与 `options.metadata.SERVER_ONLY`，算端点表不等上下文；`disabledPaths` 拿去掉基路径与末尾斜杠的请求路径逐字比，不分方法、不认参数，不影响服务端经 `auth.api` 调（`auth.ts` 的 `disabledLibraryPaths`，由 `LIBRARY_PUBLIC_ENDPOINTS` 反推） | `oauth/provider.test.ts` “关掉的库端点”（遍历 `auth.api` 的全部端点乘六种方法，带普通用户的会话） | 合同不要的库端点从外部能调到，例如普通用户登出别的会话、自己登记客户端；库新加了带参数的端点时，用例列出它，要查挂载白名单挡没挡住 |
| 对外端点的方法 | 库经 `handler` 对任何端点的 HEAD 都回 404，所以挂载层把公钥的 HEAD 换成 GET 交库；库自己也接 `POST /oauth2/authorize`、`POST /callback/<id>` 与任意 id 的回调，方法与上游由挂载层挡（`auth.ts` 的 `LIBRARY_PUBLIC_ENDPOINTS`、`oauth/mount.ts`） | `oauth/mount.test.ts` “白名单”各条、“HEAD”两条 | 公钥的 HEAD 不再与 GET 同头，或库开始在别的方法上做事：核对挂载层的换法与白名单 |
| 令牌端点撞会话外键 | 换码先删授权码、再插访问令牌，整段不在一个事务里；两步之间会话被删时插入因外键失败，库把 `SQLiteError`（`code` 为 `SQLITE_CONSTRAINT_FOREIGNKEY`）原样从 `handler` 抛出，挂载层按码认它回 `invalid_grant`（计划问 10） | `oauth/mount.test.ts` “换码时会话被删” | 库把这个错误包成别的形状（换码撞上结束会话时回成 500），或改成在事务里做（这条可以去掉） |
| 允许的访问令牌都有 `oauthAccessToken` 行 | 换码带 `resource` 且它是库认得的资源（用户信息端点的地址）时，库发 JWT 访问令牌、不写 `oauthAccessToken` 行，自家撤销够不到；挂载层交库前从表单里去掉 `resource`，库只会发有行的不透明令牌 | `oauth/mount.test.ts` “带 resource 换码” | 去参数的那一步没生效、或库换了让它发 JWT 的参数：结束会话、改密码之后有令牌照用 |
| 发现文档 | 库的 `getOpenIdConfig()` 给 `issuer` 与五个端点地址（类型里用户信息、公钥、撤销三项可以没有，缺了启动失败）；能力字段不取库的（`oauth/discovery.ts`） | `oauth/mount.test.ts` “发现文档”；合同 `oauth-provider.test.ts` 逐字段 | 库改了端点地址或字段名：发现文档里的地址不可达，或启动失败 |
| 允许的访问令牌都有 `oauthAccessToken` 行 | 授权请求带 `resource` 时库把它记进授权码，换码时照样发 JWT 访问令牌；授权端点交库前也去掉 `resource`（与 `claims`）（`oauth/mount.ts` 的 `authorizeEndpoint`） | `oauth/mount.test.ts` “授权请求带用户信息端点的 resource” | 授权时带的 `resource` 漏进了码：换出 JWT 访问令牌，自家撤销够不到 |
| 续接的签名参数 | 库的 `signParams` 在客户端的参数后面加五个字段：`exp`（秒，系统时间加 600）、`ba_iat`（毫秒，系统时间）、`ba_pl`（发起会话 id，配了 `postLogin` 时确认页带）、`ba_param`（被签名的参数名，每个名一项）、最后是 `sig`；导出的 `verifyOAuthQueryParams(query, secret)` 验签并按系统时间判 `exp`，比签名前去掉 base64 的 `=` 填充（`oauth/continue.ts`） | `oauth/continue.test.ts` 全部；合同 `oauth-provider.test.ts` “篡改的续接令牌”“过了 10 分钟” | 字段改名或增减：继续地址带着签名字段回授权端点被库拒绝、10 分钟从错的时刻起算；验签函数改名或改签名时启动即失败（类型检查） |
| 库的跳转地址 | 授权给的地址只有几类：登录页、站点同意页、确认页是配置的站内路径加签名参数（相对地址）；错误页是 `<站点地址><基路径>/error?error=<码>`，已见的码 `invalid_client`、`client_disabled`、`invalid_redirect`、`invalid_request`（重复参数、带 `#`、缺 `client_id` 或 `redirect_uri`），另有 `prompt=select_account` 等表外的码；跳回客户端带码或错误（`response_type=token` 的错误在片段里）（`oauth/library-location.ts`） | `oauth/library-location.test.ts` “五类地址”“错误页的码”；`oauth/mount.test.ts` “授权端点的判断与改写” | 库给了新的一类地址或错误页换了路径：库的原始地址（含它的错误页）漏给浏览器；表外的码多了时看 `identity.oauth_library_error_page` 日志 |
| 授权的客户端与回调地址 | 库的 `findRegisteredRedirectUri`：带片段或用户信息的不算，逐字相等，不是 `web` 的客户端的 `http` 回环地址去掉端口后相等也算；停用、不存在的客户端带去错误页。模块的第 1 步（`oauth/clients.ts` 的 `checkClientAndRedirect`）照它写同一份规则 | `oauth/mount.test.ts` “客户端不对、回调地址不对”“公开客户端的 http 回环回调地址不比端口”；合同 `oauth-provider.test.ts` “公开客户端的 http 回环回调地址换了端口” | 两边规则不再一致：库收的地址第 1 步拒了（换端口的本机应用拿不到码），或第 1 步放过、库带去它的错误页（落到码表的兜底） |
| 授权的跳转形状 | `handleRedirect`：普通请求回 302 加 `Location`；带 `Sec-Fetch-Mode: cors` 或 `Accept` 含 `application/json` 时回 200、体为 `{"redirect":true,"url":…}`；`APIError` 的跳转经 `handler` 也是这两种之一（`oauth/mount.ts` 的 `libraryRedirectTarget`） | `oauth/mount.test.ts` “授权端点的判断与改写”各条的 fetch 一种（“fetch 发起也回 302”） | 库换了 JSON 的形状：`fetch` 发起的授权把库的原始地址原样带出去 |
| 授权的 POST | 库对带会话 Cookie 的 `POST /oauth2/authorize` 查来源，没有 `Origin` 回 403；GET 不查。挂载层把表单 POST 换成同参数的 GET 交库 | `oauth/mount.test.ts` “POST 改成 GET 交库”；合同 `oauth-provider.test.ts` “以表单 POST 发起” | 换法失效或库改了 GET 的检查：表单发起的授权回 403 |
| 确认重跑授权 | `oauth2Consent`（`auth.api`）：同意时记下同意、以 JSON 的方式重跑整套授权，签名参数带 `prompt=login` 而会话早于签名时会给登录页；拒绝时回调地址可信就跳回客户端带 `access_denied`，否则给它的错误页；回 `{redirect, url}`（`module.ts` 的 `decide`、`oauth/consent-api.ts`） | `oauth/consent-api.test.ts` “POST oauth/authorization”“接口判完、库还没判时才停用或改回调地址” | 同意之后拿不到码，或库给的地址不在归类表里：确认页接口回 500 |
| 确认标识带发起会话 | 确认页的签名参数带 `ba_pl`（发起时的会话 id），提交的会话就是它时库不再判站点同意（`postLogin`）；所以确认页接口自己先过同意门槛 | `oauth/consent-api.test.ts` “要会话且受同意门槛约束” | 只在接口那一道被拿掉时失败；库若开始对同一会话也判站点同意，这一行可以改成“两道都在” |

## 完成门禁

```text
bun run typecheck
bun test
```

改了本包，另跑 `nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
