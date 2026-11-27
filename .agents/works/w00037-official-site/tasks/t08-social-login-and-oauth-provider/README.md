---
schema: nbook.task/v2
taskId: t08-social-login-and-oauth-provider
status: done
updated: 2026-11-26
---

# 社交登录与对外 OAuth 服务

## 目标与范围

Google 与 GitHub 登录（通用 OAuth 插件、仿真上游、注册顺序、关联与解绑），对外 OAuth 服务（端点白名单、客户端登记、授权码加 PKCE、授权确认、令牌），库私有的协议包进自家合同。

合同：[`site.accounts`](../../../../../docs/specs/site/accounts.md) 的输出 11 到 16，[`site.oauth-provider`](../../../../../docs/specs/site/oauth-provider.md)。

## 当前状态

已完成（2026-11-26）：十片与三轮实现审查（第 2、3 片，第 4 到 7 片，第 8 到 10 片，各 Opus 加 omp）、晋升前逐句核对的修正都在分支 `feat/w00037-t08-social-oauth` 上，经 Work 分支（`c49dadfc7`，先并进了 master）合入 master（`a81b85b5e`）；`site.oauth-provider` 晋升 implemented，`site.accounts` 与 `site.admin` 里 t08 的 planned 标记已去掉（`7f6969cf1`；留导入码的次数与注册页预填邀请码两句，归 t12、t10）。上线前要开发者在 Google、GitHub 注册 OAuth 应用。

范围：Google 与 GitHub 登录（通用 OAuth 插件、照真实形状的仿真上游、先填后跳的注册顺序、邮箱撞号、关联与解绑），对外 OAuth 服务（可达端点的精确清单、客户端登记、授权码加 PKCE、授权确认、令牌与用户信息、随账号失效），库私有的续接协议与回调错误包进自家接口。

前置：[t07](../t07-identity-core/README.md)。要开发者提供的：Google 与 GitHub 的 OAuth 应用由开发者的账号注册（生产用的客户端 id 与密钥），到部署验收时才需要；实现与测试用仿真的上游。

开发者 2026-11-24 定：

- **对外 OAuth 按标准 OpenID Connect 做**：接受 `openid` 范围、发 id_token、公开公钥地址。起因是第五轮探针查出“不接受 `openid`”与“用户信息端点回资料”靠库的配置不能同时成立（报告见 [t07 的证据](../t07-identity-core/evidences/better-auth-spike-5.txt)的“对合同的影响”第 1 条）；“不发 id_token”原是主会话写 Spec 时选的假设。不支持刷新令牌不变。`site.oauth-provider` 要照此改，改之前先补一轮探针（发现文档的内容、id_token 的签名算法与字段、用户信息里加用户名与“邮箱待补”、封禁与重置之后的行为）。
- **站点地址用 `https://nbook.notnotype.com`**，它也是签发者。以后若有 NeuroBook 自己的域名再考虑换；现在用户不多，开发者接受到时让已接入的客户端跟着改。
- **遥测写入口单独一个子域名**（名字由主会话定：`telemetry.nbook.notnotype.com`，待追认）。

第六轮探针（2026-11-24，库 1.7.27、`bun:sqlite`；报告 [`evidences/better-auth-spike-6.txt`](evidences/better-auth-spike-6.txt)，结果行 [`evidences/better-auth-spike-6-out.txt`](evidences/better-auth-spike-6-out.txt)）把按 OpenID Connect 配置时库的行为跑出来了。开工的第一步是照它的“对合同的影响”一节改写 `site.oauth-provider`，再写计划。要点：

- **发现文档由自家路由给**：库的文档里有我们不提供的能力（内省、`client_secret_post`、登出端点等），配置去不掉；自家路由从库取值、按白名单输出。文档与公钥地址在站点根，签发者不带路径。
- **id_token**：第一版就定 RS256（库缺省是 EdDSA；同一个库中途换算法，库仍用旧钥签名而文档写新算法）。字段是 `iss`、`sub`（账号数字 id 的字符串）、`aud`、`iat`、`exp`、`auth_time`、`at_hash`，带 `nonce` 时回带；资料字段不进 id_token。私钥加密存在账号库里，密钥从会话密钥派生。
- **用户信息**：库自带的字段去不掉，要用钩子删：占位邮箱、按空格拆显示名得到的 `given_name` 与 `family_name`。扩展字段能按范围加。
- **随账号失效靠删会话**：授权时的会话被删，令牌才失效。只重置密码不删会话、用户撤销授权，令牌都照用，这两处要自己补；撤销授权时还要废掉没用掉的授权码。
- **授权请求与授权码共用一个有效期**：库用同一个配置管两者，不能一个 10 分钟、一个 1 分钟。
- **库的端点**：除合同要的几个，其余用 `disabledPaths` 关成 404；普通用户经 HTTP 能自己登记客户端（实测 201），必须关。`POST /oauth2/authorize` 与 GET 同路径，要在挂载层按方法挡。撤销不存在的令牌库回 400，要改写成成功。

主会话按“待追认”定的几处（都只影响对外 OAuth 的细节）：

