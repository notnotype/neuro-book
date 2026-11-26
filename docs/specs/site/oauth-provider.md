---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: site.oauth-provider
owners:
  - nb-site-identity
---

# 官方站：对外 OAuth 服务

## 目标与非目标

让别的应用用官方站的账号登录：管理员登记客户端，客户端按 OpenID Connect 的授权码流程（加 PKCE）拿到访问令牌与 id_token，再从用户信息端点取用户的基本资料。账号本身见 [`site.accounts`](accounts.md)。

不承诺：

- 不支持隐式流程、混合流程、密码流程、客户端凭据流程、动态客户端注册。
- 不支持设备码流程（等 NeuroBook 应用要接登录时另加）。
- 不支持刷新令牌：访问令牌到期后重新走授权。
- 不提供令牌内省端点。
- 不提供 RP 发起的登出、会话管理、前通道与后通道登出。
- 不支持 `request`、`request_uri` 参数，`claims` 参数不起作用；`prompt` 只支持 `none`、`login`、`consent`。
- 客户端认证不支持 `client_secret_post`、`client_secret_jwt`、`private_key_jwt`；不支持 DPoP 绑定的令牌。

## 术语与参与者

- **客户端**：管理员登记的一个外部应用，分机密的（有密钥）与公开的（没有密钥）。
- **资源所有者**：在授权确认页上点同意的用户。
- **签发者**：站点地址的 origin，不带路径（生产为 `https://nbook.notnotype.com`）。
- **授权**：某个用户对某个客户端同意过的一组范围；免确认的客户端不产生授权。
- **续接令牌**：授权端点把人带去登录页或站点同意页时附上的不透明字符串，代表这一次授权请求；只在站内的页面与接口之间原样传递。

## 输入与前置条件

标准端点（发现文档里也给出这些地址）：

| 端点 | 方法 | 地址 |
|---|---|---|
| 授权 | GET、POST（表单） | `/api/identity/auth/oauth2/authorize` |
| 令牌 | POST | `/api/identity/auth/oauth2/token` |
| 用户信息 | GET、POST | `/api/identity/auth/oauth2/userinfo` |
| 撤销 | POST | `/api/identity/auth/oauth2/revoke` |
| 公钥（JWKS） | GET | `/api/identity/auth/jwks` |
| 发现文档 | GET | `/.well-known/openid-configuration`、`/.well-known/oauth-authorization-server` |

发现文档与公钥地址也收 HEAD：状态与头同 GET，不带正文；别的端点不收 HEAD。

自家接口，都在 `/api/identity/v1/` 下：

| 接口 | 谁能调 | 作用 |
|---|---|---|
| `GET oauth/authorization?request=<标识>` | 用户 | 读一次待确认的授权请求 |
| `POST oauth/authorization` | 用户 | 同意或拒绝这次授权，请求带 `request` 与 `accept`（布尔） |
| `GET me/grants`、`DELETE me/grants/:id` | 用户 | 列出、撤销自己给过的授权 |
| `GET admin/oauth-clients`、`POST admin/oauth-clients`、`PATCH admin/oauth-clients/:id`、`POST admin/oauth-clients/:id/rotate-secret` | 管理员 | 列出、登记、改动客户端，换密钥；`:id` 是客户端 id |

客户端的属性：名字（1 到 100 个字符，按码点计）、回调地址（一到五个）、种类（机密或公开，登记后不能改）、是否免确认（只用于自家的应用）、是否停用。机密客户端的认证方式是 `client_secret_basic`，公开客户端是 `none`。

回调地址都不含片段、用户信息、空白与控制字符，按种类再分：机密客户端只许 `https://`，主机不能是本机回环（`127.0.0.0/8`、`[::1]`、`localhost`）；公开客户端许同样的 `https://` 地址，另许 `http://` 且主机恰为 `127.0.0.1`、`[::1]` 或 `localhost`（端口任意），不许 `https://` 的回环地址与自定义协议。协议名不分大小写；判回环时结尾带点的 `localhost.` 与 IPv4 映射的 `[::ffff:127.0.0.1]` 也算，`app.localhost` 不算；公开客户端的 `http` 主机按原样比，`127.1` 这类简写不算回环。不合规则的回调地址登记不进（`redirect_uri_invalid`）。

