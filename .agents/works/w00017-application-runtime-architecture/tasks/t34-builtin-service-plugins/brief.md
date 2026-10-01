# 任务说明：产品内置服务迁为插件，关闭顺序由依赖图产生（w00017 t34）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

前两个 Task 已完成内核的入口与服务级依赖（t32，`a2836a53`）、贡献点由拥有者定义（t33，`659c938d`）。现在产品服务端的进程级服务分散在三处：
- `server/runtime/product-startup.ts` 的清单：一个 `agent-session-store` 本地能力、几条门禁（`product-prerequisites`：建 Workspace 目录、State Root 完整性检查、迁移门禁）和 `nbook.files` 插件；
- `server/runtime/shutdown/product-shutdown.ts` 的手写关闭清单：`agent-harness → product-runtime → workspace-file-indexes → storage-host → app-sqlite-checkpoint → app-prisma → app-logger`；
- 各处按需创建的全局单例：`useAgentHarness()`、Prisma 客户端、Storage host、文件索引。

本任务把这些服务的生命周期迁成内置插件，让启动顺序与关闭顺序由插件依赖图产生，并把插件的激活与关闭诊断写进产品日志，使 `smoke:product-lifecycle` 的 L2（激活顺序）以及 L3、L4 的关闭顺序子断言可以判定。

**只迁生命周期，不改访问方式**：各处调用方继续用现有入口（`useAgentHarness()`、Prisma 访问函数、Storage host 函数、文件索引函数），本任务不把它们改成经服务键解析。插件负责创建或就绪检查，以及按依赖逆序释放。

依据：
- `packages/neuro-book/docs/proposals/extensible-application-platform.md` P9 阶段 1 的插件表（`nbook.app-state`、`nbook.session-store`、`nbook.project`、`nbook.storage`、`nbook.agent`（仅生命周期））与 P11；
- `docs/specs/runtime/server-host.md` 停止序列第 2 条（其余插件入口按依赖逆序关闭）；
- `docs/specs/runtime/plugins.md` 输出第 13、14 条（关闭严格按依赖逆序、`activation-started`/`published`/`close-started`/`closed` 诊断）。

先读：`server/runtime/product-startup.ts` 及其测试，`server/runtime/shutdown/`，`server/middleware/00-product-startup.ts`，`server/plugins/project-session-close.ts`，`server/runtime/product-project.ts`（`productProjectOwner` 的使用方），`server/features/workspace-files/plugin.ts`（现有产品插件的写法），`runtime/application/`（`requiredPlugins`、`observers`），`scripts/smoke/product-lifecycle.ts` 的 L2–L4。

## 目标

### A. 内置插件

在 `server/features/<名称>/plugin.ts` 新增下列插件，均只有服务端入口 `server`，全部列入产品清单的 `requiredPlugins`。服务 id 按 t32 规则写成 `<插件 id>/<名称>`。

| 插件 | 激活 | 释放 | 依赖（服务） |
|---|---|---|---|
| `nbook.app-state` | 原 `product-prerequisites` 门禁：建 Workspace 目录、State Root 完整性检查（失败只记警告）、`assertProductMigrationsReady()` | App SQLite checkpoint（库文件不存在时跳过），然后断开 Prisma | 无 |
| `nbook.storage` | 无需立即创建，可只提供就绪标记 | `disposeStorageHost()` | `nbook.app-state` |
| `nbook.session-store` | 原 `agent-session-store` 能力：取得 Session Store 租约，挂接租约失效观察（失效仍调用现有的 `productShutdownController.requestProcessExit(75)`，下一个 Task 改为宿主的停止入口） | 停止 Session Store runtime，释放租约 | `nbook.app-state` |
| `nbook.project` | 建立 Project owner 的根作用域（取代 `productProjectOwner` 现在挂在应用根上的做法，根作用域放在本入口的代次之内） | 先关闭 Project owner 根作用域，再 `closeAllWorkspaceTreeIndexes()` | `nbook.session-store`、`nbook.storage` |
| `nbook.agent` | 仅生命周期：本代次可用期间 `useAgentHarness()` 照常工作 | `disposeAgentHarness()` | `nbook.session-store`、`nbook.project` |

