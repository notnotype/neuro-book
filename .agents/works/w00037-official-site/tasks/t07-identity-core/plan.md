# w00037 t07 账号核心：实施计划（草稿）

路径按 worktree `.worktree/w00037-official-site`（分支 `feat/w00037-official-site`）写；Spec、ADR、Task 记录读主工作区的。文中“探针”是规划时在 `/tmp/w00037-t07-plan/lab/` 用 Bun 1.4.4、better-auth 1.7.27、kysely 0.29.9 与 `bun:sqlite` 跑的一次性脚本（第 9 节逐个列出），没进仓库。“推断”是没跑过、只从源码或文档读到的。计划由 Opus 子代理起草（只读），待主会话审定；第 10 节是要主会话或开发者定的事，定之前不开工的片在第 5 节标明。

## 1. Context

为什么做：官方站重写（[提案](../../../../../docs/proposals/official-site-rewrite.md)，已接受）的账号核心。前端（t10 的 B2 到 B6）、社交登录与对外 OAuth（t08）、看板的权限（t11）、旧站导入（t12）都要它。做完时站点能凭注册码注册、用用户名或邮箱加密码登录、管理自己的资料与会话与邀请码、补交同意；管理员能处置账号、发放注册码、看审计；部署的人能用命令创建第一个管理员。

依据：

- 合同：[`site.accounts`](../../../../../docs/specs/site/accounts.md) 输出 1 到 10、17 到 22 与它们的时序、失败表、验收 1 到 3、6、7；[`site.admin`](../../../../../docs/specs/site/admin.md) 全部；[`site.operations`](../../../../../docs/specs/site/operations.md) 输出 5（创建管理员）、输出 8（日志不含凭据）、输出 11（测试控制入口）、“来源地址”一段与时序一节里创建管理员的那两句；[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md) 验收 4 的“登录正常”。社交登录（输出 11 到 16、23、24）与 [`site.oauth-provider`](../../../../../docs/specs/site/oauth-provider.md) 归 t08，本计划只写给它留的接缝（3.2、3.6、3.10 各有一段）。
- ADR 0059（模块包、合同包、依赖白名单、“问身份”）、ADR 0060（Better Auth、库的端点不可从外部到达、库的默认行为收紧、注册码与建账号同一个事务、数字 id）、ADR 0061（每模块一个 SQLite 文件、纯 SQL 只往前的迁移）。
- Task：t07 README（第五、六轮探针的结论、前端要的合同、`anchor` 与最近登录时间两处）；t08 README 与第六轮探针（会话 id 复用）；t12 README 与 [`site.legacy-import`](../../../../../docs/specs/site/legacy-import.md)（旧 id、旧密码格式、最后登录时间、用户名的显示写法、码的使用关系、占位邮箱不能登录）；t10 计划 3.2 的 t07 清单与文末审定。
- 脚手架：t05 计划 3.2（`SiteModule`、`ModuleContext`、`SiteCommand`）、3.8（合同测试底座）与文末四节审定（后面的为准），以及 t05 的审查修正片正在改的 `jobs.ts`、`client-address.ts`（来源地址的规范写法）、`config.ts`、备份命令与底座，按改完之后的样子算。

开发者已定（不再讨论）：账号建在 Better Auth 上；每个账号必须有邮箱，旧账号用 `.invalid` 占位并标“邮箱待补”；不按邮箱自动合并；两种码沿用旧站；合同测试黑盒、只经 HTTP 与命令行、拨时间用测试控制入口；第一版做全；对外 OAuth 按标准 OIDC（t08）。

工作方式：主会话或编码子代理在 worktree 里按第 5 节切片实施，每片一个提交、自跑该片的验证命令；第 4 节的 Spec 改动由主会话在 master 上先改。本 Task 是安全边界，实现审查按高风险后端的快速审查：Opus 先审，omp `@review` 在后台审同一份说明（第 5 节写明哪几片之后交）。

本计划与 t07 README 里第五轮探针的“照抄写法”有一处方向上的不同：README 记的是“用库的登录端点，在 `hooks.after` 里比对哈希、换哈希”；规划时的探针查出库的注册在一个跨 `await` 的事务里算哈希（第 9 节 p3）、库的会话检查读系统时间而没有注入的口子（p2），连同 README 已记的三处，补丁会散在密码回调、请求级状态与 after 钩子三处。本计划推荐的做法是**登录、注册、改密码、管理操作的校验与写入都由模块自己做，库只负责发会话与 Cookie、认 Cookie、登出，以及 t08 的协议部分**（3.4、3.7）。这是第 10 节第 1 条，交主会话定；定成另一种时 3.4、3.7、3.10 要改写，其余各节不变。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 身份库 | `better-auth` 1.7.27，精确版本；同时把 `@better-auth/core` 1.7.27 与 `kysely` 0.29.9 列为直接依赖、锁同一版本 | ADR 0060 已定。要用 core 的 `runWithTransaction`、`getCurrentDBAdapterAsyncLocalStorage`（`better-auth` 不再转出，t07 README 已记）与 kysely 的 `SqliteAdapter`、`SqliteQueryCompiler`、`SqliteIntrospector`（自定义方言，3.3）；三者版本不一致时 bun 会装出两份，库的全局上下文就分成两份 | 用插件 `username`、`admin` 之外的插件：t07 用不到 |
| 库与 SQLite 的连接 | 自己写的 Kysely 方言（约 60 行），交给库 `{dialect, type: "sqlite", transaction: true}` | 库自带的 bun 方言是包内私有文件（`@better-auth/kysely-adapter` 的 `exports` 里没有它），它的连接锁也拿不到；模块自己的 SQL 必须与库的事务排进同一条队列（3.3，探针 p3）。自己写还能把库的事务改成 `BEGIN IMMEDIATE` | 把 `Database` 直接交给库：模块自己的同步 SQL 会落进库正开着的事务、随它回滚（p3 实测）；给模块另开一条连接：同一个进程里两条连接争写锁，`busy_timeout` 期间事件循环停着（t05 `db/open.ts` 的注释） |
| 密码哈希 | `Bun.password`（argon2id，`memoryCost: 19456`、`timeCost: 2`）；旧格式用 `node:crypto` 的 `scrypt` 加 `timingSafeEqual` | 平台自带、在线程池里算，事件循环停顿至多 6 毫秒（p5）；参数取 OWASP 对 argon2id 的最低推荐，2 核上 71 毫秒一次（p5），参数取值交第 10 节第 3 条 | Bun 缺省参数（64 MiB、2 轮）：一次 273 毫秒（p5）；`@node-rs/argon2`、`argon2`：多一个原生依赖，Bun 自带的已够 |
| 请求与响应的 schema、校验 | `typebox`（与统计合同包同为 ^1.3.6），模块里用 `Value.Errors` 算出 `fields` | 仓库与统计合同包已在用；合同包只许依赖它（ADR 0059） | zod：库带着它，但合同包只许 TypeBox |
| 邮箱格式 | WHATWG 的“合法邮箱地址”正则，加 254 个字符上限、拒收 `.invalid` 结尾 | 与浏览器 `type=email` 同一条规则，前后端一致；Spec 只要求“合法的邮箱地址” | `validator` 一类库：为一条正则多一个依赖 |
| 网址 | 平台的 `URL.parse`，只收 `http:`、`https:` | 平台自带 | 正则：网址的语法写不全 |
| 浏览器标识的概要 | 手写约 30 行的规则表（浏览器名、系统名各几条） | Spec 只要两个粗名字（t10 S6 已定形状）；规则表在包内测里逐条覆盖 | `bowser`、`ua-parser-js`：为两个字段多一个依赖，后者 2.x 改了许可证 |
| 限流 | 手写约 80 行：按对齐的时间窗计数的 `Map`，时间取 `ModuleContext.clock` | 状态只在内存、时间要能经测试控制入口拨（Spec 输出 19、“时序与寿命”）；与统计模块 t06 定的做法一致（3.8） | 库自带的限流：键与回应都给不了，已整体关掉（第五轮探针）；`hono-rate-limiter`：不认注入的时钟 |
| 并发哈希的上限与排队 | 手写约 50 行的信号量（并发数、队列长度、等待上限） | 要按 Spec 输出 20 回 `overloaded`，并区分“排满”与“等太久” | `p-limit`、`p-queue`：没有“排满就拒、等超时就拒”的现成组合，包一层省不下代码 |
| 请求体上限 | `hono/body-limit`，16 KiB | 统计模块 t06 同样用它，分块传输也能边读边数 | `Bun.serve` 的全进程上限：站点以后要更大的上传 |
| 生成码与重置的密码 | `node:crypto` 的 `randomBytes`，码用 Crockford base32 的 16 个字符（80 位），重置密码 20 个字符（去掉易混字符后的 57 个字符，约 115 位） | 平台自带；base32 不含易混的字母 | 词表口令：要带一份词表 |

替换已有实现：无（账号模块现在只有空的子应用）。

## 3. 关键设计

### 3.1 `packages/nb-site-identity-contract/src/`：合同包（第 1 片，可以先于实现单独提交）

文件：`errors.ts`、`fields.ts`、`time.ts`、`paths.ts`、`account.ts`、`admin.ts`、`index.ts`（转出全部，保留 `IDENTITY_API_PREFIX`）；测试 `index.test.ts`（已有）、`contract.test.ts`。`package.json` 加运行时依赖 `typebox` ^1.3.6（与统计合同包同版本）。写法照 `nb-site-telemetry-contract/src/ingest.ts`：每个 schema 是 `Type.*` 常量，同名的 `type` 是 `Static<typeof …>`；运行时数组用 `as const`。

**失败码（`errors.ts`）。**

- `IDENTITY_FAILURE_CODES`：`site.accounts` 失败表里有 HTTP 状态的全部码（`validation_failed`、`unauthenticated`、`invalid_credentials`、`account_banned`、`forbidden_origin`、`consent_required`、`registration_closed`、`provider_disabled`、`registration_code_invalid`、`invite_code_invalid`、`username_taken`、`email_taken`、`identity_taken`、`identity_exists`、`last_login_method`、`invite_code_limit`、`rate_limited`、`overloaded`、`unavailable`），加 `site.admin` 的 `forbidden`、`not_found`、`self_forbidden`、`last_admin`。社交与关联的几个码（`provider_disabled`、`identity_taken`、`identity_exists`、`last_login_method`）现在就放：它们在 `site.accounts` 的失败表里，前端的目录覆盖测试要遍历它；实现归 t08。`type IdentityFailureCode`。
- `IDENTITY_FAILURE_STATUS`：每个码的 HTTP 状态，`satisfies Record<IdentityFailureCode, number>`（同统计合同包的 `INGEST_ERROR_STATUS`）。合同测试与模块的出错出口都按它取状态，免得两处各写一份。
- `SOCIAL_ERROR_CODES`：输出 23 能出现在 `social_error` 里的七个码（三个“跳转参数”码加 `email_taken`、`identity_taken`、`identity_exists`、`account_banned`）。现在就放（前端要），t08 实现。
- `ErrorBody`：`{error: {code: IdentityFailureCode, fields?: string[]}}`；`fields` 只在 `validation_failed` 时有，元素是请求体或查询串的键名（输出 22，t10 S9 已写进 Spec）。`additionalProperties: false`，合同测试用它核对“不带文字、堆栈与路径”。
- 对外 OAuth 的 `OAUTH_FAILURE_CODES`（`authorization_expired`、`client_not_found`、`redirect_uri_invalid`）不在本 Task：它们要随 t08 的 OIDC 改写一起定（t08 README），t08 在同一个文件里追加。

**字段规则（`fields.ts`）。** 单独导出的常量，schema 里的 `minLength`、`maxLength` 取自它们：

```ts
export const USERNAME = {minLength: 3, maxLength: 30, pattern: "^[a-z0-9_.]+$"} as const;   // 输入先转小写再比
export const DISPLAY_NAME = {minLength: 1, maxLength: 50} as const;
export const EMAIL = {maxLength: 254} as const;
export const PASSWORD = {minLength: 8, maxLength: 128} as const;
export const URL_FIELD = {maxLength: 500, schemes: ["http:", "https:"]} as const;          // 头像与网站
export const BIO = {maxLength: 200} as const;
export const REGISTRATION_CODE_NOTE = {maxLength: 200} as const;
export const INVITE_CODE_ACTIVE_LIMIT = 10;
export const PAGE = {minPage: 1, minPageSize: 1, maxPageSize: 100, defaultPageSize: 20} as const;
```

长度按 Unicode 码点计（与会话密钥同一种数法）。TypeBox 的 `minLength` 数的是 UTF-16 单元，含四字节字符时两边不同，所以服务端另按码点核对；这一句要写进 Spec（第 4 节 A5）。

**时间（`time.ts`）。** `IsoTimestamp = Type.String({pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"})`：所有时间字段都是它，到毫秒的 UTC（与 `Date.prototype.toISOString` 同形）。`TermsVersion = Type.String({pattern: "^\\d{4}-\\d{2}-\\d{2}$"})`。

**路径（`paths.ts`）。** 相对 `IDENTITY_API_PREFIX` 的路径，带参数的用函数：

```ts
export const IDENTITY_PATHS = {
    register: "/register", login: "/login", logout: "/logout", whoami: "/whoami", meta: "/meta",
    me: "/me", mePassword: "/me/password", meConsent: "/me/consent",
    meSessions: "/me/sessions", meInviteCodes: "/me/invite-codes",
    adminUsers: "/admin/users", adminRegistrationCodes: "/admin/registration-codes",
    adminInviteCodes: "/admin/invite-codes", adminAudit: "/admin/audit",
} as const;
export const identityPath = {
    meSession: (id: number) => `/me/sessions/${id}`,
    meInviteCode: (id: number) => `/me/invite-codes/${id}`,
    adminUser: (id: number) => `/admin/users/${id}`,
    adminUserAction: (id: number, action: "ban" | "unban" | "role" | "revoke-sessions" | "reset-password") => `/admin/users/${id}/${action}`,
    adminRegistrationCode: (id: number) => `/admin/registration-codes/${id}`,
} as const;
```

`me/identities`、`social/:provider/start` 的路径由 t08 加（它们的请求形状随 OIDC 改写定）。

**账号部分（`account.ts`）。** 每项对应的 Spec 输出写在 schema 的注释里：

| schema | 形状（`?` 为可省；`| null` 为可空） | Spec |
|---|---|---|
| `PublicProfile` | `id: integer`、`username`、`displayName`、`avatarUrl \| null`、`website \| null`、`bio \| null`、`role: "user" \| "admin"`、`createdAt` | 术语“公开资料” |
| `RegisterRequest` | `username`、`displayName?`、`email`、`password`、`registrationCode`、`inviteCode?`、`termsVersion`、`overseasStorage: boolean` | 输出 1 到 3 |
| `RegisterResponse` | `{user: PublicProfile}` | 输出 1 |
| `LoginRequest` | `identifier`（用户名或邮箱）、`password` | 输出 4；t08 追加可选的继续令牌（t10 S1） |
| `LoginResponse` | `{user: PublicProfile}` | 输出 4；t08 追加可选的继续地址 |
| `WhoamiResponse` | `{state: "anonymous"}` 或 `{state: "authenticated", user: {id, username, role}}` | 输出 7；不可读时是 503 的 `ErrorBody`（`unavailable`） |
| `MeResponse` | `PublicProfile` 加 `email: string \| null`（待补时为 null）、`emailPending`、`hasPassword`、`consentRequired` | 输出 8、10 |
| `PatchMeRequest` | `displayName?`、`email?`、`avatarUrl? \| null`、`website? \| null`、`bio? \| null`，至少一项 | 输出 8 |
| `ChangePasswordRequest` | `currentPassword?`、`newPassword` | 输出 9 |
| `ConsentRequest` | `termsVersion`、`overseasStorage: boolean` | 输出 10 |
| `SessionItem` | `id`、`createdAt`、`lastUsedAt`、`browser: string \| null`、`os: string \| null`、`current: boolean` | 输出 17 |
| `SessionListResponse` | `{items: SessionItem[]}` | 输出 17 |
| `IdentityItem` | `id`、`provider: "google" \| "github"`、`accountName`、`linkedAt` | 输出 24（前端要，实现归 t08） |
| `InviteCodeItem` | `id`、`code`、`createdAt`、`usedCount`、`maxUses \| null`、`expiresAt \| null`、`usable` | 输出 18 |
| `InviteCodeListResponse` | `{items: InviteCodeItem[]}` | 输出 18 |
| `PatchInviteCodeRequest` | `{disabled: true}` | 输出 18（只能停用） |
| `MetaResponse` | `termsVersion`、`registrationOpen`、`providers: {google: boolean, github: boolean}` | `GET meta` |

请求 schema 都是 `additionalProperties: false`：多出来的键按 `validation_failed` 报，`fields` 里是那个键。`overseasStorage` 是布尔、不是 `true` 字面量：给 `false` 时回 `consent_required` 而不是 `validation_failed`（输出 3 把它归在同意里）。

**管理部分（`admin.ts`）。**

- `PageQuery`：`page?`、`pageSize?`、`anchor?`，查询串里都是字符串，schema 用 `pattern` 限成十进制整数与 `anchor` 的写法；缺省与上下限取 `PAGE`。
- `PageResponse(item, filters?)`：返回 `{items, total, page, pageSize, anchor, counts?}` 的 schema 的函数；有筛选的列表 `counts` 是 `Record<筛选项, integer>`。
- `USER_FILTERS = ["all", "admin", "banned", "email_pending"]`，`REGISTRATION_CODE_FILTERS = ["all", "usable", "exhausted_or_expired", "disabled"]`；查询参数名 `filter`，账号的搜索参数名 `q`（前缀，作用于用户名、邮箱、显示名）。
- `AdminUserItem`：`id`、`username`、`displayName`、`email \| null`、`emailPending`、`role`、`banned`、`createdAt`、`lastLoginAt \| null`。
- `AdminUserDetail`：`AdminUserItem` 加 `avatarUrl`、`website`、`bio`、`hasPassword`、`providers: ("google" \| "github")[]`、`sessionCount`、`registrationCode: {id, code} \| null`、`inviter: {id, username} \| null`。
- `RoleRequest {role}`；`ResetPasswordResponse {password}`；封禁、解封、结束会话没有请求体，成功回 `AdminUserItem`（处置后的状态，免得前端再取一次）。
- `RegistrationCodeItem`：`id`、`code`、`maxUses \| null`、`usedCount`、`expiresAt \| null`、`note \| null`、`disabled`、`usable`、`createdAt`、`createdBy: {id, username} \| null`；`CreateRegistrationCodeRequest`：`maxUses: integer >= 1 \| null`（null 是不限）、`expiresAt? \| null`、`note?`；响应是 `RegistrationCodeItem`（含码）；`PatchRegistrationCodeRequest`：`note? \| null`、`disabled?: true`，至少一项。
- `AdminInviteCodeItem`：`InviteCodeItem` 加 `owner: {id, username}`。
- `AUDIT_ACTIONS`：`user.ban`、`user.unban`、`user.role`、`user.revoke_sessions`、`user.reset_password`、`registration_code.create`、`registration_code.disable`、`admin.cli_upsert`（第 10 节第 4 条），以及 t08 要的 `oauth_client.create`、`oauth_client.update`、`oauth_client.rotate_secret`（现在就放，前端按枚举取文案；只追加）。`AuditItem`：`id`、`createdAt`、`actor: {id, username} \| null`（null 是命令行）、`action`、`target: {type: "user" \| "registration_code" \| "oauth_client", id}`、`params: Record<string, string \| number \| boolean \| null>`。审计的筛选参数 `actorId`、`targetType` 加 `targetId`、`action`，没有 `counts`（这三项不是枚举的筛选项，Spec 的 `counts` 只对“一个筛选项”的列表）。

`anchor` 在合同里是不透明字符串，schema 只限字符集与长度（`^[a-z]{1,2}\\d{1,19}$`），含义在 3.10。

**合同包自己的测试（`contract.test.ts`）。** 码表与 Spec 两张失败表逐个对得上（手写期望值，不从别处算）；`IDENTITY_FAILURE_STATUS` 覆盖每个码；`SOCIAL_ERROR_CODES` 是七个；每个请求 schema 拒收多余的键；`IsoTimestamp` 收 `toISOString()` 的输出、拒收不带毫秒或带时区偏移的写法；字段常量与 schema 的上下限一致。

合同测试包要能用这些 schema 核对响应：它的导入清单现在不许 `typebox`（`nb-site-contract-tests/AGENTS.md`）。推荐放开 `typebox`：它是合同本身的语言，换语言重写被测程序不影响它；放开要改那张表与 `boundary.test.ts`（第 4 节 B5）。

