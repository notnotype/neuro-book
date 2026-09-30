# G2 主线程卡死兜底与 worker 池：一次性验证报告

> 由 G2 验证子代理撰写；子代理的写入工具不允许创建报告类 `.md` 文件，正文由主会话按其交回的内容原样保存。

- 日期：2026-09-30。
- 环境：Linux 7.2.7-arch1-1（Intel i5-1035G1，8 线程，实验目录在 tmpfs），Bun 1.4.2，Node v26.10.0（仅作对照），Google Chrome 151.0.7922.71 headless（由仓库 `node_modules` 中的 playwright-core 1.61.1 驱动）。
- 参考源码：w00017 worktree `refactor/w00017-runtime-foundation` @ `b6351c32`，只读导入，未修改。
- 证据等级：**实测**（本次在本机运行，原始输出在本目录）、**源码**（读仓库或上游源码）、**官方文档**、**推断**（由前三者推出，未直接观测）。
- 不重复的已有结论（t26 `worker-probe/`、`inproc-probe/`）：worker 终止 JS 死循环约 3 毫秒、每个 worker 约 1~4MB、Bun 不执行 `resourceLimits`、worker 内抛错或 `process.exit` 不影响主进程、看门狗以 `SIGKILL` 在约 1 秒后结束进程。

## 结论表

| # | 项 | 结论 | 证据等级 | 一句话依据 |
|---|---|---|---|---|
| 1 | 看门狗阈值与 Session Store 租约、卡死报告、开销与误报 | **部分成立** | 实测、源码 | 看门狗、报告与专用退出都能做到，开销约 0.13% 单核、+10MB，200~500 毫秒的同步任务在 1.2 秒阈值下也无误报；但设计写的“低于 30 秒过期，例如 20 秒”不成立：租约每 15 秒才刷新一次，主线程卡住约 15 秒后别的进程就能接管（实测 17.3 秒被接管），所以阈值必须小于 15 秒；另外被结束后锁仍新鲜，立即重启会拿不到租约（实测 9.6 秒后才能获取）。 |
| 2 | 服务端进程被结束后 Desktop 与 Manager 的行为 | **不成立**（现有代码不支持“自动重启并提示”） | 实测（Manager 侧进程链与退出判定）、源码（Electron、Tauri、容器） | 进入 ready 之后产品退出，Manager 只把退出写成错误；Electron 和 Tauri 记日志后收掉 Manager，不重启，窗口停在已断开的页面上；而且产品的两层启动包装会把 `SIGKILL` 压成退出码 1，Manager 无法区分“看门狗结束”和“启动失败”。 |
| 3 | Windows 上从 worker 结束整个进程 | **部分成立（未实测）** | 官方文档、源码、推断 | Node 与 Bun 1.4.2 的 `process.kill(process.pid, "SIGKILL")` 都走 libuv `uv_kill` → `TerminateProcess(h, 1)`，可以从 worker 调用并无条件结束进程，但退出码固定为 1、父进程看不到信号；要专用退出码只能用 FFI 调 `TerminateProcess(GetCurrentProcess(), code)`。`owned-process` 的 Job Object 收口在产品自行退出时照常工作，可复用；它的 `windows-adapter.ts` 只做父侧监督，不能直接用于自我结束，只有其 kernel32 FFI 写法可借鉴。 |
| 4 | worker 池 API 原型（服务端 Bun 与浏览器 Web Worker） | **部分成立** | 实测、源码 | 两端同一池核心、同一份预构建插件模块都跑通：按需创建、上限、复用、中止即以“已中断”结算（0.1 毫秒）、禁用插件时全部结算并终止。但“中止即终止 worker”在 Bun 中对 WebAssembly 长循环和原生阻塞调用不成立：`terminate()` 要等 wasm 返回 JS 才生效，wasm 死循环的 worker 永不退出；Chrome 中 `terminate()` 后脚本还会跑约 2 秒。 |

## 最重要的发现

