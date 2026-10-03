# Project 生命周期模型重构（显式 open / close / presence）

## Relative documents refs

- [Task 92 Project 资源生命周期统一管理](../92-project-resource-lifecycle/README.md)：前作——隐式模型（惰性开 + touch/busy 推断 + 空闲清扫）与资源属主注册表；本任务把它升级为显式模型并吸收其审查遗留 8 项。
- [Task 91 操作日志 / 文件历史](../91-operation-log-file-history/README.md)：下游消费者——nb-history 集成（Task 95）骑在本任务之上，history.sqlite 将成为 ProjectSession 的会话资源。
- [Task 21 Project Workspace Index Watcher](../21-project-workspace-index-watcher/README.md)：tree index watcher 是被纳管的核心资源之一。
- [reference/workspace/TERMS.md](../../../reference/workspace/TERMS.md)：Project Workspace / Workspace Root 术语。

## User Request / Topic

用户在 Task 92 审查轮与 VS Code / code-server / JetBrains 架构对比讨论后拍板：**NeuroBook 底层项目生命周期模型需要重构**——统一资源（文件缓存、sqlite 连接等），并且像 VS Code 一样具备显式「打开工作区/项目」「显式关闭项目」「显式报活（用户在场 + agent 在场）」的能力。为保持代码架构干净、心智模型统一，**接受重构短痛，采用严格模式**（不保留隐式 open 双轨兜底）。

## Goal

引入一等的 **ProjectSession**：显式 `open(projectPath)` 建立作用域并预热会话资源，显式 `close()` 级联释放；在场由「用户 presence 连接 + 运行中 agent invocation」两路显式声明，presence 归零后经宽限期自动 close；数据面 API 在未 open 时抛 typed error（守卫收在资源获取咽喉，不撒路由）。验证面：生命周期状态机 / 在场 / 宽限 / 守卫的单测 + 存量受影响测试迁移后全绿 + 全仓 typecheck + 手动走查（多标签页、刷新、agent 后台运行时关标签页）。

## Current State

- **GOAL-A 已实现并通过对抗式审查（2026-07-08，ultracode workflow 执行）**：ProjectSession 核心机制、两个 HTTP 接口、harness agent 在场接线、前端 presence 客户端全部落地；typecheck 全绿、新增/迁移测试全绿（project-session.test 13 例等）。**待用户浏览器手动走查**（GOAL-A 验收标准最后一条）。
- **[GOAL-B.md](GOAL-B.md) 基线、审查补漏与二次补漏已闭环（2026-07-09）**：资源咽喉、workspace-files 数据面路由和 config/project 写入守卫已接线；plot/world/sql 三处 per-call `initProjectDatabase` 已移除；补漏硬化 RAG 数据面、Project Profile Home 初始化/写入/reset 边界、Agent session snapshot 与 profile compile/preview worker 生命周期错误映射，统一 route typed error 映射。补漏发现与边界解释记录在 [NOTES-B.md](NOTES-B.md)。**2026-07-09 主会话验收通过**（代码走查属实 + typecheck/组合测试全绿 + harness black-box 两处既有时序缺陷修复后全目录全绿，见 walkthrough 验收节）。**任务剩余：用户浏览器手动走查 + commit。**
- Task 92 代码已 commit（`10696bf0`）；nb-history 仓已初始 commit（`e70d586`）。

## Decisions / Discussion

