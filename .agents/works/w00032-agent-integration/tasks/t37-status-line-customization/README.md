---
schema: nbook.task/v2
taskId: t37-status-line-customization
status: planned
updated: 2026-11-16
---

# 对话状态栏的自定义

## 目标与范围

[t29](../t29-ui-polish-after-t15/README.md) 评审板（[第 1 轮](../t29-ui-polish-after-t15/artifacts/review/index.html)）定下的状态栏自定义，2026-11-16 从 t29 拆出。决定原文以 t29 的决定 2、4、5 为准：

- 右键状态栏弹勾选菜单改显隐，菜单最后“状态栏设置…”；设置里“状态栏”一组分左边、右边两组，拖动或上移下移排序；全局一份，存用户设置。
- 可选的项：上下文用量、用量与缓存命中（累计、输入、输出、缓存命中合成一项）、费用、模型与推理档、缓存倒计时（只给缓存时长明确的服务商，过期写“已过期”），以及插件经贡献点加的项（标“插件”）。缺省与现在一样。
- 提醒类总显示、不能关：运行阶段与用时、等你处理、等重发、费用超过告警线、“全部放行”警告、断线。
- 右栏窄时右边按顺序从前往后收进悬停，费用最后收。
- 不做 Claude Code 那种配一条命令；5 小时与 7 天限额留到做订阅登录时。

计划：[plan.md](plan.md)。合同：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 15 到 18 与新输出、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md) 的新贡献点 `agent.statusItems`；写 Spec 在计划确认之后。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-17 | 评审板 `review` v1 的 `drag-sort`：设置里排序用原生拖动加上移、下移按钮 |
| 2 | 2026-11-17 | 同板 `cache-ttl`：这一版不做缓存倒计时（目录里只有上下文、用量、费用、模型四项加插件的项）。开发者的批注：这个计数器能不能让用户自己写代码实现，他现在用的 Claude Code 的 statusline 就是自己写的 |
| 3 | 2026-11-17 | 对批注的答复：插件经 `agent.statusItems` 加的项拿到完整的 `ctx`（最近回复的时间、模型、缓存读写量都在里面），自己算倒计时够用，不用我们内置。像 Claude Code 那样配一条命令（用户脚本）t29 决定 4 排除过，仍不做；要不要另加一条“用户脚本”路径待开发者定 |

## 当前状态

2026-11-17 开工，计划写好（[plan.md](plan.md)），评审板两题已答（决定 1、2）；草稿在 `.worktree/w00032-t29-drafts` 的 Lab 场景 `StatusLineDraft`。

## 下一步

写 Spec（标 planned）、开 worktree、按切片实施。
