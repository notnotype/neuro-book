---
schema: nbook.task/v2
taskId: t41-config-error-reporting
status: active
updated: 2026-11-19
---

# 拖不动时报错：开发模式的配置错误各报一次

## 目标与范围

按提案“错误与诊断”与第一档第 5 项（从 t39 拆出）：sashSize 为 0、没接 onGestureCommit、contextKey 两处对不上、revision 没转交给 NestedGrid，开发模式下各报一次，判据用库内开关

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新输出 151（开发模式的配置检查），公开入口加 `setLayoutDevChecks`；被拒的提交与 `issues` 事件不变。

## 当前状态

2026-11-19 写计划第 1 稿（[`plan.md`](plan.md)），送设计审查（Claude Sonnet：前端包里的纯 TS 与组件）。

## 下一步

1. 设计审查，阻塞等结论；处理后写 Spec（planned），开 worktree 实施。
