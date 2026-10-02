# t38 开发宿主交付

## 1. 结论与验证
返工 1 完成；本轮要求的验证通过。最终恢复边界是热重载建立新 worker 与新模块图，不支持同一 worker 内请求重试；未提前改造 Storage/文件索引生命周期。本报告在本轮实现与验证前先落盘，现补实际结果。
checkout=`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation`；branch=`refactor/w00017-runtime-foundation`；HEAD=`653c3a235e40bc583fed283f9fc7336eba44c1ee`。改动未提交，无独立验证 revision；唯一证据位置为本目录。
| 完成标准 | 本轮结果 | 证据文件 |
|---|---|---|
| 1. 指定服务端范围 | 43 文件、327 tests passed；1 个既有 Windows 用例 skipped；exit=0 | `rework-1-server-tests.log` |
| 2. 三项类型检查 | runtime-foundation、scripts、Nuxt 均 0 错误、exit=0 | `rework-1-runtime-typecheck.log`、`rework-1-scripts-typecheck.log`、`rework-1-app-typecheck.log` |
| 3. 服务端基础 smoke | failures=0、exit=0 | `rework-1-runtime-smoke.log` |
| 4. 开发 L7/L8 | 全 pass，无 pending，exit=0；按本轮要求 skipBuild=true | `rework-1-lifecycle-dev-report.json`、`rework-1-lifecycle-development.log`、`rework-1-L7.log`、`rework-1-L8.log` |
| 5. 生产 L1–L6、L10 | 本轮未跑，交主 Agent；第一轮含构建全部 pass，不代表返工源码验收 | `lifecycle-prod-report.json`、`lifecycle-production.log`、`product-lifecycle-build.log` |
| 6. 完整 bun run dev 信号链 | SIGTERM 339ms、SIGINT 335ms；均 code=0、signal=null、无强制收口、锁释放、无进程残留，owner metadata 保留 | `rework-1-source-dev-signals.json`、`rework-1-source-dev-sigterm.log`、`rework-1-source-dev-sigint.log`；各自迁移输出在同前缀日志 |
L7.dev-ready=pass（port=39609、Node pid=3693342）；L7.hot-reload=pass（leaseId `12b45030-62ab-429a-bbee-a0b014e20344` → `d0ad33c9-b74a-40db-883d-b1072434b2fe`、health=200）；L8.sigterm=pass（pid=3693828、exit=0、锁 released、owner present）。
`graceful` 为 [INFERENCE]：单次信号分支等待 `shutdownNativeProduct()`，真实正常终态及无“转为强制收口”日志对应其 graceful 返回路径；未直接截取返回值。SIGTERM sourcePid=3695629/ownerPid=3695932；SIGINT sourcePid=3696579/ownerPid=3696864；进程树和清理证据在 `rework-1-cleanup.json`。
第一轮最后指定测试为 327 passed、1 failed、1 skipped（`server-tests.log`）；真实 Storage 重试返回 `STORAGE_SERVICE_CLOSED`，并未修成可重建单例，本轮按明确范围撤销该能力。第一轮类型检查、基础 smoke、L7/L8 及入口信号成功日志保留；入口两次分别 378ms/375ms。`before-signal-*`、`regression-before-*`、`product-lifecycle-report.json` 保留历史失败；`verification-summary.json` 已分轮更新。

## 2. 进程级资源与交接
Session Store `.lock`/heartbeat 是跨 worker 排他资源：旧 owner 原 release，新实例经原 acquire 获取；`runtime.lease` metadata 只诊断，不决定互斥，开发与生产均保留，不单独删除。
App SQLite/Prisma、Storage 句柄与在途操作、Agent jobs/订阅/profile watcher、Project/文件索引属于 worker 模块图：沿原依赖逆序关闭；新 worker 新建模块图，不在关闭的旧图重建单例。实际 Storage 缺口已复现，文件索引关闭后不可重用为源码推断；本任务未改两者实现。
Nuxt HTTP listener、SIGINT/SIGTERM 监听与主线程 BroadcastChannel 由开发进程宿主持有：先等 Product 停止回执，再关 Nuxt/listener、移除宿主监听并退出；worker bridge 在 close 中释放。原日志队列经 `appLogger.flush()` 后才回执，不作为租约互斥依据。

