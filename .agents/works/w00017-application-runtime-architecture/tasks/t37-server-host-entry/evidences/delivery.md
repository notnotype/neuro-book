# t37 交付报告：自有服务端宿主入口与 nbook.http

## 1. 结论与完成标准

结论：首次交付记录见第 1–9 节；返工 1 已按审查意见收回非排空 SSE 改动，并完成当前源码验证，最新结论与证据见第 10 节。

| 完成标准 | 结果与证据 |
|---|---|
| 1. 改动测试 | 首次交付：21 文件 / 148 用例通过：`server-tests-signal-fix.log`；构建合同 1 文件 / 8 用例通过：`build-contract-tests-signal-fix.log`。未运行全量 `bun run test`。 |
| 2. 类型检查 | 首次交付的 `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` 均 code 0；日志均含完整命令与输出。 |
| 3. runtime smoke | 首次交付的 `smoke:runtime-foundation -- --host server` code 0，`failures=0`；最终来源 `signal:SIGTERM`。 |
| 4. 生产 L1–L6 | 首次交付含生产构建，`skipBuild=false`，code 0；6 项、18 个子断言全部 pass。最终 imageId=`sha256:aaa41be756879ff2be4cd743084706e856d202c9cb0687e2540887567a455be9`。 |
| 5. 开发与参考 L7–L8 | 首次交付独立开发 `/api/app/version` 为 200、首页真实加载；L7 pass；L8 按要求运行但 fail，见下文，属于 #244 范围外。 |

L1：真实 Chromium 登录、创建 Project、写入文件、工作台文件树全部 pass。L2：依赖激活顺序 pass。L3：SIGTERM 下新请求 503、在途归档完整、退出 0 且租约释放、逆序关闭全部 pass。L4：同样的 503/完整归档/退出 0/租约/逆序关闭，加 `PRODUCT_SHUTDOWN_PATH` 控制停止全部 pass。L5：迁移未完成时致命诊断、30 秒内退出、无监听全部 pass，退出码 1。L6：租约锁删除后退出码 75 pass。

开发证据：`development-browser.json`、`development-home.webp`、`development-service-final.log`、`process-cleanup-final.json`。实际停止后端口不可连接、进程树无残留、临时 State Root 已删除。L7 的 Node ready 与热重载 leaseId 变化/health 200 均 pass。L8 的 SIGTERM 本身 code 0 且在窗口内完成，但 runtime lease lock/owner 仍存在，失败原文为 `SIGTERM后runtime lease锁未释放`；未改 smoke 判据，也未将失败叙述为通过。

## 2. 设计与时序

- `server/host/product-host-entry.ts` 是生产 `.output/server/index.mjs` 的入口；保留 Nitro 内部 polyfill 与 `trapUnhandledNodeErrors`，并注释升级时需重新验证。Nuxt 模块只在非开发配置 Nitro entry，prerender 删除 entry；开发只注册 `server/host/development-plugin.ts`。
- `startProductRuntime()` 在 `server/runtime/product-startup.ts` 建立唯一当前实例，生产、开发、CLI 共用；`currentProductRuntime()` 只取得，不启动。删除 globalThis 单例、`productRuntimeReady()`、`stopProductRuntime()`、`exitOnProductStartupFailure()`。CLI 保留 `runtime.ready` 与 `runtime.stop()`，不监听端口；真实端口占用合同已测试。
- `nbook.http` 位于 `server/features/http/`，是启动必需且无业务依赖的插件。生产用 Nitro h3 app 的 Node listener 监听 `NITRO_PORT`/`PORT` 和 `NITRO_HOST`/`HOST`，保留 `Listening on <url>`；开发/CLI 只提供准入，不监听。清理在监听前登记，关闭时调用 `server.close()` 和 `closeAllConnections()`。
- `server/middleware/00-product-http.ts` 只借用准入。`ProductHttpAdmission` 在 ready 前等待；启动失败返回 503 与 `PRODUCT_STARTUP_FAILED`；停止中立即返回 503 与 `NeuroBook 正在关闭。`；finish/close 使用 WeakMap 与一次性释放。SSE 从普通请求计数移出，在排空开始主动关闭；普通请求和异步 SSE close 共享 20 秒可注入截止，超时继续后续关闭并记为 code 1。
- `ServerRuntimeHost.beforeStop()` 是“先排空、后其余插件”的显式前置步骤：停止来源首次记录并只执行一次，先 drain，再 abort 内核 stop signal，再由 application 依赖逆序关闭；完成后移除信号监听。最终结算等待 host/app startup、聚合 `http-drain` 与 `product-runtime`，最后刷写 app logger，再执行注入的退出回调。
- 信号监听器按注册信号创建闭包，使来源为 `signal:SIGTERM`/`signal:SIGINT` 且不依赖监听器实参；不据此断言 Node/Bun 不传参数。主 Agent 实测两者收到 `["SIGTERM", 15]`。75 优先于后续 1，控制路由保留 loopback、bearer token、202 和 finish/close 一次触发，Session Store 租约经 ProductStopPort 汇合。
- 启动失败先同步写 `runtime.startup.failed` 与迁移提示到 fatal 日志/stderr，再释放已取得资源；停止失败写 `product.shutdown.failed`，底层原因保留在 `cause`。开发 close 钩子只有一个且不抛错，失败写诊断。