1. **阈值必须小于租约心跳间隔 15 秒，而不是小于过期时间 30 秒。**（实测 + 源码）租约由主线程定时器每 15 秒刷新锁目录 mtime，别的进程看到 mtime 超过 30 秒即可删锁接管（`proper-lockfile` 4.1.2 `lockfile.js` 第 84~86、99~170 行）。卡死若恰好发生在一次刷新之前，锁在卡死约 15 秒后就过期。场景 A：卡死 22 秒，第 17.3 秒被第二个进程接管；原进程恢复后 1 毫秒内因 mtime 不再是自己的而判失效并以 75 退出，但在判失效之前已有一次排队中的写入执行，形成短暂双写。20 秒阈值挡不住这种情况。
2. **看门狗结束进程的方式要换成专用退出码，并在退出前释放租约锁。**（实测）
   - Manager 与产品之间有 `product-command.mjs` → `start.mjs` 两层包装。服务端被 `SIGKILL` 后，Manager 看到的是 `{exitCode: 1, signal: null}`，与启动失败相同；只有退出码（例如 76）能原样穿过（`chain/chain.out.txt`）。
   - worker 里的 `process.exit(76)`、`process.reallyExit(76)` 只结束 worker，`process.abort()` 在 worker 中不可用，有信号处理器时 `SIGTERM` 要等主线程空闲才处理；只有 FFI 调 libc `_exit(76)` 能在主线程死循环时带专用码结束整个进程（Bun 与 Node 结果一致，`watchdog/kill-method*.out.txt`）。
   - 作为 PID 命名空间 1 号进程时，自发 `SIGKILL` 被内核忽略，`_exit` 仍有效（`watchdog/pid1-kill.out.txt`）。现在容器里 1 号进程是 `product-command.mjs`，服务端不是 1 号，暂不受影响。
   - 看门狗不释放锁就结束进程时，立即重启的实例会得到 `ELOCKED`，9.6 秒后（锁 mtime + 30 秒）才能获取（场景 D）；产品启动时拿不到租约会以退出码 1 失败（`server/middleware/00-product-startup.ts`）。看门狗先删锁再结束时，重启实例 41 毫秒后首次尝试即获取（场景 E）。
3. **Desktop 与 Manager 目前在 ready 之后既不重启也不提示。**（源码 + 实测）Manager `desktop supervise` 把 ready 后的退出也报成 `failure/start-failed`；Electron 的 `waitForSupervisor` 在已结算后只调用 `onBackgroundFailure`：记日志、调用只作用于启动页的 `setStartupStage`、终止 Manager；Tauri 后台线程收到 `failure` 后 `shutdown_with_fallback` 并退出循环。窗口留在产品页面上，前端各功能各自显示“连接已中断，正在重试”。

其它发现：

4. **卡死报告能归属到插件，但只在宿主包装的调用里可靠。**（实测）宿主调用插件时把在途调用登记到共享内存（每次约 135 纳秒），看门狗据此写报告。卡在同步段时能直接定位（`direct`）；卡在 `await` 之后只能按“最近一次心跳之后开始的调用”推测（`candidate`）；卡在插件自建的定时器里时宿主没有记录，报告只能列出其它在途调用（`weak`，演示中列出的正是无辜插件）。Bun 1.4.2 不能从 worker 取主线程 JS 栈（`node:inspector` 报 `requires an active inspector`，`inspector.open()` 后仍不行），Node 可以（`watchdog/stack-probe.out.txt`）。
5. **整个进程被暂停后恢复会误报，需要单独识别。**（实测）`SIGSTOP` 6 秒、阈值 3 秒时，不识别暂停的看门狗 5 次中误结束 1 次（取决于恢复后哪个线程先跑）；加入“worker 自身节拍间隔大于 2 秒即视为整体暂停并重新计时”后 0/5。
6. **Bun 的 `worker.terminate()` 打断不了 WebAssembly 与原生阻塞。**（实测）JS 死循环 4 毫秒、`Atomics.wait` 4 毫秒、`sort` 28 毫秒、灾难性回溯正则 310 毫秒内退出；`Bun.sleepSync` 与 wasm 死循环 5 秒内都未退出。有限的 wasm 循环要等函数返回 JS（剩余 1002 毫秒）才终止，期间继续占满一个核；Node v26 同样场景 2 毫秒终止（`pool/wasm-terminate.out.txt`）。
7. **Chrome 的 `terminate()` 有约 2 秒宽限。**（实测 + 源码）终止后 JS 与 wasm 死循环都继续运行约 2 秒才停，与 Blink `worker_thread.cc` 中 `kForcibleTerminationDelay = base::Seconds(2)` 一致；调用方仍立即得到“已中断”，页面主线程不受影响（`browser/terminate-check.out.txt`）。

## 1. 看门狗阈值与租约

### 租约机制（源码）

- `agent-session-store-lease.ts`：`AGENT_SESSION_STORE_LEASE_STALE_MS = 30_000`、`AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS = 15_000`，经 `proper-lockfile` 的 `lock(path, {stale, update, onCompromised})` 取得，`retries` 为 0。
- 本仓库的 `proper-lockfile` 探测 mtime 精度时会把锁目录 mtime 设为最多 2 秒之后的整数时刻（`lib/mtime-precision.js`），所以第一次刷新前多出最多 2 秒余量；之后每次刷新都写当前时间。
- 刷新由主线程 `setTimeout(update)` 驱动：先 `stat`，若 mtime 不是自己上次写的，或锁目录已消失，则调用 `onCompromised`；否则 `utimes` 续期。**恢复后不按经过时间自判失效**：没人接管时，卡死多久都照常续期（场景 C）。
- 失效后：`compromised` 信号 → `product-startup.ts` 的 `requestLeaseCompromisedShutdown` → `productShutdownController.requestProcessExit(75)`：立即进入 draining、有序关闭（HTTP drain 上限 20 秒）后以 75 退出；Manager 用 `productExitErrorMessage` 给出专用提示（本次用真实函数验证，`chain/chain.out.txt`）。Session 写入面经 `requireReadyAgentSessionStore()` → `assertHealthy()` 在失效后拒绝写入，但失效判定之前的一小段时间不设防。
- 其它进程取得租约的条件：锁目录 mtime 早于“当前时间减 30 秒”，删除后重新 `mkdir`。

