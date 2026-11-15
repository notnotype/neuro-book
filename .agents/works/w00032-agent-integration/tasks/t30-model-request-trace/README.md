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
| 3 | 2026-11-15 | 注意力排序按[参照清单](legacy-survey.md)的推荐（开发者“可以，按推荐”）：查看器是编辑区的一页，入口是命令面板“查看模型请求”、对话顶栏菜单（只看本会话）与回复上的“查看这次请求” |
| 4 | 2026-11-15 | 列表每条两行：状态点、用途、模型、时间；输入输出 token、缓存命中、耗时、费用。按会话的轮次分组，看全部会话时组头写会话标题 |
| 5 | 2026-11-15 | 详情：概览是顶部常驻的一条（模型、状态、token、缓存、耗时、费用、改过请求的扩展）；下面依次是消息（缺省）、系统提示词、工具、原始请求体、响应；思考与工具定义缺省收起，长文字只显示前几行 |
| 6 | 2026-11-15 | 做新增项 A（从回复打开这次请求）与 B（“和上一次比较”一页） |
| 7 | 2026-11-15 | 查看器开着时新请求自动进列表顶部，不改当前选中 |
| 8 | 2026-11-15 | 开发者：查看器的功能要完善一点，查找要做好、方便找到要看的那次请求 |

## 当前状态

开工，按 design-review 走：旧应用的行为与新应用的现状列在 [参照清单](legacy-survey.md)；注意力排序已定（决定 3 到 8），在草稿 worktree 出第一轮静态稿。

## 下一步

1. 草稿 worktree `.worktree/w00032-t30-drafts`（分支 `w00032-t30/drafts`）出第一轮静态稿，发评审板。
2. 定稿后写 Spec 与 `plan.md`。
