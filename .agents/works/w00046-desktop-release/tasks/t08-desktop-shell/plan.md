# t08 计划：Electrobun 桌面壳

## Context

按已定的 Spec [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 实现桌面壳（t06 三轮设计审查后定稿；提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.2 到 4.5，[ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) 决定 1、2、4、5）。载荷来自 t07：`packages/neuro-book/scripts/desktop-payload.ts` 组装的 `app/`，壳运行其中的 `server/main.js`（t07 已在 Windows 上实跑过载荷）。

范围：desktop-shell 的输出 1 到 24 的壳一侧；页面一侧的关闭前询问、编辑器与在跑的工作是 t09，更新是 t10。t09 之前产品页面不会接下询问，真实页面上关窗都会走“没有响应”的对话框；t08 的关窗验收用一个按桥协议回答的测试页面（见“验收映射”）。

开发者指定用 autonomous-delivery 推进；本该开发者决定的点记在 [待确认清单](../../pending-confirmations.md)。计划经 omp 设计审查一轮（[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-disposition.txt)），本稿是修订后的。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 单实例锁与锁上的协议 | 扩展 `@notnotype/nb-host/server` 的状态根认领 | Spec 输出 1 要求做法同服务端认领；已处理残留文件、暂停不接管、同时认领只一个成功 | 另写一套命名管道 |
| 自有服务端的进程树 | `@notnotype/owned-process`（Windows 在目标创建前建 Job Object，POSIX 用监督进程的进程组；宿主退出或 IPC 断开时收掉整棵树） | 输出 19、21、22 要求整棵树归壳、真实退出才放锁、壳死时一起结束；`taskkill`、`tasklist` 给不了这些（审查第 2 条） | `taskkill /T` 加 `tasklist`：拿不到子树、壳死后没人执行 |
| 壳的对话框（没有响应、意外退出、启动页以外的提示） | 壳自己开的小窗口，加载随包的本地视图，按钮经桥回到壳 | Electrobun 2.0.6 的 `Utils.showMessageBox` 在 Windows 上同步调用 `TaskDialogIndirect`，对话框开着时 Bun 主线程停住，认领应答、计时、页面回答、服务端输出都停（审查第 1 条） | `showMessageBox`：阻塞；另起 helper 进程弹系统框：每次 1 秒以上的冷启动，状态难同步 |
| 缺 WebView2 的提示 | `Utils.showMessageBox` | 这时还没有锁、服务端与窗口，阻塞不影响别的；也开不了网页视图 | — |
| 页面与壳之间的桥 | 沙箱网页视图里的 `window.__electrobunSendToHost`（页面到壳）加 `executeJavascript` 派发页面事件（壳到页面），消息有固定形状并带代次 | 沙箱关掉 RPC，页面拿不到壳的其它能力（输出 13） | 非沙箱的类型化 RPC |
| 页面的新窗口请求 | 预加载脚本截住 `window.open` 与带 `target` 的链接点击，经桥交给壳；壳按输出 12 分流 | 2.0.6 在 Windows 上只对 Ctrl 加点击发 `new-window-open`，没有处理 WebView2 的 `NewWindowRequested`（审查第 6 条） | 等上游：现在就要；改 Electrobun 源码：维护代价另议 |
| WebView2 检查 | `reg query` 读 EdgeUpdate 的 WebView2 客户端键（HKLM 的 WOW6432Node 与 HKCU） | 微软文档给出的检测方式 | 先建视图看失败 |

## 关键设计

### `packages/nb-host/src/server/claim.ts`

认领档案与选项加几项，服务端缺省行为不变（审查第 3、4、5 条）：

- `socketName`（缺省 `"server"`）：Unix 上的 `<状态根>/<socketName>.sock` 与 `<socketName>.claim.lock`；Windows 命名管道仍是 `<socketPrefix>-<哈希>`。桌面锁用 `{socketPrefix: "nbook-desktop", socketName: "desktop"}`。
- `messageLimit`（缺省 1 MB）：请求首行与应答都按字节计（UTF-8），超了断开；桌面锁 64 KB。
- 收请求改为绝对截止：连上之后 3 秒内没收到完整一行就断开，收到数据不重置。服务端也改成这样，与 server-host Spec 的“3 秒内不发完请求的连接被断开”一致（现状是空闲计时，收到数据就重置）。
- `requests?: Record<string, (request: unknown) => unknown>`：`hello` 之外的请求类型交给它，**同步**交回应答；处理器在同一个同步段里做完副作用（开窗就是同步建窗）。`unknownReply`（缺省 `{error: "unknown-request"}`）：不认识的类型的应答，桌面锁给 `{ok: false, code: "unknown-request"}`。不提供异步处理，也就没有“超时后迟到的副作用”。
- `publish` 的 `rpcUrl` 允许 null：没有网络端点的认领（桌面锁）也能进入 `ready`；服务端照旧给字符串。

### `packages/neuro-book/src/desktop/`（新增，核心，不依赖 Electrobun）

放在应用包里，直接用应用内部的 `queryNeuroBook`、`defaultStateRoot`、`readServerConfig` 与产品版本，不另建包、不加转导出（审查第 9 条）。测试用 `bun test`，在 Linux 上用真实进程：

- `state-root.ts`：`resolveDesktopStateRoot({env, cwd, programRoot})` → `{stateRoot, portable}` 或 `{error: "portable-unwritable", path}`；`cwd` 是壳进程的工作目录（Electrobun 的启动器把它设成程序的 `bin` 目录，Spec 写的就是“壳的工作目录”）。
- `lock.ts`：取桌面锁（处理器同步建窗）；`askRunningShell(stateRoot, version)` 发 `hello` 与 `open-window`，交回输出 3 的下一步；`closing` 时每秒重发，连不上时回到取锁。
- `owned-server.ts`：所有权三态 `none`、`owned(lease)`、`external(instance)`（审查第 11 条）。拉起用 `spawnOwnedProcess`（目标是随包 Bun 运行 `server/main.js --stop-stdin`，环境变量 `NBOOK_STATE_ROOT`、`NBOOK_WEB_ROOT`，重新启动时另给上一次的端口）；就绪只认认领应答里 `pid` 等于自己目标进程的 `ready`；目标在就绪前退出时重问状态根，被别人抢先认领了就转为 `external`，不报崩溃。输出写 `logs/desktop/server-output.log`，10 MB 轮转。`stop()` 写 `stop`，截止用 `readServerConfig` 解析出的同一份项目停止截止算（`20 s + 项目停止 + 50 s`）；到时让租约结束整棵树，等租约报告树已结束；10 秒没结束写诊断，继续等，不放锁。
- `deadline.ts`：长截止按绝对时间分段调度，每段不超过 2^31−1 毫秒（项目停止截止的上限是 2^31−1，加 70 秒会溢出 `setTimeout`，审查第 10 条）；时钟注入。
- `connect.ts`：输出 4 的判定表。
- `windows.ts`：关窗协调，纯状态机。输入事件：`closeRequested(id)`（`will-close` 已同步否决之后送来）、`closed(id)`（窗口真的没了）、`quitRequested()`（应用级退出请求，已同步否决）、`pageAcked(id, generation)`、`pageAnswered(id, generation, answer)`、`dialogChose(id, choice)`、`openWindowRequested()`（同步，交回 `ok`、`closing`、`stopping`）、`serverReady(url)`、`serverExited(code)`。命令（经端口）：`open(target)`、`load(id, url)`、`commitClose(id)`（真正关窗，不经 `will-close`；直到收到 `closed(id)` 才算关了）、`askPage(id, generation, reason)`、`endAsk(id, generation)`、`showDialog(kind, forWindow?)`、`closeDialog(id)`、`allowQuit()`（停止完成后放行一次应用退出）。每窗一个询问与代次、3 秒接下、再次关闭弹对话框、`window` 与 `quit` 的判断与重问、最后一次关闭期间开窗回 `closing`、同意与进入停止中同一步（同一同步段里封锁开窗）、启动中关掉最后一个窗口作废启动（审查第 7 条）。
- `shell.ts`：把上面串成输出 1 到 24 的流程，只依赖端口与时钟；“没有正常停止”的记录与下次启动的提示也在这里。

### `packages/neuro-book/desktop/`（新增，Electrobun 应用，只在 Hutch 构建的应用里运行）

- `src/bun/index.ts`：端口的实现。窗口用 `BrowserWindow`（`sandbox: true`，`navigationRules` 只放行启动页与服务端的精确来源，`preload` 为下面的预加载脚本）；`will-close` 里同步设 `{allow: false}` 再送 `closeRequested`；`close` 事件送 `closed`；`before-quit` 同步否决再送 `quitRequested`，`allowQuit` 之后放行一次；`will-navigate` 按输出 11 分流，外部链接 `Utils.openExternal`；桥消息按真实的网页视图 id、当前代次、严格的消息形状校验。
- `src/preload.ts`：截住 `window.open` 与带 `target` 的链接点击，经 `__electrobunSendToHost` 发 `{type: "open-window", url}`；不在桥上暴露别的。
- `src/views/startup/`、`src/views/dialog/`：启动页与对话框（纯 HTML 与少量脚本，经桥收壳交来的状态、交回按钮），中文。
- `electrobun.config.ts`（`identifier: "io.github.notnotype.neurobook"`，`exitOnLastWindowClosed: false`，`copy` 载荷 `payload/app` → `app`、视图）、`hutch.config.ts`（Hutch 0.29.0、Electrobun 2.0.6）、`scripts/build.ts`（用发布清单组装 Windows 载荷到 `payload/`，打便携包时另写便携标记，再 `hutch electrobun build --env=stable`）。
- 适配层的类型：切片 3 开头核实 `hutch pm install` 后能否解析 `electrobun/main` 的类型；不能时只靠构建与 Windows 契约测试把关，写进风险。

## Spec 与文档改动

- `docs/specs/runtime/desktop-shell.md`：输出 2 的 `hello` 状态改为 `starting`、`ready`、`stopping`，应答另有认领应答的基础字段（`kind`、`url`、`rpcUrl` 为 null）；输出 14、19、21 与失败表里的“原生对话框”改为“壳的对话框”（壳自己开的小窗口，不经页面）；已知限制加一条：页面里 `window.open` 与带 `target` 的链接经壳处理，其它弹出入口（例如内嵌页面里的弹窗）可能由 WebView2 自己开一个不受导航规则约束的窗口。
- `docs/specs/runtime/server-host.md`：实现合同写认领档案的 `socketName`、`messageLimit`、`requests`、`unknownReply` 与收请求的绝对截止。
- `packages/neuro-book/AGENTS.md` 或包内 README：`desktop/` 的构建、测试与在 Windows 上运行的步骤。
- 待确认清单加：对话框用壳的小窗口；新窗口经预加载脚本截住、其它入口记为已知限制；同页脚本都能回答关闭前询问（插件完全信任，桥只认窗口与代次，审查第 8 条，t09 写进 browser-host）。

## 切片

1. nb-host 认领的扩展，`claim.test.ts` 加用例（真实子进程：桌面锁与服务端认领在同一状态根上互不干扰；65536 与 65537 字节、多字节字符、慢速滴流的 3 秒绝对截止、不认识的请求的应答形状、同步处理器、`rpcUrl` 为 null 的 `ready`）。提交。
2. `src/desktop/` 核心，每块先写测试：状态根、截止、连接判定、桌面锁与转交、自有服务端（真实服务端用源码入口 `src/server/main.ts`；真实的 `nbook start` 在“问到没有”与“自己的服务端认领”之间抢先；停止卡住时到截止结束整棵树）、关窗协调、流程。分两到三次提交。
3. `desktop/` 适配、预加载、视图、Hutch 配置与构建脚本；在 Windows 开发机上构建安装包与便携包，跑“验收映射”里的 Windows 部分。提交。
4. Spec 的小改与证据。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| 输出 1、2、3 | `lock.test.ts`（真实子进程：同时取锁一个成功；`hello`、`open-window` 的三种应答；`closing` 轮询；旧壳在两次请求之间退出后回到取锁；3 秒没有应答） |
| 输出 4、5、6、7 | `connect.test.ts`；`owned-server.test.ts`（真实服务端：拉起、只认自己 pid 的就绪、被 `nbook start` 抢先时转为外部、输出写文件与轮转、重新启动用上一次端口） |
| 输出 18、19、21 | `owned-server.test.ts`（真实服务端：写 `stop` 以 0 退出；停止卡住时到截止结束整棵树、树结束后才交回；非 0 退出记录；意外退出事件）；`deadline.test.ts`（最大项目停止截止的分段） |
| 输出 14 到 17、23 | `windows.test.ts`（端口替身按与 Electrobun 相同的事件顺序派发：`will-close` 否决后送 `closeRequested`、`commitClose` 之后才有 `closed`；代次、3 秒、再次关闭、`quit` 重问、最后一次关闭期间转交、启动中关窗）；Windows 上用测试页面再跑一遍（下行） |
| 输出 8 到 17、20 到 24 在 Windows 上 | Windows 开发机上的安装包与便携包，逐条操作与观察值记进证据：窗口标题跟页面、缺省 1280×800 与小屏的九成；外部链接、`target` 链接、`window.open`、Ctrl 加点击四种入口；测试页面（加载一个只回答桥协议的本地页面，按按钮回 `ack`、`allow`、`deny` 或不回）驱动关窗的各条路径与对话框在开着时锁协议仍按时应答；`Alt+F4` 与任务栏关闭都经询问；结束服务端进程得到意外退出对话框；结束壳的进程树后没有残留；临时改名 WebView2 键模拟缺失；只读目录的便携包 |
| 验收场景 | t08 跑场景 1、2、3、4、8、9、10、11、12、13、14；场景 5、6、7 依赖 t09 的页面一侧，留到 t09 联合验收 |

## 验证

- `packages/neuro-book`：`bun test src/desktop`；`packages/nb-host`：`bun test src/server/claim.test.ts`；两个包的 `tsc --noEmit`；`bun run test:affected` 选到的测试（认领改了，服务端与命令行的测试会被选到）。
- Windows：Windows 开发机上构建并按上表手工验，日志与截图进 `evidences/`。链路 11 月 13 日下午已恢复（t07 证据），实施时先测一次速度。
- 未验证边界：WebView2 自己的弹出窗口（已知限制）；macOS、Linux。

## 不做与风险

- 不做更新（t10）、页面一侧的询问（t09）、有界面的安装程序与标题栏（t02、t03）。
- 风险：`owned-process` 现在只有旧应用在用，标准输入经监督进程转给目标、目标的标准输出交回，这两点切片 2 先核实；不行就在 `owned-process` 里补，并补它的测试。
- 风险：适配层拿不到 Electrobun 的类型时，只靠构建与 Windows 契约测试把关。
