---
schema: nbook.task/v2
taskId: t06-main-conversation
status: active
updated: 2026-11-19
---

# bot 的主对话（`nbook.bots`）

## 目标与范围

[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 3–5、7 小节与第 10 小节的对话部分，只做内核与服务端（2026-11-19 开发者把原范围拆成两个，界面移到 [t15](../t15-messages-view/README.md)）：
- `nbook.bots` 插件骨架：预设贡献点与缺省预设、首次启动建 bot、bot 记录、封闭名单（命令域、显示名）、bot 的设置分区；
- 主对话：`ensureMain`（id 由 bot id 定，`session-exists` 时核对 `owner`）、激活后持有（`agentKey.hold` 与失败码）、会话头 `owner` 与 `ToolSessionContext.owner`（按调用方盖章）、列表不列有归属的会话及其后代、`owned-session` 拒绝改写历史、有归属的会话的打开入口登记（服务端一侧）、Profile 解析不到、重启后以宿主身份接着跑与次数、长会话的服务端指标；
- 等用户：审批与提问的期限、`expired`、`expired-run`、`send` 的 `settlePending`。

合同：新建 `docs/specs/bots/bots.md`、`docs/specs/bots/main-conversation.md`；改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)（命令域）。

依赖：t14（缓冲区与宿主发出者，已完成）。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（2026-11-18 按已接受的 [bot 提案](../../../../../docs/proposals/neurobot.md) 与 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 重排）；2026-11-19 拆出 t15。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工；2026-11-18 改成在 NeuroBook 里做，原始记录不做。

## 下一步

开工：先用真实内核跑探针列出期限与结算的路径，再写 Spec 草稿与计划，交开发者看过后做后端审查。
