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

## 下一步

开工时写实施计划。
