---
schema: nbook.task/v2
taskId: t08-live-drag
status: planned
updated: 2026-11-05
---

# Trellis 模式的拖动

## 目标与范围

加候选树预览与动画：卡片跟手、邻居实时让位、来源收起、取消飞回、落点稳定后才换预览（Trellis 文档是 150ms）、松手提交指针下的候选。VS Code 模式保留，各场景的默认模式按 t02 的结论定。遵守系统减少动效。

t06 手感确认后过渡合同变了：前后都有尺寸的叶内容逐帧跟外框，不再“只排一次版”（[nested-grid 的“过渡”](../../../../../../docs/specs/ui/nested-grid.md)）。实时布局里每换一次候选邻居都要逐帧重排，长章节的代价要在这里重新量，数据见 [t06 的测量](../t06-flat-renderer/evidences/follow-content.txt)。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 下一步

待补充。
