# w00037 t10 官方站前端：实施计划

起草：规划子代理，2026-11-24。主会话审定后再派人实现。引用的 Spec、Task、规范都读主工作区 master 上的那份。

## 1. Context

**目标。** 在 `packages/nb-site-web` 里照 t09 定稿的外观实现官方站的单页应用：登录（兼作主页）、注册、同意条款、授权确认四张稿纸页，账号页，管理面板（看板、用户、注册码与邀请码、OAuth 客户端、审计），隐私政策与服务条款两个公开页；另给 nb-ui 加两个通用组件：分页 `Pagination` 与带工具条和分页的数据表格 `DataTable`（t09 第 12 条）。产物由 `nb-site-server` 发，随服务端的镜像发布（提案 4.3）。

**已定、不再讨论的**（t09 README 的 1 到 15，加 t09 “下一步”里两处照 Spec 改图）：主页只做登录入口；管理员登录后到看板、普通用户到账号页；手机适配只到稿纸页与公开页，账号页能用，管理面板只做桌面宽；全站 nb-ui 默认主题，跟随系统明暗；四张稿纸页同一张纸；社交登录是表单下的两枚图标；账号页一页到底、左目录、“待补”只标在格子与目录上；数据表格三块位置固定、每页 20 条、多于 7 页时 7 格；ECharts、看板按页拆包；看板的内容、序列色与红色色阶；密码一行显示“已设置”或“没有设置”；“退出其它所有设备”由页面逐个结束会话。第一版只做中文（t10 README 语言一段、t09 已追认）。

**现状**（2026-11-24 读到的）：

- `nb-site-web` 只有 `package.json`（依赖 `nb-ui`、`vue`）、只含 tests 的 `tsconfig.json`、`AGENTS.md` 与 `tests/boundary.test.ts`。Vite、Tailwind、nb-ui 的接法排在 t05 第 6 片（t05 计划 3.10），还没做。
- 两个合同包只导出路径前缀常量 `IDENTITY_API_PREFIX = "/api/identity/v1"`、`TELEMETRY_API_PREFIX = "/api/telemetry/v1"`；schema 由 t06、t07、t08（以及 t11 的查询接口）加。
- `site.oauth-provider` 将按 t08 第六轮探针改写成标准 OpenID Connect（发现文档自家给、RS256 的 id_token、授权请求 10 分钟、`prompt` 只支持 `none`、`login`、`consent`），授权确认页、登录续接、“已授权的应用”、OAuth 客户端页依赖的接口都可能变。下文凡是依赖它的地方标“（依赖 t08 改写）”。
- 实现 worktree `.worktree/w00037-official-site` 里另一个子代理在写 t05 到 t08 的后端。

**工作方式。** 分两段（第 5 节）：

- **段 A：nb-ui 两个组件**，不依赖后端。在主工作区 master 上开分支 `feat/w00037-t10-nb-ui`、worktree `.worktree/w00037-t10-nb-ui`，审查通过后先合入 master；官方站分支变基后用。
- **段 B：官方站**，在官方站分支上做（落在哪个 worktree 见第 9 节 D13）。现在就能做的片（外壳、看板外壳）先做；其余各片等对应合同包导出 schema。注意：前端各片等的是**合同包里的 schema**（类型、码表、字段规则），不是后端实现；dom 测试与假接口的浏览器场景只要 schema 就能写。对着真实服务的冒烟才要后端做完。

Spec 与 Task 记录的改动（第 4 节）由主会话在主工作区 master 上做，先于依赖它的那一片。

## 2. 技术选型

| 要的东西 | 选择 | 理由 | 没选的 |
|---|---|---|---|
| 构建 | Vite 8（rolldown）、`@vitejs/plugin-vue`、Tailwind 4，照 dev-panel | t05 计划 3.10 已定照 dev-panel；`cssMinify: "esbuild"` 与它的注释理由照抄 | — |
| 路由 | `vue-router` 5（与 dev-panel 的 `^5.1.0` 同版本线），`createWebHistory`，页面按需加载 | 仓库里已有，按路由拆包是 t09 第 13 条“看板按页面拆包”的落点 | 手写路由：要自己做懒加载与守卫 |
| 界面文字 | nb-ui 的翻译端口加它自带的最小翻译实现，目录是 JSON（3.3） | 只有一种语言；组件取字的方式与应用、nb-ui 相同，以后换引擎只换根上的端口 | i18next：应用用它，但官方站第一版没有语言切换、复数之外的格式，没有要它的地方 |
| 共享状态 | 一个模块里的 `reactive` 当前账号（`whoami` 加 `me`），不引 Pinia | 全站跨页的状态只有这一份；列表、看板的状态放 URL 查询串 | Pinia：一份状态不值得一个库 |
| 请求 | 原生 `fetch`，由参数注入（3.2） | `nb-site-*` 在 test-conventions 的 `STRICT_TEST_ROOTS` 里，不许 module-mock 与 `spyOn`，只能注入 | ofetch、axios：没有要它们的功能 |
| 响应校验 | 只用合同包的类型（`import type`），不在浏览器里跑 TypeBox 校验；错误体的形状用一个手写的守卫判断 | 同源、自家服务；在浏览器里带 TypeBox 的校验器多一截体积（没量）。契约靠合同测试与真实冒烟兜底 | 每个响应都 `Value.Check`：多体积，失败时也只能显示“出错了” |
| 图表 | ECharts 6.1.0 按需引入（3.5） | t09 第 13 条 | — |
| 组件测试 | Vitest、happy-dom、`@vue/test-utils`，文件名 `*.dom.test.ts`，包内 `bunfig.toml` 让 `bun test` 跳过；纯逻辑用 `bun test` | 仓库现行写法 | — |
| 浏览器测试 | `@playwright/test`，配置放在 `nb-site-web` 里，`channel: "chrome"` | 现有的 Playwright 配置属于应用包，官方站要自己的一份（3.10） | 借应用的 e2e：应用包不该依赖官方站 |
| 静态文件 | `nb-site-server` 用 Hono 的 `serveStatic`（`hono/bun`）发，单页回退自己写一个处理函数（3.8） | Hono 已是它的依赖；提案 4.3 定了“由这个进程发静态文件” | 反向代理发：部署变成两份产物 |
| 品牌标志 | 两家官方压缩包里的 SVG，原样放进 `src/assets/brands/`（3.7） | 两家的规范都不许改形改色 | 手画、图标字体 |

## 3. 关键设计

### 3.1 页面与路由：`packages/nb-site-web/src/router.ts`、`src/pages/`

**路由表。** 每条路由的 `meta` 写 `access`（`public`、`guest`、`user`、`admin`）、`layout`（`paper`、`account`、`admin`、`plain`）与标题键。

| 路径 | 页面 | 谁能进 | 进不了时 |
|---|---|---|---|
| `/` | 访客：稿纸加登录表单（即主页，t09 第 1 条）；已登录：不画页面，按下面的“分派”跳走 | 任何人 | — |
| `/login` | 与 `/` 同一个页面组件 | 访客；带 `continue` 时任何人（见“登录续接”） | 已登录且不带 `continue`：分派 |
| `/register` | 稿纸：注册 | 访客 | 已登录：分派 |
| `/consent` | 稿纸：同意条款 | 缺同意的用户 | 访客：`/login?next=/consent`；不缺同意：`next` 或分派 |
| `/account` | 账号页，锚点 `#profile`、`#security`、`#sessions`、`#invites`、`#apps` | 用户、管理员 | 访客：`/login?next=…`；缺同意：`/consent?next=…` |
| `/oauth/consent` | 稿纸：授权确认（依赖 t08 改写；路径暂定） | 用户 | 访客：去登录并带上续接；缺同意：先同意 |
| `/admin` | 看板 | 管理员 | 访客：`/login?next=…`；普通用户：`/account`；缺同意：`/consent?next=…` |
| `/admin/users`、`/admin/codes`、`/admin/clients`、`/admin/audit` | 管理面板的四个列表页 | 管理员 | 同上 |
| `/privacy`、`/terms` | 公开页 | 任何人 | — |
| 其它 | “没有这一页”，带回到首页的链接 | 任何人 | — |

**分派**（`src/session/dispatch.ts`，纯函数，`bun test` 覆盖）：输入当前账号的状态与 `next`，输出去处。

1. 匿名：留在登录页。
2. 缺同意（`me` 的“是否还缺同意”为真）：`/consent`，原来的 `next` 带过去。
3. 带合格的 `next`：去 `next`。
4. 管理员：`/admin`；普通用户：`/account`。

`next` 只收站内路径：以 `/` 开头、第二个字符不是 `/` 或 `\`、用 `new URL(next, location.origin)` 解析后 origin 不变；不合格的当没带，防开放跳转。

**守卫**（`router.beforeEach`）：第一次导航时取 `whoami`；结果是已登录时再取 `me`（要它的“是否还缺同意”；`whoami` 只给角色）。两个结果存进当前账号模块，之后的导航不再取；登录、注册、同意、登出、任何请求得到 `unauthenticated` 时更新或清空。`whoami` 回 `unavailable` 时不当匿名处理，整页显示“暂时连不上账号服务”与重试（`role=alert`，ui-development-spec 4.1）。

**登录后的去向。** 登录、注册、补交同意成功后都走分派。从授权请求来的人（`site.oauth-provider` 输出 4、`site.accounts` 输出 23 末句）登录后回那次授权请求：

- 服务端把人带到 `/login?continue=<不透明令牌>`（提案 4.5 的“继续”令牌）；登录页把它原样放进登录请求，响应里带一个站内的继续地址，页面 `location.assign` 过去，不走分派。
- 合同还没写这个令牌（第 4 节 S1、S2），归 t08。没写之前登录页只有分派这一种去向。
- 带 `continue` 的已登录用户（`prompt=login` 要求重新登录）照样看到登录表单，不分派。
- 从这样的登录页点“注册”或社交图标时，`continue` 一并带上（S2）。

**`social_error`。** 三个落点页进入时读这个查询参数，查目录 `errors.identity.<码>` 得文案，写进页面固定位置的状态行（下面“状态行”），再用 `router.replace` 把参数从地址里去掉（刷新不重复显示）。

| 页 | 码 | 显示 |
|---|---|---|
| `/login` | `social_not_registered` | 状态行：“这个 GitHub 账号还没有注册”，后面一个“去注册”链接（带上同一个上游名） |
| `/login` | `social_state_invalid`、`account_banned` | 状态行 |
| `/register` | `social_email_missing`、`email_taken`、`social_state_invalid` | 状态行；表单按 3.9 从暂存的草稿还原 |
| `/account` | `identity_taken`、`identity_exists`、`social_state_invalid` | “登录与安全”一节里“已关联的账号”那一行的状态行，页面滚到 `#security` |

码不在这张表里时显示通用文案并附上码（ADR 0034）。

**状态行与表单错误。** 照 nb-ui 开发规范“表单与无障碍”第 7 条：

- 必填项没填、长度或格式不合规则时提交按钮不可用。规则取自合同包导出的字段规则常量（3.2）：用户名 3 到 30、小写字母数字下划线点，显示名 1 到 50，邮箱至多 254，密码 8 到 128，网址至多 500，签名至多 200；长度靠输入上限。
- 提交之后才知道的错：对应字段经 nb-ui `Field` 的 `error` 标红并得到焦点；看得见的原因写在表单里一个固定位置的状态行，一次一条。状态行在稿纸卡片里位于最后一个字段与提交按钮之间，在账号页每一节的操作行左侧，在对话框里用 `Dialog` 的 `status`；空着时也占位置，所以出错与恢复都不推动别的内容（规范第 3 节第 4 条）。
- 这与 t09 README 记的“页面在那个字段下显示它的规则”不同，列在第 9 节 D9。
- `rate_limited`：状态行写“操作太频繁，{{seconds}} 秒后再试”，每秒更新；倒数完之前提交按钮不可用。倒计时用页面自己的计时器，读 `Retry-After`。

**逐页的接口与失败码。** “状态行”指上面那一行；“字段”指标红加聚焦，原因仍写在状态行。

