---
schema: nbook.task/v2
taskId: t08-social-login-and-oauth-provider
status: planned
updated: 2026-11-24
---

# 社交登录与对外 OAuth 服务

## 目标与范围

Google 与 GitHub 登录（通用 OAuth 插件、仿真上游、注册顺序、关联与解绑），对外 OAuth 服务（端点白名单、客户端登记、授权码加 PKCE、授权确认、令牌），库私有的协议包进自家合同。

合同：[`site.accounts`](../../../../../docs/specs/site/accounts.md) 的输出 11 到 16，[`site.oauth-provider`](../../../../../docs/specs/site/oauth-provider.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

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

Spec 改写稿与实施计划由规划子代理起草（草稿在仓库外），主会话审过、写进 `site.oauth-provider` 与 `site.accounts`、`site.admin` 后，按高风险后端做设计审查（Opus 先审，omp 在后台）。

## 实施进度

实现在 worktree `.worktree/w00037-t08-social-oauth`（分支 `feat/w00037-t08-social-oauth`，从 Work 分支 `f8480b04e` 开）。计划与设计审查的处理见 [`plan.md`](plan.md)；omp 的设计审查在后台（`.worktree/w00037-t08-review`），回来后另行处理。

第 1 片（合同包）已提交（`bf3d6f5aa`，10 个文件，新建 `oauth.ts`、`social.ts`）：合同包与它的使用方类型检查与测试都过，`governance:check` 过，3 条变异都被抓到。

- 与计划不同、接受的：落点码按 `site.accounts` 输出 23 是 12 个（计划写 9 个）；`continue` 与确认页的 `request` 在 schema 里只要求是字符串、不限长度（不合格要照常登录，schema 一拒就成了 `validation_failed`；长度由服务端判，请求体另有 16 KiB 上限）；另导出了计划没列的几样（`IDENTITY_AUTH_PREFIX`、`PageQuery`、`USERINFO_CLAIMS`、`ID_TOKEN_CLAIMS`、`oauthAuthorization` 路径等）；包的 `AGENTS.md` 的“t08 往哪里追加”换成现在的放法。
- 实现者定、写进 Spec 的：客户端名字 1 到 100 个码点（`site.oauth-provider` 输入一节）；确认页回的主机名带非缺省端口；社交发起只有登录与注册可带 `continue`、关联不带（`site.accounts` 输出 11）。
- 给后面几片的：`SocialStartRequest` 是联合类型，服务端先按 `intent` 分支再用那一支的 schema 判，`fields` 才有意义；`:provider` 不是两个上游之一时回 `not_found` 还是 `provider_disabled` 合同没定，第 8 片定；`oauth_client.*` 审计的对象 id 用 `oauthClient` 表的数字 id；`createdAt` 用 `toISOString()` 的写法。给 t10：`SOCIAL_ERROR_CODES` 多了五个码，文案目录要补。

第 2 片（`0002` 迁移、库的装配、签名钥启动检查、客户端密钥哈希）已提交（`f82c645a3`，19 个文件）：账号与使用方的测试与类型检查、`governance:check` 都过，合同测试连跑 3 遍都过、没有留下进程，5 条变异都被抓到；相邻版本在干净克隆里跑过（上一个版本取 `bf3d6f5aa`，在跑过 `0002`、建好签名钥的数据目录上能启动并就绪）。主会话没有另跑。

- 首次启动要写账号库（没有活钥时建一把）：合同测试“清理任务在服务启动后先跑一次”原来先迁移、再在进程外占着写锁启动，现在会以 `start_failed` 失败；实现者把准备步骤改成先起一次再停，断言不变。主会话接受：只在全新数据目录又被进程外占着写超过等锁上限时出现，重启即可；已写进 `site.oauth-provider` 输出 17，同一句写明旧公钥列 30 天（库的宽限期）。
- 实现者定、主会话接受的：库的装配改收 `conn`（`postLogin.shouldRedirect` 与 `customUserInfoClaims` 要经队列读库）；`testing/oauth.ts` 提前到本片建了最小版本；客户端密钥存成“固定前缀加密钥”的 SHA-256、base64url（库改缺省时已登记的客户端不受影响，变异也分得出）；`disabledPaths` 另关了缺省就关着的两条；签名钥是否过期按系统时间判（库挑钥按系统时间）；`alg` 为空的钥也当作不是 RS256 拒绝；寿命不拨系统时钟，读行里的到期减创建（P11 不做）。
- 没验证的：`postLogin` 与 `customUserInfoClaims` 的行为（第 6 片）；`customUserInfoClaims` 若在库自己开的事务里被调会被队列拒绝，第 6 片核对；上一个版本在这个数据目录上做账号读写（登录）没有用例（`site.operations` 验收 2 的登录已标 planned）。