1. 资料字段不放进 id_token，只经用户信息端点给：id_token 发出后收不回，里面的个人信息越少越好。
2. 用户信息里的用户名叫 `preferred_username`，显示名叫 `name`；邮箱待补时不出 `email`，另给 `email_pending: true`；`given_name`、`family_name` 去掉。
3. 授权请求与授权码的有效期都取 10 分钟（原 Spec 写授权码 1 分钟）：授权码只能用一次并且绑着 PKCE，10 分钟是标准建议的上限；取 1 分钟的话用户要在 1 分钟内完成登录与确认。
4. id_token 有效期 1 小时，与访问令牌相同；`prompt` 只支持 `none`、`login`、`consent`；不提供登出端点与内省端点。

探针没试的修法与边界见报告末尾“没能核实的事”，写计划前挑影响大的补探：会话 id 复用的修法（见 [t07](../t07-identity-core/README.md)）、废掉没用掉的授权码、撤销端点的改写。

第五轮探针另外确认的：服务方范围收成 `profile`、`email` 且许可类型只留授权码时，不发刷新令牌，`grant_type=refresh_token` 回 400；库缺省的授权码有效期是 600 秒，要配成 60 秒；缺省配置下刷新令牌不随封禁与重置密码失效，所以以后若要支持刷新令牌，得先补这一条。

前端计划查出、要随 OIDC 改写一起写进 Spec 的五处（2026-11-24，[t10 的计划](../t10-frontend/plan.md) 第 4 节的 S1、S2、S11、S12、S13）：登录续接（登录页的地址带 `continue=<不透明令牌>`，登录请求带同名字段，响应给站内的继续地址；提案 4.5 写了，Spec 没写）；从授权请求来的人改走社交登录或注册时续接不丢；授权确认页的路径、这次请求怎样标识、读出的字段与同意后回的跳转地址；`me/grants` 每项的字段；OAuth 客户端列表用 `site.admin` 的分页约定。合同包要导出的东西见同一份计划 3.2 的 t08 清单。

审查：安全边界，按高风险后端做快速审查。

从 t07 的计划与它的设计审查接过来的（2026-11-24，[t07 的计划](../t07-identity-core/plan.md) 3.2、3.4、3.6、3.10 与“设计审查的处理”）：

- 账号核心的做法：登录、注册、改密码与管理操作由模块自己的路由做，库只发会话、认 Cookie，并承担本 Task 的协议部分。本 Task 对外的标准端点与上游回调经一张“方法加路径”的白名单挂库的处理函数，白名单之外回 404；t07 留了空的白名单表。
- 账号库只有一条连接、一个队列，库经自定义方言走它。库的事务里凡是不取当前事务、改用基础适配器的调用都会被队列当场拒绝（不再是悄悄落在同一条连接上）：已知 `reserveVerificationValue`（DPoP 与撤销未证明的账号访问会调它）。写计划时先把本 Task 要用的插件在这条队列上跑一遍。
- 库的 id 设成了全库的自增数字，库在这种设置下关掉了靠主键判重的单次使用检查：白名单不提供 `private_key_jwt` 与 DPoP（第一版只有授权码加 PKCE，不受影响）；以后要提供时先把相关的表换成字符串主键。
- 账号库的第一条迁移已定（库的四张表逐字抄、只加自增），本 Task 要的表用 `0002` 起的迁移另建；上游账号的名字放自己的表，不往库的 `account` 表加列（加列后库的结构检查是否容忍没有探）。
- t07 里所有删会话的地方（登出、结束单个会话、结束全部、改密码、封禁、改角色、重置密码、清理任务）都经同一组函数，在调用方的写事务里直接删行，不经库的钩子。本 Task 在这组函数里加令牌与授权码的撤销，同一个事务；改密码保留当前会话，但 `site.oauth-provider` 输出 8 要求此前发出的令牌与没用掉的授权码失效，不能靠“会话还在不在”判断。对外 OAuth 的插件给令牌的 `sessionId` 设了 `ON DELETE SET NULL`、令牌的会话检查只在它不为空时做（omp 读源码所得，入口开着外键），所以直接删会话不等于撤销令牌：用开着外键的真实插件分别走删单个、批量、清理、改密码保留当前会话，看旧令牌与授权码（t07 omp 设计审查第 16 条）。
- 没探过的：授权中途登录后回到授权请求，靠插件的前后钩子匹配带会话令牌的 `Set-Cookie`；t07 发会话用的是自己的服务端端点，能不能被后钩子匹配上只是从源码推断，本 Task 第一件事是探它。
- 社交流程的 10 分钟到期由库按系统时间判，测试控制入口拨不到，怎样验本 Task 定。
- 合同包里已经放了前端要的社交错误码、上游身份列表项与三个审计动作名（只追加）；`me/identities`、`social/:provider/start` 的路径与对外 OAuth 的失败码由本 Task 加。

- `reserveVerificationValue` 成功时直接插入、主键冲突时再直接读，两次都不在事务里；本 Task 用到它之前，在 t07 的连接队列上跑一次真实的并发保留与消费（t07 omp 设计审查第 18 条）。

- t07 的连接队列在库自己开的事务里（不经模块的 `withLibTransaction`）一律拒绝模块的 `read`、`write`（t07 实现审查第 2 条，有用例）。本 Task 的社交注册由库在自己开的事务里建账号，而扣码要与建账号同一个事务（ADR 0060 决策 6、ADR 0063）：先用探针定一个“加入库开的事务”的入口（例如在库的事务开始处登记这次事务的序号），再放开。

- t07 的装配把库的 `emailAndPassword.password.hash`、`verify` 换成了模块的密码函数，但它们不经模块的哈希限额（t07 实现审查第 4、5 片第 5 条）。本 Task 若用到库自己的密码路径，先把这两个函数接上限额，否则绕开 `site.accounts` 输出 20。

