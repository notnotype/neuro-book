---
schema: nbook.task/v2
taskId: t30-model-request-trace
status: active
updated: 2026-11-15
---

# Trace：查看所有模型 API 请求

## 目标与范围

开发者 2026-11-06 要求先记下：旧应用有 trace，就是查看所有模型 API 请求的一个地方，新应用也要有。

参照（旧应用，只读）：`packages/neuro-book-legacy/server/agent/observability/`（`traced-provider.ts`、`pi-trace-reader.ts`、`trace-segments.ts`）、`server/api/agent/traces/`、`app/composables/useAgentTraceApi.ts`。

合同：新写一份 Spec（暂定 `docs/specs/agent/request-trace.md`，静态稿定了再写）；从回复打开这次请求、记录点分别要改 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 与 [`harness/models.md`](../../../../../docs/specs/harness/models.md)。

相关现状：内核的 `preview` 能算下一次请求，日志里有 `modelStarted`，但不存发出去的请求全文；上下文详情（t28）只看下一次请求的组成。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-15 | 开发者：先做 t30（排在 t29 之前），参考旧应用的 trace；先出界面静态稿 |
| 2 | 2026-11-15 | 开发者：查看器的组件有复用价值，放进 nb-agent-ui |

## 当前状态

开工，按 design-review 走：旧应用的行为与新应用的现状列在 [参照清单](legacy-survey.md)，每项写了推荐；待开发者确认注意力排序（清单里的问题 1、2、3、5 与新增项 A、B），再在草稿 worktree 出第一轮静态稿。

## 下一步

1. 开发者答复注意力排序之后，把决定按编号写进上面的表。
2. 草稿 worktree `.worktree/w00032-t30-drafts`（分支 `w00032-t30/drafts`）出第一轮静态稿，发评审板。
3. 定稿后写 Spec 与 `plan.md`。