| 页 | 接口 | 失败码与位置 |
|---|---|---|
| 登录 `/`、`/login` | `GET meta`（各上游是否开放、注册是否开放）、`POST login`、`POST social/:provider/start`（意图 `login`） | `invalid_credentials`：两个字段都标红、状态行；`account_banned`、`forbidden_origin`、`overloaded`、`unavailable`、网络失败：状态行；`validation_failed`：按 `fields` 标字段；`rate_limited`：状态行倒计时；`provider_disabled`：状态行。`meta` 失败时表单照常可用，社交图标不可点 |
| 注册 `/register` | `GET meta`、`POST register`、`POST social/:provider/start`（意图 `register`，带齐注册内容） | `registration_code_invalid`、`invite_code_invalid`、`username_taken`、`email_taken`：对应字段；`consent_required`：勾选框；`validation_failed`：按 `fields`；`registration_closed`：整张卡片的表单不可用、状态行写“现在不开放注册”（`meta` 里已知关闭时一进来就是这样）；`rate_limited`、`overloaded`、`provider_disabled`：状态行 |
| 同意 `/consent` | `GET meta`（条款版本）、`POST me/consent`、`POST logout` | 失败都写状态行；`unauthenticated` 走统一处理 |
| 账号 `/account` | `GET me`、`PATCH me`、`POST me/password`、`GET me/sessions`、`DELETE me/sessions/:id`、`GET me/identities`、`DELETE me/identities/:id`、`POST social/:provider/start`（意图 `link`，带当前密码）、`GET`/`POST`/`PATCH me/invite-codes`、`GET`/`DELETE me/grants`（依赖 t08 改写） | 每一节自己的状态行：资料一节 `email_taken`、`validation_failed` 标字段；密码一节 `invalid_credentials` 标旧密码、`rate_limited` 倒计时；关联 `last_login_method`、`identity_taken`、`identity_exists`；邀请码 `invite_code_limit`。“退出其它所有设备”逐个 `DELETE`，有失败时状态行写“结束了 N 个，M 个没结束”，列表重取 |
| 授权确认 `/oauth/consent` | `GET oauth/authorization`、`POST oauth/authorization`（依赖 t08 改写） | `authorization_expired`：卡片换成“这次授权请求已过期，回到应用重新发起”；其它失败写状态行 |
| 看板 `/admin` | 六个查询接口（t11） | 每块面板自己的出错状态，在面板的固定高度里（3.5） |
| 四个列表页 | `site.admin` 与 `site.oauth-provider` 的列表与操作 | 取列表失败：数据表格的出错状态；操作失败：操作对话框的 `status`（`self_forbidden`、`not_found`、`validation_failed`）；`forbidden`：走统一处理 |

各页的 `unauthenticated`、`consent_required` 都走 3.2 的统一处理，不在页面上显示。

**页面级的加载。** 进页时要取数的页（账号页、列表页、授权确认页），取数超过 200 毫秒才在内容区中央显示加载（`aria-busy`），失败时同一位置显示原因与重试（`role=alert`），照 ui-development-spec 4.1 与 frontend.md 第 7 条。稿纸页的 `meta` 不挡页面：表单先画出来，社交图标的位置先占着。

### 3.2 接口层：`src/http/`（原写 `src/api/`，B1、B2 审查第 6 条改名）

**形状。** `createApi({fetch, onUnauthenticated, onConsentRequired})` 返回一组按接口分好的函数（`api.identity.login(body)`、`api.admin.listUsers(query)` 等）。

- 每个函数返回 `Promise<Result<T>>`：成功是 `{ok: true, value}`；失败是 `{ok: false, failure}`，`failure` 是 `{kind: "code", status, code, fields?, retryAfterSeconds?}`、`{kind: "network"}`（`fetch` reject）或 `{kind: "malformed", status}`（响应体不是 `{"error":{"code":…}}` 的形状）。
- `fetch` 由参数注入：产品里传 `globalThis.fetch.bind(globalThis)`，测试里传一个按请求返回 `Response` 的函数，不用 module-mock。
- `onUnauthenticated`、`onConsentRequired` 是回调，由应用根注入，管路由跳转（frontend.md 第 12 条“上报做成回调”）。
- 路径由合同包的前缀常量拼。类型用 `import type` 取合同包的 `Static<typeof …>`，不在浏览器里跑校验。

**按码分支，不按状态码。** `invalid_credentials` 与 `unauthenticated` 都是 401，只有后者是“会话没了”。统一处理只认 `code`：

- `unauthenticated`：清空当前账号，`router.replace("/login?next=<当前路径>")`；这次调用照常返回失败，页面不再显示它。登录页自己的登录请求不触发（它回的是 `invalid_credentials`）。
- `consent_required`：只有来自同意门槛（`site.accounts` 输出 10）的才跳 `/consent?next=…`。注册请求回的 `consent_required`（输出 3，没勾同意）由注册页自己显示：注册与社交注册的发起两个函数声明“自己处理 `consent_required`”，统一处理跳过它们。
- `forbidden`（管理接口、看板）：清掉缓存的角色，重取 `whoami` 再分派（角色可能刚被改）。

**`Retry-After`。** 读整数秒；不是整数时按 HTTP 日期解析；都不合格或没给时按 30 秒，并 `console.warn` 一条诊断（合同说一定给，没给属于服务端缺陷）。

**来源头。** 同源的 `POST`、`PATCH`、`DELETE` 请求浏览器自己带 `Origin`；页面不加别的头，不做 CSRF 令牌（Cookie 是 SameSite=Lax，服务端查来源头，`site.accounts` 输入与输出 5）。`credentials` 用缺省的 `same-origin`。Chrome 之外的浏览器对同源 `fetch` 也带 `Origin` 是从规范推断的，在真实冒烟（B10）里只验 Chrome。

**失败码的文案。** 放在站点目录的 `errors.<拥有者>.<码>`：拥有者是 `identity`（账号与管理，同一个模块）、`oauth`、`telemetry`，前端自己的是 `web`（`network`、`malformed`、`unknown`）。不认识的码显示 `errors.web.unknown`（“出了一个没认出的问题（{{code}}）”），ADR 0034 的做法。一条测试保证合同包导出的每个码在目录里都有文案（3.3）。

**给合同包的要求清单**（前端要从合同包导入的东西；名字是建议，以合同包的 Task 定的为准）。

给 t07（`nb-site-identity-contract`，账号与管理）：

1. 失败码：`IDENTITY_FAILURE_CODES`（`site.accounts` 失败表里有 HTTP 状态的全部码，加 `site.admin` 的 `forbidden`、`not_found`、`self_forbidden`）与类型 `IdentityFailureCode`；`SOCIAL_ERROR_CODES`（输出 23 能出现在 `social_error` 里的七个码）。要是运行时的常量数组，不只是类型：目录覆盖测试要遍历它。
2. 错误体 `ErrorBody`：`{error: {code, fields?: string[]}}`，`fields` 的元素是请求体的键名（S9）。
3. 字段规则常量：用户名的长度上下限与字符集、显示名、邮箱、密码、网址、签名的长度；前端拿来做输入上限与“提交按钮不可用”。从 TypeBox schema 的 `minLength` 读也行，但单独导出的常量更好读。
4. 请求与响应的 schema：`RegisterRequest`（含显示名、可选邀请码、条款版本、境外存放的同意）、`LoginRequest`（加 t08 的继续令牌，S1）、`LoginResponse`（公开资料，加继续地址，S1）、`PublicProfile`、`WhoamiResponse`（三种状态）、`MeResponse`（公开资料加邮箱、是否有密码、邮箱是否待补、是否还缺同意）、`PatchMeRequest`、`ChangePasswordRequest`、`ConsentRequest`、`SessionItem`（含“浏览器标识的概要”的确定形状，S6）、`IdentityItem`（id、上游名、上游账号的名字、关联时间）、`InviteCodeItem`（码、建立时间、已用次数、可用次数或空、过期时间或空、是否还能用）、`MetaResponse`（条款版本，S5；注册是否开放；各上游是否开放）。
5. 管理：分页查询参数与 `PageResponse<T>`（`items`、`total`、`page`、`pageSize`、`anchor`、有筛选的另带 `counts`）；每个列表的筛选项枚举（账号：全部、管理员、已封禁、邮箱待补；注册码：全部、可用、用完或过期、已停用）；`AdminUserItem`（含最近一次登录的时间）、`AdminUserDetail`、`RegistrationCodeItem` 与发放、改备注、停用的请求与响应（发放的响应里有码）、重置密码的响应（新密码）、`AdminInviteCodeItem`、`AuditItem` 与动作的枚举（页面按枚举取动作的文案）。
6. 时间一律 ISO 8601 的 UTC 字符串（合同里写明）；页面按浏览器时区显示。
7. 每个接口的相对路径常量或拼路径的函数，免得路径在前端再写一遍。

给 t08（社交登录与 OAuth 服务方；依赖 `site.oauth-provider` 改写）：

1. `SocialStartRequest`（意图 `login`、`register`、`link`；注册时带齐注册内容；关联时带当前密码；可选的继续令牌，S2）与 `SocialStartResponse`（上游地址）。
2. 登录续接：查询参数名与 `LoginRequest` 里的字段（S1）。
3. `GET oauth/authorization` 的请求怎样标识（S11）与响应（客户端名字、客户端的主机名，页面写“允许后回到 shelf.example.com”；要的范围的枚举数组），`POST` 的请求（同意或拒绝）与响应（跳回的地址）；`OAUTH_FAILURE_CODES`（`authorization_expired`、`client_not_found`、`redirect_uri_invalid` 等）。
4. `GrantItem`（id、客户端名字、范围、给出的时间；S12）。
5. OAuth 客户端的管理：列表的分页（S13）、`OAuthClientItem`、登记（响应里一次性的密钥）、改动、换密钥的请求与响应。
6. 范围的枚举（`openid`、`profile`、`email`），页面按枚举取“它会得到：你的用户名与显示名、你的邮箱”这类文案。

给 t06 与 t11（`nb-site-telemetry-contract`）：

1. `TELEMETRY_FAILURE_CODES`（`unauthenticated`、`forbidden`、`validation_failed`、`unavailable`）。
2. 六个查询接口的查询参数与响应 schema，连同输出 6 的清单版本分段、输出 8 的口径字段、输出 5 的“少于 5”合计行。
3. 维度的枚举（版本、渠道、运行形态、系统、架构、语言、大区、`noticeSeen`）。

t06 管写入口，前端不调；它的合同包现有的前缀常量不变。若 t11 在 t10 之前没开工，看板外壳只用前端自己的视图模型（3.5），不等这几项。

### 3.3 文字的组织：`src/locales/`、`src/text.ts`

- **目录**：`packages/nb-site-web/src/locales/zh-CN.json`，命名空间 `nb-site`，键按页分组（`login.*`、`register.*`、`account.*`、`admin.*`、`dashboard.*`、`errors.*`）。占位符只用最小实现支持的 `{{name}}`、`{{name, number}}` 与 `_one`、`_other`。
- **登记**：`main.ts` 顶层 `registerDefaultCatalog("nb-site", {"zh-CN": zhCN})`；根组件 `provideDefaultText(() => locale.value)`，`locale` 来自 `src/locale.ts`，第一版固定 `zh-CN`；`<html lang>` 跟着它。
- **取字**：`src/text.ts` 导出 `siteRef(key, params)` 与 `useSiteText()`，写法照 nb-ui 的 `uiRef` 与 `useUiText`。键的类型从 JSON 推出（`resolveJsonModule`），写错键在类型检查时失败。
- **数字与日期**：用 `Intl` 加当前语言，不在文案里拼。条数用 `{{total, number}}`。
- **仓库登记**：`scripts/ci/message-catalogs.ts` 的 `CATALOG_DIRECTORIES` 加 `{path: "packages/nb-site-web/src/locales", source: "zh-CN"}`。不登记的话，`packages/` 下的 `locales/*.json` 会被这个检查报成未登记。`closedCodes` 不用：它要在 CI 脚本里另抄一份码表；码的覆盖改由包内测试 `tests/catalog.test.ts` 做，遍历合同包导出的码数组，断言每个码在 `errors.<拥有者>` 下有文案。
- **加英文时**：加 `en-US.json`，登记进同一个调用，`locale.ts` 改成按用户选择或 `navigator.language` 取；组件不动。以后要 i18next，只在根上换成 i18next 的端口，组件仍不动。
- **条款与隐私政策的正文**不进目录，按语言放 `src/legal/zh-CN/privacy.md` 与 `terms.md`（3.11）。
- **与应用的异同**：相同的是 JSON 目录、nb-ui 的翻译端口、按“拥有者命名空间加码”取错误文案（ADR 0034），目录同样登记进 `message-catalogs` 检查。不同的是不用 i18next：应用要跟随用户设置切语言并给插件开目录，官方站第一版只有一种语言。不用 i18next 的先例是 dev-panel：它里面的 nb-ui 组件走缺省端口加最小实现，但它自己的文字直接写在模板里、没有目录（`src/web/host/layout-text.ts` 只给 nb-layout 注入中文）；官方站比它多一个自己的目录，因为以后要加英文。

### 3.4 nb-ui 的两个通用组件：`packages/nb-ui/src/components/`

两个都是受控组件：页码、总条数、行数据、加载与出错都由使用方给，组件只发事件。理由：页码要进 URL（管理面板刷新、后退要回到同一页），取数与 `anchor` 由使用方管（`site.admin` 输出 9），组件自带页码状态会有两份真相（frontend.md“草稿归宿主”）。

#### `Pagination`（`navigation/Pagination.vue`、`.md`、`.test.ts`）

```ts
defineProps<{
    /** 当前页，从 1 起；用 v-model 绑定 */
    modelValue: number;
    /** 总页数，至少 1；使用方按 ceil(total / pageSize) 算，没有数据时给 1 */
    pageCount: number;
    /** 整条不可用（例如首次加载还没有总数）；默认 false */
    disabled?: boolean;
    /** 上一页、下一页按钮与整条导航的读屏名字；缺省取 nb-ui 目录 */
    prevLabel?: string;
    nextLabel?: string;
    navLabel?: string;
}>();
defineEmits<{"update:modelValue": [page: number]}>();
```

