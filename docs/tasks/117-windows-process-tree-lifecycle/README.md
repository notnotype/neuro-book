# 117 - Windows 进程树所有权与 Bash 超时

> 当前状态：本地实现与聚焦验证完成；候选 Windows Release workflow 验证待执行。

## Relative documents refs

- `PROJECT-STATUS.md`
- `CONTEXT.md`
- `docs/tasks/105-unified-installation-manager/README.md`
- `docs/tasks/116-agent-workflow-reliability/README.md`
- `server/agent/tools/file-tools.ts`
- `server/agent/tools/file-tools.test.ts`
- `packages/neuro-book-manager/src/app-commands.ts`
- `packages/neuro-book-manager/src/portable-launchers.ts`
- `scripts/deploy/product-start.mjs`
- `scripts/deploy/product-start.test.ts`
- `workspace/.nbook/agent/sessions/755.jsonl`

## User Request / Topic

- Agent 的 `bash` 工具明明传入了 30 秒 timeout，命令运行 5 分钟仍不结束。
- Windows Portable 中，Subagent 执行仓库级 `find` 卡住后，用户关闭 CMD 窗口，会出现端口仍被占用、监听 PID 已不存在或显示为 `[System]` 的现象。
- 如果 Subagent 没有卡住，直接打开并关闭 Windows Portable CMD，不会留下端口。
- 新建重大 Task，深入分析完整因果链并制定系统性实施计划。
- 方案不能靠扫描进程、全局杀 Bash、文本 Promise timeout 或其他 hack；不能留下进程泄漏、端口残留或测试空洞。
- 本轮只做诊断、可行性探针和计划，不修改业务代码；重要实现取舍交给用户决定。

## Goal

建立 NeuroBook 自有外部进程的明确生命周期合同，使 Bash timeout、Agent abort、后台 Job cancel、Harness shutdown 和 Windows Portable 窗口关闭都能在有界时间内终止 NeuroBook 拥有的完整进程树，并确认相关 stdio、监听 socket 和其他继承句柄已经释放：

- timeout 不是“开始尝试 kill”的时间，而是进入有界终止流程的时间；终止流程本身也有明确上限。
- Windows 上不依赖父 PID 扫描或 MSYS 进程树形状，而是在后代创建前建立内核级所有权。
- POSIX 上继续使用原生 process group，不把 Windows 特例泄漏给 Bash 和 Product 调用方。
- 调用方只声明启动参数、输出消费和终止策略，不分别实现 `spawn → signal → force kill → stdio close`。
- 正常退出、timeout、abort、取消、宿主关闭和启动失败都只有一个终态，迟到事件不能改写结果。
- Windows Release 的真实 Portable Bun、PortableGit、CMD 关闭和端口复用是发布门禁，不用 mock 结果代替。
- 与 Task 105、Task 116 复用既有生命周期状态，不重新发明 Manager 状态机或 Agent Job 状态机。

成功必须由以下证据共同证明：

1. Windows Bash timeout/abort/cancel 后，Git Bash、MSYS `find`/`sleep` 后代全部消失，调用在规定窗口内返回。
2. 结束进程树后测试端口可立即重新 bind，不要求重启 Windows。
3. Windows Portable 在卡住 Bash 的情况下关闭 CMD，Product、Bun、Bash 和命令后代全部退出，端口释放。
4. 正常 CMD 关闭和正常 Bash 完成不回归。
5. Linux/macOS Bash process group 与 Product SIGTERM 行为不回归。

如果 Bun FFI 无法在 Windows Release runner、真实 Portable Runtime 或受限宿主 Job 环境中稳定满足合同，应停止 FFI 实施，报告失败的 Win32 API、错误码和环境，再由用户在受校验 native helper 与缩小平台声明之间决定；不得回退到按名称或命令行扫描进程。

## Current State

### 1. Bash timeout 单位正确，但只有“杀直接子进程”

`BashSchema.timeout` 明确是秒。前台和后台 Bash 都把同一个值传给 `runBash()`：

```text
input.timeout
→ setTimeout(..., input.timeout * 1000)
→ child.kill("SIGTERM")
→ 等待 child 的 close 事件
```

因此 30 秒不是被误当作 30 分钟或 30 毫秒；真正缺陷在终止语义：

- timeout 只对 `spawn(bash, ...)` 返回的直接 ChildProcess 调用一次 `SIGTERM`。
- AbortSignal 走完全相同的单进程 kill。
- 没有 TERM grace、强制终止阶段或终止阶段上限。
- Promise 只在 `close` 事件触发后才 reject timeout/abort。
- `close` 会等待该 ChildProcess 关联的 stdio 关闭；被 MSYS 后代继承的 stdout/stderr 仍打开时，直接父进程退出也不能保证 `close` 到达。

这解释了“30 秒已到，但 5 分钟仍没有 tool result”：timer 可能已经触发，Promise 仍在无限等待 `close`。

### 2. Windows Git Bash 不是单进程

Windows Portable 使用 PortableGit 的 Bash。真实链路至少包含：

```text
NeuroBook/Bun
└─ Git Bash Windows wrapper
   └─ MSYS Bash
      └─ find / xargs / grep / sleep / 用户命令
```

MSYS 可以 fork、exec、reparent。Windows `ChildProcess.kill()` 只掌握最外层 PID，不拥有整棵树；外层 wrapper 退出不代表内部 Bash 和命令退出。

### 3. 真实 Session 证据与边界

`workspace/.nbook/agent/sessions/755.jsonl` 记录了一次针对整个仓库的查找：

```bash
find <repo> ...
```

该调用最终返回 `Command aborted`。它证明：