`nbook.files`（已有）照旧登记，并补上它实际需要的依赖。

上表的依赖边来自旧关闭清单的先后关系，逐条核对实际代码：
- 某条边不成立或缺了边，在汇报里说明证据，再按证据调整；
- 旧清单中的每一个“先于”关系，迁移后必须仍由依赖图保证；若某个关系确实不需要，在汇报里说明理由；
- 不得为了排出顺序而添加实际不存在的依赖。

### B. 产品清单与旧入口

- `product-startup.ts` 的清单改为上述插件加 `requiredPlugins`。原 `agent-session-store` 能力、`product-prerequisites` 门禁以及只为启动顺序存在的 `resolve` 门禁删除，不保留第二条路径。
- 启动失败的致命诊断必须保留原来的原因文本，包括迁移未完成时的“请先执行 `bun run migrate:application-state -- --apply`”提示。L5（启动失败退出）必须继续通过。
- `product-shutdown.ts` 的关闭清单只剩 `product-runtime`（`application.stop()`）与 `app-logger`（最后刷写日志）。其余步骤由依赖图负责，从清单中删除。
- `productRuntimeReady()`、启动中间件、`ProductShutdownController`、HTTP 停止路由与 `project-session-close` Nitro 插件本任务不动，由下一个 Task（自有宿主入口与 `nbook.http`）替换。开发模式经同一条中间件路径启动，必须照常可用。
- `productProjectOwner`、`withProductWorkspaceFiles` 等对外函数保持签名不变，只改内部取得 owner 的方式。

### C. 诊断写入产品日志

- 用 `ApplicationManifest.observers.plugins` 把每条插件诊断写进产品现有的 JSONL 日志（`appLogger`），事件名固定，字段只含诊断原有字段：`sequence`、`plugin`、`entry`、`generation`、`stage`、`reason`、`capability`、`contribution`、`error`。
- 启动登记完成后写一条目录记录：每个本位置入口的 `plugin`、`entry`、`dependencies`（服务键名）与 `provides`（服务键名）。smoke 据此推导依赖边，不在 smoke 里硬编码整张图。
- 日志写入失败不得改变运行时行为；观察者内部的异常已由内核隔离，不要另加静默 `catch`。

### D. smoke 判定

修改 `scripts/smoke/product-lifecycle.ts`，让 L2 的 `activation-order` 以及 L3、L4 的 `close-order` 读取产品日志后做出判定，不再固定为 `pending`：
- 从目录记录推导依赖边，边集为空即 `fail`；
- 必须至少包含 `nbook.app-state → nbook.session-store → nbook.project → nbook.agent` 这条链，防止空图或缺插件时误判为通过；
- 激活顺序：每条边的提供方 `published` 早于依赖方 `published`；
- 关闭顺序：每条边的依赖方 `closed` 早于提供方 `closed`，且每个已发布的代次恰好有一条 `close-started` 与一条 `closed`；
- 证据中列出实际的顺序。

L3、L4 的其它子断言（排空期间返回 503、在途下载完成、退出码与租约锁）不在本任务范围，结果照实报告。

## 不做

- 自有服务端入口、`nbook.http`、进程信号与停止通道汇合、退出码调整、排空修复（下一个 Task）；
- 开发模式的热重载与停止问题（#244，之后的 Task）；
- 删除 `productRuntimeReady()`、启动中间件、`ProductShutdownController`（下一个 Task）；
- 把调用方改成经服务键取得服务；
- `nbook.diagnostics` 取代 `appLogger`，以及 `nbook.sqlite`、`nbook.platform-files` 进入产品清单（它们在产品中还没有消费者）；
- `server/plugins/` 下其它 Nitro 插件的迁移。