- **格子**：照草稿的算法。页数不超过 7 时列出全部页码；多于 7 时总是 7 格：当前页不超过 4 时 `[1,2,3,4,5,…,末页]`，不小于末页减 3 时 `[1,…,末页-4,…,末页]`，其余 `[1,…,当前-1,当前,当前+1,…,末页]`。两侧各一个上一页、下一页的 `IconButton`（`i-lucide-chevron-left`、`i-lucide-chevron-right`）。
- **宽度不变**：每格至少 32px、`tabular-nums`，多于 7 页时翻页不改变整条宽度与两个箭头的位置。页码到四位数时格子按内容变宽，`.md` 里写明。
- **越界**：`modelValue` 不在 `[1, pageCount]` 里时（例如数据变少了），按夹到边界的值显示、箭头随之不可用，不自动发事件改值；改不改由使用方定。
- **事件**：只在点了与当前不同的页码或可用的箭头时发 `update:modelValue`。
- **键盘与读屏**：页码与箭头都是原生按钮，Tab 依次可达，Enter、Space 触发；当前页带 `aria-current="page"`，仍可聚焦；省略号 `aria-hidden`、不可聚焦；根是 `<nav aria-label>`。页码按钮的读屏名字是“第 N 页”。
- **焦点**：点了页码后，那个按钮可能变成省略号或换了数字。翻页后焦点所在的元素被移走时，把焦点移到新的当前页按钮上，不让焦点掉回 `body`。
- **动效**：当前页的底色变化用时长令牌过渡，不用 `transition-all`；`prefers-reduced-motion` 时去掉。
- **390 宽**：两个箭头加 7 格，约 9 × 32px 加间距，不到 320px，放得下。
- **文字**：nb-ui 目录加 `pagination.prev`（上一页）、`pagination.next`（下一页）、`pagination.nav`（分页）、`pagination.page`（第 {{page}} 页），`zh-CN.ts` 与 `en-US.ts` 两份都加。
- **`.md` 的标签**：`[state:inject]`（用 `useUiText`）。

#### `Table` 的一处改动（`display/Table.vue`、`.md`）

数据表格要表头吸顶。`Table` 的根是 `w-full overflow-x-auto`，一个方向设了 `overflow` 另一个方向也算滚动容器，所以表头的 `position: sticky` 只能贴在 `Table` 的根上；外面再包一层竖向滚动，表头不会吸顶（草稿 `SiteDataTableDraft` 就是外层 `overflow-y: auto`）。

改法：加 `stickyHeader?: boolean`（默认 false）。为真时根改成两个方向都 `overflow: auto`、`height: 100%`、`min-height: 0`，由 `Table` 自己承担竖向滚动；表头单元格 `position: sticky; top: 0`，底色取 `--bg-panel`，下边一条 `--border-color` 线。默认值不变，现有用法不受影响。`.md` 的“布局与状态”加一段；补 `Table.test.ts`（现在没有）覆盖这个属性的结构。

`Table` 的加载与空占位本来就画在表体里（`<tbody>` 里一个跨全部列的单元格），表头一直在。`DataTable` 自己画加载与出错，不用 `Table` 的 `loading`：它在加载时整块换成转圈，翻页时旧行会消失，不符合下面“翻页时旧行留着”的要求。

#### `DataTable`（`display/DataTable.vue`、`.md`、`.test.ts`，泛型 `Row`）

```ts
defineProps<{
    columns: TableColumn<Row>[];   // 与 Table 同一个列类型，components/index.ts 已导出
    rows: Row[];
    rowKey?: keyof Row & string;
    /** 符合当前筛选与搜索的总条数；还不知道时给 null */
    total: number | null;
    pageSize: number;
    /** 有请求在飞；组件等 200ms 后才显示加载 */
    loading?: boolean;
    /** 非空时表格区显示这条原因与重试按钮 */
    error?: string;
    emptyText?: string;
    retryLabel?: string;
    density?: "default" | "compact";   // 透传 Table，默认 compact
}>();
const page = defineModel<number>("page", {required: true});
defineEmits<{retry: []; "row-click": [row: Row, index: number]}>();
// 插槽：filters、actions、cell-<key>（透传 Table）、empty、count（{from, to, total}）
```

- **三块**：根是 `flex` 竖排、`height: 100%`。上面工具条 48px（左 `filters`，右 `actions`），中间表格区 `flex: 1; min-height: 0`，里面是 `<Table sticky-header>`，下面页脚 48px（左条数，右 `Pagination`）。要放进有确定高度的容器，`.md` 里写明；管理面板的页面内容区给它定高。
- **状态都只换表格区里面的内容，工具条与页脚的元素与位置不变**：
  - 首次加载（`rows` 为空、`loading` 为真）：表头在，表体中央 200ms 后出现 `Spinner`；页脚的条数写占位（“—”），分页条 `disabled`，页数按 1。
  - 翻页或换筛选时加载（`rows` 非空、`loading` 为真）：旧行留着，表格区加 `aria-busy`，200ms 后盖一层半透明遮罩（时长令牌淡入）；分页条已经显示新页码（受控），仍可点，取数的先后由使用方处理（后到的旧请求丢掉）。
  - 空（`total` 为 0）：表体中央显示 `empty` 插槽或 `EmptyState`；页脚“共 0 条”，分页条 1 页、不可用。
  - 出错（`error` 非空）：表体中央显示原因与“重试”按钮，`role=alert`，点重试发 `retry`；页脚保留上一次的条数与页码。
  - 最后一页不满：表格区照样占满剩下的高度，页脚在底部。
- **条数**：缺省文案“第 {{from}} 到 {{to}} 条，共 {{total, number}} 条”；草稿里用“个”的页用 `count` 插槽换量词。
- **加载的 200ms 延时**由组件自己做（frontend.md 第 7 条），所以有 `state:local`。
- **键盘**：组件不加自己的按键；Tab 顺序是工具条、表格里的可聚焦元素（各页行尾的“…”按钮）、分页条。行点击透传 `Table` 的 `row-click`；只靠点行才能做的事，使用方要另给按钮。
- **390 宽**：工具条 `flex-wrap`，放不下时换成两行（高度随宽度变，不随状态变）；表格在 `Table` 根里横向滚动；页脚用容器查询，窄于 480px 时条数只写“共 N 条”。管理面板只做桌面宽，这条交代给别的使用方。
- **文字**：nb-ui 目录加 `dataTable.count`、`dataTable.countUnknown`、`dataTable.retry`，中英两份。
- **`.md` 的标签**：`[state:inject, state:local]`。

#### 配套与测试

照 `SidePanel` 那次提交（b68ff259e）的配套：同名 `.md`、`.vue`、`.test.ts`；`components/index.ts` 导出；nb-ui `README.md` 的组件表加两行；Lab 夹具在 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/display.ts`（`Table`、`Breadcrumb` 都在这份里），用 `defineSubjectFixture`，夹具定宽写 `min(<宽>, 100%)`。

- **Lab 场景**：`Pagination`：5 页、100 页的第 1、50、100 页、只有 1 页、整条不可用。`DataTable`：正常一页、最后一页 6 行、空、首次加载、翻页加载、出错；状态切换放进 `LabFixtureControls`，舞台只画组件。
- **dom 测试**（Vitest、`@vue/test-utils`、happy-dom）：
  - `Pagination`：多于 7 页时第 1、4、5、末页减 4、末页减 3、末页各种情况都恰好 7 格且内容对；点页码与箭头发出的值；两端箭头不可用；`aria-current`；省略号不可聚焦；焦点被移走时落到当前页。
  - `DataTable`：切换五种状态时，工具条与页脚是同一个 DOM 元素（引用相等）、内容不变，只有表格区的内容变；`loading` 刚变真时没有加载指示，用 `vi.waitFor` 等到它出现（等可观察的状态，不按固定时长睡）；出错时点重试发 `retry`；`total` 为 null 时分页条不可用。
  - `Table`：`stickyHeader` 为真时根与表头带吸顶的结构，默认时与现在相同。
  - happy-dom 不算布局，吸顶与“页脚在底部”的几何由 Lab 的浏览器测试量：在 `packages/neuro-book/e2e/lab-nb-ui.e2e.ts` 加一条，滚动表格区后表头的上边不变、最后一页时页脚的下边等于组件的下边；改了 Lab 场景要跑 `lab-scenes`。
- **验收档**：nb-ui 共享基础组件一档，主题轴乘配色轴四组合（nbook、macos 乘 light、dark）加 390px 视口，每项给计算样式与几何的实测（`docs/testing/README.md` 的“UI 验收分档”）。

### 3.5 图表：`src/pages/admin/dashboard/`

**按需引入的清单**（`charts/echarts.ts`，全站只有这一个文件导入 `echarts`）：

```ts
import * as echarts from "echarts/core";
import {LineChart} from "echarts/charts";
import {GridComponent, TooltipComponent} from "echarts/components";
import {CanvasRenderer} from "echarts/renderers";
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
```

两张图都是折线：活跃是三条线、带线尾名字（`endLabel`）与按坐标轴的提示框；在线是 `step: "end"` 的阶梯线加淡面积。版本、系统、留存、错误、崩溃、升级都是 HTML，不进 ECharts（照草稿）。图例不用 `LegendComponent`：线尾名字已经标明每条线。

**体积**（2026-11-24 实测，`/tmp/w00037-t10-plan/lab/`，ECharts 6.1.0，`bun build --minify --target browser`，单位字节）：

| 变体 | 压缩后 | gzip | brotli |
|---|---|---|---|
| a：上面的清单 | 525,088 | 177,590 | 150,795 |
| b：a 把 `CanvasRenderer` 换成 `SVGRenderer` | 532,671 | 181,223 | 154,009 |
| c：a 加 `AriaComponent` 与 `LabelLayout` | 540,449 | 183,469 | 155,584 |
| d：整包 `echarts` | 1,172,053 | 390,419 | 317,568 |

用 a。b 没有好处：SVG 渲染器大 3.6 KB（gzip），这两张图的点数用 canvas 足够。c 的 `AriaComponent` 自动生成的读屏描述是英文模板，不如自己写 `aria-label`。Vite 8（rolldown）的结果会与 `bun build` 略有出入，构建测试记下实际数（下面）。

**拆包**：看板页由路由按需加载（`() => import("./pages/admin/DashboardPage.vue")`），`charts/echarts.ts` 只被看板页导入。所以只有打开看板的管理员下载这约 178 KB；普通用户与访客的入口包里没有它。四个列表页与看板共用管理面板外壳，外壳单独一个块。入口包（Vue、路由、用到的 nb-ui 组件、站点代码）的大小没量，B1 的构建测试记下来。

**颜色与字体**：

- 站点样式 `src/styles/site.css` 定义图表色变量，亮暗两套，挂在 `[data-nb-appearance="light"]`、`[data-nb-appearance="dark"]` 下：`--site-viz-1` 到 `--site-viz-3`（亮 `#2a78d6`、`#eb6834`、`#1baf7a`，暗 `#3987e5`、`#d95926`、`#199e70`，t09 第 14 条）、`--site-seq-1` 到 `--site-seq-5`（`#f0a09c`、`#e67570`、`#d64a45`、`#b3302c`、`#861f1d`，t09 第 15 条；暗色先用同一组，在浏览器里对着暗色面板底色验过再定）。崩溃、升级失败、升级成功用 nb-ui 的 `--status-danger`、`--status-success`。
- `charts/theme.ts` 的 `readChartTheme(el)` 用 `getComputedStyle` 读 `--text-main`、`--text-muted`、`--border-color`、`--bg-panel`、三格序列色与正文字体族，得到一个普通对象。
- 生成配置的是纯函数 `buildActiveOption(viewModel, theme)`、`buildOnlineOption(viewModel, theme)`，颜色、字体都从 `theme` 来。
- **换明暗时重画**：站点的主题模块（`src/host/theme.ts`，照 dev-panel 的 `host/theme.ts`）导出当前明暗的 `ref`；图表组件 `watch` 它，在下一帧重读 `readChartTheme` 并 `setOption`。等一帧是为了让 `data-nb-appearance` 换完、计算样式更新后再读。
- 图表容器带 `data-chart-appearance`，每次按新颜色画完后更新。这是浏览器测试能观察到的“已按某种明暗画过”的信号，也是 `nbdev shot` 一类截图工具可以等的东西（t09 记了“图表异步挂载，截图会截到空白”）。

**容器尺寸**：`ResizeObserver` 看图表容器，变化时在 `requestAnimationFrame` 里调 `chart.resize()`，同一帧里多次变化只调一次。卸载时 `dispose()`、断开观察器。

**减弱动效**：`matchMedia("(prefers-reduced-motion: reduce)")` 为真时配置里 `animation: false`，并监听它的变化。

**没有数据与加载中**：每块面板的高度固定（图表区 230px，照草稿的 `.sdd-chart`），状态只换面板里的内容：

- 加载：200ms 后在面板中央显示 `Spinner`。换时间范围时旧图留着，加一层淡遮罩（与数据表格同一种做法）。
- 没有数据（所选范围里一天都没有，`site.telemetry-dashboard` 输出 7）：不建图表，面板中央 `EmptyState`“这段时间没有上报”。
- 部分日子没有数据：那几天在序列里是空值，线断开（`connectNulls: false`），不画成 0；有上报而为 0 的画 0。这是输出 7 在图上的样子，由视图模型保证。
- 出错：面板中央显示原因与重试（`role=alert`）。