范围只有 `openid`、`profile`、`email`；授权请求必须带 `openid`。

这些自家接口满足 [`site.accounts`](accounts.md) 的同意门槛（输出 10）、来源头规则与错误形状（输出 22）；标准端点不受来源头规则约束，错误形状按 OAuth 与 OpenID Connect 的规定。

## 输出与可观察行为

1. **只有列出的端点可达。** `/api/identity/auth/` 下只有上表的标准端点（每个只在它规定的方法上）与 [`site.accounts`](accounts.md) 里开放了的上游（Google、GitHub）的回调可达，`/.well-known/` 下只有两份发现文档；这两个前缀下的其它地址、其它方法一律回 404（授权端点收 GET 与 POST，不收 HEAD）。
2. **发现文档。** 两份发现文档内容相同。`issuer` 等于签发者；列出的每个端点地址都可达；只列本 Spec 支持的能力：`response_types_supported` 为 `["code"]`，`grant_types_supported` 为 `["authorization_code"]`，`code_challenge_methods_supported` 为 `["S256"]`，`token_endpoint_auth_methods_supported` 与 `revocation_endpoint_auth_methods_supported` 都为 `["client_secret_basic","none"]`，`scopes_supported` 为 `["openid","profile","email"]`，`subject_types_supported` 为 `["public"]`，`id_token_signing_alg_values_supported` 为 `["RS256"]`，`prompt_values_supported` 为 `["none","login","consent"]`，`response_modes_supported` 为 `["query"]`，`claims_supported` 是输出 7 与输出 11 出现的字段，`authorization_response_iss_parameter_supported` 为 `true`，`request_parameter_supported` 与 `request_uri_parameter_supported` 为 `false`。不出现内省、动态注册、登出端点，也不出现 DPoP 与 `claims_parameter_supported` 的字段。
3. **授权请求。** 请求必须带已登记且没停用的客户端、与某个登记值相等的回调地址（逐字相等；公开客户端的 `http` 回环地址不比端口，主机不分大小写、路径仍逐字比，`localhost` 与 `127.0.0.1` 不算相等）、`response_type=code`、`S256` 的 PKCE（机密客户端也要）、含 `openid` 且在允许之内的范围；可带 `state`、`nonce`、`prompt`、`max_age`、`response_mode=query`；`claims`、`resource` 与本条没列的参数被忽略，带不带结果相同（`resource` 不改变发出的访问令牌）。POST 发起时参数在 `application/x-www-form-urlencoded` 的请求体里，规则与 GET 相同；客户端从别的站点以 POST 发起时浏览器不带站点的会话 Cookie，按没有会话处理（输出 4）。客户端没登记或已停用、回调地址与登记的不等时不跳回客户端，浏览器被带到 `/oauth/consent?error=<码>`，码分别是 `client_not_found`、`redirect_uri_invalid`。其它不合格的跳回客户端并带标准的错误码：不带 `openid` 是 `invalid_scope`，带 `request` 或 `request_uri` 分别是 `request_not_supported`、`request_uri_not_supported`，`response_mode` 不是 `query` 是 `invalid_request`，查询串（POST 时是请求体）超过 4096 个字符是 `invalid_request`，原样与按标准编码重写后的长度各算一次。POST 的请求体超过 16 KiB 时读不到客户端与回调地址，回 400 `invalid_request`（JSON），不跳转。
4. **先登录。** 资源所有者没有会话（或输出 13 要求重新登录）时，授权端点把人带到 `/login?continue=<续接令牌>`。登录请求带上这个令牌、且它合格时，登录响应给出一个站内的继续地址，浏览器去那里就回到这次授权请求，请求的参数不变（`prompt=login` 与 `max_age` 已由这次登录满足，不再要求登录）。输出 3 收下的授权请求，参数再长，续接令牌也不因长度不合格。令牌被篡改或超过 10 分钟时照常登录，响应不带继续地址。从这样的登录页改走注册或社交登录时续接不丢，见 [`site.accounts`](accounts.md) 输出 4、11、23。
5. **确认。** 客户端不免确认、且这个用户没有对它给过覆盖本次范围的授权时（或请求带 `prompt=consent` 时），授权端点把人带到 `/oauth/consent?request=<标识>`；同意后带授权码跳回客户端，拒绝时带 `access_denied` 跳回。跳回的地址里带 `state`（原样）与 `iss`。同意过的范围之外多要了范围时重新确认。
6. **换令牌。** 机密客户端用 `client_secret_basic` 认证，公开客户端不带密钥、在请求里带 `client_id`；都要带与授权请求对应的 PKCE 校验值。成功时回一个不透明的访问令牌（`token_type` 为 `Bearer`）、它的有效期（1 小时）与 id_token（输出 11）。授权码 10 分钟内有效，只能换一次；重复使用、过期、PKCE 校验值不对都回 `invalid_grant`，不带校验值回 `invalid_request`；校验值不对或不带时码不被用掉，之后带对的照常换出。请求带 `DPoP` 头时回 `invalid_request`，不发令牌。请求里的 `resource` 参数被忽略。
7. **用户信息。** 带有效访问令牌（GET 或 POST，`Authorization: Bearer`）调用户信息端点，回 `sub`（账号的数字 id 的字符串形式）；有 `profile` 范围时另有 `preferred_username`（登录用的小写用户名）与 `name`（显示名）；有 `email` 范围时另有 `email_pending`（邮箱是否待补），它为 `false` 时另有 `email` 与 `email_verified`（站点不验证邮箱，恒为 `false`，用社交登录或关联过上游身份也不变），为 `true` 时不出现这两项。不出现别的字段（账号设了头像也不出现 `picture`）。
8. **令牌随账号失效。** 下面任一件事之后，此前发出的、受它影响的访问令牌调用户信息端点得 401，没用掉的授权码换不出令牌（`invalid_grant`）：
   - 账号被封禁、角色被改、密码被重置、管理员结束了它的全部会话：这个账号名下的全部；
   - 用户自己改了密码：这个账号名下的全部，包括在当前会话里发出的（当前会话本身保留）；
   - 一次会话结束（登出、在会话列表里结束它、到期）：在这次会话里发出的；
   - 用户撤销了对某个客户端的授权：这个账号在这个客户端名下的全部；
   - 客户端被停用：这个客户端名下的全部（换码回 `invalid_client`）；之后再启用，停用前发出的也不恢复。
   id_token 不随这些变更失效（输出 11）。
