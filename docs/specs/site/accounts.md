---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: site.accounts
owners:
  - nb-site-identity
---

# 官方站：账号

## 目标与非目标

给访问官方站的人：凭注册码注册、用用户名或邮箱加密码登录、用 Google 或 GitHub 登录、管理自己的资料与登录方式。给站内别的模块：一个“问身份”的端点。管理员对别人账号的操作见 [`site.admin`](admin.md)，本站作为 OAuth 服务方见 [`site.oauth-provider`](oauth-provider.md)。

不承诺：

- 不验证邮箱、不发邮件，没有自助找回密码。
- 不按邮箱自动合并账号。
- 没有两步验证、通行密钥。
- 用户名注册后不能改；不能自助注销账号（由管理员处理）。
- 已知限制：邮箱不验证，持有注册码的人可以先占用别人的邮箱。

## 术语与参与者

- **访客**：没有会话的请求方。**用户**：有有效会话的账号持有者。
- **注册码**：管理员发的准入凭据，有可用次数。**邀请码**：用户发的码，只记“谁邀请的”，不能代替注册码。
- **上游**：Google 或 GitHub。**上游身份**：上游名加上游给的稳定 id。**上游账号的名字**：GitHub 的登录名、Google 的邮箱，只用来让本人认出关联的是哪个账号。
- **公开资料**：账号的 id、用户名（小写的登录名）、显示名、头像、网站、签名、角色与注册时间。
- **同意记录**：账号同意了哪个版本的条款、是否同意数据存放在境外、时间。
- **当前条款版本**：站点配置里的条款版本号。

## 输入与前置条件

接口都在 `/api/identity/v1/` 下，请求与响应是 JSON；改状态的请求要带与站点地址相同的来源头，否则回 `forbidden_origin`。

| 接口 | 谁能调 | 作用 |
|---|---|---|
| `POST register` | 访客、用户 | 密码注册；可带续接令牌（planned） |
| `POST login`、`POST logout` | 访客、用户 | 登录（可带续接令牌，planned）、结束当前会话 |
| `GET whoami` | 任何人 | 问身份 |
| `GET me`、`PATCH me` | 用户 | 读、改自己的资料 |
| `POST me/password` | 用户 | 改密码或给没有密码的账号设密码 |
| `POST me/consent` | 用户 | 补交同意；可带续接令牌（planned） |
| `GET me/sessions`、`DELETE me/sessions/:id` | 用户 | 列出、结束自己的会话 |
| `GET me/identities`、`DELETE me/identities/:id` | 用户 | 列出、解绑上游身份（planned） |
| `GET me/invite-codes`、`POST me/invite-codes`、`PATCH me/invite-codes/:id` | 用户 | 列出、生成、停用自己的邀请码 |
| `POST social/:provider/start` | 访客、用户 | 发起上游登录、注册或关联；可带续接令牌（planned） |
| `GET meta` | 任何人 | 当前条款版本、注册与各上游是否开放 |

字段规则。长度按 Unicode 码点计；输入不去首尾空白（注册码与邀请码除外）；文字里有孤立的代理项（JSON 转义写出的半个 UTF-16 代理对）的字段不合规则：

| 字段 | 规则 |
|---|---|
| 用户名 | 3 到 30 个字符，只含小写字母、数字、下划线、点；输入只收 ASCII 的字母、数字、下划线、点，其中的大写字母按小写处理；全站唯一 |
| 显示名 | 1 到 50 个字符，可改 |
| 邮箱 | 合法的邮箱地址，至多 254 个字符，按小写比较，全站唯一；不收以 `.invalid` 结尾的地址（这个后缀留给占位邮箱） |
| 密码 | 8 到 128 个字符；登录时只查上限，不查下限：旧站导入的密码可能更短 |
| 头像与网站 | 只收以 `http://` 或 `https://` 开头、带主机的地址，不含空白、控制字符与双向控制符，至多 500 个字符；签名至多 200 个字符 |