**读屏**：图表容器 `role="img"`，`aria-label` 写“近 28 天的日活跃、7 日活跃与 28 日活跃”这样的概括，提示框里的数字不靠读屏取得；表格化的数字在下面的 HTML 面板里本来就有。

**测试**：

- `bun test`：视图模型与配置生成函数。三条线的名字与颜色来自主题；缺天是空值、零是 0；提示框的格式化函数对某一天输出那一天的三个数；暗色主题换了颜色。
- 浏览器测试（3.10 的假接口场景）：看板打开后 canvas 存在且宽高非零；鼠标移到图上时提示框出现、文字是那一天的数（ECharts 的提示框是 HTML，读得到文字）；`emulateMedia({colorScheme: "dark"})` 后容器的 `data-chart-appearance` 变成 `dark`，提示框的计算颜色变了；容器宽度变化后 canvas 的宽度跟着变；减弱动效下首次画出不需要等动画。
- 构建测试：看板块里有 `echarts` 的代码，入口块与其它页的块里没有；记下看板块的 gzip 大小，超过 200 KB 时失败（留一点余量，防止有人整包导入）。
- canvas 里画了什么不断言。

**与 t11 的分界**（第 9 节 D8）：

- t10 做：看板页的版式与外壳、时间范围控件、每块面板的视图模型类型与组件、图表模块、加载、空、出错三种状态、用假数据的浏览器场景。
- t11 做：查询接口与合同里的 schema、把接口响应转成视图模型的适配器（含“较昨日”从 `series/active` 最后两天算、“当前在线”取 `series/online` 最后一段、清单版本分段怎样显示）、把页面接到真实数据。
- 视图模型是两边的接口：t10 先定类型与假数据；t11 开工时可以改它，改动由 t11 负责连同页面一起改。

### 3.6 稿纸：`src/components/PaperSheet.vue`

站点自己的组件，不进 nb-ui（只有官方站用）。登录、注册、同意条款、授权确认四页都用它，卡片的内容由插槽给。

**格子怎样画。** 沿用草稿的做法：一个元素用 `mask-image` 加 data URI 的 SVG 画出一个周期（40 × 52 像素，一格方格加行间空白），`background-color` 取格线色变量。可取的理由：一个元素、没有图片请求；格线颜色由变量给（遮罩只管形状），换明暗只换变量；比 `repeating-linear-gradient` 好写格子之间的行距。代价是内容安全策略的 `img-src` 要许 `data:`（CSS 的 `mask-image` 归 `img-src` 管），3.8 的策略里已经有。

**要换掉的三处**（草稿里的问题）：

1. 格线色写死 `color-mix(in srgb, #3f9468 42%, transparent)`、印章色写死 `#c0392b`：改成站点变量 `--site-paper-line`、`--site-paper-seal`，亮色用草稿的值，暗色的值在浏览器里对着暗色底色定（交前端审查看），纸的底色用 nb-ui 的 `--bg-app`。
2. 根元素 `overflow: hidden`：卡片比视口高时（矮屏、手机横屏、放大字号）下面会被裁掉。改成页面能竖向滚动，横向用 `overflow-x: clip`，保证 390 宽没有页面级横向溢出（ui-development-spec 3.7）。
3. 窄屏靠 `narrow` 属性切换：改成媒体查询（`max-width: 480px`）。

**卡片与格子对齐。** 草稿把卡片固定在第 5 行第 4 列、整页垂直居中。改成：格子画在卡片的一个伪元素上，伪元素向四周伸出很远，遮罩的原点对齐卡片的左上角。这样卡片怎么居中、页面怎么滚动，卡片的边都落在格线上，不用脚本算位置。

**手机版式**（≤ 480px）：卡片宽 9 格（360px），格子原点按草稿右移 15px，在 390 宽上左右各留 15px，正好 9 格。比 390 更窄时卡片宽度 `min(360px, 100vw - 30px)`，格线与卡片边不再对齐，这是已知限制。产品名与说明一格一字写在格子里，字号按格子定。

**明暗**：全部颜色来自 nb-ui 主题变量与两个站点变量，跟着 `data-nb-appearance` 变；印章里的字暂写 NB（t09 第 6 条）。

**状态不推动内容**：卡片里的状态行（3.1）一直占位置；注册关闭、授权过期这类整卡片状态只换卡片里的内容，卡片宽度不变。

### 3.7 GitHub 与 Google 的标志：`src/assets/brands/`

应用的图标类只生成 lucide 一套（t09 README 末尾），官方站自己带两枚 SVG。依据的页面与要求（2026-11-24 读过）：

- **Google**：`https://developers.google.com/identity/branding-guidelines`。只放“G”的按钮是允许的，但要有按钮的边界、表明是登录的动作；“G”必须用标准的全彩版，不许单色、不许改色；按钮底色只能是亮色 `#FFFFFF` 配 1px `#747775` 描边、暗色 `#131314` 配 1px `#8E918F` 描边，或中性 `#F2F2F2` 不描边；文案用“用 Google 登录”一类，不能只写“Google”。素材在 `https://developers.google.com/static/identity/images/signin-assets.zip`。
- **GitHub**：`https://brand.github.com/foundations/logo`。Invertocat 只用白、黑两色（少数场合灰或绿）；不许改色、变形、加阴影；允许用来表明“与 GitHub 集成”；文件在 `https://brand.github.com/GitHub_Logos.zip`。
- **没核实**：GitHub 的页面没写“用 GitHub 登录”按钮的画法与最小尺寸；Google 的“表明动作”对只有图标、靠悬停提示与读屏名字的按钮算不算满足，页面没有明说。

**与定稿的冲突**：草稿里两枚图标都用 `currentColor`、放在 nb-ui `IconButton` 的 secondary 底色上；草稿的“G”是单色的简化轮廓，不是 Google 素材包里的四色“G”。Google 的单色“G”与非规定的底色违反它的规范；GitHub 的标志跟着文字色走，在亮色主题里是深棕而不是黑。列在第 9 节 D3。

**实现**（按 D3 的推荐）：从两个官方压缩包取 SVG 原样放进 `src/assets/brands/google-g.svg`、`github-mark.svg`，旁边一个 `README.md` 记来源地址、取的日期、对应的规范页面。Google 按钮按亮暗主题用规定的两种底色与描边；GitHub 的标志亮色用黑、暗色用白。两枚按钮的读屏名字与悬停提示是“用 GitHub 登录”“用 Google 登录”（注册页是“用 … 注册”），按钮上方保留草稿里表单与图标之间那行“或”。上游没开放（`meta`）时按钮不可用并带提示，位置不变；两个都没开放时“或”与图标整行不画（这是部署配置决定的，不是页面上会来回变的状态）。

### 3.8 由谁发静态文件：`packages/nb-site-server/src/web.ts`、`image/`

**推荐由 `nb-site-server` 发**（提案 4.3 已写“由这个进程发静态文件”）。交给反向代理的话，部署要多一份前端产物与一套路由规则，单页回退与缓存头要在代理里各写一遍，与提案的“一个镜像”不符。

- **配置**：加可选变量 `NB_SITE_WEB_DIR`（绝对路径；设了必须是存在的目录且里面有 `index.html`，不合格时 `config_invalid`，问题词沿用数据目录那几个）。不设时不发静态文件，未知地址照旧 404，合同测试与只跑接口的部署不受影响。镜像里设成 `/app/web`。
- **路由顺序**：健康检查、测试控制入口、各模块的路由（`/api/…`、`/oauth2/…`、`/.well-known/…`、上游回调）先匹配；都没匹配上的 `GET`、`HEAD` 才到静态文件。主机名是遥测写入口地址的请求不到这里。
- **文件**：路径落在 `NB_SITE_WEB_DIR` 里的文件就发，`Content-Type` 按扩展名。用 Hono 的 `serveStatic`（`hono/bun`），它对 `..` 与编码过的 `%2e%2e` 的处理在 B8 用测试钉住（版本行为没核实）。
- **缓存**：`/assets/*`（Vite 的产物带内容哈希）`Cache-Control: public, max-age=31536000, immutable`；`index.html` 与不带哈希的文件 `no-cache`。
- **单页回退**：路径不落在任何模块的挂载前缀下、不在 `/health/`、`/test-control/` 下、最后一段不带扩展名的 `GET`、`HEAD`，回 `index.html`（200，`no-cache`）；带扩展名而文件不存在的回 404。这样 `site.oauth-provider` 输出 1（身份库的其它地址一律 404）与测试控制入口“没设口令时与别的不存在的地址一样回 404”都不受影响。前端自己的“没有这一页”只对回退进来的路径显示。
- **响应头**（发 HTML 时）：
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`
  - `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`
  - `style-src` 要 `'unsafe-inline'`：nb-ui 的 `installTheme` 插一个内联 `<style>`，ECharts 的提示框带 `style` 属性。`script-src` 只许 `'self'`：Vite 的产物没有内联脚本（B1 的构建测试断言 `index.html` 里没有内联 `<script>`）。`img-src data:` 给稿纸的遮罩与 SVG。`font-src 'self'`：nbook 主题的 Fraunces 字体随 nb-ui 打进产物。`frame-ancestors 'none'` 防授权确认页被嵌进别人的页面点击劫持。
  - `form-action 'self'`：页面没有原生表单提交到别处；授权确认之后的跳转用 `location.assign`，不受它限制（推断，B10 的真实冒烟里验）。
  - HSTS 由终结 TLS 的反向代理加，这个进程只说 HTTP。
- **日志**：静态文件的请求同样一行 `http.request`，`module` 记 `web`。
- **镜像**：`image/build.ts` 先跑 `nb-site-web` 的构建，把它的 `dist/` 拷进 `dist/image/web/`（t05 计划 3.11 第 2 步已预留）；`Dockerfile` 加 `COPY web ./web` 与 `ENV NB_SITE_WEB_DIR=/app/web`。CI 的镜像任务不用改，构建脚本里已经包含了前端的构建。
- **依赖白名单**：`nb-site-server` 的源码不导入前端包。构建脚本要找到前端的产物，推荐把 `@notnotype/nb-site-web` 加进 `nb-site-server` 的 `devDependencies`（`workspace:*`），构建脚本用 `import.meta.resolve("@notnotype/nb-site-web/package.json")` 定位，不写相对路径。`architecture.test.ts` 的 `ALLOWED` 照 t05 注释里预留的放开：只许出现在 `devDependencies`，`src/` 里导入它仍然失败（加一条变异）。
- **Spec**：`site.operations` 要加配置一行、静态文件一条输出与边界里的公开接口（第 4 节 S15）。
- **本地开发**：`vite dev` 把 `/api`、`/oauth2`、`/.well-known` 代理到本机的 `nb-site-server`。服务端要求来源头等于 `NB_SITE_URL`（必须是 https），所以代理要把 `Origin` 改写成 `NB_SITE_URL`，只在开发配置里。Cookie 带 `Secure`，`http://localhost` 上浏览器收不收，没核实；平时开发主要用假接口（3.10），对着真实服务的开发流程在 B10 里一并定。

### 3.9 浏览器端的存储：`src/host/storage.ts`

按 frontend.md“客户端持久化与存储分层”先定归属：官方站没有 Config 与本地 Storage 服务，账号与同意记录是服务端的领域数据，页面状态都是内存。只有一样东西要跨过整页跳转：社交注册跳去上游之前表单里填的内容。按上游回来时 `social_error` 带回的码（`social_email_missing`、`email_taken`、`social_state_invalid`），表单要还在，否则用户要重填。

- **介质**：`sessionStorage`（只在这个标签页里、关掉就没），不用 `localStorage`。
- **一个模块统一读写**：`src/host/storage.ts` 是唯一碰 `sessionStorage` 的地方，键带前缀 `nb-site.`，读写包 `try/catch`（隐私模式、配额满时只是不暂存，并 `console.warn`），照 dev-panel 的 `host/prefs.ts`。
- **存什么**：键 `nb-site.social-register-draft`，值 `{v: 1, savedAt, provider, username, displayName, inviteCode, registrationCode, consent: {termsVersion, overseas}}`。
- **什么时候写**：社交注册的发起请求成功、拿到上游地址之后，`location.assign` 之前。
- **什么时候读与清**：
  - 回到 `/register` 且带 `social_error` 时读出来还原表单，读完就删。
  - 超过 10 分钟（与上游跳转地址的有效期相同，`site.accounts` 的“时序与寿命”）的当没有并删掉。
  - 注册成功（落到 `/`）、登出、不带 `social_error` 进 `/register` 时删掉。
- **不存的**：密码（社交注册本来就不设密码；密码注册不跳出站点，不用暂存）、关联上游时输入的当前密码。
- **注册码**：推荐存（第 9 节 D5）。它是有次数的准入凭据，存在 `sessionStorage` 里的风险是同一个标签页里的脚本能读到；内容安全策略只许自家脚本，并且读一次就删、10 分钟过期。不存的话，`email_taken` 这类失败回来后用户要再找一次注册码。
- **其余都在内存**：当前账号（登出、`unauthenticated` 时清空）；列表页的页码、筛选、搜索在 URL 查询串里；看板的时间范围在 URL 查询串里。明暗跟随系统，没有要记的偏好。

