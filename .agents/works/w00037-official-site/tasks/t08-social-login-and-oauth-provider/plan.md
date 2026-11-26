# w00037 t08 社交登录与对外 OAuth 服务：实施计划（草稿）

路径按 worktree 写（分支由主会话定，从 Work 分支开）；Spec、ADR、Task 记录读主工作区的。“探针”指 `/tmp/nbsite-spike/` 里第六、七轮与本段补跑的一次性脚本（库 1.7.27、`bun:sqlite`、外键开着、装配取 master 上 t07 的代码），没进仓库。依赖库内部行为的地方都注明证据：**实测**（探针跑过）、**读源码**（只读了 `node_modules`）、**没核实**。Spec 改写稿里行末标〔未实测〕的句子，第 9 节逐条给了探针或用例。计划由 Opus 规划子代理起草（只读、没开子代理），待主会话审定；第 10 节是要定的事。

## 1. Context

为什么做：官方站重写的最后一块后端能力。做完时，用户能用 Google、GitHub 登录、注册、关联与解绑；管理员能登记外部应用，外部应用能按 OpenID Connect 的授权码流程用官方站的账号登录。前端 t10 的 B3 社交部分、B4 关联、B7（授权确认、登录续接、已授权的应用、客户端页）等这里的合同与实现。

依据：

- 合同：`site.oauth-provider` 全部（按改写稿 `oauth-provider.draft.md`）；`site.accounts` 输出 11 到 16、23、24 与改写表 `accounts-admin.changes.md` 里的各句（含输出 4、6、13、15 与副作用一节的追加）；`site.admin` 输出 2、3、4、8 与分页一段里标（planned）的部分。
- ADR 0060（Better Auth、库的端点不可从外部到达、默认行为收紧、注册码与建账号同一个事务）、ADR 0063（账号的写由自家路由做，库负责会话与协议；t08 要提供“加入库开的事务”的入口）、ADR 0059、ADR 0061。
- 探针：第六轮（发现文档、id_token、用户信息、失效、确认与登出、可达端点）、第七轮八问（`evidences/better-auth-spike-7.txt`），第二段补跑的 `spike8-ddl.ts`（0002 的逐表结构，结果 `out8-ddl.txt`），以及第三段按设计审查补跑的 `spike9.ts`（问 9 到问 14，结果 `out9.txt`，结论在 `evidences/better-auth-spike-7.txt` 末尾“第三段补探”）。
- t07 的实际代码（master）：`auth.ts`、`db/connection.ts`、`session.ts`、`app.ts`、`register.ts`、`login.ts`、`change-password.ts`、`module.ts`、`migrations/0001_init.sql`、包说明的升级清单；t07 计划文末各轮处理的节（以代码为准）。
- t10 计划 3.2 的 t08 清单与第 4 节 S1、S2、S11、S12、S13。

开发者已定（不再讨论）：按标准 OIDC；签发者是站点地址；结束任何站点会话都撤掉在那次会话里发出的 OAuth 令牌与授权码；自己改密码时按账号撤、当前会话保留；社交注册只收上游验证过的邮箱；关联不要求邮箱相同。主会话按推荐定的：跳转码加 `social_cancelled`、`social_failed`；缺站点同意时用同一套续接去 `/consent?continue=`；保持自增 id，不提供 DPoP 与 `private_key_jwt`，令牌端点拒收带 `DPoP` 头的请求。

工作方式：编码子代理在 worktree 里按第 5 节切片实施，每片一个提交、自跑该片的验证命令；Spec 改动由主会话先在 master 上改。本 Task 是安全边界，又碰内核时序（库的事务、加入入口）与数据格式（`0002`），实现审查按高风险后端的快速审查（第 5 节末写明哪几片之后交）。技术选型与架构取舍按 `implementation-planning` 要另请一个只拿到目标的子代理出一版独立设计：本段不许开子代理，留给主会话在设计审查时做。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 对外 OIDC 服务方 | `@better-auth/oauth-provider` 1.7.27，精确版本，加进 `nb-site-identity` 的依赖；选项见 3.4 | ADR 0060 已定；第六、七轮在 t07 的装配上跑通完整流程（实测） | 手写授权服务器：协议部分不手写是 ADR 0060 的出发点 |
| id_token 签名与公钥 | `better-auth/plugins` 的 `jwt`：RS256、2048 位，`jwt.issuer` 设成站点 origin | 缺省 EdDSA；只认 RS256 的客户端多，且同一个库中途换算法时库仍用旧钥签（第六轮问 2 实测），所以第一版就定 | `jose` 自签：要自己管钥的存放与轮换 |
| 社交登录 | `better-auth/plugins` 的 `genericOAuth`：Google 用发现文档，GitHub 写明三个地址并自带 `getUserInfo` | 地址可配，仿真上游才接得上（第七轮问 8 实测）；GitHub 的主邮箱与“已验证”要从 `/user/emails` 取 | 库的 `socialProviders.google`、`github`：上游地址写死，测试接不上仿真上游 |
| 发现文档 | 自家路由，从 `auth.api.getOpenIdConfig()` 取端点地址，能力字段按 Spec 写死 | 库的文档里有内省、登出、`client_secret_post` 等不提供的能力，配置去不掉（第六轮问 1 读源码与实测） | 改写库的响应：库加字段时会漏出去；白名单输出不会 |
| 续接令牌 | 把库签过名的授权参数整串 base64url 包一层；验签用库导出的 `verifyOAuthQueryParams`，10 分钟按模块时钟看签名参数里的 `ba_iat` | 不多一种密钥用途；签名、篡改与库的到期由库判（第七轮问 1 实测） | 自家 HMAC 另签一份：多一个密钥用途，与库签的参数各判一次 |
| 社交流程的到期与单次 | 自家表 `identity_social_flow`：模块时钟判 10 分钟，条件 `UPDATE … RETURNING` 认领 | 库按系统时间判、先查后删不是原子的，state Cookie 缺省只有 5 分钟（第七轮问 7 实测） | 只靠库的 state：测试拨不到，并发回调能各成一次 |
| 客户端密钥 | 库的 `storeClientSecret: {hash}` 换成自家的 SHA-256（base64url），`generateClientSecret` 用 `randomBytes(32)` | 自家的换密钥要与库的校验用同一个函数；库自带的换密钥端点要求客户端有主人（读源码 `rotateClientSecretEndpoint`），管理员登记的没有 | argon2：密钥是 256 位随机串，不需要慢哈希，也不该占密码的哈希限额 |
| 仿真上游 | 测试支持包新子路径 `@notnotype/neuro-book-test-support/oauth-upstream`：`Bun.serve` 起在回环上，RS256 用 `node:crypto` | 被测进程是另一个进程，只能真的起一个 HTTP 服务；包内测试与合同测试共用一份 | `msw`、`nock`：只拦本进程的请求；各写一份：两份仿真会走样 |
| 合同测试里验 id_token | `node:crypto` 的 `createPublicKey({format: "jwk"})` 加 `verify("RSA-SHA256")`，约 30 行 | 合同测试包只许导入合同包、`typebox`、平台模块与测试支持；`jose` 是被测系统带进来的依赖 | 放开 `jose`：要改导入表，换来的只是少 30 行 |
| 请求与响应的 schema | `typebox`（合同包已在用） | 同 t07 | 无 |

替换已有实现：无。t07 的四个删会话函数签名不变、只加撤销（3.5）。

## 3. 关键设计

### 3.1 `packages/nb-site-identity-contract/src/`：合同包（第 1 片，可以先于实现单独合入）

新文件 `oauth.ts`、`social.ts`；改 `errors.ts`、`paths.ts`、`account.ts`、`index.ts`。写法照现有文件（`strictObject`、`literalUnion`、同名 `type`）。前端 t10 计划 3.2 的 t08 清单逐条对应：

1. **社交发起**（清单第 1 条）：`SocialStartRequest` 是按 `intent` 分的联合：`{intent: "login", continue?}`；`{intent: "register", username, displayName?, registrationCode, inviteCode?, termsVersion, overseasStorage, continue?}`（字段规则取 `RegisterRequest` 的同名属性，没有邮箱与密码）；`{intent: "link", currentPassword?}`。`SocialStartResponse = {url}`。路径 `identityPath.socialStart(provider)`、`IDENTITY_PATHS.meIdentities`、`identityPath.meIdentity(id)`；`IdentityListResponse = {items: IdentityItem[]}`（`IdentityItem` 已有）。
2. **续接**（第 2 条）：`CONTINUE_PARAM = "continue"`；`LoginRequest`、`RegisterRequest`、`ConsentRequest` 各加可选的 `continue`（字符串，至多 8192 个字符；超了按不合格处理，见 3.7）；`LoginResponse`、`RegisterResponse` 加可选的 `continueUrl`；`POST me/consent` 的响应改成 `ConsentResponse = MeResponse 加可选的 continueUrl`。页面地址常量 `OAUTH_PAGES = {login: "/login", siteConsent: "/consent", consent: "/oauth/consent"}`、`OAUTH_REQUEST_PARAM = "request"`、`OAUTH_ERROR_PARAM = "error"`。
3. **确认页**（第 3 条）：`OAUTH_SCOPES = ["openid","profile","email"]`；`OAuthAuthorizationQuery = {request}`、`OAuthAuthorizationResponse = {clientName, redirectHost, scopes}`、`OAuthDecisionRequest = {request, accept}`、`OAuthDecisionResponse = {redirectUrl}`。失败码 `authorization_expired`（410）、`client_not_found`（404）、`redirect_uri_invalid`（400）、`client_public`（409）追加进 `CODES_WITHOUT_FIELDS` 与 `IDENTITY_FAILURE_STATUS`（只追加，`ErrorBody` 随之覆盖它们）；另导出 `OAUTH_ERROR_PAGE_CODES = ["client_not_found","redirect_uri_invalid"]`（错误页查询参数能出现的码）。
4. **授权列表**（第 4 条）：`GrantItem = {id, clientName, scopes, createdAt}`、`GrantListResponse = {items}`；路径 `IDENTITY_PATHS.meGrants`、`identityPath.meGrant(id)`。
5. **客户端管理**（第 5 条）：`OAUTH_CLIENT_TYPES = ["confidential","public"]`；`OAuthClientItem = {clientId, name, redirectUris, type, skipConsent, disabled, createdAt}`；`OAuthClientListQuery`（`site.admin` 的分页参数，不带筛选）、`OAuthClientListResponse = PageResponse(OAuthClientItem)`；`CreateOAuthClientRequest = {name, redirectUris(1 到 5 个), type, skipConsent}`、`CreateOAuthClientResponse = {client, clientSecret: string | null}`；`PatchOAuthClientRequest`（四个可选属性，至少一个）；`RotateSecretResponse = {clientSecret}`；路径 `IDENTITY_PATHS.adminOAuthClients`、`identityPath.adminOAuthClient(clientId)`、`identityPath.adminOAuthClientRotate(clientId)`；`ClientIdParams`（客户端 id 的写法：库生成的 32 个大小写字母，规则写成 `^[A-Za-z0-9_-]{1,64}$`，不合时 `validation_failed`）。回调地址的字段规则（schema 只管至多 500 个字符与类型，其余由服务端的 `checkRedirectUri(uri, type)` 判，不合回 `redirect_uri_invalid`；规则与库登记时的两套一致，见 3.9）：都不含片段、用户信息、空白与控制字符；机密客户端只许 `https://` 且主机不是回环（`127.0.0.0/8`、`[::1]`、`localhost`）；公开客户端许 `https://` 且主机不是回环，或 `http://` 且主机恰为 `127.0.0.1`、`[::1]`、`localhost`（端口任意），不许 `https://` 的回环与自定义协议。
6. **标准端点与用户信息**（给合同测试，前端不用）：`OAUTH_ENDPOINT_PATHS`（第 3.6 节的表）、`OIDC_DISCOVERY_PATHS`；`UserInfoResponse`（`sub` 必有，其余五个可选，`additionalProperties: false`：合同测试用它判“不出现别的字段”）；`DiscoveryDocument`（Spec 输出 2 列的字段，严格对象：多出内省、登出、DPoP 的键就不合）。
7. **社交码**：`SOCIAL_ERROR_CODES` 追加 `social_cancelled`、`social_failed`、`registration_code_invalid`、`invite_code_invalid`、`username_taken`；`social_cancelled`、`social_failed` 只作跳转参数，加进 `REDIRECT_ONLY_CODES`、不进 `IDENTITY_FAILURE_CODES`，另外三个本来就在 HTTP 码表里；`contract.test.ts` 里写死“社交落点码是七个”的用例改成九个。`SOCIAL_CALLBACK_PATHS`（两个上游回调地址）。`MetaResponse` 不变。

`contract.test.ts` 加：四个 OAuth 失败码（第 3 条）都有状态、`ErrorBody` 收它们；三种 `SocialStartRequest` 各自拒收别的意图的字段；`UserInfoResponse` 拒收 `picture`；`DiscoveryDocument` 拒收 `introspection_endpoint`；编译期用例：经公开入口给 `OAuthClientItem` 赋值。

### 3.2 `packages/nb-site-identity/migrations/0002_oauth.sql` 与 `0003_social.sql`：表与迁移

`0002` 只放库的表，随第 2 片建、第 3 片之后的审查定稿；`0003` 只放自家的两张社交表，随第 8 片建、第 10 片之后的审查定稿（两张表的列只有写社交代码时才看得清，例如下面的 `UNIQUE (user_id, provider)` 是设计审查第 11 条才加的）。两份都在定稿之前可改：还没发布过。

**库的 8 张表与 15 个索引逐字抄** `spike8-ddl.ts` 打出来的结构（实测：t08 的装配下 `getMigrations` 要建 `jwks`、`oauthClient`、`oauthResource`、`oauthClientResource`、`oauthRefreshToken`、`oauthAccessToken`、`oauthConsent`、`oauthClientAssertion`，`toBeAdded` 为空，库的四张表不加列；`genericOAuth` 不加表）。与 0001 同一个规则：只把 `"id" integer not null primary key` 换成 `"id" integer primary key autoincrement`，别的一个字不改，不加 `STRICT`（t07 第 10 节第 11 条）。没有调用方的三张（`oauthResource`、`oauthClientResource`、`oauthClientAssertion`）与 `oauthRefreshToken` 也建：库的结构检查要它们（没核实缺了会不会 `SCHEMA_MISMATCH`，按“建全”做，免得以后补迁移）。文件头写明来源、只改了哪一处、为什么全部自增（会话 id 不复用；问 6 实测）。

**自家的两张表**（`0003`；`STRICT`、自增；指向账号的外键照 0001 文件头的约定不写 `ON DELETE`：账号不能删除，误删由外键拒绝）：