第七轮探针（2026-11-25，Opus 规划子代理；库 1.7.27、`bun:sqlite`、开着外键、装配取 master 上 t07 的代码；报告 [`evidences/better-auth-spike-7.txt`](evidences/better-auth-spike-7.txt)，结果行 [`evidences/better-auth-spike-7-out.txt`](evidences/better-auth-spike-7-out.txt)）。要点：

- 删会话时外键把令牌的会话字段置空，库就不再查会话，访问令牌照用；在删会话的同一个写事务里先按会话或按账号撤令牌、删授权码再删会话，就都失效（实测，回滚也一起回滚）。
- 授权中途登录：库的后钩子用不上 t07 自己的发会话端点；做法是把库签过名的授权参数包成 `continue` 令牌，按模块时钟判 10 分钟。会话缺站点同意时库照样发授权码，要由挂载层先挡。
- 社交注册与扣码同一事务：加一个“加入库开的事务”的入口后，扣码、建账号、资料、同意同时提交或回滚；一次性码上并发的社交注册、社交与密码注册抢同一个码都只成一个（实测）。
- 全库自增 id 下库的一次性检查不成立：并发的 `reserveVerificationValue` 全部成功，同一份 DPoP 证明能换两次令牌，库的管理接口能建出 `private_key_jwt` 客户端；授权码的消费是好的。会话 id 不复用（AUTOINCREMENT）。
- 社交流程：库的 state Cookie 是 5 分钟（`Max-Age=300`），要配成 600 秒；到期由自家流程记录按模块时钟判；库把回调地址里的 `error` 参数原样转出，站点只认钩子记下的码；库的几个错误码是内部文字换下划线得来的，升级时可能变。

开发者 2026-11-25 定（规划子代理列的问题，都按推荐）：

1. 凡是结束站点会话（登出、结束单个会话、改角色、管理员结束全部会话、清理过期会话），在那次会话里发出的 OAuth 令牌与授权码一起作废。
2. 自己改密码时按账号撤掉全部 OAuth 令牌与授权码，当前站点会话本身保留。
3. 社交注册只收上游验证过的邮箱（Google 要 `email_verified` 为真，GitHub 要已验证的主邮箱）；不满足时按“上游没给邮箱”处理。
4. 关联上游时不要求上游邮箱与账号邮箱相同。

主会话按推荐定的（只影响细节）：跳转码另加 `social_cancelled`（在上游取消）与 `social_failed`（上游出错或回调带了站点不认的错误）；缺站点同意的人发起授权时带去 `/consent?continue=<续接令牌>`，与登录同一套续接（t10 的 `/consent` 页要多认这个参数）；保持自增 id，不提供 DPoP 与 `private_key_jwt`，令牌端点拒收带 `DPoP` 头的请求，站点的管理接口只许建 `client_secret_basic` 与 `none` 的客户端。

## 下一步

无。留给别的 Task 的：前端的社交登录、注册、关联与解绑页面，以及授权确认页、站点同意页（t10，失败码见合同包的 `SOCIAL_ERROR_CODES`）；部署时配 Google、GitHub 的客户端 id 与密钥（开发者的账号注册）。

## 实施进度

实现在 worktree `.worktree/w00037-t08-social-oauth`（分支 `feat/w00037-t08-social-oauth`，从 Work 分支 `f8480b04e` 开）。计划与设计审查的处理见 [`plan.md`](plan.md)；omp 的设计审查已回（有效 14 条），处理见计划文末“设计审查（omp）的处理”：多数落在第 5 到 9 片，`purge` 删 `sessionId` 为空的令牌一条与第 2、3 片 omp 实现审查的修正同一个提交。

第 1 片（合同包）已提交（`bf3d6f5aa`，10 个文件，新建 `oauth.ts`、`social.ts`）：合同包与它的使用方类型检查与测试都过，`governance:check` 过，3 条变异都被抓到。

- 与计划不同、接受的：落点码按 `site.accounts` 输出 23 是 12 个（计划写 9 个）；`continue` 与确认页的 `request` 在 schema 里只要求是字符串、不限长度（不合格要照常登录，schema 一拒就成了 `validation_failed`；长度由服务端判，请求体另有 16 KiB 上限）；另导出了计划没列的几样（`IDENTITY_AUTH_PREFIX`、`PageQuery`、`USERINFO_CLAIMS`、`ID_TOKEN_CLAIMS`、`oauthAuthorization` 路径等）；包的 `AGENTS.md` 的“t08 往哪里追加”换成现在的放法。
- 实现者定、写进 Spec 的：客户端名字 1 到 100 个码点（`site.oauth-provider` 输入一节）；确认页回的主机名带非缺省端口；社交发起只有登录与注册可带 `continue`、关联不带（`site.accounts` 输出 11）。
- 给后面几片的：`SocialStartRequest` 是联合类型，服务端先按 `intent` 分支再用那一支的 schema 判，`fields` 才有意义；`:provider` 不是两个上游之一时回 `not_found` 还是 `provider_disabled` 合同没定，第 8 片定；`oauth_client.*` 审计的对象 id 用 `oauthClient` 表的数字 id；`createdAt` 用 `toISOString()` 的写法。给 t10：`SOCIAL_ERROR_CODES` 多了五个码，文案目录要补。