配置：当前条款版本 `NB_SITE_IDENTITY_TERMS_VERSION`（必填；形如 `2026-11-20` 的真实存在的日期，服务条款与隐私政策共用一个版本）、注册是否开放 `NB_SITE_IDENTITY_REGISTRATION_OPEN`（`true` 或 `false`，缺省 `true`）、会话时长 `NB_SITE_IDENTITY_SESSION_DAYS`（2 到 365 的整数，缺省 30）、同时算密码哈希的个数 `NB_SITE_IDENTITY_HASH_CONCURRENCY`（1 到 16 的整数，缺省 2）、排队等着算哈希的请求数上限 `NB_SITE_IDENTITY_HASH_QUEUE`（0 到 10000 的整数，缺省 64）、Google 与 GitHub 的客户端 id 与密钥（planned）：`NB_SITE_IDENTITY_GOOGLE_CLIENT_ID` 与 `NB_SITE_IDENTITY_GOOGLE_CLIENT_SECRET`、`NB_SITE_IDENTITY_GITHUB_CLIENT_ID` 与 `NB_SITE_IDENTITY_GITHUB_CLIENT_SECRET`，一个上游的两项都给了就算开放，只给一项时启动失败；上游的地址缺省是 Google 与 GitHub 的正式地址，可由 `NB_SITE_IDENTITY_GOOGLE_ISSUER`、`NB_SITE_IDENTITY_GITHUB_URL`、`NB_SITE_IDENTITY_GITHUB_API_URL` 换掉，必须是 https，只有本机回环可以是 http。不合格时的问题词见 [`site.operations`](operations.md)。进程环境里有以 `BETTER_AUTH_` 开头、取值不为空的变量时启动失败（`config_invalid`，问题词 `not_allowed`，记在那个变量名上）：这类变量会绕过上面的配置改变账号的行为（例如会话的签名密钥）。

定时任务（名字给 [`site.operations`](operations.md) 输出 11 的测试控制入口用）：`purge` 每 10 分钟跑一次、服务启动后先跑一次，清掉已到期的会话（连同在它们里面发出的对外 OAuth 令牌与授权码，见 [`site.oauth-provider`](oauth-provider.md) 输出 8）、过期的社交流程与过期的授权码、令牌（planned）。

## 输出与可观察行为