- 用户报告的仓库级 `find` 确实进入了 Bash 工具。
- abort 触发后，工具层认为命令已经被中断。
- 这次具体调用没有传 `timeout` 字段，不能把它伪装成“30 秒 timeout”的现场日志。

显式 timeout 与这次 abort 共用同一条 `child.kill("SIGTERM") → 等 close` 实现，所以二者是同一个 OS 生命周期缺陷的两个入口，但证据必须分开表述。

### 4. Windows Portable 关闭链

当前入口为：

```text
Start Neuro Book.cmd
→ neuro-book manager start
→ runPortableForeground()
→ product-start.mjs
→ Nitro/Bun server
→ Agent Bash
→ MSYS command descendants
```

`runPortableForeground()` 只拥有直接 Product ChildProcess。启动健康检查失败时也只调用一次 `child.kill()`。`product-start.mjs` 已为容器 POSIX SIGTERM 转发到 Nitro，但 Windows 生命周期测试被明确跳过。

当没有卡住的 Agent Bash 时，关闭 CMD 能正常结束这条链；当 Bash 后代已经泄漏时，关闭 CMD 只结束可见 wrapper/Manager/Product，并不能证明 MSYS 后代退出。

### 5. 端口截图结论需要纠正

用户截图中的旧判断把以下现象称为“残留在 Windows TCP 内核中的幽灵监听端口”，并认为只能重启：

- 原 Owner PID 已不存在。
- 监听程序显示 `[System]`。
- 同时存在 `CLOSE_WAIT`。

该判断不是可靠根因：

- `CLOSE_WAIT` 是连接状态，不等于 LISTEN socket 的所有者，也不能证明内核状态永久损坏。
- Windows TCP 表在原创建 PID 退出、相关内核句柄仍被其他进程持有时，可能无法展示当前有效用户态 Owner。
- `taskkill` 找不到旧 PID，只能证明旧 PID 消失，不能证明其后代和继承句柄消失。

最小复现中，监听 Bun PID 已不存在且 TCP 表仍显示该 PID，但 Git Bash/`sleep` 后代仍存活；让这些后代全部退出后，端口立即释放，不需要重启 Windows。因此截图是进程树/句柄泄漏的表现，不是不可恢复的内核幽灵端口。

### 6. 当前测试缺口

- `file-tools.test.ts` 覆盖 Bash 正常输出、PATH、Workspace CLI 和路径解析，没有 timeout/abort 后代泄漏测试。
- `product-start.test.ts` 只验证非 Windows 的 SIGTERM 转发；Windows 被 `skipIf(process.platform === "win32")` 跳过。
- 没有 MSYS fork/reparent fixture。
- 没有“进程退出后端口立即可重绑定”断言。
- 没有“关闭 Portable CMD 后所有后代归零”的 Release gate。
- 现有测试会把“直接 ChildProcess 已退出”误当作“完整进程树已释放”。

## Diagnosis

### 排名假设与结果

| Rank | 假设 | 可证伪预测 | 结果 |
| --- | --- | --- | --- |
| 1 | timeout/abort 只杀 Git Bash wrapper，MSYS 后代继续持有 stdio/相关句柄 | wrapper PID 消失后 Bash/命令后代仍存活；后代退出时 `close`/端口随即收口 | 已确认 |
| 2 | timeout 单位或 schema 传递错误 | 30 秒不会换算成 30,000ms，或前后台丢失字段 | 已否定；单位和传递正确 |
| 3 | Windows TCP 内核产生只能重启清除的幽灵端口 | 所有相关用户态后代退出后端口仍不能 bind | 已否定；后代退出后端口立即释放 |
| 4 | `taskkill /T` 足以覆盖 PortableGit | 从 wrapper PID 执行 `/T` 后所有 MSYS 后代归零 | 已否定；MSYS fork/reparent 可逃出父 PID 树 |
| 5 | 关闭 Portable CMD 本身必然泄漏 | 无 Agent 卡住时关闭 CMD 也会稳定复现 | 已否定；用户与本机对照均只在卡住后出现 |

### 根因

NeuroBook 当前只有“直接 ChildProcess 引用”，没有“自有进程树所有权”。在 Windows PortableGit 下，直接 PID、OS 后代和持有 stdio/socket 引用的进程不是同一集合。timeout 和 abort 只改变 `timedOut`/signal 状态并 kill wrapper，随后把真正的完成条件交给可能永远不来的 `close` 事件。

完整因果链：

```text
仓库级 find 卡住
→ timeout/abort 只向 Git Bash wrapper 发 SIGTERM
→ MSYS Bash/find 后代存活并保持继承的 stdio/句柄
→ runBash 等待 close，timeout 本身没有完成上限
→ 用户关闭 Portable CMD
→ Manager/Product 原 PID 退出
→ 泄漏后代仍持有与监听 endpoint 相关的句柄引用
→ TCP 表显示旧 PID或 [System]，端口无法复用
→ 泄漏后代退出后，端口立即释放
```

### 影响范围

- Agent Bash 前台 timeout 与 abort。
- Agent Bash 后台 Job cancel 与 Harness shutdown。
- 任何 Bash 命令，不只 `find`；pipeline、watcher、测试 runner 和启动子服务风险更高。
- Windows Portable CMD 关闭、启动超时和未来 Manager stop/restart。
- Product 端口以及子进程继承的文件、pipe、socket 等句柄。

不受本 Task 直接影响：

- Provider HTTP timeout。
- Workflow 自身状态持久化和 invocation fencing。
- 不派生后代、且调用方已完整等待的普通一次性 `spawn`。