第 2 片（`0002` 迁移、库的装配、签名钥启动检查、客户端密钥哈希）已提交（`f82c645a3`，19 个文件）：账号与使用方的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，5 条变异都被抓到；相邻版本在干净克隆里跑过（上一个版本取 `bf3d6f5aa`，在跑过 `0002`、建好签名钥的数据目录上能启动并就绪）。主会话没有另跑。

- 首次启动要写账号库（没有活钥时建一把）：合同测试“清理任务在服务启动后先跑一次”原来先迁移、再在进程外占着写锁启动，现在会以 `start_failed` 失败；实现者把准备步骤改成先起一次再停，断言不变。主会话接受：只在全新数据目录又被进程外占着写超过等锁上限时出现，重启即可；已写进 `site.oauth-provider` 输出 17，同一句写明旧公钥列 30 天（库的宽限期）。
- 实现者定、主会话接受的：库的装配改收 `conn`（`postLogin.shouldRedirect` 与 `customUserInfoClaims` 要经队列读库）；`testing/oauth.ts` 提前到本片建了最小版本；客户端密钥存成“固定前缀加密钥”的 SHA-256、base64url（库改缺省时已登记的客户端不受影响，变异也分得出）；`disabledPaths` 另关了缺省就关着的两条；签名钥是否过期按系统时间判（库挑钥按系统时间）；`alg` 为空的钥也当作不是 RS256 拒绝；寿命不拨系统时钟，读行里的到期减创建（P11 不做）。
- 没验证的：`postLogin` 与 `customUserInfoClaims` 的行为（第 6 片）；`customUserInfoClaims` 若在库自己开的事务里被调会被队列拒绝，第 6 片核对；上一个版本在这个数据目录上做账号读写（登录）没有用例（`site.operations` 验收 2 的登录已标 planned）。

第 3 片（撤销接缝与清理）已提交（`3bb82cf7d`，16 个文件）：新建 `oauth/revoke.ts`（按会话、按账号、按账号加客户端、按客户端、按到期会话五个撤销函数，与清理用的删过期行），删会话的那组函数先撤后删，改密码按账号撤（函数改名 `endOtherSessionsRevokingAllOAuth`），清理任务在一个写事务里撤到期会话的、删到期会话、删过期的码与令牌。账号与使用方的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，4 条变异都被抓到；主会话重跑账号包测试与类型检查通过。

- 实现者定、主会话接受的：源码守卫比计划宽，凡改 `oauthAccessToken` 或删 `verification` 的 SQL 只许在 `revoke.ts`（清理删过期行的函数也因此放在那里）；包内要调用户信息的账号用 `addOAuthUser`（`customUserInfoClaims` 要资料行）。
- 没有单独用例的：`create-admin` 与“请求里发现会话到期当场删”两条路，都经同一个 `endAllSessions`、`endSession` 撤。
- 给后面几片的：停用客户端调 `revokeOAuthForClient`，撤销授权调 `revokeOAuthForGrant`，都在自己的写事务里；清理会删按模块时钟到期的 `verification` 行（含库的社交 state 行），拨模块时钟的用例要留意。

第 2、3 片的实现审查已开（2026-11-25，范围 `bf3d6f5aa..3bb82cf7d`）：Opus 先审；omp 等设计审查那一份跑完再开。

Opus 那轮的修正已提交（`d4ae39ae5`，7 个文件）：处理表第 1、3、4、5 条落地（[`plan.md`](plan.md) 文末“实现审查（第 2、3 片）的处理”）。账号与使用方的测试与类型检查、`governance:check` 都过，主会话重跑通过；4 条变异里 3 条被抓到，“去掉 `gracePeriod`”照过（库的缺省也是 30 天，行为不变；改成 7 天、60 天时用例失败）。审查者的实验对当前代码重跑：经 `handler` 到得了的“方法加路径”从 56 个降到 10 个，9 个是对外的，`/sign-out`、`/revoke-sessions` 等都是 404。

- `disabledPaths` 由库导出的 `getEndpoints` 按同一份选项算出端点表，减去对外要的（`auth.ts` 的 `LIBRARY_PUBLIC_ENDPOINTS`）、只供服务端调用的与带参数的。带参数的关不掉（库逐字比路径），现在只有 `GET /reset-password/:token` 经 `handler` 到得了，只靠挂载白名单挡；主会话接受：它读一次性凭据后跳转、不写库，用例钉着这份名单，库新加这类端点时失败。实现者提的“改用 `onRequest` 钩子按方法加路径判 404”不做（多一套机制，收益只有这一条）。
- 实现者另改的：锁下抛错的子进程原来经 `handler` 调 `/update-user`，现在那条关成 404，改调授权端点（它写授权码，写锁下照样抛出、被认成库不可用）。
- 给第 5 片的（实现者对库的 `handler` 实测）：库对 HEAD 一律回 404，挂载层要把 HEAD 当 GET 转给库；库也接受 `POST /callback/<id>` 与 `POST /oauth2/authorize`，挂载层按方法挡；`/callback/<任意 id>` 库都接，挂载层只放开放了的上游。可以直接用 `LIBRARY_PUBLIC_ENDPOINTS` 登记白名单。`//token`、`/TOKEN`、`/%74oken`、`/token;x` 等写法库都回 404，`/./token`、`/x/../token` 被规范成 `/token`。
- 给第 8 片的：`revoke.test.ts` 照库 1.7.27 的写法造了一行社交 state，库改了 state 的形状时那三条用例要跟着改。