### 3.10 测试与验收：`packages/nb-site-web/tests/`、`e2e/`

**分层**：

| 层 | 工具 | 覆盖 |
|---|---|---|
| 纯逻辑 | `bun test`（`tests/*.test.ts`） | 分派与 `next` 的校验；接口层的结果形状、按码的统一处理、`Retry-After` 的解析、`malformed`；存储模块的读写、过期与读后即删；分页格子算法（站点里不再写一份，测 nb-ui 的）；列表页的查询状态与 URL 的互转、`anchor` 的保留与重置；看板的视图模型与图表配置；目录覆盖（每个合同码有文案） |
| 组件 | Vitest 加 happy-dom（`src/**/*.dom.test.ts`） | 各页的表单：提交按钮何时可用、失败码落在哪个字段与状态行、焦点、`rate_limited` 倒计时；`social_error` 的显示与从地址里去掉；注册草稿的还原；账号页各节的操作与失败；列表页的操作对话框（重置密码的新密码只显示一次、`self_forbidden`、`last_admin`）。接口用注入的 `fetch`，返回值用合同 schema 的类型写，写错形状类型检查就失败 |
| 构建 | `bun test`（`tests/build.test.ts`，t05 第 6 片已有一条） | 加三条断言：`index.html` 里没有内联脚本；`echarts` 只在看板块里；记下入口块与看板块的 gzip 大小，看板块超过 200 KB 失败 |
| 浏览器、假接口 | Playwright（`e2e/*.e2e.ts`） | 对着构建产物，`page.route("**/api/**")` 返回合同形状的数据，跑各页在 1440 与 390 宽、亮暗两种配色下的样子与交互：稿纸卡片与格线对齐、没有页面级横向溢出、状态行出错前后其它元素的位置不变、数据表格最后一页页脚在底部、看板的提示框与换配色后重画 |
| 浏览器、真实服务 | Playwright（`e2e/real/*.e2e.ts`） | 起真实的 `nb-site-server`（带 `NB_SITE_WEB_DIR`），走注册、登出、登录、改资料、补交同意（拨条款版本）；管理员登录后到看板、封禁一个账号后它的会话失效 |

**假接口的数据**放在 `e2e/fixtures/*.ts`，每份用 `satisfies Static<typeof 合同Schema>` 写，另有一条 `bun test` 用 TypeBox 的 `Value.Check` 把每份过一遍合同的 schema。这是“替身与真实实现对过契约”的做法：形状由合同保证，行为由真实冒烟保证。

**真实冒烟的做法与代价**：

- 服务端要求 `NB_SITE_URL` 是 https、Cookie 带 `Secure`、来源头等于站点地址，而进程只在本机回环上说 HTTP。
- 做法一（先试）：浏览器访问 `https://site.test/`，`context.route("https://site.test/**")` 里用 `route.fetch({url: <换成 http://127.0.0.1:端口>})` 转给真实进程，再 `route.fulfill` 回去。请求头（含 `Origin`）原样带过去，主机名不是遥测写入口的，按“其余的到站点的接口”路由。没核实：`route.fulfill` 回去的 `Set-Cookie` 浏览器会不会存。
- 做法二（做法一不行时）：测试里用 `Bun.serve` 起一个带自签证书的 TLS 转发，Chrome 加 `--host-resolver-rules="MAP site.test 127.0.0.1:<端口>"` 与 `ignoreHTTPSErrors`。更接近生产（真的 TLS、真的反向代理），多一段证书生成。
- 代价：`nb-site-web` 的开发依赖加 `@playwright/test`，多一个 e2e 套件；一次冒烟要构建前端与起一个进程，约等于合同测试里起进程的那几条；不进 `test:affected`，用包脚本 `test:e2e` 显式跑。
- 起进程的工具（临时数据目录、配置、创建管理员）合同测试包里已经有；冒烟只依赖它导出的辅助函数，前提是合同测试包把它们作为公开入口导出，并且白名单许 `nb-site-web` 以 `devDependencies` 依赖合同测试包（ADR 0059 只限制前端的运行时依赖，这一条在 B10 前确认）。
- 推荐做（第 9 节 D12），放在后端 t07、t08 做完之后的 B10。只有它能证明来源头、`Secure` Cookie、单页回退、内容安全策略在真实浏览器里一起成立。

**验收档**：

- 页面：“主题变量或窄屏布局”一档。稿纸页与公开页加 390px；站点新增的变量（格线、印章、图表色）要亮暗两种配色的实测（计算样式对着变量的解析值）。官方站只用 nbook 主题，不做主题轴。
- 两个 nb-ui 组件：“nb-ui 共享基础组件”一档（3.4）。
- 有过渡的切换（数据表格的遮罩、状态行、账号页的保存状态）按“UI 验收分档”的要求，在开发构建的真实页面上点一遍、不减弱动效。`nbdev` 不管官方站：实现时用 `run_in_background` 起 `vite dev`（假接口模式，3.8），用完停掉，汇报里写明。
- t09 记的“暗色下的序列色与红色色阶在 Lab 里验”：官方站的页面不进应用的 Lab（应用包不该依赖官方站），改在上面的假接口浏览器场景里验，量对比度并截图交前端审查。这是执行地点的调整，不改结论的要求。

**前端审查（Sonnet）排在**：A2 之后（两个组件一起审）、B2 之后（稿纸与表单的模式，后面几页照它）、B4 之后（账号页）、B5 之后（看板与图表）、B7 之后（授权确认），以及收口。B8 动的是服务端的安全边界（内容安全策略、路径穿越、单页回退与 `site.oauth-provider` 输出 1 的关系），按全局规则走快速审查：Opus 先审，omp `@review` 在后台审同一份说明。

### 3.11 公开页与“没有这一页”：`src/pages/legal/`、`src/pages/NotFound.vue`

- `/privacy`、`/terms`：外观还没定（等条款文字，t09“下一步”第 3 条）。B9 做一个简单的阅读版式（nb-ui 排版，正文宽 680px，顶部站名回首页），正文是 `src/legal/zh-CN/*.md` 在构建时转成 HTML（用 nb-markdown 还是 Vite 插件，B9 开工时按包边界定；`nb-site-web` 的依赖白名单只许 nb-ui，加 Markdown 依赖要放开白名单）。
- 正文与同意页的关系：同意页链接这两页、显示 `meta` 给的条款版本；正文文件的头部写版本号。构建测试断言两份正文的版本号相同，冒烟断言它等于服务端配置的条款版本（S5）。
- 文字没来之前：两页只在开发构建里显示占位，生产构建里如果正文是占位就让构建失败，免得占位页上线（Google 审核要这两页，第 9 节 D6）。
- 找不到的页：普通版式，一句“没有这一页”加回首页的链接。

### 3.12 账号页：`src/pages/account/`

- 五节（照草稿）：资料、登录与安全（邮箱、密码、已关联的账号）、已登录的设备、邀请码、已授权的应用（依赖 t08 改写）。左边目录随滚动高亮当前节；手机宽时目录变成顶部一排标签（t09 的 `account-phone` 图）。
- 没有邮箱时只在邮箱格里多一枚“待补”、目录“资料”后多一个点（t09 第 11 条）；“待补”与那个点的位置一直留着，有邮箱时是空的。
- 每节自己保存，保存按钮与状态行在节的底部一行；保存成功后状态行写“已保存”，3 秒后清空（淡出用时长令牌）。
- 密码一行显示“已设置”或“没有设置”（t09 照 Spec 改图）；没有密码时按钮是“设置密码”，不要旧密码。
- 关联上游：点“关联”先弹对话框要当前密码（没有密码的账号免，`site.accounts` 输出 15），再发起社交流程跳走；回来按 `social_error` 显示（3.1）。解绑回 `last_login_method` 时状态行写“先设一个密码再解绑”。
- 已登录的设备：列出建立时间、最后使用、浏览器概要（S6）、“当前”标记；每行“结束”；“退出其它所有设备”逐个 `DELETE` 当前之外的会话（t09 照 Spec 改图），串行发，全部完成后重取列表。
- 邀请码：生成（到 10 个有效的码时按钮不可用并写原因，再点到服务端回 `invite_code_limit` 也写状态行）、复制、停用（D10）。
- 头像与网站、签名：`PATCH me` 收这几个字段，图上没有头像（D10）。

### 3.13 管理面板：`src/pages/admin/`

- 外壳：左栏 216px 导航（看板、用户、注册码与邀请码、OAuth 客户端、审计），左下角当前用户菜单（账号页、退出），照草稿 `SiteAdminShellDraft`。内容区有确定高度，数据表格占满它。
- 列表页的状态放 URL：`?page=3&filter=banned&q=foo`；刷新、后退回到同一页。`anchor` 放内存：同一次翻页过程里沿用（`site.admin` 输出 9），换筛选、换搜索、刷新时丢掉重来；页码超过最后一页（输出 10：`items` 为空而 `total` 不为 0）时改到最后一页再取一次。
- 搜索输入停 300ms 后才取，换筛选与换搜索都回到第 1 页；后发的请求返回后，先发的旧请求结果丢掉。
- 筛选项的条数取响应里的 `counts`，显示在 `SegmentedControl` 的选项上（草稿的画法）。
- 行尾“…”是 `DropdownMenu`：用户页有重置密码、封禁或解封、设为或取消管理员、结束全部会话；每项先 `AlertDialog` 确认，失败写对话框的 `status`。重置密码成功后对话框里显示新密码与复制按钮，关掉后不能再看（`site.admin` 输出 4）。
- 注册码与邀请码页：顶部 `Tabs` 切两种码（草稿），两种码的总数在页签上，进页时两个列表各取第一页。注册码页右上“发放注册码”，对话框填次数、过期时间、备注，成功后显示码。
- OAuth 客户端页（依赖 t08 改写）：登记、改动、停用、换密钥；密钥只在登记与换密钥的响应里显示一次。
- 审计页：按操作者、对象、动作筛（三个筛选控件放工具条左边），动作的文案按合同的动作枚举取。
- 用户详情（`GET users/:id`）没有图（D11）。

## 4. Spec 与文档改动

页面要用而合同没写清的地方。每条给原文位置、建议改法、归谁改、不改会卡住哪一片。计划里没有替它们定结论，用到的地方都标了这里的编号。