- `identity_upstream_name`：`user_id INTEGER NOT NULL REFERENCES "user"(id)`、`provider TEXT NOT NULL CHECK (provider IN ('google','github'))`、`upstream_account_id TEXT NOT NULL`、`name TEXT NOT NULL`（至多 200 个字符，写入前截断）、`linked_at TEXT NOT NULL`（模块时钟）；约束 `identity_upstream_name_identity UNIQUE (provider, upstream_account_id)` 与 `identity_upstream_name_one_per_provider UNIQUE (user_id, provider)`（“每个上游至多一个身份”由约束判，不靠先查后插；3.10）。上游账号的名字与关联时间放这里，不往库的 `account` 表加列（t07 定）。和库的 `account` 行按 `(providerId, accountId)` 对上，解绑时在同一个事务里删两边。
- `identity_social_flow`：`state TEXT NOT NULL UNIQUE`（库给的 state）、`intent TEXT NOT NULL CHECK (intent IN ('login','register','link'))`、`provider TEXT NOT NULL`、`payload TEXT NOT NULL`（JSON：注册的内容、继续地址；不含密码）、`session_id INTEGER`（关联意图发起时的会话）、`created_at TEXT NOT NULL`、`used_at TEXT`；索引 `(created_at)` 给清理用。

`src/migrations.ts` 加第二条（第 2 片）与第三条（第 8 片）；`schema/better-auth-baseline.sql` 换成新装配下库导出的结构；`db/schema.test.ts` 的“迁移里库的表只差 AUTOINCREMENT”扩到 0002；`migrations.test.ts` 加“删掉 id 最大的访问令牌、授权后新令牌 id 更大”。

### 3.3 `src/db/connection.ts`：加入库开的事务

加 `joinLibTransaction(fn)`，照探针原型（`/tmp/nbsite-spike/spike7-connection.ts` 第 361 到 386 行，实测）：要求没有本模块的标记、库说在事务里、方言确有一个正开着的事务；库的事务上下文对象第一次加入时记下当时的序号（`WeakMap`），同一个上下文对象再来时序号必须相同，否则抛 `IdentityQueueMisuseError`。回调里的 `read`、`write` 直接在这个事务里执行。文件头的“重入”一段补一句：只有库在自己的事务里调到的钩子用它（3.10 的两个建账号前钩子），模块的路由仍只经 `withLibTransaction` 开事务。

另导出 `inLibraryTransaction(): Promise<boolean>`（读库的异步上下文），给钩子判断“这次是在库的事务里被调到的（社交注册），还是不在（关联）”：在就 `joinLibTransaction`，不在就普通的 `write`（问 4、问 8 实测两种路径各是哪一种）。

用例：照问 4.7 的两条（漏出去的活儿、根本不在库的事务里）；加入之后的写随库的事务回滚；在 `withLibTransaction` 开的事务里调它直接执行（已有标记）。

### 3.4 `src/auth.ts`：库的装配

在 `identityAuthOptions` 上加（包内测的 `createTestAuth` 同一份，结构基准随之变）：

- `jwt({disableSettingJwtHeader: true, jwt: {issuer: <站点 origin>}, jwks: {keyPairConfig: {alg: "RS256", modulusLength: 2048}}})`（第六轮实测）。
- `oauthProvider({loginPage: "/login", consentPage: "/oauth/consent", scopes: ["openid","profile","email"], grantTypes: ["authorization_code"], requireOpenId: true, idTokenExpiresIn: 3600, storeClientSecret: {hash: clientSecretHash}, generateClientSecret, customUserInfoClaims})`。`codeExpiresIn`、`accessTokenExpiresIn` 用缺省的 600 与 3600（实测），写进注释并在包内测核对，库改缺省时用例失败。`customUserInfoClaims` 按范围加 `preferred_username`（profile）与 `email_pending`（email），读 `identity_profile`（第六轮问 3 实测）。动态注册保持缺省关。另配 `postLogin: {page: "/consent", consentReferenceId: () => undefined, shouldRedirect}`：`shouldRedirect` 经模块的 `read` 调 `consentRequiredIn`（session.ts，同意门槛的唯一一份规则），缺站点同意时为真；库在认出会话之后、看确认之前调它，为真时带人去 `/consent?<签名参数>`，`prompt=none` 时自己跳回 `interaction_required`（问 9 实测；它不在库的事务里被调）。
- `genericOAuth`：只为配置里开放了的上游加（3.12）；两个上游都 `pkce: true`、`disableImplicitSignUp: true`；Google 的 `mapProfileToUser`、GitHub 的 `getUserInfo` 把上游账号的名字与“邮箱是否已验证”记进社交流程的上下文（3.10）。GitHub 的 `getUserInfo` 取主邮箱（`primary`），把它的 `verified` 原样交给库；不在这里拒未验证的，拒在注册钩子里（登录已关联的身份时邮箱不参与认人，第 9 节 P12）。
- `account.accountLinking`：保留 `disableImplicitLinking: true`，加 `allowDifferentEmails: true`（定 4）与 `trustedProviders: ["google","github"]`（不设时库对上游邮箱未验证的身份拒绝关联，link-account.mjs:68 到 71，设计审查读源码确认）；`updateUserInfoOnLink` 保持缺省关（关联不改显示名与头像）。
- `account.updateAccountOnSignIn: false`：已关联身份登录时库不再把上游令牌写回 `account` 行（问 11 实测）。上游令牌一律不存：站点只用上游认人、之后不调上游的接口；建行与改行时由 3.10 的两个钩子置空，库没有“不存”的选项（只有加密存的 `encryptOAuthTokens`）。
- `advanced.cookies.state.attributes.maxAge = 600`（问 7.5d 实测；缺省 300 秒时 10 分钟的合同实际只有 5 分钟）。
- `disabledPaths`：第六轮问 6 表里 B、D 类的全部路径，加库在基路径下的两份发现文档与 `/token`（实测 404，且不影响服务端经 `auth.api` 调用）。这是第二道；第一道是 3.6 的挂载白名单。
- `databaseHooks` 合并：t07 的 `session.create.before` 不变（第 10 节第 5 条选 b 时它多一个判断，见 3.10）；加 `user.create.before`、`user.update.before`、`account.create.before`、`account.update.before`（3.10）。

**签名钥在启动时备好**（`module.ts` 的 `assembleIdentity`，在结构检查之后；`src/oauth/signing-key.ts`）：读 `jwks` 表，有非 RS256 的行就以程序错误失败（入口按 `start_failed` 收口，防第六轮问 2 的换算法坑）；没有行时调 jwt 插件的 `createJwk` 建一把（放在启动时是为了不让第一次签发时两个并发请求各建一把，P10）。有行时取没过期的 RS256 钥里 `createdAt` 最新的一把（库签发时就挑这一把），用 `better-auth/crypto` 的 `symmetricDecrypt` 与库上下文的 `secretConfig` 试解私钥：解不开（会话密钥换过）就在一个写事务里把它的 `expiresAt` 设成当前时刻减 1 毫秒，再 `createJwk`，记一行 warn `identity.signing_key_rotated`（只记新旧 kid）。旧公钥按库的宽限期（`jwks.gracePeriod` 缺省 30 天）留在公钥地址里，重启前签发、没到期的 id_token 仍验得过（问 12 实测；第 10 节第 3 条的推荐 a，开发者不同意时改这一段）。这里依赖的库行为（按 `createdAt` 挑活钥、过期钥不签但在宽限期内列出、私钥用 `secretConfig` 加密）进升级清单。

`clientSecretHash`、`generateClientSecret` 放 `src/oauth/client-secret.ts`，自家换密钥（3.9）与库的校验共用。

### 3.5 `src/oauth/revoke.ts` 与 `src/session.ts`：撤销接缝

`revoke.ts` 五个同步函数，都在调用方的写事务里执行，SQL 照问 2、问 3 实测的写法：

```ts
revokeOAuthForSession(tx: IdentityTx, sessionId: number, nowMs: number): void
revokeOAuthForUser(tx: IdentityTx, userId: number, nowMs: number): void
revokeOAuthForGrant(tx: IdentityTx, userId: number, clientId: string, nowMs: number): void
revokeOAuthForClient(tx: IdentityTx, clientId: string, nowMs: number): void
revokeOAuthForExpiredSessions(tx: IdentityTx, nowMs: number): void  // 会话的 expiresAt <= nowMs
```

每个做两步：给 `oauthAccessToken` 里对应的、`revoked IS NULL` 的行写上 `revoked = libDate(nowMs)`；删 `verification` 里 `json_valid(value)`、`$.type = 'authorization_code'` 且对应字段相等的行（码的 `value` 里 `userId`、`sessionId` 是字符串，比较前 `CAST(… AS INTEGER)`；按授权与按客户端另比 `$.query.client_id`）。读码的 JSON 字段是库的存法，进升级清单。

`session.ts` 的四个删会话函数签名不变、多一个 `nowMs` 参数，**先撤后删**（删了会话，外键把令牌的会话字段置空，就再也找不到它们；问 2 实测）：

- `endSession(tx, sessionId, nowMs)`：`revokeOAuthForSession` 再删行。
- `endOtherSessions(tx, userId, keepSessionId, nowMs)`：只有改密码调它（`change-password.ts`），按定 2 改成 `revokeOAuthForUser` 再删其它会话。函数名与注释写明“连当前会话里发出的令牌也撤”。
- `endAllSessions(tx, userId, nowMs)`：`revokeOAuthForUser` 再删。封禁、改角色、管理员重置、结束全部、`create-admin` 都经它（已查调用方：`admin/users.ts` 四处、`commands/create-admin.ts` 一处）。
- `purgeExpiredSessions(tx, nowMs)`：先 `revokeOAuthForExpiredSessions`（一条 `UPDATE … WHERE "sessionId" IN (SELECT …)` 与一条按 `sessionId IN (…)` 的码删除，SQL 在 `revoke.ts`），再删会话（问 2 的“清理任务先撤再删”实测）。

调用方跟着传 `clock.now()`。文件头“结束会话的一组函数”一段改成写明先后与理由。`architecture.test.ts` 加源码守卫：写 `oauthAccessToken` 的 `revoked`、按 `authorization_code` 删 `verification` 的 SQL 只出现在 `revoke.ts`（问 2 的建议）。

### 3.6 `src/oauth/mount.ts`、`src/oauth/discovery.ts`：挂载层

两个 Hono 子应用，由 `createIdentityModule` 一起返回（3.13）。

**`/api/identity/auth` 下的“方法加路径”白名单**（`oauth` 子应用；登记的先后就是表的先后，最后一条兜底）：

| 方法 | 路径 | 处理 |
|---|---|---|
| GET（含 HEAD） | `/oauth2/authorize` | 3.8 先判，再交库，改写库的跳转 |
| POST | `/oauth2/token` | 带 `DPoP` 头回 400 `invalid_request`（RFC 6749 的 JSON 形状、`Cache-Control: no-store`），否则交库；库抛出的错误因链上有 `SQLiteError` 且它的 `code` 是 `SQLITE_CONSTRAINT_FOREIGNKEY` 时（换码与删会话撞上，问 10），回 400 `invalid_grant` 并记一行 `identity.oauth_token_raced` |
| GET、POST | `/oauth2/userinfo` | 交库；200 的 JSON 只留 `sub`、`preferred_username`、`name`、`email_pending`、`email`、`email_verified`，`email_pending` 为真时再去掉后两个，`email_verified` 恒写成 `false`（站点不验证邮箱；不取库的 `emailVerified` 列，问 11）；401 没有 `WWW-Authenticate` 时补 `Bearer`（第 9 节 P9） |
| POST | `/oauth2/revoke` | 交库；请求带了非空的 `token`、库回 400 且 `error` 是 `invalid_request` 时改成 200 空体（问 3 实测，只按码） |
| GET（含 HEAD） | `/jwks` | 交库 |
| GET | `/callback/google`、`/callback/github` | 3.10 的回调；只登记开放了的上游 |
| 任何 | 其余 | 404，`ErrorBody` 的 `not_found`（与账号子应用的兜底同一个形状） |

交库就是 `auth.handler(c.req.raw)`；库按完整路径认端点，子应用挂在前缀下不改写地址。令牌、用户信息、撤销的响应一律补 `Cache-Control: no-store`。这一层不经来源头检查（Spec：标准端点不受约束）。

**大小上限**：这几个端点不要会话，任何人都能发（设计审查第 14 条：站点没有全局上限，`Bun.serve` 缺省收到 128 MB）。`oauth` 子应用在白名单之前挂自己的 `bodyLimit({maxSize: 16 * 1024})`（`hono/body-limit`，定长与分块都按读到的字节数判，同账号子应用的 `bodySizeLimit` 一样换掉 `c.req.raw`，之后交库的仍是 `c.req.raw`），超了回 400 `{"error":"invalid_request"}`、`Cache-Control: no-store`；GET 的查询串（授权端点、回调）超过 8192 个字符时：授权端点按 3.8 第 2 步跳回 `invalid_request`，回调落点页带 `social_state_invalid`。合同加两条：令牌端点 17 KB 的表单得 400 `invalid_request`；查询串 8193 个字符的授权请求跳回 `invalid_request`。

**`/.well-known` 子应用**：`GET /openid-configuration` 与 `GET /oauth-authorization-server` 回同一份 `discovery.ts` 生成的文档；其余 404。文档：端点地址取 `auth.api.getOpenIdConfig()` 的 `issuer`、`authorization_endpoint`、`token_endpoint`、`userinfo_endpoint`、`jwks_uri`、`revocation_endpoint`（随库的配置变），能力字段按 Spec 输出 2 写成常量，`claims_supported` 由合同包的 `UserInfoResponse` 与 id_token 字段（含 `acr`）拼出，`id_token_signing_alg_values_supported` 取 `jwks` 表里正在用的钥的算法（启动时已保证是 RS256）。启动时生成一次、之后不变；`Cache-Control: public, max-age=300`。

**白名单的守卫**（包内测 `oauth/mount.test.ts`）：遍历 `auth.api` 里全部带 `path` 的端点，不按前缀过滤（照第六轮问 6 的做法取路径），每个端点按 GET、HEAD、POST、PUT、PATCH、DELETE 各发一次到挂好的入口：“方法加路径”不在上表里的必须 404。它防的是白名单被放宽（写成 `app.all("/oauth2/*")`、兜底改成交库）：库加的新端点本来就落到兜底 404。另有点名的用例：`POST /admin/oauth2/create-client`、`POST /admin/impersonate-user`、`GET /token`、`GET /get-session`、`POST /sign-out`、`GET /error` 都 404（ADR 0060 要库的管理端点不可达）。

### 3.7 `src/oauth/continue.ts`：续接，及登录、注册、补交同意的改动

```ts
continueTokenFromLibraryRedirect(location: string): string | null      // 库跳转地址的查询串整段 base64url
resolveContinue(token: string, nowMs: number, consumer: "login" | "consent"): string | null  // 合格时回站内继续地址
```

`resolveContinue`：超过 8192 个字符、解不出、`verifyOAuthQueryParams` 不过（签名或库按系统时间的到期）、`nowMs - ba_iat > 600_000` 时回 null。合格时去掉库的五个签名字段 `sig`、`exp`、`ba_iat`、`ba_pl`、`ba_param`（`ba_param` 是被签名的参数名列表，每个名一项，问 9 查出）；`consumer` 是 `login` 时另去掉 `prompt` 里的 `login` 与 `max_age`（这次登录刚满足了它们），是 `consent` 时不去（补交同意不是重新登录，改写稿输出 12；问 9 实测补交后续接得码）。回 `"/api/identity/auth/oauth2/authorize?" + 剩下的参数`。五个字段名进升级清单（问 1、问 9 实测）。