## Feasibility Probes

探针仅位于 `.agent/workspace/diagnose-portable-close/`，不属于生产实现。

### Portable Runtime

- Bun：Windows Portable 自带 Bun `1.3.14`。
- Bash：Windows Portable 自带 PortableGit `2.55.0.windows.3`。
- `bun:ffi` 可成功加载 `kernel32.dll` 并调用 Win32 API。

### Job Object 终止

监督进程执行以下顺序：

1. `CreateJobObjectW`。
2. `AssignProcessToJobObject(job, GetCurrentProcess())`，先把自己放进 Job。
3. 设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。
4. 再启动 PortableGit Bash 与 `sleep 600` 孙进程。
5. 关闭监督进程持有的唯一 Job handle 并退出。

结果：监督进程 exit 0，匹配的 `sleep` 后代数量为 0。另一个显式 `TerminateJobObject` 探针同样没有后代残留。

这个顺序是关键：Job 在任何用户命令创建前成立，后代通过 Job 继承自然进入所有权集合，避免“spawn 后再 Assign、子进程已经 fork”的竞态。

### 嵌套 Job

外层监督进程先加入 Job，再派生内层监督进程；内层为命令建立自己的 Job。

当前 Windows 环境结果：

```json
{"innerExit":0,"inner":{"assigned":true,"lastError":0}}
```

说明当前支持 Portable Product Job 内的命令级嵌套 Job。实现仍需在 Release runner 和真实 Windows Portable 中保留显式错误诊断，不能把本机成功当作所有受限 Windows 环境的保证。

## Decisions / Discussion

### D1：建立窄的 Owned Process Lifecycle Module

推荐建立一个暂名 **Owned Process Lifecycle Module** 的深 Module。名称尚未固化到 `CONTEXT.md`，待用户确认后再登记稳定术语。

它只服务 NeuroBook 明确拥有且可能派生后代的两类长生命周期：

1. Agent Bash 命令。
2. Windows Portable Product 前台生命周期。

暂不接管版本检查、迁移、Release 打包、Git 查询等所有一次性 `spawn`。只有在后续调用方真实暴露相同所有权需求时才迁入，避免为了“统一”制造大而空的进程框架。

Deletion test：如果删除该 Module，Windows Job、POSIX process group、TERM→强杀、stdio 收尾、宿主断连和迟到事件规则会重新散回 Bash 与 Portable 两个调用方；复杂度不会消失。因此该 Module 能提供真实 locality 和 leverage。

### D2：Module Interface

调用方只应知道：

- executable、args、cwd、env 和 stdio 模式。
- 是否消费 stdout/stderr 数据。
- graceful termination window 与 hard termination window。
- 终止原因：timeout、abort、cancel、shutdown、startup failure 或 host disconnect。

调用方不应知道：

- Windows Job handle、FFI 结构体或监督进程协议。
- POSIX negative PID/process group kill。
- MSYS wrapper/inner Bash PID。
- `close`、`exit`、pipe EOF 和 IPC disconnect 的组合顺序。

概念 Interface：

```text
spawnOwnedProcess(spec) → lease

lease.completion
lease.terminate(reason)
lease.stdout / lease.stderr 或 onData
```

`terminate()` 必须幂等，并只在以下条件之一成立时完成：

- Module 已确认自有进程树退出且 stdio 收口。
- Module 返回明确的 ownership failure，包含平台、阶段与 OS error；调用方不得把它伪装成普通 timeout 已成功处理。

不把 Bash 的 `Command timed out` 文案、Agent Job status 或 Manager doctor 状态放进 Module；这些仍由各领域调用方映射。

### D3：Windows Adapter 使用“先拥有，再 spawn”的监督进程

不能由主进程普通 `spawn` Bash/Product 后再 Assign Job：MSYS 可能在 Assign 前已经派生后代。Windows Adapter 应使用一个极小监督入口：

1. 监督进程创建 Job、设置 `KILL_ON_JOB_CLOSE` 并先加入自身。
2. 监督进程启动目标命令，目标和后代自然继承 Job。
3. 父进程通过专用 IPC 请求监督进程向 cooperative root 发出优雅退出请求；Job ownership 在此期间始终保留，grace 到期后监督进程执行 `TerminateJobObject` 硬终止整个 Job。
4. 父 IPC 断开、CMD 关闭、监督进程崩溃时，Job handle 关闭，内核终止剩余后代。
5. 目标正常退出时监督进程关闭 Job，清理仍留在后台的目标后代，再报告 completion。

stdout/stderr 继续使用独立 pipe，不把监督协议混入命令文本。父进程必须设置自己的 completion watchdog，防止监督 IPC 或 Bun runtime 缺陷再次形成无限等待。

### D4：POSIX Adapter 使用 process group

Linux/macOS Adapter 用独立 process group 承担相同 Interface：

- 轻量 supervisor 启动目标 process group，并以独立 IPC 观察宿主断连。
- graceful 阶段向整个 group 发 SIGTERM。
- grace 到期向整个 group 发 SIGKILL。
- 等待 group/stdio 收口，并在 hard window 内完成。
- supervisor 持有进程内 group identity；不写 PID 文件，不跨 invocation 扫描或重绑。

不在 Windows 上模拟 POSIX group，也不在 POSIX 上引入 Job Object 术语。

### D5：Windows Job 实现选型，待用户确认

#### 方案 A：Bun FFI，推荐

优点：

- Portable Bun 1.3.14 已通过 `CreateJobObjectW`、Assign、SetInformation、Terminate、Close 和嵌套 Job 探针。
- 不增加 native npm dependency、Node ABI 矩阵或独立二进制下载。
- Manager 和 Product 本来就以 Bun 为 Application Runtime，运行条件真实存在。

