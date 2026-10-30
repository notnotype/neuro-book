---
schema: nbook.task/v2
taskId: t23-session-history
status: shelved
updated: 2026-10-30
---

# Agent 查询会话历史

## 目标与范围

Agent 按轮分页、搜索、按视角（完整日志，或模型当前看到的 `Message[]`）查询一个会话的全部历史，不只是最后一条回复。

来源：t14 讨论（开发者 2026-10-30）：父 Agent 要能查子会话的全部历史；单开 Task 先搁置，暂时由 Agent 直接读原始日志文件。

合同：本 Task 搁置，行为合同未变。

## 已知情况

- 会话日志在 `<状态根>/agent/sessions/<id>/session.jsonl`，不在 home 里；`sessions://<id>/` 按 t08 只映射到 `home/`，所以“直接读原始文件”要先给日志一个只读地址（t14 定）。
- 2026-10-30 的候选（未定）：工具 `agent_history(session, from?, to?, detail?)` 按轮分页、`agent_search(session, 词)` 搜索；不做成 `transcript.md` 文件（真实文件要与日志同步、占两倍空间，虚拟文件违反 t08“条目下是真实目录”）。
- 谁能看谁的历史未定；候选：自己的子孙会话，加上用户在对话里 `@` 引用过的会话。

## 当前状态

搁置（开发者 2026-10-30）。

## 下一步

需要时重开，先与开发者讨论。
