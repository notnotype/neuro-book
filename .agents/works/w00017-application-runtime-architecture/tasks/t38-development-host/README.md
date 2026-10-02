---
schema: nbook.task/v2
taskId: t38-development-host
---

# 开发宿主：热重载交接与停止通道

## 目标与范围

阶段 1 的开发宿主切片（[#244](https://github.com/notnotype/neuro-book/issues/244)）。开发模式与生产共用 t37 的启动函数和宿主停止入口，补上开发模式缺的部分：

- 热重载时，新实例在取得进程级资源（Session Store 租约）之前，有界等待同一进程中的旧实例释放；超时则启动失败并报告原因，不抢占资源。
- 开发模式不缓存启动失败：每次热重载建立新的 worker 与模块图，重新启动运行实例。
- 开发进程收到 SIGTERM、SIGINT 或停止请求时，有序停止运行实例，释放租约锁后再退出。

行为依据：[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 的开发模式、状态与转换、失败与恢复、验收场景 7 与 8；G0 验证报告的发现 1、2、5（[t27](../t27-platform-risk-gates/README.md)）；[t37](../t37-server-host-entry/README.md) 交付报告第 7 节。

完成标准：`smoke:product-lifecycle` 的 L7、L8 通过，L1–L6、L10 不回退。

不做：同一 worker 内由请求触发的重试（见下文“范围收窄”）；生产宿主行为变更；看门狗；迁移 `server/plugins/` 下其它 Nitro 插件；浏览器宿主（L9）；nuxi 分叉模式、Windows 与 Bun 下的开发 worker。

编码由 omp 完成（`@default`，运行在 `openai-codex/gpt-6.1-sol`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-02 验收通过。

**范围收窄**（2026-10-02 开发者决定）：第一轮 omp 把“不缓存启动失败”实现为“下一次请求在同一 worker 内重建实例”，并用回归测试证实它在真实资源上不成立：失败实例停止时把 Storage 宿主与文件索引这两个模块级单例永久关闭，同一模块图里重建的实例只能拿到已关闭的单例（Storage 请求返回 503 `STORAGE_SERVICE_CLOSED`）。让插件真正拥有、可重建这些资源，属于以后把它们做成完整插件的工作，不为本任务提前做。开发模式改为只靠热重载重试，请求重试相关代码撤销。

**行为变化**（已写入 [`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 的开发模式、失败与恢复、证据的实现进展；设计细节见 [delivery.md](evidences/delivery.md) 第 2、3 节）：

- 新增 `server/host/development-process.ts`。`nuxt.config.ts` 的内联模块在开发模式把开发宿主装进 nuxi 主线程：它接管 SIGINT、SIGTERM（替换 listhen 注册的直接退出监听，遇到未知监听即拒绝启动），经 `BroadcastChannel` 与 worker 协调。
- 热重载：开发宿主在 Nitro 的 `dev:reload` 钩子上先向旧 worker 发停止命令，收到停止回执后 Nitro 才换 worker；热重载期间新就绪的 worker 不会被停止。
- Session Store 租约在开发模式对同一进程的 runtime 持有者有界等待 45 秒（覆盖 20 秒排空与插件关闭），每次轮询都尝试获取，过期锁仍由 proper-lockfile 接管；持有者在其它进程或是迁移租约时照旧立即失败，生产与 CLI 不等待。超时诊断写明“热重载后可重试”。
- 停止：信号与停止路由（开发模式下路由经主线程收口）都经运行实例的宿主停止入口排空、按依赖逆序关闭，worker 回执后主线程关闭 Nuxt 与监听并退出，正常以 0 退出。`runtime.startup.failed` 改为直接写文件描述符 2，因为 worker 的 stderr 是没有描述符的代理流。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：

- 交接等待第一版只在锁目录不存在时才尝试获取，旧 worker 被直接结束时残留的锁会让开发进程永远起不来；改为每次轮询都尝试获取。
- 第一版在开发模式释放租约前删除 owner 诊断文件，生产不删；删除，两种模式同样释放。起因是任务说明里“释放租约锁与 owner 文件”的措辞不准确。
- 热重载停止期间新就绪的 worker 会收到停止命令；改为只在进程停止时停止迟到的 worker。
- `vite:compiled` 钩子：本项目 `ssr: false`，开发时它只在首次配置时触发，不保护任何重载路径，已删除。
- omp 第一轮在 3 小时上限处被截停，没有写交付报告，截停前启动的生产 smoke 成了孤儿进程（自行跑完，无残留）。返工时要求先写交付报告再跑验证。

**主会话修改**：恢复 Session Store 插件中被顺手加上的 `catch (error: unknown)` 注解，删除一处多余空行。

**验证**（主会话运行，返工后）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation`；`server/host`、`server/runtime`、`server/features`、`server/middleware`、`server/routes`、`server/agent/session`、三组 SSE 路由、`shared/source-dev-launcher.test.ts`、`scripts/smoke/product-lifecycle` | 20 个文件 231 条；80 个文件 509 条通过，1 条既有 Windows 用例跳过 | [acceptance-test-targeted.txt](evidences/acceptance-test-targeted.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 三种模式 | 全部通过 | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `smoke:product-lifecycle`（L1–L10，含生产构建） | L1–L8、L10 通过；L9 失败（`no-half-workbench`，浏览器宿主切片） | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json) |
| `bun run test` | 10 个文件 23 条失败、22 个 errors，与基线相同 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |
| `bun run dev` 停止链（omp 运行） | SIGTERM、SIGINT 各一次：约 0.34 秒以 0 退出，未走强制收口，租约锁释放，无残留进程 | [rework-1-source-dev-signals.json](evidences/rework-1-source-dev-signals.json) |

omp 的输出与汇报：`evidences/` 下的其余文件，含 [delivery.md](evidences/delivery.md)。第一轮的失败证据（`server-tests.log`、`regression-before-*`）保留。

**后续问题**：

- 同一 worker 内由请求触发的重试，要等 Storage 宿主与文件索引成为拥有资源的插件后再做。
- 开发宿主依赖 listhen 的信号监听形状与 Nitro `dev:reload` 钩子顺序，升级 Nuxt 或 Nitro 时要复验。若这套适配器以后变得难以维护，备选方案是自有开发宿主：仍用 Nuxt 跑前端开发服务器与 Nitro 构建，服务端改在子进程里用生产入口启动，热重载时串行重启子进程（未验证，需先做一次类似 G0 的验证）。
- 开发模式关闭失败的退出码 1、75 与 45 秒停止超时只有合同测试，没有故障注入实测。

## 下一步

浏览器宿主与 `nbook.workbench`（L9）：移除 `index.vue` 中的运行实例创建，引导失败时不渲染半个工作台。