### 3.2 `packages/nb-site-identity/migrations/0001_init.sql`：表与迁移

草稿在探针目录的 `0001_init.sql`，已在真实的迁移执行器上跑过（探针 p9）：`migration.applied`、执行后外键检查重新打开、库在迁移出的表上开着结构检查能注册、审计表的改与删被触发器拒绝。照 `db/migrate.ts` 的规则写得进去：不含 `PRAGMA`、`ATTACH`、`DETACH`、`VACUUM`，不自己开事务或保存点，触发器的 `RAISE` 是固定文字。

**库的四张表。** 由 better-auth 1.7.27 在 `username`、`admin` 两个插件下编译出的结构（探针 p0）逐字抄写，只改一处：每张表的 `"id" integer not null primary key` 改成 `"id" integer primary key autoincrement`。不加 `AUTOINCREMENT` 时 SQLite 把刚删掉的最大 id 发给下一行（t08 第六轮探针）；加了以后“删掉最大 id 的会话后再登录，新会话的 id 更大”成立（探针 p1：会话 1 到 4，删 4 后新会话是 5）。库的列名、声明类型、索引原样保留，不加 `STRICT`：p1 的 B 组加了 `STRICT` 库也能用，但库的 `date` 声明类型在 `STRICT` 下不合法，要改成 `TEXT`，改了以后每次升级库都要多一层对照。库的表保持与库导出的一致，升级时按 ADR 0060 后果第三条比对与手写增量。

| 表 | 本模块怎么用 | 为 t12 准备的 |
|---|---|---|
| `user` | `id` 是账号 id；`name` 是显示名；`email` 存小写；`emailVerified` 恒为 0；`image` 是头像；`username` 存小写、`displayUsername` 存原样；`role` 是 `user` 或 `admin`；`banned` 是 0 或 1，`banReason`、`banExpires` 不用（恒为空） | `id` 由导入显式写入，之后新账号接着发（p1：导入 id 1000 后注册得 1001）；`createdAt` 原样 |
| `session` | 库建、库读；`userAgent` 在建会话的钩子里换成概要（3.5），`ipAddress` 恒为空（3.4） | 不导入（ADR 0060 后果：会话可以丢） |
| `account` | 密码账号一行：`providerId = 'credential'`、`accountId` 是账号 id 的字符串、`password` 是哈希；t08 的上游身份也在这张表 | `password` 可以是旧站格式 `scrypt:<盐>:<十六进制>`（3.7） |
| `verification` | 本 Task 不用；t08 的社交流程状态用它 | 不导入 |

时间列在库的表里是 ISO 字符串（p1 读出来是 `2026-…Z` 的文本），布尔是 0 与 1。

**本模块自己的表（`STRICT`，表名前缀 `identity_`）。**

| 表 | 列 | 键与索引 | 说明 |
|---|---|---|---|
| `identity_registration_code` | `id`、`code`（唯一）、`max_uses`（空为不限，否则大于 0）、`used_count`（缺省 0）、`expires_at`、`disabled_at`、`note`、`created_by`（引用 `user`，空为命令行或导入时找不到人）、`created_at` | `id` 自增；`(created_at, id)` | 码存原文（管理列表要显示码，`site.admin` 输出 4）；t12 原样导入次数、过期、停用、备注与创建者 |
| `identity_invite_code` | `id`、`code`（唯一）、`owner_id`（引用 `user`，非空）、`max_uses`、`used_count`、`expires_at`、`disabled_at`、`created_at` | `id` 自增；`(owner_id, id)`、`(created_at, id)` | 新生成的码 `max_uses`、`expires_at` 都空（输出 18）；旧码保留原值 |
| `identity_profile` | `user_id`（主键，引用 `user`）、`website`、`bio`、`email_pending`（0 或 1）、`last_login_at`、`registration_code_id`、`invite_code_id`、`inviter_id` | 主键 | 每个账号一行，与 `user` 同一事务写；`last_login_at` 是最近一次登录成功的时间（`site.admin` 账号列表要）；三个来源列是“用哪个码注册、谁邀请的” |
| `identity_consent` | `id`、`user_id`、`terms_version`（`GLOB` 限成日期）、`overseas_storage`（0 或 1）、`created_at` | `id` 自增；`(user_id, id)` | 只追加；账号的当前同意是 `user_id` 下 id 最大的一行 |
| `identity_audit` | `id`、`created_at`、`actor_id`（空为命令行）、`action`、`target_type`、`target_id`、`params`（JSON，`json_valid` 检查） | `id` 自增；`(actor_id, id)`、`(target_type, target_id, id)`、`(action, id)` | 两个触发器拒绝改与删（只追加）；`params` 不放密码、哈希与码（3.10） |

不进表的：网站与签名不放进库的 `user` 表（用库的 `additionalFields` 会让库的结构检查与类型都跟着变，自己的表更直接）；邮箱待补的标记放 `identity_profile`，同理。

**接缝。** 账号库里的引用都指向 `user.id`，不指向库的其它表；`target_type` 留了 `oauth_client`。t08 要加的（对外 OAuth 的客户端、授权码、令牌、密钥，以及“上游账号的名字”）用 `0002` 起的迁移另建表：上游账号的名字推荐放自己的 `identity_upstream_name (account_id PRIMARY KEY REFERENCES account(id), name, linked_at)`，不往库的 `account` 表加列（加列后库的结构检查是否容忍没有探，推断容忍，留给 t08 探）。本 Task 的表不引用、不约束这些表。

**`user` 表的删除。** 账号不能删除（`site.accounts` 非目标、`site.admin` 非目标），所以引用 `user` 的外键都不写 `ON DELETE`：误删会被外键拒绝。库的 `session`、`account` 表自带 `on delete cascade`，原样保留。

### 3.3 `packages/nb-site-identity/src/db/connection.ts`：一条连接、一个队列

**问题（探针 p3）。** 把 `bun:sqlite` 的 `Database` 直接交给库时，库用自己的 bun 方言，事务是延迟的 `BEGIN`，而且注册端点把整段（含算密码哈希）包在 `runWithTransaction` 里：哈希的 300 毫秒里事务一直开着。这期间本模块别处的一句同步写会落进库的事务（`inTransaction=true`），注册失败时被一起回滚（写入的行消失）；库的其它查询要等这次哈希（`get-session` 等了 250 毫秒）。这正是 `ModuleContext.db` 注释里禁止的“事务跨 `await` 会把别的语句收进来”。

**做法。** 账号模块独占 `ModuleContext.db` 这条连接，在它上面包一个 `IdentityConnection`（探针里的 `conn.ts` 是原型）：

- 一把异步互斥锁就是这条连接的队列。库经自定义的 Kysely 方言走它：`acquireConnection` 拿锁、`releaseConnection` 放锁，事务用 `BEGIN IMMEDIATE`（写锁在开头拿，不在中途升级时撞 `SQLITE_BUSY`）。库每条不在事务里的查询各拿一次锁；库的事务从 `BEGIN` 到 `COMMIT` 一直持锁。
- 模块自己的读写只经 `run(fn)`：`fn` 是同步函数，在锁里用 `db.transaction(fn).immediate()` 一次做完。同步函数里没有 `await`，别的请求插不进来。
- 重入：当前异步上下文已经持锁时（模块自己的 `run` 里，或库的事务里：用 `@better-auth/core/context` 的 `getCurrentDBAdapterAsyncLocalStorage()` 看 `isTransactionActive`），`run` 不再拿锁，直接在当前事务里执行（`bun:sqlite` 在已有事务里用保存点）。探针 p3：库的事务里的钩子调 `run` 不死锁，写入随库的事务一起回滚（p3b 记下方言收到的语句是 `BEGIN IMMEDIATE`、钩子、`ROLLBACK`，钩子写的行不在）；另一请求的写等了 244 毫秒，落在库的事务之外、保住了。
- 账号模块的事务（3.7 的登录与注册）用库的 `runWithTransaction(adapter, fn)`：里面既能调库的内部接口（建会话），又能调 `run`（重入），一起提交或回滚（探针 p6）。

**调用方要守的约束**（写进 `connection.ts` 的文件注释）：

1. 事务里只做数据库的事。算哈希、等限流、读请求体都在事务之外；`runWithTransaction` 的 `fn` 里不 `await` 数据库以外的东西。
2. 不在事务的异步上下文里派生活儿（`setTimeout`、不等待的 Promise）：它们继承异步上下文，会被当成事务的一部分，事务提交以后再执行就落在没有事务的状态里，或者随事务回滚（探针 p6 的“事务里派生的活儿随它回滚”）。任务调度（`ModuleContext.jobs`）与日志不受影响：日志不碰库，任务由调度器在自己的上下文里起。
3. 模块的其它代码不直接用 `ModuleContext.db`；`connection.ts` 是唯一持有它的地方。包内测试扫源码检查这一条（`connection.ts` 与模块入口以外的源码不出现 `ctx.db`），不靠约定。

**错误。** 这条连接上的 `SQLiteError` 按 `code` 归类（不按文字）：`SQLITE_BUSY`、`SQLITE_LOCKED`、`SQLITE_IOERR*`、`SQLITE_FULL`、`SQLITE_READONLY`、`SQLITE_CANTOPEN`、`SQLITE_CORRUPT` 是“库不可用”，出口回 503 `unavailable`（`site.accounts` 失败表）；`SQLITE_CONSTRAINT_*` 由调用处先查后写避开（3.7），走到出口时是程序错误，回 500 `internal`。库不包装数据库错误（探针 p10）：别的连接持写锁时，经 `auth.api` 调的库端点抛出的就是原样的 `SQLiteError`（`code` 为 `SQLITE_BUSY`），模块自己的 `run` 也一样。经 `auth.handler` 走的请求（只剩登出与 t08 的协议端点，3.6）缺省时被 better-call 的路由吞掉：它对非 `APIError` 直接 `console.error` 整个错误（含堆栈与源码路径，绕过 `logger.disabled`），再回 500 空体；配 `onAPIError: {throw: true}` 后错误从 `handler` 抛出、交给模块的出错出口，`APIError` 照旧变成响应（p10：401）。所以装配时打开它（3.4）。

**统计模块那一侧不受影响**：每个模块有自己的连接（t05 的模块接口），这把锁只管账号库。

### 3.4 `packages/nb-site-identity/src/auth.ts`：Better Auth 的装配

```ts
betterAuth({
    baseURL: config.siteUrl,
    basePath: "/api/identity/auth",          // 库的路由前缀；本 Task 不把 auth.handler 挂到任何路径上（3.6）
    secret: config.sessionSecret,             // NB_SITE_SESSION_SECRET，t05 已校验至少 32 个码点
    database: {dialect: connection.dialect(), type: "sqlite", transaction: true},
    advanced: {
        database: {generateId: "serial"},     // 数字 id 交给 SQLite 的 AUTOINCREMENT
        cookiePrefix: "nbsite",
        useSecureCookies: true,               // 与站点地址的协议无关，恒为 Secure（输出 5）
        ipAddress: {disableIpTracking: true}, // 会话表不存来源地址（第 10 节第 10 条）
    },
    rateLimit: {enabled: false},              // 限流自己做（3.8）
    emailAndPassword: {enabled: true, disableSignUp: true, password: {hash, verify}}, // 两个函数都经哈希限额（3.7）
    session: {expiresIn: config.sessionDays * 86400, updateAge: 86400, disableSessionRefresh: true, cookieCache: {enabled: false}},
    account: {accountLinking: {disableImplicitLinking: true}},   // ADR 0060 决策 5 第三条；本 Task 没有上游，先打开
    telemetry: {enabled: false},              // 库自带的遥测：缺省关，但环境变量 BETTER_AUTH_TELEMETRY 能把它打开，显式关掉
    onAPIError: {throw: true},                // 非 APIError 抛给模块的出错出口，不让 better-call 打印整个错误（探针 p10）
    logger: {level: "warn", log: (level, message) => log[level === "error" ? "error" : "warn"]("identity.lib", {message})},
    databaseHooks: {session: {create: {before: stampSession}}},
    plugins: [username({minUsernameLength: 3, maxUsernameLength: 30, usernameValidator, usernameNormalization}), admin(), nbSession()],
});
```

- **插件。** `username`：给 `user` 表加 `username`、`displayUsername` 两列，规则与输出 1 的字段规则同一份（t08 的社交注册经库建账号时用到）。`admin`：给 `user` 加 `role`、`banned` 等列，并在建会话前拒绝被封禁的账号（探针 p4 的“验证之后、发会话之前被封禁”就是被它拦下的）。它的管理端点不对外，管理接口全是自家路由（3.10）。`nbSession`：本模块自己的小插件，两个只供服务端调用的端点（`metadata: {SERVER_ONLY: true}`，经 `handler` 访问是 404，探针 p4）：`issueSession({userId, userAgent})` 调 `internalAdapter.createSession(userId, false, {userAgent})` 再 `setSessionCookie`；`refreshSession({token})` 更新到期时间并重发同一个 Cookie（3.5）。模块用 `auth.api.issueSession({body, headers, returnHeaders: true})` 拿到 `Set-Cookie`。Cookie 的名字与属性只由库的 `setSessionCookie` 决定，模块不自己拼。
- **关掉或不用的。** 限流整体关；会话缓存 Cookie 关（提案“官方站重写”4.5 一节：会话存数据库、不开会话缓存，封禁才能立即生效）；库的注册端点关（`disableSignUp`），库的登录、改密码、管理端点在本 Task 一个都不对外。库的遥测关。
- **id 的生成。** `generateId: "serial"`：库插入时不带 `id`，由表的 `AUTOINCREMENT` 发号；API 里库把 id 读成字符串（探针 p1），模块对外一律转成整数（合同里 `id` 是 `integer`）。
- **Cookie。** 名字 `__Secure-nbsite.session_token`；`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`、没有 `Domain`（作用域是站点地址本身），`Max-Age` 是会话时长（探针 p2：缺省前缀下是 `__Secure-better-auth.session_token`、`Max-Age=2592000`，属性同上）。值是库签过名的令牌。
- **会话时长。** `NB_SITE_IDENTITY_SESSION_DAYS`，缺省 30（第 4 节 A1）。
- **数据库连接。** 只经 3.3 的自定义方言；库不自己开连接（方言之外它没有拿到路径或 `Database`）。库的结构检查保持打开：启动时表少了列会报 `SCHEMA_MISMATCH`（探针 p1 的 C 组），模块把它当启动失败。
- **日志。** 库的日志只取级别与 `message`，不带它的附加参数（可能是请求或错误对象）；经 `ModuleContext.log` 出去，事件名 `identity.lib`。
- **`stampSession`（建会话前的钩子）。** 把 `createdAt`、`updatedAt` 改成 `clock.now()`，`expiresAt` 改成 `clock.now() + 会话时长`（探针 p2：钩子改的时间如实落库）；`userAgent` 已由 `issueSession` 换成概要（3.5），钩子不再碰。

**README 记的三处落在哪一层。**

| 事 | 落点 | 时序 |
|---|---|---|
| 换哈希（旧站格式登录成功后换成新格式） | 自家登录路由（3.7），不在库的钩子里 | 校验通过并发出会话以后，在事务之外算新哈希，再用一句“哈希还是旧值才改”的条件更新写回 |
| 重置与登录并发 | 自家登录路由的发会话事务（3.7） | 校验在事务外；事务里先复核“账号没被封、哈希还是校验时那一份”，再发会话；管理员重置与封禁也是一个 `BEGIN IMMEDIATE` 事务，两者在队列里排成先后（探针 p4、p6） |
| 限流自己做 | Hono 一层的中间件与路由里（3.8），库的限流关 | 请求进入路由时先查来源地址与计数，再做别的；用户名失败计数在校验失败后加 |

### 3.5 `packages/nb-site-identity/src/session.ts`：读会话、到期、延长、最后使用时间

库读会话只认系统时间，不认测试控制入口的时钟（3.14 与探针 p2）：模块时钟拨后 31 天，库的 `getSession` 仍说有效；库只在系统时间过了 `expiresAt` 时删行并回空。库也不能关掉自己的判断再交给模块。所以会话的有效性由模块在库的结果上再判一次：

```ts
async function readSession(headers): Promise<CurrentSession | null>
// 1. auth.api.getSession({headers})：库按 Cookie 签名与令牌查出 {session, user}；查不到或签名不对时为 null。
// 2. session.expiresAt <= clock.now()：当作到期。删掉这一行（run 里一句 DELETE），回 null，并让响应带清除 Cookie 的 Set-Cookie。
// 3. user.banned = 1：回 null（封禁时已删光会话，这里是兜底；导入的数据里可能有封禁账号的残留会话）。
// 4. 其余：回 {session, user, consentRequired}，consentRequired 由同意记录与当前条款版本算出（输出 8、10）。
```

- **延长（输出 5：使用中延长，每天至多一次）。** 在 `requireSession` 中间件里（`whoami` 不走它）：`session.expiresAt - 会话时长 + 1 天 <= clock.now()` 时调 `auth.api.refreshSession({body: {token}, returnHeaders: true})`：把 `expiresAt` 改成 `clock.now() + 会话时长`、`updatedAt` 改成现在，并经 `setSessionCookie` 重发同一个令牌的 Cookie（新的 `Max-Age`）。库自己的延长关掉（`disableSessionRefresh`；探针 p2：关掉以后库不改行），因为它按系统时间算、合同测试拨不动它。这一步与库的公式相同（库的判断也是“到期时间减时长加更新间隔”）。
- **最后使用时间（输出 17）。** 用 `session.updatedAt`。除了延长时更新，`requireSession` 在 `updatedAt` 早于一小时前时更新它（一句 `UPDATE session SET "updatedAt" = ? WHERE id = ?`），所以列表里的最后使用时间精确到一小时以内。一小时的粒度是为了不让每个请求都写库：Spec 没写精度（第 4 节 A4）。库不读 `updatedAt` 做判断（推断：库的延长只看 `expiresAt`，见上；源码里没搜到别的用法），自己改它不影响库。
- **`whoami` 不延长、不写。** 只做第 1 到 3 步里的读；第 2 步遇到到期时也不删行（删交给下一次正常请求或清理任务），只回 `anonymous`。这样 `whoami` 永不写账号库，统计模块持锁的用例（`site.telemetry-ingest` 验收 4）与账号库的写锁都不影响它。
- **浏览器概要（输出 17）。** 建会话时把 `User-Agent` 换成 `{"browser":…,"os":…}` 的 JSON 存进 `session.userAgent`，原始的浏览器标识不落库；列表按 JSON 读回，认不出的项为 null。识别用一张手写的规则表（Edge、Chrome、Firefox、Safari、Opera、三星浏览器、微信内置；Windows、macOS、iOS、Android、Linux、ChromeOS），先匹配先赢，有表驱动的单元测试。不引第三方解析库：只要两个名字，库的体积与更新节奏不值（技术选型表已列）。
- **会话失效的四种变更（输出 6）**都直接删 `session` 表里该账号的行（3.10、3.7），不靠库的钩子：删行以后库的 `getSession` 查不到令牌，立即无效。
- **清理任务。** 账号模块的定时任务 `purge`（名字照统计模块的写法，模块内唯一；第 4 节 A11）：每 10 分钟一次、启动后先跑一次，删 `expiresAt <= clock.now()` 的会话行，并清掉限流表里过期的窗口（3.8）。合同测试用 `runJob` 触发，不等真实时间。

### 3.6 `packages/nb-site-identity/src/app.ts`、`errors.ts`、`middleware.ts`：路由、出错出口、来源头、同意门槛

**挂载。** `createIdentityModule` 返回的 `site` 是挂在 `/api/identity/v1` 下的 Hono 子应用，全部接口都是自家路由；库的 `auth.handler` 在本 Task 不挂到任何路径上（只经 `auth.api` 在进程内调用），所以“库自带的其它端点从外部不可到达”在本 Task 自然成立。t08 要对外的标准 OAuth 端点与上游回调时，在 `/api/identity/auth` 下按“方法加路径”的白名单挂 `auth.handler`（ADR 0060 决策 3），白名单之外回 404；接缝是 `app.ts` 里一个空的白名单表与它的测试。

**接口到实现的映射。** “库”指经 `auth.api` 调库的内部端点，不对外。