1. **密码注册。** 请求带用户名、可选的显示名（省略时取请求里原样的用户名，保留大小写）、邮箱、密码、注册码、可选的邀请码、同意的条款版本、对境外存放的同意。全部合格时创建账号、记下同意记录、扣注册码一次、记邀请归属，并当场建立会话；响应是账号的公开资料。已登录时注册照样进行：浏览器换成新账号的会话，原来的会话不结束（与登录一样）。
2. **注册的原子性。** 注册码的扣减、账号、同意记录要么都发生要么都不发生：因用户名或邮箱重复等原因没建成账号时，注册码不被扣。同一个只剩一次的注册码被并发使用时，至多一个请求成功。
3. **注册的拒绝。** 注册关闭回 `registration_closed`；注册码不存在、停用、过期或用完回 `registration_code_invalid`；邀请码不存在、停用、过期或用完回 `invite_code_invalid`；条款版本不是当前版本、或没有同意境外存放回 `consent_required`（条款版本不是日期的写法时是字段不合规则）；用户名、邮箱被占用分别回 `username_taken`、`email_taken`；字段不合规则回 `validation_failed` 并列出字段。
4. **登录。** 请求带“用户名或邮箱”与密码；含 `@` 的按邮箱找，否则按用户名找；邮箱待补的账号不能用邮箱登录。凭据对、账号没被封禁时建立会话并回公开资料（与新会话同一时刻的资料：与改角色并发时，回的角色就是这个会话的角色）。凭据不对、账号不存在、账号没有密码都回同一个 `invalid_credentials`，响应时间不因账号是否存在而有可分辨的差别。被封禁的账号回 `account_banned`。请求可带 `continue`（[`site.oauth-provider`](oauth-provider.md) 输出 4 给的续接令牌）：登录成功且令牌合格时，响应另带 `continueUrl`（站内地址），浏览器去那里继续授权；令牌不合格或过期时照常登录、响应不带 `continueUrl`，不因此失败。（planned）注册（输出 1）与补交同意（输出 10）同样接受 `continue` 并按同样的规则给 `continueUrl`。（planned）
5. **会话。** 会话由名为 `__Host-nbsite.session_token` 的 HttpOnly、Secure、SameSite=Lax、`Path=/`、不带 `Domain` 的 Cookie 携带，作用域是站点地址（同一上级域名下的其它子域写不了它）；名字在版本之间不变（变了等于让所有人登出）。有效期为配置的会话时长，使用中会延长，每天至多延长一次。同一个账号可以同时有多个会话。登出只结束当前会话。
6. **会话失效。** 账号被封禁、角色被改、密码被改或被重置之后，这个账号在此之前建立的全部会话立即无效：带着它们的请求得到 `unauthenticated`。用户自己改密码时当前这一个会话保留。这些变更同时让这个账号此前发出的 OAuth 令牌失效，自己改密码时也包括当前会话里发出的；登出与结束单个会话让那次会话里发出的令牌失效，见 [`site.oauth-provider`](oauth-provider.md) 输出 8。（planned）
7. **问身份。** `whoami` 回三种之一：`{"state":"anonymous"}`；`{"state":"authenticated","user":{"id":数字,"username":…,"role":"user"|"admin"}}`；账号库不可读时回 503 与 `unavailable`。它不延长会话。
8. **读改资料。** `me` 回公开资料加邮箱、是否有密码、邮箱是否待补、是否还缺同意（同意记录不是当前条款版本，或没有对境外存放的同意，即输出 10 的门槛）。`PATCH me` 可改显示名、邮箱、头像、网站、签名；邮箱改成别人的回 `email_taken`。
9. **改密码。** 有密码的账号要带对的旧密码：旧密码不对回 `invalid_credentials`，没带回 `validation_failed`；没有密码的账号可以直接设。成功后按输出 6 失效其它会话。
10. **同意门槛。** 同意记录不是当前条款版本、或没有对境外存放的同意时，这个账号的会话只能调 `whoami`、`GET me`、`me/consent`、`logout`，账号模块的其它接口（含 [`site.admin`](admin.md) 与 [`site.oauth-provider`](oauth-provider.md) 的）回 `consent_required`；别的模块的接口不在此列。`me/consent` 交齐之后恢复；它带的条款版本不是当前版本、或没有对境外存放的同意时回 `consent_required`。
11. **社交登录的发起。**（planned） `social/:provider/start` 带意图：登录、注册、关联；登录与注册可带 `continue`（输出 4），关联不带。响应是要跳转去的上游地址。上游没开放回 `provider_disabled`。带的 `continue` 不合格或过期时照常发起，只是成功后不回到授权请求。
12. **社交登录。**（planned） 意图为登录、上游身份已关联某个账号时，回调后建立会话并跳回站点；上游身份没有关联任何账号时不建账号，跳回站点并带 `social_not_registered`。认人只按上游身份，不按邮箱；但上游这一次没给邮箱时（GitHub 账号没有主邮箱）登录失败，跳回带 `social_failed`（所用库的限制）。
13. **社交注册。**（planned） 意图为注册时，发起请求要先带齐注册所需的全部内容（用户名、可选的显示名、注册码、可选邀请码、两项同意），在跳去上游之前按输出 3 校验；不合格就不跳转。回调后邮箱取上游给的、上游标明已验证的地址（Google 要 `email_verified` 为真，GitHub 取已验证的主邮箱）；上游没给邮箱、或给的邮箱没验证过时，不建账号、不扣码，跳回站点并带 `social_email_missing`。注册的原子性同输出 2：发起时校验过的注册码、邀请码在回调时已不可用，或用户名、邮箱在这期间被占用时，不建账号、不扣码，跳回站点并带 `registration_code_invalid`、`invite_code_invalid`、`username_taken` 或 `email_taken`。这个上游身份已关联到某个账号时，不建账号、不建会话、不扣码，跳回站点并带 `identity_taken`（用它去登录页登录）。建成的账号没有密码，站点也不把这个邮箱算作已验证，之后用这个上游身份登录也不改变（[`site.oauth-provider`](oauth-provider.md) 输出 7 的 `email_verified` 恒为 `false`）。
14. **邮箱撞号。**（planned） 社交注册时上游给的邮箱已被别的账号占用：不建账号、不关联，跳回站点并带 `email_taken`。
15. **关联。**（planned） 意图为关联时，发起请求要有会话并带对的当前密码（没有密码的账号免）；回调只把上游身份关联到发起这次请求的那个账号。那个上游身份已关联别的账号回 `identity_taken`；这个账号在该上游已有身份（包括再关联一次同一个身份）回 `identity_exists`。两次关联同时进行时，同一个账号在同一个上游至多关联上一个，同一个上游身份至多关联到一个账号；没完成的关联至多挡住之后 1 分钟内同一个账号在该上游、或同一个上游身份的关联，之后不再挡。上游的邮箱不必与账号的邮箱相同，账号的邮箱也不因关联而改变。发起之后那次会话已失效的（包括回调已到、关联还没写入时被结束），回调不关联，跳回站点并带 `social_state_invalid`。
16. **解绑。**（planned） 解绑后账号至少还剩一种登录方式（密码或另一个上游身份），否则回 `last_login_method`。
17. **会话列表。** 列出自己每个会话的建立时间、最后使用时间（精确到一小时以内）、浏览器标识的概要（浏览器名与系统名，认不出时为空；不给原始的浏览器标识）、是否当前会话；可以结束其中任意一个。
18. **邀请码。** 用户可以生成邀请码，同时有效的至多 10 个，可以停用；已有 10 个有效的码时再生成回 `invite_code_limit`。生成按账号每小时至多 10 次（输出 19），停用了再生成也算。新生成的码不限次数、不过期；从旧站导入的码保留原来的可用次数与过期时间（planned）。列表里每个码有：码、建立时间、已用次数、可用次数与过期时间（没有时为空）、是否还能用。注册页接受 `/register?invite=<码>` 预填邀请码（planned）。
19. **限流。** 登录按三个键计：来源地址（每 5 分钟 30 次）、来源地址加用户名（每 5 分钟 10 次）、同一个用户名的失败次数（这一小时里满 20 次后，之后每次登录先等 2 秒，不锁死）。注册按来源地址每小时 5 次，改密码按账号每小时 5 次，生成邀请码按账号每小时 10 次。超限回 `rate_limited` 与 `Retry-After`。来源地址只从可信代理的转发头取；取不到时请求回 `forbidden_origin`，不与别的请求合并计数。计数按对齐的时间窗算：窗从整点起按窗长切，所以跨过边界的一个窗长里可以到两倍。IPv6 来源按前 64 位算一个，另按前 48 位合计，额度是单个来源的 16 倍。每次尝试都计入；在哪个键上被限流拒绝，那一次就不计入哪个键；被来源地址的计数拒绝的登录不再计入来源加用户名（一个来源换着用户名也占不满键）。IPv6 的前 64 位与前 48 位当一个来源判：任一个超限都算来源被拒，两个都不计入。这里的“用户名”是规范化后的登录名：转成小写，是邮箱时就是那个邮箱。成功的登录不清零失败计数。每个计数的键超过 10 万个时，窗口内新出现的键共用一份溢出额度，为该计数上限的 10 倍；失败计数的键超过 10 万个时，新出现的用户名一律先等 2 秒。
20. **过载。** 同时在算的密码哈希有上限，个数与排队的长度分别由 `NB_SITE_IDENTITY_HASH_CONCURRENCY` 与 `NB_SITE_IDENTITY_HASH_QUEUE` 定；排队的请求超过上限或等待超过 5 秒时回 `overloaded`，不无限排队。登录、注册、改密码与管理员重置密码（[`site.admin`](admin.md) 输出 4）都要算哈希，都可能回 `overloaded`。
21. **旧密码格式。** 以旧站格式存着的密码能照常登录；登录成功后它被换成新格式，之后仍能用同一个密码登录。换格式不会覆盖在这次登录期间被改掉或重置的密码。
22. **错误形状。** 失败的响应体是 `{"error":{"code":…,"fields":[…]?}}`，`code` 是下文失败表里的稳定值；`fields` 只在 `validation_failed` 时有，是不合规则的字段名的数组，字段名就是请求体里的键名；不带给人看的文字、堆栈与内部路径。请求体超过 16 KiB、不是 JSON 或不是对象时回 `validation_failed`，`fields` 为空数组。不需要参数的写接口（登出、结束会话、生成邀请码，以及 [`site.admin`](admin.md) 里的封禁、解封、结束全部会话、重置密码）请求体可以为空；给了请求体时必须是没有键的 JSON 对象，否则同样回 `validation_failed`、`fields` 为空数组。成功而没有内容可回的接口（登出、改密码、结束会话）回 `{}`。账号的所有响应都带 `Cache-Control: no-store`：回答随会话变化，不能被代理或浏览器缓存。
23. **社交流程的落点。**（planned） 上游回调处理完后，浏览器被带回站点的一个页面。登录或注册成功到 `/`，关联成功到 `/account`；发起时带了合格的 `continue` 的，登录或注册成功后到继续地址，回到那次授权请求，不到 `/`。没完成时带查询参数 `social_error=<码>`：登录意图回 `/login`，注册意图回 `/register`，关联意图回 `/account`；码是失败表里标“跳转参数”的五个，以及 `registration_code_invalid`、`invite_code_invalid`、`username_taken`、`email_taken`、`identity_taken`、`identity_exists`、`account_banned`。站点只显示它自己判出的码：回调地址里上游或旁人写进去的错误码一律显示为 `social_failed`。
24. **上游身份列表。**（planned） `me/identities` 的每项有 id、上游名、上游账号的名字与关联时间。上游账号的名字在注册或关联时记下，之后不随上游更新，只给本人看。