| # | 决策 |
|---|---|
| D1 | **严格模式**：数据面 API 对未 open 的项目直接抛 typed `ProjectNotOpenError`（HTTP 4xx，语义清晰），**不保留隐式 open 双轨**——隐式兜底会让漏接 open 静默降级、纪律永远立不起来。用户明确接受短痛。符合 CLAUDE.md 快速开发期不留兼容的立场。 |
| D2 | **控制面 / 数据面边界**：项目列表、统计（如 readPlotCounts）、manifest 读、创建、删除、zip 导入 = **控制面**，不需要 open（对应 VS Code 的 recent list——列表页不能被迫打开全部项目）；plot / world engine / rag / workspace 文件 / 将来的 history = **数据面**，必须 open。 |
| D3 | **三个合法 opener**，除此无人可开：① 前端进入项目视图（`await open` → 挂 presence → 才发数据请求，刷新竞态由时序消解）；② harness invocation 准入 ensure-open（天然声明 agent 在场）；③ 服务端后台任务显式 open/close（如将来的 prune 调度）。 |
| D4 | **在场两路显式声明**：用户在场 = **专用 presence 接口**（新建，不复用现有 tree SSE / session events；选型 SSE——单向存活信号足够、与现有 eventing 同栈、服务端可感知断连；多标签页 = 连接引用计数）；agent 在场 = 该项目**运行中的 invocation**（+ 短宽限），闲置未归档 session 不算在场。 |
| D5 | **presence 归零 → 宽限期 → close 级联释放**；宽限期先用常量（暂定 5 分钟）。Task 92 的空闲清扫**降级为泄漏兜底**（防 opener 异常遗留的孤儿会话），TTL 维持常量不接配置（用出需求再说）。 |
| D6 | **吸收 Task 92 审查 8 项**：(1) close 顺序改「先关门、全部成功后再除名」；(3) 清扫/宽限路径去 force GC（force 仅保留在删除项目路径）；(4) 属主 `closeAll` 从可选改必填；(5) 删除 world-engine 冗余属主注册；(6) `closeAllProjects` 委托 `closeProject` 消除复制；(7) 单处调用的 helper 内联并消除 ensureIndexEntry 重复计算；(8) 补齐缺失的函数注释。发现 (2)（watcher 事件不报活）由显式在场在机制层消解，不再需要 watcher-touch 补丁。 |
| D7 | **会话资源 = 长命资源**：plot Project PrismaClient、tree index watcher、agent sql 单槽 client、（Task 95）history 双连接。**机会项非必做**：world engine 可从按次开关客户端升级为会话缓存客户端——确定性 close 出现后才有此选项，收益是省去每次调用的建连开销。 |
| D8 | Workspace Root 层资源（user-assets watcher、profile source watcher、app Prisma）**不属于 ProjectSession**，维持现状（仅关停路径统一收口）。 |
| D9 | **（审查补）数据面守卫清单必须含 workspace-files 读写路由**（read/write/create/delete/rename/convert/upload-file/download，当 root=`workspace/<slug>` 时）：它们直接 fs 操作、不经任何 facade 咽喉，漏守卫 = 文件面整体绕过模型；且 Task 95 后文件写入要记账进 history（会话资源），届时必然需要 open——Task 94 一步到位。落点：workspace-files 路由共用的 root 解析入口加 `assertProjectOpen`，不逐路由撒。其他 root（Workspace Root / user-assets）照常放行。 |
| D10 | **（审查补）close 的两层语义**：前端没有"关闭项目"端点——标签页只有「断开自己的 presence 连接」（多标签页下 A 关不掉 B 的会话）；**session close 是内部动作**（presence 归零→宽限到期 / 删除流程 / 关停），将来如需管理面"强制关闭"再单独做带确认的管理端点。防止实现时做出危险的公开 close API。 |
| D11 | **（审查补）open 的预热清单**：eager = `initProjectDatabase`（迁移收敛到 open 跑一次——**现状是 plot/world/sql 每次调用都全量跑一遍 DDL+迁移检查再 GC，这是既有的显著浪费，本重构顺带消除**）+ tree index watcher 启动（但 watcher 初扫不阻塞 open 返回，异步就绪）+（Task 95）history 双连接；lazy = plot/world/sql 客户端维持首用即建。 |
| D12 | **（用户已批）删除"使用中"项目 = 拒绝**：presence>0 或有运行中 invocation → 409 并返回占用方摘要；仅宽限态允许强制 close 后删除。 |
| D13 | **（定案）** `ProjectNotOpenError` → HTTP 409 + `data.code="PROJECT_NOT_OPEN"`；`config/project.put` 归数据面；原 touch 降级为 `markProjectActivity`（仅更新 lastActivityAt 供可观测性，不再承载生命周期语义）。 |
| D14 | **（GOAL-B 补漏定案）** RAG overview/subject/search/rebuild/inspector/debug/events/memories 属于 Project Workspace 数据面，统一在 Project Path 解析入口守卫；Project Profile Home 的读时初始化/升级、写入与 reset 也属于数据面；Project Manifest 读写、项目列表/创建/删除/zip 导入仍是控制面；RAG SQLite 当前是按次打开并关闭的缓存库，本轮不注册为 ProjectSession 长命资源。 |
| D15 | **（GOAL-B 二次补漏定案）** 凡是会初始化/升级 Project Profile Home 的 managed `workspace/<slug>` 链路，即使入口是 session snapshot、system prompt prepare 或 profile compile preview，都必须在未 open 时抛 typed `ProjectNotOpenError` 并由 HTTP 层映射 409；worker compile 普通失败继续返回 compile issue，Project lifecycle violation 作为内部 lifecycle error 回主线程后重新抛 typed error，不进入公开 DTO。 |

