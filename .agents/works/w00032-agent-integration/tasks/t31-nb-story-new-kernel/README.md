---
schema: nbook.task/v2
taskId: t31-nb-story-new-kernel
status: planned
updated: 2026-11-07
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

## 当前状态

未开工。

## 下一步

排在本 Work 的最后（t05、t14、t15、t29 之后）；按 implementation-planning 写计划。
