---
schema: nbook.task/v2
taskId: t06-main-conversation
status: planned
updated: 2026-11-10
---

# 主对话

## 目标与范围

bot 的主对话：主会话由对话管理常驻持有；原始记录（入站先落盘、出站按会话日志的序号投影并能补投、来源与信任级）；把 harness 接进应用（本机文件访问、审批缺省规则、任务会话不能写核心记忆）；插话（第一版不做连发合并）；主对话等用户时输入框可用、发消息即结算，审批与提问的期限由内核结算（nb-harness 内核改动）；gateway 重启后用继续指令接着处理（有次数上限）；web 的对话页、网页对话宿主（只取尾部窗口、往上翻再加载，关掉改历史与分支树）与断线重连。

合同：新建 `docs/specs/bot/conversations.md`，以及 `docs/specs/bot/memory.md` 的原始记录部分（都还不存在）；对话页写进 `bot/web.md`。会话日志与原始记录的分工按 [ADR 0035](../../../../../docs/adr/0035-harness-log-driven-kernel.md) 决策 1。审批与提问的期限、重启后用继续指令，改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)。会用到的现有合同：[`harness/session.md`](../../../../../docs/specs/harness/session.md)（会话日志）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（对话视图）、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)（断线重连）。

依赖：[w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/README.md)、t04、t05、t03 里对话页的设计。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等上面几项，再写 Spec 草稿与计划；后端与 web 量都不小，计划里再定要不要拆。