- `login.ts`：请求的 `continue` 在登录成功之后才解（失败的登录不碰它），合格时响应加 `continueUrl`。社交登录与注册成功后的继续地址见 3.10。
- `register.ts`：同上（`consumer: "login"`：注册也建立了新会话）。
- `me.ts` 的 `POST me/consent`：成功后按 `consumer: "consent"` 解，响应是 `ConsentResponse`。

### 3.8 `src/oauth/authorize.ts`：授权端点

按这个先后（每一步写明是谁判的）：

1. **客户端与回调地址**（`src/oauth/clients.ts` 的 `checkClientAndRedirect(tx, clientId, redirectUri)`，自家 SQL 读 `oauthClient` 的 `clientId`、`disabled`、`redirectUris`、`applicationType`）：没有、停用 → 302 到 `/oauth/consent?error=client_not_found`；回调地址与登记的都不匹配 → `?error=redirect_uri_invalid`。匹配规则照库的 `findRegisteredRedirectUri`：逐字相等；公开客户端（`applicationType` 为 `native`）的 `http` 回环地址去掉端口后相等也算（问 13 实测库这样做；第 10 节第 6 条推荐 a）。规则与库同一份，库在第 1 步之后就不会因为这两样带人去它的错误页；万一去了，按第 4 步的错误页一支处理。`redirectUris` 的存法（JSON 文本）与 `applicationType` 列进升级清单（第 9 节 P5）。
2. **库不支持、合同要拒的参数**（这时回调地址已核对，可以跳回）：查询串超过 8192 个字符 → 跳回 `invalid_request`（客户端的 `state` 太长时失败在客户端那边可见，不在登录之后因为续接令牌超长而悄悄丢掉）；带 `request`、`request_uri` → 跳回 `request_not_supported`、`request_uri_not_supported`；`prompt` 有 `none`、`login`、`consent` 之外的值，或 `none` 与别的值并存 → `invalid_request`；去掉 `claims` 参数再交库（第 9 节 P6 先探库会不会按它往 id_token 里放资料）。跳回地址带 `state` 与 `iss`，自己拼。后三样库的请求 schema 也判、给的码相同（设计审查第 10 条读源码），这里自判是为了合同的码不随库的 schema 变，注释写明“与库重复”。
3. **会话**：`sessions.read(cookie, "use")`（模块时钟判到期、封禁；到期时带清除 Cookie）。两种情况把请求的 `Cookie` 头去掉再交库，让库当作没有会话：没有会话（库按系统时间可能还认它）；有 `max_age` 且 `now - 会话建立时间 > max_age × 1000`（模块时钟；库按系统时间算，测试拨了钟它就算不对）。`SessionIdentity` 为此加 `createdAtMs`。缺站点同意不在这里判，交库的 `postLogin`（3.4）。
4. **交库**，`Location` 交 `src/oauth/library-location.ts` 的 `rewriteLibraryLocation(location, query)` 归类改写（确认接口 3.9 用同一个函数）：
   - 库的登录页 `/login?<签名参数>` → `/login?continue=<令牌>`；
   - 库的 `postLogin` 页 `/consent?<签名参数>`（缺站点同意）→ `/consent?continue=<令牌>`；
   - 库的确认页 `/oauth/consent?<签名参数>` → `/oauth/consent?request=<令牌>`；
   - 库的错误页 `/api/identity/auth/error?error=<码>`（前端不认这个地址）→ `/oauth/consent?error=<码>`，码由 `errorPageCode(query)` 给：先用第 1 步的 `checkClientAndRedirect` 按请求里的 `client_id`、`redirect_uri` 判，不合格就用它的码；合格（库多出别的原因）时按库的 `error` 参数查表：`invalid_client`、`client_disabled`、`unauthorized_client` → `client_not_found`，`invalid_redirect`、`invalid_request` → `redirect_uri_invalid`，其余 `client_not_found` 并记一行 `identity.oauth_library_error_page`（只记库的码）。表进升级清单；
   - 其余（带码跳回、库判出的别的错误跳回）原样。`prompt=none` 时缺站点同意由库跳回 `interaction_required`（问 9 实测），不改写码。

### 3.9 自家 OAuth 接口

**`src/oauth/consent-api.ts`**（确认页，`app.ts` 登记）：都要会话（`requireSession`，受同意门槛约束）。

- `GET oauth/authorization?request=`：解令牌（同 3.7 的验签与 10 分钟，不改参数）→ 不合格 `authorization_expired`；签名参数里的 `client_id`、`redirect_uri` 交 3.8 第 1 步的 `checkClientAndRedirect`，没有或停用 `client_not_found`、回调地址已不匹配 `redirect_uri_invalid`；回 `{clientName, redirectHost: new URL(redirect_uri).host, scopes}`（问 1.2c 原型实测）。
- `POST oauth/authorization {request, accept}`：同样的三步判，然后 `auth.api.oauth2Consent({body: {accept, oauth_query: <签名参数>}, headers: {cookie}})`（问 1.2c、1.2d 实测；不经库的 HTTP 端点）。库在确认里重跑整套授权，给的 `url` 不一定是跳回客户端（问 14 实测）：一律先经 3.8 第 4 步的 `rewriteLibraryLocation` 归类：跳回客户端的原样回 `{redirectUrl}`；登录页、站点同意页回包好的 `/login?continue=`、`/consent?continue=`；库的错误页（三步判与调库之间客户端被停用、回调地址被改；同意时库的码是 `client_disabled`、`invalid_redirect`，拒绝时一律 `access_denied`）不回地址，回失败 `client_not_found`（404）或 `redirect_uri_invalid`（400），码由 `errorPageCode` 按签名参数重判（拒绝时也分得出），与三步判自己判出时的结果相同，页面只有一种情况要处理。合同加“GET 与 POST 之间改回调地址”“之间停用”两条，同意与拒绝各一（走三步判那一支）；“三步判之后、调库之前才改”在包内用注入造。
- 这个接口的同意门槛（`requireSession`）不能省：配了 `postLogin` 后，库给确认页的签名参数带 `ba_pl`（发起时的会话 id），提交的会话就是它时库不再问 `shouldRedirect`，同一会话在打开确认页之后条款版本提高，库照样发码（问 9 实测），挡住它的只有这一道。

**`src/oauth/grants.ts`**：

- `GET me/grants`：`oauthConsent` 连 `oauthClient`，只取这个用户的、客户端不免确认的行（客户端登记之后被改成免确认的，旧同意记录还在，也不列），按 id 倒序；`scopes` 是库存的 JSON 数组文本（问 3.1 实测）。`createdAt` 取 `oauthConsent.createdAt`，是库按系统时间写的（确认端点用 `Date.now()`），与模块时钟不在一条时间线上：合同用例只断言格式与先后，不断言等于当时的模块时间。`OAuthClientItem.createdAt` 同理（库登记时写）。
- `DELETE me/grants/:id`：一个写事务：`isSessionLive` 复核 → `DELETE FROM "oauthConsent" WHERE "id" = ? AND "userId" = ? RETURNING "clientId"`，没有行回 `not_found` → `revokeOAuthForGrant`（问 3.2 实测）。不调库的 `delete-consent`（它不撤令牌）。

**`src/admin/oauth-clients.ts`**（照 `admin/registration-codes.ts` 的写法：`adminWrite` 复核操作者、审计同一个事务）：

- `POST admin/oauth-clients`：先按种类用 `checkRedirectUri(uri, type)`（`src/oauth/clients.ts`，3.1 的两套规则，照库的 `validateClientRedirectUri` 写，比库多拒自定义协议）判每个回调地址（`redirect_uri_invalid`）；`withLibTransaction` 里调 `auth.api.adminCreateOAuthClient({body: {client_name, redirect_uris, application_type: 机密 ? "web" : "native", token_endpoint_auth_method: 机密 ? "client_secret_basic" : "none", skip_consent, scope: "openid profile email", grant_types: ["authorization_code"], response_types: ["code"], require_pkce: true}})`，同一事务里复核操作者、写审计 `oauth_client.create`（参数：种类、是否免确认）。`application_type` 必须显式给：不给时库按 `web` 判，公开客户端的 `http://127.0.0.1:…` 登记不进去（问 13 实测）。只许这两种认证方式由我们决定、不交给库（第六轮实测库接受 `client_secret_post`）。库抛 `APIError` 且 `body.error` 是 `invalid_redirect_uri` 或 `invalid_client_metadata` 时回 `redirect_uri_invalid`（我们的规则先判过，走到这里说明两边的规则走样了，另记一行 `identity.oauth_client_rule_drift`），不落成 500；合同加一条“库拒绝的地址回 400 不是 500”（用 `https://localhost/cb` 之类两边都拒的，测自家先判；包内另用注入让自家规则放过，测映射）。`require_pkce` 对机密客户端是否生效，第 9 节 P8（设计审查读源码：`requirePKCE ?? true`）。
- `GET admin/oauth-clients`：自家 SQL，分页沿用 `admin/pagination.ts`（`anchor` 取当时最大的 `oauthClient.id`）。
- `PATCH admin/oauth-clients/:id`：改回调地址时按这个客户端的种类（`tokenEndpointAuthMethod` 为 `none` 是公开）用同一个 `checkRedirectUri` 判，不经库的 `checkOAuthClient`，所以这一步是 PATCH 唯一的一道（问 13：改成库不收的地址后，授权时库带去它的错误页）；自家 SQL 改 `name`、`redirectUris`（JSON 文本）、`skipConsent`、`disabled`、`updatedAt`；`disabled` 由假变真时同一事务里 `revokeOAuthForClient`（这样之后再启用，停用前的令牌也不复活；第 10 节第 4 条）；审计 `oauth_client.update`（参数：改了哪些属性的名字）。写库的表要有“存法契约”用例（同一个改动经库的 `adminUpdateOAuthClient` 与经自家 SQL，逐列比原始行、再经库读回），照 `db/library-rows.test.ts`。
- `POST admin/oauth-clients/:id/rotate-secret`：公开客户端 `client_public`；否则生成新密钥、`clientSecretHash` 后写回，审计 `oauth_client.rotate_secret`，响应带一次明文。

### 3.10 `src/social/`：社交登录、注册、关联

- **`flow.ts`**：流程表的三个操作——`createFlow(tx, …)`、`claimFlow(tx, state, nowMs)`（`UPDATE … SET used_at = ? WHERE state = ? AND used_at IS NULL AND created_at > ? RETURNING …`，问 7 实测）、清理（3.11）；和一个 `AsyncLocalStorage<SocialFrame>`：`{flowId, intent, provider, payload, ownFailure?, upstream?: {name, emailVerified}, userId?}`。帧只在回调处理里设；钩子取不到帧就抛程序错误（不是社交流程却走到库的建账号，说明有别的路径调了库的 `createUser`）。
- **`start.ts`**（`POST social/:provider/start`，`app.ts` 登记；来源头与请求体上限照常）：上游没开放 `provider_disabled`；按意图：
  - `login`：无额外检查。
  - `register`：照 `register.ts` 的先后判注册关闭、字段、限流（计入注册的来源地址计数：社交注册也是注册）、同意、注册码与邀请码可用、用户名没被占（只读事务，不扣码）；邮箱这时不知道，回调时判。`register.ts` 的 `precheck`、扣码与写资料拆成可复用的函数（第 9 片做）。
  - `link`：要会话并过同意门槛；有密码的账号要带对的当前密码（模块的校验函数、经哈希限额，限流照改密码），没有密码的免。库的密码路径不用：关联在库之外核对密码，所以 t07 留的“库的哈希不经限额”这条在本 Task 不需要接（升级清单加一条“库的密码端点经挂载层是 404”的用例守住）。
  - 带 `continue` 的（login、register）：`resolveContinue(…, "login")`，合格的继续地址存进流程的 `payload`，不合格照常发起。
  - 然后调库：`auth.api.signInSocial({body: {provider, callbackURL, errorCallbackURL, newUserCallbackURL, disableRedirect: true, requestSignUp: 注册时}})` 或 `auth.api.linkSocialAccount(...)`，三个回调地址是 `mount.ts` 里认的三个站内哨兵路径（不对外可达：回调处理只认它们）：`callbackURL` 是 `/__social_ok`，`newUserCallbackURL` 是 `/__social_new`（库建了账号时去这里，问 11 实测分得开），`errorCallbackURL` 是 `/__social_error`；从库给的 `url` 取 `state`，写流程表（关联意图记下会话 id），回 `{url}` 并转发库的 state Cookie。
- **`callback.ts`**（3.6 表里的回调）：`claimFlow`，认领不到 → 落点页带 `social_state_invalid`（意图按 state 查得到就用它的，查不到按登录）；关联意图另复核记下的会话还有效（模块时钟），不成立同样 `social_state_invalid`；然后在帧里 `auth.handler`，按响应判：
  - 跳到成功哨兵（`/__social_ok` 或 `/__social_new`）：落点（登录、注册：`payload` 里有继续地址就去那里，否则 `/`；关联：`/account`），转发库的会话 Cookie；登录意图另在一个写事务里记最近登录时间（帧里由 `session.create.before` 记下的 `userId`）。注册意图落到 `/__social_ok`（库认出这个上游身份已关联、直接登录了旧账号，没建账号）时按第 10 节第 5 条处理；推荐的 b 下这种情况在建会话之前就被拒，到不了这里，走到这里就是程序错误，记 error 并按 `social_failed` 处理。
  - 跳到失败哨兵、或库没跳转直接回 400 JSON（关联路径上钩子抛的错误，问 8 实测）：取库的错误码（地址里的 `error` 参数或响应体的 `code`），交 `mapSocialError(intent, libraryCode, frame.ownFailure)`。
  - 别的：`social_failed`，记一行 `identity.social_unexpected`（只记库的状态码与是否有 `Location`）。
  `mapSocialError` 只按码：帧里钩子记下的自家码优先；库的码与自家码同名的（地址参数能被旁人写）一律 `social_failed`；`state_mismatch` 等 state 类 → `social_state_invalid`；`access_denied` → `social_cancelled`；登录意图 `signup_disabled`、`account_not_linked` → `social_not_registered`，`BANNED_USER` → `account_banned`；注册意图 `account_not_linked` → `email_taken`，`email_not_found` → `social_email_missing`；关联意图 `account_already_linked_to_different_user` → `identity_taken`，`unable_to_link_account` → `social_state_invalid`；其余（含 `unable_to_get_user_info`、`invalid_code`）→ `social_failed`。这张表的库码全进升级清单，其中两个是库把内部文字换下划线得来的（问 8 读源码）。
