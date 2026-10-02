# t40 阶段 1 收尾交付记录

## 1. 结论与验证

A–D 实现与改动回归已完成；审查意见 1 接受 Storage 并发读取失败为 t34–t39 已知基线，不阻塞本任务，并接受两处直接受旧入口删除影响的测试改动。返工 1 已撤销产品日志器的位置授予：只保留进程内共享 writer，产品 AppFileLogger 仍不参与位置授予；本轮验证与证据见文末“返工 1”。下面保留初次交付的运行记录，不能把旧 image 的 L1–L10 通过冒充返工后复跑。

- Work/Task：`w00017-application-runtime-architecture/t40-phase1-closing`；授权与不做项依据 [brief.md](../brief.md)。
- checkout：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation`；分支 `refactor/w00017-runtime-foundation`；HEAD `fddef68b15131268fba4e7d3c47f8529ce03e3c1`。改动未提交，无独立实现 revision；未 commit、push、stash 或切分支。
- 初次交付 Git 快照：0 staged、29 tracked unstaged、11 untracked 顶层条目；tracked diff `+430 -594`，包含开发者自己的 `packages/neuro-book/docs/research/README.md` 两行新增，原样保留。返工后的删除与恢复改变该计数，最终范围见文末。本证据目录原本未跟踪，状态中的整目录条目不等于本任务新建或修改其全部正文。
- 唯一证据位置：本 `evidences/` 目录。所有命令从该 checkout 根执行；日志首行保留实际 Bun 参数、末尾保留 `EXIT {code,signal}`。

| 初次交付完成标准 | 实测结果 | 完整输出 |
| --- | --- | --- |
| 1：新增与改动测试、指定集合 | 改动集合 12 files / 90 tests 通过；正式 builder 2 files / 5 tests 通过；最后命名类型清理后的 Storage 4 tests 通过。指定集合 53 files / 453 tests 中 52 files / 452 tests 通过、1 test 失败，退出 1 | [changed-tests-final.log](changed-tests-final.log)、[official-command-graph.log](official-command-graph.log)、[storage-test-final.log](storage-test-final.log)、[specified-tests-after.log](specified-tests-after.log) |
| 2：三类 typecheck | `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` 均退出 0 | [typecheck-runtime-foundation-final.log](typecheck-runtime-foundation-final.log)、[scripts-typecheck-final.log](scripts-typecheck-final.log)、[typecheck-application-final.log](typecheck-application-final.log) |
| 3：runtime-foundation | `--host server` 与 `--services` 均 failures=0、退出 0 | [smoke-runtime-foundation-server.log](smoke-runtime-foundation-server.log)、[smoke-runtime-foundation-services.log](smoke-runtime-foundation-services.log) |
| 4：完整 product-lifecycle，含生产构建 | L1–L10 均 pass，0 pending，`skipBuild:false`，退出 0；L1 dispose-complete exitCode=0、leaseLock=false | [product-lifecycle-final.log](product-lifecycle-final.log)、[最终报告](final-lifecycle/lifecycle-report.json)、[构建输出](final-lifecycle/product-lifecycle-build.log)、[L1 收尾](final-lifecycle/L1.log) |
| 5：生产日志单写入 | app.logs.ready 可读；一次 console.error 恰好 1 条 JSONL；停止 `{code:0,signal:null}`，日志目录锁释放、Temp 删除。额外验证实际 HTTP 200 的 Server-Timing、HTTP 400 的请求日志不含 query 标记 | [production-http-logs-final.log](production-http-logs-final.log)、[production-logs.json](production-logs.json)、[production-logs.jsonl](production-logs.jsonl) |

实际验证命令（长命令的全部参数见对应日志首行）：

```sh
bun run --cwd packages/neuro-book test -- server/runtime/product-command.test.ts scripts/smoke/product-lifecycle.test.ts server/runtime/product-startup.test.ts server/features/app-state/plugin.test.ts server/features/http/plugin.test.ts server/features/runtime-diagnostics/product-plugin.test.ts server/features/runtime-diagnostics/jsonl-exporter.test.ts server/storage/workbench-migration-e2e.test.ts server/app-logs/logger.test.ts server/host/development-plugin.test.ts server/utils/server-timing.test.ts scripts/db/migrate-application-state.test.ts
bun x vitest run --config scripts/vitest.config.ts scripts/build/product-command-graph.test.ts scripts/build/product-reproducible-bundle.test.ts
bun run --cwd packages/neuro-book test -- server/storage/workbench-migration-e2e.test.ts
bun run --cwd packages/neuro-book test -- server/plugins server/features server/runtime server/host server/middleware server/routes server/app-logs server/storage server/config scripts/db scripts/smoke
bun run --cwd packages/neuro-book typecheck:runtime-foundation
bun run --cwd packages/neuro-book scripts:typecheck
bun run --cwd packages/neuro-book typecheck
bun run --cwd packages/neuro-book smoke:runtime-foundation -- --host server
bun run --cwd packages/neuro-book smoke:runtime-foundation -- --services
bun run --cwd packages/neuro-book smoke:product-lifecycle -- --browser-executable /usr/bin/google-chrome-stable --report "$PWD/.agents/works/w00017-application-runtime-architecture/tasks/t40-phase1-closing/evidences/final-lifecycle/lifecycle-report.json"
```

初次生产日志探针使用 Bun `--tsconfig-override packages/neuro-book/tsconfig.json`、隔离 State Root、正式 migration/资产准备和当时的 `.output/server/index.mjs`；只在 Temp 使用 TCP 控制 preload 触发 console.error，不修改产物或新增产品路由。临时取证脚本验证后删除，执行参数和完整输出保留。初次验证之后只清理了 `workbench-migration-e2e.test.ts` 的命名类型注解，其 4 用例单独重验；返工 1 随后修改了产品日志行为，新的验证与 image 身份见文末。`scripts:typecheck` 按现有配置排除 `.test.ts`，不能声称三类检查覆盖所有测试文件。未运行全量 `bun run test`，未另跑 foundation `--host browser`，也未调用真实模型。

### 初次交付 L1–L10 结果（返工前）

| 检查 | 结果 | 关键观测与原始证据 |
| --- | --- | --- |
| L1 | pass / 8555ms | 真实 Chromium 登录、POST 创建 Project、文件树可见；dispose exitCode=0、leaseLock=false；[日志](final-lifecycle/L1.log)、[截图](final-lifecycle/L1-workbench.png) |
| L2 | pass / 5151ms | 新增 nbook.diagnostics/main 后，发布顺序符合从目录推导的全部依赖边；[日志](final-lifecycle/L2.log) |
| L3 | pass / 7788ms | 重复组 SIGTERM 后排空；新请求 503、archive EOF 完整 134307895 bytes，退出 0、租约释放；[日志](final-lifecycle/L3.log) |
| L4 | pass / 9542ms | Manager stop=graceful；archive EOF 完整 134311143 bytes，退出 0、租约释放，关闭顺序符合依赖逆序；[日志](final-lifecycle/L4.log) |
| L5 | pass / 744ms | 未迁移 State Root 写致命原因、退出 1，30 秒内结算、无残留 listener；[日志](final-lifecycle/L5.log) |
| L6 | pass / 19596ms | 删除 runtime.lease.lock 后最外层退出 75；[日志](final-lifecycle/L6.log) |
| L7 | pass / 43021ms | 实际 Node Nuxt dev HMR 后 lease owner 改变，health=200；[日志](final-lifecycle/L7.log) |
| L8 | pass / 27373ms | 向实际 Node dev PID 发送 SIGTERM，退出 0、租约锁释放；[日志](final-lifecycle/L8.log) |
| L9 | pass / 2688ms | bootstrap HTTP 500 不留下半工作台；真实 retry 后恢复；[日志](final-lifecycle/L9.log) |
| L10 | pass / 14067ms | 关闭窗口 A 后 B 可重载、读取，服务仍 ready；收尾 exitCode=0、leaseLock=false；[日志](final-lifecycle/L10.log) |

初次交付生产身份：schema `nbook.product-runtime-image/v3`，builder contract `3`，platform `linux-x64-glibc`，version `0.10.2-canary.20260908.091411Z.2e86c254`，Bun `1.4.2`、Nuxt `4.4.8`、Nitro `2.13.4`，revision 为上述 HEAD，`dirty:true`。

- imageId：`sha256:2a588e669495134bfe3e06aafa9778388ea345b2c56794ad84614dd4828d0ce7`。
- sourceDigest：`sha256:3529940becdd2448440b541715c68b25c0417eae84f19d3d4fcb2a18458c6b5e`；createdAt：`2026-10-02T12:49:29.441Z`。
- 初次 lifecycle 构建与 production-logs.json 中的 imageId 一致；sourceDigest 是当时的构建快照，不冒充返工后的运行源码或随后报告修改的 checkout 内容身份。
- [cleanup-results.json](cleanup-results.json) 已实测核对基线、旧实现 RED、两轮 lifecycle、foundation services 与最终日志探针的 6 个临时根均不存在；日志探针进程已退出 0、锁已释放。仅结束本任务自己启动的进程。

### B 的修改前实测与 RED/GREEN

1. [baseline-sigterm-before.json](baseline-sigterm-before.json)：旧真实 `.output` 包装链已 HTTP ready；整组 SIGTERM 后提前以 `{code:1,signal:null}` 结束并报告 `Product Runtime command 被信号中断：SIGTERM`，再次组信号得到 `ESRCH: No such process`。这不是“成功送达两次”的记录，不能将该基线单独当作第二次信号已送达的证明。
2. [baseline-exit-code-before.json](baseline-exit-code-before.json)：旧 product-start 的真实服务子进程分别退出 0、1、75，包装器三次均改为 0，直接确认掩盖 1/75。
3. [wrapper-regression-red.log](wrapper-regression-red.log)：从 HEAD 只读提取两个旧 wrapper 到受控 Temp，使用与当前回归相同的 builder、真实进程和 TCP 握手；只替换测试 fixture 的 wrapper 源码位置，不改断言或当前 `.output`。4 条均失败，实际最外层 `{code:null,signal:"SIGTERM"}`，退出 1。Temp 已删除。
4. 当前包装器的 4 条相同用例由 [focused-wrapper-smoke-after.log](focused-wrapper-smoke-after.log) 和 [changed-tests-final.log](changed-tests-final.log) 证明通过；整组重复信号不提前退出，收到 finish 后传递 0/1/75；仅对外层重复 SIGTERM/SIGINT 时服务只收到一次转发。

前期失败完整保留，不冒充成功或产品 RED：[focused-wrapper-smoke.log](focused-wrapper-smoke.log)（Node 导入 bun:sqlite、控制连接建立时序）、[focused-plugin-migration-first.log](focused-plugin-migration-first.log) 和 [focused-plugin-migration-after.log](focused-plugin-migration-after.log)（测试 provider namespace、HMR service-key 身份）、[specified-tests.log](specified-tests.log)（旧 host 参数断言及 Storage 失败）、[typecheck-runtime-foundation.log](typecheck-runtime-foundation.log)、[scripts-typecheck.log](scripts-typecheck.log)（可选 release 调用与 Nitro 弱类型不相交）、[typecheck-application.log](typecheck-application.log)（工具中断，无通过结算）、[production-logs.log](production-logs.log)（别名解析）、[production-logs-final.log](production-logs-final.log)（错误假定未知 API 路径一定返回 404）。修正仅针对这些测试或取证模型的直接问题；生产未知 API 路径返回 200 未被改为 404。

## 2. 设计

| 删除的 Nitro 插件 | 新归属 | 建立与撤销 |
| --- | --- | --- |
| app-logs.ts | nbook.diagnostics/main；product-plugin.ts + app-log-bridge.ts | 激活安装 consola reporter、console.warn/error、异常监听并写 app.logs.ready；诊断服务释放时撤销，恢复原函数/reporters/listeners；不再用 globalThis 防重 |
| error-logger.ts | nbook.http/server；request-error.ts | 激活注册 Nitro error hook；记录 method、pathname、状态、摘要及清理当前 URL query 后的错误；activation scope 关闭执行注销函数 |
| boot-config.ts | nbook.app-state/server | 激活执行 loadBootAuthEnabledSync；非法配置进入必需插件失败、保留原因与致命诊断、退出 1 |
| storage-definitions.ts | nbook.storage/server | 激活 registerProductStorageDefinitions；沿用既有定义实例与 HMR 幂等合同，释放仍 disposeStorageHost |
| server-timing.ts | nbook.http/server | 激活注册 beforeResponse，调用既有 flushServerTiming；关闭注销 hook |

startProductRuntime 创建 DiagnosticsStore，使用平台中立 createDiagnosticsPlugin、mechanismObservers 和 recordingEmergency；`runtime/**` 未改。产品 exporter 直接借用 appLogger.writeDiagnostic，普通日志与诊断记录使用 AppFileLogger 的同一 JsonlLogWriter，不申请授予或另外创建 writer。产品 AppFileLogger 仍不参与位置授予：没有 open/degraded、managed/grantLost 或授予写入门禁；info/error、console 桥接与 fatalSync 恢复 HEAD 的既有写入行为。log-location.ts 已删除，foundation JSONL 出口的授予代码恢复到 jsonl-exporter.ts 的 HEAD 实现；foundation 出口仍以位置锁处理冲突/失守并降级。产品目录跨进程互斥、开发 worker 交接与冲突输出去向不在本 Task 实现。

http/app-state 显式依赖 diagnostics，其它必需产品插件经依赖闭包继承；因此桥接先激活、最后撤销。既有 runtime.plugins.catalog/runtime.plugins.diagnostic 数据布局保留，目录及早期事件缓冲到 diagnostics 发布后写出；机制诊断另经 store 写入，来源身份在 data.$source。全部插件 closed 后宿主最终 flush，再 close 共享 writer；exporter.close 只关闭借用出口，不提前关闭 writer。首次 incomplete 不提前 close，显式 recover 达到 application.closed 后再完成最终 flush/close；不存在产品日志授予取得或释放步骤。

生产宿主与开发适配器向 startProductRuntime 传入各自 nitroApp；CLI 无 nitroApp 时不注册上述钩子。每个开发 worker 的桥接随实例安装/撤销，旧实例关闭后新实例仅安装一次。server/plugins 中五个旧入口及旧接线测试已删除；live server/scripts/build 搜索无旧入口引用。Manager 就绪、停止、产物路径、强制结束时序与 L1–L10 判据未修改。

## 3. 公开行为变化（供主 Agent 更新 Spec）

- smoke：所选结果全部 pass 且主流程无异常时退出 0；任一 pending/fail 或主流程异常退出 1。JSON schema、字段与逐项输出格式不变。
- wrappers：持续吸收 SIGINT/SIGTERM，仅首次向子进程转发；等待服务终态，数字退出码 0/1/75 原样传递。服务被信号结束时两层映射为 `128 + signal number`（SIGTERM=143、SIGINT=130），避免容器 PID 1 对自发同信号的默认行为不确定；该取舍已在审查意见 1 接受，强制信号映射未单独实测。
- 日志：保留 app.logs.ready、console.warn/error、server.request.error 等现有事件，生产 console.error 不再双写；新增 nbook.diagnostics 机制记录，data.$source 携带身份。runtime.plugins.catalog/runtime.plugins.diagnostic 保持既有可解析数据。Boot Config 与 Storage 登记发生于内置插件激活，Nitro error/Server-Timing hooks 随实例关闭注销。产品诊断出口与普通日志共享进程内唯一 writer，不引入产品位置授予、冲突降级或等待交接；“产品 AppFileLogger 仍不参与位置授予”的限制保持不变，foundation 独立出口的授予与降级合同未变。

## 4. 删除、改写测试与现在的行为承担者

| 删除或改写的测试 | 现在的合同证据 |
| --- | --- |
| migrate-application-state.test.ts：“非 Manager 启动门禁给出统一迁移命令”源码匹配删除 | product-startup.test.ts：“启动失败先同步写原因与迁移提示，再关闭已取得资源并以 1 退出，不产生未捕获异常”；核对原失败对象、同步输出提示、资源关闭顺序、退出码；真实 L5 另证明未迁移产物行为 |
| app-logs.test.ts 旧 Nitro 接线测试删除 | product-plugin.test.ts 的生产单写入/恢复 reporters、console 与监听，开发实例重建只包装一次；返工后的 logger.test.ts 验证已有位置锁不影响普通/fatal/诊断写入、共享 writer 排空及关闭后不复活；product-startup.test.ts 的桥接/flush 顺序；生产日志探针。初次新增的产品目录互斥、open/close 授予竞态与失守用例撤销；位置冲突合同继续由 foundation jsonl-exporter.test.ts 承担 |
| error-logger.test.ts 旧 Nitro 接线测试删除 | http/plugin.test.ts：“请求失败只记录 pathname，摘要与错误栈清理 query；关闭后不再写请求错误”；实际 HTTP 400 日志探针 |
| server-timing.test.ts 的旧 Nitro beforeResponse 接线用例删除 | http/plugin.test.ts：“响应提交 Server-Timing 并合并现有值；关闭后 beforeResponse 已注销”；保留工具层 marks/flush/开发晚写 header 测试；实际 /api/projects 响应带 projects.total |
| workbench-migration-e2e.test.ts 的旧 storage-definitions Nitro 调用改写 | 同一组真实 HTTP 备份/导入/幂等/HMR 用例，经 Application 激活 nbook.storage；最后 4 条通过，未改变 Storage 的原子读写实现或断言 |
| development-plugin.test.ts 删除精确 `{mode:"development"}` 转发参数断言 | 保留单一 close hook、失败致命诊断及不抛合同；真实 L7/L8 证明开发初始化、HMR 与停止 |
| t35 删除的“正式 builders 同一 esbuild graph 链接与压缩”守卫 | 新 product-command-graph.test.ts 经正式 buildProductCommands 构建多命令入口，Bun 导入产物验证同一共享对象与 increments=[1,2,3]；既有 product-reproducible-bundle.test.ts 仍检查压缩产物可重复性。没有源码匹配；不声称证明内部链接/压缩遍历次数，也不声称覆盖所有正式 builder |

## 5. 改动文件

下列路径以 `packages/neuro-book/` 为前缀，除最后一组显式仓库根路径：

- smoke：修改 `scripts/smoke/product-lifecycle.ts`；新增 `scripts/smoke/product-lifecycle.test.ts`。
- wrappers：修改 `server/runtime/product-command.ts`、`server/runtime/product-start-command.mjs`；新增 `server/runtime/product-command.test.ts`。
- 产品装配：修改 `server/runtime/product-startup.ts`、`server/runtime/product-startup.test.ts`。
- 日志：修改 `server/app-logs/logger.ts`、`server/app-logs/logger.test.ts`；新增 `server/app-logs/diagnostic-format.ts`。初次抽出的 `server/app-logs/log-location.ts` 在返工 1 删除。
- 诊断插件：新增 `server/features/runtime-diagnostics/product-plugin.ts`、`product-plugin.test.ts`、`app-log-bridge.ts`；修改同目录 `jsonl-exporter.ts` 以复用诊断格式化。其授予代码和 `jsonl-exporter.test.ts` 的 import 已恢复 HEAD 写法；后者不再有本任务 diff。
- 其它内置插件：修改 `server/features/app-state/plugin.ts`、`plugin.test.ts`、`server/features/http/plugin.ts`、`server/features/storage/plugin.ts`；新增 `server/features/http/request-error.ts`、`plugin.test.ts`。
- 宿主：修改 `server/host/product-host-entry.ts`、`development-plugin.ts`、`development-plugin.test.ts`。
- 定义与工具：修改 `server/storage/product-definitions.ts`、`server/storage/workbench-migration-e2e.test.ts`、`server/utils/server-timing.ts`、`server/utils/server-timing.test.ts`、`scripts/db/migrate-application-state.test.ts`。
- 删除：`server/plugins/app-logs.ts`、`app-logs.test.ts`、`error-logger.ts`、`error-logger.test.ts`、`boot-config.ts`、`storage-definitions.ts`、`server-timing.ts`。
- 仓库根新增：`scripts/build/product-command-graph.test.ts`；本 `evidences/` 的报告、完整日志、JSON、JSONL、截图与清理记录。临时 run-validation.mjs、verify-product-logs.mjs 已删除。

审查意见 1 已接受 `server/storage/workbench-migration-e2e.test.ts` 与 `server/utils/server-timing.test.ts` 的改动：它们直接导入本任务要求删除的旧 Nitro 入口，分别改为 nbook.storage 激活与移除过时 Server-Timing 接线用例。没有扩展 Storage 产品算法、浏览器或内核，也未修改治理/Spec 正文。

## 6. 禁止清单逐项自查

| 禁止项 | 自查结果 |
| --- | --- |
| 不按错误文案分支、不静默吞掉新增错误 | wrapper spawn 失败写诊断；Nitro hooks 注销由 scope 持有；产品 logger 撤销授予相关失败分支。foundation 授予实现恢复 HEAD，包括原有保留主错误的释放 catch；AppFileLogger 既有 best-effort catch 与防 EPIPE 的 fatalSync 收口保留，未新增静默授予写入门禁 |
| 不掩盖失败、不放松断言、不加产品测试分支 | 指定集合 Storage 失败原样保留，未重写其断言、未加重试或跳过。新 POSIX 进程组测试在 Windows 不运行，原因是平台合同差异，Windows 未验证。测试/生产错误按实际原因记录；源码匹配与精确转发参数断言按任务要求删除，不重新固定实现细节 |
| 不改任务外已有代码、配置和注释 | 未改 runtime/**、app/**、docs/**、package.json、锁文件、tsconfig、Vitest/Nuxt 配置、看门狗、Work/Task README；开发者 research README 两行新增保留。两个直接受旧入口删除影响的测试文件已在审查意见 1 获接受；注释只修正旧 Nitro owner 与已撤销的产品授予含义 |
| 保留清理收口、删除第二路径与死代码 | 两 wrapper exit/error 都移除监听；bridge close 幂等并恢复身份；HTTP hooks 登记注销；writer close 排空队列，incomplete recover 保留最终收口；删除产品 open/degraded/授予门禁及 log-location.ts；五个旧 Nitro 路径无 live 引用 |
| 不跨包深导入 | 生产与持久测试跨包经 @notnotype 包名公开入口；产品内引用使用 nbook/*，构建引用 #scripts/*。旧 wrapper RED fixture 的两个源码字节由 git show 读到 Temp，不形成持久跨包深导入 |
| 先找自然行为/产物检查 | 使用真实 Bun 退出码、真实 wrapper/TCP 握手、正式命令产物共享身份、真实 HTTP/日志；明确不具备内部遍历次数的产物证据，不恢复源码字符串守卫 |
| 不用 rm -rf 清理仓库目录、命令根相对 | 未用 rm -rf。系统 Temp 经 fs.rm 清理且核对不存在；临时取证文件先 git ls-files 确认为未跟踪，再逐文件删除。验证从 worktree 根执行，证据参数根相对 |

## 7. 遗留问题（5 项）

1. **已知基线，不阻塞本任务**：指定集合 `storage-service.test.ts` 的“并发写入期间读取只会看到完整旧记录或完整新记录”报 `打开的记录与声明路径身份不一致`；实现与测试均未改。审查意见 1 明确说明该用例在 t34–t39 每次全量测试中均失败，属于分支基线；本 Task 不处理，不重跑以寻求偶发通过，也不再标为验收阻塞。
2. **范围审查已接受**：上述 Storage 与 Server-Timing 两个旧调用方测试的迁移原因和 diff 已在审查意见 1 接受；无待确认范围事项。
3. **产物证据边界**：共享模块身份测试证明多个正式命令入口没有复制共享状态；可重复压缩测试证明其自身输入的产物一致性。不能单独证明全部正式 builder 的链接与压缩在同一次内部遍历；没有增加 metafile/单入口源码守卫。
4. **保留限制与未验证边界**：产品 AppFileLogger 仍直接写目录、不参与位置授予；跨进程或开发 worker 同目录轮转互斥、冲突输出与交接机制不在本 Task 承诺，单一 writer 仅保证本产品进程内诊断出口不另开写入器。close 以后 writer 不接受新记录；既有 best-effort/fatalSync 的文件不可用收口仍不能保证日志落盘。强制信号 128+signal、Windows 包装链和全部未知 HTTP event/error 形状未单独实测；L1–L10 与全量测试本轮交主 Agent 运行。
5. **工具/取证失败，已记录**：Bun 1.4.2 在使用 tsconfig-override 的探针中提示 `Internal error: directory mismatch ... fd 3`，最终探针退出 0且所有断言通过，提示已报给工具 QA。第一轮应用 typecheck 因工具中断没有成功结算；未知 API 路径返回 200 的探针假设也曾失败。失败日志保留；后续成功结果各有独立完整输出，不以先前失败冒充通过。

### 回写建议（未修改规范，交主 Agent 汇总）

| 编号 | 类别 | 依据 | 建议修改 | 目标位置 |
| --- | --- | --- | --- | --- |
| 1 | 踩坑 | Node Vitest 直接导入 smoke 时，其 Manager 依赖图包含 bun:sqlite 而加载失败；改为真实 Bun 子进程后通过 | 新增：“测试含宿主专有模块的入口时，在对应宿主的真实子进程中验证行为；不要直接导入另一宿主的测试运行器，以免模块加载失败替代业务回归。” | docs/testing/README.md 的测试文件组织 |

## 返工 1

### 处理结果

审查意见 1 的必改项已完成，所要求验证除已明确接受的 Storage 基线外全部通过；本轮没有范围内未解决失败。产品日志的单一写入者指进程内 exporter 与 appLogger 共用 writer，不扩大为跨进程位置互斥。

- `server/app-logs/logger.ts` 删除 open、degraded、managed/grantLost、grant 释放与 canWrite 门禁；info/error、fatalSync 恢复 HEAD 的既有写入路径。仅保留新增 writeDiagnostic 与 close，close 使用既有 JsonlLogWriter 排空并关闭。
- `server/features/runtime-diagnostics/product-plugin.ts` 的 exporter 不再调用 open 或接收授予降级 promise，直接借用 appLogger.writeDiagnostic；exporter close 仍只关闭借用出口，最终 writer 关闭仍由产品宿主持有。
- `server/features/runtime-diagnostics/jsonl-exporter.ts` 的授予常量、类型、proper-lockfile adapter、锁身份检查与释放恢复 HEAD；诊断格式化继续复用 diagnostic-format.ts。删除 log-location.ts，jsonl-exporter.test.ts 的 import 恢复 HEAD，没有该测试文件的剩余 diff。
- logger.test.ts 删除产品互斥、open/close 授予竞态、失守通知测试，替换为“已有日志位置锁时普通与诊断日志仍共用 writer，关闭排空且不触碰授予”与“关闭等待在途记录落盘，之后诊断写入失败且重复关闭不复活 writer”。真实普通、fatal 和诊断记录落盘，已有锁 owner 文件保持不变；关闭等待写入后拒绝诊断迟到写入。
- product-plugin.test.ts 删除产品授予冲突用例与 open mock；保留生产桥接恢复及开发实例重建只包装一次。product-startup.test.ts 删除 openLogs mock，保留关闭/恢复顺序；product-startup.ts 修正已过时的“日志位置授予”注释，没有改变停止流程。
- 第 2、3 节及第 7 节第 1、4 条已更新；同时修正测试映射、改动列表和自查中的过时授予描述。Storage 失败按主 Agent 给出的 t34–t39 基线记录，不阻塞本任务；两处旧入口调用方测试修改已获接受。

### 验证结果与完整输出

重任务均串行运行，构建期间未修改工作区；命令从 worktree 根执行。指定集合的失败没有被跳过、忽略退出码或改成绿色。

| 验证 | 实测结果 | 完整证据 |
| --- | --- | --- |
| 指定测试集合 | 53 files / 452 tests；52 files / 451 tests 通过，唯一失败是已接受的 storage-service.test.ts 并发读取基线；真实退出 1，符合本轮“除基线外全部通过”的判据 | [rework-1-specified-tests.log](rework-1-specified-tests.log) |
| typecheck:runtime-foundation | 0 错误，退出 0 | [rework-1-typecheck-runtime-foundation.log](rework-1-typecheck-runtime-foundation.log) |
| scripts:typecheck | 0 错误，退出 0 | [rework-1-scripts-typecheck.log](rework-1-scripts-typecheck.log) |
| typecheck | 0 错误，退出 0 | [rework-1-typecheck-application.log](rework-1-typecheck-application.log) |
| runtime-foundation --services | failures=0，退出 0；并发实例 location-conflict 降级、未写占用位置、自身缓冲/紧急输出与重新打开均通过 | [rework-1-smoke-runtime-foundation-services.log](rework-1-smoke-runtime-foundation-services.log) |
| 生产重建（日志探针前置） | 正式 nuxt:build 成功发布当前 .output，退出 0；未跑 L1–L10 | [rework-1-production-build.log](rework-1-production-build.log) |
| 生产日志探针 | app.logs.ready 可读；一次 console.error 恰好 1 条 JSONL、stdout/stderr 无同一标记；productLogLocationGrantAbsent=true；服务 `{code:0,signal:null}`、临时根已删除 | [rework-1-production-logs.log](rework-1-production-logs.log)、[rework-1-production-logs.json](rework-1-production-logs.json)、[rework-1-production-logs.jsonl](rework-1-production-logs.jsonl) |

```sh
bun run --cwd packages/neuro-book test -- server/plugins server/features server/runtime server/host server/middleware server/routes server/app-logs server/storage server/config scripts/db scripts/smoke
bun run --cwd packages/neuro-book typecheck:runtime-foundation
bun run --cwd packages/neuro-book scripts:typecheck
bun run --cwd packages/neuro-book typecheck
bun run --cwd packages/neuro-book smoke:runtime-foundation -- --services
bun run --cwd packages/neuro-book nuxt:build
```

日志探针用受控 Temp 内的 config.yaml、正式 database/application-state migrations、产品种子及 Runtime Contract 的 prepare-system-assets 入口准备空白 State Root；启动正式 index.mjs，用 Temp TCP preload 的 connected/logged 握手触发唯一 console.error，随后等待实际停止。没有新产品路由、固定 sleep、重试授予或扩大停止超时。该脚本使用 Bun tsconfig-override；完整参数在日志首行，脚本完成后删除。Bun 1.4.2 仍输出此前已报告的 directory mismatch 提示，未影响断言与退出 0；不掩盖此提示。

本轮生产 imageId 为 `sha256:424d27918ec65d6c25ca478380b7cb921db1483b161c670b4e8d53f6d5c585e4`，sourceDigest 为 `sha256:f428781751a0147144226f32e9a806c64e0769455ea93795889fcb49f4947216`，createdAt `2026-10-02T13:35:54.862Z`。revision 为 `fddef68b15131268fba4e7d3c47f8529ce03e3c1`、dirty=true；运行版本与初次交付相同。构建日志与探针 JSON 的 imageId 一致；构建后仅更新恢复路径的注释与报告，不再改运行行为，sourceDigest 只表示构建时快照。

[rework-1-cleanup-results.json](rework-1-cleanup-results.json) 核实 `/tmp/neuro-book/agent/t40-rework-1-product-logs-Iwc38E` 与 `/tmp/neuro-book/w00017-runtime-foundation-smoke/services-4033096` 已不存在，探针进程已正常退出。临时 rework-1-run-validation.mjs、rework-1-verify-product-logs.mjs 已删除，完整输出保留。

本轮没有运行生产 L1–L10 或全量测试，按审查意见 1 由主 Agent 执行；前文 L1–L10 明确保留为返工前证据。未提交、push、stash 或切分支。返工范围核对为 0 staged、28 tracked unstaged、10 untracked 顶层条目，tracked diff `+335 -518`，包含开发者 research README 的原有两行修改，未触碰该文件。

### 逐项自查

| 禁止项 | 返工 1 结果 |
| --- | --- |
| 不按错误文案分支、不新增静默 catch | 产品授予错误分支全部删除；foundation 仅恢复 HEAD 原有错误码与释放处理，没有新错误文案分支；普通日志 best-effort 与 fatalSync 防 EPIPE 语义按要求保持 HEAD |
| 不为检查通过掩盖问题 | Storage 基线真实失败保留、命令真实退出 1；未跳过该测试、放松断言、改变错误分类或添加产品测试专用分支；删除的是已撤销的产品授予合同测试 |
| 不改任务外代码、配置与注释 | 修改仅限审查指定日志授予返工、其调用方测试与证据；核对中保留所有其它原改动和 developer research README；不改 runtime/**、app/**、docs/**、README、package.json、锁文件、工具配置或 Spec |
| 保留资源清理、不留第二路径 | exporter 继续借用唯一 appLogger writer；桥接恢复、Nitro hook 注销、全部插件关闭后的 flush/close 与 incomplete recover 收口保留；删除 log-location.ts 和 open/degraded 门禁，无 live 引用 |
| 不跨包深导入 | 持久源码/测试和探针跨包通过包名公开入口，产品内使用 nbook/*；没有新增跨包源码路径依赖 |
| 先找自然验证方法 | 用实际日志文件验证已有位置锁不阻止产品写入、关闭排空与迟到写入；foundation 实际子进程验证冲突降级；生产产物实际启动并核对唯一 marker，不匹配源码文本 |
| 不用 rm -rf、证据从根执行 | 没有 rm -rf；系统 Temp 用 fs.rm 并核对不存在；临时取证脚本经 git ls-files 确认为未跟踪后逐文件删除；命令从 worktree 根执行、证据在 rework-1-* 文件中 |

### 审查纠正记录

本轮纠正的是把“产品 exporter 借用同一 writer”扩大为“产品日志目录跨进程授予”。已撤销额外机制并保留原位置授予限制；现有 Task 范围与通用编码规则已要求不扩展合同，因此不新增重复规范条目，不修改任何真相源正文。
