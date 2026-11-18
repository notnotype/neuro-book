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

2026-11-10 经 nbdev 新建；2026-11-18 范围从 NeuroBot 的 web 改成 NeuroBook 里的 bot，同日开工。草稿在 `.worktree/w00043-t03-drafts`（分支 `w00043-t03/drafts`，不合并），组件 `drafts/web/components/BotMessenger/`。

决定：

1. 注意力顺序（开发者 2026-11-18“可以”）：bot 视图打开时先看最新的对话与输入框；等你处理的事（审批与提问停在停靠区、排队里已暂停的话与“继续”）出现时贴在输入框上方；日程与记忆默认收起，从视图头部的入口进；工具调用细节照现有对话视图折叠。关着时只留一个入口：头像加未读气泡，有等你处理的事时与普通未读区分。不自动收起。缓冲区的界面与 bot 视图放在同一轮看。
2. bot 的视图是 IM 式（开发者 2026-11-18：“bot 的最理想的视图就是 IM 软件视图，左侧是聊天、群聊，右侧是聊天界面”）。

第 1 轮评审板（[`artifacts/review/index.html`](artifacts/review/index.html)）问两题：左栏要不要放“会话”、打开作品时消息页放在哪。

## 下一步

等第 1 轮答复；下一轮画书架上的入口、日程与记忆的抽屉、缓冲区的排队区与停止的两个选项。
