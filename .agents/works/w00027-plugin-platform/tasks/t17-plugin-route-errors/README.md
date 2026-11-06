---
schema: nbook.task/v2
taskId: t17-plugin-route-errors
status: done
updated: 2026-11-06
---

# 插件路由抛错进诊断

## 目标与范围

插件的 Hono 路由抛错时走统一的错误响应与诊断，客户端中断上传不当错误报

合同：[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md) 的“处理器抛错”与验收场景 21。

## 当前状态

已合入 master。

## 做法

- **修在哪一层**：`nbook.http` 的合同导出 `rethrowRouteError`，各 Hono 应用设 `onError(rethrowRouteError)`，错误回到分发层。不用建应用的工厂：跨插件只能经 `shared/contracts`，合同又约定不依赖 Hono，这个函数不用引 Hono。分发层也认不出纯文本 500 是不是抛错来的，所以修不到那一层。
- **防回退**：`architecture.test.ts` 查产品代码里每个 `new Hono` 都配了这个处理器。第三方插件不在这个检查范围内，靠 Spec 约定。
- **客户端断开**：按 `request.signal.aborted` 判断，不看错误类型与文案；记 `debug` 级的 `http.request.aborted`。
- **测试**：真实 Hono 应用的同步、异步、经中间件三种抛错与 `HTTPException`；上传中断用真实 `Bun.serve` 与原始套接字。三处变异（去掉产品里一处处理器、测试应用不设处理器、不看断开）都能让测试失败。

## 遗留

- 封面上传的前端读 `{code, detail}`，分发层回的是 `{error: {code, message}}`，所以路由抛错时界面上仍显示状态码 500 与状态文字，和修之前一样，只是诊断里有了原因。两种错误形状要不要统一，需要时另开 Task。