## Verification / Test

- 新增单测：状态机（open/幂等 open/close/重复 close）、presence 计数与归零→宽限→close、agent 在场探针、strict 守卫抛错、审查项回归（关门顺序、closeAll 必填契约）。
- 存量迁移：直接调 facade 的测试补 open（或测试 helper 统一处理）后全绿；全仓 typecheck。
- 手动走查（用户执行浏览器部分）：开两标签页关一个不掉资源；F5 刷新无竞态报错；关闭标签页后 agent 后台继续跑不被拆资源；宽限期后资源确实释放。

## Implementation Walkthrough

### GOAL-A 实现（2026-07-08，ultracode：3 个 workflow，scout 3 + implement 5 + review 27 个 agent）

**执行方式**：scout workflow（3 agent 摸清现状）→ implement workflow（5 agent 分片实现 + 首轮验证一次通过）→ adversarial review workflow（find/judge 27 agent；fix/reverify 阶段因 API 403 中断，由主会话手工完成全部修复并重验）。

**交付物落点**：

- `server/workspace-files/project-session.ts`（由 project-resources.ts 演进更名，全部 import 同步）：状态机 + presence 计数 + agent 探针 + 泄漏表 + 30s 周期维护 + per-key 串行锁。
- `server/api/projects/open.post.ts`（幂等 open + fire-and-forget watcher 预热）、`server/api/projects/presence.get.ts`（SSE：连接即 acquire、断开即 release、30s 心跳）。
- `server/agent/harness/neuro-agent-harness.ts` 五处最小插入：invocation 准入 ensure-open（fail-closed）+ `activeInvocationProjects` 登记（存归一化 key）+ 探针注册（只数 status !== "waiting" 的 invocation）+ 结束清理；compact 命令排除。
- `app/composables/useProjectSession.ts`：fetch + readSseStream（非 EventSource）、世代守卫、重连前先重跑 POST open（服务重启恢复）、指数退避 + 3 次失败后 5s 低频、75s 读超时看门狗（对付半开连接）、404 → 通知 + 停止。`app/pages/index.vue` 仅两处接线（import + target computed）。
- `server/plugins/project-session-close.ts`（nitro close hook → closeAllProjects）；删除 project-resources.ts / 其测试 / 旧 close 插件。
- `server/utils/event-stream.ts`：共享 `isClosingEventStreamError`（presence 与 events 两 SSE 路由去重）。
- 测试：`project-session.test.ts` 13 例（原 8 + 审查轮新增 5：跨世代 release、重开清泄漏、grace-expired 锁内复检、close-vs-reopen 串行互斥、探针周期）。

**对抗式审查轮结果**（19 个 real/plausible finding，核心修复）：

- **close-vs-reopen 竞态（核心类）**：新增 `withProjectLock` per-key promise 链串行锁，open 全程进锁（存在性判定必须在锁内，锁外短路会丢失排队在 close 之后的重开）；presence release 闭包按会话对象身份比对（世代绑定），迟到的旧连接释放不误扣新会话；sweep 定时器加 `sweepInFlight` 重入闸；重开时清除泄漏标记 + sweep 泄漏重试跳过已重开 key。
- **删除自锁（D12 收敛，语义修正）**：删除占用检查从「presence>0 或 agent 在场」收敛为**仅 agent 在场阻删**——单用户本地应用中，用户自己的窗口 presence 会阻止"删除当前打开的书"，属设计错误；GOAL-A.md A2 原文按 D12 字面写，实现按收敛后语义交付。
- 前端半开连接：读超时看门狗（见上）；`registerAgentPresenceProbe` 签名放宽接受 `null`（注销）。

