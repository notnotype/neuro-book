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

审查：安全边界，按高风险后端做快速审查。

## 下一步

开工时写实施计划。