| 编号 | 原文位置 | 现在的样子 | 建议改成 | 归谁 | 卡住 |
|---|---|---|---|---|---|
| S1 | `site.accounts` 输入的接口表 `POST login`；输出 4、输出 23 末句；`site.oauth-provider` 输出 4 | 输出 23 说从授权请求带到登录页的人登录后回那次授权请求，但登录请求里没有任何东西指明是哪一次（提案 4.5 写了“登录接口收一个不透明的继续令牌并原样交回”，Spec 没写） | 输出 4 加：登录页的地址带查询参数 `continue=<不透明令牌>`，登录请求可带同名字段；令牌合格时响应带一个站内的继续地址，不合格或过期时照常登录、响应不带继续地址。`site.oauth-provider` 输出 4 写明它把人带到 `/login?continue=…` | t08 | B7 |
| S2 | `site.accounts` 输出 11 到 13、23 | 从授权请求来的人点社交图标登录、或点“注册”，成功后落到 `/`，续接丢了 | 发起请求可带继续令牌；带了的话，回调成功后落到继续地址而不是 `/`。注册页同样接受 `continue` | t08 | B7 |
| S3 | `site.accounts` 输出 1、13，字段规则“显示名 1 到 50” | 注册必须带显示名，定稿的注册页没有这一项 | 见 D2：推荐注册时显示名可省，省略时取用户名；社交注册同样 | t07（开发者定之后） | B3 |
| S4 | `site.accounts` 输出 1、3、8、10，提案 4.5“境外存放要单独告知并单独勾选” | 合同要两项同意，定稿的注册页与同意页各只有一个勾选框 | Spec 不改，页面加第二个勾选框（D1）；或者改提案与 Spec（D1 的候选 B） | 开发者定 | B3 |
| S5 | `site.accounts` 的 `GET meta` 与“站点配置：当前条款版本” | 同意页要显示“2026-11-20 版”这样的日期；`meta` 只回“版本号”，格式没定 | 写明条款版本是 `YYYY-MM-DD` 形式的日期，两份文件共用一个版本；`meta` 回它。前端的两份正文的版本号要与它相等（3.11） | t07 | B3 |
| S6 | `site.accounts` 输出 17 | “浏览器标识的概要”没定形状 | 定成 `{browser: string \| null, os: string \| null}`（服务端按一张小规则表从 User-Agent 解析，例如“Chrome”“Windows”），不给原始 User-Agent | t07 | B4 |
| S7 | `site.accounts` 输出 18 | 邀请码怎样交到被邀请人手里没写；注册页没有输入邀请码的地方 | 加一句：注册页接受 `/register?invite=<码>` 预填邀请码；账号页的“复制”复制这个链接。注册页的邀请码一项见 D2 | t10（主会话改 Spec） | B3、B4 |
| S8 | `site.accounts` 输出 8 | `me` 的字段名没写 | 不改 Spec，在合同包里定（3.2 的清单第 4 项） | t07 | B2 |
| S9 | `site.accounts` 输出 22 | `fields` 是“不合规则的字段名的数组”，没说字段名与请求体的键是什么关系 | 加：字段名就是请求体里的键名（例如 `username`、`displayName`） | t07 | B2、B3 |
| S10 | `site.accounts` 输出 10 | 同意门槛说“其它接口回 `consent_required`”，没说统计模块的看板接口在不在内 | 写明门槛只管账号模块的接口，或者统计模块的权限检查也按它拒绝；前端两种都能处理（守卫先查 `me`），但看板接口的行为要定 | t07、t11 | 不卡前端 |
| S11 | `site.oauth-provider` 输入的 `GET oauth/authorization`；输出 5 | “读一次待确认的授权请求”没写请求怎样标识、确认页的路径、响应字段 | 写明：服务端把人带到 `/oauth/consent?request=<不透明标识>`（路径以 t08 定的为准）；`GET` 带这个标识，回客户端名字、客户端回调的主机名、要的范围；`POST` 回跳回客户端的完整地址 | t08（随 OIDC 改写） | B7 |
| S12 | `site.oauth-provider` 的 `GET me/grants` | 每项有哪些字段没写 | 写明 id、客户端名字、范围、给出的时间 | t08 | B7 |
| S13 | `site.oauth-provider` 的 `GET admin/oauth-clients`；`site.admin` 的分页参数 | t09 第 12 条说 OAuth 客户端页也用数据表格（要总条数与页码），但这个列表不在 `site.admin` 的分页约定里 | 客户端列表也用 `site.admin` 的分页参数与响应形状（客户端少，`anchor` 可以照给） | t08 | B7 |
| S14 | `site.telemetry-dashboard` 输入的 `GET overview` | 看板上面一条的“较昨日”“当前在线（最近 15 分钟）”不在 overview 里 | 不必改：可以由 `series/active` 的最后两天与 `series/online` 的最后一段算出，由 t11 的适配器做（3.5）；t11 若想让 overview 直接给，在它自己的 Spec 里加 | t11 | 不卡 t10 |
| S15 | `site.operations` 的配置表、输出、“边界与兼容” | 没有静态文件 | 配置表加 `NB_SITE_WEB_DIR`；输出加一条“静态文件与单页回退”（路由顺序、回退的条件、两种缓存头、HTML 的安全头）；“边界与兼容”的公开接口加这个变量 | t10（主会话改 Spec） | B8 |
| S16 | `site.admin` 的 `GET users/:id` | 有接口，没有页面 | 见 D11 | 开发者定 | B6 |
| S17 | t10 README 第 12、20 行 | 还写着“中英双语” | 改成“第一版只做中文，文字的组织方式留好加英文的余地”（同文件第 26 行已记） | 主会话改 Task 记录 | 不卡 |
| S18 | t11 README 的范围 | “查询接口与管理面板里对应的图” | 按 D8 改成“查询接口、合同 schema、把响应转成 t10 定的视图模型的适配器、把看板接到真实数据” | 主会话改 Task 记录 | B5 的范围 |
| S19 | `docs/testing/README.md` 的 e2e 一节 | 只有应用的 Playwright | 加一句官方站的 e2e 在 `nb-site-web` 里、用 `test:e2e` 跑、真实冒烟的前置 | t10 | B10 |

另外两份文档改动随切片做，不是 Spec：nb-ui `README.md` 的组件表（A1、A2）；`scripts/ci/message-catalogs.ts` 登记站点目录（B1）。

## 5. 切片

每片一个提交；提交前先看验证命令自己的退出码，`git diff --cached --check` 单独一步。“现在能做”指不等任何后端 Task。

### 段 A：nb-ui 两个组件（分支 `feat/w00037-t10-nb-ui`，worktree `.worktree/w00037-t10-nb-ui`，从 master 开）

| 片 | 内容 | 前置 | 验证 |
|---|---|---|---|
| A1 分页 | 3.4 的 `Pagination`：`.vue`、`.md`、`.test.ts`、导出、README 一行、nb-ui 目录中英两份、Lab 场景 | 现在能做 | `bun run test:affected --package nb-ui --typecheck`；`bun run docs:check`；`bun run governance:check`；`bun run --cwd packages/neuro-book test:e2e -- e2e/lab-scenes.e2e e2e/lab-nb-ui.e2e`（先看负载） |
| A2 数据表格 | 3.4 的 `Table` 加 `stickyHeader` 与 `Table.test.ts`、`DataTable` 全套、Lab 场景、`lab-nb-ui.e2e.ts` 加吸顶与页脚位置一条 | A1 | 同 A1；四组合加 390 的实测（3.4 验收档） |

A2 之后派前端审查（Sonnet），审查处理完合入 master。官方站分支变基到新的 master 后，B6 才能用它们。

### 段 B：官方站（官方站分支；落在哪个 worktree 见 D13）

| 片 | 内容 | 前置 | 验证 |
|---|---|---|---|
| B1 外壳 | 路由表与守卫（3.1，页面先是空壳）、分派、主题与明暗（`host/theme.ts`）、站点变量、文字（3.3，含 `message-catalogs` 登记与目录覆盖测试的骨架）、存储模块（3.9）、接口层的核心（3.2：结果形状、按码处理、`Retry-After`，不含具体接口）、当前账号模块（对一个小接口编程，具体接口在 B2 接上）、“没有这一页”、构建测试加三条断言、`vitest` 与 `bunfig.toml` | t05 第 6 片（前端骨架） | `bun run test:affected --package nb-site-web --typecheck`；`bun run --cwd packages/nb-site-web build`；`bun run governance:check` |
| B2 稿纸与登录 | `PaperSheet`（3.6）、登录页兼主页、密码登录、`social_error` 在登录页的显示（社交图标先不接）、接上 `whoami`、`me`、`meta`、`login`、`logout`；Playwright 配置与假接口骨架（3.10），登录页的场景 | B1；t07 合同包导出 3.2 清单的第 1 到 4、6、7 项（只要 schema，不要实现）；D9 | 同 B1，加 `bun run --cwd packages/nb-site-web test:e2e`；390 与亮暗的实测 |
| B3 注册、同意、社交 | 注册页、同意页、两枚标志（3.7）、社交登录与注册的发起、注册草稿的暂存与还原、`social_error` 在注册页的显示 | B2；t07 合同的注册、同意、`meta`；t08 合同的 `SocialStartRequest`；D1、D2、D3、D5；S3、S4、S5、S7 改完 | 同 B2 |
| B4 账号页 | 3.12 的前四节（资料、登录与安全、设备、邀请码）；关联上游的发起与 `social_error` | B2；t07 合同；t08 合同的关联发起；D10；S6、S7 | 同 B2 |
| B5 管理外壳与看板 | 3.13 的外壳与导航、`/admin` 的看板页、3.5 的图表模块、视图模型与假数据、拆包断言 | B1；D8（分界）；不等后端 | 同 B2；暗色序列色与色阶的实测与截图 |
| B6 管理列表页 | 用户、注册码与邀请码、审计三页（3.13），全部用 `DataTable` | 段 A 合入 master 且官方站分支已变基；t07 的管理合同（3.2 清单第 5 项）；D11 | 同 B2 |
| B7 OAuth 相关 | 授权确认页、登录续接（`continue`）、账号页“已授权的应用”、OAuth 客户端页 | B4、B6；t08 改写 `site.oauth-provider` 并导出合同（3.2 的 t08 清单）；S1、S2、S11、S12、S13 | 同 B2 |
| B8 发静态文件 | 3.8：`nb-site-server` 的 `web.ts`、配置项、响应头、镜像构建、白名单与变异；`site.operations` 先改（S15） | D4；B1（要一份前端产物来测）；t05 第 7 片（镜像） | `bun run test:affected --package nb-site-server --typecheck`；`bun run --cwd packages/nb-site-server build:image --no-docker`；合同测试包照 t05 计划的命令跑一遍；路径穿越、单页回退不碰 `/api`、`/oauth2`、`/.well-known`、`/test-control` 的测试 |
| B9 公开页 | 3.11：隐私政策与服务条款的阅读版式、正文的构建、版本号断言、生产构建拒绝占位正文 | B1；条款文字（D6）；若用 Markdown 依赖，先放开 `nb-site-web` 的白名单 | 同 B1 |
| B10 真实冒烟 | 3.10 的真实服务冒烟；先做 `route.fetch` 的探针，不行换 TLS 转发；S19 | B8；t07、t08 的实现做完；合同测试包导出起进程的辅助函数；D12 | `bun run --cwd packages/nb-site-web test:e2e -- e2e/real` |

**现在就能做的**：A1、A2、B1（t05 第 6 片之后）、B5。等 t07 合同的：B2、B3、B4、B6。等 t08 的：B3 的社交部分、B4 的关联、B7。等条款文字的：B9。等后端实现做完的：B10。

**审查节点**：A2、B2、B4、B5、B7 之后与收口派前端审查（Sonnet）；B8 按快速审查（Opus 先审，omp `@review` 后台）。

## 6. 验收映射

按 Spec 编号列出由前端负责的部分；服务端自己的行为（并发、哈希、限流的计数）归 t07、t08 的合同测试，不在这里。

| Spec 条目 | 前端的验收 | 测试 |
|---|---|---|
| `site.accounts` 输出 1、3 | 注册页每个拒绝码落在对应字段与状态行；`registration_closed` 时表单不可用 | 注册页 dom 测试；B10 冒烟的注册 |
| 输出 4 | `invalid_credentials` 两个字段标红、`account_banned` 写状态行 | 登录页 dom 测试；B10 |
| 输出 6 | 会话失效后下一次请求的 `unauthenticated` 把人带到登录页并带 `next` | 接口层 `bun test`；B10 的封禁一步 |
| 输出 7、8 | 分派：匿名、缺同意、管理员、普通用户、合格与不合格的 `next` | `dispatch.test.ts` |
| 输出 9 | 有密码与没有密码两种账号的密码一行与按钮 | 账号页 dom 测试 |
| 输出 10 | 任一接口回 `consent_required`（门槛那种）时去同意页，补交后回 `next`；注册回的 `consent_required` 不跳 | 接口层 `bun test`；同意页 dom 测试；B10 拨条款版本 |
| 输出 11 到 13 | 社交注册发起前按表单校验，不合格不跳转；发起成功时写草稿再跳 | 注册页 dom 测试；存储 `bun test` |
| 输出 15、16 | 关联要当前密码（没有密码的免）；`last_login_method` 的文案 | 账号页 dom 测试 |
| 输出 17 | 会话列表的字段、“当前”标记、逐个结束与部分失败的文案 | 账号页 dom 测试 |
| 输出 18 | 满 10 个时生成不可用；`invite_code_limit` 的文案；停用 | 账号页 dom 测试 |
| 输出 19 | `rate_limited` 的倒计时与提交按钮 | 接口层 `bun test`（解析）；登录页 dom 测试 |
| 输出 22 | 错误体的解析、`fields` 落到字段、`malformed` | 接口层 `bun test` |
| 输出 23 | 三个落点页各自显示 `social_error` 并从地址去掉；不认识的码显示通用文案加码 | 三页的 dom 测试 |
| 输出 24 | 已关联账号一行显示上游名与上游账号的名字 | 账号页 dom 测试 |
| `site.admin` 输出 1 | 普通用户进 `/admin/*` 去 `/account`；接口回 `forbidden` 时重取身份再分派 | 守卫 `bun test`；B10 |
| 输出 4 | 新密码只在对话框里显示一次 | 用户页 dom 测试 |
| 输出 5 | `self_forbidden` 写在对话框的状态行 | 用户页 dom 测试 |
| 输出 9 | 同一次翻页沿用 `anchor`，换筛选、换搜索、刷新时重来 | 列表查询状态 `bun test` |
| 输出 10 | 页码越界时改到最后一页 | 列表查询状态 `bun test` |
| `site.oauth-provider` 输出 4、5 | 续接后回到授权请求；确认页的同意与拒绝；过期时的整卡片状态 | 授权确认页 dom 测试；B10 若 t08 的仿真客户端可用（依赖 t08 改写） |
| 输出 9 | 客户端密钥只显示一次 | 客户端页 dom 测试 |
| `site.telemetry-dashboard` 输出 7 | 没有数据的范围显示空状态；缺的天断线、零画 0 | 视图模型 `bun test` |
| 输出 8 | 口径说明显示在对应面板（t11 接上真实数据后） | t11 |
| `site.operations`（S15 之后的新输出） | 单页回退、缓存头、安全头、不覆盖模块路由与测试控制入口的 404 | `nb-site-server` 的测试（B8）；B10 |
| t09 第 7、10 条 | 四张稿纸页同一张纸；社交是表单下两枚图标 | 假接口浏览器场景的截图与几何 |
| t09 第 8、11 条 | 有邮箱、没有邮箱两种账号的版式相同：各节标题的位置逐个相等 | 账号页浏览器场景量几何 |
| t09 第 12 条 | 数据表格三块位置固定、最后一页页脚在底、多于 7 页时 7 格 | A2 的 dom 测试与 Lab 浏览器测试；B6 场景 |
| t09 第 13 条 | 只有看板块带 ECharts，体积有上限 | 构建测试 |
| t09 第 14、15 条 | 序列色、红色色阶、状态色取自变量，换配色后重画 | 图表配置 `bun test`；看板浏览器场景 |
| t09 第 5 条 | 稿纸页、公开页 390 宽没有页面级横向溢出 | 浏览器场景 |

