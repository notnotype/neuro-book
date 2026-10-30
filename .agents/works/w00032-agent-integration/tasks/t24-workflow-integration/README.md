---
schema: nbook.task/v2
taskId: t24-workflow-integration
status: shelved
updated: 2026-10-30
---

# Workflow 与 Agent 的对接

## 目标与范围

Workflow（nb-workflow）怎样调 Agent、Agent 怎样调 Workflow：AgentPort、agent.startTask 的提问与后台、结果转换

来源：t14 讨论（开发者 2026-10-30）：Workflow 先不在 t14 考虑，单开 Task 另做。

合同：本 Task 搁置，行为合同未变。

## 已知情况

- t10 决定 7：`agent.startTask({profile, initial, input, project?, background?})` 供编辑器行内 AI、命令、Workflow、nb-story 使用，结果为 `TurnResult`（含收尾工具的参数）。
- nb-workflow 的 `AgentPort`（`packages/nb-workflow/src/ports.ts`）：`profileInfo`、`invoke(sessionId, fromLeaf, {mode, message, input, signal})`。
- t14 审查（[`evidences/design-review.txt`](../t14-multi-agent/evidences/design-review.txt) 第 11 条）提出的待定问题：Workflow 发起的会话里提问交给谁（Workflow 不是模型，不能用 `agent_answer`）；`startTask` 的 `background` 与其它工具的 `async` 是否统一、怎样接任务中心；`TurnResult` 与 `yield` 的结果怎样转换。2026-10-30 的推荐（未定）：这类会话的提问缺省交给用户，`background` 改名 `async`。

## 当前状态

搁置（开发者 2026-10-30）。

## 下一步

需要时重开，先与开发者讨论。
