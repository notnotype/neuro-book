# 任务说明：自有服务端宿主入口与 nbook.http（w00017 t37）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

阶段 1 已完成：内核按入口推导受阻并按依赖图启停（t32）、贡献点由拥有者定义（t33）、产品服务迁为启动必需的插件（t34）、生产打包的 crc32 修复（t35）、内核显式恢复一次推进整条依赖链（t36，提交 `8d6b2d7f`）。

现在产品进程仍由旧路径拥有：
- 运行实例由 `server/middleware/00-product-startup.ts` 在模块加载时经 `productRuntimeReady()`（`globalThis.__nbookProductApplicationV1` 单例）建立，`ServerRuntimeHost` 以 `signals: []` 启动；
- 停止经 Nitro 的 node-server 入口与 `setupGracefulShutdown`，加上 `server/plugins/project-session-close.ts` 的 close 钩子与 `server/runtime/shutdown/` 的 `ProductShutdownController`（排空、退出码、`product-runtime` 与 `app-logger` 两步）；
- 停止路由 `server/routes/__nbook/control/shutdown.post.ts` 直接调用关闭控制器，绕过了宿主；排空由 `server/middleware/product-shutdown-drain.ts` 计数。

`smoke:product-lifecycle` 现状：L1、L2、L4、L5、L6 通过；L3 只有 `drain-new-request` 失败（SIGTERM 后 Nitro 关闭监听，新请求连接被拒，期望 503）。

本任务按 `docs/specs/runtime/server-host.md` 让宿主拥有进程，删除旧路径。依据：
- `docs/specs/runtime/server-host.md`：启动序列、停止序列、退出码表、开发模式、迁移；
- `packages/neuro-book/docs/proposals/extensible-application-platform.md` P6 与 P9（`nbook.http` 一行）；
- G0 验证报告与原型：`.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md` 与 `changes.diff`（原型入口 `server/host/product-host-entry.ts`、Nuxt 模块注入 `entry` 的写法）。原型只是验证代码，不能直接合入。

先读：上面三份依据；`server/runtime/foundation/server-host.ts` 及其测试；`server/runtime/product-startup.ts` 及其测试；`server/runtime/shutdown/`；`server/middleware/`；`server/plugins/`；`server/routes/__nbook/control/shutdown.post.ts`；`server/features/session-store/plugin.ts`；产生 SSE 的路由（`server/api/workspace-files/events.get.ts`、`server/api/agent/sessions/[sessionId]/events.get.ts`、`server/api/agent/jobs/events.get.ts`、`server/api/projects/presence.get.ts`）与 `server/utils/event-stream.ts`；`scripts/smoke/product-lifecycle.ts` 的 L3–L6。

## 目标

### A. 生产宿主入口

- 用一个 Nuxt 模块只在非开发构建时把 Nitro `entry` 设为自有入口，并在 `prerender:config` 中移除（G0 发现 3）。`.output/server/index.mjs` 路径、Manager 的就绪探测与 `PRODUCT_SHUTDOWN_PATH` 停止通道保持不变。
- 入口经 `ServerRuntimeHost` 建立唯一的产品运行实例，进程信号（SIGTERM、SIGINT）只由宿主挂接一次。Nitro 自带的 node-server 监听与优雅关闭不再使用。
- 入口等待启动结果。失败时先同步写一条致命诊断（保留事件名 `runtime.startup.failed` 与原因文本，包括迁移未完成时“请先执行 `bun run migrate:application-state -- --apply`”的提示），再有序停止已取得的资源，然后以 1 退出，不依赖未捕获异常。
- 依赖的 nitropack 内部导出（`#nitro-internal-pollyfills`、`trapUnhandledNodeErrors`）在入口处用注释写明“升级 nitropack 时要重新验证”。

### B. `nbook.http` 插件

