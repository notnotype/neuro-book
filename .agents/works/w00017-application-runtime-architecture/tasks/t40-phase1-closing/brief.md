# 任务说明：阶段 1 收尾——缺陷修复与 Nitro 插件迁移（w00017 t40）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

阶段 1 的退出条件已经满足：生产与开发进程由宿主拥有（t37 `174a132e`、t38 `4705141b`），浏览器窗口在挂载前建立运行实例（t39 `fddef68b`），`smoke:product-lifecycle` L1–L10 全部通过。主 Agent 做了集成复核，开发者选定本任务处理下面两组问题。

依据：
- `docs/specs/runtime/server-host.md`：输出与可观察行为中的退出码表与停止规则、副作用与数据一节（“现有 `server/plugins/` 中的 Nitro 插件……的职责迁入内置插件；迁移后不再有第二套启动或关闭路径”）、边界与兼容；
- `docs/specs/runtime/diagnostics.md`：实现合同与已知限制（产品 `AppFileLogger` 与诊断出口同时指向同一目录时不互斥）；
- `packages/neuro-book/docs/proposals/extensible-application-platform.md` P6、P9（`nbook.diagnostics` 一行：取代 Nitro 日志插件与关闭清单中的 app-logger）、P10；
- `docs/testing/README.md` 的验证门禁（“验收脚本在构建失败等原因导致检查没有执行时，必须以非零退出”）。

先读：上面的依据；`server/plugins/` 下全部文件及测试；`server/runtime/product-startup.ts` 及测试；`server/features/` 下各插件；`server/host/`；`runtime/diagnostics/`（只读，平台中立机制）与 `server/features/runtime-diagnostics/`；`server/app-logs/`；`server/runtime/product-command.ts`、`server/runtime/product-start-command.mjs` 及相关测试；`scripts/smoke/product-lifecycle.ts`；`scripts/db/migrate-application-state.test.ts`；`.agents/works/w00017-application-runtime-architecture/tasks/t35-archive-crc32-bundle/README.md` 的审查一节。

## 目标

### A. smoke 在检查未执行时以非零退出

`scripts/smoke/product-lifecycle.ts` 现在只在有检查 `fail` 时设置退出码 1；构建失败或其它原因导致所选检查被记为 `pending` 时仍以 0 退出。改为：所选检查中有任何 `pending`，或主流程抛出异常，都以非零退出；报告内容与现有格式不变。补测试。

### B. 产品启动包装进程链的信号与退出码

进程链：`product-command`（`server/runtime/product-command.ts`）→ `product-start`（`server/runtime/product-start-command.mjs`）→ 服务进程 `index.mjs`。主 Agent 从代码推断出两个问题，先实测确认再修：

1. 两层包装都用 `process.once` 注册 SIGINT、SIGTERM。整个进程组收到 SIGTERM 时（Owned Process 的 `terminate`、终端 Ctrl+C），外层又把信号转发一次，`product-start` 收到第二次信号时已没有处理函数，被信号直接杀死；外层随即以 1 报告“Product Runtime command 被信号中断：SIGTERM”，并且不再等待服务进程退出。smoke 收尾时 `dispose-complete` 的 `exitCode: 1` 即来自这里（见 t35、t37、t38、t39 证据中的 `L1.log`）。
2. `product-start` 收到停止信号后，不论服务进程以什么码退出都以 0 退出，盖掉了 `runtime.server-host` 规定的 1（停止中有步骤失败、超时）与 75（租约失效）。

要求：重复收到停止信号不会杀死包装进程，信号只向子进程转发一次；包装进程在子进程退出后才退出，并如实传递子进程的退出码（子进程被信号结束时的处理由你定，与现有容器 PID 1 转发场景保持一致并说明理由）。用真实子进程写回归测试：修改前失败、修改后通过（例如整组发 SIGTERM，断言最外层退出码等于服务进程的退出码、包装进程不早于服务进程退出）。Manager 的就绪探测与停止合同不变（L4、L6 覆盖）。

### C. 两处测试

- `scripts/db/migrate-application-state.test.ts` 中读取 `server/features/session-store/plugin.ts` 源码文本的守卫，改为行为测试，或在已有行为测试覆盖同一行为时删除并在汇报中说明由哪条测试承担（`server/runtime/product-startup.test.ts` 已有“启动失败先同步写原因与迁移提示”一类用例，先核对）。
- t35 删除了“正式 Product builders 在同一个 esbuild graph 中完成链接与压缩”这条源码文本断言，没有行为级替代。先找有没有自然的产物级检查（例如构建产物或 metafile 中同一源模块只出现一次）；有就补，做不到就在汇报中说明原因，不要写成源码字符串匹配。