| 接口 | Spec | 实现 | 用到的库 | 成功的响应 |
|---|---|---|---|---|
| `POST register` | 输出 1 到 3 | 自家路由（3.7） | `runWithTransaction`、`issueSession` | `RegisterResponse` |
| `POST login` | 输出 4、19 到 21 | 自家路由（3.7） | `runWithTransaction`、`issueSession` | `LoginResponse` |
| `POST logout` | 输出 5 | 自家路由包库 | `auth.api.signOut({headers, returnHeaders: true})`：删当前会话行、带清除 Cookie 的 `Set-Cookie`；没有会话时也回成功 | `{}` |
| `GET whoami` | 输出 7 | 自家路由（3.11） | `getSession` | `WhoamiResponse` |
| `GET meta` | `GET meta` | 自家路由，读配置 | 无 | `MetaResponse` |
| `GET me`、`PATCH me` | 输出 8 | 自家路由，读写在 `run` 里 | 无 | `MeResponse` |
| `POST me/password` | 输出 9 | 自家路由（3.7） | 无 | `{}` |
| `POST me/consent` | 输出 10 | 自家路由：追加一行同意记录 | 无 | `MeResponse` |
| `GET me/sessions`、`DELETE me/sessions/:id` | 输出 17 | 自家路由，直接读写 `session` 表；别人的或不存在的 id 回 404 `not_found` | 无 | `SessionListResponse`、`{}` |
| `GET`、`POST me/invite-codes`、`PATCH me/invite-codes/:id` | 输出 18 | 自家路由 | 无 | `InviteCodeListResponse`、`InviteCodeItem`、`InviteCodeItem` |
| `site.admin` 的全部接口 | `site.admin` 输出 1 到 10 | 自家路由（3.10） | 无（库的 `admin` 插件端点不用） | 见 3.10 |
| `me/identities`、`social/:provider/start` | 输出 11 到 16、23、24 | 本 Task 不建；t08 | | |

合同包补两个小 schema：`EmptyResponse`（`{}`，`additionalProperties: false`）；`DELETE` 的 id 不是正整数时回 `validation_failed`、`fields: ["id"]`。

**出错出口（`errors.ts`）。** 子应用的 `onError` 与 `notFound` 是唯一的出口，输出都是 `ErrorBody`：

- 模块内部抛 `IdentityFailure(code, fields?, retryAfterSeconds?)`，出口按 `IDENTITY_FAILURE_STATUS` 取状态；`rate_limited` 带 `Retry-After`。
- 库的 `APIError`：经 `auth.api` 调用时只会在三处出现（`issueSession` 被 `admin` 插件拒绝发会话、`signOut`、`getSession`）。出口不翻译库的错误码文字，调用处各自把它换成本模块的码（发会话被拒是 `account_banned`，3.7）；漏到出口的 `APIError` 当程序错误：日志记 `errorType`，回 500 `{"error":{"code":"internal"}}`。
- `SQLiteError` 按 3.3 的码表分：库不可用回 503 `unavailable`；其它回 500 `internal`。
- 子应用的 `notFound` 回 404 `{"error":{"code":"not_found"}}`。站点根的 404 与 500 是 `{"code":…}` 的形状（t05 的 `site.ts`）：账号前缀之下由子应用接管，形状与 `site.accounts` 的错误形状一致。`internal` 不在 `site.accounts` 的失败表里（第 4 节 A3）。
- 响应体不带文字、堆栈与路径（输出 22）；日志只记 `errorType` 与码，不记请求体（密码）。

**请求体。** `hono/body-limit` 限 16 KiB；超出、不是 JSON、不是对象时回 `validation_failed`、`fields: []`（第 4 节 A3）。之后按合同包的 TypeBox schema 校验（`Value.Errors`），把出错路径的第一段键名去重后放进 `fields`；然后按码点核对长度（3.1）。

**来源头（`site.accounts` 输入一节）。** `POST`、`PATCH`、`DELETE` 先比 `Origin` 头与站点地址的 origin：缺或不同回 `forbidden_origin`。放在子应用最前面，先于限流与会话。

**同意门槛（输出 10）。** `requireSession` 中间件读出会话后，`consentRequired` 为真且路由不在放行表里时回 `consent_required`。放行表：`GET whoami`（它不走 `requireSession`）、`GET me`、`POST me/consent`、`POST logout`。门槛只装在账号子应用里（含 `admin/*`；t08 的 `oauth/*` 自家路由也挂在同一个子应用里，自动在内）；别的模块的接口不经它（t10 D 段 S10 已写进 Spec）。`PATCH me` 在门槛之内：缺同意时不能改资料，只能补交（照 Spec 原文的放行表）。

**角色门槛。** `admin/*` 的中间件在同意门槛之后：会话的 `role` 不是 `admin` 回 `forbidden`（`site.admin` 失败表）。

### 3.7 `src/password.ts`、`src/hash-limiter.ts`、`src/login.ts`、`src/register.ts`、`src/change-password.ts`

**密码格式（`password.ts`）。** 两种前缀，按前缀分派（ADR 0060 后果第二条）：

- 新格式：`Bun.password.hash(pw, {algorithm: "argon2id", memoryCost: 19456, timeCost: 2})`，存 PHC 串（`$argon2id$v=19$m=19456,t=2,p=1$…`）；校验用 `Bun.password.verify`，参数从串里读，所以以后调参数不影响已存的哈希。
- 旧站格式：`scrypt:<盐>:<64 字节的十六进制>`，Node 的 `crypto.scrypt` 缺省参数（N=16384、r=8、p=1），盐按字符串用（t01 记录与 t02 探针的写法；旧站源码没有在本次核对，第 11 节）。校验用异步的 `crypto.scrypt` 加 `timingSafeEqual`。
- 都不是：校验恒为假，日志记一条 `identity.password_format_unknown`（只带账号 id）。库缺省的 `hexsalt:hexkey` 格式（探针 p1）不会出现：库的哈希函数换成了上面这两个。
- `needsRehash(hash)`：旧站格式为真；argon2id 但参数低于当前配置时也为真（以后提参数时用到）。

**算多久、占多少（探针 p5，`taskset` 限 2 核，机器负载约 9）。**

| 参数 | 一次 | 8 个同时 | 常驻内存峰值 | 事件循环最大停顿 |
|---|---|---|---|---|
| Bun 缺省（64 MiB，t=2） | 273 ms | 1057 ms | 105 涨到 172 MB | 不超过 6 ms |
| 19 MiB，t=2（推荐） | 71 ms | 324 ms | 60 涨到 82 MB | 不超过 6 ms |
| 46 MiB，t=1 | 101 ms | 447 ms | 87 涨到 136 MB | 不超过 6 ms |
| 旧站 scrypt 校验 | 63 到 65 ms | | | |

`Bun.password.hash` 与 `verify` 的异步版在线程池里算，不在事件循环上（停顿都在 6 毫秒以内）；同步版 `hashSync` 会把事件循环停住 56 到 313 毫秒，代码里不用它。2 核上同时大约算两个，再多只是排队。推荐 19 MiB、t=2：这是 OWASP 给 argon2id 的最低档之一，2 GB 的机器上并发 2 个时常驻内存只多约 20 MB（64 MiB 档多约 67 MB）；64 MiB 档单次 273 毫秒，登录的响应时间与内存都翻了几倍（第 10 节第 3 条）。

**哈希限额（`hash-limiter.ts`，输出 20）。** 一个手写的计数信号量（约 50 行），所有哈希与校验（登录、注册、改密码、管理员重置、创建管理员的命令、旧格式换新）都经它：

- 同时在算的至多 `NB_SITE_IDENTITY_HASH_CONCURRENCY` 个（缺省 2）。
- 排队的至多 `NB_SITE_IDENTITY_HASH_QUEUE` 个（缺省 64）：队满时新请求立即回 `overloaded`。
- 排队超过 5 秒的请求出队并回 `overloaded`。这 5 秒是真实时间（`setTimeout`），不走模块时钟：它度量的是机器忙不忙，测试控制入口拨钟不该让排队的请求超时。包内测试给信号量注入计时器。
- 旧格式换新用 `tryAcquire`（不排队）：忙时跳过，下次登录再换。
- 过载在登录与注册里一律回 503 `overloaded`，不泄露账号是否存在：不存在的账号也要算一次假校验（见下），同样经限额。

**登录（`login.ts`，输出 4、19、20、21）。**

1. 来源头（3.6 的中间件）。`clientAddress(c)` 为 null 回 `forbidden_origin`（输出 19）。
2. 校验请求体：`identifier` 1 到 254 个码点；`password` 1 到 128 个码点。登录不查密码的下限 8：旧站导入的密码可能更短（旧站的规则没有核对），查下限会把这些人锁在外面（第 4 节 A6）。
3. 限流（3.8）：来源地址每 5 分钟 30 次、来源地址加用户名每 5 分钟 10 次，每次尝试都计。用户名取规范化后的 `identifier`（转小写；是邮箱时就是那个邮箱）。
4. 同一个用户名在这一小时里已经失败 20 次以上时，先等 2 秒（真实时间，包内测试注入），成功的登录也等（输出 19 原文“超过后每次登录先等 2 秒”）。
5. 找账号：`identifier` 含 `@` 时按邮箱找，并排除邮箱待补的账号（占位邮箱不能登录，`site.legacy-import`）；否则按用户名找。取出 `user` 与 `providerId = 'credential'` 的那一行 `account`。
6. 校验：账号不存在或没有密码时，拿启动时用随机密码生成的一份假哈希校验一次，结果当假。这样三种失败都算一次同样参数的 argon2id（探针 p4 在 Bun 缺省参数下的中位数：不存在 236.8、没有密码 227.6、密码错 265.9、密码对 245 毫秒，相差在同一量级的抖动里）。库自己的 `sign-in/username` 在账号没有密码时跳过哈希（读源码所见），这也是不用库的登录端点的原因之一（第 10 节第 1 条）。旧站格式的账号走 scrypt（64 毫秒），比 argon2id 略快：账号存在与否仍分辨不出，但能分辨出“这是旧站导入还没换过格式的账号”，记为已知限制（第 8 节）。
7. 校验失败：这个用户名的失败计数加 1，回 `invalid_credentials`。
8. 校验通过但账号被封禁：回 `account_banned`。放在校验之后，不让不知道密码的人试出谁被封了。
9. 发会话，一个事务（`runWithTransaction`，探针 p6）：复核 `banned` 仍为 0、`account.password` 仍是第 6 步校验的那一份；`issueSession`；把 `identity_profile.last_login_at` 写成现在。复核时哈希变了：退出事务，用这次的密码对新哈希再校验一次（另一个并发登录刚把旧格式换成新格式时会这样，探针 p4 的 8 个并发旧格式登录全都成功，就靠这一步）；对上了重进事务，至多两轮；对不上回 `invalid_credentials`（被改或被重置了，`site.accounts` 时序“改密码或重置密码与登录并发”）。
10. 提交以后：`needsRehash` 为真时用 `tryAcquire` 算新哈希，写回用条件更新 `UPDATE account SET password = ? WHERE id = ? AND password = ?`（旧值）：这期间被改或被重置的密码不会被覆盖（输出 21；探针 p4：8 个并发只换了一次，最后是 `$argon2id$`）。
11. 回 `LoginResponse` 与 `issueSession` 给的 `Set-Cookie`。

这一串的并发性质（探针 p4、p6 都在真实的库与自定义方言上跑过）：

- 封禁在校验之后、发会话之前完成：第 9 步的复核或 `admin` 插件的建会话钩子拒绝，回 `account_banned`，不留会话。
- 封禁在发会话的事务开着时到达：封禁的事务在队列里等这次登录提交，然后删掉这个账号的全部会话，包括刚发的这个（p6 的 `waitsForLibTx=1`，被封账号最后 0 个会话）；之后的登录回 `account_banned`。
- 重置在校验之后、发会话之前完成：第 9 步复核发现哈希变了，再校验对不上，回 `invalid_credentials`，没有会话（验收 7）。
- 建会话的钩子里才封禁：`admin` 插件的检查已经过了，会话照建，但第 9 步的复核在同一个事务里，看到封禁后回滚（p4 的“钩子里封禁”）。

**注册（`register.ts`，输出 1 到 3）。**

1. 来源头；`clientAddress(c)` 为 null 回 `forbidden_origin`；限流：来源地址每小时 5 次，每次尝试都计。
2. 注册没开放回 `registration_closed`。
3. 校验字段回 `validation_failed`；邮箱以 `.invalid` 结尾时也是（占位后缀留给导入，第 4 节 A13）。
4. 条款版本不是当前版本、或 `overseasStorage` 不是 `true`：回 `consent_required`。
5. 预检（只读，一次 `run`）：注册码不可用回 `registration_code_invalid`；有邀请码且不可用回 `invite_code_invalid`；用户名被占回 `username_taken`；邮箱被占回 `email_taken`。先查码再查占用：没有可用注册码的人试不出哪些用户名与邮箱已被注册（第 4 节 A7 写进 Spec）。
6. 经限额算密码哈希（事务之外）。
7. 一个事务：条件扣注册码（`UPDATE … SET used_count = used_count + 1 WHERE code = ? AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses)`，影响 0 行回 `registration_code_invalid`）；有邀请码时同样扣；再查一次用户名与邮箱（预检之后可能被别人占了），占了回对应的码、事务回滚、码不被扣；写 `user`、`account`、`identity_profile`（含注册码、邀请码与邀请人）、`identity_consent`；`issueSession`。写入用自己的 SQL，列的存法照库的（ISO 时间字符串、布尔 0 与 1，探针 p1）。占用靠先查后写，不靠 `UNIQUE` 冲突的报错文字分辨是哪一列（探针 p6 里库的报错只有 `UNIQUE constraint failed: user.username` 这样的文字）；唯一约束仍在，作为兜底，撞到时回 500，说明先查后写有漏洞。
8. 回 `RegisterResponse` 与 `Set-Cookie`（会话在响应返回时已可用，时序一节）。

探针 p6：同一个只剩一次的码 8 个并发注册，1 个成功、码用了 1 次、只多 1 个账号；用户名重复时码没被扣、没有会话（验收 1、2）。

**改密码（`change-password.ts`，输出 9）。** `requireSession`；限流按账号每小时 5 次；`newPassword` 8 到 128 个码点。

- 有密码：要 `currentPassword`，缺了是 `validation_failed`；经限额校验，不对回 `invalid_credentials`。
- 没有密码：不看 `currentPassword`，直接设。
- 经限额算新哈希；一个事务：有密码时条件更新（`password` 仍是刚校验的那份，否则回 `invalid_credentials`），没有密码时插入 `credential` 那一行（这时已有了就回 `invalid_credentials`：说明别处刚设了密码）；删掉这个账号除当前会话以外的全部会话（输出 6、9 的原文；与 ADR 0060 决策 5 不一致，第 10 节第 6 条）。
- 回 `{}`。

### 3.8 `src/rate-limit.ts`：限流（输出 19）

照统计模块的限流器（t06 计划 3.5）的做法，本模块自己一份：

```ts
export function createWindowCounter(options: {limit: number; windowMs: number; maxKeys: number; now: () => number}): {
    take(key: string): {ok: true} | {ok: false; retryAfterSeconds: number};   // 计一次；超限时不计入
    count(key: string): number;                                                // 当前窗口里的计数（失败计数用）
    add(key: string): void;                                                    // 只加不判（失败计数用）
    sweep(): void;                                                             // 清掉已过去的窗口（清理任务调用）
};
```

| 计数器 | 键 | 窗口与上限 | 何时计 |
|---|---|---|---|
| 登录·来源 | 来源地址的键 | 5 分钟 30 次 | 第 3 步，每次尝试 |
| 登录·来源加用户名 | 来源地址的键加用户名的摘要 | 5 分钟 10 次 | 来源这一关过了以后，每次尝试 |
| 登录·失败 | 用户名的摘要 | 1 小时，20 次以上开始等 2 秒，不拒绝 | 第 7 步，校验失败时 `add` |
| 注册 | 来源地址的键 | 1 小时 5 次 | 第 1 步，每次尝试 |
| 改密码 | 账号 id | 1 小时 5 次 | 每次尝试 |

- **窗口。** 按 `clock.now()` 对齐的窗口（`Math.floor(now / windowMs)`）：合同测试用 `advanceClock` 跨窗口。跨边界时短时间里可以到两倍，与统计模块同一种口径（第 4 节 A8 写进 Spec）。`Retry-After` 是到窗口结束的秒数向上取整，至少 1。
- **键。** 来源地址已由入口规范化；IPv4 用地址本身，IPv6 取前 64 位（同统计模块）。键里含用户名的，用 SHA-256 的前 16 字节代替原文：用户名或邮箱至多 254 个字符，原文做键时 10 万个键能占几十 MB，摘要定长。
- **上限。** 每个计数器至多 10 万个键：满了以后窗口内新出现的键，`take` 一律拒绝（回 `rate_limited`），失败计数一律当作已过阈值（先等 2 秒）。两种都是“宁可错拒或变慢，不让内存无限长”。
- **取不到来源地址。** 登录与注册回 `forbidden_origin`（输出 19 原文），不并进任何键。改密码按账号计，不需要来源地址。
- **状态只在内存里**，重启清零（`site.accounts` 时序一节原文）；清理任务 `purge` 顺带调 `sweep`（统计模块收口审查第 17 条的做法）。

**各做一份还是共用。** 推荐各做一份：两个模块包互不依赖（t05 的边界），共用的东西只能放进入口（`nb-site-server` 经 `ModuleContext` 提供一个限流服务）或新建一个小包。每份不到 100 行、没有外部依赖，而两边的口径不全一样（统计模块三个写入口合计、只有一种窗口；这里五个计数器、两种窗口、多了失败计数）；为它改模块接口或多一个包，收益抵不上。出现第三个用法时再抽（第 10 节第 5 条）。

### 3.9 `src/me.ts`、`src/sessions.ts`、`src/invite-codes.ts`、`src/meta.ts`

- **`GET me`**：公开资料加 `email`（待补时为 null）、`emailPending`、`hasPassword`（有 `credential` 那一行）、`consentRequired`。
- **`PATCH me`**：至少一项，否则 `validation_failed`、`fields: []`。邮箱：转小写、按字段规则与 `.invalid` 后缀校验；在一个事务里查占用（占了回 `email_taken`）、写入、清掉 `email_pending`。头像、网站：`URL.parse` 后协议只许 `http:`、`https:`，给 null 清空。签名、显示名按码点数长度。用户名不在可改字段里，带了就是多余的键（`validation_failed`）。
- **`POST me/consent`**：`termsVersion` 不是当前版本或 `overseasStorage` 不是 `true` 回 `consent_required`；合格时追加一行同意记录，回新的 `MeResponse`（`consentRequired` 变成 false）。
- **会话列表**：这个账号的全部未到期会话，按建立时间倒序、再按 id 倒序；`current` 比对当前会话的 id。`DELETE me/sessions/:id`：不是自己的或不存在回 404 `not_found`；结束的是当前会话时响应带清除 Cookie 的 `Set-Cookie`。
- **邀请码**：列表是自己的全部码（含停用与用完的），按建立时间倒序、再按 id 倒序；`usable` 是“没停用、没过期、没用完”。`POST` 在一个事务里数自己还能用的码，已有 10 个回 `invite_code_limit`，否则生成一个：16 个字符的 Crockford base32（`randomBytes(10)`，80 位）。`PATCH` 只收 `{disabled: true}`：写 `disabled_at`，已停用的再停用照样成功；不是自己的回 `not_found`。
- **码的比对**：注册码与邀请码都按存的原文精确比对（去掉首尾空白）。新生成的是大写字母与数字；旧站导入的码保留原样（`site.legacy-import`），所以不转大小写。
- **`GET meta`**：读配置；本 Task 里 `providers` 恒为 `{google: false, github: false}`，t08 接上配置。

### 3.10 `src/admin/`：管理接口与审计（`site.admin`）

**每个处置是一个同步事务。** 封禁、解封、改角色、结束会话、重置密码、发放与停用注册码：都在一次 `run` 里做完“检查、改字段、删会话、写审计”，审计与操作同时生效（输出 8）。两个管理员同时处置同一个账号时，两个事务在队列里排成先后，各写一条审计，最终状态是后完成的那次（时序一节）。不经库的 `admin` 插件端点：插件的封禁在删会话时走库的 `session.delete` 钩子，与审计不在一个事务里。

