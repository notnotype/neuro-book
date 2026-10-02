---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.server-host
owners:
  - application-runtime
---

# 服务端宿主：内核拥有进程

## 目标与非目标

服务端进程由宿主适配器与内核拥有：进程入口建立唯一的运行实例，按清单登记内置与已安装插件，执行启动门禁，由 `nbook.http` 插件监听端口；所有停止来源汇合到同一个有序停止流程，按依赖逆序关闭；启动失败与停止结果以约定的退出码报告。开发模式与生产在同一套内核语义下运行。

明确不承诺：

- 不改变 Manager、Desktop、容器的启动命令、产物路径、就绪探测与停止通道；不改变它们等待与强制结束的时序。
- 不定义浏览器宿主（[`runtime.browser-host`](browser-host.md)）与主线程卡死看门狗（[`runtime.stall-watchdog`](stall-watchdog.md)）。
- 不定义 Session Store 租约本身（[`agent.session-store-lease`](../agent/session-store-lease.md)），只规定租约失效作为停止来源。
- 不支持一个进程中同时存在两个产品运行实例（开发热重载的短暂交接除外，见下文）。

## 术语与参与者

- **宿主入口**：产品构建产物 `.output/server/index.mjs`，与全部服务端代码处于同一次构建、同一模块图。
- **运行实例**：`runtime.application` 定义的一次启动；本能力中每个进程一个。
- **启动必需插件**：服务端入口失败即启动失败的内置插件，例如 diagnostics、app-state（App SQLite、迁移门禁、State Root 完整性检查）、http、session-store。它们的浏览器入口按窗口判定（[`runtime.browser-host`](browser-host.md)）。
- **停止来源**：进程信号（SIGTERM、SIGINT）、Desktop 与 Manager 的控制请求（`PRODUCT_SHUTDOWN_PATH`）、Session Store 租约失效、启动失败。
- **排空**：停止接纳新请求、等待在途请求结束的阶段。
- **开发适配器**：开发模式下在 Nitro 初始化时建立运行实例的适配器。

## 输入与前置条件

- 进程启动参数与环境变量：State Root、端口、安全模式（[`runtime.plugin-install`](plugin-install.md)）、停止通道的令牌；内核不自行扫描替代根。
- 内置插件表随产品构建生成；已安装插件来自 State Root。
- 生产运行在 Bun 上；开发模式由 `nuxt dev` 启动，实际运行在 Node 上。

## 输出与可观察行为

**启动序列：**

1. 读取启动参数；建立运行实例：根作用域、服务装配、插件宿主、最小诊断；挂接进程信号与停止通道，每个实例只挂接一次。
2. 发现：内置插件表加上 State Root 中已启用插件的清单；安全模式跳过第三方插件。
3. 登记：按 [`runtime.plugin-manifest`](plugin-manifest.md) 校验与推导，不执行插件代码。启动必需插件的服务端入口受阻或清单无效时启动失败。
4. 启动激活：启动必需插件的入口与声明 `onStartup` 的入口，依赖先于依赖者。
5. `nbook.http` 激活后监听端口。端口先监听，业务请求等待运行实例就绪（沿用现有语义），就绪后处理；Manager 的就绪探测照常成功。
6. 其余入口按激活事件懒激活。

**停止序列：** 任一停止来源触发后：

1. `nbook.http` 停止接纳新请求：排空期间保持监听，对新请求返回 503；关闭插件事件流；等待在途请求结束，沿用现有 20 秒排空上限，超时后继续后续步骤并记录为关闭未完成的一项。
2. 其余插件入口按依赖逆序关闭（依赖者先、提供者后）。
3. 以退出码结束进程：

| 结果 | 退出码 |
|---|---|
| 正常停止且全部关闭完成 | 0 |
| 启动失败；或停止中有步骤失败、超时 | 1 |
| Session Store 租约失效触发的停止（无论关闭是否完成） | 75 |
| 主线程卡死被看门狗结束 | 76（[`runtime.stall-watchdog`](stall-watchdog.md)） |