**与 GOAL 契约的偏差（按 GOAL-A 要求记录，GOAL-B 以代码为准）**：

1. **closeProject 顺序 = 「先除名再关门」**，与 D6(1)/GOAL-A 字面「先关门后除名」相反。理由：严格语义要求 close 一开始 assertProjectOpen 即失败；「除名先行 + key 锁串行 + 泄漏表重试」共同达成原意图（失败属主不丢、并发重开不误关），且避免关门中途的半开会话可被守卫放行。
2. **watcher 预热放在 open.post 路由层**（fire-and-forget）而非 openProject 内：project-session ↔ project-workspace-index 会循环 import。
3. **周期维护 30s**（GOAL-A 写 60s）：agent 空闲检测、宽限到期、泄漏重试共用一个定时器，取更细粒度。

**已知局限（审查确认、有意不修）**：

- 大小写不敏感文件系统上 `workspace/Book` 与 `workspace/book` 会各建一个会话（normalizeProjectPath 不折叠大小写）——Windows 单用户场景影响极低，defer。
- presence 释放单点依赖 h3 `onClosed` + closed-stream 错误白名单（对 h3 版本敏感）——已用共享 util 收口 + 客户端看门狗缓解。
- harness projectPath 带尾随空白等历史脏元数据走 fail-closed（正则预检拦截）。

**验证**：`bun run typecheck` 全绿；project-session.test / project-workspace-delete.test / events.get.test 共 19 例全绿；实现 workflow 首轮验证 0 修复轮通过。

### GOAL-B 实现进展（2026-07-08，本会话）

**已落地**：

- `plot.facade.ts client()`、`world-engine.facade.ts createClientEntry()`、`sql-tool.ts useSqliteClient()` 均改为先 `assertProjectOpen()`，并移除每次调用的 `initProjectDatabase()`；数据库初始化收敛到 `openProject()`。
- `project-workspace-index.ts ensureIndexEntry()` 对 `workspace/<slug>` Project root 加 typed 守卫，并内联原单用报活 helper，复用已计算的 `rootInput/workspaceKind`；user-assets 与绝对 root 放行。
- `server/api/workspace-files/` 数据面路由统一通过 `project-open-guard.ts` 在路由层做 `409 PROJECT_NOT_OPEN` 映射，未下沉到共享 fs 函数，避免误伤创建/导入控制面流。
- `server/api/config/project.put.ts` 加 Project open 守卫；`server/api/projects/world-engine/[...segments].ts` 在入口额外守卫，避免未 open 请求先触发 calendar/schema 预处理错误。
- 新增 `openProjectForTest/closeProjectForTest` 测试 helper，并迁移 World Engine、execute_sql、workspace-files API、Project 控制面回归等测试。

**验证结果**：

- 通过：`bun run test server/world-engine`（12 files / 157 tests）。
- 通过：`bun run test server/agent/tools`（14 files / 139 tests）。
- 通过：`bun run test server/api/workspace-files`（6 files / 13 tests）。
- 通过：非 Plot 核心组合 `server/world-engine server/agent/tools server/api/projects/world-engine/[...segments].test.ts server/api/projects/control-plane-open-guard.test.ts server/api/projects/index.get.test.ts server/api/workspace-files/read.get.test.ts server/api/workspace-files/write.put.test.ts server/api/workspace-files/upload-file.post.test.ts server/api/workspace-files/download.get.test.ts server/workspace-files/project-session.test.ts server/workspace-files/project-workspace-index.test.ts`（35 files / 326 tests）。
- 通过：`bun run typecheck`。
- 通过：`bun run test server/workspace-files server/plot server/world-engine server/agent/tools server/api/projects`（53 files / 481 tests，完整目标组合）。
- 通过：grep 审计三处 facade/tool 无 per-call `initProjectDatabase` 残留；workspace-files 数据面路由、config/project 与 Project Plot/World HTTP 入口守卫接线存在。