在 `server/features/http/` 新增启动必需的服务端插件 `nbook.http`：
- 生产入口下用 `toNodeListener(useNitroApp().h3App)` 建立 HTTP 服务并监听 `NITRO_PORT`/`PORT` 与 `NITRO_HOST`/`HOST`（沿用 G0 原型的取值方式），日志仍输出与现在相同的 `Listening on <url>` 一行。端口先监听，业务请求等待运行实例就绪后再处理（沿用现有语义）。
- 开发模式与 CLI 不监听，只提供请求准入。
- **请求准入**：一个 Nitro 中间件（替代 `00-product-startup.ts` 与 `product-shutdown-drain.ts`，排在所有中间件之前）把每个请求交给 `nbook.http` 的准入。准入负责：就绪前等待；排空开始后对新请求返回 503（保留“NeuroBook 正在关闭。”文案与状态码）；对在途请求计数，直到响应 `finish` 或 `close`。
- **排空**：停止时先排空，再让其余插件按依赖逆序关闭。排空期间保持监听；SSE 事件流在排空开始时由服务端主动关闭，不计入等待（否则打开的页面会让每次停止都等满 20 秒并以 1 退出）；普通在途请求最多等待 20 秒，超时后继续关闭，并记为关闭未完成（退出码 1）。排空结束后关闭监听。
- 这一顺序（先排空、后其余插件）如何用现有机制表达，由你设计并在汇报中说明理由。注意：`nbook.http` 若依赖其它服务，就会晚于它们激活，这与“端口先监听”冲突；若不依赖，内核会让它与其它插件同时关闭。可以考虑在 `ServerRuntimeHost` 加一个停止前置步骤，也可以有更自然的做法。

### C. 停止来源与退出码

- 所有停止来源经宿主的同一个停止入口汇合，只执行一次：进程信号；停止路由（返回 202 并在响应结束后请求停止，来源 `control:http`）；Session Store 租约失效（`server/features/session-store/plugin.ts` 改为经注入的停止端口请求停止，不再引用关闭控制器）；启动失败。
- 退出码：正常停止且全部关闭完成为 0；启动失败，或停止中有步骤失败、超时为 1；租约失效触发的停止为 75，不论关闭是否完成。多个来源先后到达时取更具体的原因：已请求 75 后再出现 1 仍以 75 退出。
- 停止结算后最后刷写日志（原 `app-logger` 步骤），然后退出进程。

### D. 运行实例的取得方式

- 删除 `productRuntimeReady()`、`stopProductRuntime()`、`exitOnProductStartupFailure()` 与 `globalThis.__nbookProductApplicationV1`。生产入口、开发适配器与 CLI 共用一个启动函数（例如返回宿主句柄，含 `ready` 与 `stop()`），由它建立实例并登记为本模块图的当前产品运行实例。`withProductWorkspaceFiles()`、`productProjectOwner()` 从这里取得实例，对外签名不变。
- `scripts/seed/*.ts`、`scripts/cli/bootstrap-carrier-tree.ts`、`scripts/deploy/product-agent-state-root-smoke.ts` 改用新启动函数，不监听端口，行为不变。

### E. 开发模式（只做最小适配）

- 一个只在开发模式启用的 Nitro 插件，在 Nitro 初始化时（不是首个请求时）用同一个启动函数建立实例，`nbook.http` 不监听。
- 只注册一个不会抛错的 Nitro `close` 钩子来停止实例，其余关闭由内核按依赖逆序完成。
- 热重载时新旧实例交接、开发模式不缓存启动失败、开发进程的信号与停止通道（#244，`smoke:product-lifecycle` 的 L7、L8）留到下一个 Task，本任务不做；但开发模式必须照常可用，不能比现在更差。

### F. 删除旧路径

删除 `server/middleware/00-product-startup.ts`、`server/middleware/product-shutdown-drain.ts`、`server/plugins/project-session-close.ts`、`server/runtime/shutdown/product-shutdown.ts` 与 `product-shutdown-controller.ts`，以及它们的测试。`product-shutdown-client.ts`（Manager 与开发启动器用的客户端）保留。`server/plugins/` 下其它 Nitro 插件（日志桥接、Boot Config、Storage 定义、错误日志、Server Timing）本任务不迁移。

## 不做

- 开发模式热重载交接、启动失败重试、开发进程停止通道（#244）；
- 主线程卡死看门狗（退出码 76）；
- 插件通道、WebSocket 业务、插件静态文件、API 文档；
- 迁移 `server/plugins/` 下其它 Nitro 插件；
- 浏览器宿主与 `index.vue`。

## 验收场景（写成合同测试，每个场景一个用例，用例名写清场景）

