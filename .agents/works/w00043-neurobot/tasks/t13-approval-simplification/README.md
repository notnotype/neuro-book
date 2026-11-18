---
schema: nbook.task/v2
taskId: t13-approval-simplification
status: planned
updated: 2026-11-18
---

# Agent 审批：自有目录、去掉地址表、询问写明来源

## 目标与范围

按已接受的提案 [Agent 审批：一份自有目录、去掉 Agent 的地址表、询问写明来源](../../../../../docs/proposals/agent-approval-simplification.md) 改 `planned` Spec 并实现：

- 只写自有目录的调用在任何 Agent 模式、任何审批模式下放行；自有目录不含宿主写的子目录（名字不分大小写），一次调用里有 `cd`、`pushd`、`popd` 时相对的写重定向算不出；
- 删掉 `nbook.agent` 的地址分类表与套件文件访问的 `classify`，布局换成 `own`、`autoWrites`、`confirmWrites`；
- nb-harness 内核的询问与放行带宿主定义的 `cause`，写进审批请求与 `toolStarted.approval`；
- 审批向导写明这次为什么问，记住按钮按是否起作用显示，工具调用详情显示放行来源，设置页的固定说明与“逐个确认”的文案。

合同：行为合同要改，清单见提案“对 Spec 的预期改动”：[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)、[`agent/modes.md`](../../../../../docs/specs/agent/modes.md)、[`agent/resources.md`](../../../../../docs/specs/agent/resources.md)、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。

## 来源与决定

- 开发者 2026-11-18 嫌现行审批的四关太复杂，要求重理；第一稿（模式与审批模式都写成规则组）审查后撤回，第二稿经开发者同意两项待定、Opus 审查修订后接受。决定都记在提案的决策记录与 [w00043 README](../../README.md) 的决定表；两轮审查的处理在 [t01 的证据](../t01-direction/evidences/)（`approval-proposal-review-r1-disposition.md`、`approval-proposal-review-r2-disposition.md`）。
- bot 的 `bot://` 怎样进自有目录随 bot 的提案，不在本 Task。

## 当前状态

2026-11-18 建，尚未开工。

## 下一步

开工时先按提案改 `planned` Spec，再写计划（前后端都有，计划审查分开派）。