### 实测场景（`lease/lease-scenarios.out.txt`，真实租约模块、真实常量）

| 场景 | 设置 | 结果 |
|---|---|---|
| A 最坏相位 | 获取后第 14 秒开始卡死 22 秒（第一次刷新前）；第 14.5 秒起第二进程每 0.5 秒尝试 | 第二进程在第 31.4 秒（卡死第 17.3 秒）取得租约；原进程第 36.07 秒恢复，1 毫秒后判失效并以 75 退出；原进程在第 36.07 秒还写了一次（第二进程写入区间 31.9~38.9 秒） |
| B 最好相位 | 第 15.6 秒（刚刷新后）开始卡死 22 秒，同样竞争 | 卡死期间第二进程一直 `ELOCKED`；原进程恢复后照常续期，第 42 秒正常释放，第二进程随即取得 |
| C 长卡死无人竞争 | 卡死 45 秒 | 恢复后未判失效，锁 mtime 立即更新，之后的竞争者仍 `ELOCKED` |
| D 看门狗 20 秒 `SIGKILL`，立即重启 | 刚刷新后卡死，20 秒时结束进程 | 重启实例首次尝试 `ELOCKED`，9.6 秒后（锁 mtime + 30 秒）才取得 |
| E 同 D，但先删锁再结束 | 看门狗删除本进程的 `runtime.lease.lock` 后 `SIGKILL` | 重启实例 41 毫秒后首次尝试即取得 |

### 阈值取值的事实依据

- 设 `T` 为阈值、`c` 为看门狗检查间隔。卡死开始时，锁最后一次刷新最多在 15 秒前（再加一次文件系统往返），所以最早在卡死后约 15 秒可被接管（场景 A 实测 17.3 秒，多出的 2.3 秒来自探测时写入的未来 mtime 与卡死起点）。
- 本原型从“看到心跳最后一次变化”开始计时，看到变化最多晚 `c`，判定又最多晚 `c`，因此结束进程最迟在卡死后 `T + 2c`。要保证卡死期间没人能接管，需要 `T + 2c` 小于 15 秒，并给定时器抖动、系统负载和文件系统延迟留余量。
- **建议 `T = 10` 秒**（心跳 1 秒、检查 0.5 秒，最迟 11 秒结束，余量 4 秒）。硬上限 12 秒。
- 阈值不超过 15 秒时，结束进程那一刻锁仍属于本进程，看门狗先删锁是安全的：父进程只有在看到退出后才会重启，两者不会重叠。删锁失败或 FFI 不可用时退回 `SIGKILL`，重启方需要最多等待 `30 − T` 秒（`T = 10` 时最多 20 秒）。
- 如果以后需要更大的阈值，必须同时改租约：把刷新移到 worker（主线程卡死不再导致过期），或加大 `stale`。两者都改变 Session Store 租约合同，本次未验证。

### 卡死报告

原型 `watchdog/watchdog-host.mjs`（主线程侧）与 `watchdog/watchdog-worker.mjs`（worker 侧）。共享内存只放编号：心跳计数、最近心跳时刻、宿主阶段、“当前占用主线程的调用”槽位号，以及 64 个在途调用槽位（插件、调用种类、目标、序号、代次、开始时刻）。字符串在注册时经 `postMessage` 预先送到 worker，主线程卡死后 worker 仍能还原。报告以 `fsync` 加 `rename` 原子写入后再结束进程。样例：`watchdog/hang-report-sample.json`。

| 字段 | 含义 |
|---|---|
| `schema`、`reportId` | `nbook.main-thread-hang-report/v1`、唯一编号 |
| `pid`、`runtime`、`runtimeVersion`、`platform`、`arch`、`processStartedAt` | 进程身份 |
| `detectedAt`、`lastHeartbeatAt`、`stalledMs`、`thresholdMs` | 时间戳与停滞时长 |
| `hostPhase` | 宿主阶段（启动、可用、停止中），区分“启动时卡死”与运行期卡死 |
| `inflight[]` | 每个在途调用：`pluginId`、`pluginVersion`、`generation`、`kind`（activate、command、export、contribution、channel-call 等）、`target`、`callSeq`、`startedAt`、`elapsedMs`、`startedAfterLastHeartbeat`、`holdsMainThread` |
| `suspects` | `{confidence: direct / candidate / weak / unknown, pluginIds}`，见下文 |
| `inflightOverflow` | 槽位不够时丢失的登记数 |
| `rssBytes` | 进程 RSS |
| `action` | `exitMethod`、`exitCode`、`leaseLockReleased` |