## 状态与转换

账号：`active` ⇄ `banned`（由管理员改）。会话：有效 → 失效（登出、被结束、到期、输出 6 的四种变更）。

时序与寿命：

- 注册成功的响应返回时会话已经可用。
- 登出的响应回 200 时，这个会话已经失效；账号库不可用而没能结束会话时，登出回 503 `unavailable`、不清 Cookie，会话仍然有效。
- 发起社交流程得到的跳转地址从发起起 10 分钟内有效，只能用一次：同一次流程的回调并发到达时至多一个生效；过期、重复使用、或回调时浏览器不是发起的那个时，回调跳回站点并带 `social_state_invalid`。（planned） 认浏览器靠发起时种下的 state Cookie。（planned） 与结束会话同时到达的关联回调可能仍关联上：复核会话与写入关联之间隔着一次库写。（planned）
- 封禁与登录并发时：封禁完成之后到达的登录被拒；封禁完成之前已经建立的会话按输出 6 失效。
- 改密码或重置密码与登录并发时：改动完成之后才建成的会话，即使它的密码校验发生在改动之前，也无效；这次登录回 `invalid_credentials`。
- 重启服务不影响已有会话；限流的计数在重启后清零。

## 副作用与数据

- 账号、会话、上游身份（连同上游账号的名字）、注册码与邀请码的使用、同意记录都落在账号模块的库里。密码只存哈希。注册码与邀请码存原文（管理员要能看到）。不存上游给的访问令牌、刷新令牌与 id_token，只存上游身份与上游账号的名字。（planned）
- 会话不存来源地址；浏览器标识只存概要（浏览器名与系统名），不存原始的写法。
- 账号的数字 id 一经分配不变、不重用。