- **`hooks.ts`**：
  - `user.create.before`：意图不是注册 → 记 `social_not_registered` 并抛；上游邮箱没验证 → 记 `social_email_missing` 并抛（定 3）；然后 `joinLibTransaction` 里一次 `write`：条件扣注册码（`UPDATE … RETURNING`）、复核邀请码、查用户名与邮箱，失败各记对应的码并抛；回改写后的行（用户名、显示名、`emailVerified: false`、角色 `user`）。
  - `account.create.before`：注册意图 `joinLibTransaction` 里写资料、同意、邀请归属、上游名字；关联意图普通 `write`（关联不在库的事务里，也不能包进事务：回调里有对上游的网络往返，事务里不许等它）里调 `claimUpstreamName(tx, {userId, provider, upstreamAccountId, name, nowMs})`。两条都返回 `{data: {accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null}}`：上游令牌不落库（问 11 实测）。判断走哪条用 3.3 的 `inLibraryTransaction()`，不按意图猜。
  - `claimUpstreamName`（`src/social/upstream-name.ts`）：“每个上游至多一个身份”与“一个上游身份只属于一个账号”由 `identity_upstream_name` 这张表在一个模块写事务里判，不靠先查库的 `account` 表（库的 `account` 行在钩子提交之后才插，两个关联并发时都看不到对方，设计审查第 11 条）。事务里查两种已有的行：同 `(user_id, provider)` 的（这个账号在该上游已有身份）与同 `(provider, upstream_account_id)` 的（这个上游身份已有主人）。一行算“在用”：有 `account` 行与它对得上，或 `linked_at` 在 1 分钟之内（可能是另一个还在进行的关联，库还没插 `account`）。在用的前一种记 `identity_exists`、后一种记 `identity_taken` 并抛；不在用的是孤行（钩子提交之后库插 `account` 失败、进程在两步之间退出留下的），删掉；然后插入。两个 `UNIQUE` 是兜底：撞上时按 `SQLiteError` 的 `code`（`SQLITE_CONSTRAINT_UNIQUE`）当作程序错误抛，不按约束的文字分码。包内用例：注入“钩子之后库插入失败”后再关联一次能成（孤行按 1 分钟判，用例拨模块时钟）；同一账号两个关联并发、两个账号关联同一个身份并发，各只成一个、码分别是 `identity_exists`、`identity_taken`。
  - `account.update.before`：关联意图时记 `identity_exists` 并抛：同一账号再关联它已有的同一个上游身份时，库找到已有的 `account` 行走 `updateAccount`，不调建账号前钩子（问 11 实测，默认装配下这次落到成功哨兵）；别的情况返回同上的置空令牌（`updateAccountOnSignIn: false` 下登录已不写回，这里是兜底）。
  - `user.update.before`：要改的数据里有 `emailVerified` 时改成 `false`。库在已关联身份登录时，若上游说已验证、邮箱与账号相同，会把它改成 `true`（link-account.mjs:277，问 11 实测：社交注册的账号第二次登录就变）；站点不验证邮箱，这一列恒为 `false`。用户信息端点另在挂载层恒写 `false`（3.6），两层都做。
  - 钩子抛 `APIError`（码同自家码），同时记进帧：库会把错误改写成自己的码或吞成 `unable_to_create_user`（问 4.1 实测），只信帧里的。
  - 社交注册的原子性：扣码、建账号、资料、同意一起提交或回滚（问 4.2、4.3 实测）；并发两个只剩一次的码只成一个（问 4.4 实测）。库在这个事务里只有 `createUser` 与 `createAccount` 两次带钩子的写，建会话在提交之后（设计审查读源码，回答第 11 节第 3 条）。
  - `session.create.before`（第 10 节第 5 条推荐 b）：t07 的那个钩子前面加一个判断：帧的意图是注册、而这次没调到 `user.create.before`（帧里没有它记下的 `userId`）时记 `identity_taken` 并抛，库跳到失败哨兵、不发会话、注册码不扣（问 11 的 [P9.3g] 实测）。
- **`identities.ts`**：`GET me/identities`：库的 `account` 行（`providerId` 是 `google`、`github`）连 `identity_upstream_name`；`DELETE me/identities/:id`：写事务里复核会话、确认这一行是自己的（否则 `not_found`）、数剩下的登录方式（有密码的 `credential` 行，或另一个上游身份），不够 `last_login_method`，否则同一个写事务里删 `account` 行与上游名字。
- **`meta`**：`providers` 改成按配置给。

### 3.11 清理任务

`Sessions.purge` 的写事务里依次：按会话撤到期会话的令牌与码、删到期会话（3.5）、删 `verification` 里 `expiresAt <= now` 的行（到期的授权码与库的 state 行；模块时钟在测试里比系统时间快，删得更早，与“模块时钟为准”一致）、删 `oauthAccessToken` 里 `expiresAt <= now` 的行、删 `identity_social_flow` 里 `created_at <= now - 10 分钟` 的行（问 7.2：被判过期的流程，库的 state 行留着）。一个任务、一个事务，库不可写时照 t07 的做法记 warn 再抛。

### 3.12 `src/config.ts`：配置

加改写表里的七个变量（四个客户端 id 与密钥、三个上游地址）。一个上游的 id 与密钥只给一个 → 启动失败；地址不是 `https:`，且不是主机为 `127.0.0.1`、`[::1]`、`localhost` 的 `http:` → 启动失败；问题词沿用 `site.operations` 已有的，不够时在那里加（实现时核对）。密钥不进日志。这些地址只为让测试接上仿真上游：第 10 节第 1 条。

### 3.13 `src/index.ts`、`packages/nb-site-server/src/modules.ts`

`IdentityModule` 多两个子应用 `oauth`、`wellKnown`；入口的适配器多两个 mount：`{surface: "site", prefix: LIB_BASE_PATH, app: module.oauth}`、`{surface: "site", prefix: "/.well-known", app: module.wellKnown}`。前缀与 `IDENTITY_API_PREFIX` 不重叠，`checkMounts` 照常通过。`modules.test.ts` 补三个 mount。t10 的静态文件与单页回退（t10 计划 3.8）要登记在这些 mount 之后，记进 t10（第 8 节风险）。

### 3.14 测试的底座

- **仿真上游**（`neuro-book-test-support` 的新子路径 `oauth-upstream`）：`startFakeUpstream()` 在 `127.0.0.1:0` 起一个 `Bun.serve`，回 `{base, setUser(provider, user), failToken(provider), cancelNext(provider), close()}`；Google 有发现文档、授权（自动同意，按 `setUser` 的人回码）、令牌（RS256 的 id_token）、userinfo、JWKS；GitHub 有 `/login/oauth/authorize`、`/login/oauth/access_token`（出错时 200 加 `error` 字段，真实的形状）、`/api/user`、`/api/user/emails`。形状照探针 `spike7-env.ts` 的 `startUpstream`（实测能被库用）。`upstreamEnv(up)` 给出 3.12 的七个变量。合同测试包的导入表加这一行（理由：仿真的是第三方，不是被测系统的实现），`boundary.test.ts` 跟着改。
- **测试客户端**（合同测试包 `src/testing/oauth-client.ts`）：经管理接口登记客户端；带 PKCE 的授权地址；`step(jar, url)` 发一次请求、不跟随跳转，按 `Location` 归成登录页、站点同意页、确认页、错误页、跳回客户端五类；换码、用户信息、撤销；`verifyIdToken(idToken, jwksUrl)` 用 `node:crypto`。社交流程的 `followSocial(jar, startResponse)`：去仿真上游的授权地址，拿回调地址，带 state Cookie 请求回调，回落点。
- **包内测**（`nb-site-identity/src/testing/oauth.ts`）：在进程内用 `auth.handler` 走授权、换码，给撤销与挂载层的用例用；同一个仿真上游从测试支持包取。库按系统时间判的寿命（授权码、访问令牌）在包内用 `bun:test` 的 `setSystemTime` 拨（第 9 节 P11 先探它对库有没有用）。
- 合同测试包的 `AGENTS.md` 底座表加两行（`oauth-client.ts`、仿真上游）。

### 3.15 升级清单（`nb-site-identity/AGENTS.md`）

照现有表的写法，每项一条用例，随实现它的片加：续接依赖的 `verifyOAuthQueryParams` 与五个签名字段名（`sig`、`exp`、`ba_iat`、`ba_pl`、`ba_param`）、登录与确认跳转的地址形状（问 1、问 9）；没有会话时库的登录跳转与 `prompt=none` 的 `login_required`（3.8）；`postLogin` 的先后（登录判断之后、确认之前）、`prompt=none` 时回 `interaction_required`、确认页参数带 `ba_pl` 且同一会话提交时不再问 `shouldRedirect`（问 9）；授权请求 schema 对 `prompt`（`none` 不与别的值并存、未知值）与 `response_type`（非 `code` 映射成 `unsupported_response_type` 并跳回可信回调）的判断（authorize-DXnMh0ha.mjs:480 到 545、8532，设计审查第 17 条 a）；库对坏客户端带去的错误页地址与 `errorPageCode` 的码表（3.8 第 4 步）；确认端点在同意时重跑整个授权、拒绝时回调不可信就给错误页（问 14）；管理员登记时 `application_type` 缺省 `web`、`validateClientRedirectUri` 的两套规则、非 web 客户端的回环地址不看端口（问 13）；换码整段不在事务里、插入撞会话外键（问 10）；已关联身份登录时改 `emailVerified`、`updateAccountOnSignIn` 缺省为真、上游令牌原样存、重复关联走 `updateAccount`（问 11）；`accountLinking.updateUserInfoOnLink` 与 `overrideUserInfo` 缺省关（关联与登录不改显示名、头像，link 分支不写邮箱）；`getSessionFromCtx` 一律以 GET 调 `getSession`、配合 `deferSessionRefresh` 时库不删到期会话（session.mjs:249 到 254），以及库自带的 `session.delete` 前后钩子存在但本模块不依赖（库若开始在别的路径上删会话，撤销会变成提交之后在后台做、且不删授权码）；签名钥按 `createdAt` 挑活钥、过期钥在宽限期内仍列在公钥地址里、私钥用 `secretConfig` 加密（问 12）；撤销不存在的令牌回 400 `invalid_request`（问 3）；用户信息自带 `given_name`、`family_name`、`picture`（被挂载层滤掉）；删会话时外键置空、库不再查会话（问 2）；码的 `value` 的 JSON 字段（`type`、`sessionId`、`userId`、`query.client_id`）；`oauthClient.redirectUris` 的存法；`codeExpiresIn`、`accessTokenExpiresIn` 的缺省；全库自增 id 下一次性检查不执行（启动日志里的那句警告，问 5）；`jwks` 的算法回退（第六轮问 2）；社交错误码表与其中两个由文字派生的码、关联路径不跳转、地址里的 `error` 原样转出、同一上游可关联多个身份（问 8）；state Cookie 的寿命（问 7）；`adminCreateOAuthClient` 在 `withLibTransaction` 里与审计同提交；`storeClientSecret: {hash}` 是库校验密钥的唯一途径；3.6 的端点遍历。

## 4. Spec 与文档改动

由主会话在 master 上先改：

- `docs/specs/site/oauth-provider.md`：整份换成改写稿（去掉〔未实测〕标记与两节附录）。
- `docs/specs/site/accounts.md`、`docs/specs/site/admin.md`：照 `accounts-admin.changes.md` 逐行改。
- `site.operations`：3.12 的配置若要新的问题词，在失败表加（实现第 8 片时核对，没有就不改）。
- `packages/nb-site-contract-tests/AGENTS.md`：导入表加仿真上游一行，底座表加两行（第 5、8 片随代码改，包说明在分支上）。
- `packages/nb-site-identity/AGENTS.md`：升级清单（3.15），随各片改。
- t10：`/consent` 页认 `continue`；`/oauth/consent` 页认 `error=client_not_found|redirect_uri_invalid`（整卡片状态）；单页回退登记在 OAuth mount 之后。由主会话记进 t10 README。
- ADR：不写新的。t08 的收紧（自家发现文档、RS256、`requireOpenId`、撤销在删会话的函数里、不提供 DPoP 与 `private_key_jwt`）是 ADR 0060 决策 5 “库的默认行为另外收紧”的具体做法，记进 t08 Task 记录。

## 5. 切片

每片一个提交；下表“验证”的命令从仓库根执行，看命令自己的退出码；各片另跑 `bun run governance:check --since master`；长验证前看 `cat /proc/loadavg`。变异检查先提交再变异，恢复用 `git show HEAD:<文件> > <文件>`。`<id>` 指 `--package nb-site-identity`，`<ct>` 指 `--package nb-site-contract-tests`。每片按 t07 的经验控制在一个 Opus 编码子代理一次做完（约 1 到 1.5 小时）；第 5、9 片最大，做不完时按表里写的拆法拆。

