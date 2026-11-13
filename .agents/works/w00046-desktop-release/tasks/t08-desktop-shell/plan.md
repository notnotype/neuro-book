# t08 计划：Electrobun 桌面壳

## Context

按已定的 Spec [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 实现桌面壳（t06 三轮设计审查后定稿；提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.2 到 4.5，[ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) 决定 1、2、4、5）。载荷来自 t07：`packages/neuro-book/scripts/desktop-payload.ts` 组装的 `app/`，壳运行其中的 `server/main.js`。

范围：desktop-shell 的输出 1 到 24，关闭前询问只做壳一侧（页面一侧与编辑器、在跑的工作是 t09）；更新是 t10。t09 之前页面不会接下询问，关窗都会走“没有响应”的原生对话框，这是中间状态。

开发者指定用 autonomous-delivery 推进；本该开发者决定的点记在 [待确认清单](../../pending-confirmations.md)。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 单实例锁与锁上的协议 | 扩展 `@notnotype/nb-host/server` 的状态根认领 | 做法与服务端认领相同是 Spec 的要求（输出 1）；认领已处理残留文件、暂停不接管、同时认领只一个成功 | 另写一套命名管道：重复认领的全部边界 |
| 窗口、对话框、导航、外部链接 | Electrobun 2.0.6 的 `BrowserWindow`、`Utils.showMessageBox`、`Utils.openExternal`、`navigationRules` 与 `will-navigate`、`new-window-open` | ADR 0051 已定 | — |
| 页面与壳之间的桥 | 沙箱网页视图里的 `window.__electrobunSendToHost`（页面到壳，Electrobun 公开的事件桥）加 `executeJavascript` 派发页面事件（壳到页面） | 沙箱关掉 RPC，页面拿不到壳的其它能力（输出 13）；两个方向都只传固定形状的消息 | 非沙箱的类型化 RPC：页面能调用壳注册的全部方法 |
| 结束进程树 | Windows `taskkill /T /F /PID`，等进程真实退出用进程句柄（`Bun.spawn` 的 `exited`）加 `tasklist` 核对子树 | 系统自带；Bun 没有进程树 API | 引入原生模块 |
| WebView2 检查 | `reg query` 读 EdgeUpdate 的 WebView2 客户端键（HKLM 的 WOW6432Node 与 HKCU） | 微软文档给出的检测方式，不需要额外依赖 | 先建视图看失败：失败时已是空白窗口 |

## 关键设计

### `packages/nb-host/src/server/claim.ts`

认领档案加两项，服务端的行为不变：

- `socketName`（缺省 `"server"`）：Unix 上的套接字文件 `<状态根>/<socketName>.sock` 与认领锁 `<socketName>.claim.lock`；Windows 命名管道仍是 `<socketPrefix>-<哈希>`。桌面锁用 `{socketPrefix: "nbook-desktop", socketName: "desktop"}`。
- `ClaimOptions.requests?: Record<string, (request: unknown) => unknown | Promise<unknown>>`：`hello` 之外的请求类型交给它，应答原样写回；处理超过 `HELLO_TIMEOUT_MS`（3 秒）时回 `{error: "timeout"}`。不认识的类型仍回 `unknown-request`（Spec 的 `{ok: false, code: "unknown-request"}` 由桌面一侧的处理器自己写出，认领层只管 `hello` 与分派）。

应答的形状：桌面锁的 `hello` 沿用认领应答的基础字段（`kind` 为 `product`、`url` 与 `rpcUrl` 为 null、状态 `starting`、`ready`、`stopping`）。Spec 输出 2 写的是 `running`，改为 `ready` 并写明另有基础字段（下面“Spec 与文档改动”）。

### `packages/neuro-book-desktop/`（新增，私有 workspace 包）

两层，核心不依赖 Electrobun：

- `src/core/`（Bun 与 Node 内置模块，`bun test` 在 Linux 上用真实进程测）：
  - `state-root.ts`：`resolveDesktopStateRoot({env, cwd, programRoot, platform})` → `{stateRoot, portable}` 或 `{error: "portable-unwritable", path}`；缺省复用 `packages/neuro-book/src/cli/state-root.ts` 的 `defaultStateRoot`（经包名导入，见下）。
  - `lock.ts`：`acquireDesktopLock(stateRoot, handlers)` 用扩展后的认领；`askRunningShell(stateRoot)` 发 `hello` 与 `open-window` 并按输出 3 交回下一步（转交成功、等它退出、版本不同、没有应答、`closing` 时轮询）。
  - `server.ts`：`OwnedServer`：用给定的 Bun 与入口以 `--stop-stdin` 拉起，环境变量 `NBOOK_STATE_ROOT`、`NBOOK_WEB_ROOT`（重新启动时另给上一次的 `NBOOK_PORT`、`NBOOK_RPC_PORT`）；用 `queryNeuroBook` 轮询认领应答等 `ready`；输出写 `logs/desktop/server-output.log`，10 MB 轮转；`stop()` 写 `stop`，截止按输出 19 计算（`20 s + NBOOK_PROJECT_STOP_MS（缺省 20 s）+ 50 s`），到时 `killTree`，等真实退出（10 秒没结束写诊断后继续等）；意外退出发事件。
  - `connect.ts`：输出 4 的判定表，输入 `queryNeuroBook` 的结果与本版本，交回动作。
  - `windows.ts`：关窗协调，纯状态机，经端口操作窗口：每窗一个询问与代次、3 秒接下、再次关闭弹对话框、`window` 与 `quit` 的判断与重问、最后一次关闭期间开窗转交回 `closing`、同意与进入停止中同一步、启动中关掉最后一个窗口作废启动。端口 `WindowPort`：`open(url | startup)`、`load(id, url)`、`close(id)`、`askPage(id, {generation, reason})`、`endAsk(id, generation)`、`showNotResponding(id) → "wait" | "cancel" | "force"`。时钟注入。
  - `shell.ts`：把上面几块串成输出 1 到 24 的流程（取锁 → 问服务端 → 拉起或连接 → 开窗 → 关窗 → 停止 → 放锁），只依赖端口与时钟；`unclean-stop` 记录与下次启动的提示也在这里。
- `src/bun/`（Electrobun 主进程，只在 Hutch 构建的应用里运行）：`index.ts` 建端口的实现：窗口用 `BrowserWindow`（`sandbox: true`、`navigationRules` 只放行启动页与服务端的精确来源）；`will-close` 里同步设 `{allow: false}` 再交给协调器，真正关窗用 `win.close()`；`will-navigate` 与 `new-window-open` 按输出 11、12 分流，外部链接 `Utils.openExternal`；对话框 `Utils.showMessageBox`；桥：页面经 `__electrobunSendToHost` 发 `{type: "close-ack" | "close-answer", generation, answer?}`，壳经 `executeJavascript` 派发 `nbook-desktop` 事件；WebView2 检查在建第一个窗口之前。
- `src/views/startup/`：启动页（纯 HTML 与少量脚本，经桥收壳交来的状态与按钮），文字中文。
- `electrobun.config.ts`（`identifier: "io.github.notnotype.neurobook"`，`exitOnLastWindowClosed: false`，`copy` 载荷 `payload/app` → `app`、启动页）、`hutch.config.ts`（Hutch 0.29.0、Electrobun 2.0.6）、`scripts/build.ts`（用发布清单组装 Windows 载荷到 `payload/`，再 `hutch electrobun build --env=stable`）。
- 包的 `package.json`：`private: true`，依赖 `@notnotype/nb-host`、`@notnotype/neuro-book`（只用 `queryNeuroBook` 与 `defaultStateRoot`：应用包 `exports` 里没有它们时，加两个子路径导出，见下）。

### `packages/neuro-book/package.json`

加子路径导出 `./desktop-support`（新文件 `src/desktop-support.ts` 只再导出 `queryNeuroBook`、`defaultStateRoot`、`PRODUCT_VERSION`），桌面包经包名导入，不深导入源码。

### 根 `package.json`

`workspaces` 加 `packages/neuro-book-desktop`；不加根脚本。

## Spec 与文档改动

- `docs/specs/runtime/desktop-shell.md` 输出 2：`hello` 的状态改为 `starting`、`ready`、`stopping`，应答另有认领应答的基础字段（`kind`、`url`、`rpcUrl`）。
- `docs/specs/runtime/server-host.md` 实现合同：认领档案的 `socketName` 与 `requests`。
- `docs/modules/monorepo-boundaries.md` 与 `packages/AGENTS.md` 的包表登记新包；根 README 两份的包表不动（私有包不发布）。
- 新包的 `README.md` 写构建、测试与在 Windows 上运行的步骤。

## 切片

1. nb-host 认领的 `socketName` 与 `requests`，`claim.test.ts` 加用例（真实子进程：桌面锁与服务端认领在同一状态根上互不干扰；自定义请求的应答与超时）。提交。
2. 新包骨架与 `src/core/`：状态根、桌面锁与转交、连接判定、自有服务端（用源码入口 `packages/neuro-book/src/server/main.ts` 作真实服务端）、关窗协调、流程。每块先写测试。提交（可分两到三次）。
3. `src/bun/` 适配、启动页、Hutch 配置与构建脚本；Linux 上只做类型检查与构建能不能起；Windows 上实测（见“验证”）。提交。
4. Spec 的小改与证据。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| desktop-shell 输出 1、2、3 | `lock.test.ts`（真实子进程：同时取锁一个成功、`hello` 与 `open-window`、`closing` 轮询、旧壳在两次请求之间退出后回到取锁、3 秒没有应答） |
| 输出 4、5、6、7 | `connect.test.ts`（判定表）、`server.test.ts`（真实服务端：拉起、从应答取地址、输出写文件与轮转、重新启动用上一次端口） |
| 输出 14 到 17、23 | `windows.test.ts`（端口替身与注入时钟：代次、3 秒、再次关闭、`quit` 重问、最后一次关闭期间转交、启动中关窗） |
| 输出 18、19、21、22 | `server.test.ts`（真实服务端：写 `stop` 以 0 退出；停止卡住时到截止强制结束并等真实退出；非 0 退出记录；意外退出事件）；输出 22 在 Windows 上手工验 |
| 输出 8 到 13、20、24 | Windows 上手工验（场景 1 到 14 里对应的部分），记进证据 |
| 验收场景 1 到 14 | Windows 上的真实安装包手工跑；能在 Linux 上用核心测到的部分由上面的测试覆盖 |

## 验证

- `bun test`（`packages/neuro-book-desktop`）、`packages/nb-host` 的 `bun test src/server/claim.test.ts`、两个包的 `tsc --noEmit`；`bun run test:affected` 选到的应用测试。
- Windows：在 pc-notype 上用 Hutch 构建并安装，按验收场景手工跑，截图与日志进 `evidences/`。到 pc-notype 的 SSH 链路当前降到约 10 KB/s（t07 证据），构建产物传不过去；可行的路是在 pc-notype 上直接从仓库构建（需要把源码同步过去，同样受链路影响）或在 GitHub 的 Windows runner 上构建与冒烟（要 push，属远端写入）。链路不恢复时，这一步停下交开发者。
- 未验证边界：Electrobun 的沙箱事件桥与 `executeJavascript` 在 Windows 上的实际行为、`will-close` 在 Alt+F4 与任务栏关闭时都触发、WebView2 检查的注册表键。

## 不做与风险

- 不做更新（t10）、页面一侧的询问（t09）、有界面的安装程序与标题栏（t02、t03）。
- 风险：`src/bun/` 的类型来自 Hutch 装的 Electrobun；拿不到类型时适配层只靠构建与 Windows 实测把关。先在切片 3 开头核实 `hutch pm install` 之后能不能解析 `electrobun/main` 的类型。
- 风险：Windows 验证受链路阻塞，见“验证”。
