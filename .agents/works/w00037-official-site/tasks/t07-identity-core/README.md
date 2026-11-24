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

前置：[t05](../t05-scaffold/README.md)。

第五轮探针（2026-11-24，库 1.7.27、`bun:sqlite`；报告 [`evidences/better-auth-spike-5.txt`](evidences/better-auth-spike-5.txt)，结果行 [`evidences/better-auth-spike-5-out.txt`](evidences/better-auth-spike-5-out.txt)）把 ADR 0060“后果”一节没核对的三处跑出来了。写计划时照这些做：

- **换哈希**：库没有现成挂钩。在 `hooks.after` 里，`newSession` 有值即登录成功，从请求体取明文；用“id 相同且哈希仍是刚读到的那条”作条件替换，不用库的 `updatePassword`（它不比较，实测会把并发的管理员重置盖回旧密码）。换哈希包住错误：钩子里抛错时登录回 500 而会话已写入。
- **重置密码与登录并发**：库在校验密码之后、建会话之前不再读哈希，实测旧密码能在重置之后拿到有效会话。做法是在校验时记下那条哈希，建会话之后比对，不一致就重验，不过就删掉刚建的会话。合同已补：`site.accounts` 的“时序与寿命”与验收 7。
- **限流**：库只按“来源地址加路径”计；取不到地址时所有请求共用一个桶（一个人连错 3 次，10 秒内谁都登录不了）；只在 `auth.handler` 上生效；429 带的是 `X-Retry-After`。合同要的键与回应它给不了：整体关掉库的限流（`rateLimit.enabled: false`），在 Hono 一层按 `site.accounts` 输出 19 自己做。
- **刷新令牌**：归 [t08](../t08-social-login-and-oauth-provider/README.md)。

没核实的：封禁与登录并发只从源码读到建会话时会查封禁，没跑并发；授权中途登录的路径上换哈希是推断。

第六轮探针（[t08 的证据](../t08-social-login-and-oauth-provider/evidences/better-auth-spike-6.txt)）查出一处要在本 Task 建表时就处理的：**SQLite 上数字 id 会被复用**。库建的表没有 `AUTOINCREMENT`，新行会拿到刚被删掉的最大 id。实测：封禁一个账号（它的会话被删）之后另一个用户登录，拿到同一个会话 id，被封账号没用掉的授权码随即换出了有效令牌。`site.accounts` 也要求账号的数字 id 不重用、导入后新账号的 id 大于所有旧 id。做法：账号库的迁移由库导出的表结构手工改写，凡用数字 id 的表都加 `AUTOINCREMENT`；写计划前先探一遍库在这样的表上能不能正常工作，并用“删掉最大 id 的会话后再登录，新会话的 id 更大”验证。

审查：安全边界，按高风险后端做快速审查。

前端定稿带来的两处（2026-11-24，[`site.admin`](../../../../../docs/specs/site/admin.md) 已写进去）：管理列表按页码翻页并回总条数与各筛选项的条数，翻页的基准由 `anchor` 带着（输出 9、10 与验收 4）；账号列表要给“最近一次登录成功的时间”，结束会话会删掉会话行，所以这个时间要单独存在账号上，写计划时定存在哪。

## 下一步

开工时写实施计划。