9. **登记客户端。** 只有管理员能登记、改动、换密钥；响应里给出客户端 id，机密客户端另给一次密钥，之后不能再读出。换密钥后旧密钥立即不能用。
10. **撤销端点。** 客户端可以撤销自己拿到的访问令牌：机密客户端用 `client_secret_basic` 认证，公开客户端在请求里带 `client_id`。撤销后这个令牌调用户信息端点得 401。撤销不存在的令牌、已撤销的令牌、别的客户端的令牌都回 200，后者不起作用；不带 `token`、`token` 为空或出现多次回 `invalid_request`；客户端认证的参数写法不合（同一个参数出现多次，或认证头与请求体里的凭据并存）也回 `invalid_request`，不当作撤销成功。
11. **id_token。** 换令牌的响应带 id_token：RS256 签名，头里的 `kid` 能在公钥地址里找到；载荷有 `iss`（签发者）、`sub`（与用户信息的 `sub` 相同）、`aud`（客户端 id）、`iat`、`exp`（签发后 1 小时）、`auth_time`（授权时那次会话建立的时间）、`at_hash`、`acr`（恒为 `"0"`）；授权请求带了 `nonce` 时原样带回。不带资料字段（用户名、显示名、邮箱只从用户信息端点给）。id_token 发出后收不回：客户端只在登录时用它认人，之后要知道账号是否仍可用就调用户信息端点。
12. **站点同意先于授权。** 资源所有者的会话不满足 [`site.accounts`](accounts.md) 输出 10 的同意门槛时，授权端点不发授权码、不显示确认页，把人带到 `/consent?continue=<续接令牌>`；补交同意的请求带上这个令牌且它合格时，响应给出继续地址，规则同输出 4（但不把这次补交当成重新登录；发起时已满足的 `max_age` 不因补交花的时间再要求登录）。请求带 `prompt=none` 时改为跳回客户端并带 `interaction_required`。
13. **prompt 与 max_age。** `prompt=consent` 总显示确认页；`prompt=login`，或现有会话自建立以来经过的秒数超过 `max_age` 时，要求重新登录（输出 4）；`prompt=none` 时不显示任何页面：没有会话跳回 `login_required`，需要确认跳回 `consent_required`，缺站点同意跳回 `interaction_required`。`prompt` 的其它值，或 `none` 与别的值同时出现，跳回 `invalid_request`。
14. **确认页的接口。** `GET oauth/authorization` 带确认页地址上的 `request`，回客户端名字、客户端回调地址的主机名（带非缺省端口时连同端口）、要的范围（`openid`、`profile`、`email` 的数组）。`POST oauth/authorization` 同意时回带授权码的跳回地址，拒绝时回带 `access_denied` 的跳回地址；页面把浏览器带去这个地址。`request` 被篡改或超过 10 分钟时两者都回 `authorization_expired`；这期间客户端被停用回 `client_not_found`，客户端的回调地址被改得不再匹配回 `redirect_uri_invalid`，同意与拒绝都这样，不给跳回地址。确认标识只代表这次授权请求，不绑定会话：同意或拒绝按提交时的会话算，有效期内可以再次提交（再次同意时再发一个授权码，前一个不作废，各自照输出 6 只能换一次）。
15. **已给的授权。** `GET me/grants` 列出自己的授权，每项有 id、客户端名字、范围、给出的时间；免确认的客户端不在列表里。`DELETE me/grants/:id` 撤销一项，效果见输出 8；撤销之后这个客户端的下一次授权请求重新显示确认页。不是自己的或不存在的 id 回 `not_found`。客户端登记后被改成免确认时，它的授权不再列出、按 id 撤销也回 `not_found`，改回要确认后重新出现；停用的客户端的授权照常列出。列表按给出的先后倒序。
16. **客户端列表与改动。** `GET admin/oauth-clients` 用 [`site.admin`](admin.md) 的分页参数与响应形状、列表稳定规则（输出 9、10），每项有数字 id（审计记录的对象 id）、客户端 id、名字、回调地址、种类、是否免确认、是否停用、登记时间；不含密钥。改动与换密钥的地址用客户端 id，没有这个客户端回 `not_found`。`PATCH admin/oauth-clients/:id` 可改名字、回调地址（规则同登记，按客户端的种类）、是否免确认、是否停用。对公开客户端换密钥回 `client_public`。
17. **公钥。** 公钥地址列出验 id_token 要用的公钥；重启服务后签名用的钥不变，之前签发、没到期的 id_token 仍能用公钥地址里的钥验过。换了会话密钥（`NB_SITE_SESSION_SECRET`）再启动时改用一把新钥签名，旧钥的公钥仍列在公钥地址 30 天，之前签发、没到期的 id_token 照样验得过。第一次启动时账号模块要在库里建签名钥：这时库被进程外占着写超过等锁上限，启动以 `start_failed` 失败，放开后重启即可。