第 4 片（管理员登记与管理 OAuth 客户端）已提交（`01f288d33`，8 个文件）：新建 `oauth/clients.ts`（`checkRedirectUri`，两套按种类的规则）、`admin/oauth-clients.ts`（登记经库的 `adminCreateOAuthClient`、开在 `withLibTransaction` 里与操作者复核和审计一起提交；列表、改动、换密钥用自家 SQL，经 `adminWrite`；停用时同一事务撤令牌与码）。账号、合同包与使用方的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，6 条变异都被抓到；主会话重跑通过。主会话另补一个提交（`568e98972`）：客户端列表项带数字 `id`，审计记录的对象 id 能对上列表里的客户端（实现者提出两者对不上）；`site.oauth-provider` 输出 16 跟着改。

- 实现者定、主会话接受的：库的请求体 schema 拒收（`VALIDATION_ERROR`）也映射成 `redirect_uri_invalid` 并记 `identity.oauth_client_rule_drift`（交给库的属性里只有回调地址是外来的，名字已由合同包先判）；路由选项上有一个可选的 `checkRedirectUri`，缺省是真规则，只有包内测试换它来造“库拒收”（自家规则比库严，真实输入造不出）；改动的审计参数是 `{properties: "name,redirectUris,disabled"}`（审计参数只能是标量），写进 `site.admin` 输出 8；改或换密钥一个不存在的客户端回 `not_found`；停用只在由启用变停用时撤；回调地址规则比 Spec 字面多出的几处（协议名不分大小写、`localhost.` 与 `[::ffff:127.x]` 算回环、`app.localhost` 不算、`127.1` 不算回环）都与库一致，写进 `site.oauth-provider` 输入一节。
- 没有单独用例的：登记时“认过身份之后、库的事务之前操作者被降级”（写法与 `adminWrite` 相同，在库的事务里先调 `requireLiveAdmin`）。`client_secret_post` 这条变异合同现在抓不到，换码端点第 5 片才挂。
- 给第 5 片的：`checkRedirectUri` 只判写法，按登记值匹配（回环不比端口）另写，可复用 `clients.ts` 里取原始主机的写法；种类按 `tokenEndpointAuthMethod === "none"` 判；库的 `adminCreateOAuthClient` 按系统时间判会话过期，合同测试把模块时钟拨到会话过期之后再登记会落成 500。

第 5 片按计划拆成两段。5a（挂载层、发现文档、公钥、令牌端点、入口挂载、合同的测试客户端）已提交（`51c7f962e`，19 个文件）：账号、合同包、入口与合同测试的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程；主会话重跑通过。5 条变异 4 条被抓到，“公钥的 HEAD 带了正文”写不出能看到的改坏（Hono 与 `Bun.serve` 都丢掉 HEAD 的正文），断言留着；另做的两条替代变异（HEAD 原样交库、去掉显式的 `Content-Length`）都被抓到。

- 实现者定、主会话接受的：POST 授权端点不是表单类型回 404；令牌端点不是表单类型回 400 `invalid_request`（库自己回 415 且不是 RFC 6749 的形状，也免得换个编码绕过去掉 `resource` 那一步），去掉 `resource` 后重新编码表单（值不变，字面编码可能变）；请求体上限在白名单之前，白名单外的超大请求回 400；发现文档的签名算法用常量（启动检查保证表里只有这一种）；`LIB_BASE_PATH` 取合同包的 `IDENTITY_AUTH_PREFIX`；合同包 `claims_supported` 的静态类型原来推成 `never[]`，改成两组字面量的并集；发现文档缺用户信息、公钥、撤销地址时启动失败；HEAD 与 GET 比头时不算 `Date`、`X-Request-Id`；验收 2 合同只断言 404，“是本模块的 404”放包内。
- 给 5b 的：授权端点的改写替掉 `mount.ts` 里 `authorizeEndpoint` 的那一行交库。库对带会话 Cookie 的授权 POST 做来源检查（没有 Origin 回 403），主会话定：POST 读成 `URLSearchParams` 后改成同样参数的 GET 请求交库（授权端点的 GET 本来就允许跨站，POST 不该多一道）。

5b（授权端点的第 1 步与改写、续接与登录、确认页接口）已提交（`8d3e14d08`，19 个文件）：四个包的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，6 条变异都被抓到（续接留 `ba_param`、确认接口回库的原始地址两条只有包内抓得到：库照样收下、合同造不出那个时机）；主会话重跑通过。

- 实现者定、主会话接受的：授权端点的逻辑在 `mount.ts` 的 `authorizeEndpoint`，没另建 `authorize.ts`；`resolveContinue` 是 async、多收一个 `secret`（库的验签是 async、用库上下文的密钥）；浏览器 `fetch` 发起授权时库回 200 加 JSON，一律改成 302 加改写后的 `Location`；POST 只读表单体、忽略查询串（与库一致）；确认接口遇到库的登录页或站点同意页时写成站点的绝对地址（schema 要 `^https?://`）；`IdentityOverrides` 加了 `wrapOAuthConsent`，产品不传，只给包内测试在“接口判完、库还没判”之间插入停用或改回调地址，交库的仍是真的库（不换判断，与 t07 用队列交错造时序同一类）；库错误页上码表之外的码归 `client_not_found` 并记 `identity.oauth_library_error_page`。
- Spec 跟着补的：输出 14“再次同意时再发一个授权码，前一个不作废”（实测）。`prompt=consent` 对免确认的客户端也显示确认页，与输出 13 的“总显示”一致。
- 给第 6 片的：`response_type=token` 时库把错误放在回调地址的片段里跳回（`#error=unsupported_response_type`），第 2 步要先挡；`prompt=select_account` 现在落到错误页兜底，第 2 步的 `prompt` 校验之后应碰不到。