## 3. 公开行为变化

新增：`nbook.http`、`ProductHttpAdmission`、`ProductStopPort`、`startProductRuntime()`/`currentProductRuntime()`、生产宿主入口、最小开发适配器；四个 SSE 路由登记 HTTP 排空 owner，其中 workspace 文件流的 close rejection 汇总到统一停止结算；新增 `runtime.startup.failed`、`runtime.startup.diagnosticFailed`、`product.shutdown.failed`。退出码语义保持 0/1/75：完整停止 0，启动/停止失败或超时 1，租约失效无论后续关闭结果均 75。

删除：旧启动中间件、旧 drain 中间件、Nitro close 的 Project Session 路径、手写 shutdown controller/关闭清单及其测试；`product-shutdown-client.ts` 保留。`runtime/**` 内核未修改。Manager/Desktop 路径、`.output/server/index.mjs`、就绪探测、`PRODUCT_SHUTDOWN_PATH`、loopback/token 合同未改。

## 4. 测试删除、改写与覆盖

逐个迁移表在 `test-migration.md`；机器审计在 `deleted-test-coverage.json`、`rewritten-tests-audit.json`。核心映射：旧启动失败测试由同步诊断/有序停止与 L5 覆盖；旧 drain 测试由 admission 行为及真实 HTTP/SSE 覆盖；旧 Nitro close 与 shutdown controller 测试由 host/product-startup、失败聚合、日志后置和 L3/L4 close-order 覆盖；旧退出码竞争由 75 优先级合同覆盖；旧源码字符串断言删除，改为可观察行为。返工后恢复 workspace SSE 原有 `TypeError("stream is closing or closed")` fixture，仅保留排空关闭失败传播回归。

## 5. 改动文件与范围

首次交付授权源码/测试共 40 个文件，完整清单在 `repository-audit-final.json`；返工恢复 `server/utils/event-stream.ts` 为 HEAD，当前源码/测试 diff 减为 39 个文件。分组如下：

- 新增：`server/host/**`（生产入口、开发适配器、错误/诊断/停止端口及测试）；`server/features/http/**`（准入、插件及测试）；`server/middleware/00-product-http.ts`。
- 修改：`nuxt.config.ts`；`server/runtime/product-startup*`、`server/runtime/foundation/server-host*`；Session Store 停止端口；停止路由及测试；四个 SSE 路由与 workspace SSE 测试；指定 seed/CLI/deploy 启动调用方；`scripts/build/nuxt-output-contract.test.ts`。
- 删除：`00-product-startup.*`、`product-shutdown-drain.*`、`project-session-close.*`、`runtime/shutdown/product-shutdown.*`、`product-shutdown-controller.*`，共 10 个旧路径文件。
- `packages/neuro-book/docs/research/README.md` 是开发者既有修改，本任务未触碰。未改 `runtime/**`、`app/**`、smoke 判据、普通 docs/README、package/lock、TypeScript/Vitest 配置、Manager/Desktop。

## 6. 禁止清单逐条自查

1. 新增错误分支按错误类型、生命周期状态或 close Promise rejection 处理，未按新增错误文案分支；旧 SSE 判定与 presence 非排空 catch 已恢复 HEAD，workspace close rejection 只由统一 HTTP drain 观察。
2. 未跳过/放宽测试，未添加产品测试专用分支；L8 真实失败如实保留。
3. 未替换任务外代码、配置或注释；保留既有研究 README 用户改动。
4. 迁移保留失败清理、日志 flush、显式 recover 与资源收口，无第二套旧生命周期路径。
5. 未跨包深导入源码；跨包使用公开包入口。
6. 运行时事实优先于审查推断；撤回子代理关于信号无参数的错误结论。保留绑定注册信号的实现，只更正注释、用例名及报告。
7. 未使用 `rm -rf`；临时数据在系统 Temp，验证后已清理；未删除跟踪文件。
8. 未 commit、push、stash、切分支、改 Git 配置；未设置 proxy、时区或 locale。未运行全量 `bun run test`。

## 7. #244 后续注意事项（不超过 5 条）

1. 开发 HMR 交接需在新实例取得 Session Store lease 前有界等待旧实例释放，并允许启动失败后重试，不缓存失败。
2. 开发 SIGTERM/停止控制需复用宿主停止入口，确保 lease lock 和 owner file 在进程退出前释放；当前 L8 的唯一失败就是该边界。
3. 开发适配器需核对真实进程信号与 Nitro close 的交接时序、首个停止来源和监听器释放，避免重复 close；不假设进程信号回调没有参数。
4. 若扩大 SSE/插件通道范围，应为 WebSocket、插件 channel 和其他 Nitro plugin 分别登记 drain/close owner；本 Task 未迁移它们。
5. 继续保持 `nbook.http` 无业务依赖与停止前置 drain；否则端口先监听和“先排空、后关闭插件”会再次冲突。

