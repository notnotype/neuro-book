---
schema: nbook.task/v2
taskId: t30-model-request-trace
status: planned
updated: 2026-11-06
---

# Trace：查看所有模型 API 请求

## 目标与范围

开发者 2026-11-06 要求先记下：旧应用有 trace，就是查看所有模型 API 请求的一个地方，新应用也要有。

参照（旧应用，只读）：`packages/neuro-book-legacy/server/agent/observability/`（`traced-provider.ts`、`pi-trace-reader.ts`、`trace-segments.ts`）、`server/api/agent/traces/`、`app/composables/useAgentTraceApi.ts`。

合同：待补充。开工时写 Spec。

相关现状：内核的 `preview` 能算下一次请求，日志里有 `modelStarted`，但不存发出去的请求全文；上下文详情（t28）只看下一次请求的组成。

## 当前状态

未开工，开发者没有排顺序。

## 下一步

开工前先列旧应用 trace 的可观察行为，逐项定做不做。