| 片 | 内容 | 前置 | 验证与变异 |
|---|---|---|---|
| 1 合同包 | 3.1 全部 | Spec 改写已在 master | `bun run test:affected --package nb-site-identity-contract --with-consumers --typecheck`。变异：`client_public` 的状态改 400；`UserInfoResponse` 去掉 `additionalProperties: false`；`SocialStartRequest` 的 link 分支收 `username` |
| 2 迁移与装配 | 3.2；3.4（不含 `genericOAuth` 与钩子）；签名钥启动检查（`signing-key.ts`）；`client-secret.ts`；升级清单对应行 | 第 1 片 | `bun run test:affected <id> --with-consumers --typecheck`。包内：结构基准与“只差 AUTOINCREMENT”；删最大 id 的令牌后新令牌更大；启动后恰有一把 RS256 钥、重启后 kid 不变；表里有一把 EdDSA 钥时启动失败；换会话密钥后启动：旧钥标成过期、新钥签发、公钥地址同时列两把、重启前的 id_token 验得过（问 12 的做法搬进来）；授权码与访问令牌的缺省寿命；客户端密钥经自家哈希写入后库能认（P7）。变异：0002 去掉 `oauthAccessToken` 的 AUTOINCREMENT；启动检查不看算法；解不开时不标旧钥过期；`storeClientSecret` 换回缺省 |
| 3 撤销接缝与清理 | 3.5；3.11（不含社交流程表）；`change-password.ts`、`my-sessions.ts`、`admin/users.ts`、`create-admin.ts` 传 `nowMs`；`testing/oauth.ts` | 第 2 片 | `bun run test:affected <id> --with-consumers --typecheck`。包内（进程内 `auth.handler` 拿令牌与码）：五个调用方各一条，之后令牌 401、码 `invalid_grant`；改密码后当前会话可用、它里面的令牌 401；撤销与删会话同事务回滚；清理拨钟后撤到期会话的令牌；另一个会话的令牌不受影响；源码守卫（五个撤销函数之外没有写 `revoked`、删码的 SQL）。变异：`endSession` 先删后撤；`endOtherSessions` 改回按会话撤；清理不撤直接删 |
| 4 管理客户端 | 3.9 的 `admin/oauth-clients.ts` 与 `oauth/clients.ts` 的 `checkRedirectUri`；`app.ts` 登记 | 第 3 片 | `bun run test:affected <id> <ct> --with-consumers --typecheck`。包内：存法契约；停用时撤令牌、再启用不复活；登记与审计同事务（审计表临时加拒绝插入的触发器）；换密钥后旧密钥换码 `invalid_client`（进程内）。合同（`oauth-admin.test.ts`）：普通用户四个接口 `forbidden`；登记两种；回调地址按种类逐格（机密：http 回环、https 回环、http 非回环；公开：https 回环、`127.0.0.2`、自定义协议、片段、用户信息）各 `redirect_uri_invalid`，公开客户端的 `http://127.0.0.1:…`、`http://[::1]:…`、`http://localhost:…` 登记得进；PATCH 用同一张表；库拒绝的地址不是 500（包内注入）；列表字段与不含密钥；验收 18；`client_public`；三种审计。变异：登记接口放过 `client_secret_post`；登记不传 `application_type`（公开客户端的回环用例失败）；PATCH 不判回调地址；PATCH 停用不撤；列表不带 `anchor` 条件 |
| 5 挂载层与授权主流程 | 3.6（含白名单守卫、大小上限、令牌端点撞外键的映射；用户信息的滤、撤销改写、DPoP 先不做）；3.7 的 `continue.ts` 与登录；3.8 的第 1、4 步（`clients.ts`、`library-location.ts`；不含 `max_age`）；3.9 的 `consent-api.ts`；3.13；3.14 的测试客户端 | 第 4 片 | `bun run test:affected <id> --package nb-site-server <ct> --with-consumers --typecheck`。包内：续接的篡改、模块时钟 10 分钟、`prompt=login` 不打转（问 1 的用例搬进来）；续接地址不含五个签名字段；白名单守卫（全部端点、六种方法，加点名的六个）；`rewriteLibraryLocation` 的五类与错误页码表（问 14 的做法搬进来）；令牌端点撞会话外键回 `invalid_grant`（问 10 的插队做法）；大小上限。合同（`oauth-provider.test.ts`）：验收 1、4、6、13；输出 2（`DiscoveryDocument` 核形状）、3 的错误页、4、5、11、14（含 GET 与 POST 之间改回调地址、停用，同意与拒绝各一）；公开客户端回环换端口得码。变异：`resolveContinue` 不看 `ba_iat`；续接地址留下 `ba_param`；白名单加上 `POST /oauth2/authorize`；守卫只扫 `/oauth2/` 前缀（点名 `/admin/oauth2/create-client` 的用例失败）；确认接口回库的原始 url；第 1 步回环逐字比较；发现文档改成转发库的。拆法：5a 挂载、发现文档、公钥、令牌、入口 mount；5b 授权改写、续接、确认页接口与合同用例 |
| 6 授权的其余规则 | 3.6 的用户信息、撤销、DPoP；3.4 的 `postLogin`；3.8 的第 2、3 步（参数与查询串长度、`max_age`）；3.7 的注册与补交同意 | 第 5 片 | 同第 5 片。包内：`postLogin` 的先后（问 9 的用例搬进来：缺同意、`prompt=none`、`prompt=login`、`max_age`、`prompt=consent`）。合同：验收 2、7、8、11、12、15；输出 7（`UserInfoResponse` 核形状，含有头像的账号；`email_verified` 为 `false`）、10、12、13 的每个 `prompt` 值（含 `none consent`）、带 `request` 的两种、查询串 8193 个字符。变异：用户信息不滤 `picture`；`email_verified` 取库的列（第 8 片的“再登录后仍为 false”用例失败）；`shouldRedirect` 恒为假；确认接口去掉同意门槛（同一会话丢了同意后仍得码的用例失败）；撤销改写不看 `token` 非空 |
| 7 授权列表与失效 | 3.9 的 `grants.ts`；失效与重启的合同用例 | 第 6 片 | 同第 5 片。合同（`oauth-invalidation.test.ts`）：验收 3、5、9、10、16、17、19；输出 8 每一项（含会话到期：拨钟加 `runJob purge`）、15；`site.admin` 输出 2、3、4 与结束全部会话。变异：撤销授权只删同意记录；列表不排除免确认的客户端 |
| 8 社交登录与关联 | 3.2 的 `0003`；3.12；3.4 的 `genericOAuth` 与 `updateAccountOnSignIn`；3.10 的 `flow.ts`、`start.ts`（login、link）、`callback.ts`、`account.create.before` 的关联分支与 `claimUpstreamName`、`account.update.before`、`user.update.before`、`meta`；3.11 的流程清理；仿真上游 | 第 7 片 | `bun run test:affected <id> --package nb-site-server <ct> --package neuro-book-test-support --with-consumers --typecheck`。包内：`claimUpstreamName` 的孤行自愈与两种并发、重复关联同一个身份得 `identity_exists`、`account` 行不含上游令牌（关联与再登录之后）。合同（`accounts-social.test.ts`）：输出 11、12、15、23（登录与关联意图的码）；`site.accounts` 验收 10、11、12；`site.oauth-provider` 验收 14；上游取消、上游令牌出错；配置只给一半启动失败；社交身份再登录后用户信息的 `email_verified` 仍为 `false`。变异：回调不认领流程（重放用例失败）；`mapSocialError` 信地址里的自家码；关联不复核会话；去掉 `account.update.before`（重复关联用例失败）；去掉 `user.update.before`（包内读列的用例失败）；`claimUpstreamName` 只查 `account` 表 |
| 9 社交注册 | 3.3；3.10 的 `user.create.before`、注册分支、`session.create.before` 的注册判断、`start.ts` 的 register；`register.ts` 拆出可复用的函数 | 第 8 片 | 同第 8 片。包内：注入失败全部回滚、码不扣、没有 Cookie；`joinLibTransaction` 的两种误用；两个社交注册与一个密码注册抢一个码。合同：`site.accounts` 输出 13（含未验证邮箱的两种上游；注册意图碰上已关联身份按第 10 节第 5 条）、14，验收 4、5、8、9。变异：扣码改用普通 `write`（回滚用例失败）；去掉已验证邮箱的判断；`joinLibTransaction` 不比序号；去掉 `session.create.before` 的注册判断（选 b 时）。拆法：9a 加入入口与钩子（包内用例）；9b 发起与合同用例 |
| 10 上游身份与收口 | 3.10 的 `identities.ts`；没有密码的账号设密码的合同用例（t07 留下的输出 4、9 后半）；Smoke 标注；升级清单核齐 | 第 9 片 | `bun run test:affected <id> --package nb-site-server <ct> --with-consumers --typecheck --since master`；`bun run docs:check --since master`。合同：输出 16、24；社交注册的账号用密码登录得 `invalid_credentials`、设密码后能登录。变异：解绑不数剩下的登录方式 |

**审查**（安全边界、内核时序、数据格式，按高风险后端的快速审查：Opus 先审，处理完再往下；同时开 omp `@review` 在后台审同一份说明）：

- 第 3 片之后：第 2、3 片（`0002`、库的装配、撤销接缝）。`0002` 在这一轮定稿，之后不改。
- 第 7 片之后：第 4 到 7 片（对外 OAuth 的全部端点与接口）。说明里点名：白名单与端点遍历、3.8 的先后与去 Cookie 的做法、续接令牌、用户信息的滤、撤销的覆盖面。
- 第 10 片之后：第 8 到 10 片（社交与加入库的事务）。`0003` 在这一轮定稿。点名：`joinLibTransaction` 的判据、钩子在库事务里的写、错误映射只信帧、流程认领。
- 收口另对照第 6 节逐句核对用例（Spec 晋升前的核对，派 Opus）。

## 6. 验收映射

“合同”在 `nb-site-contract-tests`，“包内”在 `nb-site-identity`；写明包内的理由。

**`site.oauth-provider`**

| 条目 | 用例 | 位置 |
|---|---|---|
| 输出 1、验收 2 | 两个前缀下不在清单里的地址逐个请求（含 `POST` 授权、内省、登出、`create-client`、`/admin/oauth2/create-client`、`/admin/impersonate-user`、`/token`、`/get-session`、库的登录端点）得 404；清单里的端点换方法得 404 | 合同；白名单守卫在包内（要遍历 `auth.api` 的全部端点，合同里看不到库有哪些端点） |
| 输出 2 | 两份文档相同、`DiscoveryDocument` 核形状、列出的端点都可达 | 合同 |
| 输出 3、验收 4、7 | 停用的客户端、改过的回调地址到错误页；公开客户端的回环地址换端口得码、换路径到错误页；不带 `openid` 得 `invalid_scope`；带 `request`、`request_uri` 各得标准码；查询串超长得 `invalid_request`；`claims` 参数不让 id_token 多字段；机密客户端不带 PKCE 被拒 | 合同；库给错误页时的码表在包内（第 1 步之后合同造不出库的错误页） |
| 输出 4、验收 13 | 登录续接；篡改与拨钟过 10 分钟照常登录、不带继续地址；`prompt=login`、`max_age=0` 不打转 | 合同 |
| 输出 5 | 确认、拒绝、同意过直接发码、范围变宽重新确认、`prompt=consent` | 合同 |
| 输出 6、验收 12 | 机密与公开两种换码；重复换得 `invalid_grant`；PKCE 不对；带 `DPoP` 头不发令牌；授权码拨钟加清理后换不出；17 KB 的表单得 `invalid_request` | 合同；库按系统时间的 10 分钟与访问令牌 1 小时在包内（`setSystemTime`，合同拨不到库的系统时间） |
| 输出 7 | 四种范围组合；邮箱待补的账号；设了头像的账号没有 `picture`；社交注册的账号再用同一上游登录后 `email_verified` 仍为 `false` | 合同（邮箱待补用不给邮箱的 `create-admin` 造；社交那条在第 8 片） |
| 输出 8 | 每一项一条（封禁、改角色、重置、结束全部、自己改密码、登出、结束单个会话、会话到期加 `purge`、撤销授权、停用客户端、停用后再启用） | 合同 |
| 输出 9 | 只有管理员能登记、改、换；密钥只出现一次；换密钥后旧密钥换码 `invalid_client` | 合同 |
| 输出 10、验收 11 | 不存在、已撤销、别的客户端的令牌都 200；缺 `token` 得 `invalid_request`；公开客户端撤自己的 | 合同 |
| 输出 11、验收 6 | 按 `jwks_uri` 验签与列出的字段（含 `acr`）；带与不带 `nonce`；没有资料字段 | 合同 |
| 输出 12、验收 15 | 条款版本提高后到 `/consent?continue=`；补交后拿到码；`prompt=none` 得 `interaction_required`；补交后 `prompt=login` 仍要求登录 | 合同 |
| 输出 13、验收 8 | 每个 `prompt` 值；`prompt=none consent` 与 `prompt=create` 得 `invalid_request`；`max_age` 拨钟后要求重新登录 | 合同 |
| 输出 14 | 两个接口的形状；篡改与过 10 分钟 `authorization_expired`；期间停用客户端 `client_not_found`、改回调地址 `redirect_uri_invalid`（同意与拒绝各一） | 合同；三步判之后、调库之前才改的在包内 |
| 输出 15、验收 9 | 列表字段、免确认的不出现、撤销的效果、别人的 id `not_found` | 合同 |
| 输出 16、验收 18 | 列表分页与 `anchor`；PATCH 四个属性（回调地址按种类判）；`client_public` | 合同 |
| 输出 17、验收 19 | 重启前签发的 id_token 重启后仍验得过、kid 不变 | 合同 |
| 验收 1 | 完整流程（Smoke） | 合同 |
| 验收 3、5、10、16、17 | 见输出 8 | 合同 |
| 验收 14 | 从 `/login?continue=` 改走仿真上游的社交登录 | 合同（第 8 片） |
| 时序“并发换码至多一次” | 同一个码并发换四次 | 包内（问 5.4 的做法；合同里并发的时序不受控，不稳） |
| 时序“与变更并发的换码” | 撤销插在认领与插入之间：令牌照发（写明的取舍）；删会话插在中间：`invalid_grant` 不是 500 | 包内（问 10 的插队做法） |
| 时序“会话 id 不复用” | 封禁 A 后 B 登录、A 的码仍换不出 | 合同（验收 10） |
| 失败码 `authorization_expired`、`client_not_found`、`redirect_uri_invalid`、`client_public` | 见输出 3、14、16 | 合同 |
| 标准错误码 | 每个码至少一条用例触发（`unsupported_grant_type`、`unsupported_response_type` 各一条） | 合同 |
| 副作用“审计” | 三种动作各一条，参数不含密钥 | 合同（第 4 片） |

**`site.accounts`**（改写后的编号）

| 条目 | 用例 | 位置 |
|---|---|---|
| 输出 4 的 `continue` | 见 oauth 输出 4；注册与补交同意各一条 | 合同 |
| 输出 6 的追加句 | 见 oauth 输出 8 | 合同 |
| 输出 11 | 三种意图的发起；没开放 `provider_disabled`；带不合格 `continue` 照常发起 | 合同 |
| 输出 12、验收 4 后半 | 已关联的身份登录；没关联的 `social_not_registered`；邮箱与已有账号相同也不按邮箱认人 | 合同 |
| 输出 13、验收 4 前半、5、8、9 | 缺码不跳转；带齐建号并有会话；未验证邮箱（Google、GitHub 各一）`social_email_missing`；回调前码失效、用户名被占；并发两个；注册意图碰上已关联的身份（第 10 节第 5 条） | 合同；注入失败的回滚在包内（合同造不出写到一半的失败） |
| 输出 14 | 上游邮箱已被占 `email_taken` | 合同 |
| 输出 15、验收 12 | 关联成功（邮箱不同）；`identity_taken`；`identity_exists`（另一个身份、同一个身份再关联一次）；当前密码不对；发起后结束会话 | 合同；孤行自愈与两种并发在包内 |
| 输出 16 | 只剩一种登录方式时 `last_login_method`；有密码时能解绑 | 合同 |
| 输出 23、验收 10、11 | 三种意图的落点；五个跳转码；伪造的 `error` 显示成 `social_failed`；重放与过 10 分钟 | 合同 |
| 输出 24 | 列表字段 | 合同 |
| 副作用“不存上游令牌” | 注册、关联、再登录之后 `account` 行的三个令牌列为空 | 包内（合同看不到库的表） |
| 输出 4、9 的“没有密码” | 社交注册的账号密码登录得 `invalid_credentials`；直接设密码 | 合同（t07 留下的） |
| 时序“社交流程 10 分钟、只能用一次、并发至多一个” | 拨钟、重放 | 合同；并发三个回调在包内（问 7.4 的做法） |

**`site.admin`**：输出 2、3、4 与 `revoke-sessions` 行的 OAuth 部分见上表 oauth 输出 8；分页一段见 oauth 输出 16；输出 8 的三个动作见 oauth 副作用。

**Smoke**：oauth 验收 1 的用例与社交注册的一条标 Smoke。

## 7. 验证

- 每片：表里的命令与变异。
- 真实进程：合同测试对源码起真实的 `nb-site serve`，仿真上游在测试进程里；CI 的镜像作业对打好的产物再跑一遍（t05 已有）。
- 手工（第 10 片）：起 `serve`，用 `curl` 走一遍 `/.well-known/openid-configuration`、带 PKCE 的授权、登录续接、换码、用户信息，看日志里没有密钥、令牌、授权码与上游的邮箱。
- 不做浏览器 e2e：真实浏览器下的续接与确认页在 t10 的 B10。
- 留下的未验证边界：真实的 Google 与 GitHub（等开发者注册应用，部署验收时做）；多进程部署下的签名钥（第一版单进程）。