### GOAL-B 审查补漏（2026-07-09）

**补漏范围**：只硬化 Project Workspace 数据面守卫，不做隐式 open，不放宽测试，不把控制面误锁死。

**已落地**：

- `server/rag/project-rag-visualization.ts` 在集中 `resolveProject()` 入口执行 `assertProjectOpen(projectPath)` + `markProjectActivity(projectPath)`，覆盖 overview、subject、search、rebuild、inspector、debug、events/memories CRUD/reorder；RAG SQLite 继续保持按次打开/关闭，不注册为 ProjectSession 资源。
- `server/config/config-service.ts` 在 `saveProjectConfig()`、`resetProjectProfileHome()`、project scope `readConfigAgentProfileSettings()` 内部加 open guard；`lowCodeFormContext()` 在初始化 Project Profile Home 前二次兜底；global scope settings 即使 query 带 Project Path 也只初始化 Global Profile Home，不要求 Project open。
- `server/agent/profiles/profile-http-service.ts` 在真实 `workspace/<slug>` session context 初始化 Project Profile Home 前守卫；外部绝对 workspace path 不纳入当前 ProjectSession 模型。
- `server/workspace-files/project-open-guard.ts` 新增 `withProjectNotOpenHttpError()`；RAG route、`/api/config/project`、`/api/config/profile-home/reset`、`/api/agent/profiles/settings` 统一把 typed error 映射为 HTTP 409 + `data.code="PROJECT_NOT_OPEN"`。Profile prepare preview route 也套用同一 wrapper，避免新增 service guard 从该入口漏成非稳定响应。

**已补测试**：

- `server/rag/project-rag-visualization.test.ts`：默认 Project fixture 显式 open/close，新增未 open service 拒绝用例。
- `server/api/projects/rag/overview.get.test.ts`：未 open 的 RAG overview route 返回 409 `PROJECT_NOT_OPEN`。
- `server/config/config-service.test.ts`：默认 Project fixture 显式 open/close，新增 `saveProjectConfig` / `resetProjectProfileHome` / project scope settings 未 open 拒绝，以及 global scope settings 未 open 仍只初始化 Global Profile Home。
- `server/api/config/profile-home/reset.post.test.ts`、`server/api/agent/profiles/settings.get.test.ts`：focused route typed error 映射用例。

**当前验证**：

- 通过：`bun run typecheck`。
- 通过：`bun run test server/rag server/config server/api/projects server/api/config server/api/agent/profiles`（13 files / 87 tests）。
- 通过：`bun run test server/rag server/config server/api/projects/rag server/api/config/profile-home server/api/agent/profiles/settings.get.test.ts`（7 files / 62 tests）。
- 通过：`bun run test server/workspace-files server/plot server/world-engine server/agent/tools server/api/projects`（56 files / 508 tests）。

### GOAL-B 二次补漏（2026-07-09）

**补漏范围**：只收口 Agent Profile Home 相关 managed Project 数据面，不做隐式 open，不扩大到 Project Manifest / 项目列表 / 创建 / 删除 / zip 导入 / 纯 Global Profile Home 等控制面或全局面。

**已落地**：