## 7. 验证

按 `docs/testing/README.md` 的“验证门禁”：只跑受影响的，长验证前先 `cat /proc/loadavg`，失败先区分产品、测试与环境。

- 每片：第 5 节那一片的命令。`test:affected` 带 `--typecheck`；改了 nb-ui 的 Lab 场景必须跑 `lab-scenes`。
- 段 A 收口：A1、A2 的命令全过；四组合加 390 的实测记录；前端审查处理完。合入 master 后在 master 上重跑 `bun run test:affected --package nb-ui --typecheck`。
- 段 B 收口：`bun run test:affected --package nb-site-web --package nb-site-server --typecheck`；`bun run --cwd packages/nb-site-web build`；`bun run --cwd packages/nb-site-web test:e2e`（假接口场景全部；真实冒烟在 B10 之后加入）；`bun run --cwd packages/nb-site-server build:image --no-docker`；`bun run governance:check`；`bun run docs:check`。
- 界面取证按 3.10 的验收档，每项给计算样式、几何或交互前后的实测，不用截图观感代替。
- 收口前把第 6 节逐行对到具体用例，对不上的补上或在汇报里写明。

## 8. 不做与风险

**不做**：英文界面；条款与隐私政策的文字；看板的查询接口与适配器（t11）；邮箱验证、找回密码、注销（`site.accounts` 的非目标）；服务端渲染、PWA；手动切换明暗；管理面板的手机版式。

**风险**：

1. **合同来得晚**：B2 到 B4、B6、B7 都等合同包的 schema。缓解：A1、A2、B1、B5 不等；向 t07、t08 要的是 schema 先行，可以在它们的实现之前单独合入。
2. **OIDC 改写**：授权确认、续接、“已授权的应用”、客户端页都放在 B7，最后做；改写的结果与 S1、S2、S11 到 S13 对不上时只返工 B7。
3. **Google 审核**：主页只有一行说明、只有图标的登录按钮，都可能不过审（D3、D7）。审核在上线之后，被拒时改页面，不影响别的片。
4. **`route.fetch` 转发 Cookie 没核实**：B10 先做探针；不行就用 TLS 转发，多一段证书生成。
5. **内容安全策略**：`style-src 'unsafe-inline'` 是 nb-ui 与 ECharts 逼出来的；以后 nb-ui 去掉内联 `<style>` 时可以收紧。B8 的冒烟要看浏览器控制台没有违反策略的报告。
6. **稿纸对齐**：宽度小于 390 的屏幕上格线与卡片不对齐，已知限制。
7. **与后端同一个分支**：实现 worktree 里另一个子代理在写后端；前端各片若也在那里做，两边会互相等或撞文件（D13）。
8. **体积**：看板块约 178 KB（gzip），只给管理员；入口块没量，B1 记下数后如果过大再看 nb-ui 的按需导入。

## 9. 要主会话或开发者定的事

会改变产品结果、范围或不可逆后果的决定。t09 README 已经记的两处照 Spec 改图（密码一行、退出其它所有设备）不重复。前五条是定稿的图与 Spec 或规范对不上的地方。

**D1 境外存放的单独勾选。**

- 背景：提案 4.5 写“账号数据存放在境外要单独告知并单独勾选”；`site.accounts` 输出 1、3、10 把“同意条款版本”与“同意境外存放”当两项，缺一项注册回 `consent_required`、老账号被同意门槛挡住。定稿的注册页与同意页都只有一个勾选框（“我已阅读并同意服务条款与隐私政策”“我已阅读并同意这两份条款”）。
- 候选：A 两页都加第二个勾选框“我知道账号数据存放在境外的服务器上”，在第一个下面，社交注册用同样两项；B 只留一个勾选框、文字里写上境外存放，改提案与 Spec 成一项同意。
- 推荐 A：提案明确要求单独勾选，Spec 与它一致；只是卡片里多一行，不改版式的其它部分。B 要改已接受的提案，并且单独勾选通常是境外存放告知的常见做法（推断，没查具体法规条文）。
- 不定会卡住：B3。

**D2 注册页的显示名与邀请码。**

- 背景：`site.accounts` 输出 1 要求注册带显示名（1 到 50 字，必填），邀请码可选；定稿的注册页只有注册码、用户名、邮箱、密码、一个勾选框，两项都没有，也没有别的地方能输入邀请码。
- 候选：显示名 A1 页面加一项；A2 改 Spec 让注册时显示名可省、省略时取用户名，之后在账号页改。邀请码 B1 页面加一项“邀请码（可选）”，`?invite=` 预填；B2 只认链接里的 `?invite=`，有时在卡片的固定位置显示一行“邀请码 X”，没有时这一行空着。
- 推荐 A2 加 B1：显示名在注册时不是必要的，省一项最贴近定稿，社交注册也少一项；邀请码一直在表单里最直白，用户手里只有码没有链接时也能填。
- 不定会卡住：B3，以及 t07 注册请求的 schema。

**D3 GitHub 与 Google 标志的画法。**

- 背景：3.7。定稿的两枚图标是单色、跟着文字色、放在 nb-ui 次要按钮的底色上；Google 的规范要求全彩“G”、规定底色与描边，GitHub 的规范要求标志只用黑或白。
- 候选：A 位置与大小照定稿，画法照两家规范（Google 白底或 `#131314` 底加描边的全彩“G”，GitHub 黑或白的标志），读屏名字与悬停提示写动作；B 改成带文字的按钮（“用 Google 登录”），更稳妥地满足 Google 的“表明动作”，但改了定稿的样子。
- 推荐 A：保留定稿的排法，只改颜色；B 留作审核被拒时的退路。实现后截图给开发者看一眼两枚图标的新样子。
- 不定会卡住：B3。

**D4 由 `nb-site-server` 发静态文件。**

- 背景：3.8。提案 4.3 已写由这个进程发，但 `site.operations` 里没有；要加一个配置项、一条输出，`nb-site-server` 以开发依赖带上前端包。
- 候选：A 照 3.8；B 交给反向代理，镜像里不带前端。
- 推荐 A：与提案一致，部署仍是一个镜像；B 要多一份产物与代理规则。
- 不定会卡住：B8、B10。

**D5 注册码能不能暂存。**

- 背景：3.9。社交注册跳去上游后失败回来，要还原表单。注册码是有次数的准入凭据。
- 候选：A 连注册码一起存进 `sessionStorage`，10 分钟、读一次就删；B 不存注册码，回来后要重填。
- 推荐 A：风险只在同一标签页里的脚本，内容安全策略只许自家脚本；B 在 `email_taken` 这类常见失败后让用户再找一次码。
- 不定会卡住：B3。

**D6 隐私政策与服务条款两页。**

- 背景：外观与文字都还没有（t09“下一步”第 3 条）；同意页要链接它们，Google 审核要求能看到隐私政策。
- 候选：A t10 先做阅读版式与构建管道，正文是占位，生产构建拒绝占位正文（3.11），文字来了只换文件；B 两页整体推迟到文字定了以后。
- 推荐 A：版式简单，先做好就不卡上线前的最后一步；生产构建的拒绝保证占位不会上线。
- 不定会卡住：B9；正式上线。

**D7 主页只有一行说明。**

- 背景：t09 第 1 条“主页只做登录入口”，旁边一行产品说明与两个链接是主会话加的、待追认。Google 对 OAuth 应用主页的要求（`https://support.google.com/cloud/answer/13807376`）是不登录就能看到、完整说明应用的功能、链接隐私政策、在已验证的域名上；页面没说登录页能不能当主页。
- 候选：A 照 t09，上线后被拒再加；B 现在就在登录卡片下面加一段几行的功能说明。
- 推荐 A，并请开发者追认那一行：B 改了开发者定的“只做登录入口”。
- 不定会卡住：不卡任何片；影响 Google 审核。

**D8 看板与 t11 的分界。**

- 背景：t11 README 写的范围是“查询接口与管理面板里对应的图”，t10 README 与说明又说看板外壳在 t10。
- 候选：A 照 3.5，t10 做页面、图表与视图模型，t11 做接口、合同与适配器；B 看板整页归 t11，t10 只留一个占位页。
- 推荐 A：图表的拆包、主题与重画和前端其它部分一起做最顺，t11 只接数据；视图模型是两边的接口。要改 t11 README（S18）。
- 不定会卡住：B5。

**D9 表单校验结果的显示。**

- 背景：t09 README 补进 Spec 的七处里写“页面在那个字段下显示它的规则”；nb-ui 开发规范“表单与无障碍”第 7 条要求校验结果不改变表单排版、不在字段下插入文字，字段标红并聚焦，原因写在一个固定位置。`site.accounts` 输出 22 本身只说 `fields` 是字段名数组，没有规定显示位置。
- 候选：A 照 nb-ui 规范（3.1 的状态行）；B 照 t09 的记录，在字段下插一行。
- 推荐 A：B 违反规范，表单每次出错都换一次样子，与第 3 节第 4 条“状态变化不推动周围内容”也冲突。t09 那句是对接口的说明，不是开发者对外观的决定（推断，记录里没写开发者看过这一点）。
- 不定会卡住：B2 起的每一个表单。

**D10 账号页的头像与邀请码停用。**

- 背景：`PATCH me` 收头像（`site.accounts` 输出 8），邀请码可以停用（输出 18）；定稿的资料一节没有头像，邀请码一行只有“复制”。
- 候选：A 照 Spec 加上：资料一节加“头像地址”一项（只收 http 或 https 地址），邀请码一行加“停用”；B 改 Spec 去掉这两样。
- 推荐 A：两样都在既有的行里多一项，不改版式；去掉要改合同并影响旧站导入的数据。
- 不定会卡住：B4。

**D11 用户详情。**

- 背景：`site.admin` 有 `GET users/:id`（资料、登录方式、会话数、注册时用的码与邀请人），没有图。
- 候选：A 点一行打开 nb-ui `SidePanel` 显示详情，行尾“…”的操作在里面也有；B 第一版不做详情，只有行尾操作。
- 推荐 A：管理员处理封禁、重置时要看登录方式与邀请人；`SidePanel` 是现成组件。实现时截一张图给开发者，不另开评审轮。
- 不定会卡住：B6 的用户页。

**D12 官方站的真实浏览器冒烟。**

- 背景：3.10。现有 Playwright 配置属于应用包。
- 候选：A 在 `nb-site-web` 里配 Playwright，做假接口场景与一份真实服务冒烟；B 只做假接口场景，真实行为全靠合同测试。
- 推荐 A：只有真实冒烟能证明来源头、`Secure` Cookie、单页回退与内容安全策略在浏览器里一起成立，这些都是合同测试（不经浏览器）看不到的。代价见 3.10。
- 不定会卡住：B10。

**D13 前端各片在哪里做。**

- 背景：段 B 在官方站分支上；实现 worktree 里另一个子代理在写后端。
- 候选：A 前端另开分支 `feat/w00037-t10-web`（从官方站分支开，worktree `.worktree/w00037-t10-web`），后端的合同进来时变基，做完合回官方站分支；B 与后端同一个 worktree，由主会话排开先后。
- 推荐 A：前端与后端几乎不碰同一批文件（只有 B8 动 `nb-site-server`，可以放到后端空闲时在官方站 worktree 里做），各自的验证不互相干扰。
- 不定会卡住：B1 的开工。

## 主会话的审定（2026-11-24）

计划由一个 Opus 子代理起草（只读）。主会话读过切片、nb-ui 两个组件的设计（3.4）、Spec 改动清单与第 9 节，其余各节在对应的片开工前再读；**与前文冲突的地方以本节为准**。

第 9 节的十三件事，按推荐定（开发者 2026-11-24 说过“都按照你推荐就行”；其中 D1、D2 会让注册页比定稿的图多两样东西，已在汇报里单独告知开发者）：

| 编号 | 结论 |
|---|---|
| D1 | 注册页与同意页各加第二个勾选框（境外存放），社交注册同样两项。依据是已接受的提案 4.5 与 `site.accounts`，图照合同改 |
| D2 | 注册时显示名可省，省略时取用户名，以后在账号页改（已改 `site.accounts` 输出 1、13）；注册页有一项“邀请码（可选）”，`/register?invite=<码>` 预填（已写进输出 18） |
| D3 | 两枚标志的位置与大小照定稿，画法照两家的品牌规范；实现后截图给开发者看 |
| D4 | 由 `nb-site-server` 发静态文件（提案 4.3 已写）；`site.operations` 的改动（S15）在 B8 开工前由主会话写 |
| D5 | 社交注册跳走前，表单里已填的内容连注册码一起存进 `sessionStorage`，10 分钟有效、读一次就删；密码不存 |
| D6 | 先做两页的阅读版式与构建管道，正文放占位，生产构建遇到占位正文就失败 |
| D7 | 主页照 t09 第 1 条，只有登录入口与一行说明；Google 审核被拒再加 |
| D8 | 看板的页面、图表模块与视图模型归本 Task；查询接口、合同与把响应转成视图模型的适配器归 t11（已改 t11 README） |
| D9 | 校验失败照 nb-ui 开发规范“表单与无障碍”的做法：字段标红并聚焦，原因写在固定位置的一行，不在字段下插文字。t09 记录里“在字段下显示规则”是主会话写错的，已改 |
| D10 | 账号页照 Spec 补上头像地址（资料一节）与邀请码的“停用”（邀请码一行），都加在已有的行里 |
| D11 | 用户详情用 nb-ui 的 `SidePanel`，点一行打开；实现后截图给开发者看，不另开评审轮 |
| D12 | 在 `nb-site-web` 里配 Playwright：假接口的场景加一份对着真实服务的冒烟 |
| D13 | 官方站前端各片在单独的分支 `feat/w00037-t10-web`、worktree `.worktree/w00037-t10-web` 里做，从官方站分支开，合同进来时变基；B8 在官方站的 worktree 里做 |