## 8. 不做与风险

**不做**：刷新令牌、内省、登出、设备码、DPoP、`private_key_jwt`、动态注册（Spec 非目标）；CORS（公开客户端是桌面与命令行应用，浏览器里的单页应用不在第一版）；签名钥的定期轮换（只在启动时保证有一把；轮换另开 Task）；前端（t10）。

**风险与已知限制**

- **对库的输出做改写**：授权端点与确认接口的跳转、撤销的 400、用户信息的字段、社交的错误码都是在库的输出上改写，库升级改了形状时会悄悄失效。每处对着 3.15 的一条用例；白名单守卫挡白名单被放宽。
- **模块时钟与库的系统时间**：授权码、访问令牌、库的 state、同意记录的时间都是库按系统时间写的。合同测试拨的是模块时钟，所以这几项的寿命在合同里经清理任务验、在包内用 `setSystemTime` 验；生产里两只钟相同。`max_age` 由挂载层按模块时钟判，避开库的算法。
- **去掉 Cookie 让库走登录跳转**（3.8 第 3 步，只剩“没有会话”“`max_age` 按模块时钟不满足”两种）：靠库在没有会话时先跳登录页或回 `login_required`（第七轮问 1、本段问 9 实测）。缺站点同意改由库的 `postLogin` 判（问 9 实测），不再靠去 Cookie 后改写库的输出。
- **与变更并发的换码**（设计审查第 7 条，接受取舍）：库换码时先认领授权码、再插入访问令牌，两步不在一个事务里，也包不进 `withLibTransaction`（库的 `getClient` 走基础适配器，问 10 实测）。撤销恰好落在两步之间时，变更之后仍发出一个有效令牌，至多活到它的 1 小时有效期或下一次同类变更；窗口是一次取锁，实测中位约 3 毫秒、上界是等锁上限 10 秒。删会话落在中间时插入撞外键，回 `invalid_grant`。改写稿时序一节写明。要消掉它得改 t07 连接“事务里经基础适配器取连接即拒绝”的约束或给库打补丁，代价远大于收益。
- **码存在 `verification` 表的 JSON 里**：撤销按 JSON 字段找码，表大时是全表扫；表里只有十分钟内的码与社交 state，清理任务删过期行，规模小。
- **`/.well-known` 整个前缀归账号模块**：以后要放 `security.txt` 一类时得改成按路径分。
- **单页回退抢路径**：t10 的静态文件若登记在 OAuth mount 之前，`/api/identity/auth/*` 与 `/.well-known/*` 会落到前端。记进 t10。
- **签名钥依赖会话密钥**：私钥用 `NB_SITE_SESSION_SECRET` 加密（第六轮读源码、问 12 实测），换密钥后解不开；启动时检测并换一把新钥（3.4，第 10 节第 3 条）。库支持按版本的多份密钥（`options.secrets`），能让旧私钥照样解开，但要改 t07 的密钥配置，不在本 Task 做。
- **一次性检查在自增 id 下不执行**：不提供 DPoP 与 `private_key_jwt` 后，库里还会用 `reserveVerificationValue` 的路径都关着（问 5 读源码）；以后要开先换字符串主键。

## 9. 探针（改写稿里〔未实测〕的句子）

每条在对应片开工时先跑（脚本放包内测里，成为那片的用例），不成立就停下回到计划。

| 号 | 要证实的 | 改写稿位置 | 做法 | 片 |
|---|---|---|---|---|
| P1 | 白名单之外两个前缀下任何地址、方法都 404；GET 的也收 HEAD | 输出 1、输入表 | 端点遍历守卫加合同的逐个请求 | 5 |
| P2 | 自家发现文档的值与库的端点一致、每个端点可达 | 输出 2 | 合同 | 5 |
| P3 | 缺站点同意时库的 `postLogin` 带去 `/consent?<签名参数>`，包成 `/consent?continue=`，补交后回来拿到码；`prompt=none` 时库回 `interaction_required`；`prompt=login`、`max_age`、`prompt=consent` 与它的先后（问 9 已实测，搬成用例） | 输出 12、13 | 包内，真实库 | 6 |
| P4 | 按模块时钟判 `max_age` 后去 Cookie，库要求重新登录；`auth_time` 是新会话的建立时间 | 输出 13 | 包内，拨模块时钟 | 6 |
| P5 | `oauthClient.redirectUris` 的存法；库对停用客户端的错误页地址 | 输出 3 | 包内读行；第六轮已见错误页地址 | 5 |
| P6 | 库收到 `request`、`request_uri`、`claims` 时做什么；`claims` 会不会往 id_token 放资料 | 输出 3、目标与非目标 | 包内，三种参数各一次 | 6 |
| P7 | `storeClientSecret: {hash}` 下库用同一个函数校验；自家换密钥后旧的换码 `invalid_client` | 输出 9 | 包内 | 2、4 |
| P8 | `require_pkce: true` 对机密客户端生效（设计审查读源码成立）；回调地址按种类的两套规则、公开客户端回环不看端口（问 13 已实测，搬成用例） | 输出 3、输入一节 | 包内 | 4 |
| P9 | 用户信息滤字段后的形状；设了头像的账号库给不给 `picture`；不带令牌时有没有 `WWW-Authenticate` | 输出 7、失败与恢复 | 包内，再进合同 | 6 |
| P10 | 启动时 `createJwk`、重启后 kid 不变；并发首次签发会不会建两把 | 输出 17、时序最后一条 | 包内（两个实例先后开同一个库） | 2 |
| P11 | `setSystemTime` 能拨动库判授权码与访问令牌到期 | 输出 6（包内部分） | 包内 | 2 |
| P12 | 未验证的邮箱在注册钩子里被拒、回 `social_email_missing`；已关联身份的邮箱变成未验证后照常登录；Google 的 `email_verified` 经 `genericOAuth` 能读到；已关联身份再登录后 `emailVerified` 仍为假、上游令牌不落库（问 11 已实测后两样） | accounts 输出 13、副作用 | 包内，仿真上游两种 | 8、9 |
| P13 | 停用、再启用客户端后旧令牌仍 401 | 输出 8 末项 | 包内 | 4 |
| P14 | 确认页接口期间停用客户端回 `client_not_found`、改回调地址回 `redirect_uri_invalid`；库在确认里给错误页、登录页时的归类（问 14 已实测库给什么） | 输出 14 | 合同加包内 | 5 |
| P15 | 会话到期加 `purge` 之后令牌 401；清理删 `verification` 过期行不影响库的别的路径 | 时序第 4 条、accounts 定时任务 | 合同（拨钟加 `runJob`） | 7 |
| P16 | 注册与补交同意带 `continue` 给继续地址；补交同意不去 `prompt=login` | accounts 输出 4 追加句 | 合同 | 6 |
| P17 | 三种审计的参数 | 副作用 | 合同 | 4 |
| P18 | 重启不影响令牌、待用的码与钥 | 时序最后一条 | 合同 | 7 |
| P19 | 仿真上游的地址经配置接上、`http` 只许回环 | accounts 配置一句 | 合同（配置用例）加包内 | 8 |

## 10. 要主会话或开发者定的事

只列改变产品结果、范围、权限或不可逆后果的。

**1. 上游地址做成配置项**

- 背景：仿真上游起在本机，被测进程得知道去哪里找它。Google、GitHub 的地址写死时合同测试接不上；只在设了测试控制口令时才许改，就是产品代码里的测试分支（仓库规则不许）。
- 候选：a）三个地址变量，缺省是正式地址，只许 `https`，回环可以 `http`（改写表的配置一句）；b）不加，社交部分只在包内测、合同测试不覆盖。
- 推荐 a：社交是 t08 最大的一块，b 让 accounts 输出 11 到 16、23 都没有黑盒用例；a 对生产的影响是多三个不用设的变量，写错了启动失败、不会悄悄连到别处。

**2. 授权请求的客户端或回调地址不对时，浏览器到 `/oauth/consent?error=<码>`**

- 背景：Spec 原文只说“显示站点的错误页”；库自己带去的是它的 `/api/identity/auth/error`，从外部不可达。前端要有一页接住。
- 候选：a）复用确认页，按 `error` 显示整卡片状态（与 `authorization_expired` 同一种画法）；b）另起 `/oauth/error`。
- 推荐 a：t10 的确认页已有整卡片的错误状态，少一个路由；码只有两个。要 t10 的 B7 跟着做。

**3. 更换会话密钥之后的签名钥**

- 背景：签 id_token 的私钥用会话密钥加密；换了 `NB_SITE_SESSION_SECRET`（所有人本来就要重新登录），旧私钥解不开，令牌端点 500，对外 OAuth 全部不可用（问 12 实测）。
- 候选：a）启动时试解最新的活钥，解不开就把它标成已过期、新建一把，记一行 warn；b）以 `start_failed` 拒绝启动，要部署的人手工删 `jwks` 的行；c）不处理，写进运维说明。
- 推荐 a，审查提的两个前提已探实（问 12）：库签发时只挑没过期的钥里最新的一把，标成过期的旧钥不再用来签；旧公钥在库的宽限期（缺省 30 天，远长于 id_token 的 1 小时）里照样列在公钥地址，重启前签发的 id_token 验得过；同一新密钥再重启，签名钥不变。只在最新的活钥解不开时才新建，不会静默轮换。Spec 输出 17 加一句（改写稿已加），代价约 40 行（3.4）。

**4. 停用的客户端再启用时，停用前发出的令牌不恢复**

- 背景：库每次校验都查客户端是否停用（第六轮读源码），只停用不撤令牌的话，再启用后一小时内的旧令牌又能用。改写稿输出 8 末项按“不恢复”写了。
- 候选：a）停用时同一事务撤掉它名下的令牌与码（3.9）；b）照库的行为，再启用即恢复。
- 推荐 a：停用多半是因为客户端出了问题（密钥泄露），恢复旧令牌违背“停用”的意思；代价是 PATCH 里多一次撤销。

**5. 用注册意图走社交、而这个上游身份早已关联到某个账号时**（设计审查第 13 条，新增）

- 背景：库先按上游身份找主人，找到就直接登录那个账号、发会话，不调建账号的钩子（问 11 的 [P9.3f] 实测）。用户在注册页填了用户名、注册码，用一个早已注册过的 Google 身份发起，结果被登进旧账号，注册码没扣、用户名没占，页面没有任何提示；从授权请求来的，外部应用拿到的是那个旧账号。Spec 没规定这种情况。
- 候选：a）当作登录：写明“上游身份已关联账号时按登录处理，注册内容不生效”，落点与登录相同；b）不建会话，跳回 `/register` 并带 `identity_taken`（与关联意图里“这个上游身份已属于别的账号”同一个码），用户改去登录页用它登录。
- 推荐 b：与密码注册碰上撞号时报失败而不是悄悄登录一致；对外 OAuth 续接里不会在用户以为“新建账号”时把旧账号交给外部应用。实现是 t07 的 `session.create.before` 前面加一个判断（注册意图、这次没建用户就抛），实测库随之跳失败哨兵、不发会话、不扣码，同一身份照常能登录（[P9.3g]）；代价约 15 行加两条用例。选 a 时去掉这个判断，accounts 输出 13 加一句“按登录处理”。
- 改写：accounts 输出 13 与输出 23 的码表（改写表已按 b 写）。

**6. 公开客户端（桌面、命令行）的本机回环回调地址是否比端口**（设计审查第 15 条，新增）

- 背景：命令行与桌面应用通常临时取一个空闲端口，再用 `http://127.0.0.1:<端口>/…` 收回调。RFC 8252 7.3 要求授权服务器对回环 IP 的回调地址允许任意端口；库对公开（`native`）客户端的 `http` 回环地址就是去掉端口再比，路径、主机仍逐字比（问 13 实测：登记 `:8123`，请求 `:5555` 或不带端口都发码，`localhost` 与 `127.0.0.1` 不互通）。原计划第 1 步自家逐字比较，先于库判掉，等于把它关了。
- 候选：a）公开客户端的 `http` 回环地址去掉端口后相等即可，与库一致；b）保持逐字相等，改写稿写明“回环地址也要带登记的端口”，命令行应用只能登记至多 5 个固定端口、被占用时失败。
- 推荐 a：第一批接入者正是这类应用；与库同一条规则，第 1 步与库不会一边放行一边拒绝。只对公开客户端、只对 `http` 回环放宽端口；机密客户端只许 `https` 非回环（与库的 `web` 规则一致），所以机密客户端不能登记本机地址做本地调试，要本地调试就另登记一个公开客户端。
- 改写：改写稿输入一节与输出 3（已按 a 写）。

## 11. 没来得及核实的地方

- 库的结构检查缺了那三张没有调用方的表时会不会失败（按建全做，没探）。
- `genericOAuth` 对 Google 是只走 userinfo 还是也验上游的 id_token（仿真上游两样都给了，没分开探）。
- `claimUpstreamName` 的“1 分钟之内算在用”只是读源码估的：钩子提交到库插 `account` 之间只有库自己的几次查询，没量过最坏情况；判错的后果是用户在一分钟内重试得 `identity_exists` 或 `identity_taken`，不会挂上两个身份。
- 原第 11 节第 2、3、5 条已有结论：`trustedProviders` 不设时库对上游邮箱未验证的身份拒绝关联（设计审查读源码）；社交注册的事务里只有两次带钩子的写（同上）；既缺站点同意又没同意过客户端时 `prompt=none` 回 `interaction_required`（问 9 实测）。
- 真实的 Google、GitHub 的错误形状只照文档与探针的仿真，没有对真实服务跑过。

## 设计审查（Opus）的处理（2026-11-25）

