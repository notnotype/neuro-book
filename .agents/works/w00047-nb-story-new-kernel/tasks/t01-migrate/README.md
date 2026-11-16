---
schema: nbook.task/v2
taskId: t01-migrate
status: planned
updated: 2026-11-16
---

# 迁新内核与问答日志迁移

## 目标与范围

nb-story 与 nb-agent-ui 的旧适配器改用 nb-harness 新内核，升级书库里的旧问答日志，然后 `nb-session`、`nb-profile` 停更。

来源：[w00032 t31](../../../w00032-agent-integration/tasks/t31-nb-story-new-kernel/README.md)（2026-11-07 建，2026-11-16 开发者定移出 w00032、单独成 Work）；最初是 w00032 [t02](../../../w00032-agent-integration/tasks/t02-harness-baseline/README.md) 决定 1、2 与 [t03](../../../w00032-agent-integration/tasks/t03-session-model/README.md) 决定 6 的剩余项。

合同：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)（迁移脚本）；`agent/harness.md` 的独有条目并入 `harness/*` 后删除（w00032 t20“下一步”）。开工时再核对。

## 要做的事

- nb-story 改依赖 `nb-harness` 的新内核：w00032 t20 的实现深入审查里试迁过一次问答，开工时先看[它的证据](../../../w00032-agent-integration/tasks/t20-hooks/evidences/)里的结论。
- 迁移脚本：把 nb-session 线性格式的问答日志升到当前格式；放在哪个包、怎么调用，写计划时定。做法参照旧应用的 `migrate-agent-sessions-v2`。
- nb-agent-ui 去掉旧适配器与对 `nb-profile`、`nb-session` 的依赖（[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)“nb-story 迁移之前旧适配器留着”）。
- `nb-session`、`nb-profile` 停更。npm 上标 deprecated 与发新版本都是远端写入，到时单独请授权。
- 删 nb-harness 旧的 `src/tools/`（[w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/README.md) 定：宿主套件 `src/kit/tools/` 是唯一维护的实现，旧的不合并、不改）：根入口导出的 `registerBuiltinTools`、`createReadTool`、`createEditTool` 随之删去，属于已发布包的公开合同变更，发版说明要写；用到它们的只有 nb-agent-ui 的契约测试与 nb-harness 自己的旧测试（含 `tests/acceptance.test.ts`）。

## 当前状态

2026-11-16 从 w00032 t31 移来，尚未开工。

## 下一步

开工时按 implementation-planning 写计划。