风险与约束：

- `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` 的 x64 ABI layout 必须集中封装并用 Windows-only layout/行为测试锁定。
- 仅声明 Windows x64；不能把当前结构体布局静默推广到未来 Windows ARM64。
- FFI/Win32 初始化失败必须 fail closed，并输出 API/错误码；不能自动回退 `taskkill`。

#### 方案 B：随 Windows Release 分发的小型 native helper，条件回退

优点：

- Win32 类型和结构体由编译器定义，ABI 风险最低。
- 可以用 `CREATE_SUSPENDED`、Assign、Resume 建立更强的创建期合同。

代价：

- 新增 Rust/C++ build、Windows runner、checksum、签名/来源、Release Manifest、打包和更新所有权。
- Manager npm 包与 Windows Release 的 helper 版本需要兼容协议。
- 对当前仅六个 Win32 API 的需求可能过重。

只有方案 A 未通过 Release/受限 Job 门禁时才建议启用方案 B，并应由用户再次确认。

#### 方案 C：第三方 npm 包，不推荐

- `tree-kill`/`fkill` 在 Windows 最终仍调用 `taskkill /T`，无法解决已确认的 MSYS reparent。
- `@vscode/windows-process-tree` 只负责枚举，不能在派生前建立所有权，unpacked 约 16 MB。
- 当前未找到维护可信且直接提供 Job Object ownership 的 npm 包。

### D6：终止是两段式且总时长有界

推荐默认策略：

```text
timeout/abort/cancel 到达
→ 立即记录 reason，停止接收新的调用方写入
→ Windows 请求 cooperative root 优雅退出；POSIX 向整个 process group 发 SIGTERM
→ grace 到期仍存活则 hard terminate Windows Job / POSIX process group
→ 等待 stdio EOF / supervisor completion
→ hard completion window 到期则返回 ownership failure
```

具体毫秒数在实现 Phase A 用真实 Bash、test runner 和 Product shutdown 测量后确定，不在计划阶段拍脑袋固定。约束是：Bash timeout 触发后必须很快给用户确定结果；Product 正常 shutdown 可以使用更长 grace，但不能无限等待。

### D7：与 Task 116 的取消语义分层

- Task 116：Agent/Workflow/Job 的逻辑状态、Harness dispose、Promise fencing、迟到 invocation result。
- Task 117：外部 OS 进程树实际退出、stdio/handle 收口和平台 Adapter。

AgentJobManager 继续持有 Job status；它通过 AbortSignal/terminate reason 请求 Owned Process lease 终止，不接触 Job Object。Owned Process Module 不创建新的 Agent job 状态，也不写 session JSONL。

### D8：与 Task 105 的 Product 生命周期分层

- Task 105：Installation/State Root、Manager start/stop/restart、容器 provider 和 Release ownership。
- Task 117：Manager 启动的本机 Product 进程树所有权，重点是 Windows Portable CMD 关闭。

未来 Manager `stop/restart` 仍需尊重 Task 105 的实例所有权模型，不能因为存在 Job Object 就假定任意 Manager 进程都能杀任意实例。本 Task 首先覆盖当前前台 Portable lease；持久化跨 Manager invocation 的后台实例 ownership 仍由 Task 105 决定。

## Rejected Approaches

- 只把 `SIGTERM` 换成 `SIGKILL`：仍只针对 wrapper PID。
- 只调用 `taskkill /PID ... /T /F`：依赖当前父 PID 树，已被 MSYS fork/reparent 反例否定。
- 用 WMI/CIM/`Win32_Process` 按 ParentProcessId 递归：存在枚举竞态和 reparent 缺口。
- 按命令行、路径、CreationDate 或进程名扫描：可能杀掉用户自己的 Bash/find，是不可接受的 hack。
- 全局结束所有 `bash.exe`、`find.exe` 或 Bun：破坏用户进程和其他 NeuroBook 实例。
- 只给 Promise 再套一个 timeout：让 UI 返回但把进程、端口和数据写入留在后台。
- timeout 后立即销毁 stdout/stderr 监听但不杀树：掩盖泄漏并可能触发未处理 pipe error。
- 关闭 CMD 时扫描端口 Owner 再杀：端口表已可能显示失效 PID或 `[System]`，且 ownership 判断不可靠。
- 失败后自动换端口：会留下旧实例/句柄、制造多个真相源，不能算修复。
- 提示用户重启 Windows：可作为当前版本的最后人工恢复手段，不是产品方案。
- 把所有 `spawn` 一次性迁入新 Module：范围过大，缺乏真实所有权需求。

## Implementation Plan

### Phase A：固化反馈环和 Interface

- [x] 把现有 Portable Bun + PortableGit 探针整理成 Windows-only 测试 fixture，不依赖用户真实 workspace。
- [x] fixture 创建 wrapper → Bash → 孙进程，并让孙进程持有 stdout/stderr。
- [x] fixture 增加本地 TCP listener/继承句柄场景，以有界端口重 bind为最终断言。
- [x] 记录PID、termination reason、grace/hard timing和最终资源收口结果。
- [x] 根据测量确定Bash与Product各自grace/hard window。
- [x] 确认Module名称、Interface与独立package归属。
- [x] 用户确认D5后进入业务实现。

Phase A gate：原始无 Job 实现必须稳定失败；Job fixture 必须稳定通过，且失败信号是后代/端口而不只是直接 child exit code。

### Phase B：实现 Owned Process Lifecycle Module