Spec 改动清单的处理：

- 已由主会话改进 `site.accounts`：S3（显示名可省）、S5（条款版本是日期、两份文件共用一个）、S6（会话的浏览器概要是浏览器名与系统名）、S7（邀请链接）、S9（`fields` 是请求体的键名）、S10（同意门槛只管账号模块的接口）。
- 归 t08、随 OIDC 改写一起定：S1、S2（登录续接与社交流程里的续接）、S11、S12、S13。已记进 t08 README。
- S4 不改 Spec（见 D1）；S8 在合同包里定；S14 归 t11；S15、S19 在 B8、B10 开工前改；S16 见 D11；S17、S18 已改 Task 记录。

给 t07、t08、t11 的合同包要求（3.2）已分别记进各自的 README；统计的合同包里前端要的只有看板那部分，归 t11。

开工顺序：段 A（nb-ui 的“分页”与“数据表格”）现在就做，在分支 `feat/w00037-t10-nb-ui` 上，前端审查之后先合入 master。B1 等 t05 的前端骨架合入官方站分支后开；B5 在 B1 之后。其余各片等对应的合同。

## 段 A 实现审查的处理（2026-11-24）

段 A（nb-ui 的 `Pagination`、`DataTable`、`Table.stickyHeader`）做完后提交在分支 `feat/w00037-t10-nb-ui`（`0c4f222e8`、`8d89ae100`、`3c556e48b`）。审查者：一个 Sonnet 子代理，只读，在仓库外用真实 Chrome 跑了实验与变异；报告 [`evidences/a-impl-review-sonnet.txt`](evidences/a-impl-review-sonnet.txt)，13 条（重要 8、建议 5，没有阻断）。**与前文 3.4 冲突的地方以本节为准。**

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 键盘连按“下一页”到末页时箭头变成不可用，焦点掉回 body；整条变不可用时同样 | 改。焦点原先在条里、现在落在条外或落在不可用的按钮上时，移到当前页的格子；整条不可用时没有可聚焦的格子，焦点留给使用方（写进 `.md`）。补用例：焦点在“下一页”、连点到末页 |
| 2 | 页码越界且这一页没有行时，表格区写“暂无数据”，页脚却写“第 61 到 65 条” | 改。条数的区间按这一页实际拿到的行算：没有行（且不在加载）时只写“共 N 条”，有行时终点是起点加行数减一。“删到最后一页没有行时回退页码”是使用方的事，写进 `.md` |
| 3 | 点“重试”后焦点掉回 body；翻页加载的遮罩只挡指针，键盘还能走到被盖住的行内按钮 | 改。出错层消失时焦点若在层里，移到表格区（`tabindex="-1"`，不滚动）；遮罩期间表格区的行加 `inert` |
| 4 | 容器矮时居中的状态层比表格区高，溢出去盖住页脚，“重试”落在页脚上 | 改。状态层自己可滚动，内容比表格区高时从顶部排起；`.md` 写明放得下状态层的最小高度；Lab 加一个矮画布的出错场景并断言按钮在表格区之内 |
| 5 | 根上的 `container-type: inline-size` 让组件在 flex 行、自动宽度的上下文里宽度塌成 0 | 改。容器挪到页脚那一条上 |
| 6 | 390 宽时页脚的条数被截成“共 1,28…” | 改。窄时页脚折成两行（条数一行、分页条一行），不要省略号；高度随宽度变、不随状态变。桌面宽的样子（开发者在评审板上同意的）不变。Lab 的英文场景加 390 宽并断言条数没被截断 |
| 7 | `:deep(td)` 的不换行会作用到使用方放进单元格的一切，也没法逐列关掉 | 改。`Table` 加 `nowrap`（缺省假，现有行为不变），列的定义加 `wrap`（这一列例外）；`DataTable` 传 `nowrap`，去掉 `:deep`。两个组件都还没合入，现在改属性不算破坏 |
| 8 | 加载延时、清定时器、翻页回顶、不换行都没有用例守着；“位置不变”的几何测量只在仓库外的脚本里 | 部分改。入库两条浏览器用例：分页 100 页连点“下一页”时整条的宽度与两个箭头的位置不变；`DataTable` 六个场景的工具条与页脚的位置、高度相同。回顶与不换行随第 12、7 条各补一条 dom 用例。加载延时的三条（延时改成 0、不清定时器、卸载不清）不补：要测“没出现”只能用假计时器或固定时长的等待，仓库的测试规则两样都不许；它们由实现者在开发服务上点过的那一遍与 Lab 的两个加载场景覆盖，记为接受的缺口 |
| 9 | 分页格的悬停比相邻的箭头淡得多，没有按下态 | 改。悬停与箭头一致，加按下态 |
| 10 | 工具条的高度依赖宿主的 `box-sizing` | 改。显式写 `border-box`（官方站是另一个宿主，不带应用的那份重置） |
| 11 | 传给根的高度、底色、圆角的类被组件的样式压住 | 只改 `.md`：尺寸由父容器给，这几样不能用类覆盖 |
| 12 | 换筛选或搜索（页码不变）时表格区不回到顶部 | 改。回顶的时机从“页码变了”换成“行换了一批”（`rows` 的引用变了）：新行到了才回顶，翻页加载期间旧行不会先跳一下 |
| 13 | 使用方要自己记住的取数约定有六点，`.md` 只零散提到 | 改 `.md`：集中写一节“使用方的取数约定”，带一个短的例子。官方站四个列表页共用的那一段由 `nb-site-web` 自己写一个组合函数收口（段 B 做管理面板时），nb-ui 不收 |

实现者自报的两处（窄宽条数被截、重试后焦点丢失）就是第 6、3 条。修正在同一个分支上单独提交；核对后合入 master。

## B1、B2 实现审查的处理（2026-11-26）

审查者：一个 Sonnet 子代理，只读，在仓库外的副本里做了变异与截图；报告 [`evidences/b2-impl-review-sonnet.txt`](evidences/b2-impl-review-sonnet.txt)，13 条（重要 6、建议 7，没有阻断）。**与前文冲突的地方以本节为准。**

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | `safeNext` 经 `./`、`../` 规范化后能回出 `//host` | 改：规范化之后再判 |
| 2 | “没有横向溢出”的断言量不出滚动条槽宽以内的溢出 | 改：直接量能不能横向滚动 |
| 3 | 360 宽产品名折行、卡片与格线错位 | 改：360 宽对齐并进浏览器场景；320 宽记为已知限制 |
| 4 | `social_error` 里像码的未知值被回显，与 `site.accounts` 输出 23 相反 | 改实现：只认合同里的码，其余一律 `social_failed` |
| 5 | nb-ui `Field` 出错时让控件下面多 6 像素，登录页的绕法会被每个表单页复制 | 改上游：修 `Field`，登录页改回用它 |
| 6 | `src/api/` 与线路前缀 `/api/` 同名，计划自己矛盾；假接口的过滤是死代码 | 改：目录改名，删过滤 |
| 7 | 倒计时状态行每秒被读屏播报 | 改：秒数不进 live region |
| 8 | 纸色铺满 `body` 与状态行占位都没有用例守着 | 改：补断言并变异 |
| 9 | 注册接口漏声明 `handles` 时访客会被弹去登录页 | 改：门槛的统一处理只对登录态生效 |
| 10 | 对比度：暗色状态行 4.24、“没有这一页”的链接 3.29、行内链接只靠颜色 | 后两处改；暗色状态行来自 nb-ui 的 `--status-danger` 令牌，记为上游候选 |
| 11 | TypeBox 被打进访客入口；ECharts 断言空过 | 改：先试合同包 `sideEffects: false`，不够再加只放常量的子路径；ECharts 断言改读 sourcemap |
| 12 | 状态行单行截断，窄屏读不全原因 | 改：窄屏留两行 |
| 13 | 自动填充时按钮可能一直不可用；`meta.layout` 没人读；草稿写死两个上游；稿纸造了空的地标 | 自动填充先实测；其余三处改（`App.vue` 按 `layout` 套稿纸，稿纸页之间切换时稿纸不重建） |

## B3、B4 实现审查的处理（2026-11-27）

审查者：一个 Sonnet 子代理，只读，审 `390a14dea..a8d2f4a4c`，在真实 Chrome 与构建产物上复现了大部分条目；报告 [`evidences/b4-impl-review-sonnet.txt`](evidences/b4-impl-review-sonnet.txt)，22 条（重要 10、建议 12，没有阻断）。**与前文冲突的地方以本节为准。**

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 社交注册成功或放弃后草稿没人删，10 分钟只在读时判 | 改：当前账号变成已登录时删草稿；站点启动时删掉过期的草稿 |
| 2 | 在上游页点返回、页面从 bfcache 恢复后卡在“发起中” | 改：收成一处，`pageshow` 的 `persisted` 为真时放开所有“正在离开”的状态 |
| 3 | 目录的“钉住”只被滚轮、触摸、按键放开 | 改：平滑滚动结束（`scrollend`）后放开 |
| 4 | 360 宽当前标签滚出标签行 | 改：高亮变化时把当前标签横向滚进标签行，不带动页面纵向滚动 |
| 5 | 键盘激活目录项后焦点没进那一节 | 改：焦点给那一节的标题（`tabindex="-1"`、不再滚动）；带锚点进入时不抢焦点 |
| 6 | 节底的空状态行留下大块空白，定稿没有 | 改：状态行与节底的按钮同一行（手机宽也是），没有按钮的节放进标题行；量“内容底到卡片底只有内边距” |
| 7 | 账号页的 `meta` 晚到时上游行消失、下面的节上移 | 改：`meta` 进页面级的加载，失败不挡页面 |
| 8 | “退出其它所有设备”失败后仍发完剩下的 | 改：除 `not_found` 外第一次失败就停，写结束与没结束的个数并保留那次失败的原因与倒数 |
| 9 | 生成邀请码倒数期间仍可点；倒数显示成几千秒 | 改：倒数期间不可用（设备一节同样）；超过一分钟的等待写分钟 |
| 10 | 设密码成功后关闭中的对话框变成“修改密码” | 改：对话框取打开那一刻的 `hasPassword` |
| 11 | 服务端规范化邮箱后表单仍算有改动 | 改：保存成功后改过的字段换成服务端回的值 |
| 12 | 最后使用时间写到分钟、一行两个绝对时间 | 改：照定稿只写一个相对的最后使用时间（粒度到小时），登录时间放进 `title`；密码一行仍写“已设置”（合同没有修改时间） |
| 13 | 行内说明 `--text-muted` 对比 3.57 | 改：用 `--text-secondary` |
| 14 | nb-ui `Button` 不可用态靠 40% 不透明度，字对底约 1.7 | 不在本分支改：记为 nb-ui 上游候选，告知开发者 |
| 15 | 每行按钮读屏名字重复；账号菜单的名字盖住用户名 | 改：动作加对象的 `aria-label`；账号菜单的名字含用户名 |
| 16 | 登录页、注册页 `meta` 晚到时社交图标先有后无 | 改：`meta` 回来前与取不到时这一行不画，回来后有开放的上游才带过渡展开 |
| 17 | 码表用原型上的键查；空的 `social_error` 在注册页仍还原草稿 | 改：查表用 `Object.hasOwn`；三处读 `social_error` 收成一个函数，空值当作没带 |
| 18 | 两个对话框的倒数每秒播报 | 改：对话框的状态在倒数期间给不带秒数的固定说法 |
| 19 | 访客入口 gzip 从约 59 KB 涨到 120 KB | 改：账号页才用的弹层与菜单不进访客入口；构建测试加入口体积上限与来源断言 |
| 20 | 几处判据没测到 | 改：补停用邀请码与结束单个会话的 `not_found`、账号页各处的 `rate_limited`、不减弱动效的目录用例 |
| 21 | 状态行的 `reason` 靠前缀暗号；`meta` 失败后图标永远灰 | 改前半：“规则说明”收成 `useFormFeedback` 的一等操作；后半随第 16 条（取不到就不画），不加重试 |
| 22 | Google 的“G”用 `foreignObject` 与滤镜，只在 Chrome 验过 | 改：换成纯路径的标准全彩“G”，亮暗共用一份；外观不变 |
