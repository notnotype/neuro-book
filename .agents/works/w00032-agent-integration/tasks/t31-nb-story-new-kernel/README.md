---
schema: nbook.task/v2
taskId: t31-nb-story-new-kernel
status: done
updated: 2026-11-16
---

# nb-story 迁新内核，nb-session、nb-profile 停更

## 目标与范围

nb-story 与 nb-agent-ui 的旧适配器改用 nb-harness 新内核，升级书库里的旧问答日志，然后 `nb-session`、`nb-profile` 停更。

来源：[t02](../t02-harness-baseline/README.md) 决定 1、2 与 [t03](../t03-session-model/README.md) 决定 6 的剩余项；开发者 2026-11-02 定 nb-story 迁新内核放最后，2026-11-07 同意单独建 Task。

合同：[`story/qa.md`](../../../../../docs/specs/story/qa.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)（迁移脚本）；`agent/harness.md` 的独有条目并入 `harness/*` 后删除（t20“下一步”）。开工时再核对。

## 要做的事

- nb-story 改依赖 `nb-harness` 的新内核：t20 的实现深入审查里试迁过一次问答，开工时先看 `evidences/` 里的结论。
- 迁移脚本：把 nb-session 线性格式的问答日志升到当前格式；放在哪个包、怎么调用，写计划时定。做法参照旧应用的 `migrate-agent-sessions-v2`。
- nb-agent-ui 去掉旧适配器与对 `nb-profile`、`nb-session` 的依赖（[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)“nb-story 迁移之前旧适配器留着”）。
- `nb-session`、`nb-profile` 停更。npm 上标 deprecated 与发新版本都是远端写入，到时单独请授权。
- 删 nb-harness 旧的 `src/tools/`（[t32](../t32-harness-backfill/README.md) 定：宿主套件 `src/kit/tools/` 是唯一维护的实现，旧的不合并、不改）：根入口导出的 `registerBuiltinTools`、`createReadTool`、`createEditTool` 随之删去，属于已发布包的公开合同变更，发版说明要写；用到它们的只有 nb-agent-ui 的契约测试与 nb-harness 自己的旧测试（含 `tests/acceptance.test.ts`）。

## 当前状态

未开工。

2026-11-16 开发者定移出本 Work：转入 [w00047 t01](../../../w00047-nb-story-new-kernel/tasks/t01-migrate/README.md)，后续在那里推进。

## 下一步

无（见新 Work）。