## 失败与恢复

| 码 | HTTP | 含义 | 调用方怎么办 |
|---|---|---|---|
| `validation_failed` | 400 | 字段不合规则 | 按 `fields` 改 |
| `unauthenticated` | 401 | 没有有效会话 | 登录 |
| `invalid_credentials` | 401 | 凭据不对 | 重试 |
| `account_banned` | 403 | 账号被封禁 | 联系管理员 |
| `forbidden_origin` | 403 | 来源头不对或取不到来源地址 | 从站点页面发起 |
| `consent_required` | 403 | 缺当前版本的同意 | 走同意页 |
| `registration_closed`、`provider_disabled`（planned） | 403 | 功能没开放 | 无 |
| `registration_code_invalid`、`invite_code_invalid` | 422 | 码不可用 | 换码 |
| `username_taken`、`email_taken`、`identity_taken`（planned）、`identity_exists`（planned） | 409 | 已被占用 | 换一个或先登录再关联 |
| `last_login_method`（planned） | 409 | 解绑后没有登录方式 | 先设密码 |
| `invite_code_limit` | 409 | 有效的邀请码已有 10 个 | 先停用一个 |
| `social_not_registered`、`social_email_missing`、`social_state_invalid`（planned） | 跳转参数 `social_error`（输出 23） | 社交流程没完成 | 按页面提示重来或先注册 |
| `social_cancelled`、`social_failed`（planned） | 跳转参数 `social_error`（输出 23） | 在上游取消了，或上游出错 | 重新发起 |
| `rate_limited` | 429 | 超限 | 等 `Retry-After` 秒 |
| `overloaded`、`unavailable` | 503 | 过载或账号库不可用 | 稍后重试 |
| `not_found` | 404 | 没有这个接口，或会话、邀请码不是自己的、不存在 | 无 |
| `internal` | 500 | 程序自身的错误 | 稍后重试，仍失败就报告缺陷 |

