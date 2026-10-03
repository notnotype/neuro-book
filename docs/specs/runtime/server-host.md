---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.server-host
owners:
  - application-runtime
---

# 服务端宿主：内核拥有进程

## 目标与非目标

服务端进程由宿主适配器与内核拥有：进程入口建立唯一的运行实例，按产品清单登记插件，执行启动门禁，由 `nbook.http` 插件监听端口；所有停止来源汇合到同一个有序停止流程，先排空 HTTP，再按依赖逆序关闭；启动失败与停止结果以约定的退出码报告。开发模式与生产在同一套内核语义下运行。

明确不承诺：

- 不定义交付：打包分发、安装、Manager 与桌面版的启动与停止通道属于另行设计的交付链。
- 不定义浏览器宿主（[`runtime.browser-host`](browser-host.md)）与主线程卡死看门狗（[`runtime.stall-watchdog`](stall-watchdog.md)）。
- 不定义 Session Store 租约本身（[`agent.session-store-lease`](../../archived/specs/agent/session-store-lease.md)），只规定租约失效作为停止来源。
- 不支持一个进程中同时存在两个产品运行实例。

## 术语与参与者

- **宿主入口**：`packages/neuro-book/src/server/main.ts`；生产运行它的 Bun 打包产物，与全部后端代码处于同一模块图。
- **运行实例**：`runtime.application` 定义的一次启动；本能力中每个进程一个。
- **产品清单**：`packages/neuro-book/src/manifest.ts`，列出本应用加载的插件；后端按它装配插件的后端入口。
- **启动必需插件**：服务端入口失败即启动失败的插件。当前清单中的插件（`nbook.diagnostics`、`nbook.http`）都是启动必需。它们的浏览器入口按窗口判定（[`runtime.browser-host`](browser-host.md)）。
- **停止来源**：进程信号（SIGTERM、SIGINT）、标准输入停止通道、Session Store 租约失效、启动失败、进程级未处理异常。启动失败由内核自行关闭已取得的资源；就绪前的请求都在等待、没有被接纳，因此不需要排空。
- **标准输入停止通道**：以 `--stop-stdin` 启动时，标准输入读到一行 `stop`、或标准输入结束（父进程已不在），都请求停止。Windows 上外部进程不能合作发送信号，开发监督进程与 smoke 用它停止后端。
- **排空**：停止接纳新请求、等待在途请求结束的阶段。
- **开发监督进程**：开发模式下启动并在后端文件变化时有序重启后端进程的进程。

## 输入与前置条件

- 启动参数：环境变量 `NBOOK_STATE_ROOT`（状态根，必填；日志写在 `<状态根>/logs/`）、`NBOOK_HOST`（缺省 `127.0.0.1`）、`NBOOK_PORT`（缺省 3000，0 表示由系统分配）；命令行 `--stop-stdin`。参数无效时写出一行致命诊断并以 1 退出，不建立运行实例。内核不自行扫描替代根。
- 未加载鉴权插件时只允许监听回环地址（`127.0.0.1`、`::1`、`localhost`），其它地址按参数无效处理。
- 内置插件随产品清单构建；已安装插件来自状态根（[`runtime.plugin-install`](plugin-install.md)，尚未实现）。
- 生产与开发都运行在 Bun 上。

## 输出与可观察行为

**启动序列：**

1. 读取启动参数；建立诊断存储（记录能力先于任何插件存在）与运行实例：根作用域、服务装配、插件宿主；挂接进程信号、未处理异常与停止通道，每个实例只挂接一次。
2. 发现：产品清单中的插件，加上状态根中已启用插件的清单（尚未实现）。
3. 登记：按 [`runtime.plugin-manifest`](plugin-manifest.md) 校验与推导，不执行插件代码。启动必需插件的服务端入口受阻或清单无效时启动失败。
4. 启动激活：启动必需插件的入口与声明 `onStartup` 的入口，依赖先于依赖者（`nbook.diagnostics` 是依赖图的根）。
5. `nbook.http` 激活后用 Bun 监听，并在标准输出打印一行 `Listening on <地址>`。端口先监听，请求等待运行实例就绪，就绪后处理；宿主自有接口 `GET /api/runtime/health` 在就绪后返回 200。
6. 其余入口按激活事件懒激活。