- [x] 建立 platform-neutral Interface 与 typed termination reason/result。
- [x] Windows supervisor 在 spawn 目标前完成 Job 创建、`KILL_ON_JOB_CLOSE` 和 self-assign。
- [x] 监督协议使用独立 IPC；stdout/stderr 保持纯命令输出。
- [x] Windows Adapter 实现 graceful request、`TerminateJobObject`、parent disconnect 和 completion watchdog。
- [x] POSIX Adapter 以独立 supervisor 实现 process group TERM→KILL 与宿主断连清理。
- [x] 所有 listener、timer、IPC、pipe 和 Job handle 在单一 cleanup path 释放。
- [x] 初始化/Assign/SetInformation失败时返回结构化ownership failure，不启动未受管目标。
- [x] 增加并发lease隔离测试，终止一个命令不能影响另一个命令。

Phase B gate：Module 自身跨平台窄测试通过；Windows 测试证明 MSYS 后代和端口都归零；无未处理 rejection/handle 泄漏。

### Phase C：迁移 Agent Bash

- [x] `runBash()` 不再直接掌握 ChildProcess kill；改为消费 Owned Process lease。
- [x] foreground timeout、AbortSignal、background Job cancel、Harness shutdown走同一个terminate Interface。
- [x] 保留Bash领域错误分类：timeout、aborted、non-zero exit、ownership failure不混为一类。
- [x] timeout/abort发生后停止迟到output update；Module内部继续完成有界stdio drain。
- [x] 正常Bash完成时清理残留后台后代，防止`cmd &`逃逸owned lease。
- [x] 与Task 116对齐，不覆盖或复制AgentJobManager shutdown/status逻辑。

Phase C gate：

- 前台 timeout。
- 前台 abort。
- 后台 Job cancel。
- Harness dispose/shutdown。
- MSYS reparent。
- 两个并发 Bash 只终止目标 lease。
- 输出截断/temp file 正常收尾。

### Phase D：迁移 Windows Portable Product

- [x] `runPortableForeground()`通过Owned Process lease启动`product-start.mjs`。
- [x] CMD关闭、Manager IPC disconnect、启动健康检查超时都终止完整Product tree。
- [x] `product-start.mjs`继续负责应用级graceful signal，不承担Windows Job细节。
- [x] 明确Manager → Product supervisor → Nitro → Agent Bash的嵌套Job诊断。
- [x] 嵌套Job不可用时fail closed；不静默改用`taskkill`。
- [x] 保留Task 105的实例ownership边界，不把前台lease扩写为跨invocation stop协议。

Phase D gate：正常启动/关闭、卡住 Bash 后关闭、健康检查失败、Product crash、端口复用全部通过。

### Phase E：文档、诊断与 Release 门禁

- [x] 错误报告记录termination reason、grace/hard阶段、supervisor exit和Win32 error，不记录用户命令完整敏感内容。
- [x] 保持Agent Bash timeout秒单位并实现触发后的bounded cleanup语义。
- [x] 更新Manager/Windows Portable任务文档，说明CMD是前台ownership lease。
- [x] Module名称确认后同步`CONTEXT.md`。
- [x] Windows Release preflight与候选zip门禁使用真实Bun、PortableGit和Manager bundle。
- [x] Release smoke失败时保留既有日志诊断，且cleanup要求端口释放。
- [x] 更新Task 105、Task 116交叉引用，不重复其TODO。

Phase E gate：本地实现已满足；Windows Release runner真实Portable smoke与POSIX runner adapter回归由已接入workflow的外部门禁继续确认。

### Phase F：最终验收与清理

- [x] 用等价三层fixture重跑完整故障形状：Product外层Job → Git Bash卡住 → 关闭宿主。
- [x] 确认直接PID、所有后代、stdio和测试端口均收口。
- [x] 删除临时FFI探针文件，必要fixture已迁入正式测试目录；空临时目录不包含资产。
- [x] 检查没有`taskkill`/WMI/按名称kill fallback。
- [x] 按相关diff完成最终review，未扩展审查工作树其他任务改动。
- [x] 更新本README的实际结果、验证证据、计划出入与剩余TODO。
- [x] 同步`PROJECT-STATUS.md`状态。

## Verification / Test Plan

| Layer | Scenario | Required assertion |
| --- | --- | --- |
| Module unit | termination reason/重复 terminate | 单一终态、幂等、timer/listener 清理 |
| Windows integration | supervisor + PortableGit + MSYS 孙进程 | Job 建立早于 target；后代数量归零 |
| Windows integration | KILL_ON_JOB_CLOSE | supervisor/parent 非正常退出后后代归零 |
| Windows integration | nested Job | Product lease 内命令 lease 成功或明确 fail closed |
| Windows integration | stdout/stderr inheritance | timeout 后 pipe EOF，有界 completion |
| Windows integration | socket/port fixture | 原端口立即可重 bind |
| Agent tool | foreground timeout | 在 timeout + termination window 内返回 timeout error |
| Agent tool | foreground abort | 返回 aborted，后代归零 |
| Agent Job | background cancel/shutdown | Job 状态由 Task 116 收口，OS 后代归零 |
| Isolation | two concurrent commands | cancel A 不影响 B |
| Portable | normal CMD close | Product tree 和端口归零 |
| Portable | stuck Bash then CMD close | Product/Bash/find 全部归零，端口可复用 |
| Portable | startup health timeout | 不留 Product/Agent 后代 |
| POSIX | Bash group TERM→KILL | 整组退出，现有 Product SIGTERM 测试继续通过 |
| POSIX | owner SIGKILL / IPC disconnect | supervisor 仍收口 group、后代与测试端口 |
| Release | staged Windows zip | 使用包内 Bun/PortableGit/Manager，不借宿主工具蒙混通过 |

