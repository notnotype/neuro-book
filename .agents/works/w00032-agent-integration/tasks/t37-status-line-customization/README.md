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

合同：开工写计划时定（`agent/conversation.md` 状态栏一节、`agent/contributions.md` 新贡献点、设置项）。

## 当前状态

2026-11-16 从 t29 拆出，尚未开工；草稿在 `.worktree/w00032-t29-drafts` 的 Lab 场景 `StatusLineDraft`。

## 下一步

t36 之后开工，按 implementation-planning 写计划。
