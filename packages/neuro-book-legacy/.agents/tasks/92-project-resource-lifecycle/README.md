# Project 资源生命周期统一管理（Project Resource Lifecycle）

## Relative documents refs

- [Task 91 操作日志系统](../91-operation-log-file-history/README.md)：本任务的直接诱因之一——nb-history 集成分析发现"宿主没有项目打开/关闭生命周期管理器"；nb-history 集成时应把 `WorkspaceHistory` 注册为本注册表的资源属主。
- [Task 75 Round 06 SQLite 句柄清理](../75-world-engine-api-calendar-embedding-cleanup/walkthroughs/2026-06-29-round-06-sqlite-handle-cleanup.md)：前作——`collectReleasedSqliteHandles`（Bun/Node 双运行时 GC 协助）与 `TrackedPrismaLibSql` 由该轮建立，本任务直接复用。
- [Task 21 Project Workspace Index Watcher](../21-project-workspace-index-watcher/README.md)：tree index watcher 的来源，本任务把它纳入统一生命周期。
- [reference/workspace/TERMS.md](../../../reference/workspace/TERMS.md)：Project Workspace / Workspace Root 术语。
- [Task 125 Round 04](../125-runtime-artifact-storage-lifecycle/walkthroughs/round-04-workspace-test-isolation.md)：测试调用方复用正式 Project Session 关闭语义，但所有可写 Project fixture 均由独立临时 Workspace Root 持有，避免并行 suite 共享本任务管理的资源与锁。

## User Request / Topic

用户在 Task 91 集成可行性分析后指出："打开/关闭项目"生命周期管理器可以做——现在这一部分很混乱，**切换项目或删除项目时会出现 sqlite 等资源未关闭的 bug**。指令：调研一下，顺便做了。

## Goal

把散落在各模块的 Project 级资源关闭逻辑收敛为统一的生命周期注册表：删除 Project、切换 Project（空闲）、服务关停三条路径都能确定性地释放 SQLite 客户端与文件 watcher 句柄；新增资源种类（如将来的 nb-history）只需自注册，不再依赖"记得去删除流程补一行"。验证面：注册表单元测试 + 既有删除流程集成测试全绿 + 全仓 typecheck 全绿。

## Current State

- **已实现并验证**。统一注册表 `server/workspace-files/project-resources.ts` 上线，四个既有资源属主全部接入，删除流程改为消费注册表，新增服务关停钩子与空闲清扫。
- 调研结论（改动依据）：
  - 删除流程 `deleteProjectWorkspace` 过去**手工枚举**四个关闭调用（plot facade / world engine / agent sql client / tree index）——每加一种资源都要记得来补一行，漏了就是句柄泄漏；
  - **切换项目没有任何关闭动作**：Plot 的 Project PrismaClient 按项目无限累积（`plot.facade.ts` 的 clients Map）、旧项目的 chokidar watcher 永久持有目录句柄（Windows 下外部删除该目录会 EBUSY）；
  - **服务关停/dev 重启没有清理钩子**（`server/plugins/` 里只有 server-timing 与 error-logger）；
  - Windows 删除目录的墓碑机制（改名到 `.nbook/deleted-projects` + 后台 PowerShell 清理 + `deleted-project.json` 标记）本身就是"句柄关不干净"的绕行产物，保留作为兜底。

## Decisions / Discussion

| # | 决策 |
|---|---|
| D1 | **属主自注册倒置依赖**：各模块加载时向注册表注册 `{name, close, closeAll?, busy?}`；模块没被加载 ⇒ 它必然没打开过资源，天然自洽。删除流程从"知道所有资源"变成"只调注册表"。 |
| D2 | **切换项目 = 空闲清扫而非显式事件**：服务端是无状态项目模型（请求携带 projectPath，没有"当前项目"概念），前端切换无从通知。改为访问时报活（touch）+ 定时清扫（TTL 10 分钟，60s 一轮，timer unref）；**SSE 订阅在线视为 busy**（tree index 的 subscribers>0），跳过并刷新报活——用户正开着的项目不会被误关，后台项目闲置后自动释放。所有资源都支持惰性重开，误关只付出一次重建成本。 |
| D3 | **键形态 = `workspace/<slug>` 相对 projectPath**，各属主用自己既有的解析逻辑落到实际句柄键（plot 用 db 绝对路径、index 用 `resolveWorkspaceRoot`）。注册表不引入新的路径解析，避免 `resolveWorkspaceContainerRoot`（向上找 workspace 目录）与 cwd 锚定两套解析的分歧扩散。 |
| D4 | **失败容错**：单属主 close 失败只告警不阻断其余属主（删除流程本就有墓碑兜底）；busy 探测异常按不忙处理。每轮 close 收尾统一 `collectReleasedSqliteHandles({force: true})`。 |
| D5 | **World Engine 保留注册**：它按次开关不持久缓存（Task 75 整改后），close 只是 GC 兜底——保留注册以维持删除流程原有语义。 |
| D6 | 本轮**不动**：会话归档顺序（删除后归档，测试固化了该顺序）；Workspace Root 层资源（profile source watcher、user-assets index、app Prisma）只在 closeAll（关停）路径顺带覆盖，不参与按项目关闭与空闲清扫。 |