设计审查与第 2、3 片 omp 实现审查要的 `purge` 删 `sessionId` 为空的访问令牌，主会话单独提交（`121d6a8e5`）：包内用例在另一条连接上删会话行（外键置空令牌的 `sessionId`），跑 `purge` 后那个令牌 401、别的照用；变异（去掉这个条件）被抓到。账号包与使用方的测试与类型检查通过。

第 6 片（授权的其余规则、站点同意门槛、用户信息过滤、撤销改写、DPoP、注册与补交同意的续接）已提交（`681afe946`，12 个文件）：四个包的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，7 条变异都被抓到（`email_verified` 取库的列、撤销不看 `token` 非空两条只在包内：合同里造不出那种数据，前一条的合同抓手在第 8 片）；主会话重跑通过。

- 实现者实测出、偏离计划、主会话接受的：
  - 只把输出 3 列的 11 个参数交库（`authorize-request.ts` 的 `AUTHORIZE_PARAMS`），别的照 RFC 6749 忽略。计划算的“4096 编码后约 5462”只在参数名少时成立：库签名时每个参数名加一项 `ba_param`，几百个短参数名能把续接令牌撑到约 2 万字符，登录后续接悄悄丢掉（omp 设计审查第 5 条的同一类）。改后最长 5942。以后要让库看到新参数，同时加进这张表并重算长度（`continue.ts` 的注释写了算法）。
  - 入口长度按原样与按标准编码重写后各判一次（库签名的是重写后的写法，原样没编码的 `/` 重写后是 3 个字符）。
  - `request` 与 `request_uri` 都带时回 `request_not_supported`。
- Spec 跟着改的：输出 3（没列的参数被忽略；长度两种都算）、输出 10（`token` 为空或出现多次回 `invalid_request`）、输出 12（补交同意不因花的时间再按 `max_age` 要求登录，库在签名前已去掉满足了的 `max_age`）。
- 没改、记下的：撤销不存在的令牌回空体，别的客户端的令牌库回 `null`，都是 200；JSON 格式的撤销请求库回 415，原样透出；401 的 `WWW-Authenticate` 库另列 DPoP 的算法，没动。
- 只有包内用例的：邮箱待补的账号的用户信息（合同造不出，等第 8 片）、`max_age` 与会话按模块时钟到期。
- 给第 7 片的：测试辅助的 `authorize`、`grantTokens` 多了可选的 `scope`；合同的 `FlowSite` 多了 `dataDir`，重启进程用。

第 7 片（已给的授权的列表与撤销，失效与重启的合同用例）已提交（`40a02a627`，6 个文件）：四个包的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，4 条变异都被合同用例抓到（撤销授权只删同意记录、列表不排除免确认的、结束全部会话不撤、停用不撤）；主会话重跑通过。

- 实现者定、主会话接受的：撤销一项授权删这个账号对这个客户端的全部同意记录（库先查后插，并发同意能留两行，只删一行时下一次授权不再显示确认页）；登记后被改成免确认的客户端，授权不列、按 id 撤销回 `not_found`；停用的客户端的授权照常列出；列表按 id 倒序。这几句写进了 `site.oauth-provider` 输出 15。
- 会话到期一条合同只证明得了“到期后失效”：拨钟要拨过会话时长（至少 2 天），库按系统时间写的令牌与码的到期时刻都早于模块时钟，`purge` 把它们一起当过期删掉；“只撤到期那次会话的”在包内 `revoke.test.ts`。合同里客户端要在拨钟前登记、用免确认的客户端，都是为了绕开库按系统时间判。

第 4 到 7 片（`d4ae39ae5..40a02a627`）的实现审查已开（2026-11-25）：Opus 先审，omp 同时在后台审同一份说明。

Opus 那轮的修正已提交（`0f942f893`，4 个文件）：处理表第 1、2、5 条落地（[`plan.md`](plan.md) 文末“实现审查（第 4 到 7 片）的处理”）。账号、入口与合同测试的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过，3 条变异都被抓到；主会话重跑通过。审查者的实验对当前代码重跑：编码路径都是本模块的 404，重复 `client_id` 的撤销从 200 变成 400。

- 实现者判得比处理表宽、主会话接受的：撤销端点照库 1.7.27 的 `normalizeClientAuthenticationParameters` 整套判法先判（另含 `client_assertion` 重复、任何认证头加表单凭据、密钥与断言并存），只判 Basic 时 `Bearer` 加表单密钥会留下同一类问题；多出来的几种没有单独的用例。Spec 输出 10 补了这句。
- 没改、接受的：发现文档的编码写法（`/.well-known/%6Fpenid-configuration`）照样回发现文档。回的是模块自己的文档、不经库，没有绕过什么。

第 8 片（社交登录与关联）已提交，两个提交：`16ab11785`（最小链路：上游配置、`0003`、仿真上游、登录意图的发起与回调，23 个文件）、`bda38f0e9`（关联与其余用例：`social/hooks.ts`、`social/upstream-name.ts`、关联钩子复核会话、上游令牌不落库，14 个文件）。五个包的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程；主会话重跑通过。7 条变异 6 条被抓到；“`mapSocialError` 信地址里的自家码”是等价变异：按 omp 第 9b 条，地址里带 `error` 时在 `callback.ts` 就判完、走不到 `mapSocialError`，自家码也不在它的表里（`OWN_CODES` 那一行留着，防库以后出同名的码）。