三种卡死的实测归属（阈值缩短为 3 秒，`watchdog/hang-demo.out.txt`，三次都以 76 退出）：

| 卡死位置 | `suspects` |
|---|---|
| 宿主同步调用插件处理函数时（`command`） | `direct: [acme.wordcount]` |
| 插件异步处理函数 `await` 之后 | `candidate: [acme.wordcount]`（唯一在上次心跳后开始的调用） |
| 插件自建定时器（宿主无登记） | `weak: [acme.image-gen]`：这个插件是无辜的，只是恰好有一个等待 I/O 的在途调用 |

因此重启后的处理应区分可信度：`direct` 与 `candidate` 可以提示禁用并计入“反复卡死进入安全模式”的计数；`weak` 与 `unknown` 只列出在途插件供用户判断，不自动归责。

### 开销与误报（`watchdog/overhead.out.txt`，外部读 `/proc/<pid>/task/*/schedstat`）

| 配置 | 30 秒 CPU | RSS |
|---|---|---|
| 空闲，无看门狗 | 58.0ms | 36MB |
| 空闲，看门狗（心跳 1 秒、检查 0.5 秒） | 96.1ms（worker 线程 16.3ms） | 46MB |
| 空闲，看门狗（心跳 0.1 秒、检查 0.1 秒） | 136.8ms | 46MB |

- 标准配置增量约 38 毫秒 CPU / 30 秒（约 0.13% 单核），RSS +10MB（本次单进程测量，t26 测到多 worker 时每个约 1MB，首个 worker 更贵）。
- 主线程每 0~300 毫秒穿插一次 200~500 毫秒同步任务并大量分配内存，持续 60 秒（约 130 次）：阈值 12 秒、2 秒、1.2 秒（心跳 0.25 秒）都 0 次误报；看到的最大停滞分别约 1.0 秒、1.0 秒、0.6 秒；看门狗线程 60 秒内用 19~40 毫秒 CPU。
- 登记在途调用的开销：登记加同步段标记加清除每次约 135 纳秒；包装一次异步调用 342 纳秒，对照裸 `await` 97 纳秒（`watchdog/registry-cost.out.txt`）。
- 整体暂停：见“最重要的发现”第 5 条（`watchdog/pause-test.out.txt`）。
- 未测到的是产品真实主线程的停滞分布（同步 bun:sqlite 查询、启动时模块求值等），所以 10 秒阈值是否会误伤产品自身工作仍需校准。原型的 `exitMethod: "none"` 只统计不结束进程，可用于在开发和预发布中收集这组数据。

## 2. 进程被结束后 Desktop 与 Manager 的行为

### 进程链（源码）

`Electron/Tauri → Manager desktop supervise（bun）→ owned-process 监督进程 → product-command.mjs → start.mjs（product-start-command）→ .output/server/index.mjs`。容器中 `sh` 入口 `exec` 的是 `product-command.mjs`，它是 1 号进程。

### 现状

| 组件 | 产品在 ready 后异常退出时 | 证据 |
|---|---|---|
| `start.mjs` 包装 | 子进程被信号结束时，自己也用同一信号结束；非零码原样 `process.exit(code)` | 源码 `server/runtime/product-start-command.mjs` 第 84~94 行 |
| `product-command.mjs` 包装 | 子进程被信号结束时 reject，顶层 await 失败，以 **1** 退出；退出码原样转发 | 源码 `server/runtime/product-command.ts` 第 98~101 行；实测 `chain/chain.out.txt` |
| `owned-process`（POSIX） | 根进程退出后对进程组发 `SIGTERM`/`SIGKILL` 收口，报告 `{exitCode, signal}` | 源码；实测：直接启动时看到 `SIGKILL`，经两层包装时看到 `1` |
| `owned-process`（Windows） | 根进程退出后等 `graceMs`，关闭 Job（`KILL_ON_JOB_CLOSE`）收口后代，报告 `{exitCode, signal: null}` | 源码 `windows-supervisor-source.ts` 第 133~147 行；未实测 |
| Manager `start` / TUI | `assertProductExit` 抛出“NeuroBook 服务退出：1”（75 有专用文案），命令结束，不重启 | 源码 `migration-operation.ts` 第 357~380 行；判定函数实测 |
| Manager `desktop supervise` | 同一错误以 `{type: "failure", code: "start-failed", recoverable: true}` 发出；不区分 ready 前后，不重启 | 源码 `desktop-supervisor.ts` 第 146~172 行 |
| Electron | ready 后收到 `failure` 只调用 `onBackgroundFailure`：记 `electron-background-verification-failure`、`setStartupStage`（窗口已不在启动页，用户看不到）、`lease.terminate()`；`running` 不清空，不重启，窗口停在产品页面 | 源码 `desktop/electron/src/main.ts` 第 438~447、560~567 行 |
| Tauri | 后台线程收到 `failure`：打印到 stderr、`shutdown_with_fallback`、退出循环；窗口保持，不重启 | 源码 `desktop/tauri/src/main.rs` 第 1457~1485 行 |
| 前端页面 | 各功能自带 SSE 重连退避（300 毫秒到 5 秒），显示“连接已中断，正在等待重试”等；没有全局“服务已退出”呈现 | 源码 `app/utils/http/sse-reconnect-backoff.ts`、`zh-CN.ts` |
| 容器 | Compose `restart: "unless-stopped"`：1 号进程退出后由容器引擎重启；没有界面提示 | 源码 `docker.ts` 第 161、175 行；未实测 |
| ready 前失败 | Electron 进入启动页恢复循环（重试、修复、打开日志、退出）；Tauri 打印错误并以 1 退出 | 源码 |