同时有几处不合格时，回下面先后里的第一个。字段不合格的请求不计入限流。请求体超过 16 KiB 的请求在来源头之后、下面别的检查之前就回 `validation_failed`（读体之前就要拦下）。

- 注册：`forbidden_origin`、`registration_closed`、`validation_failed`、`rate_limited`、`consent_required`、`registration_code_invalid`、`invite_code_invalid`、`username_taken`、`email_taken`。码在占用之前查，没有可用注册码的人试不出哪些用户名与邮箱已被注册。
- 登录：`forbidden_origin`、`validation_failed`、`rate_limited`、`overloaded`、`invalid_credentials`、`account_banned`。封禁在密码之后查，不知道密码的人试不出谁被封了。
- 生成邀请码：`validation_failed`、`rate_limited`、`invite_code_limit`。

## 边界与兼容

- 公开接口是上表的路径、字段规则与失败码；只追加，不改已有码的含义。
- 浏览器只和上表的接口、标准 OAuth 端点、上游回调（`/api/identity/auth/callback/google`、`/api/identity/auth/callback/github`）打交道；这些之外的身份地址从外部不可到达（见 [`site.oauth-provider`](oauth-provider.md) 输出 1）。
- 信任边界：请求体、来源头、随社交流程带回的内容都当不可信输入校验。

## 验收与 Smoke

