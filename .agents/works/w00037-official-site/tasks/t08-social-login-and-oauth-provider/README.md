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

前置：[t07](../t07-identity-core/README.md)。要开发者提供或决定的：Google 与 GitHub 的 OAuth 应用由开发者的账号注册（生产用的客户端 id 与密钥）；站点地址定死（它是签发者）。

待开发者定（2026-11-24 第五轮探针查出，报告见 [t07 的证据](../t07-identity-core/evidences/better-auth-spike-5.txt)的“对合同的影响”第 1 条）：`site.oauth-provider` 里“不支持 `openid` 范围、不发 id_token”与“用户信息端点回资料”，靠库的配置不能同时成立。库的用户信息端点对不带 `openid` 的访问令牌一律回 400；带 `openid` 就发 id_token。三条路：按标准 OpenID Connect 做（接受 `openid`、发 id_token、公开公钥地址）；自己写用户信息端点并按库的存储格式验令牌；内部补 `openid`、用钩子把 id_token 去掉。“不发 id_token”是主会话写 Spec 时选的假设，提案里写的是“写 Spec 时定”。定下之前不写这一段的计划。

探针另外确认的：服务方范围收成 `profile`、`email` 且许可类型只留授权码时，不发刷新令牌，`grant_type=refresh_token` 回 400；库缺省的授权码有效期是 600 秒，要配成 60 秒；缺省配置下刷新令牌不随封禁与重置密码失效，所以以后若要支持刷新令牌，得先补这一条。

审查：安全边界，按高风险后端做快速审查。

## 下一步

开工时写实施计划。