### D. 迁移 `server/plugins/` 下的 Nitro 插件

把下面 5 个 Nitro 插件的职责移进产品清单中的内置插件，在插件激活时建立、关闭时撤销，然后删除这些 Nitro 插件文件及只覆盖旧接线的测试：

| 现有插件 | 职责 | 建议去处（可调整，需说明理由） |
|---|---|---|
| `app-logs.ts` | 安装进程级日志桥接：consola reporter、`console.warn`/`console.error` 包装、`unhandledRejection` 与 `uncaughtExceptionMonitor` 处理、`app.logs.ready` 事件；`globalThis` 标志防止热重载重复安装 | `nbook.diagnostics`（见下） |
| `error-logger.ts` | Nitro `error` 钩子：请求失败写 `server.request.error`，清理错误消息中的 query | `nbook.http` 或 `nbook.diagnostics` |
| `boot-config.ts` | 启动时 `loadBootAuthEnabledSync()` 校验并固定 Boot Config | 启动必需插件的激活步骤（例如 `nbook.app-state`）；校验失败即启动失败，写致命诊断并按现有规则以 1 退出 |
| `storage-definitions.ts` | 启动时 `registerProductStorageDefinitions()` | `nbook.storage` 的激活 |
| `server-timing.ts` | Nitro `beforeResponse` 钩子提交 Server-Timing | `nbook.http` |

约束：
- **`nbook.diagnostics` 进入产品清单。** 设计稿 P9 中它取代 Nitro 日志插件与关闭清单中的 app-logger。使用 `runtime/diagnostics` 的现有机制（`createDiagnosticsPlugin` 等，平台中立，不改内核目录），产品侧只提供环境出口与日志桥接。**同一日志目录只能有一个写入者**：产品的 `appLogger`（`AppFileLogger`）仍是产品日志 API，调用点不改；产品诊断出口要经由 `appLogger` 或同一写入器输出，不另开一个指向同一目录的 JSONL 写入者。两者的关系在汇报中写清楚。
- **顺序。** 日志桥接要在其它插件激活前就位，在其它插件全部关闭后才撤销；最后一步刷写日志（`appLogger.flush()`）仍在所有插件关闭之后。用依赖还是别的机制保证，由你设计并说明理由。`smoke:product-lifecycle` 的 L2 从日志里的插件目录推导依赖边，新增依赖不会让它误判，但激活与关闭顺序必须与依赖图一致。
- **Nitro 钩子的归属。** 需要 `nitroApp` 的钩子（`error`、`beforeResponse`）由插件在激活时注册、关闭时注销（`hooks.hook` 返回注销函数）；`nitroApp` 由宿主入口与开发适配器传给 `startProductRuntime()`，CLI 没有 `nitroApp` 时这些钩子不注册。
- **开发模式。** 每个 Nitro worker 有自己的运行实例，桥接随实例安装与撤销，不再依赖 `globalThis` 标志；热重载后不重复写日志（旧实例关闭时撤销）。
- 迁移后 `server/plugins/` 不再有产品启动或关闭职责；目录删空或删除。

## 不做

- `nbook.sqlite`、`nbook.platform-files` 进入产品清单；`nbook.project` 的浏览器部分（留到阶段 2）；
- 把 `appLogger` 的调用点改成诊断服务；Storage 多窗口的 `STORAGE_CONTEXT_INVALID` 403；
- 内核（`runtime/**`）的改动；浏览器端；看门狗。

## 验收场景（写成合同测试，每个场景一个用例，用例名写清场景）

1. smoke 的所选检查中有 `pending` 时以非零退出；全部 `pass` 时以 0 退出。
2. 进程组收到 SIGTERM：包装进程不被第二次信号杀死，等服务进程退出后才退出，最外层退出码等于服务进程的退出码（分别覆盖 0、1、75）。
3. 产品清单激活后，日志桥接已安装；所有插件关闭后桥接被撤销，`appLogger.flush()` 在最后执行。
4. Boot Config 非法时启动失败：写出致命诊断，按现有规则以 1 退出（不依赖 Nitro 插件）。
5. 产品 Storage 状态定义在 `nbook.storage` 激活后可用（浏览器值动作不再以 `STORAGE_STATE_UNREGISTERED` 失败）。
6. 请求失败写 `server.request.error`，消息中的 query 被清理；响应带 Server-Timing（沿用现有测试的断言，换到新的接线上）。
7. 开发模式下实例关闭后再建立新实例，日志桥接只安装一份（`console.error` 不被包两层）。