另外两点影响重启设计：Installed Desktop 端口配置为 0（每次启动动态选端口，`main.ts` 第 171 行附近），重启若换端口，页面 origin 改变，`localStorage` 等按 origin 隔离的数据看不到，Desktop Bridge 的 origin 校验也要随之更新；产品启动拿不到租约时以 1 退出，与其它启动失败无法区分。

### 支持“看门狗结束进程后自动重启并提示禁用插件”需要改的地方

1. **产品（服务端宿主）**：启动看门狗 worker（启动完成后才布防，识别整体暂停）；宿主调用包装登记在途调用；卡死时写报告到 State Root（建议 `<State Root>/logs/hang-reports/`，原子写）、删除本进程的 `runtime.lease.lock`、以专用退出码结束（POSIX `_exit`，Windows `TerminateProcess`，FFI 不可用时退回 `process.kill(pid, "SIGKILL")`）。启动时读取未处理的报告，按可信度累计各插件次数，推送“是否禁用插件 X”的提示；同一插件达到阈值时下次启动进入安全模式（P8 已要求有安全模式参数与环境变量）。
2. **合同 `neuro-book-contracts/src/product-runtime/contract.ts`**：新增例如 `PRODUCT_RUNTIME_EXIT_CODE_MAIN_THREAD_HANG = 76`；`DesktopSupervisorEvent` 增加表示“产品已退出并正在重启”和“重启后再次 ready”的事件（或给 `failure` 增加 `phase: "after-ready"`、`exitCode`、`cause`、`restarting` 字段），并让 `desktop-contract.ts` 的解析器接受。
3. **Manager**：`app-commands.ts` 的 `productExitErrorMessage` 为 76 给出文案（附报告路径）；`startInstallationApplication` / `desktop-supervisor.ts` 在 ready 后遇到 76、75 或其它意外退出时，按重启策略（例如 5 分钟内最多 3 次、退避）用同一端口重新 `launchApplication`，不重跑迁移 Journal；超过次数则停止并提示以安全模式启动；重启时若遇到租约仍被占用，按锁 mtime 等待到过期再试。前台 `start` 命令是否自动重启需要产品决定。
4. **Electron `main.ts`**：`waitForSupervisor` 结算后仍要消费事件：收到“重启中”时切回本地启动页或覆盖层，收到新的 ready 后校验 nonce 与端口并重新加载产品页面；达到重启上限时进入现有恢复循环，并增加“以安全模式启动”动作。
5. **Tauri `main.rs`**：后台线程同样处理“重启中/再次 ready/放弃”三类事件，导航到启动页并重新加载，而不是 `shutdown_with_fallback` 后退出循环。
6. **容器**：沿用引擎重启；由产品启动时读报告完成提示。以后若让服务端直接成为 1 号进程，只能用 `_exit` 一类方式结束自己（`SIGKILL` 会被忽略，实测）。
7. **`owned-process`**：无需修改；POSIX 与 Windows 都已在根进程自行退出后收口整个进程树。

## 3. Windows 上从 worker 结束整个进程（未实测，本机无 Windows）