| 接口 | 检查 | 改动 | 审计的 `params` |
|---|---|---|---|
| `POST users/:id/ban` | 账号存在（否则 `not_found`）；不是自己（`self_forbidden`）；封了之后还剩未封禁的管理员（`last_admin`） | `banned = 1`；删全部会话；t08 起撤销 OAuth 令牌 | `{}` |
| `POST users/:id/unban` | 存在 | `banned = 0`（不恢复会话） | `{}` |
| `POST users/:id/role` | 存在；不是自己；降级之后还剩未封禁的管理员 | 改 `role`；角色真的变了才删全部会话 | `{"from": 旧, "to": 新}` |
| `POST users/:id/revoke-sessions` | 存在 | 删全部会话（对自己也可以，当前会话一起结束） | `{"count": 删掉的条数}` |
| `POST users/:id/reset-password` | 存在 | 事务外经限额算新密码的哈希；事务里写 `credential` 那一行（没有就插入）、删全部会话、t08 起撤销令牌 | `{}`（新密码不进审计与日志） |
| `POST registration-codes` | `maxUses`、`expiresAt`、`note` 合规则 | 生成 16 个字符的码，插入 | `{"maxUses", "expiresAt"}`（不含码与备注） |
| `PATCH registration-codes/:id` | 存在 | 改备注；`disabled: true` 时写 `disabled_at` | 只在停用时写，`{}`（只改备注不写审计：输出 8 的清单里没有“改备注”） |

- 封禁、解封、改成同一角色这些“没有变化”的调用照样成功、照样写审计：两个管理员同时封同一个人时，Spec 要求各有一条。
- 重置密码的新密码：20 个字符，取自去掉易混字符（`0O1lI`）的字母与数字，`randomBytes` 取，约 115 位。
- **撤销的接缝。** `revokeUserCredentials(d: Database, userId: number, options?: {exceptSessionId: number}): number` 是唯一删某个账号全部会话的地方（封禁、改角色、重置密码、改密码时排除当前会话、创建管理员的命令都调它）；t08 在里面加“撤销该账号的 OAuth 访问令牌与刷新令牌”。直接 `DELETE FROM session` 不经库的钩子：本 Task 没有挂在会话删除上的东西，t08 加对外 OAuth 时要核对插件有没有依赖会话删除钩子的状态（写进 t08 的接缝说明）。

**分页（输出 9、10，验收 4；探针 p11）。**

- `anchor` 是“基准那一刻的最大 id”：`<列表前缀><id>`，前缀 `u`（账号）、`rc`（注册码）、`ic`（邀请码）、`a`（审计）。不带 `anchor` 时取当时的 `max(id)` 放进响应；带着时只看 `id <= anchor`。所有表的 id 都是 `AUTOINCREMENT`，新条目的 id 一定更大，所以“基准之后新增的不进 `items`、不计入 `total` 与 `counts`”成立；导入的旧条目 id 小而建立时间早，排序仍按“建立时间倒序、再按 id 倒序”（输出 9），与 id 的大小无关。p11：45 个账号取第 1 页（45 到 26）后再注册一个，带着 `anchor` 取第 2 页从 25 开始、`total` 仍是 45；不带 `anchor` 取第 1 页新账号排最前、`total` 是 46。
- `anchor` 的校验：前缀对、数字部分是正整数、不大于当前的 `max(id)`；否则 `validation_failed`、`fields: ["anchor"]`。这比“不是本接口给出的值”宽：别人自己拼一个合规的 `u5` 也被收下，它的含义仍然自洽（就是“id 不超过 5 时的那一刻”）。要做到字面上的“本接口给出的”，就得给 `anchor` 加签名（第 4 节 B3）。
- `total` 与 `counts` 一条 SQL：在“搜索加基准”的结果上 `count(*)` 与各筛选项的 `sum(条件)`，再按当前筛选取一页（p11 的 SQL）。`page` 越界时 `items` 为空、`total` 照给。
- 账号搜索 `q`：用户名、邮箱、显示名的前缀，`LIKE ? ESCAPE '\'`，先转义 `%`、`_` 与反斜杠（p11：`a_` 转义后只命中 `a_b`）；邮箱待补的账号不按占位邮箱匹配。SQLite 的 `LIKE` 对 ASCII 不分大小写。
- 账号列表的排序在 `user` 表上没有 `createdAt` 的索引，SQLite 用临时 B 树排序（p11 的查询计划）。库的表不加自己的索引（保持与库导出的一致）；旧站账号在几千这个量级时没有问题，到几十万时再在迁移里加。
- 审计列表的筛选：`actorId`（数字；`cli` 表示命令行）、`targetType` 加 `targetId`、`action`；没有 `counts`（3.1）。

**审计谁能读。** 只有管理员（`GET admin/audit`）。审计表的改与删被触发器拒绝（p9），模块代码里没有改或删它的语句。

**详情（`GET users/:id`）。** `providers` 来自 `account` 表里 `providerId` 不是 `credential` 的行（本 Task 恒为空数组）；`sessionCount` 数未到期的会话；`registrationCode`、`inviter` 来自 `identity_profile`。

### 3.11 “问身份”给统计模块的形状（t11 README 的待定处）

ADR 0059 决策 5 原文：“第一版里统计模块在进程内调用同一个处理函数”。推荐把这个“处理函数”就定成 HTTP 处理函数的形状：

```ts
// nb-site-identity 导出，createIdentityModule 的返回值上多一个成员：
whoami(request: Request): Promise<Response>;     // 与 GET /api/identity/v1/whoami 是同一个函数，只读请求的 Cookie 头
```

- 统计模块（t11）自己声明它要的函数形状 `type AskIdentity = (request: Request) => Promise<Response>`，自己解析回答里它用到的三样（`state`、`user.id`、`user.role`）与 503。它不依赖账号的合同包，ADR 0059 决策 2 不用改。
- 进程入口的适配器（`modules.ts`）转接：账号模块的 `create` 把实例的 `whoami` 记在适配器的一个变量里，统计模块拿到的是 `(request) => 取那个变量再调用`，在调用时才取：两个模块谁先 `create` 都不影响（所有 `create` 都在监听之前做完；取不到时抛错，统计模块按 `unavailable` 处理）。
- 拆成两个进程时（ADR 0059 后果一节），同一个形状就是对 `whoami` 端点的 `fetch`，统计模块不改。
- 另一个候选是另写 ADR 部分取代决策 2、允许依赖别的模块的合同包：多一份 ADR、模块之间多一条编译期的依赖，换来的只是统计模块少写一个三字段的解析。不推荐（第 10 节第 7 条）。

本 Task 只导出 `whoami` 并在 `modules.ts` 里留好转接的变量；统计模块那一侧的使用归 t11。

### 3.12 `src/commands/create-admin.ts`：创建管理员的命令（`site.operations` 输出 5）

`SiteCommand`：`name: "create-admin"`，`access: "shared"`（服务在跑时也能执行，等密码输入时不挡服务启动，`site.operations` 时序一节），参数 `<username> [email]`。

1. 校验 `username` 按字段规则（转小写；`displayUsername` 存原样），`email` 给了时按字段规则与 `.invalid` 后缀校验；不合格以 `invalid_argument` 失败（`fields: {name, problem}`，第 4 节 B1）。
2. 读密码：标准输入是终端时，在标准错误上提示、`setRawMode(true)` 逐字节读到回车，不回显（探针 p8：经 `script` 造的终端里输入没有回显）；原始模式下 Ctrl-C 是 `\u0003` 这个字节、不是信号（p8），读到它按收到停止信号处理（reject 为 `AbortError`，入口报 `interrupted`）。标准输入是管道时读到结尾，去掉末尾的一个换行（p8：管道照常读到）。`signal` abort 时停止读、恢复终端模式、reject。密码按 8 到 128 个码点校验。
3. 用与服务相同的参数算 argon2id（这是另一个进程，不经服务的哈希限额）。算完先看 `signal.aborted`：已 abort 就不写，reject。
4. 一个同步的 `BEGIN IMMEDIATE` 事务（`CommandContext.db`，同步做完，信号插不进来）：
   - 用户名不存在：`email` 给了且被占用以 `email_taken` 失败；插入 `user`（`role = 'admin'`、`banned = 0`、显示名取用户名）。没给 `email` 时先插一个临时的唯一占位，拿到 id 后改成 `u<id>@placeholder.invalid` 并在 `identity_profile` 里标邮箱待补（与 `site.legacy-import` 的占位写法相同）；插入 `identity_profile`、`credential` 那一行。
   - 用户名已存在：`role` 改成 `admin`、`banned` 改成 0（第 10 节第 4 条）、写新哈希（没有 `credential` 行就插入）、`revokeUserCredentials`（全部会话失效）；给了 `email` 时忽略它并在结果里标明（不改已有账号的邮箱）。
   - 写一条审计：`actor_id` 为空（命令行），`action = 'admin.cli_upsert'`，`params = {"created": true 或 false}`（第 10 节第 4 条）。
5. 服务正在写库时 `BEGIN IMMEDIATE` 可能撞 `SQLITE_BUSY`（命令的连接 `busy_timeout` 是 250 毫秒）：每 100 毫秒重试，至多 50 次，每次之前看 `signal`；用完仍忙以 `unavailable` 失败。服务那一侧的事务都很短（同步做完），实际不会等满。
6. 成功：经 `log.info` 在标准输出写一行 `identity.admin_upserted`，字段 `{userId, created, emailIgnored}`；不写用户名以外的账号信息，不写密码。

服务没有任何账号的内存缓存（会话缓存关着），所以命令改完以后服务立即按新状态判断：旧会话失效、新密码可登录。新建的管理员没有同意记录，第一次登录后先被同意门槛挡住、补交同意（输出 10），这是有意的：管理员也要同意条款。

### 3.13 `src/config.ts`：配置

在 t05 已有的 `parseIdentityConfig`（会话密钥）上加：

| 变量 | 必填 | 取值 | 缺省 | 问题词 |
|---|---|---|---|---|
| `NB_SITE_IDENTITY_TERMS_VERSION` | 是 | `YYYY-MM-DD`，且是真实存在的日期 | | `missing`、`bad_format` |
| `NB_SITE_IDENTITY_REGISTRATION_OPEN` | 否 | `true` 或 `false` | `true`（第 10 节第 9 条） | `bad_format` |
| `NB_SITE_IDENTITY_SESSION_DAYS` | 否 | 1 到 365 的整数 | 30 | `not_integer`、`out_of_range` |
| `NB_SITE_IDENTITY_HASH_CONCURRENCY` | 否 | 1 到 16 的整数 | 2 | 同上 |
| `NB_SITE_IDENTITY_HASH_QUEUE` | 否 | 0 到 10000 的整数 | 64 | 同上 |

Google、GitHub 的开关与上游配置归 t08。限流的上限是 Spec 里写死的数，不做成配置：合同测试经可信代理给每个用例不同的来源地址（3.16），不需要放宽。

`NB_SITE_IDENTITY_TERMS_VERSION` 必填会影响 t05 已有的两处：合同测试底座的 `baseEnv` 要加上它，`operations.test.ts` 的“必填变量”清单要加上它（输出 1 的配置校验用例逐个删必填项）。放在第 2 片（第 5 节）。

### 3.14 时间

**库没有注入时间的口子**（探针 p2）：`@better-auth/core` 与 `better-auth` 的产物里有 64 个文件直接用 `Date.now()` 或 `new Date()`；初始化选项的类型里没有时钟一类的选项；适配器层只管读写，不提供时间。除了全局替换 `Date`（不做：会改到同一进程里的统计模块与入口），没有别的办法。所以凡是“随时间变化”的行为都不交给库判断，由模块按 `ModuleContext.clock` 判断，库只做存取：

| 行为 | 谁判断 | 怎样验 |
|---|---|---|
| 会话的建立、最后使用、到期时间的写入 | 模块：建会话的钩子改写库给的时间（p2：落库的是钩子给的值） | 合同测试：拨钟后看会话列表里的时间 |
| 会话到期（输出 5） | 模块：`readSession` 第 2 步。库只在系统时间过了到期时间才自己删，测试里模块时钟总在系统时间前面，库的判断不会先于模块触发 | 合同测试：拨过会话时长后 `me` 得 `unauthenticated` |
| 会话延长、每天至多一次（输出 5） | 模块：`requireSession` 里的延长；库的延长关掉 | 合同测试：拨 1 天多，请求带回新的 `Set-Cookie`；再拨到原到期时间之后仍有效；同一天里再请求不再带 |
| `whoami` 不延长（输出 7） | 模块 | 合同测试：拨 1 天多后只调 `whoami`，不带 `Set-Cookie`；再拨到原到期时间之后得 `anonymous` |
| 注册码、邀请码的过期 | 模块：条件扣减里比 `clock.now()` | 合同测试：发一个一小时后过期的码，拨两小时后注册得 `registration_code_invalid` |
| 限流窗口（输出 19） | 模块：对齐的窗口取 `clock.now()` | 合同测试：超限后拨到下一个窗口恢复 |
| 失败 20 次后的 2 秒等待 | 真实时间（它就是让请求真的慢下来） | 包内测试注入睡眠函数；合同测试一条量“至少 2 秒” |
| 哈希排队超过 5 秒（输出 20） | 真实时间（度量机器的忙碌） | 包内测试注入计时器；合同测试只验“队满立即 `overloaded`” |
| 同意记录、审计、最近登录、码的建立时间 | 模块 | 合同测试看列表里的时间等于拨过的时钟 |
| 库的 `verification` 表的到期（t08 社交流程的 10 分钟） | 库，系统时间 | 本 Task 不用；t08 要另定（拨钟验不了，第 8 节） |

### 3.15 `packages/nb-site-server/src/modules.ts` 与入口的改动

- 账号的适配器把 `clock`、`jobs`、`clientAddress` 交给 `createIdentityModule`（t05 的 `ModuleContext` 都有，现在只交了三样），挂 `site` 子应用，登记 `commands: [createAdminCommand]`，把实例的 `whoami` 记进转接变量（3.11）。
- 入口不需要别的改动：模块接口、测试控制入口、`shared` 命令的锁与迁移都是 t05 的。
- `nb-site-identity` 的依赖加 `better-auth`、`@better-auth/core`（两者钉 1.7.27，不用 `^`：库升级要按 ADR 0060 后果第三条比对表结构，不能被锁文件以外的方式顺手升上去）、`kysely`（钉与库同一个版本，现在是 0.29.9）、`typebox`。

### 3.16 测试的底座

- **来源地址。** 账号的合同测试起进程时设 `NB_SITE_TRUSTED_PROXIES=127.0.0.1/32`，每个用例给自己的 `X-Forwarded-For`（`203.0.113.<n>` 一类文档用地址段）：限流按来源计，同一个进程上的用例互不吃额度；限流用例自己用一个地址打满。
- **管理员与注册码。** 每个文件的 `beforeAll` 经 `create-admin` 命令建一个管理员（密码从标准输入给，底座的 `run` 已支持字符串作标准输入），登录、补交同意、经管理接口发注册码。合同测试只经 HTTP 与命令行，不碰库。
- **新的底座函数：** `cookieJar()`（存与回送 `Set-Cookie`，按名字覆盖；Cookie 的属性另外取出来给断言用），`identityRequest(sandbox, path, init)`（补 `Origin`、`Content-Type` 与 `X-Forwarded-For`）。放在 `testing/identity.ts`。
- **被信号打断的命令。** `create-admin` 停在等密码处时发 `SIGTERM`：底座要能起一个标准输入保持打开的子进程并给它发信号（现在 `stdin` 只能是一次给完的字符串）。在底座加 `spawnWithOpenStdin`，与已有的收口钩子同一套登记。
- **合同包的 schema 核对响应。** 推荐放开合同测试包对 `typebox` 的导入（第 10 节第 8 条），用 `Value.Check(Schema, body)` 断言每个成功响应的形状；不放开就逐字段手写断言。
- **包内测试**（`nb-site-identity/src/**/*.test.ts`）用真实的 `bun:sqlite`（临时目录里的库，跑真实的迁移）与真实的 Better Auth，不用替身；只注入三样：时钟、哈希的睡眠与计时器、校验函数的包装（让测试在“校验之后、发会话之前”插入一个动作，验收 7 与封禁并发用）。它是 `createIdentityModule` 的一个可选依赖 `verifyPassword`（缺省就是真实的 `password.verify`；入口不传），测试传一个先调真实函数、再等测试放行的包装，不是产品代码里的测试分支。

## 4. Spec 与文档改动

实现前由主会话在 master 上改。每条给原文位置与建议；凡是计划里按推荐写了、但 Spec 没写的，都在这里，不在实现里悄悄定。A 是 `site.accounts`，B 是别的 Spec 与文档。

**A. `docs/specs/site/accounts.md`**

- **A1 配置变量名。** 原文：输入与前置条件一节末“站点配置：注册是否开放、Google 与 GitHub 各自是否开放、当前条款版本（…）、会话时长（缺省 30 天）。”建议照 `telemetry-ingest.md` 第 34 行的写法列出变量：`NB_SITE_IDENTITY_TERMS_VERSION`（必填，`YYYY-MM-DD` 且是真实日期）、`NB_SITE_IDENTITY_REGISTRATION_OPEN`（`true` 或 `false`，缺省见第 10 节第 9 条）、`NB_SITE_IDENTITY_SESSION_DAYS`（1 到 365，缺省 30）、`NB_SITE_IDENTITY_HASH_CONCURRENCY`（1 到 16，缺省 2）、`NB_SITE_IDENTITY_HASH_QUEUE`（0 到 10000，缺省 64）；Google、GitHub 的变量由 t08 补。
- **A2 登录的“用户名或邮箱”。** 原文：输出 4 第一句。建议加：“含 `@` 的按邮箱找，否则按用户名找；邮箱待补的账号不能用邮箱登录。”（后半句 `site.legacy-import` 已有，这里写一遍免得两处对不上。）
- **A3 前缀之下的 404、500 与坏请求体。** 原文：失败表没有 `not_found` 与 `internal`；输出 22 只说失败的形状。建议失败表加 `not_found`（404，没有这个接口，或会话、邀请码不是自己的、不存在）与 `internal`（500，程序自身的错误）；输出 22 加：“请求体超过 16 KiB、不是 JSON 或不是对象时回 `validation_failed`，`fields` 为空数组。”成功而没有内容可回的接口（登出、改密码、结束会话）回 `{}`。
- **A4 最后使用时间的精度、不存来源地址。** 原文：输出 17“最后使用时间”。建议加“精确到一小时以内”。副作用与数据一节加：“会话不存来源地址；浏览器标识只存概要（浏览器名与系统名）。”
- **A5 “字符”的数法。** 原文：字段规则表。建议表前加一句：“长度按 Unicode 码点计；输入不去首尾空白（注册码与邀请码除外）。”
- **A6 登录不查密码下限。** 原文：字段规则表的“密码 8 到 128 个字符”。建议加：“登录时只查上限：导入的旧密码可能更短。”
- **A7 失败的先后。** Spec 没写同时有几处不合格时回哪个码。建议在失败与恢复一节加：注册按“`forbidden_origin`、`rate_limited`、`registration_closed`、`validation_failed`、`consent_required`、`registration_code_invalid`、`invite_code_invalid`、`username_taken`、`email_taken`”的先后取第一个；登录按“`forbidden_origin`、`validation_failed`、`rate_limited`、`overloaded`、`invalid_credentials`、`account_banned`”。并写明理由：码在占用之前查，没有可用注册码的人试不出哪些用户名与邮箱已被注册；封禁在密码之后查，不知道密码的人试不出谁被封了。
- **A8 限流的口径。** 原文：输出 19。建议加：按对齐的时间窗计（跨边界的一个窗长里可以到两倍）；IPv6 按前 64 位；每次尝试都计入，被限流拒绝的不计入；“用户名”是规范化后的登录名（转小写，是邮箱时就是邮箱）；成功的登录不清零失败计数；每个计数器的键满 10 万时窗口内新来的一律拒绝（失败计数满时一律先等 2 秒）。
- **A9 过载。** 原文：输出 20。建议写明上限与队长是 A1 的两个变量、经限额的操作（登录、注册、改密码、管理员重置密码），以及这些接口都可能回 `overloaded`。
- **A10 同意的补交。** 原文：输出 10 末句。建议加：“`me/consent` 带的条款版本不是当前版本、或没有对境外存放的同意时回 `consent_required`。”
- **A11 定时任务名。** 建议在输入与前置条件加一行，照 `telemetry-ingest.md` 第 35 行：“定时任务：`purge` 每 10 分钟跑一次、启动后先跑一次，清掉已到期的会话与过去的限流窗口。”
- **A12 改密码的会话。** 原文：输出 6 末句“用户自己改密码时当前这一个会话保留”。与 ADR 0060 决策 5 第二条矛盾，按第 10 节第 6 条的结论改其中一处。
- **A13 占位后缀。** 建议字段规则表的邮箱一行加：“不收以 `.invalid` 结尾的地址（留给导入的占位）。”
- **A14 码存原文。** 副作用与数据一节“密码只存哈希”之后加：“注册码与邀请码存原文（管理员要能看到）。”