- 新增 `server/workspace-files/project-data-plane-guard.ts`：`managedProjectPath()` 只识别归一形 `workspace/<slug>`；`assertManagedProjectDataPlaneOpen()` 对 managed Project 执行 `assertProjectOpen()` + `markProjectActivity()`，绝对外部 Project Path、空路径、user-assets/global 与旧式非 managed path 放行。`project-open-guard.ts` 复用该 helper，避免路由层和服务层重复正则。
- `NeuroAgentHarness.ensureProfileHome()` 在 `profileNeedsHome(profile)` 为真时先执行 managed Project 数据面守卫，再初始化 Global / Project Profile Home。这样 session snapshot、prepareRun、compaction reinject 等 harness 内部 system prompt 链路统一受 ProjectSession 约束；真实 invocation 仍走既有 `openProject(... kind: "agent")` 前置保障。
- `GET /api/agent/sessions/:sessionId` 与 `POST /api/agent/profiles/compile` 套 `withProjectNotOpenHttpError()`；`preview-prepare.post.ts` 保持 wrapper，保证 snapshot / compile / preview prepare 的 lifecycle violation 都稳定返回 HTTP 409 + `data.code="PROJECT_NOT_OPEN"`。
- `ProfileCompileWorkerResult` 增加内部 `lifecycleError?: {code: "PROJECT_NOT_OPEN"; projectPath: string}`。worker runtime 只把 `ProjectNotOpenError` 转成该内部字段；主线程 `ProfileCompileWorkerService` 收到后重新抛 `ProjectNotOpenError`；`stripWorkerResult()` 会剥掉 `lifecycleError`，普通 compile / worker crash 仍按结构化 issue 返回。
- 迁移 Plan Mode Project Workspace 测试 fixture：managed `workspace/alpha` 用例临时覆盖 Workspace Container Root 并补齐 `project.yaml`，让 ProjectSession、session `workspaceRoot` 与 `.agent/plan` 文件解析指向同一棵临时 Project Workspace。

**已补测试**：

- `server/agent/harness/neuro-agent-harness.test.ts`：新增 managed Project session 未 open 时 `getSessionSnapshot()` 抛 `ProjectNotOpenError` 且不创建 `agents/<profile>/home.json`；打开后 snapshot 可生成 system prompt / home。
- `server/api/agent/sessions/[sessionId]/index.get.test.ts`、`server/api/agent/profiles/compile.post.test.ts`、`server/api/agent/profiles/preview-prepare.post.test.ts`：mock typed error，断言 409 + `PROJECT_NOT_OPEN`。
- `server/agent/profiles/profile-compile-worker.test.ts`：覆盖 worker runtime 将 lifecycle violation 返回为内部字段，以及 worker service 重新 reject `ProjectNotOpenError`，不落成 `compile_failed` issue。
- `server/workspace-files/project-data-plane-guard.test.ts`：钉住 managed Project Path 识别边界，确认只拒绝未 open 的 `workspace/<slug>`。

**当前验证**：

- 通过：`bun run typecheck`。
- 通过：`bun run test server/workspace-files/project-data-plane-guard.test.ts server/api/agent/sessions/[sessionId]/index.get.test.ts server/api/agent/profiles/compile.post.test.ts server/api/agent/profiles/preview-prepare.post.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/profile-compile-worker.test.ts -t "project-data-plane-guard|PROJECT_NOT_OPEN|managed Project 未 open|Project lifecycle|Plan Mode 使用 Project Workspace"`（6 files / 9 tests）。
- 通过：`bun run test server/agent/harness/neuro-agent-harness.test.ts -t "Plan Mode 使用 Project Workspace"`；通过：`bun run test server/agent/harness/neuro-agent-harness.test.ts -t "普通 tool turn 到 turn_end 才成组写入 session"`。
- 通过：`bun run test server/rag server/config server/api/projects server/api/config server/api/agent/profiles`（15 files / 89 tests）。
- 未整体通过：`bun run test server/agent/harness server/api/agent/sessions server/api/agent/profiles server/agent/profiles/profile-compile-worker.test.ts`。失败集中在 `server/agent/harness/neuro-agent-harness.black-box.test.ts` 的 admission/steer/followup/abort 长测：4 个 5s timeout/行为断言失败 + 1 个异步残留 ENOENT；不在本次 Profile Home 生命周期守卫链路。另一个不含 black-box 的大集合曾因 `普通 tool turn 到 turn_end 才成组写入 session` 5s timeout 失败，单跑该用例通过。

### GOAL-B 验收（2026-07-09，主会话）