| 问题 | 结论 | 依据 |
|---|---|---|
| Node 的 `process.kill(process.pid, "SIGKILL")` | 可用，无条件结束进程；`SIGINT`、`SIGTERM`、`SIGKILL`、`SIGQUIT` 都一样 | 官方文档 Node `process`“Signal events”：Windows 上发送这几个信号会无条件结束目标进程；源码 libuv `src/win/process.c` `uv__kill`：这四个信号调用 `TerminateProcess(process_handle, 1)`，其它信号返回 `UV_ENOSYS` |
| Bun 1.4.2 的同一调用 | 同上：`process.kill` → `process._kill` → `Process_functionReallyKill`，Windows 分支调用 `uv_kill(pid, signal)` | 源码 bun-v1.4.2 `src/jsc/bindings/BunProcess.cpp` 第 4739~4778 行（摘录 `windows/bun-v1.4.2-process-kill-excerpt.txt`） |
| 能否从 worker 调用 | 能；`uv_kill` 对非 0 pid 用 `OpenProcess(PROCESS_TERMINATE…)` 取句柄，与调用线程无关。`TerminateProcess` 结束自身时不返回 | 源码 libuv；官方文档 Microsoft `TerminateProcess`：“When a process terminates itself, TerminateProcess stops execution of the calling thread and does not return.”“A process cannot prevent itself from being terminated.” |
| 父进程看到什么 | 退出码 1，信号为空：libuv 只在父进程自己调用 `uv_process_kill` 时设置 `exit_signal` | 源码 libuv `uv__process_proc_exit` 与 `uv_process_kill`；推断：经两层包装后 Manager 看到 1 |
| 专用退出码 | `process.exit`、`process.reallyExit` 在 worker 中只结束 worker（Linux 实测，Node 文档亦如此；Bun 源码注释“In a worker it returns”）；需 FFI 调 `kernel32!TerminateProcess(GetCurrentProcess(), 76)`。Bun 文档要求 HANDLE 用 `u64` 表示，并声明 `bun:ffi` 为实验性 | 实测（Linux）、官方文档 Node、Bun FFI 文档、源码 |
| 未决 I/O | 进程要等未决 I/O 完成或取消后才真正退出；主线程卡在网络盘等内核等待时可能延迟 | 官方文档 Microsoft `TerminateProcess` |
| `owned-process` 复用 | 父侧：Windows 监督进程在根进程退出后等 `graceMs` 再关闭 Job，清理后代，报告 `complete`，可直接复用；子侧自我结束：`windows-adapter.ts` 没有这项能力，但 `windows-supervisor-source.ts` 已在产品中用 Bun FFI 调 kernel32（`CreateJobObjectW`、`TerminateJobObject` 等，句柄声明为 `FFIType.pointer`），同一写法可用于 `TerminateProcess` | 源码 |

## 4. worker 池 API 原型

### 原型

- `pool/worker-pool-core.mjs`：不依赖平台的池核心（服务端与浏览器共用）；`pool/worker-pool.mjs`：注入 `node:worker_threads`；`pool/worker-host.mjs`：宿主拥有的 worker 引导脚本。
- `browser/browser-pool.mjs`：把 module Web Worker 适配成同一形状；`browser/worker-host.browser.mjs`：浏览器引导脚本。
- 插件模块：`pool/plugin-demo/src/*.ts` 用 `bun build --target=browser --format=esm` 预构建为单文件 `pool/plugin-demo/dist/worker.mjs`（1652 字节），**同一个文件**在 Bun worker 与 Chrome module worker 中都直接加载运行。
- 产品已有先例：Profile 编译 worker 在产品镜像中以预编译入口 `.output/authoring/profile-compile-worker.mjs` 提供（源码 `server/agent/profiles/profile-compile-worker.ts`），宿主引导脚本可以同样打包。

### 测量（服务端 `pool/bench-server.out.txt`，浏览器 `browser/browser.out.txt`、`browser/terminate-check.out.txt`）

| 指标 | Bun 1.4.2 服务端 | Chrome 151 浏览器 |
|---|---|---|
| 冷启动（建 worker + 加载引导与插件模块 + 一次调用） | 平均 15.0ms（14.0~19.0） | 平均 10.5ms（8.9~19.6） |
| 热调用往返 | 小输入 24µs，1KB 22µs，1MB 字符串 840µs | 小输入 34µs |
| 64MB `ArrayBuffer` 输入 | 结构化克隆 65ms，`transfer` 0.8ms | 未测 |
| 中止 → 调用方得到“已中断” | 0.10ms | 0.1~0.3ms |
| 中止 → 线程真正停止 | JS 死循环平均 17.5ms（最大 30ms，含池收尾）；直接 `terminate()` 4ms；wasm 与 `Bun.sleepSync` 不停止 | JS 与 wasm 死循环都在约 2 秒后停止 |
| 死循环期间宿主主线程 | 10ms 定时器 200ms 内触发 22 次 | 1.3 秒内触发 130 次 |
| 排队中被中止 | 0.06ms 结算，不创建 worker | 同一核心逻辑 |
| 上限 | `maxWorkers=3`、每插件 2：9 个 200ms 任务（3 个插件）618ms 完成，只建 3 个 worker、复用 6 次 | 同一核心逻辑 |
| 复用 | 同插件同模块 2104 次调用只建 1 个 worker | 1001 次调用建 1 个 |
| 禁用插件 | 2 个忙碌加 3 个排队：0.52ms 全部以 `interrupted/plugin-disabled` 结算，5.5ms 内 worker 全部退出；之后的调用直接得到同一结果；其它插件的调用正常完成 | 0.3ms 全部结算；其它插件正常 |
| 进度 | 1000 条进度加结果 2.7~3.7ms，顺序正确；中止后不再回调 | 1000 条 8.9ms，顺序正确 |

