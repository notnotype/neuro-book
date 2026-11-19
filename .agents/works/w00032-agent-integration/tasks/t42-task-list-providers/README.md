---
schema: nbook.task/v2
taskId: t42-task-list-providers
status: planned
updated: 2026-11-19
---

# 后台任务清单的提供方与分组视图

## 目标与范围

按已接受的[提案“统一后台任务”](../../../../../docs/proposals/unified-background-tasks.md)第四节第 2 小节与 [ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md) 改 `nbook.tasks`：

- 提供方：服务端插件登记成提供方、交出行与变化、执行转来的操作；自己的任务（`start()`）规则不变。
- 行的字段（归属、种类、形态、操作、打开的去处）与按编码大小的上限；操作带注册代次，旧点击得“目标已不在”；按筛选分页、计数取汇总；一家出错只影响它自己；停止分已受理、没受理、未知；打开走拥有对象的插件的导航、如实报失败。
- 视图按归属分组（缺省当前项目、应用与全部会话，能切到全部项目），按形态与种类筛选；通知与看过只对自己的任务；远程合同升版本。
- Agent 作为提供方交出的行（后台任务、在跑或等你处理的根会话、没有任务覆盖的在跑子会话）放在 t22 还是本 Task，开工时按两边进度定。

合同：改 [`workbench/background-tasks.md`](../../../../../docs/specs/workbench/background-tasks.md)（先写 planned）。

依赖：无；可与 t41 并行。

## 输入

两轮提案审查（证据在 [t22](../t22-background-work/README.md) 的 `evidences/`）里归本 Task 的：

- [第一轮](../t22-background-work/evidences/proposal-review-r1.txt)：5、7、8、11、12、16、17、18、19、21、24、27、28（多数已在第 2、3 稿处理，作背景）。
- [第二轮](../t22-background-work/evidences/proposal-review-r2.txt)：11（注册代次）、12（大小与分页）、13（提供方隔离与撤回）、14（按归属的导航）、15（停止的结果）、17（没有任务覆盖的子会话）。

## 当前状态

2026-11-19 经 nbdev 新建，尚未开工。

## 下一步

开工时先出“后台任务”视图分组的界面静态稿（[design-review](../../../../skills/design-review/SKILL.md)），同时写提供方合同的 planned Spec 与计划。
