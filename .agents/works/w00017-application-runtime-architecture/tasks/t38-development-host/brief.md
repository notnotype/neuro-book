# 任务说明：开发宿主——热重载交接、启动失败重试与停止通道（w00017 t38）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

t37（提交 `174a132e`）已让生产进程由宿主拥有：生产、开发与 CLI 共用 `server/runtime/product-startup.ts` 的 `startProductRuntime()`；所有停止来源经 `ServerRuntimeHost` 的同一停止入口，先排空（`nbook.http`）再按依赖逆序关闭；退出码 0、1、75。开发模式只做了最小适配，`smoke:product-lifecycle` 的 L8 因此失败。

开发模式现状（第 1、2 条是 G0 实测，其余从代码推断，需要你核实）：

1. **热重载重叠。** nitropack 的 `DevServer.reload()` 对旧 worker 调用 `close()` 但不等它结束，紧接着建立新 worker。每个 worker 是同一进程里的独立线程：模块状态与 `globalThis` 不共享，`process.pid` 相同。旧实例关得比新 worker 启动慢时，新实例拿不到 Session Store 租约（`AgentSessionStoreLeaseHeldError`）而启动失败，且不会自己恢复。
2. **停止通道。** `nuxi dev --no-fork` 不处理 SIGTERM：进程约 1 秒内退出，不跑任何 close 钩子，租约锁 `runtime.lease.lock` 残留。worker 里的 `process.exit` 只结束该线程，nuxi 进程继续存活。
3. **启动失败被缓存。** `startProductRuntime()` 在当前实例已停止后再被调用会抛错；开发适配器 `server/host/development-plugin.ts` 只在 Nitro 初始化时建一次实例。启动失败后，准入一直返回 503（`PRODUCT_STARTUP_FAILED`），直到下一次热重载。
4. **停止路由。** 开发模式下，`server/routes/__nbook/control/shutdown.post.ts` 在 worker 里调用 `requestStop("control:http")`：运行实例会停，但开发模式没有注入 `exit`，进程不退出。`bun run dev`（`scripts/cli/source-dev.ts`）收到 Ctrl+C 或 SIGTERM 时正是发这个请求，然后等进程退出，最多等 `PRODUCT_SHUTDOWN_TIMEOUT_MS`（30 秒），超时后强制结束。
5. **启动链。** `bun run dev` → `source-dev.ts`（经 Owned Process 以独立进程组启动子进程，所以终端的 Ctrl+C 只到它）→ `bun run dev:runtime` → `scripts/cli/source-runtime.ts`（准备步骤后执行 `bun x nuxt dev --no-fork`）→ 实际运行在 Node 上（G0 发现 5）。
6. **smoke 判定。** 见 `scripts/smoke/product-lifecycle/development.ts`。两项都用 Node 直接运行 `nuxt.mjs dev --no-fork`：
   - L7 改动 `server/api/hello.get.ts` 的 mtime（字节不变）触发热重载，要求新的租约持有者出现（leaseId 变化）且 `/api/app/version` 恢复 200；
   - L8 向租约 owner 记录的 pid（即 nuxi 进程）发 SIGTERM，要求 12 秒内进程结束，之后 6 秒内锁目录消失。

依据：
- `docs/specs/runtime/server-host.md`：开发模式、状态与转换（热重载一行）、失败与恢复、验收场景 7 与 8；
- G0 报告 `.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md`：发现 1、2、5，以及“对设计 P6 的修改建议”第 4 条；
- t37 交付报告 `.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/evidences/delivery.md` 第 7 节。

先读：上面三份依据；`server/host/`；`server/runtime/product-startup.ts` 及测试；`server/runtime/foundation/server-host.ts`；`server/features/http/`；`server/features/session-store/plugin.ts`；`server/agent/session/agent-session-store-runtime.ts` 与 `agent-session-store-lease.ts`；`server/middleware/00-product-http.ts`；`server/routes/__nbook/control/shutdown.post.ts`；`nuxt.config.ts` 的内联模块；`scripts/cli/source-dev.ts`、`source-runtime.ts` 与 `shared/source-dev-launcher.test.ts`；`server/runtime/shutdown/product-shutdown-client.ts`；`scripts/smoke/product-lifecycle/development.ts`；`node_modules` 中 nitropack 的开发服务器与 worker 实现，以及 `@nuxt/cli` 的 dev 命令（只读）。

## 目标

### A. 热重载交接

