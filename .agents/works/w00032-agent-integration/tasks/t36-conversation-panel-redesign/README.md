---
schema: nbook.task/v2
taskId: t36-conversation-panel-redesign
status: planned
updated: 2026-11-16
---

# 对话面板改版：面板头、第一屏、子会话与子代理管理、模型不可用提示

## 目标与范围

[t29](../t29-ui-polish-after-t15/README.md) 评审板（[第 1 至 6 轮](../t29-ui-polish-after-t15/artifacts/review/index.html)）定下的对话面板改版，2026-11-16 从 t29 拆出。决定原文以 t29 的决定 5–11 为准：

- 面板头不写“对话”，居中写会话：左新建、中间 Profile 图标与会话标题（下拉）、右边子代理入口、更多与框架按钮；没选会话时写“新对话”。要工作台让视图画自己面板头的标题区（拖动与读屏名称不变），`workbench/views.md` 加一条。
- 子会话：面板头左边是返回（只有图标），中间是子代理图标与标题。
- 子代理管理：面板头右边的入口（图标加个数，等你批准或回答、出错未看时有红点），点开浮层列出当前会话派出的全部子代理与孙代理，点一行进子会话，运行中的悬停可停止；没有子代理时不显示。
- 没选会话的第一屏照旧应用 `AgentChatEmptyState`：欢迎、最近对话（3 张卡片，“查看全部”打开会话列表）、“试试这些”（Profile 声明的开场指令，主创带三条；没有就不显示这一块）；状态栏整行空着。
- 顶栏下、输入框上的两条横线去掉，消息在顶栏下淡出。
- 模型不可用的提示：压在输入框上沿的浮层提示卡，写明哪个角色或服务商，按钮直达对应的设置（模型角色页定位到这个角色、服务商页、密钥）；输入框占位写原因。

合同：开工写计划时定（`ui/agent-conversation-view.md`、`agent/conversation.md`、`workbench/views.md`、`ui/workbench-layout.md`、`agent/profile-settings.md` 或 Profile 声明的 Spec、`settings/settings-window.md` 的打开到指定位置）。

## 当前状态

2026-11-16 从 t29 拆出，尚未开工；草稿在 `.worktree/w00032-t29-drafts` 的 Lab 场景 `ConversationRound2Draft`、`ModelNoticeDraft`、`SubagentsDraft`。

## 下一步

t29 之后开工，按 implementation-planning 写计划。