## 8. 任务反思回写建议（未获批准，未写入规范）

| 编号 | 类别 | 依据 | 建议修改 | 目标位置 |
|---|---|---|---|---|
| 2 | 踩坑 | 初次生产构建失败时 smoke 命令返回 code 0 且报告为 pending，不能只依赖命令退出码判断验收；本次通过人工核对 JSON 后重跑。 | 新增：验收 runner 遇构建失败或 selected 检查为 pending 必须返回非零；调用方同时断言机器可读报告无 pending。 | `docs/testing/README.md` 的验证门禁；后续单独修 smoke runner |

以上仅为建议，未修改 `docs/**` 或 smoke 判定，等待开发者批准后再回写。

原回写建议 1 已撤回：关于 Node/Bun 信号回调不传信号名的结论与主 Agent 实测矛盾，不能写入规范。
## 9. 交付状态

当前 branch=`refactor/w00017-runtime-foundation`，HEAD=`8d6b2d7ffb3a7a1bbfa85ba88b13ea5308caf697`；变更未提交，证据覆盖当前未提交 diff。最终审计：无范围外源码改动、无产品/开发残留进程、临时根已删除。

## 10. 返工 1（审查意见 1）

返工结论：按用户更正收回错误的信号事实推断，并把 SSE 改动缩到 HTTP 排空所需范围；当前验证通过，未改内核、smoke 判据、app、普通 docs/README、package/lock、TypeScript/Vitest 配置。

### 信号事实

- `server-host.ts` 保留按注册信号创建闭包，停止来源仍由 `signal:${signal}` 确定；这让来源不依赖监听器实参，但不声称 Node/Bun 不传实参。
- 主 Agent 已实测 Node 与 Bun 的 `SIGTERM` 回调收到 `["SIGTERM", 15]`。`server-host.test.ts` 的无参触发只验证 `SignalSource` 适配边界，不是 Node/Bun 真实回调参数回归。旧审查结论已在 `http-review.json` 标为 `withdrawn`，回写建议 1 撤回。

### SSE 逐处收回与保留

- `server/utils/event-stream.ts` 完整恢复 HEAD；没有保留额外的 Bun 错误码或 `closing` 参数判定。
- `server/api/projects/presence.get.ts` 仅保留 `registerHttpEventStream` 登记及 callback 中的 `cleanup()`、`eventStream.close()` 返回值。这样 HTTP drain 能主动关闭 presence SSE，并等待该 close Promise；heartbeat 类型、心跳/首帧 catch、`onClosed` 和原有静默收口均恢复 HEAD。
- `server/api/workspace-files/events.get.ts` 保留登记，并让 `finish()` 缓存 close Promise、在 cleanup 后等待 operation completion，同时把 close rejection 原因交回统一 HTTP 停止结算。修改前测试证据 `rework-1-sse-before-fix.txt` 中新增排空用例将“应拒绝”错误地解析为成功；当前实现以最小状态记录保证关闭失败不被吞掉。其余 push 错误判定恢复 HEAD。
- `server/api/agent/jobs/events.get.ts` 与 `server/api/agent/sessions/[sessionId]/events.get.ts` 只保留原有 subscription close 登记；没有新增 SSE 业务清理逻辑。
- `events.get.test.ts` 恢复 HEAD 的 `TypeError("stream is closing or closed")` fixture；保留排空 close failure 回归，当前独立工作区流测试为 7/7。

### 返工验证

- `rework-1-server-tests.txt`：指定服务端、workspace、projects、agent 范围 54 个文件 / 298 个用例通过，code 0。
- `rework-1-runtime-typecheck.txt`：`typecheck:runtime-foundation` code 0。
- `rework-1-scripts-typecheck.txt`：`scripts:typecheck` code 0。
- `rework-1-lifecycle.txt` 与 `rework-1-lifecycle-report.json`：含真实生产构建，`skipBuild=false`；L1、L3、L4 三项均 pass，共 13 个子断言，code 0。构建输出在 `product-lifecycle-build.log`，本次 imageId=`sha256:5ddfc50efc32ca6604dfb5e5bbcaecc336a508fa810519dc79449aacab3aa3c7`；各子断言完整输出在 `L1.log`、`L3.log`、`L4.log`。
- `rework-1-sse-before-fix.txt` 保存修改前失败证据；`rework-1-sse-after-fix.txt` 保存恢复后的 7/7 工作区事件流测试。
- 以上命令完整输出均保存为 `rework-1-*.txt`；L1/L3/L4 的机器报告与构建日志保留原始 JSON/日志格式。未 commit、push、stash、切分支或改 Git 配置。

本次用户纠正属于事实源优先，未产生新的规范回写；原任务反思建议 1 已撤回，建议 2 仍未获批准。