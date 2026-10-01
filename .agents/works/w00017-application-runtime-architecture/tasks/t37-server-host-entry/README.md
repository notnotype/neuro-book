---
schema: nbook.task/v2
taskId: t37-server-host-entry
---

# 自有服务端宿主入口与 nbook.http

## 目标与范围

阶段 1 的服务端宿主切片。生产构建改用自有宿主入口，由 `ServerRuntimeHost` 建立唯一的产品运行实例并挂接进程信号；新增启动必需的 `nbook.http` 插件负责监听、请求准入与排空（排空期间返回 503，SSE 事件流主动关闭，普通在途请求最多等待 20 秒）；进程信号、停止路由、Session Store 租约失效与启动失败汇合到宿主的同一停止入口，退出码按 0、1、75 规则取值。删除启动中间件、排空中间件、`productRuntimeReady()` 全局单例、关闭控制器与 `project-session-close` Nitro 插件。开发模式只做最小适配（Nitro 初始化时建立实例、单一 close 钩子）。

行为依据：[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 的启动序列、停止序列、退出码与迁移；[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md) P6、P9；G0 验证（[t27](../t27-platform-risk-gates/README.md)）。

不做：开发模式热重载交接、启动失败重试与开发停止通道（#244，下一个 Task）；看门狗；插件通道与 WebSocket 业务；迁移 `server/plugins/` 下其它 Nitro 插件；浏览器宿主。

编码由 omp 完成（`@default`，运行在 `openai-codex/gpt-6.1-sol`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过。

**行为变化**（已写入 [`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 证据的实现进展与 [`runtime.application`](../../../../../docs/specs/runtime/application.md) 已知限制；设计细节见 [delivery.md](evidences/delivery.md) 第 2 节）：

- 生产构建由一个 Nuxt 模块把 Nitro `entry` 设为 `server/host/product-host-entry.ts`（预渲染配置中移除）；开发模式改为登记 `server/host/development-plugin.ts`。
- `server/runtime/product-startup.ts` 的 `startProductRuntime()` 是生产、开发与 CLI 共用的唯一启动函数，`currentProductRuntime()` 只取得本模块图已建立的实例；`productRuntimeReady()`、`stopProductRuntime()`、`exitOnProductStartupFailure()` 与 `globalThis` 单例删除，种子与 CLI 脚本改用新函数。
- 新增启动必需的 `nbook.http`（`server/features/http/`），无业务依赖，生产下启动时即开始监听，不等其它插件；首个中间件 `00-product-http.ts` 把请求交给准入：就绪前等待，启动失败返回 503（`PRODUCT_STARTUP_FAILED`），排空后返回 503（“NeuroBook 正在关闭。”）。四个 SSE 路由向准入登记关闭动作，排空开始时被关闭且不计入等待；普通请求与流关闭共用 20 秒截止。
- `ServerRuntimeHost` 新增 `beforeStop` 前置步骤与可等待的 `requestStop()`：先排空，再停止内核，其余插件按依赖逆序关闭。因为 `nbook.http` 若依赖其它服务就不能最先监听，所以“先排空”放在宿主层而不是依赖图里。
- 停止来源（信号、停止路由 `control:http`、Session Store 租约失效经注入的 `ProductStopPort`、启动失败）汇合到同一入口；退出码 75 优先于 1，1 优先于 0；结算后最后刷写日志。启动失败同步写 `runtime.startup.failed`（保留迁移提示）到日志与 stderr。
- 删除启动中间件、排空中间件、`project-session-close` Nitro 插件、`ProductShutdownController` 与手写关闭清单；`product-shutdown-client.ts` 保留。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：
- omp 的审查子代理断言“Node/Bun 的信号监听器收不到信号名”，omp 据此改了实现与注释，并提出回写建议。主会话实测两者都收到 `["SIGTERM", 15]`。按注册信号绑定闭包的实现保留，注释改为真实原因，回写建议撤回。
- SSE 相关的超范围改动：`isClosingEventStreamError` 被改写并删掉原有注释，presence 路由的几处原有 `catch` 与计时器类型被改动。已恢复为 HEAD 写法，只保留排空需要的关闭登记与关闭结果传播。
- 接受删除 `scripts/build/nuxt-output-contract.test.ts` 中一条测试：它断言已删除的启动中间件源码，另一部分是源码字符串守卫，违反测试规范。

**主会话修改**：`server/api/workspace-files/events.get.ts` 中一行说明注释放错了位置，`unsubscribe` 的声明被无故挪动，已恢复。

**验证**（主会话运行，返工后）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation`；`server/runtime`、`server/features`、`server/middleware`、`server/routes`、`server/host`、三组 SSE 路由、`server/agent/harness`、`scripts/smoke/product-lifecycle` | 20 个文件 231 条；77 个文件 672 条，全部通过 | [acceptance-test-targeted.txt](evidences/acceptance-test-targeted.txt) |
| `scripts/build/nuxt-output-contract.test.ts` | 8 条通过 | [acceptance-test-build.txt](evidences/acceptance-test-build.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 三种模式 | 全部通过 | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `smoke:product-lifecycle`（L1–L10，含生产构建） | L1–L7、L10 通过；L8 失败（开发进程 SIGTERM 后租约锁未释放，#244）；L9 失败（`no-half-workbench`，浏览器宿主切片） | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json) |
| `bun run test` | 10 个文件 23 条失败、22 个 errors，与基线相同 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |

omp 的输出与汇报：`evidences/` 下的其余文件，含 `delivery.md`、`test-migration.md`（删除测试的覆盖迁移）与开发模式验证（`development-*`）。

**后续问题**：`smoke:product-lifecycle` 在生产构建失败时把检查项记为 `pending`、退出码仍为 0（t34 首轮即如此），只看退出码会误判；留到阶段 1 集成复核处理。

## 下一步

开发宿主（#244）：热重载时新实例有界等待旧实例释放租约、开发模式不缓存启动失败、开发进程的信号与停止通道复用宿主停止入口，使 L8 通过。