## 状态与转换

授权请求：待登录或待站点同意 → 待确认 → 已同意（发出授权码）或已拒绝；授权码：未用 → 已用、过期或失效（输出 8）；访问令牌：有效 → 过期或被撤销；授权：给出 → 撤销。

时序与寿命：

- 授权端点每次把人带去登录页、站点同意页或确认页起，这个续接令牌或确认标识 10 分钟内有效；登录或补交同意之后回到授权端点时重新起算。
- 授权码 10 分钟内有效；访问令牌、id_token 各 1 小时。
- 同一个授权码被并发换多次时至多一次成功。
- 输出 8 的变更在它的响应返回时已经生效：之后到达的用户信息请求得 401、之后开始的换码被拒。与变更同时进行、已经认领了授权码的一次换码可能在变更之后仍发出一个有效的访问令牌，它至多活到自己的 1 小时有效期，或下一次撤到它的变更；这个窗口不超过 10 秒。会话到期没有响应，在它里面发出的令牌与授权码至迟在下一次 `purge` 任务（[`site.accounts`](accounts.md) 的定时任务）跑完后失效；这之前换它名下的码回 `invalid_request`，同样换不出令牌。
- 会话被结束之后才建立的会话，不让之前那次会话名下没用掉的授权码重新可用。
- 换回上一个版本（[`site.operations`](operations.md) 输出 7）期间结束的会话：那个版本不撤 OAuth 令牌，换回本版本后，它名下的访问令牌至迟在本版本的第一次 `purge` 任务（启动后先跑一次）跑完后失效。那个版本里自己改密码时，当前会话名下的访问令牌不被撤，至多活到自己的 1 小时有效期。
- 重启服务不影响已发出的令牌、待用的授权码与签名用的钥。