- 先列出产品运行实例在开发模式下持有的进程级排他资源，至少包括 Session Store 租约；逐项说明它是否需要交接。
- 新实例在取得这些资源之前，**有界等待同一进程中的旧实例释放**。只有持有者在同一进程时才等待；持有者在另一进程，或持有的是迁移租约，照旧立即失败。任何情况下都不抢锁、不删锁。
- 等待上限由你取值并说明理由：要能覆盖旧实例的正常停止过程，其中排空最长 20 秒，另加插件关闭的时间。等待期间到达的请求照常在准入处等待就绪，不返回 500。
- 超时后新实例启动失败。诊断要说明是同一进程的旧实例没有在期限内释放，保留原错误类型作为原因。之后按 B 节重试。
- 生产与 CLI 的行为不变：租约被占用时立即失败，不等待。这一点要有测试。
- 机制由你设计，并在汇报中比较你考虑过的做法。可选方向包括：带重试地获取租约并核对 owner 的 pid；在同一进程的 worker 之间用 `worker_threads` 的 `BroadcastChannel` 传递“已释放”；或者更自然的做法。等待期间不能持有心跳或半个锁。

### B. 开发模式不缓存启动失败

- 开发模式下，失败的实例**停完之后**，下一次请求经同一个启动函数建立新实例。并发到达的请求只触发一次重试；重试期间的请求等待；重试仍失败时返回 503 和新的原因；任何请求都不能挂起。
- 失败的实例还在停止时不建立新实例，避免资源重叠。
- 只有请求或热重载会触发重试，不做后台循环。
- 开发适配器的 Nitro `close` 钩子停止的是当前实例（包括重试建立的实例），仍然只有一个钩子，且不抛错。
- 生产行为不变（启动失败写诊断后以 1 退出），CLI 行为不变。

### C. 开发进程的停止通道

- 对开发进程（`nuxi dev --no-fork` 的主进程）发 SIGTERM 或 SIGINT，以及开发模式下的停止路由，都要经宿主的停止入口有序停止运行实例（先排空，再按依赖逆序关闭）。租约锁与 owner 文件释放之后，进程才退出。全部关闭完成时以 0 退出；关闭不完整时能否以 1 退出，照实报告。
- 信号只送到主线程，worker 线程收不到。G0 提出过一个候选做法，**未经验证**：写一个只在开发模式启用、运行在 nuxi 主进程里的 Nuxt 模块，接管 SIGINT 和 SIGTERM，调用 `nuxt.close()` 关闭 Nitro 开发服务器，由 worker 的 close 钩子停止运行实例，然后退出进程。先核实 `nuxt.close()` 是否会等 worker 的 close 钩子跑完、租约释放之后才结束。如果不会，另找可靠的等待方式，不要用固定时长的 sleep 代替。
- 停止路由在开发模式下仍返回 202，并在响应结束后经宿主停止入口请求停止（来源 `control:http`）；运行实例停完之后，主进程要退出。worker 怎样通知主进程，由你设计并说明理由。
- 多个停止来源先后到达时只执行一次停止。停止结束后移除挂接的信号监听。
- `bun run dev` 整条链：向 `source-dev.ts` 发 SIGTERM 或 SIGINT 后，要走 graceful 路径（`shutdownNativeProduct` 返回 `"graceful"`，不打印“转为强制收口”），在 30 秒内以 0 退出，租约已释放，没有残留进程。只有在必要时才改 `source-dev.ts` 或 `source-runtime.ts`，每处改动都要说明原因。
- 不做：不带 `--no-fork` 的 nuxi 分叉模式、Windows、Bun 下的开发 worker。

## 不做

- 生产宿主的行为变更；看门狗；插件通道与 WebSocket；
- 迁移 `server/plugins/` 下其它 Nitro 插件；
- 浏览器宿主与 `index.vue`（L9）；
- 修补 `node_modules` 里的依赖。

## 验收场景（写成合同测试，每个场景一个用例，用例名写清场景）

1. 热重载交接：同一进程的旧实例慢慢停止（用可注入的延迟或时钟），新实例等它释放后取得租约；等待期间到达的请求在就绪后被处理。
2. 交接超时：旧实例在期限内没有释放，新实例启动失败，诊断写明原因；旧实例释放后，下一次请求重试成功。
3. 持有者在另一进程或持有迁移租约时立即失败，不等待；生产与 CLI 模式从不等待。
4. 开发模式重试：第一次启动失败；排除失败条件后，下一次请求建立新实例并就绪。并发请求只触发一次重试；失败实例停完之后才开始重试。
5. 信号停止：主进程的信号处理经宿主停止入口有序停止，租约释放后才退出；重复信号不重复执行停止；停止结束后监听被移除。
6. 停止路由停止：返回 202，有序停止之后进程退出。
7. 生产与 CLI 的已有测试保持通过。

