---
schema: nbook.task/v2
taskId: t03-web-design
status: active
updated: 2026-11-18
---

# NeuroBook 里 bot 的界面设计评审

## 目标与范围

按 design-review 定 NeuroBook 里 bot 相关界面的外观与交互（[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 11 小节的合同是前提）：
- bot 视图：打开作品时的位置、书架案头的入口（看板娘）、未读的气泡与计数；
- 日程视图：列表、状态、两种表单、暂停与恢复、“待你确认”；
- 记忆的只读查看；
- 缓冲区的界面（[缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md)第四节第 7 小节）：排队区的“已暂停 · 原因 · 继续”、停止的两个选项。

先排注意力顺序，再在草稿 worktree 的 Lab 里出静态稿。

合同：行为合同未变，本 Task 不写 Spec；定稿的外观与交互由 t06、t07、t09、t10、t14 写进各自的 Spec。

依赖：无。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（2026-11-18 按已接受的 [bot 提案](../../../../../docs/proposals/neurobot.md) 与 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 重排）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工；2026-11-18 范围从 NeuroBot 的 web 改成 NeuroBook 里的 bot。

## 下一步

先用 `nbdev find` 查已有产物（含 w00032 t14 的对话视图静态稿），截 NeuroBook 现状，和开发者确认注意力排序，再出第一轮静态稿。
