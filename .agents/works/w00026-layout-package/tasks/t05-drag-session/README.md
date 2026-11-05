---
schema: nbook.task/v2
taskId: t05-drag-session
status: planned
updated: 2026-11-05
---

# 手势会话与落点登记

## 目标与范围

把工作台、编辑器标签、资源树三份拖动手势抽成 nb-layout 里的一份会话，取消规则统一（现在工作台那份不监听 lostpointercapture）；落点改成统一登记，取代资源树读 data-editor-group 标记；反馈做成可替换。行为按 Spec 不变，走样的取消规则按 Spec 改统一。

合同：[`ui/layout-drag.md`](../../../../../docs/specs/ui/layout-drag.md)（新建）；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 35 与 55、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“拖动”按它改。计划：[`plan.md`](plan.md)。

## 当前状态

Spec 草稿与计划已写，等开发者确认后开工。

## 下一步

开发者确认计划后，按 `plan.md` 的切片实施。