## 副作用与数据

- 客户端、授权、授权码、令牌与签名钥落在账号模块的库里；客户端密钥与访问令牌只存摘要；签 id_token 的私钥加密存放。
- 登记客户端、改动客户端（含停用）、换密钥各写一条审计记录，动作名分别为 `oauth_client.create`、`oauth_client.update`、`oauth_client.rotate_secret`，对象种类 `oauth_client`；参数不含密钥（[`site.admin`](admin.md) 输出 8）。
- 撤销授权、撤销令牌不写审计记录。

## 失败与恢复

标准端点用 OAuth 与 OpenID Connect 规定的错误码：`invalid_request`、`invalid_client`、`invalid_grant`、`access_denied`、`unsupported_grant_type`、`unsupported_response_type`、`invalid_scope`、`login_required`、`consent_required`、`interaction_required`、`request_not_supported`、`request_uri_not_supported`。用户信息端点按 RFC 6750 回 401 与只含 `Bearer` 质询的 `WWW-Authenticate`：不带令牌时响应体是 `invalid_request`、质询里不带错误码，令牌无效、过期或被撤销时质询与响应体都是 `invalid_token`。

自家接口与站点错误页的码：

| 码 | HTTP | 含义 | 调用方怎么办 |
|---|---|---|---|
| `authorization_expired` | 410 | 这次授权请求过期或被篡改 | 回到客户端重新发起 |
| `client_not_found` | 404；授权端点带到错误页时是查询参数 | 没有这个客户端，或它已停用 | 无 |
| `redirect_uri_invalid` | 400；授权端点带到错误页时是查询参数 | 登记或改动时：回调地址不合规则；授权与确认时：与登记的都不匹配 | 改地址 |
| `client_public` | 409 | 公开客户端没有密钥 | 无 |

其余码同 [`site.accounts`](accounts.md)。

## 边界与兼容

- 签发者地址、端点地址与公钥地址一经对外公布不再改变。
- 标准端点的行为按 RFC 6749、RFC 7636、RFC 8414、RFC 7009、RFC 6750、RFC 9207、OpenID Connect Core 1.0、OpenID Connect Discovery 1.0；本 Spec 只写选了哪些与本站特有的规则。
- `email_pending` 是本站的扩展字段，只追加，不改含义。
- 浏览器在授权流程里只和授权端点、登录页、站点同意页、确认页及它们调用的自家接口打交道；续接令牌与确认标识对浏览器是不透明的，它们的内容不属于本合同。
- 信任边界：授权请求的参数、续接令牌、确认标识都当不可信输入校验。