- 实现者定、主会话接受的：`genericOAuth` 插件总是装上，只给开放的上游加配置；仿真上游用 `node:http`，扣住令牌请求是每个上游一个先进先出队列；关联复用改密码的限流计数；`:provider` 不是两个上游之一回 `not_found`；地址里带 `error` 时仍交库（让库认出另一个浏览器的回调、删掉 state 行与 Cookie），结论只看地址；注册意图在第 9 片接上之前发起时是程序错误（500）。
- 实测出、Spec 跟着改的：库插 `account` 失败留下的孤行会在 1 分钟内挡住同一账号或同一身份的关联（计划 3.10 的设计），`site.accounts` 输出 15 改成“至多挡住之后 1 分钟”。
- 重放：登录意图第一次回调成功时库删掉自己的 state 行，第二次在库那里就落到 `social_state_invalid`；本站的认领是第二道，只有“另一个浏览器先用掉”那条用例分得出两道。
- 没做的：回调查询串的长度上限（计划 3.6：超过时落点页带 `social_state_invalid`），交给第 9 片。
- 给第 9 片的：注册要接 `start.ts` 的 `register` 分支、`FlowPayload` 的注册内容、`callback.ts` 的 `succeed` 对 `newUser` 的落点、`hooks.ts` 里 `inLibraryTransaction()` 为真的分支（改成 `joinLibTransaction`，加 `user.create.before`、`session.create.before` 的注册检查）；`providers.ts` 记进帧里的 `upstream.emailVerified` 给注册钩子拒未验证的邮箱；`link.test` 的“会话晚结束”与两条并发用例按库的两步排队卡时序，注册路径若改变库的步数要回头核。

第 9 片（社交注册）的第一个子代理读完材料后因 Opus 周额度用完中断，没留下改动；额度重置后重派。已提交，两个提交：`be054a682`（9a：`joinLibTransaction`；`register.ts` 拆出扣码、复核占用、写资料几个函数，密码注册与社交注册共用；建用户前钩子扣码、建账号前钩子写资料并经 `claimUpstreamName` 认上游名字、建会话前钩子拒已关联的身份；发起与回调的注册分支；回调查询串上限，13 个文件）、`0529d318e`（9b：合同的社交注册一组、验收 14 的两种先后、查询串上限的用例，5 个文件）。本片五个包的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，5 条变异都被抓到；主会话重跑本片五个包通过。实现者跑 `--with-consumers` 时 neuro-book 包有两条在负载 12 以上超时，单独重跑都过，本片没碰那个包。

- 实现者定、主会话接受的：社交注册建出的账号不存上游头像（与密码注册一致）；“扣码改用普通 `write`”那条变异由队列的误用检查先挡住（库的事务里不带帧直接 `write` 被拒），回滚用例跟着失败。
- 实测出、Spec 跟着改的：上游的邮箱没验证过、又等于已有账号的邮箱时，库按邮箱找人那一步早于钩子，结果是 `email_taken`（`site.accounts` 输出 14 写明先于 `social_email_missing`）；回调查询串的 8192 上限写进时序一节。
- 给第 10 片的：社交注册的账号没有密码，解绑的 `last_login_method` 要算进去；`me/identities` 读到的上游名字是注册时的原样写法；`account.create.before` 按 `inLibraryTransaction()` 分注册与关联；关联与注册的排队用例依赖库在事务之前查两次库（升级清单“社交注册的先后”）。

第 10 片（上游身份的列表与解绑、没有密码的账号的合同用例、Smoke 标注、升级清单核齐）已提交（`ae385153d`，12 个文件）：四个包的测试与类型检查、`governance:check`、`docs:check` 都过，合同测试连跑 3 遍都过、没有留下进程，2 条变异都被抓到；另做的“数剩下的登录方式挪到写事务之前”只有包内并发用例抓得到。主会话重跑时负载 23，`operations.test.ts` 的创建管理员 10 秒没跑完（算密码哈希）并连带收口失败，负载降到 7 后单独重跑该文件，54 条全过，归为负载。

- 升级清单核对：实现者用脚本逐行查“用例”一列点名的文件与用例名，前后都没有缺的（只核名字，没核条数）；对着计划 3.15 补了四行（`updateUserInfoOnLink` 与 `overrideUserInfo` 缺省关、一次性检查、同一上游可关联多个身份由约束限成一个、上游身份的存法），改了三行，修了三处引用不存在行名的注释。计划验收映射里的“同一个码并发换四次”原来没有用例，本片补在 `provider.test.ts`。
- Spec 跟着补的：`site.accounts` 输出 24（列表按关联的先后；解绑不是自己的上游身份的 id 回 `not_found`，含密码那一行的 id）。
- 晋升时要补的：两份 Spec 的证据一节要指向 Smoke 标在的 `oauth-provider.test.ts`、`accounts-social.test.ts` 与新的 `accounts-identities.test.ts`（代码合入 master 之后再写，免得链接不存在）。