已有测试保持通过。删除或改写的测试，在汇报中逐个列出它覆盖的行为现在由哪条测试承担。

## 允许改动的文件

- `packages/neuro-book/server/host/**` 及测试（可以新增开发模式专用的 Nuxt 模块文件）
- `packages/neuro-book/server/runtime/product-startup.ts` 及其测试
- `packages/neuro-book/server/features/session-store/plugin.ts`、`server/agent/session/agent-session-store-runtime.ts`、`agent-session-store-lease.ts` 及测试（只为 A 节的交接等待）
- `packages/neuro-book/server/runtime/foundation/server-host.ts`、`server/features/http/**`、`server/middleware/00-product-http.ts` 及测试（只在 B、C 节确实需要时改，逐处说明原因）
- `packages/neuro-book/server/routes/__nbook/control/shutdown.post.ts` 及其测试
- `packages/neuro-book/nuxt.config.ts`（只改内联模块的开发分支，或登记新的开发模块）
- `packages/neuro-book/scripts/cli/source-dev.ts`、`source-runtime.ts`、`shared/source-dev-launcher.test.ts`（只在 C 节确实需要时改）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t38-development-host/evidences/`

不改：`packages/neuro-book/runtime/**`（内核）、`scripts/smoke/product-lifecycle*`（smoke 的判定标准）、`app/**`、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、锁文件、`tsconfig*.json`、`vitest*.config.ts`、`node_modules`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

命令从 worktree 根目录执行，包内命令用 `bun run --cwd packages/neuro-book <脚本>`：

1. 新增与改动的测试，以及 `test -- server/host server/runtime server/features server/middleware server/routes server/agent/session shared/source-dev-launcher.test.ts`：全部通过。
2. `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck`：0 错误。
3. `smoke:runtime-foundation -- --host server`：通过。
4. `smoke:product-lifecycle -- --only L7,L8 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-dev-report.json`：两项通过。先确认报告里没有 `pending` 项，不能只看退出码。
5. 改动了生产也会走的代码（`product-startup.ts`、`server-host.ts`、`server/features/http/**`、Session Store 相关文件）时，再跑 `smoke:product-lifecycle -- --only L1,L2,L3,L4,L5,L6,L10 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-prod-report.json`（含生产构建）：全部通过。
6. `bun run dev` 停止链：用临时 State Root 和空闲端口启动（State Root 的准备方式参考 t37 证据中的 `development-service*.log`，或 smoke 的 `ctx.prepare`），就绪后分别向 `source-dev.ts` 进程发一次 SIGTERM、发一次 SIGINT（各启动一次）。记录：退出码、用时、是否走 graceful 路径、租约锁是否释放、是否有残留进程。
7. 全量 `bun run test` 由主 Agent 跑，你不用跑。
8. 把第 1–6 步的完整输出保存到证据目录。

本机内存有限：构建、smoke、开发服务与类型检查不要并行跑，一次只跑一个重任务；开发服务用完立即停止。构建期间不要改动 worktree 中的文件。开发者自己可能开着 `nuxt dev`（例如 3000、3001 端口）：用空闲端口，只结束你自己启动的进程，按 pid 结束，不按名字匹配结束。等进程退出时用 `wait <PID>` 或检查输出里的结束标记，不用 `pgrep -f` 循环。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项（例如 `package.json` 里的其它 scripts）和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”；
- 不用 `rm -rf` 清理仓库内的目录；误写的文件逐个删除，删除前用 `git ls-files` 确认它们没有被跟踪。写证据的命令从仓库根执行，用仓库根相对路径。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。子代理给出的事实性结论（例如运行时行为）要你自己实测确认后才能写进代码注释或汇报。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码；测试不匹配源码字符串。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

先写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–6 各自的结果（附证据文件名），以及 L7、L8 各子断言的结果；
2. 进程级资源清单，以及每项的交接处理；
3. 设计：交接等待、重试、停止通道各自放在哪里、如何协作；考虑过的备选做法，以及选定的理由；`nuxt.close()` 与 worker close 钩子的时序核实结果（实测还是读源码，写明）；
4. 公开行为的变化（主 Agent 据此更新 Spec）：开发模式的退出码、诊断事件、日志；
5. 删除与改写的测试，以及它们覆盖的行为现由哪条测试承担；
6. 改动的文件列表；
7. 禁止清单逐条自查结果；
8. 遗留问题（不超过 5 条）。