**请求分发：** `nbook.http` 定义贡献点 `http.routes`。插件的服务端入口提交一个处理器（通常是 Hono 应用），挂到 `/api/<插件 id>/`，处理器收到的路径已去掉这个前缀；入口停止时摘下，之后的请求得到 404，摘下前的过渡期得到 503。`/api/runtime/` 留给宿主自有接口。

**停止序列：** 任一停止来源触发后：

1. `nbook.http` 停止接纳新请求：排空期间保持监听，对新请求返回 503；关闭已登记的事件流（不计入等待）；等待在途请求结束，排空上限 20 秒，超时后继续后续步骤并记为关闭未完成的一项。
   在途从请求被接纳起，到处理器返回且响应正文发送完毕（或被客户端取消）为止。客户端断开时处理器若还没返回，仍计入在途，因为它还在使用插件资源；处理器应响应请求的取消信号。
2. 其余插件入口按依赖逆序关闭（依赖者先、提供者后），`nbook.diagnostics` 最后关闭。
3. 以退出码结束进程：

| 结果 | 退出码 |
|---|---|
| 正常停止且全部关闭完成 | 0 |
| 启动失败；进程级未处理异常；或停止中有步骤失败、超时 | 1 |
| Session Store 租约失效触发的停止（无论关闭是否完成；随 Session Store 插件实现） | 75 |
| 主线程卡死被看门狗结束 | 76（[`runtime.stall-watchdog`](stall-watchdog.md)） |

- 多个停止来源先后到达时只执行一次停止；退出码取更具体的原因：已请求 75 后再请求 1 仍以 75 退出。
- 启动失败时先同步写出一行致命诊断（原因、失败的门禁或插件入口），再有序停止已取得的资源，然后以 1 退出；不依赖未捕获异常终止进程。等待就绪的请求在致命诊断写出时即得到 503 `startup-failed`，先于监听关闭。按清单装配插件本身失败（还没有运行实例）时同样先写出致命诊断，再以 1 退出。
- 进程级未处理异常（未捕获异常、未处理的 Promise 拒绝）：同步写出致命诊断，按停止序列有序停止，以 1 退出。
- 关闭未完成时，进程退出前补写诊断存储中已接受的记录。

**开发模式：**

- 一条命令同时启动 Vite（前端热更新）与开发监督进程；Vite 把 API 请求代理到后端。
- 监督进程以 `--stop-stdin` 启动后端子进程；后端文件变化时经停止通道按停止序列有序停止旧进程，等它退出后再启动新进程；同一时刻只有一个后端进程持有进程级资源。新进程启动失败时监督进程报告原因并等待下一次文件变化，不循环重启。
- 监督进程收到 SIGTERM、SIGINT 时，先有序停止后端子进程，再停止 Vite 后退出。
- 插件热插拔（[`runtime.plugin-hot-plug`](plugin-hot-plug.md)）实现后，改为只重载变化的插件。

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

开发模式重启：旧后端进程停止中 → 旧进程退出 → 新后端进程启动中。

## 副作用与数据

- 宿主挂接的进程信号、未处理异常监听与停止通道归宿主，停止结算后移除。
- 启动失败与停止未完成写入诊断日志与标准错误；不删除任何用户数据。
- 监听归 `nbook.http` 的激活作用域，入口关闭时断开剩余连接。

## 失败与恢复