审查报告 `evidences/design-review-opus.txt`（只读审查，17 条：重要 3、建议 11、撤回 2、更正 1）。补的探针是 `spike9.ts` 的问 9 到问 14（结论在 `evidences/better-auth-spike-7.txt` 末尾“第三段补探”）。归类按 `reviewing` 的四种。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | `prompt=none` 与别的值并存时没拒 | 审查撤回（库的请求 schema 已判）。3.8 第 2 步仍自判 `prompt`，注释写明“与库重复”，留着是为了合同的码不随库的 schema 变；库的判法进升级清单 |
| 2 | 缺站点同意时去掉 Cookie 让库走登录跳转是绕路，库有 `postLogin` | 成立要改。问 9 实测 `postLogin` 在 t07 装配下可用：缺同意到 `/consent?<签名参数>`，`prompt=none` 回 `interaction_required`，`prompt=login`、`max_age` 先于它判，补交后续接得码。3.4 加 `postLogin`；3.7 补交同意的续接不去 `prompt`、`max_age`；3.8 第 3 步只在模块判为没有会话、`max_age` 按模块时钟超时这两种情况去 Cookie；3.9 写明确认接口的 `requireSession` 门槛是承重的（库对同一会话凭 `ba_pl` 跳过 `postLogin`）；P3 改成搬问 9 的用例 |
| 3 | 回调地址的规则与库的不一致（不写 `application_type` 按 `web`） | 成立要改，同类格一起改：3.1 按种类的两套规则（`checkRedirectUri`），登记显式传 `application_type`、库拒绝时映射成 `redirect_uri_invalid` 并记 `identity.oauth_client_rule_drift`，PATCH 用同一规则，授权第 1 步与确认接口照库的匹配规则（`checkClientAndRedirect`）。改写稿输入一节、输出 3、16 与失败表。问 13 实测两套规则 |
| 4 | 非 `code` 的 `response_type` 被兜底成 `client_not_found` | 审查撤回主体，残余并入第 3 条；`response_type` 交库判，跳回 `unsupported_response_type`，进升级清单 |
| 5 | 端点守卫只扫六个前缀，漏 `/admin/*`、`/token`、`/get-session` | 成立要改。3.6 的守卫遍历 `auth.api` 的全部端点乘六种方法，另点名六个（`/admin/oauth2/create-client`、`/admin/impersonate-user`、`/token`、`/get-session`、`/sign-out`、`/error`）；理由改正为防白名单被放宽，库加的新端点本来就落到兜底 404 |
| 6 | 确认接口把库给的 `url` 原样当跳回地址 | 成立要改。问 14 实测库在确认里重跑授权，会给登录页、错误页。3.9 经 `rewriteLibraryLocation` 归类：跳回客户端原样回；登录页、站点同意页包成 `continue`；错误页回失败码 `client_not_found`、`redirect_uri_invalid`，码由 `errorPageCode` 重判。改写稿输出 14、失败表 |
| 7 | 换码不在事务里，撤销夹在中间时变更之后仍发出令牌 | 成立但接受取舍，交开发者知悉。问 10 实测包不进 `withLibTransaction`（库的 `getClient` 走基础适配器，t07 连接拒绝）；窗口是一次取锁，实测中位约 3 毫秒、上界为等锁上限 10 秒，令牌至多活 1 小时；删会话落在中间时撞外键，3.6 映射成 `invalid_grant` 并记 `identity.oauth_token_raced`。改写稿时序一节写明窗口与上界；第 8 节记风险 |
| 8 | 已关联身份每次社交登录把 `emailVerified` 改成真 | 成立要改，同类格列全：库改用户列的路径有再登录（`updateUserInfoOnLink` 关时仍改 `emailVerified`）、同邮箱关联后登录；改账号行的有 `updateAccountOnSignIn`。3.4 关 `updateAccountOnSignIn`、`updateUserInfoOnLink`；3.10 加 `user.update.before`（`emailVerified` 恒回 false）、`account.update.before`；3.6 用户信息的 `email_verified` 恒为 false、不读列。问 11 实测改前改后。改写稿输出 7、accounts 输出 13 |
| 9 | 库明文存上游的访问令牌、刷新令牌与 id_token | 成立要改。读源码并实测：库没有“不存”的选项，只有 `encryptOAuthTokens`。第一版用不到上游令牌，3.10 的 `account.create.before`、`account.update.before` 把五个令牌列置空，加 `updateAccountOnSignIn: false`；accounts 副作用一节加一句；包内用例读列。问 11 实测 |
| 10 | 更正：撤回第 1 条、收窄第 4 条 | 不计数；按它改了第 1、4 条的处理与升级清单 |
| 11 | 关联不在事务里：先查后插，失败留孤行永久挡住身份 | 成立要改。3.10 的 `claimUpstreamName` 在一个模块写事务里按 `identity_upstream_name` 判两种冲突，孤行（没有 `account` 行且超过 1 分钟）删掉自愈，两个 `UNIQUE` 兜底按错误码当程序错误；关联本身不包进事务（回调里有对上游的网络往返）。accounts 输出 15 加并发与“不留记录”两句。1 分钟的阈值列进第 11 节 |
| 12 | 0002 的自家表违反“指向账号不写 ON DELETE”，社交表随第 3 片冻结 | 成立要改。0002 只放库的表，第 3 片审查后定稿；社交两张表移到 0003，随第 8 片建、第 10 片审查后定稿；`identity_upstream_name` 外键不写 `ON DELETE`，加 `(user_id, provider)` 与 `(provider, upstream_account_id)` 两个 `UNIQUE` |
| 13 | 注册意图碰上已关联的上游身份，库静默登录旧账号 | 成立，产品行为交开发者：第 10 节第 5 条，推荐 b（不建会话，回 `/register` 带 `identity_taken`）。问 11 实测库的行为与 b 的做法；计划与改写表按 b 写 |
| 14 | OAuth 子应用没有请求体上限 | 成立要改。3.6 在白名单之前挂 16 KB 的 `bodyLimit`，GET 查询串超过 8192 个字符时授权端点跳回 `invalid_request`、回调带 `social_state_invalid`；合同加两条 |
| 15 | 公开客户端的回环回调地址逐字比，不合 RFC 8252 | 成立，交开发者：第 10 节第 6 条，推荐 a（与库同规则，`http` 回环不比端口）。问 13 实测库的匹配；计划第 1 步与改写稿输入一节、输出 3 按 a 写 |
| 16 | 几处小的不一致 a 到 e | 成立要改：a）`revoke.ts` 加第五个函数 `revokeOAuthForExpiredSessions`，`session.ts` 只调它；b）3.9 写明授权与客户端的 `createdAt` 是库按系统时间写的，用例只断言格式与先后；c）改写稿输出 11 加 `acr`（恒为 `"0"`），发现文档的 `claims_supported` 随之；d）`social_cancelled`、`social_failed` 进 `REDIRECT_ONLY_CODES`，“七个”改“九个”，3.1 的“新码都有状态”只指四个 OAuth 码；e）查询串上限同第 14 条，改写稿输出 3 |
| 17 | 升级清单漏了 a 到 h 八处库行为 | 成立要改。3.15 补全八项，另加本段新依赖的 `postLogin` 先后、`ba_pl`、`ba_param`、`application_type` 缺省、签名钥的挑法与 `/jwks` 宽限期；每项对一条用例，随对应的片加 |
| 待确认 3 | 换会话密钥后签名钥解不开 | 审查要先探的两个前提已探实（问 12）：库只挑没过期的钥里最新的一把签名，标成过期的旧公钥在 30 天宽限期里仍列在 `/jwks`。第 10 节第 3 条推荐 a，3.4 写启动检查（`signing-key.ts`），改写稿输出 17 加一句 |

切片仍是 10 片、顺序不变；内容有变的是第 2 片（签名钥启动检查）、第 3 片（0002 只放库的表、第五个撤销函数）、第 4 片（两套回调地址规则）、第 5 片（守卫、大小上限、撞外键映射、确认接口归类）、第 6 片（`postLogin`、查询串长度）、第 8 片（0003、`claimUpstreamName`、两个更新钩子、不存上游令牌）、第 9 片（注册意图碰已关联身份）。

## 附：`site.oauth-provider` 原编号到新编号

| 种类 | 原编号 | 新编号 | 说明 |
|---|---|---|---|
| 输出 | 1 | 1 | 改成按两个地址前缀写清单（不再说“身份库自带的地址”）；明确授权端点只收 GET |
| 输出 | 2 | 2 | 改成 OpenID Connect 的发现文档，两个地址、字段逐项列出 |
| 输出 | 3 | 3 | 范围必须含 `openid`；PKCE 对机密客户端也要；`claims` 被忽略；`request`、`request_uri` 跳回标准码；查询串超长跳回 `invalid_request`；客户端或回调不对时到 `/oauth/consent?error=`；公开客户端的 `http` 回环地址不比端口 |
| 输出 | 4 | 4 | 写明 `/login?continue=…`、登录响应的继续地址、过期时照常登录（S1） |
| 输出 | 5 | 5 | 写明确认页路径 `/oauth/consent?request=…`；`prompt=consent` |
| 输出 | 6 | 6 | 授权码 1 分钟改为 10 分钟；回应加 id_token；公开客户端带 `client_id`；拒 DPoP |
| 输出 | 7 | 7 | 字段名定为 `preferred_username`、`name`、`email_pending`、`email`、`email_verified`；去掉 `given_name`、`family_name`；不出 `picture`；`email_verified` 恒为 `false` |
| 输出 | 8 | 8 | 改成按事件列出的失效范围；加角色被改、结束全部会话、单个会话结束（含到期）、自己改密码含当前会话的令牌；停用后再启用不恢复 |
| 输出 | 9 | 9 | 不变（补“改动、换密钥也只有管理员”） |
| 输出 | 10 | 10 | 补公开客户端的认证、别的客户端的令牌、缺 `token` |
| 输出 | — | 11 | 新：id_token（含 `acr`） |
| 输出 | — | 12 | 新：站点同意先于授权 |
| 输出 | — | 13 | 新：`prompt` 与 `max_age`；`none` 不与别的值并存 |
| 输出 | — | 14 | 新：确认页接口的请求与响应（S11）；期间停用或改回调地址时的码 |
| 输出 | — | 15 | 新：已给的授权的字段与撤销（S12） |
| 输出 | — | 16 | 新：客户端列表的分页与改动（S13）；改回调地址的规则同登记 |
| 输出 | — | 17 | 新：公钥与重启；换会话密钥后改用新钥、旧公钥仍列出 |
| 失败码 | `authorization_expired`、`client_not_found`、`redirect_uri_invalid` | 同名 | `client_not_found` 含“已停用”；后两个也用作错误页的查询参数 |
| 失败码 | — | `client_public` | 新 |
| 标准错误码 | — | `request_not_supported`、`request_uri_not_supported` | 新 |
| 验收 | 1 到 5 | 1 到 5 | 2 改成按两个前缀逐个请求；4 写明错误页地址；其余不变 |
| 验收 | — | 6 到 19 | 新；6 不再写“用标准的 JOSE 库”，改成按 `jwks_uri` 验签（合同测试只许导入平台模块，见计划技术选型） |
| 输入 | — | 标准端点表 | 新：端点地址与方法写死（一经公布不改） |
| 输入 | 回调地址“精确匹配，除本机回环外必须是 HTTPS” | 按种类的两套规则 | 与库登记时的规则一致；机密客户端不能登记本机地址 |
| 目标与非目标 | “不发 id_token，不支持 `openid` 范围；发现文档里不出现公钥地址” | 删去 | 开发者定按 OpenID Connect |
| 状态与转换 | “一次授权请求从发起到同意至多 10 分钟” | 改为每次带去页面起 10 分钟、登录后重新起算 | 续接的实际语义 |
| 状态与转换 | — | 会话到期时令牌至迟在下一次 `purge` 后失效 | 开发者 2026-11-25 第 1 条（清理过期会话也算） |
| 状态与转换 | — | 与变更并发的换码可能在变更后发出令牌，窗口不超过 10 秒 | 设计审查第 7 条，接受取舍 |

## 附：改写稿的自查

按 `docs/specs/README.md` 的两条判据逐句过了一遍，改了这几处：

- 输出 1 原写“身份库自带的任何其它地址”：换实现（不用这个库）就要改，改成按两个地址前缀写；可判定（逐个请求）。
- 边界与兼容第 4 条原写“身份库自己的续接协议不出现在本合同里”：同理改成“它们的内容不属于本合同”。
- 输出 12 补“不把这次补交当成重新登录”：没有这句，`prompt=login` 在补交同意后被当作已满足，是可观察的差别。
- 输出 13 “自登录以来”改“自建立以来”：社交登录、注册建立的会话也算。
- 验收 6 去掉“标准的 JOSE 库”：写的是测试手段，不是行为。

仍留着、判为属于合同的：端点地址与方法（对外公布、客户端写死）；“客户端密钥与访问令牌只存摘要”“私钥加密存放”（副作用一节的数据承诺，审查能判）；`auth_time`、`at_hash` 等字段名（标准字段，客户端按名字读）。

`writing-specs` 的自查项：

- 术语：“续接令牌”“确认标识”只在本 Spec 用；`site.accounts` 输出 4 用的 `continue`、`continueUrl` 是同一件事的字段名，两处一致。失败码与 `site.accounts`、`site.admin` 不撞名（`client_not_found` 不与 `not_found` 混用：前者是客户端，后者是接口或资源）。
- 持久化的值有没有上界：回调地址至多五个（每个的长度上限沿用 `site.accounts` 网址字段的 500 个字符，计划里定）；授权、令牌、授权码的行随使用增长，过期的由清理任务删（计划 3.9），撤销了的授权直接删行。
- 交互合同：续接令牌的寿命、授权码的寿命与单次性、并发换码、失效的生效时刻、会话 id 不复用、重启后的寿命都在“时序与寿命”里。

## 开发者的确认（2026-11-25）

计划第 10 节的待确认项，开发者 2026-11-25 都按推荐定：上游地址做成配置项；授权请求的客户端或回调地址不对时去授权确认页显示错误；换会话密钥后最新的签名钥解不开时标为过期、新建一把并记一行警告；停用客户端时同一事务撤掉它的令牌与授权码；用注册意图走社交而上游身份已关联了账号时不建会话、不扣码，回 `/register` 带 `identity_taken`；公开客户端的回环回调地址授权时不比端口（RFC 8252）。另知悉并接受：换授权码那一步包不进事务，撤销恰好落在“认领授权码”与“发令牌”之间时仍会发出一个有效令牌（至多 1 小时），写进 Spec 的时序一节。

## 实现审查（第 2、3 片）的处理（2026-11-25）

范围 `bf3d6f5aa..3bb82cf7d`。Opus 子代理先审：5 条，都是建议；报告 [`evidences/impl1-review-opus.txt`](evidences/impl1-review-opus.txt)。它核过撤销的覆盖面、改密码按账号撤并保留当前会话、同事务回滚、签名钥的挑法与解密判据、客户端密钥存法与定长比较、`0002` 与库导出逐字对齐，没有发现问题。omp 另审，回来后另行处理。一个修正提交：

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | `disabledPaths` 只关了 82 条库路径里的 22 条；带普通用户的 Cookie 直接走 `auth.handler`，有 56 个“方法加路径”不是 404，其中有删会话的 `/sign-out`、`/revoke-sessions`、`/change-password`、`/admin/ban-user` 等（这些路径删会话不经自家撤销） | 改。`disabledPaths` 由“库的全部端点减去对外要的那几条”生成，不手写清单；用例遍历库的全部端点乘六种方法，断言除对外要的几条外都是 404。挂载层的白名单（第 5 片）仍是第一道 |
| 2 | 环境变量 `BETTER_AUTH_SECRETS` 能顶掉 `NB_SITE_SESSION_SECRET` | 不成立：t07 的配置校验已让以 `BETTER_AUTH_` 开头、取值不为空的环境变量启动失败（`config.ts`，`site.accounts` 配置一段）；审查者的实验没经配置校验直接装配 |
| 3 | `revoke.ts` 清理函数的注释说“测试里模块的时钟只会更快”，实际不拨时比墙钟慢 | 改注释：写明清理按模块时钟删、库按系统时间判寿命，两者在测试里可能差任意方向；拨时钟的用例照此写 |
| 4 | “旧公钥列 30 天”靠库缺省的 `jwks.gracePeriod`，代码没写、没有用例 | 改。`identityJwtOptions` 显式写 30 天，补用例（读出的配置或钥匙行的过期时刻），升级清单加一行 |
| 5 | 撤销“不多删别的 `verification` 行”与 `json_valid` 守护没有用例；“库自带的 `session.delete` 钩子”没进升级清单 | 改。补用例：表里有社交 state 行与一行非 JSON 时登出、封禁、清理都成功，且只删该删的；升级清单补那一行 |

