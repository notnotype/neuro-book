# GOAL-B：数据面守卫接线与测试迁移（派发给独立实现 agent 的自包含任务书）

> 本文档面向对本仓库上下文有限的实现者，所有必要概念都写在文内。**前置条件：GOAL-A 已合入**——`server/workspace-files/` 下存在 ProjectSession 模块（`project-resources.ts` 或 `project-session.ts`），导出 `openProject / assertProjectOpen / ProjectNotOpenError` 等；**以已落地代码为契约真相源**，本文签名描述与代码不一致时以代码为准并在 NOTES 记录。

## 一句话目标

把「数据面 API 必须先 open 项目」的守卫接进全部资源/文件咽喉，把每次调用重复执行的数据库迁移收敛到 open 时一次，并迁移全部受影响的存量测试——验收 = 全仓 typecheck 全绿 + 受影响测试套件全绿 + 每个咽喉有"未 open → 报错"的守卫测试 + 控制面路由无 open 仍可用。

## 背景（两分钟读懂模型）

NeuroBook 是小说写作 IDE（Nuxt/Nitro 单服务进程，Windows 上以 bun 运行）。项目（Project Workspace）是 `workspace/<slug>` 目录，内含 markdown 正文与 `.nbook/project.sqlite`。曾经所有 API 无状态按 projectPath 惰性开资源，导致 sqlite/watcher 句柄泄漏。GOAL-A 已建立**显式生命周期**：前端进入项目视图、agent 会话开跑、后台任务这三类 opener 调 `openProject()`；presence 归零经宽限期自动 close。**严格模式**：数据面操作在未 open 时必须失败（`ProjectNotOpenError` → HTTP 409, code `PROJECT_NOT_OPEN`），**不允许**任何隐式补开。**控制面豁免**：项目列表、统计、manifest 读、创建、删除、zip 导入不需要 open。

projectPath 一律为 `workspace/<slug>` 正斜杠相对形（`normalizeProjectPath` 是权威）。

## 改造清单（逐项，文件与函数精确到名）

### 1. 资源咽喉守卫（在取资源入口调 `assertProjectOpen(normalizedProjectPath)`）

| 文件 | 函数 | 备注 |
|---|---|---|
| `server/plot/facade/plot.facade.ts` | `private client()` | **只动这个函数附近**（并行任务在改同文件其他区域，见约束） |
| `server/world-engine/world-engine.facade.ts` | `private createClientEntry()` | |
| `server/agent/tools/sql-tool.ts` | `useSqliteClient()` | |
| `server/workspace-files/project-workspace-index.ts` | `ensureIndexEntry()` | **仅当** workspaceKind 为 project-workspace 且 rootInput 匹配 `^workspace/[^/]+$` 时守卫；user-assets 与 Workspace Root 照常放行。顺带完成审查项 7：把只有一处调用的 `touchProjectResourcesForRootInput` 内联，并复用函数内已计算的 normalizeRootInput / kind 值（现状重复计算 2 次） |

### 2. 文件面路由守卫（**路由层，不进共享 fs 函数**）

`server/api/workspace-files/` 下这些**数据面**路由，在解析出 root 后、执行操作前守卫（写一个共享 helper `assertProjectOpenForRoot(rootInput)`：root 匹配 `^workspace/[^/]+$` 才检查，其余放行）：
`read.get`、`write.put`、`create-file.post`、`create-directory.post`、`delete.delete`、`rename.patch`、`convert-file-to-directory.post`、`stat.get`、`download.get`、`upload-file.post`、`tree.get`、`events.get`。

**为什么不放进 `writeWorkspaceTextFile` 等共享函数**：控制面创建流（`upload-project.post` 导入 zip、项目脚手架）复用这些函数写"尚未 open 的新项目"，函数级守卫会误伤——这是设计定案，不要改成函数级。

另：`server/api/config/project.put`（项目级配置写）按数据面守卫（已定案）。

### 3. initProjectDatabase 收敛（性能修复，随守卫一起做）

现状：`plot.facade.ts client()`、`world-engine.facade.ts createClientEntry()`、`sql-tool.ts useSqliteClient()` **每次调用**都 `await initProjectDatabase(...)`——即每次 API 调用都开临时连接全量跑几十条 DDL + 迁移检查。GOAL-A 后 `openProject` 已在 open 时跑一次。本任务删除这三处 per-call 调用（守卫保证了 open 必先发生）。`server/utils/novel-chapter.ts` 的 `readPlotCounts` 是控制面直读，**不含 init、不加守卫、不要动**。

### 4. 存量测试迁移

新建共享测试 helper（放 `server/workspace-files/` 或现有 test-utils 位置）：`openProjectForTest(projectPath)`（内部 `openProject(p, {kind:"job", source:"test"})`）与 `closeProjectForTest(projectPath)`。逐个修复因守卫而红的测试文件——已知受影响（以实际跑挂为准，不止这些）：`world-engine.facade.test.ts`、`codeact.test.ts`、`sql-tool.test.ts`、`project-workspace-delete.test.ts`、`server/api/projects/plot/[...segments].test.ts`、`server/api/projects/world-engine/[...segments].test.ts`、`world-engine-tools.test.ts`、plot 服务相关测试。模式：beforeAll/测试开头 open，finally/afterAll close。**不许为了让测试过而放宽守卫**。

### 5. 新增守卫与豁免测试

- 每类咽喉至少一条："未 open 调用 → 抛 `ProjectNotOpenError` / HTTP 409 code PROJECT_NOT_OPEN"（facade 层直测 + workspace-files 路由挑 read/write 两条测）。
- 控制面回归："未 open 时 `GET /api/projects`（列表统计）与项目创建/删除仍工作"。
- open 后正常路径回归由存量测试迁移覆盖。

## 验收标准

1. `bun run typecheck` 全绿（0 error）。
2. `bun run test server/workspace-files server/plot server/world-engine server/agent/tools server/api/projects` 全绿。
3. grep 审计无残留：facades 内无 per-call `initProjectDatabase`；数据面清单内路由全部有守卫调用。
4. `NOTES-B.md`（放本目录）：逐条记录实现中发现的契约疑点、清单外必须动的文件（先停下记录再动）、与本文档的任何偏差。

## 约束（全程不得违反）

- 遵守仓库 `CLAUDE.md`：4 空格缩进；中文注释、函数必须有注释；不用 any/unknown/Record<string,unknown>（确需时注释原因）；不要过度设计、单处逻辑不抽函数；遇到设计问题不 hack——停下记录 NOTES-B 并报告。
- 执行 bun 命令需在沙盒外提权。
- **并行任务隔离（重要）**：仓库内另有进行中的任务在改 `server/agent/harness/*`、`server/agent/profiles/*`、`server/agent/tools/apply-patch*`、`prisma/`、`server/plot`（规划层新增实体）——**严禁修改上述文件**，`plot.facade.ts` 只允许改 `client()` 函数及其 import；发现冲突停下报告。
- 不改 ProjectSession 模块本身（契约由 GOAL-A 固定）；发现契约缺口记录 NOTES-B，不自行扩 API。
- 不做前端改动、不做 nb-history 相关改动。

## 受阻停止条件

守卫接入后若出现"必须 open 但找不到合法 opener"的真实调用链（例如某控制面路径实际依赖数据面咽喉），停止并报告：调用链证据、你认为它属于控制面还是数据面、建议的处置（豁免 or 由某 opener 补 open），等待派发方决定。
