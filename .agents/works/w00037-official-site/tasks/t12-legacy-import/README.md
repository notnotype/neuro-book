---
schema: nbook.task/v2
taskId: t12-legacy-import
status: planned
updated: 2026-11-24
---

# 旧站数据导入与切换演练

## 目标与范围

一次性的导入命令与逐字段的去向表；在副本上演练并按主键与关系核对；写切换与退回的步骤。读生产快照要另取开发者授权。

合同：[`site.legacy-import`](../../../../../docs/specs/site/legacy-import.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：预检与导入两个命令、合成旧库的测试、在生产快照的副本上演练并按主键与关系核对、切换与退回的步骤。

前置：[t07](../t07-identity-core/README.md)、[t08](../t08-social-login-and-oauth-provider/README.md)（导入的 GitHub 身份要能登录）。要开发者授权的：取生产数据库与文件卷的快照。预检若报出不合规则的用户名，处理规则交开发者定。

## 下一步

开工时写实施计划。
