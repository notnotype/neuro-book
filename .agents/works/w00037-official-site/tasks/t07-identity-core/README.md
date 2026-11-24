---
schema: nbook.task/v2
taskId: t07-identity-core
status: planned
updated: 2026-11-24
---

# 账号核心：注册与登录、注册码与邀请码、会话、同意记录、管理接口、限流

## 目标与范围

账号模块里不含社交登录与对外 OAuth 的部分：密码注册与登录、两种码、会话与失效、资料与密码、同意记录、问身份端点、管理接口与审计、限流、管理员初始化命令。

合同：[`site.accounts`](../../../../../docs/specs/site/accounts.md) 的输出 1 到 10、17 到 22，[`site.admin`](../../../../../docs/specs/site/admin.md)，[`site.operations`](../../../../../docs/specs/site/operations.md) 输出 5（创建管理员）；库的用法见 [ADR 0060](../../../../../docs/adr/0060-official-site-identity-on-better-auth.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：密码注册与登录、注册码与邀请码、会话与失效、资料与密码、同意记录与同意门槛、“问身份”端点、管理接口与审计、限流与哈希过载、旧密码格式的验证与升级、创建管理员的命令。不含社交登录与对外 OAuth。

前置：[t05](../t05-scaffold/README.md)。开工前要再探的三处（ADR 0060 后果一节）：登录后把旧哈希换成新算法、取不到真实 IP 时库的限流、刷新令牌（若不支持刷新令牌则这一条不适用）。

审查：安全边界，按高风险后端做快速审查。

## 下一步

开工时写实施计划。