第 8 到 10 片的实现审查（处理见计划文末“实现审查（第 8 到 10 片）的处理”）：Opus 那 5 条的修正已提交（`be09202c9`，10 个文件）：发起时库没有这个上游（`PROVIDER_NOT_FOUND`，按码判）回 503 `unavailable`；登录意图的社交发起在调库之前计入登录的来源地址计数，与密码登录共用额度；社交注册的邮箱不合本站规则时同没验证过；`identities.ts` 与 `0003` 注明导入要写名字行；包内补三个回调并发到认领。实现者自报：五个目标包的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过，4 条变异都被抓到；`test:affected --with-consumers` 选中 28 个包，被它自己的 50 分钟上限截停在最后 5 个，dev-panel、nb-host、nb-story 有几条 5 秒超时（负载 12 到 27，与本次改动无关）。发起被 `provider_disabled` 或 `validation_failed` 拒掉的不计入限流，同密码登录“字段不合格的请求不计入”。omp 那 3 条要改的接着修（fix4），两次修正合在一起由主会话重跑验证。

omp 那 3 条的修正已提交（`0dc6d182d`，14 个文件）：
- 封禁与建会话交错：新加迁移 `0004`，`session` 表插入前的触发器拒绝被封禁账号的会话（只看 `banned = 1`；`banExpires` 恒为空，触发器拿不到模块时钟，将来加封禁到期要重写它）。社交回调按 `SQLITE_CONSTRAINT_TRIGGER` 认出、落到 `account_banned`；`session` 表上只能有这一个触发器，`schema.test.ts` 核对。密码登录与注册本来在自己的写事务里复核，触发器对它们是第二道。实现者列了“建会话的路 × 封禁落在哪一步”的表，只有社交登录、社交注册在“查与插之间”那格改前会留下会话；社交注册那格没有单独用例，与社交登录同一个触发器、同一个 catch。
- Google 配 `requireIdTokenVerification`：发现文档缺 issuer 或 `jwks_uri` 时库不建这个上游，发起回 503 `unavailable`；仿真上游加了 `omitJwksUri`。
- 解绑只数密码与所在上游开放着的其它身份，列表照旧。
- 实现者自报：账号与站点各包的测试与类型检查都过，`governance:check` 过，合同测试连跑 3 遍各 334 条都过，4 条变异都被抓到。`--with-consumers` 带进来的别的包有 5 项失败，都与本次无关：dev-panel 的 herdr 与 nb-story 的子进程超时在 master 上也失败，nb-markdown 与 neuro-book 的几条单独重跑通过；`ProvidersPage.dom.test.ts` 在分支上失败、master 上通过，因为分支起点之后 master 改过 models 插件，合入前变基后复核。
- 社交注册意图下被封禁时，码随情形不同：已关联的旧账号被封时是 `social_failed`，不建号、不扣码；刚建的账号在库建会话之前被封时是 `account_banned`，账号与扣码已提交（账号确实建成了）。不统一，写进 `site.accounts` 输出 13。

主会话在 `0dc6d182d` 上重跑（负载降到 2 后）：五个目标包的测试与类型检查都过，合同测试 334、账号模块 598、账号合同包 113、站点服务 156，没有失败。

晋升前逐句核对（Opus，[`evidences/promotion-check-opus.txt`](evidences/promotion-check-opus.txt)）：`site.oauth-provider` 全文与另两份 Spec 带“（planned）”的句子。
- 没实现 2 句：`site.accounts` 输出 18 的旧站码保留次数与期限（t12）、注册页预填邀请码（前端），标记留着。
- 与字面不一致 4 处。三处改了 Spec 措辞：只有开放了的上游的回调可达；回环主机不分大小写；`identity_taken`、`identity_exists` 只作跳转参数，挪出 409 那行。另一处改实现：用户信息 401 的 `WWW-Authenticate` 带着库的 DPoP 质询，去掉。
- 没有测试 26 句（PKCE 必须、码过期、`max_age` 补交、RFC 6750 错误码、存储副作用等），连同 DPoP 一起交给 fix5 补。
- `site.accounts` 的 Smoke 补了社交注册。

fix5 已提交（`a2a759944`，13 个文件），主会话收尾一个（`1a8cb8004`）：
- 用户信息端点回 401 时 `WWW-Authenticate` 只留 `Bearer` 质询：按 RFC 7235 的结构拆头，保留 RFC 6750 的 `error`，拆不出时只回 `Bearer` 并记 warn。
- 26 句缺测试的都补了用例。T11（建签名钥撞写锁）只确认了 `start_failed`，撞在哪一步是读代码推断的；T12 靠把会话行的到期改到系统时间之前，因为库按系统时间判。
- 补出来与 Spec 字面不一致的三处，按实测改了 Spec：
  - 不带 PKCE 校验值回 `invalid_request`，校验值不对或不带时码都不被用掉（主会话把两条用例补到断言之后照常换出）；
  - 不带令牌时 401 的质询里不带错误码，只在响应体（RFC 6750 第 3.1 节）；
  - 注册意图下已关联的账号在库查过封禁之后被封，落点仍是 `identity_taken`，因为注册意图在建会话之前就拒了旧账号（主会话把实现者留在仓库外的交错用例改成这个断言放回）。
- 变异 5 条都被抓到。T8 的变异造不出来（`max_age` 是库在跳转前去掉的），用 T10 代替。
- 主会话在 `1a8cb8004` 上重跑：五个目标包的测试与类型检查都过（合同测试 344、账号模块 608、合同包 113、站点服务 156），`governance:check` 过。