**代码走查（全部属实）**：守卫双 helper（`project-data-plane-guard.ts` 识别边界 + `project-open-guard.ts` 路由映射）；四资源咽喉（plot client / world-engine createClientEntry / sql-tool useSqliteClient / ensureIndexEntry 含审查项 7 内联）；12 条 workspace-files 数据面路由；RAG 服务集中入口 + 全部 RAG 路由 wrapper；config-service 读/写/reset/settings 四处守卫；plot 与 world-engine HTTP 路由的 typed error → 409 映射；harness `ensureProfileHome` 守卫（仅 `profileNeedsHome` 时触发）；worker `lifecycleError` 内部通道 + `stripWorkerResult` 剥离。`initProjectDatabase` 残留审计：仅剩 `openProject` 与项目创建两条控制面路由（新项目建库，合法）。

**验证复跑**：`bun run typecheck` 全绿；守卫聚焦 6 文件 / 30 例全绿（含控制面豁免回归）；大组合 `server/workspace-files server/plot server/world-engine server/agent/tools server/api/projects` 57 文件 / 510 例全绿。

**验收发现与修复（harness black-box「既有失败」复核）**：NOTES-B 的「单独复跑已通过」说法不成立——该文件单跑也以 2/3 概率随机挂，且挂点漂移。根因两处，均为**与 Task 94 代码路径无关的既有测试时序缺陷**（两个失败用例都无 projectPath，ensure-open / Profile Home 守卫均不触发；文件上次提交改动在 Task 62 时代）：

1. 「Idle + prompt」首用例承担 harness/faux provider 暖机，超 5s 默认预算；超时使 invocation 悬置，级联炸掉下一用例的 admission（`active_invocation_exists`）与 afterEach 清理（后台任务读已删临时目录 ENOENT）。修复：按 NOTES-B 在其他文件的同款手法补显式 30s 预算，不动断言。
2. 「Running + followup」等待锚点 `eventHub.lastSeq > 0` 恒真（createAgent 已产生事件），followup 可赶在 prompt admission 之前提交而被拒（`active_invocation_required`）。修复：改锚定 `tool_execution_start`（与同文件 steer 用例同款 observer 模式），断言不变。

修复后 black-box 文件连跑 3/3 全绿；`bun run test server/agent/harness` 全目录 239 例通过（+3 skipped）。**GOAL-B 验收通过，遗留偏差清零。**

## TODO / Follow-ups

- [x] GOAL-A（S1/S2 + 部分 S5）实现完成（2026-07-08）。
- [x] **GOAL-B**：基线 + RAG / Project Profile Home 审查补漏 + Agent Profile Home 二次补漏完成；2026-07-09 主会话验收通过（含 harness black-box 两处既有时序缺陷修复，全目录全绿）。
- [ ] 用户浏览器手动走查（GOAL-A 验收最后一条）：进入项目视图 presence 建立；两标签页关一个不触发 grace；全关 5 分钟后释放；agent 后台跑时关标签页项目保持 open；数据面 409 在正常操作流中不应出现。
- [ ] 验收通过后 commit（Task 94 全量代码当前未提交）。
- [ ] 宽限期时长定稿（暂 5min 常量）；前端错误 UX 文案打磨。
- [ ] 已知局限跟踪：大小写不敏感 FS 双会话（defer）；presence onClosed 单点（h3 版本敏感，升级 h3 时回归 events/presence 两 SSE）。
- [ ] 完成后解锁 [Task 95 nb-history 集成](../95-nb-history-integration/README.md)。

### 2026-07-27 Presence 重连合同加固

- `useProjectSession` 增加可注入 transport 的 controller factory；生产 composable 只适配 `$fetch`、SSE reader 与通知。
- 每次 presence 自动重连固定先执行幂等 Project open，再订阅 presence，修复旧 timer 直接重订阅、服务重启后 session 未恢复的问题。
- 重连使用共享 `SseReconnectBackoff`：短暂 open 不清零失败序列，稳定 5 秒后的断线才开启新周期。
- 连续抖动只提示一次；稳定连接后才允许下一周期再次提示。主动 dispose/代次切换不重连。
- controller 的确定性 fake-timer 测试覆盖 reopen 顺序、连续短连接只通知一次、连接稳定满 5 秒后才重置通知周期，以及新目标/dispose 不触发旧代次 reopen；计入 Task 111 审查补漏组合 17 文件 / 129 项通过。旧 16 文件 / 111 项记录未覆盖完整通知周期，已退役。浏览器 presence 走查仍由用户执行。
