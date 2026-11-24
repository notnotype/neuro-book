---
schema: nbook.task/v2
taskId: t04-adr-and-specs
status: planned
updated: 2026-11-24
---

# 官方站的 ADR 与 planned Spec

## 目标与范围

两份提案接受后，把长期决定写成 ADR，把官方站的行为写成 planned Spec；按切片逐份写，先写第一个实现切片要用的（运行与部署、账号）。动笔前把能力地图与每份 Spec 的假设交开发者确认。

合同：本 Task 的产出就是合同：[`site.operations`](../../../../../docs/specs/site/operations.md)、[`site.accounts`](../../../../../docs/specs/site/accounts.md)、[`site.admin`](../../../../../docs/specs/site/admin.md)、[`site.oauth-provider`](../../../../../docs/specs/site/oauth-provider.md)、[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md)、[`site.telemetry-dashboard`](../../../../../docs/specs/site/telemetry-dashboard.md)、[`site.legacy-import`](../../../../../docs/specs/site/legacy-import.md)。

## 当前状态

2026-11-24：开发者接受了提案与能力地图（“可以，先写吧”），要求先把 ADR、Task 与文档都写好。已写：ADR 0059、0060、0061，七份 `planned` Spec 并登记进注册表，`docs:check` 通过。Spec 没有另请审查者审。

## 写 Spec 时主会话替开发者选的假设（按“待确认默认追认”，有异议再改）

账号：

1. 用户名 3 到 30 个字符，只含小写字母、数字、下划线、点，输入不分大小写，注册后不能改；显示名 1 到 50 个字符。
2. 密码 8 到 128 个字符，不设复杂度规则。
3. 会话 30 天，使用中延长（每天至多一次）；同一账号多处登录并存；自己改密码时保留当前这一个会话。
4. 每人同时有效的邀请码至多 10 个。
5. 限流：登录每个来源每 5 分钟 30 次、来源加用户名每 5 分钟 10 次、同一用户名每小时失败 20 次之后每次先等 2 秒；注册每个来源每小时 5 次；改密码每个账号每小时 5 次。
6. 没同意当前版本条款的会话只能调问身份、读自己的资料、补交同意与登出。
7. 社交注册时上游没给邮箱就失败，不让用户另填一个。
8. 关联 Google 或 GitHub 要输当前密码（没有密码的账号免）。

账号管理：

9. 重置密码由系统生成新密码、只显示一次；不能删除账号；不能封禁或降级自己；不能让站里没有管理员。

对外 OAuth：

10. 不发 id_token、不支持 `openid` 范围、不支持刷新令牌；范围只有 `profile` 与 `email`；访问令牌 1 小时；每个客户端至多 5 个回调地址。

运行与部署：

11. 备份保留 7 份；停止时等在途请求至多 10 秒；缺省只监听本机回环。

统计：

12. 来源限流每 10 分钟 600 个请求；聚合每 10 分钟算一次；聚合只做“日期乘单个维度”的交叉，要别的交叉在原始上报还在的 7 天内加。
13. 看板里份数小于 5 的格子合并显示；留存看安装后第 1、2、4、8 周。

旧站导入：

14. 预检发现不合规则或转小写后重名的用户名就整体不导入、不自动改名；占位邮箱是 `u<id>@placeholder.invalid`。

## 下一步

开发者说开工后，从 [t05](../t05-scaffold/README.md) 开始；每个实现 Task 开工时先按当时的结果核对对应的 Spec。