## Verification / Test

- 新增 `server/workspace-files/project-resources.test.ts` 4 用例：close 全属主容错、空闲清扫（未超时保留 / 超时关闭 / busy 跳过并刷新报活 / busy 解除后按刷新时间起算）、closeAll 优先走属主 closeAll 且清空报活、同名重复注册按替换。
- 既有 `project-workspace-delete.test.ts` 3 用例不改而过（删除前关闭四类资源、归档失败仍完成删除、归档绑定 sessions）——证明注册表等价替换了手工枚举。
- 回归 sweep：`server/workspace-files` + `server/world-engine/world-engine.facade.test.ts` + `server/agent/tools/sql-tool.test.ts` + `server/plot` + `server/low-code-form` = **23 文件 / 188 测试全绿**（第一轮曾有 1 个 `beforeAll(createIsolatedWorkspaceAssets)` 瞬态超时，复跑未复现，其余轮次稳定）。
- `bun run typecheck` 全绿。注：修了一个**既有**类型错误 `server/low-code-form/index.ts:798`（昨日提交带入，索引访问无法被 `Object.hasOwn` 收窄；改为按 `!== undefined` 收窄，JSON 值语义等价且更安全——原写法在显式 undefined 时会把 undefined 写进 LowCodeJsonObject）。

## Implementation Walkthrough

- **新增** `server/workspace-files/project-resources.ts`：`ProjectResourceOwner` 契约 + `registerProjectResourceOwner` / `touchProjectResources` / `closeProjectResources` / `closeAllProjectResources` / `sweepIdleProjectResources(now?)`（now 可注入供测试）/ `resetProjectResourcesForTest`；TTL 10min、清扫 60s、timer `unref`。
- **接入四个属主**：
  - `project-workspace-index.ts`：注册 `workspace-tree-index`（close 按 projectPath、closeAll 遍历 indexEntries、busy = subscribers>0）；`ensureIndexEntry` 对 `workspace/<slug>` 形 rootInput 报活（user-assets 与绝对路径入参不参与清扫）。
  - `plot/index.ts` 注册 `plot-facade`；`plot.facade.ts` 新增 `closeAllProjects()`，`client()` 报活。
  - `world-engine/index.ts` 注册 `world-engine-facade`；facade `createClientEntry` 报活。
  - `sql-tool.ts` 注册 `agent-sql-client`（close 带 projectPath 精确关、closeAll 无条件关单槽）；`useSqliteClient` 报活。
- **删除流程收口**：`project-workspace-delete.ts` 的四行手工枚举 → `closeProjectResources(normalizedProjectPath)`，并删掉对 plot/world-engine/sql-tool/index 四个模块的直接 import（删除路由不再耦合资源模块）。
- **新增** `server/plugins/project-resources-close.ts`：nitro `close` hook → `closeAllProjectResources()`。
- 与计划的出入：无结构性出入；额外顺手修复既有 low-code-form 类型错误（见 Verification）。

## TODO / Follow-ups

- **[Task 91 集成时]** nb-history 的 `WorkspaceHistory`（含 history.sqlite 双连接）注册为资源属主：`close = history.close()`，busy 可复用其内部队列状态；这是本注册表设计时预留的第一个新属主。
- 空闲 TTL 目前是常量（10 分钟）；若实际使用中需要调节再接 `CONFIG_REGISTRY`（`global-workspace` scope），当前不预先做配置面。
- Workspace Root 层资源（profile source watcher、user-assets watcher、app Prisma client）尚无统一关停清单——nitro close hook 目前只覆盖 Project 级；若 dev 重启句柄问题再现，可把这些也注册为"无 projectPath 键"的属主（closeAll-only）。
- 删除流程的会话处置仍是"归档不打断"：运行中 agent 的 bash 子进程若 cwd 在被删项目内，Windows 移动墓碑仍可能失败（现有 marker 兜底路径覆盖）。如需"删除前主动终止该项目运行中会话"，单列任务。
