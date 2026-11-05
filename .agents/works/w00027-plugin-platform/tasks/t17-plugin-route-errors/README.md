---
schema: nbook.task/v2
taskId: t17-plugin-route-errors
status: planned
updated: 2026-11-05
---

# 插件路由抛错进诊断

## 目标与范围

插件的 Hono 路由抛错时走统一的错误响应与诊断，客户端中断上传不当错误报

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 已知事实

来自 w00025 t19 的实现审查（[报告第 5 条](../../../w00025-editor/tasks/t19-background-image/evidences/impl-review-backend-opus.txt)），开发者 2026-11-05 要求单开：

- `packages/neuro-book/src/plugins/http/backend/dispatch.ts` 接住处理器抛错后调 `reportError` 并回 JSON 的 `internal-error`。但插件路由是 Hono 应用：没有设 `onError` 时，Hono 自己 `console.error` 并回纯文本 `Internal Server Error`，`handler.fetch` 不抛，分发层的这条路走不到。`plugins` 与 `server` 下没有任何 `.onError(`，所有 Hono 写的插件路由都这样。
- `dispatch.test.ts` 的对应用例用的是裸的 `{fetch: () => {throw}}`，所以它通过，真实路由却不走这条路。
- 可观察的后果：前端按 JSON 解析错误响应时拿到解析错误，而不是原因；诊断里没有这条错误；客户端中途断开上传时，标准错误打一整段 `AbortError`。

## 下一步

未开工。写计划时先定修在哪一层（例如给各 Hono 应用设统一的 `onError`，或由 `nbook.http` 提供建应用的工厂），并区分客户端断开与真错误；用真实贡献的路由补测试。