测试不能只断言 Promise reject 或直接 PID 消失；至少同时断言 OS 后代和资源释放。Windows-only 测试在非 Windows 可以 skip，但 Windows Release workflow 不得 skip。

## User Decisions

### 决策 1：Windows Job Adapter 的生产实现

推荐选择：**方案 A，Bun FFI；方案 B 只作为门禁失败后的再次决策，不预先实现。**

需要用户确认：

- 是否同意按方案 A 进入实现；
- 如果方案 A 在 Release runner 或真实 Portable 受限 Job 环境失败，是否允许暂停并另行评估受校验 native helper，而不是缩减 Windows Portable 能力。

### 决策 2：Module 名称

推荐稳定名称：`Owned Process`，中文解释为“自有进程”。它强调 NeuroBook 只管理自己在 lease 内创建的进程树，不管理系统或用户进程。

备选：`Process Lease`。该名称更强调生命周期，但不如 `Owned Process` 直接表达安全边界。

名称确认后才写入 `CONTEXT.md`。

## Implementation Walkthrough

### 2026-07-28：POSIX 宿主断连所有权补齐

- Application State 健康提交审查发现：Windows supervisor 会在 Manager IPC 断开时依靠 Job Object 清理候选 Product，但 POSIX Adapter 仍由 Manager 进程直接持有 detached process group；Manager 被强杀后，候选可能继续运行且下一次 Operation recovery 没有安全的跨进程 owner。
- POSIX Adapter 现改为与 Windows 相同的父侧 lease + 独立 IPC supervisor。supervisor 启动目标独立 process group，转发原有 stdin/stdout/stderr；主动 terminate、根进程自然退出与宿主断连共用 TERM→KILL、group probe 和有界 completion。公共 `spawnOwnedProcess()` Interface、termination reason 与调用方均未变化。
- 没有持久化 PID、枚举父子树或按进程名清理。Manager异常退出时由仍持有活跃 group identity 的 supervisor完成 `host-disconnect`；监督协议/信号/probe 无法证明收口时返回结构化 ownership failure，Application State rollback保持fail closed。
- 包内故障测试改为注入私有 supervisor source，不把测试 fault 暴露到公共 Interface；宿主异常退出 fixture 现在同时作为 Windows/POSIX合同。Windows本机结果为11项通过、2项POSIX-only跳过，Owned Process typecheck、Manager 5文件58项与Manager打包安装通过。当前主机WSL没有Bun/Node且无Docker，POSIX runtime执行仍等待Linux/macOS runner，不能表述为本机实跑通过。

### 2026-07-22：终态状态机、错误语义与 Release owner门禁最终收口

- Windows supervisor不再在`TerminateJobObject()`成功前报告`terminated`。调用失败会保留`GetLastError()`并返回`terminate-job`，随后关闭唯一Job handle，继续依靠`KILL_ON_JOB_CLOSE`清理目标树；包内私有source factory提供真实无效handle回归，不进入公共Interface或生产环境变量。
- Windows Adapter把terminal message、监督协议错误、控制IPC错误和ChildProcess `error`事件都暂存到supervisor `close`后再提交；`terminate()`先固定reason、Promise和watchdog，再发送控制消息。只有无法确认supervisor关闭的watchdog到期才返回`hard-kill-wait`。
- POSIX Adapter把TERM、KILL和process group探测的非`ESRCH`异常统一映射为`process-group-signal`/`process-group-probe`，event、interval和timer回调只进入单一`rejectOnce()`，不再向事件循环直接抛异常。
- `runBash()`只消费lease completion中的termination reason。timeout与AbortSignal handler只停止迟到输出并请求终止；前台、后台均用嵌套`try/finally`保证输出 Store 的 `closeOutput()` 在 `finish()` 失败时仍执行，ownership failure 保持原样传播。旧 `closeTempFile()` / 系统 temp 文件合同已由 Task 130 的 Cache Root/逻辑 locator 生命周期取代。
- `runPortableForeground()`现在把健康检查前退出码0明确判为启动失败，健康前非零退出仍保留真实退出码；启动健康超时继续使用`startup-failure`收口完整Product树。
- Windows Release的Launcher参数转交继续独立验证。浏览器、鉴权和完整data复用三条候选链改为从Manifest解析实际Manager Runtime与版本化Manager bundle，直接启动并只终止该Manager PID，再等待IPC断连触发Product Job收口和端口重绑；不再把外层CMD/wrapper退出当作Product终态。

最终本地验证：

- Owned Process typecheck通过；Windows本机11项通过、2项POSIX-only跳过，包含真实`terminate-job + Win32 error`、同步IPC断开、ChildProcess error等待close、重复terminate、宿主断连、嵌套Job和端口收口。
- Agent/Release聚焦3文件12项通过；真实`bun run test:windows-owned-process`通过前台timeout/abort、后台Job cancel和Harness shutdown，孙进程、stdio与端口均收口。
- Manager typecheck、pack审计通过；默认并行完整suite首次暴露Stage 0真实Bun大文件复制/校验在高I/O下超过30秒，单测预算按真实工作量调整为60秒；随后默认并行与串行完整suite均为153项通过、2项按平台跳过。
- 根typecheck中的本轮参数类型错误已修复；复跑后只剩共享工作树中Task 116三个测试文件缺少Vitest显式导入，不计为Task 117通过。
- 真实候选Windows Release workflow、POSIX runner和可见CMD窗口关闭验收尚未执行，继续保持pending，不提前勾选外部证据。

