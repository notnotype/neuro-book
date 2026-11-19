---
schema: nbook.task/v2
taskId: t36-explicit-exports-and-helpers
status: planned
updated: 2026-11-18
---

# 显式入口清单与导出名测试

## 目标与范围

按提案第一档第 4 项（“公开入口”）：两个入口改显式清单加导出名测试，求解器内部件不导出；`Splitter*` 手势类型改名 `GridGesture*`、`gesture-start` 的载荷起名并导出；子路径清单。第 5 项（`useDragSession`、`useGridHost`、收起与展开入口、拖不动时报错、起步材料）2026-11-19 拆到 [t39](../t39-layout-helpers-and-starter/README.md)：那一半是要先写 Spec 定形状的新 API，这一半是不改行为的整理，分开审、分开合。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-18 经 nbdev 新建，尚未开工。

- 带进来的事：t33 实现审查第 7 条，nb-layout 的分界规则（导出名、数据属性、类型名里不出现工作台概念，见 `packages/nb-layout/AGENTS.md`）只写在文档里、没有机检。导出名测试随本 Task 做时，加一份禁用词表一起拦（活动栏、状态栏、区域、容器、编辑组、具名面板一类），数据属性的字面量也扫；t33 README 列了有意留下的几个名字（`entryRect`、`data-drop-feedback-entry`、`FloatWindowHandles`、`LayoutFloatResize`），定表时一并判断。

## 下一步

待补充。