**B. 别的 Spec 与文档**

- **B1 `site.operations` 输出 5 与失败表（创建管理员）。** 原文：输出 5。建议加：参数是 `create-admin <用户名> [邮箱]`；新建时没给邮箱就填占位邮箱并标“邮箱待补”（同 `site.legacy-import`）；已存在时还把它解封，给的邮箱忽略；成功时标准输出的一行是日志事件 `identity.admin_upserted`（带账号 id 与是新建还是重置）；每次成功写一条操作者为“命令行”的审计记录；新建的管理员第一次登录后要先补交同意。失败表加 `invalid_argument`（用户名、邮箱或密码不合规则，带 `name` 与 `problem`）与 `email_taken`、`unavailable`（库一直被占着写锁）。审计的这一条也要进 `site.admin` 输出 8 的清单。
- **B2 `site.admin` 的列表参数。** 原文：输入与前置条件的接口表与分页参数表。建议写明参数名：搜索 `q`、筛选 `filter`（取值 `all`、`admin`、`banned`、`email_pending`；注册码 `all`、`usable`、`exhausted_or_expired`、`disabled`）、审计的 `actorId`（数字，或 `cli` 表示命令行）、`targetType` 加 `targetId`、`action`；`counts` 的键就是筛选项的取值。注册码列表里有码本身。
- **B3 `site.admin` 输出 10 的 `anchor`。** 原文：“`anchor` 不是本接口给出的值时回 `validation_failed`”。实现只能核对写法与“不晚于现在”（3.10）。建议改成“`anchor` 的写法不对或晚于当前时刻时回 `validation_failed`”；要字面的“本接口给出的”就给 `anchor` 加签名（多一个密钥用途、约 20 行），推荐不加。
- **B4 `site.admin` 输出 8 的审计清单与内容。** 建议写明：只改注册码备注不写审计；没有变化的处置（封已封的人、改成同一角色）照样写；各动作的参数（改角色记新旧角色、结束会话记条数、发放注册码记次数与过期时间，不记码与备注）；动作名用合同包的枚举。管理员可以结束自己的全部会话、重置自己的密码（输出 5 只禁封禁与改角色）。
- **B5 `nb-site-contract-tests/AGENTS.md` 的导入表。** 放开 `typebox`（第 10 节第 8 条），连同 `src/boundary.test.ts` 的清单。
- **B6 ADR 0060 后果最后一条。** 原文：“没有经探针核对的：登录后把旧哈希换成新算法、取不到真实 IP 时库的限流行为、刷新令牌在封禁与重置密码之后的行为。”前两项本 Task 已有结论（换哈希由自家登录路由做，探针 p4；库的限流整体关掉、自己做）。ADR 正文不改的话，在 t07 的 Task 记录里写明，并在第 10 节第 1 条的新 ADR（如果要写）里带上。
- **B7 t11 README 的待定处。** 按第 10 节第 7 条的结论在 t11 README 里写上“问身份”的形状。
- **B8 `nb-site-server/AGENTS.md`“模块怎样接进入口”。** “模块取时间用 `context.clock` … 不直接用 `Date.now()`”：Better Auth 内部用系统时间，加一句例外与应对（3.14 的做法：随时间变化的判断由模块按 `clock` 做）。

共 22 条：A1 到 A14、B1 到 B8。

## 5. 切片

每片一个提交，在 `feat/w00037-official-site` 的 worktree 里做；第 4 节的 Spec 改动由主会话先在 master 上改。合同用例跟着实现它的那一片一起进，每片都能从外面验到自己做的事。顺序按合同测试能造出什么排：第 4 片有了创建管理员的命令、登录与补交同意，才有登录态；第 5 片有了发注册码，才能注册。下表里“`<账号>`”指 `packages/nb-site-identity`，命令从仓库根执行；各片都还要跑 `bun run governance:check --since master`；长验证前看 `cat /proc/loadavg`。

| 片 | 内容 | 前置 | 验证与变异检查 |
|---|---|---|---|
| 1 合同包 | 3.1 全部；`nb-site-identity-contract` 加 `typebox` 依赖；`contract.test.ts` | 第 4 节 A3、A7、B2、B4；第 10 节第 4 条的审计一项（动作枚举） | `bun run test:affected packages/nb-site-identity-contract --typecheck`。变异：`IDENTITY_FAILURE_STATUS` 里把 `invite_code_limit` 改成 422；删掉 `RegisterRequest` 的 `additionalProperties: false`；`IsoTimestamp` 去掉毫秒那一段。`contract.test.ts` 各自失败 |
| 2 迁移、连接、配置 | 3.2 的 `0001_init.sql` 与 `migrations.ts`；3.3 的 `connection.ts`；3.13 的 `config.ts`；合同测试底座的 `baseEnv` 加 `NB_SITE_IDENTITY_TERMS_VERSION`，`operations.test.ts` 的必填清单加它 | 第 1 片；第 4 节 A1；第 10 节第 2、9、11 条 | `bun run test:affected <账号> packages/nb-site-contract-tests --typecheck`。包内：`connection.test.ts`（库的事务开着时另一处的写不被收进去、事务里调 `run` 不死锁且随它回滚、别的连接持写锁时 `BEGIN IMMEDIATE` 以 `SQLITE_BUSY` 失败、错误按 `code` 归类）、`migrations.test.ts`（清单与目录一致；删掉最大 id 的会话行后新插入的 id 更大；审计表改与删被拒）、`config.test.ts`。变异：`session` 表去掉 `AUTOINCREMENT`（id 用例失败）；`run` 去掉重入判断（死锁用例超时失败）；`BEGIN IMMEDIATE` 改成 `BEGIN`（持写锁用例改在中途才失败，断言失败点）；去掉审计的删除触发器 |
| 3 库的装配与会话 | 3.4 的 `auth.ts` 与 `nbSession` 插件；3.5 的 `session.ts` 与 `purge` 任务；3.6 的出错出口、来源头、请求体、`requireSession`、同意门槛（放行表一次写全）与角色门槛、`logout`、`meta`；3.11 的 `whoami`；3.15 的适配器改动与依赖；合同测试的 `testing/identity.ts` | 第 2 片；第 10 节第 1、8、10 条 | `bun run test:affected <账号> packages/nb-site-server packages/nb-site-contract-tests --typecheck`。包内（这一片还没有对外的登录，会话用 `issueSession` 直接建）：建的会话能被读出；拨钟过会话时长后读不出且行被删；拨一天多后延长并重发 Cookie、同一天不再延长；`whoami` 不写库；库的表少一列时 `create` 失败；`SQLiteError` 映射成 503、漏到出口的 `APIError` 成 500，响应体都只有 `error.code`；直接调 `auth.handler` 撞写锁时错误抛出、标准错误为空；同意门槛与角色门槛的放行表。合同：匿名的 `whoami`；`meta`；不带来源头的 `logout` 得 `forbidden_origin`；前缀下没有的路径得 404 的 `ErrorBody`。变异：去掉 `readSession` 的到期判断；`whoami` 走 `requireSession`（不延长用例失败）；去掉 `onAPIError.throw`（标准错误为空的断言失败）；放行表加上 `me/invite-codes` |
| 4 密码与登录、创建管理员 | 3.7 的 `password.ts`、`hash-limiter.ts`、`login.ts`、`change-password.ts`；3.8；3.12 的 `create-admin` 与在 `modules.ts` 登记；3.9 的 `GET me`、`POST me/consent`；审计的写入函数（`create-admin` 要写一条）；合同测试底座的 `spawnWithOpenStdin` | 第 3 片；第 4 节 A2、A5、A6、A8 到 A10、B1；第 10 节第 3 到 6 条 | `bun run test:affected <账号> packages/nb-site-server packages/nb-site-contract-tests --typecheck`；`bun <账号>/scripts/measure-hash.ts`（`taskset -c 0,1` 下一次哈希、8 个同时、32 个并发登录的耗时与常驻内存，写进 Task 记录）。包内：旧站格式登录并换格式、并发 8 个只换一次；校验之后发会话之前重置得 `invalid_credentials` 且没有会话（验收 7）；同一时机封禁得 `account_banned`；发会话的事务开着时封禁，提交后会话被删；账号不存在、没有密码时也调了一次校验（数调用次数，不量时间）；限额队满与排队 5 秒（注入计时器）；限流的键、窗口、IPv6 前缀、满 10 万键；失败 20 次后先等（注入睡眠）；读密码（管道、注入的终端输入流、`\u0003`、abort）。合同：`create-admin` 建管理员（服务在跑、没在跑两种）、登录、补交同意；三种 `invalid_credentials` 里的两种；Cookie 的名字与属性、两个会话并存、登出只结束当前、拨过时长失效、拨一天多后延长（输出 5）；`whoami` 已登录的形状与不延长；改密码后另一个会话失效、当前保留；登录与改密码的限流、`Retry-After`、拨钟恢复、取不到来源地址得 `forbidden_origin`；失败 20 次后一次登录至少 2 秒；并发 1、队长 0 的进程上同时两个登录有一个 `overloaded`；持住账号库写锁时登录得 503 `unavailable` 的 `ErrorBody`；`create-admin` 停在等密码处收到 `SIGTERM` 以 `interrupted` 结束、账号不变；已存在时重置后旧 Cookie 失效、新密码可登录。手工：真实终端里跑一次 `create-admin`，确认不回显、Ctrl-C 得 `interrupted`。变异：去掉登录第 9 步的哈希复核（验收 7 失败）；换格式的条件更新去掉 `AND password = ?`；去掉假校验；限流把被拒的也计入；读完密码不看 `signal.aborted` 就写 |
| 5 注册与注册码 | 3.7 的 `register.ts`；3.10 里注册码的三个接口（发放、列表、改备注或停用）与它们的审计 | 第 4 片；第 4 节 A7、A13、A14、B2 到 B4 | `bun run test:affected <账号> packages/nb-site-contract-tests --typecheck`。包内：注册事务里扣码之后建账号失败时码不被扣；审计写失败时发放不生效（在审计表上临时加一个拒绝插入的触发器）。合同：验收 1、2；输出 1（含邀请码在第 6 片之后补的那半句，见下）；输出 3 的每个拒绝码与第 4 节 A7 的先后（同时缺码与重名得码的错）；注册的限流；注册成功后立即 `me` 可用；注册码停用、过期（拨钟）、用完后不能注册，已用它注册的账号照常登录；注册码列表的筛选与 `counts`。变异：注册先查占用后查码（先后用例失败）；扣码去掉 `used_count < max_uses`（验收 1 失败）；审计写在事务之外（原子性用例失败） |
| 6 资料、会话、邀请码 | 3.9 的其余（`PATCH me`、会话列表与结束、邀请码三个接口）；3.5 的浏览器概要 | 第 5 片；第 4 节 A4 | `bun run test:affected <账号> packages/nb-site-contract-tests --typecheck`。包内：浏览器概要的规则表（表驱动）。合同：输出 8 的余下部分、17、18（第 11 个有效码得 `invite_code_limit`、停用一个后能再生成）；用邀请码注册后邀请码的已用次数加 1（输出 1 的邀请归属）；验收 6（重启换新条款版本，旧会话调 `me/invite-codes` 得 `consent_required`，补交后恢复）；`PATCH me` 改成别人的邮箱得 `email_taken`。变异：会话列表回原始的浏览器标识（列表用例断言只有两个名字）；邀请码上限按全部码数而不是有效码数 |
| 7 管理的其余 | 3.10 的账号列表与详情、封禁、解封、改角色、结束会话、重置密码、全站邀请码列表、审计列表、翻页 | 第 6 片 | `bun run test:affected <账号> packages/nb-site-contract-tests --typecheck`。包内：`last_admin`、`self_forbidden`；两个处置排队各写一条审计。合同：`site.admin` 验收 1 到 4 与输出 1 到 10；`site.accounts` 验收 3、输出 4 的封禁、输出 6 的封禁、改角色与重置三种。变异：`anchor` 的条件去掉（验收 4 失败）；封禁不删会话（验收 3 失败）；`last_admin` 的计数不排除被处置的那个人 |
| 8 收口 | 统计模块持锁的那条合同用例（t06 的 C14）加“持锁期间账号的登录照常成功”（`site.telemetry-ingest` 验收 4）；`site.accounts` 的 Smoke 用例（注册、登录、问身份）标上 Smoke；合同测试包的 `boundary.test.ts` 与 `AGENTS.md` 放开 `typebox`（第 3 片已经要用时提前到第 3 片） | 第 7 片；t06 的 C14 已在分支上 | `bun run test:affected <账号> packages/nb-site-server packages/nb-site-contract-tests packages/nb-site-telemetry --typecheck --since master`；`bun run docs:check --since master`。变异：用例里另外再持住账号库的写锁，登录那一步应当失败（确认这一步真的在验登录，不是空过） |

**审查。** 本 Task 是安全边界，并碰内核时序（一条连接上的队列、库的事务与重入）与数据格式（第一条迁移，发布后不改），按高风险后端做快速审查：

- 第 3 片之后：第 2、3 片合成一个提交范围（连接队列、迁移、库的装配）。Opus 子代理先审，处理完再做第 4 片；同时开 omp `@review` 在后台审同一份说明，回来再处理、修正单独提交。
- 第 5 片之后：第 4、5 片合成一个提交范围（登录、注册、哈希、限流、创建管理员）。同样 Opus 先审、omp 在后台。
- 收口（第 8 片之后）：第 6 到 8 片合成一个提交范围，Opus 先审、omp 在后台；外加对照第 6 节的验收映射逐句核对用例。
- 迁移文件在第 2、3 片的审查里定稿；之后的片不改 `0001_init.sql`（还没发布，但改了要重跑那一轮审查）。

第 4 片最大。一段做不完时拆成 4a（`password.ts`、`hash-limiter.ts`、`rate-limit.ts` 与它们的包内测试，不对外、可以单独提交）、4b（登录、改密码、`me` 与同意）、4c（创建管理员与 `spawnWithOpenStdin`）；4b 的合同用例要管理员账号，所以 4b 与 4c 在同一个提交里，或者 4c 先于 4b。

## 6. 验收映射

“合同”在 `nb-site-contract-tests`（只经 HTTP 与命令行，只导入合同包）：建议分成 `accounts.test.ts`、`accounts-limits.test.ts`（限流与过载，各起自己的进程）、`admin.test.ts`，创建管理员并进 `operations.test.ts` 的同名一节。“包内”在 `nb-site-identity`，写明为什么不能在合同里测。

**`site.accounts`**

| 条目 | 用例 | 位置 |
|---|---|---|
| 输出 1 | 带齐字段注册：响应是公开资料、带 Cookie、随即 `me` 能用；省略显示名时取用户名；注册码的已用次数加 1；邀请码列表里那个码的已用次数加 1、管理详情里邀请人是它的主人 | 合同 |
| 输出 2、验收 1 | 只剩一次的码，8 个并发注册（8 个来源地址）：恰好 1 个成功，管理列表里码用了 1 次 | 合同 |
| 输出 2、验收 2 | 重复用户名注册失败；同一个码随后注册另一个用户名成功 | 合同 |
| 输出 3 | 每个拒绝码一条：注册关闭（`REGISTRATION_OPEN=false` 的进程）、码不存在、停用、过期（拨钟）、用完；邀请码四种；条款版本旧、境外存放 `false`；用户名、邮箱占用；字段不合规则时 `fields` 就是那几个键；第 4 节 A7 的先后（同时缺码与重名得码的错） | 合同 |
| 输出 4 | 用户名登录、邮箱登录（大小写不同）；密码错、账号不存在、账号没有密码三种都是 `invalid_credentials` | 合同（前两种）；“没有密码”在包内（没有密码的账号只有导入与社交注册造得出，本 Task 的合同里造不出；t08 补合同用例） |
| 输出 4 的时间不可分辨 | 三种失败各调一次校验函数 | 包内（量响应时间在共享的机器上不稳定，改为核对“都算了一次同样的哈希”） |
| 输出 4 封禁 | 被封的账号用对的密码得 `account_banned` | 合同（第 7 片） |
| 输出 5 | Cookie 的属性；同一账号两个会话并存；登出后那个 Cookie 无效、另一个仍有效；拨过会话时长后无效；拨一天多后延长并带回 Cookie、之后到原到期时间仍有效 | 合同 |
| 输出 6 | 封禁、改角色、管理员重置后旧 Cookie 得 `unauthenticated`；自己改密码后另一个会话失效、当前的保留 | 合同（第 4、7 片） |
| 输出 7 | `anonymous`、`authenticated` 的形状；拨一天多只调 `whoami` 不带 `Set-Cookie` | 合同；503 在包内（合同底座只能持写锁，`whoami` 只读、不受写锁影响，造不出“库不可读”） |
| 输出 8 | `me` 的各字段；`PATCH me` 各字段与 `email_taken`；邮箱待补的账号 `email` 为 null | 合同；“邮箱待补”用不给邮箱的 `create-admin` 造 |
| 输出 9 | 有密码时旧密码错得 `invalid_credentials`；没有密码直接设 | 合同（前者）；后者包内（同输出 4，没有密码的账号造不出），t08 补合同 |
| 输出 10、验收 6 | 重启换新条款版本：旧会话调 `me/invite-codes`、`admin/users` 得 `consent_required`，`whoami`、`me`、`logout` 照常；补交旧版本得 `consent_required`；补交当前版本后恢复 | 合同 |
| 输出 17 | 两个会话（不同的 `User-Agent`）：列表里浏览器与系统名、`current`；结束另一个后它无效；结束别人的得 `not_found` | 合同；规则表在包内 |
| 输出 18 | 生成、列表字段、第 11 个得 `invite_code_limit`、停用后不能用于注册、停用一个后能再生成 | 合同；“旧站导入的码保留次数与过期”在 t12 |
| 输出 19 | 来源 30 次、来源加用户名 10 次、注册 5 次、改密码 5 次各自超限得 `rate_limited` 与整数的 `Retry-After`；拨到下一个窗口恢复；可信代理不给转发头时登录得 `forbidden_origin`；失败 20 次后下一次登录至少 2 秒 | 合同；IPv6 前缀与满 10 万键在包内（合同只能从 127.0.0.1 发，转发头里写 IPv6 也只能验一个地址，满 10 万键太慢） |
| 输出 20 | 并发 1、队长 0 的进程上同时两个登录：一个 `overloaded`；排队 5 秒的超时 | 合同（队满）；超时在包内（要真的等 5 秒，注入计时器） |
| 输出 21 | 旧格式登录并换格式；换格式不覆盖期间的重置 | 包内（合同里造不出旧格式的哈希：只有导入会写，t12 的合同用例补“导入后能登录”） |
| 输出 22 | 每个失败用例都用 `ErrorBody` 核对形状（只有 `code` 与 `fields`） | 合同（贯穿） |
| 时序“注册成功的响应返回时会话已可用” | 注册的响应之后立即 `me` | 合同 |
| 时序“封禁与登录并发” | 校验之后、发会话之前封禁；发会话的事务开着时封禁 | 包内（要在两步之间插入动作，只能注入校验函数的包装） |
| 时序“改密码或重置与登录并发”、验收 7 | 校验之后、发会话之前重置：`invalid_credentials`、没有会话 | 包内（同上） |
| 时序“重启不影响会话、限流清零” | 登录后重启进程，Cookie 仍有效；限流打满后重启，恢复 | 合同 |
| 验收 3 | 登录后封禁：原 Cookie 调 `me` 得 `unauthenticated`，再登录得 `account_banned` | 合同（第 7 片） |
| 验收 4、5，输出 11 到 16、23、24 | 社交 | t08 |

**`site.admin`**

| 条目 | 用例 | 位置 |
|---|---|---|
| 输出 1、验收 1 | 普通用户调每个管理接口得 `forbidden`，之后审计列表没有新记录；没有会话得 `unauthenticated` | 合同 |
| 输出 2 | 封禁后不能登录、旧会话失效；解封后能登录、旧 Cookie 仍无效 | 合同；“OAuth 令牌失效”在 t08 |
| 输出 3 | 改角色后旧会话失效；改成同一角色不删会话 | 合同 |
| 输出 4、验收 2 | 重置：响应有新密码；旧密码失败、新密码成功、旧 Cookie 失效；审计里有一条、`params` 里没有新密码；进程输出里找不到新密码 | 合同 |
| 输出 5 | 对自己封禁、改角色得 `self_forbidden` | 合同 |
| 输出 6、验收 3 | 只有一个管理员时把自己降级或封禁被拒（先得 `self_forbidden`）；有两个管理员、其中一个被封时，封另一个得 `last_admin` | 合同 |
| 输出 7 | 发放的码 16 个字符、两次不同；停用后注册得 `registration_code_invalid`；已用它注册的账号照常登录；列表里的已用次数与 `usable` | 合同 |
| 输出 8 | 每种动作成功一次各一条审计、字段对；失败的处置不写；操作与审计同时生效 | 合同（前两句）；“同时生效”在包内（要让写审计那一步失败，合同里造不出） |
| 输出 9、验收 4 | 验收 4 原样；筛选与 `counts`；排序 | 合同 |
| 输出 10 | `page` 越界 `items` 为空；`page=0`、`pageSize=101`、坏 `anchor` 得 `validation_failed` | 合同 |
| 时序“两个管理员同时处置” | 两个封禁并发：各一条审计 | 合同 |