与确认计划的差异：没有增加native helper、进程扫描或新生命周期框架；额外补强了ChildProcess `error`也必须等待supervisor `close`，以及OutputAccumulator `finish()`自身失败时仍关闭临时文件。候选实际Product没有既有PID观测seam，且计划禁止扫描，因此候选workflow不新增生产PID接口：Manager fixture断言真实后代PID消失，候选实际Manager门禁断言端口释放，两层证据组合覆盖进程与资源收口。真实GUI关闭按项目规则未自动执行，保留为用户授权后的本机最终验收。

### 2026-07-22：Owned Process、Agent Bash 与 Portable Product 实施

- 用户确认 Windows 采用 Bun FFI + Job Object，Module 名称采用 `Owned Process`，明确禁止 `taskkill /T`、进程扫描和其他 fallback hack。
- 新建 `packages/owned-process/`。Windows supervisor 在目标创建前自加入带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job Object，再启动目标；控制/状态使用 Node-compatible IPC，不占用目标继承的 stdin/stdout/stderr。POSIX Adapter 使用独立 process group。
- 初版曾尝试专用 fd3/4 管道；Bun 1.3.14 在 Windows 对额外 fd 读取不产出数据，fd 转交又触发 `EBADF`。最终切到 IPC，保持协议与目标 stdio 完全分离，并新增 `stdin: inherit` 回归。这是实测后的协议调整，不是进程扫描 fallback。
- Windows Adapter捕获无效协议、IPC send error、监督器异常退出和completion watchdog；终止原因保持timeout/abort/cancel/shutdown/startup-failure/host-disconnect六类，重复terminate幂等。
- `server/agent/tools/file-tools.ts` 的前台与后台 `runBash()` 统一消费 Owned Process lease；原30秒timeout到达后不再只kill Git Bash wrapper，而是进入250ms grace + 3s hard completion window。Agent Job cancel/Harness shutdown继续通过Task 116 AbortSignal接入。
- `packages/neuro-book-manager/src/app-commands.ts` 的Windows Portable前台Product改为Owned Process；健康检查失败映射为`startup-failure`，Product使用2s grace + 5s hard completion window，stdio保持前台继承。
- Manager对Owned Process使用build-time devDependency，公开npm单文件bundle内联实现；pack package不携带私有workspace production dependency。
- Release workflow在Windows Product构建阶段运行源码package与Agent Bash smoke，并在候选zip解压后用包内Bun + PortableGit重跑自包含package smoke；外层Product Job→内层真实Git Bash Job→监听端口孙进程也纳入门禁。
- Release workflow原先三个`taskkill /T` cleanup已移除。Launcher只负责独立参数合同；实际浏览器、鉴权与data复用门禁直接启动候选Manifest中的Manager Runtime + bundle，并只强制关闭该Manager PID，再等待Job ownership释放与端口可重绑；没有加入WMI、父PID枚举、端口owner kill或按名称扫描。

### 实际验证

- `packages/owned-process`: typecheck通过；Windows本机11项通过、2项POSIX-only跳过，覆盖正常退出、根进程自然退出后的后台后代清理、真实Win32 terminate失败、协议/IPC/监督器错误终态、并发隔离、stdin继承、宿主异常退出、外层Product Job嵌套内层Agent Bash Job。
- `packages/owned-process/tests/windows-release-smoke.ts`: 本机Bun 1.3.14 +真实Git Bash通过timeout、abort与嵌套Product/Bash资源收口。
- `bun run test:windows-owned-process`: 真实Agent `runBash()` timeout/abort、后台Job cancel与Harness shutdown smoke通过，错误分类和资源收口合同保持一致。
- `packages/neuro-book-manager`: typecheck通过；默认并行和串行完整suite均为30文件153项通过、1文件2项按平台跳过；Portable启动超时、健康前0/非0退出与进程树/端口回归通过；`pack:check`通过，tgz仅5文件。
- 根`file-tools.test.ts`正常Bash输出用例通过。仓库Vitest由Node worker执行，Windows FFI回归因此使用正式Bun smoke，而不把整个根suite强改Bun；后者会触发当前Zod/Vitest-Bun收集兼容问题。
- 真实候选Windows Release zip门禁已写入workflow但尚未执行，不能把本机源树结果表述为Release runner已通过。

### 本轮计划出入

- 原计划的额外fd控制管道在Bun/Windows实测不可用，改为IPC；安全边界和stdout/stderr纯净合同不变。
- 宿主强杀后发现Windows端口表可能比PID消失晚数百毫秒；验收从“同步立即bind”订正为“在明确3秒内可bind”。本机实际回归约0.3–0.7秒完成，不再宣称OS同步时序。
- 没有建立native helper，也没有迁移所有一次性spawn；范围仍只覆盖Agent Bash与Windows Portable前台Product。
- Release candidate尚未构建/执行，所以Task状态是本地实现完成、Release门禁待验证，不提前标记完全Accepted。

### 2026-07-22：诊断、架构审计与计划

- 阅读 `$diagnose`，按反馈环 → 复现 → 假设 → 探针顺序确认症状。
- 阅读 `$improve-codebase-architecture`，用 deletion test 约束 Module seam；没有把所有 `spawn` 纳入范围。
- 核对 Bash schema、前后台调用、timeout/abort、Portable Manager、Product launcher 和 Windows 测试缺口。
- 核对 Session 755：真实 `find` 是 abort 证据，不是 30 秒 timeout 证据。
- 用 Portable Bun 1.3.14 与 PortableGit 2.55.0.windows.3 复现 wrapper 后代泄漏和端口随后代退出而释放。
- 用隔离 FFI 探针确认 Job Object 显式终止、`KILL_ON_JOB_CLOSE` 与当前环境嵌套 Job 可行。
- 调研第三方包：现有 kill 包仍依赖 `taskkill /T`，process-tree 包只枚举，不满足 ownership。
- 创建本 Task 并同步 `PROJECT-STATUS.md`；没有修改业务代码或安装依赖。