## 3. 设计与时序依据
Session Store runtime 仅开发开启交接：45,000ms/100ms 轮询，覆盖 20 秒 HTTP 排空并留插件关闭余量。逐轮原 acquire，由 proper-lockfile 判 stale；只有获取失败的 typed HeldError 且 owner 为同 PID runtime 才等待，foreign/migration/unknown owner 立即失败。保留 ELOCKED/cause；不删锁、不改 stale/heartbeat、不持半个锁。
开发适配器持有唯一 `startProductRuntime()` 返回实例，停止命令调用它的 `requestStop(source)`，close 调用它的 `stop()`。删除 retryBlocked/retryAfterStop/stopFinished、重试 mode/期限、ensure 与动态 current 停止入口；实例处理和中间件恢复 HEAD。失败恢复只由热重载触发新图。
主线程在 `nitro:init` 注册串行 `dev:reload` 门禁，先收到旧 Product 停止回执再让 Nitro 重载；命令有明确 targets/requestId，worker 停止 single-flight。`hmr:reload` 不追加替代 worker，signal/control/host:close 追加迟到 worker；45 秒回执超时报告失败，不伪装资源已释放。
`nuxt.close()` 单独不足：[源码] `nitropack/dist/core/index.mjs:2750` 的 reload 不 await 旧 close，2330–2331 即移出列表；2731 的 close 仅等列表内 worker。2355–2373 的 CI/test 分支跳过回执等待，非 CI 的默认 5 秒 timer 只可告警、不结算等待 promise；worker `dist/presets/_nitro/runtime/nitro-dev.mjs:104` 先断连接再并行关 listener 与 close hooks。[实测] 第一轮曾 exit=0 但锁残留；本轮 L7/L8 与入口信号正常。相比仅 nuxt.close、固定 sleep 或释放广播，回执加原租约获取分别证明停止顺序与实际所有权。
监听替换依据：[源码] `node_modules/listhen/dist/shared/listhen.BgWF2Mzc.mjs:759–760` 新增 SIGINT/SIGTERM `once(() => process.exit(0))`，保留会抢先退出、跳过异步排空。`@nuxt/cli/dist/dev-CQg8KtEQ.mjs:457–462,509` 先加载配置、后 listen、再 ready；`nuxt/dist/index.mjs:7337` 安装模块。配置 baseline 差集只替换新增 once；未知形状拒绝，已有监听及 listhen exit/SIGHUP 保留。
`vite:compiled` 已删除：[源码] 当前 ssr=false，`@nuxt/vite-builder/dist/index.mjs:1505–1508` 仅初次 buildServer 配置调用，开发 client 分支 1257–1264 不调用；原宿主 hook 先于 `@nuxt/nitro-server/dist/index.mjs:867–868` 的 reload hook 注册，但首次调用在 882–889 的 Nitro 编译之前，无旧 Product 可停。真实 HMR 走 dev:reload，本轮 L7 已实测；不把 client HMR 或其它 builder 扩入范围。

## 4. 最终公开行为
开发启动失败仍返回 `503 PRODUCT_STARTUP_FAILED` 和原 cause，不退出主进程、不由请求循环重试；交接超时诊断明确“热重载后可重试”。`runtime.startup.failed` 同步写 fd 2，避免 worker stderr 代理无 fd；关闭失败记 `product.shutdown.failed`。信号/控制请求经 20 秒排空和逆依赖关闭，正常退出 0，失败 1，回执租约失效 75 优先；1/75 只有合同测试证据。控制路由保持 loopback/token、202 与响应结束后 `control:http`；生产/CLI 不等待租约，原行为不扩展。

## 5. 测试迁移
`product-startup.test.ts` 删除五个请求重试专用用例：“场景 4：失败实例仍在停止时并发请求等待，停完后单次重试并在就绪后处理”；“失败清理挂起时开发请求在 45 秒后返回原 503，不重叠建立实例”；“开发重试仍失败时请求返回 503 与新的原因，不在同一请求里循环启动”；“开发实例显式停机后新请求仍返回 503，不能重新取得租约”；“启动失败停止期间收到显式停机请求，停完后也不能因请求重试”。这些重试能力已撤销；关闭后拒绝启动由原实例处理测试和下项承担，跨 worker 恢复由 L7 承担。
原“场景 2…下一请求可重试”改为“开发交接超时诊断保留 ELOCKED 原因，同一 worker 请求保持 503”；保留 cause、503、已停止拒绝再启动。原交接期间请求等待、production/cli 单参数不等待及已停止拒绝的测试保留；HTTP `admission.test.ts` 保留 `PRODUCT_STARTUP_FAILED`/cause 合同。
删除 `development-storage-retry.test.ts`：不是跳过红测，而是撤销同 worker 重建能力；其真实失败完整保留在 `server-tests.log` 与 `regression-before-storage-retry.log`，不宣称 Storage 已修复。
原“开发停止删除 owner、生产保留”改为 false/true 两种选项均释放锁、保留相同 metadata 且可重新取排他租约；删除只供旧只读轮询使用的快照 API 与其 EISDIR 测试，测试直接观测文件，不保留产品测试专用接口。
开发适配器回到持有返回实例，原初始化与单一 close 失败诊断测试保留；路由保留授权、202、finish/close 去重，增加主线程通知。协调器回归覆盖 HMR 替代 worker 不停止、进程停止迟到 worker 必须回执、未知监听拒绝、重复停止与退出码；租约新增真实 stale 残留锁回归。