1. 停止来源汇合：信号、停止路由、租约失效先后到达时只执行一次停止；退出码按 0、1、75 规则取值，75 之后的 1 仍为 75。
2. 启动失败：写出致命诊断（含原因与迁移提示）后有序停止，以 1 退出；不依赖未捕获异常。
3. 排空：开始后新请求得到 503，在途请求完成后才关闭其余插件；SSE 事件流在排空开始时被关闭且不计入等待；普通在途请求超过 20 秒时继续关闭并以 1 退出（计时用可注入的时钟，不真实等待 20 秒）。
4. 停止路由返回 202，在响应结束后才请求停止，与信号走同一路径。
5. 就绪前到达的请求等待就绪后处理；启动失败时等待中的请求得到明确失败，不挂起。
6. 开发适配器在 Nitro 初始化时建立实例，close 钩子不抛错，失败只写诊断。
7. 新启动函数供 CLI 使用时不监听端口，`stop()` 后实例关闭。

已有测试保持通过；因旧路径删除而删掉或改写的测试，在汇报中逐个列出它覆盖的行为现在由哪条新测试承担。

## 允许改动的文件

- 新增 `packages/neuro-book/server/host/**`、`server/features/http/**` 及测试
- `packages/neuro-book/server/runtime/product-startup.ts` 及其测试（可改名，需同步全部引用）、`server/runtime/foundation/server-host.ts` 及其测试
- `packages/neuro-book/server/features/session-store/plugin.ts`（只改停止端口）
- 第 F 节列出的删除文件；新增准入中间件与开发适配器插件
- `packages/neuro-book/server/routes/__nbook/control/shutdown.post.ts` 及其测试
- 第 B 节列出的 SSE 路由与 `server/utils/event-stream.ts`（只为排空时关闭事件流）
- `packages/neuro-book/nuxt.config.ts`（只加入口注入模块）
- `packages/neuro-book/scripts/seed/*.ts`、`scripts/cli/bootstrap-carrier-tree.ts`、`scripts/deploy/product-agent-state-root-smoke.ts`（只换启动 API）
- `scripts/build/**`（仓库根目录；只限构建闭包登记等因入口变化必须调整的项，逐项说明原因）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/evidences/`

不改：`packages/neuro-book/runtime/**`（内核）、`scripts/smoke/product-lifecycle*`（smoke 的判定标准）、`app/**`、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、锁文件、`tsconfig*.json`、`vitest*.config.ts`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

命令从 worktree 根目录执行，包内命令用 `bun run --cwd packages/neuro-book <脚本>`：

1. 新增与改动的测试，以及 `test -- server/runtime server/features server/middleware server/routes server/host`：全部通过。
2. `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck`：0 错误。
3. `smoke:runtime-foundation -- --host server`：通过。
4. `smoke:product-lifecycle -- --only L1,L2,L3,L4,L5,L6 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-report.json`（含生产构建）：六项全部通过，包括 L3 的 `drain-new-request`。
5. 开发模式可用：用临时 State Root 启动开发服务（按 `package.json` 现有的开发脚本），`/api/app/version` 返回 200、首页可加载，然后停止并确认没有残留进程。再运行一次 `smoke:product-lifecycle -- --only L7,L8` 作为参考，结果照实报告（预期仍失败，属下一个 Task）。
6. 全量 `bun run test` 由主 Agent 跑，你不用跑。
7. 把第 1–5 步的完整输出保存到证据目录。

本机内存有限：构建、smoke、开发服务与类型检查不要并行跑，一次只跑一个重任务；开发服务用完立即停止。构建期间不要改动 worktree 中的文件。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”；
- 不用 `rm -rf` 清理仓库内的目录；误写的文件逐个删除，删除前用 `git ls-files` 确认它们没有被跟踪。写证据的命令从仓库根执行，用仓库根相对路径。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码；测试不匹配源码字符串。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

先写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–5 各自的结果（附证据文件名），以及 L1–L8 各子断言的结果；
2. 设计：入口、`nbook.http`、准入与排空、停止来源汇合、退出码、开发适配器、启动函数各自放在哪里、如何协作；“先排空、后其余插件”用什么机制保证及理由；
3. 公开行为的变化（主 Agent 据此更新 Spec）：新增或删除的模块、事件、退出码行为、日志；
4. 删除与改写的测试，以及它们覆盖的行为现由哪条新测试承担；
5. 改动的文件列表；
6. 禁止清单逐条自查结果；
7. 下一个 Task（开发模式 #244）需要注意的问题（不超过 5 条）。