### 本轮实际结果与原计划差异

- 原计划需要在 FFI、native helper 和第三方包之间保持开放；实际探针已证明 FFI 在真实 Portable Runtime 可行，因此计划收敛为 FFI 首选、helper 条件回退、第三方包拒绝。
- 原截图把端口状态判断为必须重启的内核残留；最小复现否定了这个结论，根因改为泄漏后代持有句柄。
- 原本担心 Product Job 内无法创建命令 Job；当前嵌套探针成功，但仍保留 Release/受限宿主门禁。
- 本轮没有进入业务修复，符合用户“先新建 Task、深入分析和制定计划”的要求。

## TODO / Follow-ups

- [x] 用户确认D5的Bun FFI方向与`Owned Process`名称。
- [x] 从正式fixture与回归测试进入实现，没有把临时探针直接复制进生产。
- [x] 保留Task 105、Task 116职责边界。
- [x] FFI/嵌套Job失败保持fail closed，没有扫描式fallback。
- [ ] 执行真实候选Windows Release workflow，确认包内Bun + PortableGit、实际Manager PID cleanup与POSIX runner门禁。
- [ ] 经用户授权执行一次可见CMD窗口最终验收：卡住Bash fixture后关闭窗口，以fixture PID和端口确认完整收口。

### 2026-08-02：Source Dev owner 与 Session Store lease 诊断补齐

- 真实故障不是 `favicon.ico` 本身：Nuxt 的全局 startup readiness 在处理该请求时等待 Agent Session Store，随后把 `proper-lockfile` 的 `ELOCKED` 暴露出来。现场 PID 的父进程已经消失、3000 无监听，但 `workspace/.nbook/agent/migrations/runtime.lease.lock` heartbeat 仍持续更新，确认是旧 Source Dev 后代仍存活并持锁。
- 现场只终止了命令行、父进程和路径都能确认属于本仓库的孤儿 Nuxt PID；没有扫描进程名、删除活锁或基于 metadata 杀 PID。heartbeat 停止后继续由既有 30 秒 stale 协议恢复。
- 根 `dev` 现在是 Source Dev launcher，原完整准备链改为内部 `dev:runtime`。launcher 用 `spawnOwnedProcess()` 在准备动作之前拥有完整后代树；Manager 的 `source-dev` Adapter 直接调用 `dev:runtime`，因为 Manager 已是外层 owner，避免嵌套两层 owner。
- 首次 Ctrl+C/SIGTERM 使用随机 shutdown token 请求 Product 的认证 loopback shutdown；30 秒内等待 HTTP drain、Agent、Project、Session Store、SQLite 和日志释放。第二次信号立即进入 Owned Process 强制收口；graceful 与 force 同时失败时保留 `AggregateError`，不会等待一个无法证明收口的 completion。
- 真实 smoke 发现 Nuxt 默认 `localhost` 在本机只绑定 `::1`，而共享关闭 client 默认请求 `127.0.0.1`，这会让正常关闭退化为 force。Source Dev 未显式配置 host 时现固定 `HOST/NITRO_HOST=127.0.0.1`；显式 `localhost`、`::` 或 `::1` 时 client 使用对应 loopback 地址。Manager Product 仍固定使用 IPv4 loopback。
- `runtime.lease` 现在保存最小版本化诊断 JSON：lease ID、`runtime | migration`、PID、取得时间和 Bun/Node 版本；不记录 argv、环境、token、cwd 或正文。Runtime、Session migration 和旧 Attachment migration 的 sync/async 获取统一经过同一 Module，竞争统一抛 `AgentSessionStoreLeaseHeldError` 并保留 `code="ELOCKED"`、lease path、heartbeat 与可选 owner。metadata 仅供人排障，不参与抢锁、删锁或杀进程。
- 实际验证：共享 shutdown/launcher、Session Store lease/互操作、Product startup/shutdown 共 8 files / 33 tests；Manager 20 tests；Owned Process 13 passed / 2 POSIX-only skipped；scripts、Runtime、Manager 与 Owned Process typecheck 通过。Windows 真实 fixture 强杀 launcher 后证明 TCP 后代退出、heartbeat 停止，推进到 stale 后可重新取得 lease；隔离 Application State migration 后，两次完整 Source Dev 启动均通过 `/api/app/version`，强杀 launcher 后端口两次释放。

本轮与计划的差异：全新隔离 State Root 必须先执行正式 Application State migration，直接启动被门禁正确拒绝；真实 smoke 因非交互 runner 无法等价产生 Windows Terminal 的 Ctrl+C/关闭事件，最终直接强杀 launcher 验证 host-disconnect，公开 `bun run dev` 到 launcher 的精确 wiring 由合同测试覆盖。没有把 `favicon.ico` 放行，也没有修改 stale 算法、自动终止报告 PID、换端口或引入进程注册表。

后续出现的 Session 3 `ENOENT` 已确认是相同 `localhost:3000` origin 在不同 State Root 实例之间保留了旧 Session ID；Session 3 仍在 Task 118 既有备份中。该问题按 Session Not Found HTTP/前端恢复合同收口，不归因于 lease、孤儿进程或 graceful shutdown，也没有因此改动 heartbeat/stale 协议。