已有测试保持通过。删除或改写的测试，在汇报中逐个列出它覆盖的行为现在由哪条测试承担。

## 允许改动的文件

- `packages/neuro-book/scripts/smoke/product-lifecycle.ts` 及其测试（只为 A 节的退出码）
- `packages/neuro-book/server/runtime/product-command.ts`、`server/runtime/product-start-command.mjs` 及其测试（只为 B 节）
- `packages/neuro-book/scripts/db/migrate-application-state.test.ts`；仓库根 `scripts/build/**` 下的测试（只为 C 节的产物级检查）
- 仓库根 `scripts/build/product-runtime-islands.ts` 等构建闭包登记（只限迁移导致的不透明导入计数等必须调整的项，逐项说明原因）
- `packages/neuro-book/server/plugins/**`（删除与迁移）、`server/features/**`（新增或修改内置插件，含 `server/features/runtime-diagnostics/`）、`server/runtime/product-startup.ts` 及测试、`server/host/**`、`server/app-logs/**`（只为单一写入者与桥接撤销所需的最小改动）、`server/storage/product-definitions.ts`、`server/config/boot-config.ts`、`server/utils/server-timing.ts`（只在迁移确实需要时改，逐处说明）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t40-phase1-closing/evidences/`

不改：`packages/neuro-book/runtime/**`（内核与平台中立机制）、`app/**`、`scripts/smoke/product-lifecycle/**`（各检查项的判定标准）、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、锁文件、`tsconfig*.json`、`vitest*.config.ts`、`nuxt.config.ts`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。新增文件若按仓库规则需要配套登记，先在汇报中说明。

## 验证命令与完成标准

命令从 worktree 根目录执行，包内命令用 `bun run --cwd packages/neuro-book <脚本>`：

1. 新增与改动的测试，以及 `test -- server/plugins server/features server/runtime server/host server/middleware server/routes server/app-logs server/storage server/config scripts/db scripts/smoke`：全部通过。
2. `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck`：0 错误。
3. `smoke:runtime-foundation` 的 `--host server` 与 `--services`：通过。
4. `smoke:product-lifecycle -- --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-report.json`（L1–L10，含生产构建）：全部通过，报告里没有 `pending`；并核对 L1 收尾的 `dispose-complete` 不再是 `exitCode: 1`。
5. 用临时 State Root 启动一次生产产物，确认日志目录里有 `app.logs.ready`，`console.error` 写入的内容只出现一次。
6. 全量 `bun run test` 由主 Agent 跑，你不用跑。
7. 把第 1–5 步的完整输出保存到证据目录。

本机内存有限：构建、smoke、开发服务与类型检查不要并行跑，一次只跑一个重任务。构建期间不要改动 worktree 中的文件。开发者自己可能开着 `nuxt dev`：用空闲端口，只结束你自己启动的进程，按 pid 结束。等进程退出用 `wait <PID>` 或检查输出里的结束标记，不用 `pgrep -f` 循环。

本次运行有 3 小时上限，到点会被直接截停。**先写 `delivery.md`**（按下面“最终汇报”的结构写设计与改动），验证跑完后再补结果。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项（例如 `package.json` 里的其它 scripts）和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”；
- 不用 `rm -rf` 清理仓库内的目录；误写的文件逐个删除，删除前用 `git ls-files` 确认它们没有被跟踪。写证据的命令从仓库根执行，用仓库根相对路径。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。子代理给出的事实性结论要你自己实测确认后才能写进代码注释或汇报。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码；测试不匹配源码字符串。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–5 各自的结果（附证据文件名），以及 L1–L10 各项结果；B 节两个问题的实测确认结果（修改前的复现证据）；
2. 设计：5 个 Nitro 插件的职责各自去了哪里；`nbook.diagnostics` 在产品中的装配、与 `appLogger` 的关系、单一写入者如何保证；桥接与刷写的顺序如何保证；Nitro 钩子的注册与注销；
3. 公开行为的变化（主 Agent 据此更新 Spec）：包装进程的退出码、smoke 的退出码、日志事件；
4. 删除与改写的测试，以及它们覆盖的行为现由哪条测试承担；
5. 改动的文件列表；
6. 禁止清单逐条自查结果；
7. 遗留问题（不超过 5 条）。
