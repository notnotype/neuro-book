---
schema: nbook.task/v2
taskId: t04-failure-details
status: planned
updated: 2026-10-27
---

# 失败详情组件与常驻通知

## 目标与范围

给界面一个统一放开发诊断原文的“详情”载体，ADR 0034 要求诊断原文只进详情、不当主文案，而现在只有两三处界面放得下（w00031 t03 前端计划审查第 1 条）。2026-10-27 从 t01 拆出：它是 UI 组件决策，与目录机制无关（t01 拉远看审查第 5 条）。

要定的：

- nb-ui 的详情组件：可展开、可复制；先比较已有的 `Collapsible`、`CollapsibleRow`、`CodeBlock`；`navigator.clipboard` 在非安全上下文不可用时的退路；单行位置（状态栏、编辑器横幅、资源管理器结果区）放不下展开态时怎么办。
- 通知：自动消失由 `useNotification` 的队列负责，`Notification` 组件不管；带详情的通知是否常驻、常驻的数量上限；`NotificationInput` 的标题与正文改成到渲染时才翻译的文字值（否则切换语言不更新），它同时是跨插件服务与 SDK 的类型。
- `Notification` 根节点的 `select-none` 与“可复制详情”的冲突。

依据：[t01 前端计划审查](../t01-requirements/evidences/plan-review-sonnet-frontend.txt) 第 2、11 条；[w00031 t03 前端计划审查](../../../w00031-language-policy/tasks/t03-failure-projection/evidences/plan-review-sonnet-frontend.txt) 第 1 条。界面设计按 `design-review` Skill 给开发者看稿。

合同：会改 `packages/nb-ui` 的 `Notification` 合同与 [`workbench/notifications.md`](../../../../../docs/specs/workbench/notifications.md)，开工时列出具体文件。

## 当前状态

2026-10-27 建，未开工。提案已接受、t03 已交付（2026-10-29）；2026-11-07 开发者同意的顺序：先做本 Task，再重写 w00031 t03 的计划（它要用这里的“详情”载体）。本 Task 做完即可收口 w00028。

## 下一步

开工时先写设计稿给开发者看。
