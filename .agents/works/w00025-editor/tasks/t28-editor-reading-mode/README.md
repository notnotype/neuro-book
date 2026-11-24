---
schema: nbook.task/v2
taskId: t28-editor-reading-mode
status: planned
updated: 2026-11-24
---

# 章节编辑器的阅读模式

## 目标与范围

章节的富文本编辑器（`MarkdownControl`）加一个阅读模式：只读、不会误改，作者可以在阅读与编辑之间切换。

来由：开发者 2026-11-24 在确认 w00039 t39（条目主文字的整篇编辑器）的计划时说：“打开就能打字当然还要有只读模式（现有的章节编辑器也应该有阅读模式）”，并同意为它在本 Work 建 Task（“可以去建一个 task”）。

范围待开工时定，已知要回答的：开关放在哪（工具栏、标签的右键菜单、命令与键位）；阅读时工具栏与各菜单是否隐藏；选择按标签记还是按文件记、重开以后是否沿用；与文件被外部删除后的只读、自动保存怎样并存；w00039 t39 的条目编辑器若先做出同样的开关，两处的说法与外观保持一致。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 与 [`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)，开工时加 planned 的条目。

## 当前状态

2026-11-24 新建，未开工。

## 下一步

轮到时先和开发者确认上面几件事，再写计划。
