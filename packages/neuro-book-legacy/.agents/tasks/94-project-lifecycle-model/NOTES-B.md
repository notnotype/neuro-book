# GOAL-B Notes

## 契约疑点与偏差记录

- `server/api/projects/world-engine/[...segments].ts` 在 HTTP 入口额外执行了一次 `assertProjectOpen(projectPath)`。原因：该路由的写入与查询会先解析项目日历字符串，`parseTime()` 发生在 `createClientEntry()` 之前；如果只守卫 DB client 入口，未 open 的请求可能先暴露 calendar/schema 错误，而不是稳定的 `PROJECT_NOT_OPEN`。facade 的 `createClientEntry()` 守卫仍保留为资源咽喉真相。

## 2026-07-09 审查补漏记录

- 漏口 1：`server/rag/project-rag-visualization.ts` 原先没有接 ProjectSession 守卫。Task 94 D2 已把 `rag` 列为数据面，本轮在 RAG service 的 Project Path 解析入口集中 `assertProjectOpen()` + `markProjectActivity()`，避免 overview、subject、search、rebuild、inspector、debug 与 events/memories CRUD 各自散落守卫。
- 漏口 2：Project Profile Home 的写入、reset、读时初始化/升级原先可能绕过 HTTP route 直接从 service 触发。Profile Home 位于 Project Workspace 内，且会初始化/升级/写入可打包依赖；即使入口是“读取 settings”，只要会触发 Project Home 创建或升级，就属于 Project Workspace 数据面，必须 open。
- `readConfigAgentProfileSettings(... scope: "global")` 保持不要求 Project open。即使 query 携带 `projectPath`，该路径只用于当前设置页上下文，低代码表单只初始化 Workspace Root `.nbook/agents/<profile>` 的 Global Profile Home，不创建 Project Profile Home。
- Project Manifest 仍按控制面处理：项目列表、`item.get` / `item.patch`、创建、删除、zip 导入需要在未 open 时可用；把它们误锁到 ProjectSession 会导致列表页、修复 manifest、删除坏项目等管理流失效。
- RAG SQLite 不注册为 ProjectSession 长命资源。当前 subject RAG SQLite 是按次打开、按次关闭的缓存库；本轮只补 open guard，不扩大资源生命周期模型。将来若要复用连接，需另开设计并把 close 责任纳入 ProjectSession owner。
- HTTP 映射收口为 `withProjectNotOpenHttpError()`：业务层只抛 typed `ProjectNotOpenError`，route 层统一转换为 HTTP 409 + `data.code="PROJECT_NOT_OPEN"`。本轮应用到 RAG route、`/api/config/project`、`/api/config/profile-home/reset`、`/api/agent/profiles/settings`；Profile prepare preview route 因新增 service guard 也套同一 wrapper，避免 typed error 漏出为非稳定响应。

## 2026-07-09 二次补漏记录

- 漏口 3：Agent session snapshot 的 `snapshotSystemPrompt` 链路会经 `NeuroAgentHarness.ensureProfileHome()` 初始化或升级 Project Profile Home。snapshot 是读接口，但 Project Home 初始化/升级会落盘到 Project Workspace，所以按严格策略仍属于数据面；managed `workspace/<slug>` 未 open 时必须拒绝，而不是跳过 system prompt 或隐式 open。
- 新增 `assertManagedProjectDataPlaneOpen(projectPath?)` 作为非 HTTP 数据面守卫 helper。它只守归一形 `workspace/<slug>`，空路径、绝对外部 Project Workspace、user-assets/global 与旧式非 managed path 放行；命中 managed Project 后统一 `assertProjectOpen()` + `markProjectActivity()`。`project-open-guard.ts` 复用它，避免 route wrapper 和 service guard 各自维护正则。
- `ensureProfileHome()` 内部加守卫后，session snapshot、prepareRun、compaction reinject 等 harness 内部 Profile Home 入口都闭合。真实 agent invocation 仍由 `invokeAgent()` 前置 `openProject(... kind: "agent")` 保证，不新增隐式 opener。
- 漏口 4：profile compile / preview worker 原先可能把 `ProjectNotOpenError` 折成普通 compile issue。生命周期违约不是 profile 源码编译失败，不应通过 issue 文案反推；worker runtime 现在只把 typed error 转成内部 `lifecycleError`，主线程收到后重新抛 `ProjectNotOpenError`，由 route wrapper 映射 HTTP 409。普通 compile error、worker crash 仍按 DTO issue 返回。
- `lifecycleError` 是内部字段，不进入公开 compile result schema；主线程发布前 `stripWorkerResult()` 会剥掉该字段，避免 HTTP DTO 被生命周期控制面细节污染。

## 清单外冲突

- 运行 GOAL-B 最终验收时，当前工作区并行中的 Plot 规划层新增实体接线阻塞了 `bun run typecheck` 与完整目标测试。为完成本轮验收，已做最小基线修复：`PlotFacade` 对象图补 `PromiseRepository/DecisionRepository` 接线；`StoryService` 补 open Promise / open Decision 计数链路；`PlotDtoAssembler` 补 `StoryDecisionDto` anchor 归一化与 `openDecisionCount` 输出；`PrismaPromiseRepository` include 改为 Prisma 类型约束，避免 readonly include 类型不匹配。该修复不改变 GOAL-B 守卫语义。
- 完整目标组合在 Windows 上并发跑 53 个测试文件时，若干本来单跑通过的重型集成测试会触发默认 5s/10s timeout。已只在相关测试文件补显式 15s/30s timeout：ProjectSession 清理 hook、World Engine / CodeAct / Plot API / Agent world tools 集成测试、web_fetch HTML 转 markdown 冷路径；业务断言未放宽。

## 验收结果

- 通过：`bun run typecheck`。
- 通过：`bun run test server/rag server/config server/api/projects server/api/config server/api/agent/profiles`（二次补漏后复跑：15 files / 89 tests）。
- 通过：`bun run test server/workspace-files/project-data-plane-guard.test.ts server/api/agent/sessions/[sessionId]/index.get.test.ts server/api/agent/profiles/compile.post.test.ts server/api/agent/profiles/preview-prepare.post.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/profile-compile-worker.test.ts -t "project-data-plane-guard|PROJECT_NOT_OPEN|managed Project 未 open|Project lifecycle|Plan Mode 使用 Project Workspace"`（6 files / 9 tests）。
- 通过：`bun run test server/workspace-files server/plot server/world-engine server/agent/tools server/api/projects`（56 files / 508 tests）。
- 未整体通过：`bun run test server/agent/harness server/api/agent/sessions server/api/agent/profiles server/agent/profiles/profile-compile-worker.test.ts`，失败集中在既有 harness black-box admission/steer/followup/abort 长测；相关 focused 用例与单独复跑的超时用例已通过。

## 2026-07-09 验收更正（主会话）

- 上一条「单独复跑已通过」不成立：black-box 文件单跑也以约 2/3 概率随机挂且挂点漂移，属 flaky 而非负载伪影。验收轮定位为两处**与 Task 94 无关的既有测试时序缺陷**并已修复（首用例 5s 暖机预算 → 显式 30s；followup 等待锚点 `lastSeq > 0` 恒真 → 改锚 `tool_execution_start` observer 模式，同文件 steer 用例同款），断言均未放宽。修复后 black-box 连跑 3/3 全绿，`bun run test server/agent/harness` 全目录 239 例通过。该遗留偏差就此关闭，详见 README「GOAL-B 验收」节。