## 6. 改动文件
下列 server 路径均以 `packages/neuro-book/` 为前缀；范围内共 14 个源码/测试文件，另有本 Task `evidences/`：
`nuxt.config.ts`；`server/agent/session/agent-session-store-lease.ts`、`agent-session-store-runtime.ts`、`agent-session-store-runtime.test.ts`；`server/features/session-store/plugin.ts`；`server/host/development-process.ts`、`development-process.test.ts`（新增）、`development-plugin.ts`、`development-plugin.test.ts`、`startup-diagnostic.ts`；`server/routes/__nbook/control/shutdown.post.ts`、`shutdown.post.test.ts`；`server/runtime/product-startup.ts`、`product-startup.test.ts`。
`server/middleware/00-product-http.ts` 无最终 diff；第一轮未跟踪的 `development-storage-retry.test.ts` 按授权删除。用户 `packages/neuro-book/docs/research/README.md` 改动保留未触碰；启动器、内核、其它 Nitro 插件、基础 host/HTTP 实现、Spec、README、包/锁/TypeScript/Vitest 配置未改。

## 7. 禁止清单自查
- 已核对：产品错误分支按错误类型、owner kind/pid 与退出码，不按错误文案；关闭错误写诊断，无新增静默吞错。
- 已核对：未跳测、放宽断言、改报失败或加产品测试分支；唯一 skipped 是既有 Windows 平台用例。撤销测试均对应明确撤销的能力，失败基线保留。
- 已核对：范围外源码、配置和注释不改，用户 research README 保留；未修补 node_modules、修改 smoke 判据或提前改造完整插件。
- 已核对：原关闭、日志刷写、release、停止去重与 finally 收口保留；删除过时重试/快照/owner 删除入口，无第二条资源重建路径。
- 已核对：跨包经公开入口，未深导入其它包源码；主要设计与编码自行完成。
- 已核对：先核实依赖源码并运行真实路径；未把源码推断、mock 回执或历史结果冒充真实本轮验收；graceful 返回值取证边界明确。
- 已核对：未使用 rm -rf 清理仓库；删除的旧测试原为未跟踪文件。命令从 worktree 根执行、证据保存正式目录；临时根用测试支持路径分配，自己的两条信号链与 smoke 根已清理，无自有残留进程。
未 commit/push/stash/切分支/改 Git 配置、代理、时区或 locale；本轮所有重任务串行，开发服务结束后才启动下一项，未在构建中编辑工作树。注释中文，仅解释非显然边界。

## 8. 遗留与回写建议
1. 主 Agent 运行生产 L1–L6、L10 与全量测试并决定验收；本轮历史生产成功不替代这些结果。
2. `shutdownNativeProduct()` graceful 返回值未直接截取；已实测单次信号、正常退出、无强制日志、租约释放和完整进程树收口。
3. 真实关闭失败 1/75 及 45 秒停止超时未做故障注入，只有合同回归；超时不代表旧资源已释放。
4. Nuxt/listhen/Nitro 升级需复验 listener 差集/once 形状、初始化和 dev:reload 顺序；不支持 nuxi 分叉模式、Windows、Bun 开发 worker。
5. 回写建议〔新规范/规范缺陷，交主 Agent〕：按开发者决定改写 `docs/specs/runtime/server-host.md:69–70` 为“开发启动失败只由热重载的新 worker 重试，同 worker 请求保持 503”；任务停止措辞对齐已有 `agent/session-store-lease.md:34,54` 的 metadata 仅诊断、正常释放只清锁目录，不另建重复规范。编码者未改 Spec/Task 正文。

## 返工 1
1. 逐轮 acquire，proper-lockfile 原 stale 协议恢复；同 PID 过期锁回归先超时红、修复后绿。
2. 删除 removeLeaseOwner 与 owner rm，开发/生产统一原 release；两种选项的文件与重新获取回归绿，真实 L8/信号均锁释放、owner 保留。
3. hmr:reload 不追加替代 worker，回归先捕获错误命令红、修复后绿；signal/control/host:close 仍追加迟到 worker，必须等回执。
4. 核实 ssr=false 的 vite:compiled 仅初次配置，原宿主先于 Nitro reload hook 但无实际旧实例；删除无效钩子，L7 真实热重载通过。
5. 已写明 listhen 的文件行号、直接 exit 风险与 CLI 注册顺序；保留未知监听拒绝、已有监听测试；真实 L8、SIGTERM、SIGINT 全通过。
失败前 `rework-1-regression-before.log`：2 failed、24 passed；修复后 `rework-1-regression-after.log`：5 文件、65 passed。随后删除旧快照专用 EISDIR 用例，最终指定范围为 327 passed、1 skipped；最新结果与第一轮明确分开。