**`site.operations` 输出 5**：创建（服务在跑、服务没在跑两种）、重置（旧 Cookie 失效、角色变 `admin`、被封的被解封）、密码不回显（手工，终端）、被 `SIGTERM` 打断不改账号、成功时标准输出一行 `identity.admin_upserted`、密码不在任何输出里：合同（`operations.test.ts`），不回显是手工。

**`site.telemetry-ingest` 验收 4**：t06 的 C14 在持住统计库写锁期间加一次账号登录，断言 200 且带 Cookie：合同（第 8 片）。

**`site.accounts` 的 Smoke**：注册、登录、`whoami` 三条合同用例标为 Smoke。

## 7. 验证

- 每片：表里的 `test:affected` 命令（看命令自己的退出码）、变异检查（先提交再变异，恢复用 `git show HEAD:<文件> > <文件>`）。
- 真实进程：合同测试包对源码起真实的 `nb-site serve` 与 `create-admin`；CI 的镜像作业对打好的产物再跑一遍（t05 已有）。
- 测量：第 4 片的 `measure-hash.ts` 在 2 核下记一次哈希与 8 个同时的耗时、常驻内存峰值，写进 Task 记录，与探针 p5 对照（偏差超过一倍时回到第 10 节第 3 条重新定参数）。
- 手工：第 4 片在真实终端里跑一次 `create-admin`；第 8 片起 `serve`，用 `curl` 走一遍注册、登录、`whoami`、登出，看日志里没有密码、码与来源地址。
- 收口前：`bun run test:affected <账号> packages/nb-site-server packages/nb-site-contract-tests packages/nb-site-telemetry --typecheck --since master`、`bun run governance:check --since master`、`bun run docs:check --since master`。

## 8. 不做与风险

**不做**：社交登录与关联、`me/identities`、对外 OAuth 与它的令牌（t08）；旧站导入（t12，本 Task 只保证表能收下数字 id、旧格式密码、占位邮箱、码的原样数据）；前端（t10）；看板对“问身份”的使用（t11）；反向代理的限流（t13）；邮箱验证、找回密码、两步验证（Spec 非目标）。

**风险与已知限制**

- **库的升级。** 自己写了登录、注册与管理，库只发会话、读会话、登出；但仍依赖库的内部接口（`internalAdapter.createSession`、`setSessionCookie`、`runWithTransaction`、`getCurrentDBAdapterAsyncLocalStorage`、`SERVER_ONLY` 端点），它们不是库对外承诺稳定的接口。版本钉死；升级时跑第 3、4 片的包内用例，它们就是这几处的契约测试。
- **队列与异步上下文。** “事务里派生的活儿随它回滚”（探针 p6）这一类错误只在并发时出现，类型检查查不出。靠 `connection.ts` 的注释、源码扫描（只有它持有连接）与第 3 片的审查。
- **旧格式账号可被分辨。** 旧站格式的校验（scrypt 约 64 毫秒）比 argon2id（约 71 毫秒）略快，能统计出“这是还没登录过的旧账号”，不能分辨账号是否存在。登录一次后换成新格式，差别消失。
- **限流只在内存里**：重启清零（Spec 原文）；多进程部署时各算各的（第一版单进程）。
- **库的 `verification` 表按系统时间到期**：t08 的社交流程状态有 10 分钟寿命，测试控制入口拨不动它，t08 要另想验法。
- **会话的 `userAgent` 列被换成概要**：库自己的会话列表端点（不对外）读到的是 JSON，不影响本模块；t08 的插件若读它，要在 t08 核对。
- **账号列表没有建立时间的索引**：几十万账号时排序变慢，到时加索引的迁移。

## 9. 探针

都在 `/tmp/w00037-t07-plan/lab/`，用 better-auth 1.7.27、kysely 0.29.9、Bun 1.4.4 与 `bun:sqlite`，连接参数与 `openModuleDb` 相同（WAL、`busy_timeout = 250`、外键开、`strict`）；数据全是脚本自己造的。共用：`common.ts`（建库、装库、经 `handler` 调用）、`conn.ts`（3.3 的队列与方言原型）。每个脚本的输出在同名的 `.out` 里。

| 探针 | 结论 | 关键数字 |
|---|---|---|
| `p0-schema.ts` | `username`、`admin` 两个插件下库要的四张表与三个索引；库生成的 `id` 是 `integer not null primary key`，没有 `AUTOINCREMENT` | 4 张表、3 个索引 |
| `p1-autoincrement.ts`（A：手工加 `AUTOINCREMENT`；B：再加 `STRICT`、日期改 `TEXT`；C：少一列） | A、B 上库都正常：注册 200；时间存成 ISO 字符串、布尔存 0 与 1、库的 API 把 id 读成字符串；显式导入 id 1000 后新注册得 1001；删掉最大 id 的会话后再登录，新会话 id 更大；`admin` 插件的封禁删会话、被封后登录 403 `BANNED_USER`。C 在启动时报 `SCHEMA_MISMATCH`（结构检查能发现少列）。库缺省的哈希是不带前缀的 `十六进制盐:十六进制值` | 会话 1 到 4，删 4 后新会话是 5 |
| `p2-time.ts` | 库没有注入时间的口子；建会话前的钩子能改写落库的时间；库读会话只看系统时间：模块时钟拨 31 天后仍有效，到期时间早于系统时间时库删行回空；关掉库的延长后行不变；缺省 Cookie 的名字与属性 | 64 个产物文件直接读系统时间；初始化选项里 0 个时间来源；`Max-Age=2592000` |
| `p3-tx.ts`、`p3b-hook-rollback.ts` | 把 `Database` 直接交给库时，注册在事务里跨 `await` 算哈希：别处的写落进它的事务、随它回滚，库的别的查询等它；换成队列加自定义方言后，别处的写等库的事务提交、保住了，库的事务里调 `run` 不死锁、随它回滚（方言收到的语句是 `BEGIN IMMEDIATE`、`ROLLBACK`） | 缺省：哈希 300 毫秒，`get-session` 等 250 毫秒，别处的写丢失；队列：别处的写等 244 毫秒，`get-session` 2 毫秒 |
| `p4-login.ts` | 自家登录加 `SERVER_ONLY` 的发会话端点（经 `handler` 404）可行；验证之后封禁被 `admin` 插件的建会话钩子拒绝；钩子里才封禁时会话照建、被同一事务里的复核删掉；验证之后重置被复核拒绝、没有会话；8 个并发的旧格式登录全部成功、只换了一次格式；库自己的 `sign-in/username` 在账号没有密码时跳过哈希（读源码） | 三种失败与成功的中位数（Bun 缺省参数，各 10 次）：不存在 236.8、没有密码 227.6、密码错 265.9、密码对 245 毫秒 |
| `p5-hash.ts`（`taskset -c 0,1`，机器负载约 9） | 异步的 `Bun.password` 不在事件循环上算；2 核上大约同时算两个；同步版会停住事件循环 | 64 MiB t=2：一次 273 ms、8 个 1057 ms、内存 105 涨到 172 MB；19 MiB t=2：71 ms、324 ms、60 涨到 82 MB；46 MiB t=1：101 ms、447 ms、87 涨到 136 MB；scrypt 校验 63 到 65 ms；事件循环最大停顿不超过 6 ms；`hashSync` 停住 313、56、169 ms |
| `p6-atomic.ts` | `runWithTransaction` 加自定义方言：事务里发的会话可用；发会话之后失败时会话随事务回滚；登录的事务开着时另一处的封禁等它提交、再删掉包括新会话在内的全部会话，之后登录得 `account_banned`；注册时用户名被占，码不被扣、没有会话；事务的异步上下文里派生的活儿被当作事务的一部分 | 一次性码 8 个并发注册：1 个成功、码用 1 次、多 1 个账号；`waitsForLibTx = 1` |
| `p7-misc.ts` | 没有请求体 schema 的 `SERVER_ONLY` 端点原样收到请求体；`password.verify` 里抛的自定义错误经 `auth.api` 原样抛出（`instanceof` 成立），经 `handler` 变成 500 空体 | |
| `p8-stdin.ts` | 管道里读到密码；在 `script` 造的终端里 `setRawMode` 后输入不回显；原始模式下 Ctrl-C 是 `\u0003` 这个字节、进程收不到 `SIGINT` | |
| `p9-migrate.ts` | 草稿 `0001_init.sql` 在真实的迁移执行器（从工作树按路径导入 `db/migrate.ts`，只读不改）上执行成功；执行后外键检查重新打开；库在迁移出的表上开着结构检查能注册；审计表的改与删被触发器拒绝 | `migration.applied`；`SQLITE_CONSTRAINT_TRIGGER` |
| `p10-busy.ts` | 别的连接持写锁时，库与模块自己的写都抛原样的 `SQLiteError`（`SQLITE_BUSY`），库不包装；经 `handler` 时 better-call 对非 `APIError` 直接 `console.error` 整个错误（含堆栈与源码路径，`logger.disabled` 管不住）再回 500 空体；配 `onAPIError: {throw: true}` 后错误从 `handler` 抛出、不打印，`APIError` 照旧变成响应 | `APIError` 仍回 401 |
| `p11-page.ts` | 管理列表的翻页 SQL：`anchor` 取当时的最大 id、带着时只看 `id <= anchor`，`total` 与 `counts` 一条 SQL 算出；`LIKE` 转义后 `a_` 只命中 `a_b` | 45 个账号取第 1 页（45 到 26）后再注册一个：带 `anchor` 的第 2 页从 25 开始、`total` 仍 45；不带 `anchor` 的第 1 页新账号排最前、`total` 46 |

**与 ADR 0060 对不上的地方**

1. ADR 0060 决策 1、4 的写法是“库做账号核心、自家路由包一层”。探针表明照这个写法要补的地方很多：库的注册把哈希包在事务里跨 `await`（p3，与单连接的约束冲突，只能换方言绕开）；库的登录在没有密码时不算哈希（p4，输出 4 的“时间不可分辨”要另补）；库的封禁、改角色、改密码删会话的路径与审计不在一个事务里（3.10）；库的失败是它自己的错误码，要逐个翻译。计划改成“登录、注册、改密码与管理的写由自家路由做，库只发会话、读会话、登出”。这不违反 ADR 的字面（决策 3、4 本来就要求自家路由），但与它“协议部分不手写”的出发点有距离：密码登录不是协议，社交登录与对外 OAuth 仍完全交给库（t08）。候选与推荐见第 10 节第 1 条。
2. ADR 0060 决策 5 第二条“改密码删掉该用户的全部会话”与 `site.accounts` 输出 6“当前这一个会话保留”矛盾（第 10 节第 6 条）。
3. ADR 0060 后果最后一条列的“登录后把旧哈希换成新算法”已经探过（p4），“取不到真实 IP 时库的限流行为”不再相关（库的限流关掉，自己做）；第三项“刷新令牌在封禁与重置之后”归 t08。

## 10. 要主会话或开发者定的事

**1. 登录、注册、改密码与管理的写由自家路由做，库只发会话、读会话、登出。**

- 背景：ADR 0060 定了“身份库用 Better Auth、自家路由包一层”。探针（第 9 节“与 ADR 0060 对不上的地方”第 1 条）表明，包库的注册与登录端点要补的地方有四处：注册把哈希包在跨 `await` 的事务里（与单连接冲突）；登录对没有密码的账号不算哈希（时间可分辨）；封禁、改角色、改密码删会话的路径与审计不在一个事务里；库的失败码要逐个翻译成 Spec 的码。
- 候选：
  - A（推荐）：自家路由做这几样写，库只经 `auth.api` 发会话（`SERVER_ONLY` 的小插件）、读会话、登出；社交登录与对外 OAuth 仍完全交给库（t08）。代价：自己写约 600 行（登录、注册、改密码、管理的写与它们的事务），依赖库的四个内部接口（第 8 节第一条），升级时靠包内用例兜底。
  - B：用库的 `sign-up/email`、`sign-in/username`、`admin` 端点，外面包一层、里面加钩子。代价：仍要换方言（p3 的问题不因包一层而消失）；时间可分辨要在钩子里补一次假哈希；审计与删会话的原子性做不到（库的封禁先删会话、后回到我们的代码）；每个库错误要翻译，库升级改了错误码时会悄悄变成 500。补丁的总量不比 A 少，而且分散在库的钩子里。
  - C：连会话也不经库，自己签 Cookie、存会话。代价：多约 200 行；t08 的对外 OAuth 插件要读库的会话（授权中途登录的续接靠库的会话），C 会让 t08 再接一遍。不推荐。
- 推荐 A，并写一份短 ADR 部分取代 ADR 0060 决策 1、4 的做法（“账号的写由自家路由做，库负责会话与协议”），连同第 6 条的结论；不写 ADR 的话至少写进 t07 的 Task 记录。
- 不定会卡住：第 3 片（`nbSession` 插件与路由的分工）及之后全部。

**2. 账号库只用一条连接，库经自定义方言走模块的队列。**

- 背景：`ModuleContext.db` 只有一条连接，注释要求连接上的访问由模块排成一队、跨 `await` 的事务独占它。库缺省接法会把别处的写收进自己的事务（p3）。
- 候选：A（推荐）一条连接、一个队列，库经自定义 Kysely 方言（约 60 行）走它，事务用 `BEGIN IMMEDIATE`、可重入（p3、p3b、p6）。B 给库另开第二条连接：要改入口的模块接口（现在只给一条）；库的事务跨哈希的那段时间里，模块那条连接的写撞 `SQLITE_BUSY`（`busy_timeout` 250 毫秒，哈希 71 毫秒起）；登录的“复核加发会话加记最近登录”不能在一个事务里（跨两条连接）。
- 推荐 A：B 做不到验收 7 与输出 2 要的原子性。
- 不定会卡住：第 2 片。

**3. argon2id 的参数。**

- 背景：输出 20 要给哈希封顶；机器是 2 核 2 GB。
- 候选（p5）：19 MiB、t=2（71 毫秒，并发 2 个时常驻内存从 60 涨到 79 MB）；Bun 缺省 64 MiB、t=2（273 毫秒，从 105 涨到 172 MB）；46 MiB、t=1（101 毫秒，从 87 涨到 133 MB）。
- 推荐 19 MiB、t=2：OWASP 给 argon2id 的最低档之一；登录的响应时间在 100 毫秒以内，同时排队 64 个时最长约 2.3 秒（64 ÷ 2 × 71 毫秒），在 5 秒的过载线以内。存的是 PHC 串，以后提参数不影响旧哈希（`needsRehash` 会在登录时换掉）。
- 不定会卡住：第 4 片。

**4. 创建管理员的命令的三处细节。**

- 背景：`site.operations` 输出 5 只说“用户名不存在时创建、已存在时重置密码并设为管理员”；库要求每个账号有邮箱；Spec 没说已被封禁的怎么办、要不要审计。
- 候选与推荐：
  - 邮箱：推荐参数 `<username> [email]`，没给时用占位邮箱并标“邮箱待补”（与旧站导入同一套，第一次登录后在资料页补）；另一个候选是邮箱必填（多一个参数，少一种状态）。
  - 已被封禁：推荐顺手解封（这个命令是“拿回管理员”的最后手段，留着封禁就拿不回）；候选是保持封禁并在结果里标出。
  - 审计：推荐写一条操作者为“命令行”的审计（`site.admin` 输出 8 的精神：管理操作都有记录）；候选是不写（Spec 的清单里没有）。
- 不定会卡住：第 4 片；审计那一项还卡第 1 片（动作枚举）。

**5. 限流器各做一份还是共用。**

- 背景：统计模块已有一个对齐窗口的限流器；两个模块包互不依赖。
- 候选：A（推荐）账号模块自己一份（不到 100 行）；B 由入口经 `ModuleContext` 提供限流服务（改模块接口，两边的口径要统一成一个参数集）；C 新建一个小包（多一个包与它的边界检查）。
- 推荐 A：两边口径不同（3.8），共用省不下多少代码；出现第三个使用者时再抽。
- 不定会卡住：第 4 片（只影响放在哪，不影响行为）。

**6. 自己改密码时当前会话保不保留（Spec 与 ADR 矛盾）。**

- 背景：`site.accounts` 输出 6 写“用户自己改密码时当前这一个会话保留”，输出 9 写“成功后按输出 6 失效其它会话”；ADR 0060 决策 5 第二条与提案 4.5 一节写“改密码……删掉该用户的全部会话”。
- 候选：A（推荐）照 Spec，保留当前会话：改密码的人不必马上重新登录，别处的会话（可能是盗用者的）全部失效，这正是改密码要的效果。B 照 ADR，全部删掉、让本人重新登录。
- 推荐 A，并在第 1 条的新 ADR（或 ADR 0060 的修订记录）里改掉决策 5 那一句。另：t08 接入对外 OAuth 后，自己改密码要不要撤销已发给第三方应用的令牌，Spec 没写（`site.admin` 只对封禁与重置写了），t08 要定。
- 不定会卡住：第 4 片。

**7. “问身份”给统计模块的形状（t11 README 的待定处）。**

- 候选：A（推荐）`whoami(request: Request): Promise<Response>`，统计模块自己声明这个函数形状、自己解析三个字段，入口适配器转接；ADR 0059 不改，拆进程时换成 `fetch`。B 另写 ADR 部分取代 ADR 0059 决策 2，允许模块依赖别的模块的合同包。
- 推荐 A（3.11）：ADR 0059 决策 5 原文就是“同一个处理函数”，A 照字面实现。
- 不定会卡住：本 Task 只在第 3 片导出；真正卡的是 t11。

**8. 合同测试包能不能导入 `typebox`。**

- 背景：`nb-site-contract-tests/AGENTS.md` 只许导入合同包、`bun:test`、`node:` 与测试支持；合同包的 schema 是 TypeBox 写的。
- 候选：A（推荐）放开 `typebox`，用合同包的 schema 核对每个成功响应的形状；它是合同的语言，换语言重写被测程序时不受影响。B 不放开，逐字段手写断言（每个响应多十几行，与合同包的 schema 各写一份）。
- 不定会卡住：第 3 片（第一批合同用例的写法）。

**9. 注册开关的缺省值。**

- 背景：Spec 要有“注册是否开放”的配置，没说缺省。
- 候选：A（推荐）缺省开放：注册本来就要注册码，开关只是应急；切换上线时忘了设也不会把注册悄悄关掉。B 缺省关闭：更保守，要部署的人显式打开。
- 不定会卡住：第 2 片。

**10. 会话表不存来源地址、只存浏览器概要。**

- 背景：库缺省在会话表里存来源地址与原始的浏览器标识；Spec 只要求列表里给概要，`nb-site-server/AGENTS.md` 要求来源地址不写日志。
- 候选：A（推荐）不存来源地址（`disableIpTracking`），浏览器标识只存概要：少存一样个人数据，管理界面也没有用到它的地方。B 照库缺省存，以后可以给管理员看“从哪里登录的”（Spec 没有这个功能）。
- 不定会卡住：第 3 片。

**11. 库的四张表不加 `STRICT`。**

- 背景：这是账号库的第一条迁移，发布后不改；本模块自己的表都是 `STRICT`。
- 候选：A（推荐）库的表照库导出的结构逐字抄、只加 `AUTOINCREMENT`，以后库升级时比对简单。B 也改成 `STRICT`（p1 的 B 组库照样能用）：类型更严，但每次升级都要在库导出的结构上手工再改一遍类型名。
- 不定会卡住：第 2 片。

**Spec、ADR 与仓库规则之间的矛盾**（第 4 节有对应的改动）：

- 改密码的会话：`site.accounts` 输出 6 与 ADR 0060 决策 5、提案 4.5 一节（本节第 6 条）。
- ADR 0060 后果最后一条“没有经探针核对的”前两项已过时（第 4 节 B6）。
- `nb-site-server/AGENTS.md`“模块取时间用 `context.clock`、不直接用 `Date.now()`”：Better Auth 内部读系统时间，做不到；按 3.14 的做法补一句例外（第 4 节 B8）。
- `site.admin` 输出 10“`anchor` 不是本接口给出的值”字面上要签名才做得到（第 4 节 B3）。