## 验收场景（写成合同测试，每个场景一个用例，用例名写清场景）

1. 产品清单登记后，目录中五个新插件与 `nbook.files` 都为 `available`，依赖边与 A 节一致（含你按证据调整后的结果）。
2. 激活顺序：依赖先于依赖者发布；迁移门禁失败时 `nbook.session-store` 不激活、不取得租约，启动失败的原因文本保留。
3. 关闭顺序：应用停止后释放顺序满足旧清单的全部先后关系；`closed` 诊断按依赖逆序。
4. Project owner 在 `nbook.project` 可用之前调用时报 `ProductRuntimeNotReadyError`；关闭后不再创建。
5. Project owner 根作用域关闭失败时，Session Store 租约不释放；显式恢复完成后才释放（沿用现有用例的意图）。
6. 任一插件释放抛错不跳过其余插件的释放，停止结果为关闭未完成。
7. 租约失效仍以退出码 75 请求退出（现有用例保持通过）。
8. 诊断观察者把插件诊断与目录记录写入日志，字段只含 C 节列出的字段。

`product-startup.test.ts` 的已有用例保持通过；因清单结构变化必须改写的用例，保持原有断言的意图与强度，在汇报中逐个列出。

## 允许改动的文件

- 新增 `packages/neuro-book/server/features/{app-state,storage,session-store,project,agent}/` 下的插件与测试；`server/features/workspace-files/plugin.ts`（只补依赖）
- `packages/neuro-book/server/runtime/product-startup.ts` 及其测试、`server/runtime/product-project.ts`（只改取得 Project owner 的方式）
- `packages/neuro-book/server/runtime/shutdown/product-shutdown.ts` 及其测试
- `packages/neuro-book/scripts/smoke/product-lifecycle.ts` 与 `scripts/smoke/product-lifecycle/**`
- 被上述改动直接牵连的测试文件（先在汇报中说明原因）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/`

不改：`runtime/**`（内核）、`server/agent/**`、`server/storage/**`、`server/database/**`、`server/workspace-files/**` 的实现（只允许调用它们已有的导出函数）、`server/middleware/**`、`server/plugins/**`、`server/routes/**`、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、`tsconfig*.json`、`vitest*.config.ts`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

在 `packages/neuro-book` 下：

1. 新增与改动的测试文件，以及 `bun run test server/runtime server/features`：全部通过。
2. `bun run typecheck:runtime-foundation`、`bun run scripts:typecheck`、`bun run typecheck`：0 错误。
3. `bun run smoke:product-lifecycle -- --only L1,L2,L3,L4,L5,L6 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-report.json`（含生产构建，约 3 分钟）：L1、L2、L5、L6 为 pass；L3、L4 的 `close-order` 为 pass，其余子断言照实报告。
4. 全量 `bun run test` 不需要你跑，由主 Agent 跑。
5. 把第 1–3 步的完整输出保存到证据目录（`test-targeted.txt`、`typecheck.txt`、`smoke-product-lifecycle.txt` 与报告 JSON）。

本机内存有限：构建、smoke 与类型检查不要并行跑，一次只跑一个重任务。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

1. 结论：完成标准 1–3 各自的结果（附证据文件名），以及 smoke 各检查项与子断言的结果；
2. 依赖图：最终的插件依赖边，每条边的代码依据；与 A 节不同之处及理由；旧关闭清单的每个先后关系由哪条边保证；
3. 公开行为的变化：清单结构、启动失败报告、日志事件名与字段（主 Agent 据此更新 Spec）；
4. 改写了哪些已有测试及理由；
5. 改动的文件列表；
6. 禁止清单逐条自查结果；
7. 下一个 Task（自有入口与 `nbook.http`）需要注意的问题（不超过 5 条）。