修正提交 `d4ae39ae5`。第 1 条与表里写法的差别：带参数的端点 `disabledPaths` 关不掉，`GET /reset-password/:token` 只靠挂载白名单挡，接受（理由见 Task 记录“实施进度”）。

## 设计审查（omp）的处理（2026-11-25）

审的是固定稿 `7f85fa2df`，在 Opus 那轮处理之后。omp（`@review`）到 150 分钟上限被截停，用原会话续跑一次只做收尾；报告 [`evidences/design-review-omp.txt`](evidences/design-review-omp.txt)。有效 14 条（重要 11、建议 3），编号 1 到 9、11 到 15：第 10 条并入第 2 条，第 16 条更正第 4 条的改法；报告里第 16 条之后重复出现的第 5 到 9 条，审查者说以前一份为准，但后一份第 9 条是不同的问题，这里记成 9b。它对第 10 节六项的判断都是“已有决定”，没有要开发者再定的。

Spec 随本节改了 `site.oauth-provider`（输入表与 HEAD 一句、输出 1 到 4、6、14、时序、验收 2 与 20 到 22）与 `site.accounts`（输出 12、15、时序、验收 11 到 14）。本节与前文冲突时以本节为准。

| 条 | 发现 | 处理 | 落到 |
|---|---|---|---|
| 1 | 关联的写入不在生效时复核发起会话：库与 `callback.ts` 复核之后还有对上游的网络往返，结束会话可以夹在中间 | 改。`account.create.before` 关联分支的那个写事务里先复核 `identity_social_flow.session_id` 的会话仍在、没到期、账号没被封，不成立就抛（映射成 `social_state_invalid`），再 `claimUpstreamName`。钩子提交到库插 `account` 之间仍有一次库写的空档，接受，写进 `site.accounts` 时序 | 第 8 片；变异“关联不复核会话”改成去掉钩子里的复核 |
| 2（含 10、14） | 换回上一个版本时，那个版本删会话不撤令牌，外键把令牌的 `sessionId` 置空，换回本版本后库不再查会话，令牌仍可用 | 改，用一条失败即关的规则：`purge` 的同一事务里删 `sessionId IS NULL` 的访问令牌（本版本只发授权码流程的令牌，都带会话；自家撤销先删令牌再删会话，不会留下这种行）。`purge` 启动后先跑一次，换回后很快收口。那个版本里改密码时当前会话的令牌不撤、至多活 1 小时，接受，写进 `site.oauth-provider` 时序。相邻版本的身份合同仍按 `site.operations` 验收 2 的 planned 处理，不在本 Task 补 | 与第 2、3 片 omp 实现审查的修正同一个提交 |
| 3 | 授权端点拒绝 POST，与 OIDC Core 3.1.2.1“授权服务器必须同时支持 GET 与 POST”不符 | 改。白名单放行 `POST /oauth2/authorize`，只收 `application/x-www-form-urlencoded`；3.8 的判断对 GET 的查询串与 POST 的表单体用同一套（先把参数读成同一个 `URLSearchParams`）。跨站 POST 不带 `SameSite=Lax` 的会话 Cookie，按没有会话走登录，写进 Spec 输出 3。`LIBRARY_PUBLIC_ENDPOINTS` 改成授权 GET、POST | 第 5 片 |
| 4（含 16） | 发现文档没写 `response_modes_supported`，按 RFC 8414 缺省就是 query 与 fragment；库对 `response_mode=fragment` 仍把结果写进查询串 | 改。两份发现文档写 `response_modes_supported: ["query"]`；授权请求带 `response_mode` 且不是 `query` 时，在回调地址核对之后跳回 `invalid_request`（第 16 条：授权端点的错误走跳回，不是令牌端点的 400） | 第 5 片（发现文档）、第 6 片（3.8 第 2 步） |
| 5 | 入口收 8192 个字符的查询串，续接令牌是它加签名字段再 base64url 编码，也以 8192 为界，长请求在登录之后悄悄丢掉 | 改。入口上限降到 4096 个字符（GET 的查询串与 POST 的表单体），续接令牌的 8192 不变：4096 编码后约 5462，加签名字段仍在 8192 之内。验收 21 在 4096 那一侧走匿名登录、补交同意、确认三条路径；实现时实测最长的令牌长度写进 `continue.ts` 的注释 | 第 6 片（入口上限）；验收 21 在第 6 片 |
| 6 | 已关联的身份这次上游没给邮箱时，库在按上游身份找账号之前就以 `email_not_found` 拒绝 | 接受，记为已知限制，写进 `site.accounts` 输出 12：Google 的 `email` 范围总给邮箱，GitHub 的 `getUserInfo` 已取主邮箱（不论验证与否），只有 GitHub 账号没有主邮箱时出现。登录意图下这个码落到 `social_failed` | Spec 已改；第 8 片按 `mapSocialError` 现有的“其余”处理 |
| 7 | 带 `resource` 时库发 JWT 访问令牌、不写 `oauthAccessToken` 行，自家撤销够不到，改密码保留当前会话时它仍可用 | 改。挂载层在交库之前从授权请求（查询串或表单体）与换码的表单体里去掉 `resource`（RFC 6749：不认识的参数忽略）。升级清单加一行“允许的访问令牌都有 `oauthAccessToken` 行”。验收 22 | 第 5 片（去参数）、第 7 片（验收 22 的改密码那半） |
| 8 | 确认标识不绑定会话、不是一次性的 | 不改，写清语义：确认标识与授权请求本身等价（谁都能重新发起同一个授权请求拿到新的标识），绑定会话挡不住什么；按提交时的会话算、可再次提交写进 Spec 输出 14。“页面显示的是 A、提交时已换成 B”只是显示过时，提交结果仍是 B 本人的决定 | Spec 已改；第 5 片的确认接口用例按新句子写 |
| 9 | 社交注册与关联同一个上游身份并发时，注册判断“没关联”在注册事务之外 | 不成立，说明没写清：注册分支在 `joinLibTransaction` 里写上游名字也经 `claimUpstreamName`，与关联争同一张表的唯一约束，输的一边整个事务回滚（注册不扣码、不建号）。3.10 的“写资料、同意、邀请归属、上游名字”这里写明“上游名字经 `claimUpstreamName`，抛 `identity_taken` 时整个注册回滚”。补验收 14（并发） | 第 9 片 |
| 9b | 库把上游回调里的 `error` 原样转进失败地址，`mapSocialError` 再把其中的库码译成本站结论（例如 `identity_taken`） | 改。`callback.ts` 先看进来的回调地址：带 `error` 的是上游报的，`access_denied` 记 `social_cancelled`，别的一律 `social_failed`，不看库的跳转；只有回调地址不带 `error` 时才按 `mapSocialError` 译库的码。验收 11 补库码那一句 | 第 8 片 |
| 11 | Spec 说 GET 地址都收 HEAD，计划白名单把授权与公钥列成“GET（含 HEAD）”；库对 HEAD 一律 404（实现审查修正时也实测到），授权端点收 HEAD 还会有发码的副作用 | 改。只有发现文档与公钥地址收 HEAD：挂载层把 HEAD 当 GET 交库或自家路由，回同样的状态与头、去掉正文；授权与用户信息不收 HEAD（404）。白名单表与 `LIBRARY_PUBLIC_ENDPOINTS` 跟着改 | 第 5 片 |
| 12 | 库经 `redirectOnError` 抛出的跳转怎样进 `rewriteLibraryLocation` 没写 | 说明没写清。`onAPIError.throw` 只让非 `APIError` 从 `handler` 抛出，库以 `APIError` 做的跳转由 `handler` 变成普通的 302 响应，同样交 `rewriteLibraryLocation`；第 5 片补用例：可信回调上的错误跳回客户端，坏客户端、坏回调落到 `/oauth/consent?error=`，库的 `/error` 地址不外露（GET 导航与 `fetch` 各一次） | 第 5 片 |
| 13 | 社交流程没写明怎样认发起的浏览器 | 改，写清：认浏览器靠库的 state Cookie，写进 `site.accounts` 时序；补验收 13（两份 Cookie） | 第 8 片 |
| 15 | 计划说去掉 `claims` 再交库，但 P6 写成“先探库会不会按它放资料再定”，执行者可能把它当有效输入 | 改。去掉 `claims` 是定死的要求；P6 收窄为“去掉之后库看不到这个参数”。合同：带 essential `acr` 的 `claims` 与不带时结果相同 | 第 6 片（3.8 第 2 步） |

## 实现审查（第 2、3 片，omp）的处理（2026-11-25）

范围 `bf3d6f5aa..d4ae39ae5`（含 Opus 那轮的修正），omp（`@review`）在自己的 worktree 里审，跑完没被截停；报告 [`evidences/impl1-review-omp.txt`](evidences/impl1-review-omp.txt)。3 条，都是建议。

| 条 | 发现 | 处理 |
|---|---|---|
| OMP-1 | 换回上一个版本期间删掉的会话，令牌的 `sessionId` 被置空，`purge` 不清这种行，换回后令牌仍可用到过期 | 成立，就是设计审查（omp）第 2 条，按那里的处理做：`purge` 同一事务删 `sessionId IS NULL` 的访问令牌；包内用例照审查者的做法（真实外键删会话、重启、跑 `purge`、用户信息 401）。5b 在同一个 worktree 里跑，等它交回后单独一个提交 |
| OMP-2 | `LIBRARY_PUBLIC_ENDPOINTS` 的授权端点是 GET、HEAD，与合同的 GET、POST 不符 | 已在第 5a 片（`51c7f962e`）改成 GET、POST，HEAD 不再给授权端点 |
| OMP-3 | 活钥的密文能解开、明文却不是 JWK 时启动不报错，换码时才失败 | 不改：私钥用库的 `symmetricEncrypt`（XChaCha20-Poly1305，带认证），能解开的密文只能由持有会话密钥的人写出，库表被这样改过不在要防的范围 |

## 实现审查（第 4 到 7 片）的处理（2026-11-25）

范围 `d4ae39ae5..40a02a627`，在审查用的 worktree 里审。Opus 子代理先审：5 条，都是建议；报告 [`evidences/impl2-review-opus.txt`](evidences/impl2-review-opus.txt)。它核过重复参数时模块与库取值一致、第 1 步的回调地址匹配与库逐行一致、续接令牌的签名覆盖与长度上界、补交同意期间的 `max_age`、`wrapOAuthConsent` 产品路径碰不到、`purge` 不误删本版本的令牌（库换码时恒写会话 id）、停用与撤销授权同事务、`VALIDATION_ERROR` 的映射不误报名字、用户信息严格是输出 7 的字段，没有发现问题。omp 同时在后台审，回来后另行处理。一个修正提交：

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 百分号编码的路径绕过白名单：Hono 按 `decodeURI` 之后的路径匹配，交库的是原样的编码路径（`/oauth2/%61uthorize` 进了授权端点、`/oauth2/%74oken` 进了令牌端点） | 改。子应用最前面：原样的 pathname 与 Hono 解码后的路径不相等时回本模块的 404，不交库。`mount.test.ts` 的“路径的写法不同”加编码写法（各对外端点一条，加前缀里编码一段） |
| 2 | 撤销端点的 400 改 200 吞掉客户端认证阶段的 `invalid_request`（重复的 `client_id`、`client_secret`，或 Basic 与表单密钥并存时，没认证的请求也得 200） | 改。交库之前自己判：`client_id`、`client_secret` 出现多次，或带 Basic 又在表单里带 `client_secret`，回 400 `invalid_request`、不交库、不改写；改写只对通过这一步的请求。补用例三种各一条 |
| 3 | 会话到期后、`purge` 之前换它名下的码回 `invalid_request`（库在用掉码之前判会话），不是 `invalid_grant` | 不改，写进 `site.oauth-provider` 时序：只有会话到期前 10 分钟内发出的码碰得上，结果同样是换不出令牌、码不被用掉；`purge` 跑过之后是 `invalid_grant` |
| 4 | 授权端点的表单 POST 超过 16 KiB 回 400 JSON，不跳回、不去错误页 | 不改，写进 Spec 输出 3：请求体超过上限时读不到客户端与回调地址，跳不回去；正常客户端碰不到（入口上限 4096） |
| 5 | 输出 15 的“列表按给出的先后倒序”没有用例 | 改。合同补一条：两个客户端先后同意，列表顺序是后给的在前 |

omp 那份（同一份说明，在同一个审查 worktree 里，跑完没被截停；[`evidences/impl2-review-omp.txt`](evidences/impl2-review-omp.txt)）：3 条，都是建议，与 Opus 第 1、2、5 条重合（编码路径、撤销改写吞掉认证错误、授权列表顺序没有用例），都已由 `0f942f893` 修掉。它另给了一个例子：已登记的机密客户端用有效 Basic、同时在表单里带 `client_secret` 撤有效令牌，回 200 而令牌仍可用；修正后这种写法回 400 `invalid_request`，在 `mount.test.ts` 的三种不合格写法里。没有新的处理项。

## 实现审查（第 8 到 10 片）的处理（2026-11-26）

Opus 先审（[`evidences/impl3-review-opus.txt`](evidences/impl3-review-opus.txt)）：5 条，重要 1、建议 4，都成立。审查期间负载 12 到 42，只有第 1 条做了真实运行的实验，其余是读码。omp 在后台审同一份说明，报告回来另记。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | Google 的发现文档在启动时取、库不设超时：上游接受连接却不回答时启动被拖约 6 分钟；拒绝连接时 `meta` 说开放、发起回 500 | 发起时库报上游还没发现成功，回 503 `unavailable`（`site.accounts` 输出 11）；启动时的无超时记为已知限制、进升级清单。不改成显式写端点：那样库不再验 id_token 的签名与 nonce，换来的只是少一种罕见的启动延迟（站点在境外，Google 正常可达） |
| 2 | 同一次流程的回调并发到达没有用例，认领的原子性没人守 | 改。包内补三个回调并发，认领拆成读后写的变异 |
| 3 | 登录意图的社交发起不要会话、不计数，每次写两行 | 改。计入登录的来源地址计数（`site.accounts` 输出 19 末句）；注册意图本来在发起时计入注册的来源计数 |
| 4 | 导入的 GitHub 身份没有上游名字行时，`me/identities` 整个 500 | 不改列表；`site.legacy-import` 去向表写明导入记上游账号名字与关联时间，代码注释与 `0003` 文件头指过去 |
| 5 | 社交注册的邮箱不按本站的邮箱规则校验 | 改。不合规则时与没验证过同样处理，`social_email_missing`（输出 13） |