## 11. 没来得及核实的地方

- **旧站的 scrypt 格式。** 参数（N、r、p、64 字节）与“盐按字符串用”取自 t01 的记录与 t02 的探针，没有对照旧站源码，也没有用旧站真实生成的哈希验过（不读旧站数据）。t12 开工前用旧站代码在本地造一个样本哈希、跑一次 `password.ts` 的校验；对不上时只改 `password.ts`。
- **t08 的授权续接经 `issueSession` 是否成立。** 对外 OAuth 插件的“授权中途登录后回到授权请求”靠它的前后钩子：前钩子匹配请求体里的 `oauth_query`，后钩子匹配带会话令牌的 `Set-Cookie`。从源码推断，`issueSession` 这个端点也会被后钩子匹配上，但没有探；t08 第一件事是探它，不成立时 `issueSession` 要把续接参数带进去（本 Task 的接口不变）。
- **库的结构检查对多出来的索引、表、列是否宽容。** 本 Task 只加了自己的表（p9 通过）；t08 若往 `account` 表加列（3.2 推荐不加）要先探。
- **库读 `session.updatedAt` 的地方。** 3.5 自己改它做“最后使用时间”，依据是库的延长只看 `expiresAt`；只在库的会话读写路径里查过，没有全量搜源码。第 3 片的包内用例（改了 `updatedAt` 之后库照常读会话、不延长）兜底。
- **Hono 子应用的 `onError` 与站点根的 `onError` 的先后。** 推断子应用的先生效（Hono 的错误处理按路由所在的应用找）；第 4 片的合同用例（持住账号库写锁时登录得 503 的 `ErrorBody`）直接验。
- **队列在压力下的表现。** 只在探针里跑过 8 个并发；几十个并发登录时排队的时长、与哈希限额叠加后的尾延迟没有量。第 4 片的 `measure-hash.ts` 顺带量 32 个并发登录。
- **真实反向代理。** 来源地址只在沙箱里经 `X-Forwarded-For` 验；生产的代理配置归 t13。
- **Postgres。** ADR 0061 决策 5 说模块以后可能换库；自定义方言是 SQLite 专用的，换库时整块重写（推断代价不大：Postgres 有连接池，不需要这个队列）。
- **worktree 的现状。** 写计划时 `feat/w00037-official-site` 的 worktree 里有别的会话没提交的统计写入口改动（`modules.ts`、`ingest.ts`、`rate-limit.ts` 等，t06 第 3 片）；计划按 t05 修正片已合入（`9167933ea`）的状态写，`modules.ts` 的适配器改动要在 t06 第 3 片合入之后的版本上做。

## 主会话的审定（2026-11-24）

计划由一个 Opus 子代理起草（只读，13 个探针在仓库外跑）。主会话读过第 1 到 5 节与第 10、11 节，结论如下；**与前文冲突的地方以本节为准**。第 4 节的 Spec 改动等设计审查处理完再在 master 上改。

第 10 节的十一件事。开发者 2026-11-24 说过“都按照你推荐就行”，那句话说的是当时列出的事；这十一件是之后才出现的，其中第 1 条改的是开发者定过的 ADR 0060 的做法，所以分两类处理：

**第 1 条要开发者知情、有异议就改**（已在汇报里单独说明，第 3 片开工前不落地）：登录、注册、改密码与管理操作的校验与写入由账号模块自己做，Better Auth 只负责发会话与 Cookie、认 Cookie、登出，以及 t08 的协议部分（社交登录与对外的 OIDC）。主会话的推荐也是这样，理由：

- 探针查出的四处都不是小补丁：库的注册把算哈希包在跨 `await` 的事务里（与“一条业务连接上事务不跨 `await`”冲突，别处的写会被收进它的事务、随它回滚）；库的登录在账号没有密码时不算哈希（响应时间能分辨）；库删会话与写审计不在一个事务里（`site.admin` 输出 8 要求同时生效）；库没有注入时间的口子（合同测试拨不动会话到期）。加上 t07 README 已记的三处，照“包一层库的端点”做，补丁散在密码回调、请求级状态与钩子三处。
- 剩下交给库的（发会话、认 Cookie、登出）正是 t08 的插件要认的那一套会话，t08 不用重接。
- 代价：依赖库的四个内部接口（`internalAdapter.createSession`、`setSessionCookie`、`runWithTransaction`、取事务上下文），库的版本因此钉死，升级要重跑第 2、3 片的包内用例。
- 另一个候选“会话也自己做、账号核心完全不用库”没有采纳：t08 的社交登录与 OIDC 插件建在库的会话上，那样 t08 要自己接会话或也不用库，等于推翻 ADR 0060，本 Task 没有理由走到那一步。交设计审查从整体上再看一遍这个候选。
- 落地时另写一份 ADR（0063），头部写“补充并部分取代 ADR 0060 决策 1、4 的做法”，ADR 0060 只在头部加一行指过去；同一份里改掉决策 5 第二条（见第 6 条）并更新“后果”最后一条里已经有结论的两项。ADR 等设计审查处理完再写。

**其余十条按推荐定**（都不改产品范围，或是照 Spec 的原文）：

2. 账号库一条连接、一个队列，库经自定义方言走这条队列。
3. argon2id 用 19 MiB、2 轮（一次约 71 毫秒）；参数写在哈希串里，以后调高不影响已存的。
4. 创建管理员：邮箱可省（省了用占位邮箱并标“邮箱待补”）；已存在的账号顺手解封；每次成功写一条操作者为“命令行”的审计。
5. 限流器账号模块自己一份，不与统计模块共用。
6. 自己改密码时当前会话保留、别的会话失效：照 `site.accounts` 输出 6 的原文。ADR 0060 决策 5 第二条与提案 4.5 里“删掉该用户的全部会话”是笼统的写法，由新 ADR 改正。
7. “问身份”给统计模块的形状是 `whoami(request: Request): Promise<Response>`，统计模块自己声明这个形状，入口的适配器转接；ADR 0059 不改。记进 t11。
8. 合同测试包放开导入 `typebox`，用合同包的 schema 核对响应。
9. 注册开关缺省开放（注册本来就要注册码）。
10. 会话表不存来源地址，浏览器标识只存概要。
11. 库的四张表照库导出的结构逐字抄、只加 `AUTOINCREMENT`，不加 `STRICT`。

主会话另加的四点：

- 第 3.10 节“直接 `DELETE FROM session`、不经库的钩子”：第 3 片的包内用例要有一条“删行之后库的 `getSession` 立即读不到”，并且在库的版本升级清单里写上“核对库有没有给会话加缓存”。
- 第 3.7 节登录第 4 步“先等 2 秒”占着一个连接与一个限流名额：等待期间不持队列的锁、不占哈希限额，写进注释并有用例（等待中的请求不挡别的登录）。
- 第 3.12 节没给邮箱时“先插一个临时的唯一占位、拿到 id 后改成 `u<id>@placeholder.invalid`”：占位的写法以 `site.legacy-import` 的原文为准，实现前对一遍；两处不能各写一种。
- 第 5 节第 4 片按计划自己的建议拆成 4a、4c、4b 三段派发（4c 先于 4b：合同用例要管理员账号）。

下一步：计划交设计审查（安全边界、单连接上的时序、第一条迁移，按高风险后端：Opus 先审，omp 在后台）。审查说明里点名：第 10 节第 1 条的三个候选（含“账号核心完全不用库”）从整体上再判一次；3.3 的队列与重入；3.7 登录与注册的并发性质；3.5 自己判会话到期与库的判断之间有没有缝；3.2 的迁移有没有发布后改不了的错。处理完后主会话改 Spec、写 ADR 0063，再开第 1 片（合同包，可以先于别的片）。

## 设计审查的处理（2026-11-24）

审查者：一个 Opus 子代理，只读，审的是计划定稿时的副本，在真实的 Better Auth 与 bun:sqlite 上跑了五个实验；报告 [`evidences/design-review-opus.txt`](evidences/design-review-opus.txt)，17 条（重要 9、建议 8，没有阻断）。omp（`@review`）同时在后台审同一份说明，报告回来后另行处理。**与前文（含“主会话的审定”）冲突的地方以本节为准。**

**第 10 节第 1 条（库用到什么程度）**：审查者专门重判了三个候选，结论与“主会话的审定”相同（自家路由加库的会话），并核实了计划列的四处代价都对得上库的源码；它补充的一点是：依赖库的事务上下文这份脆弱不是这个做法带来的，t08 的社交注册由库在它自己开的事务里建账号，而 ADR 0060 决策 6 要求扣码与建账号同一个事务，模块的代码迟早要跑在库开的事务里。它要求的三处修改（下表第 1、2、10 条；第 9 条；第 3 条）都照做。ADR 0063 的头部写“细化 ADR 0060 决策 1、4 的做法，取代决策 5 第二条”。ADR 只收开发者接受过的决定（`docs/adr/README.md`），所以等开发者对这一条表态后再写；第 1、2 片不依赖它，先做。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 库的 `signOut` 把删会话的失败吞掉，照样回成功并清 Cookie，会话在服务端仍有效 | 改。登出不经 `signOut`：模块在写事务里删这一行（失败照常成 503），再经 `nbSession` 插件里一个只供服务端调用的端点取清除 Cookie 的 `Set-Cookie`。用例：外部持写锁时登出得 503、会话仍可用 |
| 2 | 库的 `getSession` 把数据库错误包成 `APIError`，照计划的出口会回 500 而不是 503 | 改。出错出口与 `readSession` 沿 `cause` 链找 `SQLiteError` 再归类（只认 `cause`，不看文字）。3.3“库不包装数据库错误”改成按端点列出：`getSession` 包一层、`signOut` 吞掉（不再用）、注册与发会话原样抛 |
| 3 | 模块的读也走 `BEGIN IMMEDIATE`，进程外有写者时只读接口也停 250 毫秒后回 503 | 改。队列上分 `read(fn)`（延迟事务）与 `write(fn)`（`IMMEDIATE`）；只读接口与登录里找账号用 `read`。`requireSession` 里每小时一次的“最后使用时间”与每天一次的延长遇到库忙时记一行警告、不让本来只读的请求失败 |
| 4 | 旧站格式的账号走更快的 scrypt，不存在的账号永远走 argon2id：耗时能分辨账号是否存在，与 `site.accounts` 输出 4 冲突 | 改。回 `invalid_credentials` 的登录补齐到一个下限（从进入哈希限额算起至少 150 毫秒，高于两种算法在 2 核上的单次耗时），只补失败的；包内用例用注入的睡眠函数核对。第 8 节“仍分辨不出存在”的说法作废 |
| 5 | 管理处置只在中间件里认一次管理员身份，已被封或被降级的管理员已经进门的请求照样生效 | 改。每个处置的写事务第一步复核操作者：会话行还在、角色是管理员、没被封，不成立回 `unauthenticated`。普通用户的写接口同样在各自的写事务里复核会话行还在 |
| 6 | 限流的键满 10 万后新键一律拒绝，两段 IPv6 的 /48 就能把没出现过的用户都挡在登录之外 | 改。两层：IPv6 另按前 48 位合计一次，额度是单个来源的 16 倍，先判它再建 /64 的条目（与统计模块相同）；键仍然满了时，新来源不再一律拒绝，而是共用一个溢出额度（单个来源上限的 10 倍），并记一行 `identity.rate_limit_full`。已经过去的窗口的键不占名额。失败计数满了“一律先等 2 秒”保留 |
| 7 | 空列表给出的 `anchor`（数字部分是 0）会被自己的校验拒收 | 改。数字部分收 0，不大于当前最大 id（空表按 0）；补空列表带着 `anchor` 翻页的用例 |
| 8 | 创建管理员在终端里读密码只认回车与 Ctrl-C，退格与被切开的多字节字符会原样写进密码 | 改。流式解码成码点后处理：退格删一个码点、Ctrl-U 清空、空输入时的 Ctrl-D 按取消、其余控制字符拒收；终端里输两次并比对，不一致以 `invalid_argument` 失败；管道读完整体解码。读密码做成吃字节序列的函数，表驱动测试 |
| 9 | 队列没有自锁检测与等锁上限：库的事务里有代码改用基础适配器取连接时整个模块永久卡住；重入判断误判时写入静默落进别人的事务 | 改。模块只经自己的 `withLibTransaction` 开库的事务，入口处把方言在 `beginTransaction` 时递增的序号放进模块自己的异步上下文；重入判断要求“上下文里的序号等于方言当前的序号、且连接确实在事务里”，否则抛程序错误；在自己的事务里又来取连接的立即抛同一个错误；等锁设 10 秒上限，超了以 `unavailable` 失败并记 `identity.queue_timeout`。库里不取当前事务的调用（已知 `reserveVerificationValue`）列进 t08 的接缝与升级清单 |
| 10 | 库的 `getSession` 遇到按系统时间到期的会话会自己删行，“`whoami` 永不写库”不成立 | 改。装配里打开 `session.deferSessionRefresh`，只用 GET 的方式调 `getSession`；到期的行只由模块的 `readSession` 与清理任务删 |
| 11 | `generateId: "serial"` 是全库的设置，库在这种设置下关掉了靠主键判重的单次使用检查（`private_key_jwt`、DPoP） | 记为约束，写进 3.2 的接缝与 t08 的记录：t08 对外的白名单不提供 `private_key_jwt` 与 DPoP（第一版只有授权码加 PKCE，不受影响）；以后要提供时先把相关的表换成字符串主键 |
| 12 | 失败码表漏了 `internal`；用户名对外给哪种写法没定；先转小写再比会放进开尔文符号 | 改。码表加 `internal`（500）。对外的 `username` 是小写的登录名；原样的写法只存不对外，显示由显示名承担（导入时显示名为空就取旧用户名的原样写法，`site.legacy-import` 已这样写）。字段规则先按 `^[A-Za-z0-9_.]+$` 校验原始输入，过了再转小写 |
| 13 | 库的结构检查在第一次调用时才跑，表不对时 `create()` 照样成功 | 改。`create()` 里主动触发一次结构检查，失败按 `start_failed` 收口 |
| 14 | 升级清单只列了内部接口，没列“模块用自己的 SQL 写库的表”这一层 | 改。包内加“存法契约”用例（同一份账号分别经库与经模块的 SQL 写入，逐列比原始行，再经库读回）；把库在 1.7.27 导出的表结构原文存成包里的基准文件，用例核对“库当前导出的结构等于基准”与“迁移里库的四张表只差写明的 `AUTOINCREMENT`”；第 8 节的升级清单并成一张表（内部接口、存法、本表第 1、2、10、13 条查出的库内行为），每项对一条用例 |
| 15 | 验收映射的几处出入 | 改。IPv6 前缀在合同里测（底座已把回环设成可信代理，转发头可以写任意地址）；登出在写锁下得 503、只读接口在写锁下照常，写成合同用例；`site.admin` 的 Smoke 对上封禁与重置密码两条；注册与登录的先后统一成“先校验字段、再计入限流”（填错字段不占每小时 5 次的额度）；同意门槛放行的 `me` 只指读（`GET me`），写进 Spec；失败 20 次的用例写明用多个来源地址 |
| 16 | 为导入准备的几列没有对照旧库的结构 | 旧站的快照要开发者授权才能读，现在不读。照最宽的可能留列：邀请码表加可空的 `note`，`owner_id` 改成可空（旧码没有创建者时为空；新生成的码由代码保证有主人）。旧库的“是否停用”若只有布尔，导入时停用时间取导入的时刻，记给 t12 写进 `site.legacy-import`。第 11 节加一条“码表的旧结构没有核对” |
| 17 | 账号模块没有 `close()`，停止时队列里还有人持锁或排队，入口照样关库 | 改。`close()` 先让队列拒收新的取锁（以 `unavailable` 失败），再等当前持锁者放锁，至多到入口给的 2 秒 |

审查者提的一个可选简化（登录改成“先发会话、再同步复核，不成立就删掉”，不经库的事务）不采纳：注册仍要库的事务，两条路径用同一种写法更好审；记在这里，库的事务接口以后不稳时再换。

**第 4 节 Spec 改动的定稿**：照 A1 到 A14、B1 到 B4、B7 改，其中这几条按本节调整：

- A3：失败表加 `not_found` 与 `internal`。
- A7：注册的先后改成“`forbidden_origin`、`registration_closed`、`validation_failed`、`rate_limited`、`consent_required`、`registration_code_invalid`、`invite_code_invalid`、`username_taken`、`email_taken`”；登录不变。写明两条理由，并写明字段不合格的请求不计入限流。
- A8：满了之后是“新来源共用一个溢出额度”，不是一律拒绝；加 IPv6 前 48 位的合计。
- A10：另写明同意门槛放行的 `me` 只指 `GET me`。
- 新加 A15：输出 4 的耗时一句不变（由本节第 4 条的下限保证）。字段规则表的用户名一行加“只收 ASCII 的字母、数字、下划线、点”；术语“公开资料”写明用户名是小写的登录名。
- 新加 A16：会话在服务端的失效都是删行；登出在账号库不可用时回 503，不清 Cookie。
- B1：终端里密码输两次、不一致是 `invalid_argument`；Ctrl-D 在空输入时按取消（`interrupted`）。
- B3：`anchor` 的数字部分可以是 0。
- B5、B8 是实现分支里的包说明，随第 3 片改；B6 并进 ADR 0063。

切片的变动：第 2 片的 `connection.ts` 按第 3、9、17 条做（`read`、`write`、`withLibTransaction`、序号、等锁上限、`close()`），迁移按第 16 条加列，另加库结构的基准文件与两条比对用例（第 14 条）；第 3 片按第 1、2、10、13 条装配并加存法契约用例；第 4 片加失败下限（第 4 条）、限流的两层（第 6 条）、读密码（第 8 条）；第 7 片每个处置先复核操作者（第 5 条）、`anchor` 收 0（第 7 条）。实现在 Work 分支之外另开的 worktree `.worktree/w00037-t07-identity`（分支 `feat/w00037-t07-identity-core`，从 Work 分支开）里做，免得与统计的后两片互相干扰，做完合回 Work 分支。

## omp 设计审查的处理（2026-11-25）