## 验收与 Smoke

1. 测试客户端走完整流程：授权 → 登录 → 确认 → 换令牌 → 取用户信息；同一个授权码再换一次被拒。
2. 普通用户调登记客户端的接口被拒；对 `/api/identity/auth/` 与 `/.well-known/` 下不在清单里的地址逐个请求都得 404，其中包括 `HEAD` 与 `PUT` 授权端点、内省、登出、自助登记客户端。
3. 拿到令牌后封禁该账号：用户信息端点得 401。
4. 改掉授权请求里的回调地址再继续：不跳回客户端，浏览器到 `/oauth/consent?error=redirect_uri_invalid`。
5. 拿到令牌后管理员重置该账号的密码：用户信息端点得 401。
6. 按发现文档的 `jwks_uri` 取公钥验 id_token：RS256 签名对，`iss`、`aud`、`nonce` 都对，`exp - iat` 为 3600。
7. 不带 `openid` 的授权请求跳回客户端并带 `invalid_scope`。
8. 没同意过的客户端带 `prompt=none`：跳回 `consent_required`；没有会话时跳回 `login_required`。
9. 用户撤销对某客户端的授权：此前的访问令牌得 401，没用掉的授权码换令牌得 `invalid_grant`，下一次授权请求显示确认页。
10. 账号 A 拿到授权码后被封禁，随后账号 B 登录：A 的那个授权码仍换不出令牌。
11. 撤销一个不存在的令牌得 200；公开客户端撤销自己的令牌后，那个令牌得 401。
12. 带 `DPoP` 头换令牌：回 `invalid_request`，不发令牌。
13. 登录续接：授权请求被带到 `/login?continue=…`，带着令牌登录后去响应给的继续地址，拿到授权码；`id_token` 的 `auth_time` 是这次登录的时间。篡改令牌或过了 10 分钟：登录成功、响应不带继续地址。
14. 从 `/login?continue=…` 改走仿真上游的社交登录：回调后回到授权端点，拿到授权码。
15. 同意门槛：条款版本提高后，旧会话发起授权被带到 `/consent?continue=…`；补交同意后去继续地址，拿到授权码。
16. 在当前会话里拿到令牌后自己改密码：当前会话仍可用，那个令牌得 401。
17. 同一账号两个会话各拿一个令牌，结束其中一个会话：它的令牌得 401，另一个照用。
18. 客户端多于一页：带第 1 页的 `anchor` 取第 2 页，期间新登记的客户端不出现。
19. 重启服务后，重启前签发、没到期的 id_token 仍能验过。
20. 测试客户端以表单 POST 发起授权，走完验收 1 的流程；跨站 POST 不带会话 Cookie 时先被带去登录，登录后经继续地址拿到授权码。
21. 查询串正好 4096 个字符的授权请求，分别经匿名登录、补交同意、确认三条路径都拿到授权码；4097 个字符的跳回 `invalid_request`。
22. 带 `resource` 的授权请求与换码请求：拿到的访问令牌与不带时同形（不透明），自己改密码后它得 401；id_token 照常签发。带 `response_mode=fragment` 的授权请求跳回 `invalid_request`，码在查询串里。

Smoke：合同测试包里的完整授权流程用例（含 id_token 的验证）。

## 证据

- 批准依据：[官方站重写](../../proposals/official-site-rewrite.md)、[ADR 0060](../../adr/0060-official-site-identity-on-better-auth.md)、开发者 2026-11-24 的决定（按标准 OpenID Connect；签发者为站点地址）与 2026-11-25 的四条决定（结束会话与改密码撤 OAuth 令牌、社交注册只收已验证邮箱、关联不要求邮箱相同），见 [t08 的 Task 记录](../../../.agents/works/w00037-official-site/tasks/t08-social-login-and-oauth-provider/README.md)