1. 只剩一次的注册码，8 个并发注册：恰好 1 个成功，码显示用了 1 次。
2. 用重复的用户名注册：失败，同一个注册码随后仍可用于另一个用户名。
3. 登录后由管理员封禁：原 Cookie 调 `me` 得 `unauthenticated`，再登录得 `account_banned`。
4. 仿真上游走社交注册：缺注册码时不跳转；带齐后回调建出账号并有会话；同一个上游身份再次以登录意图回来直接登录。（planned）
5. 已有密码账号的邮箱与上游给的邮箱相同：社交注册被拒，原账号仍只有密码一种登录方式。（planned）
6. 条款版本提高后：旧会话调 `me/invite-codes` 得 `consent_required`，补交同意后恢复。
7. 用旧密码的登录在密码校验通过之后、会话建成之前，管理员重置了这个账号的密码：这次登录得 `invalid_credentials`，没有留下可用的会话。
8. 只剩一次的注册码，两个仿真上游的社交注册并发回调：恰好一个建出账号，另一个跳回 `/register` 带 `registration_code_invalid`；没有留下没有资料的账号。（planned）
9. 社交注册发起之后、回调之前停用它用的注册码：回调跳回 `/register` 带 `registration_code_invalid`，不建账号。（planned）
10. 社交流程的回调过了 10 分钟（推测试时钟）或第二次到达：跳回落点页带 `social_state_invalid`，不建会话。（planned）
11. 带着有效 `state` 但 `error=username_taken` 的回调：落点页的码是 `social_failed`；`error` 是所用库的码（例如 `account_already_linked_to_different_user`）时也是 `social_failed`，只有 `error=access_denied` 是 `social_cancelled`。（planned）
12. 关联发起之后结束那次会话：回调不关联，跳回 `/account` 带 `social_state_invalid`。（planned）
13. 浏览器 A 发起社交登录，把上游给的回调地址拿到浏览器 B（另一份 Cookie）打开：跳回带 `social_state_invalid`，B 没有会话；注册意图时不扣码，关联意图时不关联。（planned）
14. 同一个上游身份，一个账号的关联与另一个人的社交注册并发回调：至多一边成功；注册输了的不建账号、不扣码，跳回带 `identity_taken`。（planned）

Smoke：合同测试包里账号的注册、登录、问身份用例。

## 实现合同

- 公开入口：`@notnotype/nb-site-identity` 的 `createIdentityModule`（账号子应用、`whoami`、`purge` 任务、关闭）、`parseIdentityConfig`、`identityMigrations`、`createAdminCommand`；请求与响应的 schema、失败码、字段规则与路径在 `@notnotype/nb-site-identity-contract`。
- owner 是 `nb-site-identity`；依赖 Better Auth（只发会话、认 Cookie，不挂它的路由，[ADR 0063](../../adr/0063-official-site-identity-own-routes-library-sessions.md)）、Hono、`bun:sqlite` 与合同包，由进程入口 `nb-site-server` 装配，不反向依赖入口。
- 账号库的所有读写都经一条连接上的队列（`read`、`write`、`withLibTransaction`）；会话只经会话模块的那组函数删，删在调用方的写事务里。
- 登录在发会话的库事务里复核封禁与刚校验过的哈希，并在同一事务里读出回给调用方的资料；失败的回应从拿到哈希名额起补到下限。
- 每个写接口在写事务的第一步复核会话还在（管理处置另复核操作者仍是未封禁的管理员），改动与审计在同一事务里提交。

## 证据

- 批准依据：[官方站重写](../../proposals/official-site-rewrite.md)、[ADR 0060](../../adr/0060-official-site-identity-on-better-auth.md)、[ADR 0063](../../adr/0063-official-site-identity-own-routes-library-sessions.md)
- 实现入口：[`packages/nb-site-identity/src/index.ts`](../../../packages/nb-site-identity/src/index.ts)
- 合同测试：[`accounts.test.ts`](../../../packages/nb-site-contract-tests/src/accounts.test.ts)、[`accounts-register.test.ts`](../../../packages/nb-site-contract-tests/src/accounts-register.test.ts)、[`accounts-me.test.ts`](../../../packages/nb-site-contract-tests/src/accounts-me.test.ts)、[`accounts-limits.test.ts`](../../../packages/nb-site-contract-tests/src/accounts-limits.test.ts)
- Smoke：[`accounts-register.test.ts`](../../../packages/nb-site-contract-tests/src/accounts-register.test.ts)、[`accounts.test.ts`](../../../packages/nb-site-contract-tests/src/accounts.test.ts)