omp（`@review`）审的是同一份定稿副本，没有看到上一节。写到第 19 条时上游额度用完退出，没有写“未发现问题的方面”与对第 10 节的判断；已写的 19 条全部处理。报告 [`evidences/design-review-omp.txt`](evidences/design-review-omp.txt)，它自定的级别是阻断 8、重要 11。逐条对照上一节以后，多数已经处理过；新的、要改的落在下表最后一列写的切片里。**与前文冲突的地方以本节为准。**

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 管理处置只复核目标，不复核操作者 | 上一节第 5 条已改（写事务第一步复核操作者）。新的一点成立：复核以后，`last_admin` 再也到不了：操作者在生效那一刻是未封禁的管理员，又不能处置自己，处置完至少还剩他自己。所以去掉这个码，`site.admin` 输出 6 改成写这条不变式，失败表删掉那一行；3.10 的检查列与第 6 节的那条验收作废，t10 计划里的三处一并去掉 |
| 2 | 库的 `signOut` 吞掉删会话的失败 | 上一节第 1 条已改 |
| 3、19 | 限流没有 IPv6 前 48 位合计与溢出额度 | 上一节第 6 条已改，`site.accounts` 输出 19 已写。新的一点成立：3.8 表里“来源这一关过了以后才计来源加用户名”与 Spec 的“每次尝试都计入，在哪个键上被拒就不计入哪个键”不一致。第 4 片照 Spec：每次登录对每个键都判，没超限的键都计入，任一个超限就回 `rate_limited`，`Retry-After` 取超限的键里最晚恢复的那个 |
| 4 | 注册先计限流再校验字段 | 上一节第 15 条与 A7 已改（先校验字段、再计入限流），Spec 已写 |
| 5 | `whoami` 遇到真实到期会话时库会去删行 | 上一节第 2、10 条已改（`deferSessionRefresh`、沿 `cause` 找 `SQLiteError`） |
| 6 | 重入判断只看布尔；同步事务回调可以返回 Promise | 前一半上一节第 9 条已改。后一半成立，补进第 2 片（已告诉在做的子代理）：`read`、`write` 的回调返回 thenable 时回滚并抛程序错误 |
| 7 | 改成同一个密码、或用原密码重置时，进行中的登录再校验也能通过 | 不成立。这次登录给出的是改完以后仍然有效的密码，发会话是对的；改成同一个密码本来就挡不住知道这个密码的人重新登录。封禁的复核在第 9 步的事务里，不用第 5 步的快照 |
| 8 | 子应用挂到入口上时它的 `notFound` 不跟着走；`bodyLimit` 超限缺省回 413 | 成立，第 3 片：子应用最后登记一条兜底路由（覆盖前缀本身），回 `not_found`；`bodyLimit` 的超限出口回 400 `validation_failed`、`fields: []`（`site.accounts` 输出 22）。合同用例：前缀下未知的路径与方法、超过 16 KiB 的定长与分块请求、不是 JSON、不是对象，逐个断言状态与响应体 |
| 9 | 发起改密码的会话在排队时被另一个会话结束，改密码照样提交 | 上一节第 5 条已改（普通用户的写接口在写事务里复核会话行还在） |
| 10 | 会话时长 1 天时永远延长不了；两个请求同时延长；延长时会话已被删 | 第一点成立：`NB_SITE_IDENTITY_SESSION_DAYS` 的范围改成 2 到 365，Spec 已改，第 2 片已告知。第三点成立、做法便宜：延长的 `UPDATE` 影响 0 行时不发 Cookie（第 3 片）。第二点不改：两个请求都把到期时间改到差不多同一刻、各发一次同一个令牌的 Cookie，没有可观察的坏处。改配置以后旧会话按新时长判延长，接受 |
| 11 | 第一条迁移放不下旧邀请码的备注与没有主人的码 | 上一节第 16 条已改（可空的 `note`、可空的 `owner_id`）。新的一点记给 t12：旧码里 `max_uses = 0` 这类值、引用不到的创建者，在导入的预检里定规则，不在导入中途才发现 |
| 12 | 失败分支的耗时与账号存不存在有关 | 上一节第 4 条已改（失败补齐到下限）；下限对所有回 `invalid_credentials` 的分支都生效，包括未知格式的哈希。第 4 片补一项：在采用的参数下实测两种算法单次校验的 p99（2 核、并发 2），下限要高于它，数写进注释 |
| 13 | 各段排队没有统一的上界与关闭规则；同步的忙等会停住事件循环 | 读写分开、`close()`、等 2 秒不占名额，上一节第 3、17 条与“主会话的审定”已改。同步忙等不改：进程外写账号库的只有 `create-admin`，偶尔一次，每次至多 250 毫秒 |
| 14 | TypeBox 的长度数的不是码点；登录与旧密码的下限 | 成立，第 1 片（说明已补）：omp 在 TypeBox 1.3.6 上实测 `minLength` 按字素一类的规则数（`abcdefe` 加一个组合重音是 8 个码点，`minLength: 8` 判不过），所以按码点的长度规则不用 `minLength`、`maxLength` 表达；登录的密码只查上限；改密码时的 `currentPassword` 也只查上限，不套新密码的 8 个码点下限（旧站导入的密码可能更短）。用户名先查 ASCII 再转小写，上一节第 12 条已改 |
| 15 | 创建管理员的终端输入：两次确认、取消与信号 | 两次确认与 Ctrl-D，上一节第 8 条已改。新的几点成立，第 4 片：原始模式下读到的 Ctrl-C 字节按 `interrupted` 失败（不抛 `AbortError` 让入口当成未处理的错误）；终端模式在 `finally` 里恢复；每次写库前查一次 `signal`；给的邮箱只在新建账号时校验与查重（Spec 写着已存在时忽略邮箱） |
| 16 | 直接删会话不等于撤销 OAuth 令牌 | 成立，接缝在 t07：所有删会话的地方（登出、结束单个会话、结束全部、改密码、封禁、改角色、重置、清理任务）都经模块里同一组函数，在调用方的写事务里删。t08 在这组函数里加令牌与授权码的撤销，同一事务；记进 t08 |
| 17 | 列表的 `anchor` 只冻结新增，已有的条目开始符合筛选时偏移会让后面的页重复出现一条 | 空列表的 `anchor` 上一节第 7 条已改。重复一条：改 Spec，`site.admin` 输出 9 写成“可能少看到一条或重复看到一条”（管理列表，接受），不改成按上一页末项续取：前端要的是任意跳页。第 7 片补一项：`page`、`pageSize` 是安全整数，偏移量不溢出 |
| 18 | 库的 `reserveVerificationValue` 失败后重读不在事务里 | 上一节第 9 条已列进 t08 的接缝与升级清单；t08 开工前在这条队列上做真实的并发探针，记进 t08 |

## 实现审查（第 1 到 3 片）的处理（2026-11-25）

范围 `29f2c05f1..2f0d79144`。Opus 子代理先审：8 条，重要 2、建议 6；报告 [`evidences/impl1-review-opus.txt`](evidences/impl1-review-opus.txt)。它核对了设计审查处理表里落在这三片的条目都已做到（第 1 条只做到一半，见下），实测 `withLibTransaction` 里复核加发会话可行、模块的到期判断总不晚于库、Kysely 的“支持多连接”声明没有让别的路径并发用同一条连接、第一条迁移没有发布后改不了的错。omp（`@review`）同时在后台审同一范围，回来后另行处理。一个修正提交：

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | `read`、`write` 的回调写成 async 时只拦住一半：`await` 之前的回滚了，之后的语句用原始连接自动提交、绕过队列；那个 thenable 随后 reject 成了没人接的错误，入口当成致命错误停机 | 改。回调拿到的是只在这次事务里有效的句柄，事务结束后再用就抛程序错误；回调返回的 thenable 接上处理（记一行程序错误的诊断，不让它成为没人接的 reject）。用例用真实的 async 回调：`await` 之后的写不落库、进程不因此停 |
| 2 | 库自己开的事务里，模块代码一律被拒；ADR 0063 写了 t08 的社交注册要让模块扣码的代码跑在库开的事务里；两道拒绝都没有用例 | 拒绝保留（现在没有调用方，拒绝是安全的缺省），补两道拒绝的用例。ADR 0063 那条后果写的是 t08 要满足的要求，不冲突：t08 用探针定“加入库开的事务”的入口（记进 t08） |
| 3 | `__Secure-` 前缀挡不住同一上级域名下的其它子域写同名 Cookie | 改，趁还没发布：会话 Cookie 改用 `__Host-` 前缀（要求 `Path=/`、不带 `Domain`，与“作用域是站点地址”一致）。库能否给出这个名字由实现者先探；能的话主会话把 `site.accounts` 输出 5 的名字改成 `__Host-nbsite.session_token`，不能就停下汇报 |
| 4 | 已登录的 `whoami` 多查一次同意记录、结果不用；同意表读不出时 `whoami` 也会 503 | 改。`whoami` 不查同意 |
| 5 | 账号接口的响应没有 `Cache-Control: no-store`，随 Cookie 变化的回答可能被代理或浏览器缓存 | 改。账号子应用的所有响应都带 `Cache-Control: no-store`；合同用例核对 |
| 6 | “问身份”的转接是模块级变量，后建的实例覆盖先建的，关闭后不清 | 改。转接跟着模块实例走，由入口的适配器从实例上取 |
| 7 | “删会话只经那组函数”没有机检 | 改。`architecture.test.ts` 加源码守卫：删 `session` 表的 SQL 只出现在会话模块里 |
| 8 | 合同测试一处注释说 Cookie 名字“是实现选的”；`SQLITE_LOCKED` 不算“库不可用”与计划 3.3 不同、没记 | 改注释；README 记上（理由：只在同一条连接上的冲突里出现，是程序错误，与统计模块一致） |

另外随这个提交修：合同包 `ErrorBody` 的静态类型有一支推成 `never`（第 3 片实现者报的，运行时不受影响），改成传元组，账号包去掉绕开它的本地类型。

## omp 实现审查（第 1 到 3 片）的处理（2026-11-25）

omp（`@review`）审同一范围：写到第 11 条时被上游的安全过滤拦下退出（exit 1），没有写“未发现问题的方面”。按约定不改写说明去绕、不重试，已写的 11 条照常处理；报告 [`evidences/impl1-review-omp.txt`](evidences/impl1-review-omp.txt)，它自定的级别是重要 9、建议 2，每条都在真实的 Better Auth、SQLite 与 Hono 上复现过。Opus 那轮的修正提交在做，下表要改的另成第二个提交，在同一个 worktree 里接着做。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | `readBody` 按“取到的字段名个数”判成败；两个 PATCH 的 schema 对 `{}` 给的是一条没有字段名的 `minProperties` 错误，于是 `{}` 被放过 | 改。只要 schema 有错误就拒，`fields` 可以是空数组；补空对象的用例 |
| 2 | 合同包的 `literalUnion` 让所有字符串枚举的静态类型都坏了（七处），不只 `ErrorBody` | 改，扩大 Opus 那轮表下那条的范围：所有用 `literalUnion` 的地方都修，加经公开入口赋值的编译期用例 |
| 3 | 审计表的删除触发器挡不住 `REPLACE` 的隐式删除，同 id 的 `REPLACE` 能覆盖历史记录 | 改。第一条迁移还没合入 master、没有发布，直接在 `0001_init.sql` 里加插入前的触发器：插入的 id 已存在时拒绝；补同 id `REPLACE` 被拒的用例 |
| 4 | 同步事务回调写成 async 时挡不住后续写入与没人接的 reject | 与 Opus 那轮第 1 条相同，在第一个提交里改 |
| 5 | 库按系统时间判到期时 `getSession` 回空，模块到不了删行、清 Cookie 的分支：要会话的路由回 401 但不清 Cookie，行留到清理任务 | 改，做法便宜的一半：请求带着会话 Cookie 却读不出会话时，回应里清掉 Cookie；行照旧由清理任务删 |
| 6 | 库的 `findSession` 先查会话、放锁、再查用户，改角色并撤销会话的事务夹在中间时，`whoami` 能拿旧会话回新角色 | 先试便宜的改法：打开库的 SQL join（`experimental.joins` 一类的选项），让会话与用户在一条查询里读；能打开且库的用例都过就改，并补这个并发用例。打开要改库的内部行为或牵动太多时停下汇报，按已知限制记（后果是改角色的那一刻有一次回答带着新角色，而这个账号确实已是这个角色） |
| 7 | 库从进程环境读 `BETTER_AUTH_SECRETS`，存在时会盖过站点的会话密钥 | 改，与第 8 条一起：进程环境里有以 `BETTER_AUTH_` 开头的变量时，配置校验以 `config_invalid` 失败（问题词 `not_allowed`，记在变量名上）。`site.accounts` 的配置与 `site.operations` 的问题词已改 |
| 8 | 库的环境开关能打开显式关闭了的库自带遥测 | 同第 7 条 |
| 9 | 清理任务遇到库不可写时记一行就正常返回，经测试控制入口手动跑得 200 `done` | 改。记完诊断后抛出，任务以失败结束（定时调度照常排下一次），与统计模块一致；补合同用例：持写锁时手动跑得 `job_failed`，放锁后成功 |
| 10 | 只有 UTF-8 BOM 的请求体解码后是空串，被当成空体 | 改。按收到的字节判空 |
| 11 | 等锁上限的用例用的手动计时器不看延迟，把上限从 10 秒改成 60 秒用例照过 | 改。测试计时器按登记的延迟到期，补“9999 毫秒时仍在等、10000 毫秒时拒绝” |

## 实现审查（第 4、5 片）的处理（2026-11-25）

范围 `be3c0e5cc..02ce9d01b`。Opus 子代理先审：7 条，重要 1、建议 6；报告 [`evidences/impl2-review-opus.txt`](evidences/impl2-review-opus.txt)。它核过登录各条失败分支都经同一个下限、发会话事务里复核封禁与哈希、哈希限额的占位与关闭、改密码与登录并发、创建管理员的终端读法与事务、注册的扣码与回滚、分页的 `anchor` 与参数绑定，没有发现问题。omp（`@review`）同时在后台审同一范围，回来后另行处理。一个修正提交：

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 来源已经超限、整体回 429 时，每换一个用户名，“来源加用户名”的新键照样写进表；一个地址约 10 万次请求就能把这张表占满、再用完溢出额度，这一窗里所有第一次出现的组合都得 429（实测：之后 alice 从没出现过的地址登录得 429） | 改。被来源计数拒绝的登录不再计入、也不新建来源加用户名的条目；`site.accounts` 输出 19 已写明。补用例：来源超限后换着用户名发，来源加用户名的键数不增长，别的地址照常登录 |
| 2 | 失败下限的起点在排队之前，排队时补齐失效；用例把时钟固定成常量，测不出起点放在哪 | 改。下限从拿到哈希名额那一刻起算；用例让排队真的占时间，核对起点 |
| 3 | 创建管理员从管道读密码时不拒控制字符与中间的换行，已存在的账号会被重置成浏览器里输不出来的密码 | 改。管道只去掉末尾一个换行（`\n` 或 `\r\n`），其余控制字符与中间的换行按 `invalid_argument`（`password`、`invalid`）拒，与终端分支一致 |
| 4 | /64 与 /48 被当成一个键判，与 Spec“在哪个键上被拒就不计入哪个键”的字面不符 | Spec 补一句（已写：两个当一个来源判，任一个超限都不计入），不改代码 |
| 5 | 库上下文里的 `password.hash`、`verify` 是裸函数，不经哈希限额；t08 走库的密码路径时会绕开输出 20 | 记进 t08 的接缝：用到库的密码路径时先把这两个函数接上限额 |
| 6 | “缺不缺同意”的规则写了两份（`me.ts` 与会话中间件），`GET me` 查两遍同意表 | 改。合成一个函数，`GET me` 用中间件已经查到的结果 |
| 7 | 用户名与邮箱是两套限流键与失败计数，同一个账号的额度与“满 20 次先等”的门槛都翻倍 | 不改，记为已知限制：要合成一个键得在限流之前查库，换来的只是额度从 20 到 40 |

## omp 实现审查（第 4、5 片）的处理（2026-11-25）

omp（`@review`）审同一范围，正常跑完（exit 0）：有效 6 条，重要 2、建议 4；它自己撤回的第 1 条与 Opus 那轮第 2 条相同。每条都在真实进程上复现过；报告 [`evidences/impl2-review-omp.txt`](evidences/impl2-review-omp.txt)。要改的在 Opus 那轮的修正提交之后另成一个提交，同一个 worktree。

| 条 | 发现 | 处理 |
|---|---|---|
| 2 | 创建管理员只在每次写之前看停止信号；同步的 `BEGIN IMMEDIATE` 等锁时（至多 250 毫秒）收不到 `SIGTERM`，锁随后放开就照样提交、以 0 退出（实测账号与审计各多一行） | 改。命令自己的连接 `busy_timeout = 0`，撞忙立刻回来，由已有的、看 `signal` 的异步重试去等；总的等待时长与次数与现在相当。拿到锁之后到提交是同步的一小段，算已经开始，不再中止。补用例：持锁期间发停止信号，放锁后账号与审计都没变、以 `interrupted` 结束 |
| 3 | 超过 16 KiB 的请求体在来源地址与注册开关之前就回 `validation_failed`，与失败先后不符 | 不改代码，改 Spec：超限的请求在来源头之后、别的检查之前就拒（读体之前要拦下，这样的请求方不是正常的页面，先后对它没有意义） |
| 4 | 查询串收进普通对象，`__proto__` 这个键被原型的 setter 吞掉，多余键与重复键都查不出 | 改。用没有原型的对象收集；补 `__proto__` 出现一次、两次的用例 |
| 5 | 读密码的 `TextDecoder` 缺省去掉 U+FEFF：终端里逐码点解码时中间的也丢，两次只差一个 U+FEFF 被当成一致；管道读时开头的丢掉，存进去的不是输入的密码 | 改。两处解码都设 `ignoreBOM: true`，字符原样进校验；补开头与中间带 U+FEFF 的表驱动用例 |
| 6 | 已登录的请求方也能注册，浏览器换成新账号的会话，与输入表“访客”不符 | 不改代码，改 Spec：输入表改成“访客、用户”，输出 1 写明换成新会话、原会话不结束，与登录一样；挡住要另加一个失败码，换不来什么 |
| 7 | 请求体按非严格的 UTF-8 解码，无效字节变成 U+FFFD 后通过校验，注册建出输入里没有的名字并扣码 | 改。按严格的 UTF-8 解码（`fatal: true`），解不出与不是 JSON 同一个出口；补“无效字节不建号、不扣码”与“合法的 U+FFFD 照收”两条用例 |

## 实现审查（第 6 到 8 片）的处理（2026-11-25）

范围 `02ce9d01b..f8eb66f1e` 账号这一侧的提交（含上一轮的两个修正）。Opus 子代理先审：5 条，都是建议；报告 [`evidences/impl3-review-opus.txt`](evidences/impl3-review-opus.txt)。它核过管理处置都经 `adminWrite`、“站里始终至少留一个未封禁的管理员”在并发下成立、重置密码的新密码不外泄、原始 `User-Agent` 不落库、分页的基准与计数同一个读事务、上一轮两个修正与合并的接缝，没有发现问题。omp（`@review`）同时在后台审同一范围，回来后另行处理。一个修正提交：

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 结束全部会话的审计条数取删除的行数，把已到期、还没被清理的行也算进去，与详情的 `sessionCount` 对不上 | 改。只数未到期的；补拨钟后结束会话、审计 `count` 与详情一致的用例 |
| 2 | 搜索的“不分大小写”只对 ASCII 成立，`Élodie` 用 `élo` 搜不到 | 不改代码，改 Spec：用户名与邮箱存小写、不分大小写，显示名只有 ASCII 字母不分大小写。另存一列转小写的显示名要动库的表，换来的只是管理搜索里少数显示名 |
| 3 | Safari 的规则对病态长标识是平方级的，16 KB 的标识在持着库事务与队列时同步跑约 50 毫秒 | 改。识别前截到前 512 个字符，规则改成线性的判断；补一条长标识用时有上界的用例（按回应正确与否判，不量时间的就补表驱动的“截断后照样认出”） |
| 4 | 邀请码只限同时有效 10 个，“生成再停用”能无限循环，列表不分页，单个会话 2000 轮 4.3 秒、列表 275 KB | 改。生成按账号每小时至多 10 次（停用了再生成也算），超了回 `rate_limited` 与 `Retry-After`，用已有的限流器；`site.accounts` 输出 18、19 已写。列表照旧不分页：每小时 10 个封住了增长 |
| 5 | 头像与网站存原始输入，换行、NUL、双向控制符、制表符都能过 | 改。合同包的规则拒收空白、控制字符与双向控制符（`validation_failed`，字段名）；`site.accounts` 字段规则已写。不改成存规范化的 `href`：用户填的样子原样给出，前端照样用 |

审查者另提的一处没写进报告的：停止时模块的 `close()` 先于等定时任务停下，排队中的 `purge` 会以 `closed` 失败、多记一行 `job.failed`。不改：停止顺序是 `site.operations` 输出 9 定的（先让模块收尾、再等任务），只在停止与清理撞在同一刻时多一行诊断。

## omp 实现审查（第 6 到 8 片）的处理（2026-11-25）

omp（`@review`）审同一范围，正常跑完（exit 0）：有效 3 条，重要 1、建议 2；它自己撤回的第 1 条（显示名搜索只对 ASCII 不分大小写）与 Opus 那轮第 2 条相同，已按 Spec 定。每条都在真实进程上复现过；报告 [`evidences/impl3-review-omp.txt`](evidences/impl3-review-omp.txt)。要改的在 Opus 那轮的修正提交之后另成一个提交，同一个 worktree。

| 条 | 发现 | 处理 |
|---|---|---|
| 2 | 请求体的字节是合法 UTF-8，但 JSON 里 `"\ud800"` 这样转义写出的孤立代理项能过字段规则，存进 SQLite 时变成 U+FFFD，调用方拿到 200 却存了别的文字 | 改。读体之后校验所有字符串是良构的（`isWellFormed`），不良构的字段 `validation_failed`、列出字段名；合法的代理对与显式的 U+FFFD 照收。`site.accounts` 字段规则已写 |
| 3 | 改角色与登录并发时，登录回的角色取自哈希之前读的资料，与新会话的角色相反（8 次升降都复现；会话本身的权限是对的） | 改。发会话的事务里读公开资料，提交后用它组响应；补升、降角色与登录并发时响应的角色与 `whoami` 一致的用例（包内用队列交错造时序）。`site.accounts` 输出 4 已写 |
| 4 | `https:example.org` 这种没有 `//` 的写法能过，无基准时解析成 `https://example.org/`，页面按站点地址解析成站内路径 | 改。只收以 `http://` 或 `https://` 开头、带主机的地址；`site.accounts` 字段规则已写 |