### 建议的 API 形状与语义

```ts
// SDK 注入：ctx.workers，pluginId 由宿主绑定
interface PluginWorkers {
    run<I, O>(module: URL | string, input: I, options?: {
        signal?: AbortSignal;
        transfer?: Transferable[];
        onProgress?: (value: unknown) => void;
    }): Promise<WorkerRunResult<O>>;
}

type WorkerRunResult<O> = {ok: true; value: O} | {ok: false; error: WorkerRunError};
type WorkerRunError =
    | {code: "interrupted"; reason: "aborted" | "plugin-disabled" | "host-stopping"; message: string}
    | {code: "task-error"; name: string; message: string; stack?: string}
    | {code: "input-not-cloneable" | "output-not-cloneable"; name: string; message: string}
    | {code: "load-failed"; name: string; message: string; stack?: string}
    | {code: "worker-crashed"; message: string};

// 插件预构建的单文件 ESM
export default async function (input: I, ctx: {progress(value: unknown): void}): Promise<O>;
```

| 语义 | 依据 |
|---|---|
| 返回结构化结果而不是抛异常；中止、禁用、宿主停止都以 `interrupted` 结算，调用方立即得到结果，迟到的结果与进度一律丢弃 | P4 第 4 条；实测两端结算 0.1~0.5ms |
| 输入输出必须可结构化克隆；不可克隆的输入在调用方 `postMessage` 时同步抛 `DataCloneError`（worker 可继续复用），不可克隆的输出在 worker 内捕获后回报 | 实测两端错误名均为 `DataCloneError`（Chrome 的消息更具体） |
| 大块二进制用 `transfer` 移交，不复制 | 实测 64MB：65ms 对 0.8ms |
| 支持单向进度 `onProgress`，按顺序到达；不另设流式结果（大结果用 `transfer`），不支持从宿主向 worker 追加输入 | 实测 1000 条进度 3~9ms；需要双向交互的工作不适合放进这个池 |
| worker 内只做纯计算，拿不到宿主 API；需要宿主服务的步骤留在主线程，拆成多次 `run` | 终止是强制的，worker 内无法做清理；P4“不跨插件传活对象” |
| 按（插件，模块）复用空闲 worker，同一 worker 一次只跑一个调用；全局上限默认 CPU 核数减 1，每插件上限（例如 2），空闲超时回收；满员时排队，排队中可被中止 | 实测复用与上限；每个 worker 1~4MB（t26） |
| 禁用插件：拒绝新调用，结算排队与在途调用，终止它的全部 worker，等线程退出后才报告禁用完成 | 实测 |
| 线程没有真正退出的 worker（wasm、原生阻塞，或浏览器 2 秒宽限内）仍计入名额，并在诊断中按插件显示；Bun 中这类 worker 只能随进程重启回收 | 实测：中止 wasm 死循环后 3 秒池中仍有 1 个存活 worker，其它插件仍可用剩余名额 |
| 内存上限不可强制：Bun 不执行 `resourceLimits`，worker 内内存失控仍会拖垮进程 | t26 实测 |

## 对设计 P4、P6、P11 的修改建议

1. **P6“主线程卡死看门狗”**：
   - 把“阈值低于 Session Store 租约的 30 秒过期时间，例如 20 秒”改为“阈值小于租约心跳间隔 15 秒并留检测余量，取 10 秒”。
   - 补充：结束进程前写好报告并删除本进程的租约锁；以专用退出码结束（POSIX `_exit`，Windows `TerminateProcess`），不用 `SIGKILL`；识别整个进程被暂停；启动完成后才开始计时；先用只统计模式校准产品自身的主线程停滞。
   - “本机实测……以 `SIGKILL` 结束”保留为 t26 的事实，但注明经产品包装链后 Manager 看到的是退出码 1。