- 启动参数无效：写出致命诊断，以 1 退出，不建立运行实例。
- 启动失败（含端口已被占用）：有序停止、以 1 退出。
- 排空超时：继续关闭其余插件，退出码 1。
- 某个插件关闭抛错：记录错误，继续关闭其余插件，退出码 1。
- 租约失效：立即进入停止并拒绝新请求，退出码 75；已取得排他资源在依赖仍被使用时不提前释放。
- 开发模式新后端进程启动失败：监督进程报告原因，下一次文件变化时重试；不强行抢占资源。
- 强制结束（`SIGKILL`、断电）：不保证任何关闭步骤执行；下次启动按持久化数据与领域合同恢复。

## 边界与兼容

- **owner**：application-runtime（宿主适配器）；内核合同沿用 [`runtime.application`](application.md)、[`runtime.lifecycle`](lifecycle.md)。
- **兼容**：退出码 0、1、75、76 的含义保持不变。v2 去掉了旧应用的 `.output/server/index.mjs` 入口、`PRODUCT_SHUTDOWN_PATH` 控制请求与产品启动包装进程；它们服务的 Manager 与桌面版已在 v2 分支删除。
- **鉴权**：鉴权是可选的内置插件，向 `nbook.http` 贡献请求守卫；未加载时宿主只监听回环地址。
- **开发模式问题** 对应 [#244](https://github.com/notnotype/neuro-book/issues/244)。

## 验收与 Smoke

1. **同一模块图。** 生产打包产物中宿主入口与请求处理取得的是同一份后端模块实例。
2. **启动失败退出。** Given 启动必需插件激活失败或端口已被占用；Then 进程写出致命诊断后以 1 退出，不存活为只返回 503 的服务。
3. **有序停止。** Given 一个进行中的长请求；When 发送 SIGTERM；Then 新请求得到 503、长请求完成、插件按依赖逆序关闭，进程以 0 退出。
4. **停止通道不绕过排空。** 经标准输入 `stop` 停止时，行为与场景 3 相同；标准输入结束时同样有序停止。
5. **租约失效。** 模拟租约失效：进程停止并以 75 退出；随后又发生关闭失败，仍以 75 退出。
6. **排空超时。** 在途请求超过 20 秒：继续关闭其余插件，以 1 退出。
7. **开发重启。** 修改后端文件：旧后端进程有序停止后新进程启动，没有两个进程同时监听；新进程启动失败时监督进程不循环重启。
8. **开发停止。** 对开发监督进程发送 SIGTERM：后端子进程有序停止后监督进程退出。
9. **关闭步骤隔离。** 注入一个插件关闭时抛错：其余插件仍被关闭，退出码 1。
10. **未处理异常。** 插件代码抛出未捕获异常：写出致命诊断，有序停止，以 1 退出。
11. **参数校验。** 缺少状态根或监听地址不是回环地址：以 1 退出，不监听。

Smoke：生产打包产物在 Bun 下用临时状态根运行场景 1、2、4、11；开发模式运行场景 7、8。

## 实现合同

- **实现 owner 与入口**：application-runtime。进程入口 `packages/neuro-book/src/server/main.ts`；启动参数 `src/server/config.ts`（`readServerConfig(argv, env, cwd)`，失败抛带 `code` 的 `ServerConfigError`）；宿主适配器 `src/server/host.ts`（`startServerHost(options)` 返回 `ServerHost`：`requestStop(source)`、`stopSource`、`stopped`、`beforeStopError`、`detached`；选项含 `signals`、`process`、`stopInput`、`beforeStop`、`onFatal`、`emergency`）；装配 `src/server/start.ts`（`startServer({config, plugins?, process?, signals?, stopInput?, clock?, onListening?, writeFatal?})` 返回 `RunningServer`：`ready`、`stopped`（含退出码）、`url`、`requestStop(source)`；退出码在停止结束后由启动结果、未处理异常与停止中的失败一次算出；插件装配失败时写出致命诊断后抛 `ServerAssemblyError`）；后端插件装配 `src/server/plugins.ts`（按产品清单取工厂，清单有后端入口而无工厂时失败）。HTTP 准入与排空在 `src/plugins/http/server/admission.ts`，分发与 `http.routes` 接收在 `dispatch.ts`，贡献点合同在 `contracts.ts`，插件定义在 `plugin.ts`。
- **关键不变量**：
  - 一个进程只有一个产品运行实例；进程信号、未处理异常监听与停止通道只由宿主挂接一次，停止结算后移除。
  - 启动失败之外的停止来源经 `ServerHost.requestStop` 汇合，只执行一次；进程级未处理异常先交 `onFatal` 记录，再由宿主以 `fatal:<kind>` 请求停止。`beforeStop`（HTTP 排空）先于内核停止，失败仍继续关闭并记入 `beforeStopError`。启动失败由内核自行关闭，宿主随之结算并移除监听。退出码按 75 > 1 > 0 取值，退出码在启动结果确定后才结算。
  - `nbook.http` 只依赖 `nbook.diagnostics`；就绪前请求等待，启动失败与排空期间返回 503，事件流经 `registerEventStream` 登记后不计入等待、排空开始即关闭。插件处理器每次请求经 `implementation()` 取得，入口停止后不再被调用。
  - 测试插件只经 `startServer({plugins})` 注入，产品清单与产品代码不含测试分支。
- **合同测试**：`src/server/server.test.ts`（真实子进程：启动、标准输入与 SIGTERM 停止、在途请求、启动失败、关闭失败、未捕获异常、未处理的 Promise 拒绝、标准输入结束、非回环地址；同进程：排空超时、启动失败时等待就绪的请求得到 503、未处理异常汇合为一次停止且停止后监听全部移除、插件装配失败）、`src/server/config.test.ts`、`src/plugins/http/server/admission.test.ts`、`src/plugins/http/server/dispatch.test.ts`。
- **实际 smoke**：`bun run smoke:server`（先打包再运行场景 1、2、4、11），检查未执行时以非零退出。

## 证据

- 批准目标：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P6 与 P11（2026-09-30 开发者同意生命周期部分按验证证据写入）；[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 2 条；v2 的宿主与开发模式见 [NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 方案第 4 节（2026-10-03 `accepted`）与 [ADR 0023](../../adr/0023-v2-frontend-backend-stack.md)。
- 验证依据：[G0 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md)。
- 实现入口：[`main.ts`](../../../packages/neuro-book/src/server/main.ts)、[`start.ts`](../../../packages/neuro-book/src/server/start.ts)、[`host.ts`](../../../packages/neuro-book/src/server/host.ts)、[`http 插件`](../../../packages/neuro-book/src/plugins/http/server/plugin.ts)
- 合同测试：[`server.test.ts`](../../../packages/neuro-book/src/server/server.test.ts)、[`config.test.ts`](../../../packages/neuro-book/src/server/config.test.ts)、[`admission.test.ts`](../../../packages/neuro-book/src/plugins/http/server/admission.test.ts)、[`dispatch.test.ts`](../../../packages/neuro-book/src/plugins/http/server/dispatch.test.ts)
- Smoke：[`smoke-server.ts`](../../../packages/neuro-book/scripts/smoke-server.ts)（`bun run smoke:server`）
- 实现与验证：旧应用阶段 1 见 w00017 [t34](../../../.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/README.md)、[t37](../../../.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/README.md)、[t38](../../../.agents/works/w00017-application-runtime-architecture/tasks/t38-development-host/README.md)、[t40](../../../.agents/works/w00017-application-runtime-architecture/tasks/t40-phase1-closing/README.md)（2026-10-02 开发者批准晋升 `implemented`）；v2 后端宿主见 [t46](../../../.agents/works/w00017-application-runtime-architecture/tasks/t46-server-host/README.md)。
- 已知限制：
  - 开发模式（场景 7、8）随下一个 Task 在新应用实现；租约失效（场景 5）随 Session Store 插件实现；退出码 76 随看门狗实现。
  - Windows 上未实测；POSIX 信号路径由 Linux 上的真实子进程测试覆盖。
