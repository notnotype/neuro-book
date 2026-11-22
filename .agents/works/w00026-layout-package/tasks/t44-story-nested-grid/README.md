---
schema: nbook.task/v2
taskId: t44-story-nested-grid
status: active
updated: 2026-11-22
---

# nb-story 三栏改用 NestedGrid

## 目标与范围

nb-story 网页的“导航 | 正文 | 右侧详情”从 `Splitter` 改成 nb-layout 的 `NestedGrid` 加 `useGridHost`：收起、宽度记忆、三档（宽、详情浮起、手机）照旧，外观不变。这是第二档的第一个外部使用方（ADR 0054 第 8 条），按公开入口接，记下接入时缺什么、别扭什么。t45（并排看卡片）在它之上做。

合同：[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 1、32、33，行为不变。

## 当前状态

2026-11-22：[计划](plan.md)第 2 稿：设计审查（Claude Sonnet）10 条（重要 5、建议 5）都成立，第 5 条部分采纳，处理见计划的“修订记录”，[证据](evidences/design-review.txt)。改前探针已在分支起点跑过。

## 下一步

处理设计审查，按计划实施。