2. **P6、P11 的职责分工**：写明 Manager 负责重启与重启上限，Desktop 负责重启期间与放弃时的呈现，内核在下次启动时读报告、提示禁用并按可信度计数；只有 `direct` 与 `candidate` 两级计入“反复卡死进入安全模式”。
3. **P4 worker 池**：把“中止时直接终止对应 worker”补充为“中止时调用方立即得到‘已中断’并终止 worker；Bun 中 WebAssembly 与原生阻塞调用要等返回 JS 才停止（死循环不会停止），浏览器 Chrome 最迟约 2 秒；未停止的 worker 继续占名额并出现在诊断中”。同时写入模块约定（单文件 ESM、default 导出、纯计算、输入输出可结构化克隆）、结果联合类型与进度回调。
4. **P11 表格“CPU 工作在 worker 池中 → worker 被终止（本机实测 3 至 14 毫秒）”**：改为“JS 计算 4~30 毫秒内终止；WebAssembly 与原生阻塞在 Bun 中要等其返回，死循环只能靠重启回收”。
5. **P11“在途工作”一节**：插件用 WebAssembly 做 CPU 工作时，放进 worker 池也不能保证禁用后立即停止 CPU 占用；是否需要要求插件把 wasm 计算切成可返回 JS 的小段，由开发者决定。

## 未验证边界

- **Windows 全部未实测**：`process.kill` 与 FFI `TerminateProcess` 的实际行为、`u64` 与 `pointer` 两种 HANDLE 声明哪种在 Bun 1.4.2 上可用、Windows 上删除锁目录、Job Object 在产品自行退出时的收口，均只依据文档与源码。
- **macOS 未测**：原型中 `libSystem.B.dylib` 的 `_exit` 路径没有运行过。
- **真实产品未运行**：没有启动 Nuxt 产品、Electron 或 Tauri；Desktop 与前端行为来自源码。产品主线程的真实停滞分布、启动期的同步阻塞时长未测，10 秒阈值对产品自身工作的误报风险未知。
- **重启后的会话与页面**：同端口重启后 Cookie 会话是否仍有效、前端各重连路径能否恢复，未验证。
- **WebKit（Tauri WebKitGTK）未测**：本机没有 WebKit 浏览器。WebKit 与 Bun 同为 JSC，推断 wasm 长循环同样难以被 `terminate()` 打断，需在 G1 的 WebKit 环境或 Tauri 中补测。
- **系统睡眠**：只用 `SIGSTOP` 模拟整体暂停；各平台睡眠期间 `performance.now()` 是否前进未验证，原型对两种情况都按“worker 节拍间隔过大即重新计时”处理。
- **场景 A 的双写窗口**只在测试进程中观察到 1 次写入；产品中失效判定前能执行多少排队工作取决于当时负载，未测。
- **租约实验**在 tmpfs（毫秒 mtime 精度）上运行；NTFS、FAT 或网络盘上的 mtime 精度与延迟未测。
- **长时间浸泡测试**（数小时的看门狗与池运行）未做。

## 复现

实验在仓库外的临时目录完成；本目录保留脚本与原始输出，目录结构与实验时一致。租约与进程链脚本以绝对路径只读导入 w00017 worktree 中的 `agent-session-store-lease.ts`、`owned-process`、Manager `app-commands.ts`。

| 目录 | 命令（在该目录的父目录 `g2/` 下执行） | 输出 |
|---|---|---|
| `lease/` | `G2_TMP=<临时目录> bun lease/run-lease.ts`（约 90 秒） | `lease-scenarios.out.txt` |
| `watchdog/` | `bun kill-method.mjs <sigkill\|sigterm\|exit\|abort\|reallyExit\|ffi-exit>`；`OUT_DIR=out bun hang-demo.mjs <sync\|async\|unowned> 3000 ffi-exit`；`bun overhead.mjs`；`bun pause-test.mjs`；`unshare --user --map-root-user --pid --fork bun pid1-kill.mjs <sigkill\|ffi-exit>`；`bun stack-probe.mjs`；`bun registry-cost.mjs` | 同名 `.out.txt`、`hang-report-sample.json` |
| `chain/` | `bun chain/run-chain.ts` | `chain.out.txt` |
| `pool/` | `bun pool/bench-server.mjs`；`bun pool/wasm-terminate.mjs`、`node pool/wasm-terminate.mjs` | `bench-server.out.txt`、`wasm-terminate.out.txt` |
| `browser/` | `node browser/run-browser.mjs`；`node browser/terminate-check.mjs`（随机端口，只绑定 127.0.0.1） | `browser.out.txt`、`terminate-check.out.txt` |
| `windows/` | 上游源码摘录 | `bun-v1.4.2-process-kill-excerpt.txt` |

外部来源：Node.js `process` 文档（https://nodejs.org/api/process.html）；libuv `src/win/process.c`（v1.x 分支）；Bun `src/jsc/bindings/BunProcess.cpp`（tag `bun-v1.4.2`，commit `744846f8`）；Bun FFI 文档（https://bun.com/docs/runtime/ffi）；Microsoft `TerminateProcess` 文档；Chromium `third_party/blink/renderer/core/workers/worker_thread.cc`（main 分支）；Linux `pid_namespaces(7)`。
