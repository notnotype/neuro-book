---
schema: nbook.task/v2
taskId: t33-workbench-layer-split
status: active
updated: 2026-11-18
---

# 拆出工作台层：新包 nb-workbench-layout

## 目标与范围

按提案第一档第 1 项与 ADR 0054：布局文档、投影、落点规则、presented-ids、夹具、TabStrip 与标签条几何搬进不发布的 nb-workbench-layout；L1 里带工作台概念的文件按提案“分层与新包”逐个处理；boundary.test 改三层规则；插件 SDK 的 Splitter 类型与 TabStrip 保留旧名作别名

合同：行为合同未变（只搬家、改依赖与导入）；实现合同与证据里的路径改到新包：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“分层与新包”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 1 条。

## 当前状态

2026-11-18 开工，计划第 1 稿见 [`plan.md`](plan.md)。

## 下一步

计划的设计审查（Claude Sonnet），处理完开 worktree 做第 1 片。