- 多个停止来源先后到达时只执行一次停止；退出码取更具体的原因：已请求 75 后再请求 1 仍以 75 退出。
- 控制请求 `PRODUCT_SHUTDOWN_PATH` 与进程信号走同一流程，不绕过排空。
- 启动失败时先写一条同步的致命诊断（原因、失败的门禁或插件入口），再有序停止已取得的资源，然后以 1 退出；不依赖未捕获异常终止进程。

**开发模式：**

- 开发适配器在 Nitro 初始化时（不是首个请求时）建立运行实例；`nbook.http` 在开发模式只提供请求处理，不自行监听端口。
- 热重载时新实例在取得进程级资源（Session Store 租约等）之前，有界等待同一进程中的旧实例释放；等待超时则新实例启动失败并报告原因，下一次热重载可以重试。
- 开发模式不缓存启动失败：每次热重载建立新的 worker 与模块图，重新启动运行实例；同一 worker 内不重试，请求得到 503 与失败原因。
- 开发进程收到 SIGTERM、SIGINT 或停止请求时，有序停止运行实例后退出。
- 一个关闭步骤抛错不会跳过其余关闭步骤。

## 状态与转换

| 当前 | 事件 | 结果 |
|---|---|---|
| 未启动 | 进程启动 | 启动中；端口监听后请求等待 |
| 启动中 | 全部启动门禁通过 | 可用；等待中的请求开始处理 |
| 启动中 | 启动必需插件失败或受阻 | 停止中，结束时退出码 1 |
| 启动中、可用 | 任一停止来源 | 停止中（排空 → 依赖逆序关闭） |
| 停止中 | 再次收到停止来源 | 不重复执行；按上表更新退出码 |
| 停止中 | 全部关闭完成 | 退出（0 或原因对应的退出码） |
| 停止中 | 某步失败或超时 | 继续其余步骤，结束时退出码 1（或 75、76） |

开发模式热重载：旧实例停止中 → 新实例等待旧实例释放 → 新实例启动中；同一时刻只有一个实例持有进程级资源。

## 副作用与数据

- 宿主挂接的进程信号、停止通道与计时器归宿主，停止完成后移除。
- 启动失败与停止未完成写入诊断日志；不删除任何用户数据。
- 现有 `server/plugins/` 中的 Nitro 插件（日志、Boot Config、Storage 定义、错误日志、Project 会话关闭、Server Timing）的职责迁入内置插件；迁移后不再有第二套启动或关闭路径。Nitro 自带的优雅关闭与 node-server 监听不再使用。

## 失败与恢复

- 启动失败：有序停止、以 1 退出；Manager 与 Desktop 按现有合同呈现失败。
- 排空超时：继续关闭其余插件，退出码 1。
- 某个插件关闭抛错：记录错误，继续关闭其余插件，退出码 1。
- 租约失效：立即进入停止并拒绝新请求，退出码 75；已取得排他资源在依赖仍被使用时不提前释放。
- 开发模式旧实例迟迟不释放：新实例启动失败，下一次热重载可重试；不强行抢占资源。
- 强制结束（`SIGKILL`、断电）：不保证任何关闭步骤执行；下次启动按持久化数据与领域合同恢复。

## 边界与兼容

- **owner**：application-runtime（宿主适配器）；内核合同沿用 [`runtime.application`](application.md)、[`runtime.lifecycle`](lifecycle.md)。
- **Nitro 依赖**：生产宿主入口依赖 nitropack 的构建选项与内部导出，升级 nitropack（尤其 Nitro 3）时要重新验证本能力的验收场景；构建接线见设计稿 P6。
- **兼容**：`.output/server/index.mjs` 路径、就绪探测、`PRODUCT_SHUTDOWN_PATH` 控制请求与令牌、退出码 0、1、75 的含义保持不变；新增 76。
- **迁移**：切换时删除旧的启动中间件、`productRuntimeReady()` 全局单例与 `product-shutdown.ts` 的手写关闭清单；关闭顺序改由依赖图产生。不长期保留两套路径。
- **开发模式问题** 对应 [#244](https://github.com/notnotype/neuro-book/issues/244)。

## 验收与 Smoke

1. **同一模块图。** 生产构建中宿主入口与请求处理取得的是同一份服务端模块实例。
2. **启动失败退出。** Given 迁移门禁失败；Then 进程写出致命诊断后以 1 退出，不存活为只返回 500 的服务。
3. **有序停止。** Given 一个进行中的长请求；When 发送 SIGTERM；Then 新请求得到 503、长请求完成、插件按依赖逆序关闭，进程以 0 退出。
4. **控制请求不绕过排空。** 经 `PRODUCT_SHUTDOWN_PATH` 停止时，行为与场景 3 相同。
5. **租约失效。** 模拟租约失效：进程停止并以 75 退出；随后又发生关闭失败，仍以 75 退出。
6. **Manager 合同。** 用 Manager 自己的就绪探测与停止函数启动、停止产品，结果与现有版本一致。
7. **开发热重载。** 修改服务端文件触发热重载：新实例取得 Session Store 租约，没有持续的 500；不残留旧实例。
8. **开发停止。** 对 `nuxt dev` 进程发送 SIGTERM：运行实例有序停止后进程退出。
9. **关闭步骤隔离。** 注入一个插件关闭时抛错：其余插件仍被关闭，退出码 1。

Smoke：生产构建在 Bun 下用临时 State Root 运行场景 2 至 6；开发模式运行场景 7、8。

## 证据

- 批准目标：[可扩展应用平台设计](../../../packages/neuro-book/docs/proposals/extensible-application-platform.md) P6 与 P11（2026-09-30 开发者同意生命周期部分按验证证据写入）；[ADR 0022](../../../packages/neuro-book/docs/adr/0022-extensible-platform-and-plugin-trust.md) 第 2 条。
- 验证依据：[G0 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md)；启动失败退出与退出码优先级的现行修复见 [PR #245](https://github.com/notnotype/neuro-book/pull/245)。
- 实现进展：生产宿主入口、`nbook.http`（监听、请求准入、排空期间返回 503、SSE 事件流在排空开始时关闭、普通在途请求最多等 20 秒）、停止来源汇合（信号、`PRODUCT_SHUTDOWN_PATH`、租约失效、启动失败经 `ServerRuntimeHost` 的同一停止入口，排空作为宿主停止前置步骤）、退出码 0、1、75 与启动失败的同步致命诊断已实现；其余插件按依赖逆序关闭，诊断以 `runtime.plugins.diagnostic` 与 `runtime.plugins.catalog` 写入产品日志。旧的启动中间件、排空中间件、`productRuntimeReady()` 全局单例、关闭控制器与 `project-session-close` Nitro 插件已删除。开发模式由 Nitro 插件在初始化时建立实例，nuxi 主线程中的开发宿主接管 SIGINT、SIGTERM 并经 `BroadcastChannel` 与 worker 协调：热重载先等旧实例的停止回执再换 worker；Session Store 租约在开发模式对同一进程的 runtime 持有者有界等待 45 秒，过期锁仍按租约规则接管；停止路由与信号都经宿主停止入口排空、按依赖逆序关闭后退出（#244）。已知限制：同一 worker 内由请求触发的重试未实现，因为 Storage 宿主与文件索引仍是模块级单例，关闭后不能在同一模块图中重建，要等它们成为拥有资源的插件；开发宿主依赖 listhen 注册的信号监听形状与 Nitro `dev:reload` 钩子的执行顺序，升级 Nuxt 或 Nitro 时要重新验证；nuxi 分叉模式、Windows 与 Bun 下的开发 worker 未覆盖。`server/plugins/` 下其它 Nitro 插件尚未迁移，看门狗未实现，本 Spec 保持 `planned`。见 [w00017 t34](../../../.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/README.md)、[t37](../../../.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/README.md)、[t38](../../../.agents/works/w00017-application-runtime-architecture/tasks/t38-development-host/README.md)。
