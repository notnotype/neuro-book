# Round 68: Exploration Stop And Implementation Go/No-Go Refresh

## Context

用户要求“继续进行几轮探索”。本轮在 Round 66-67 基础上做 go/no-go 刷新：判断是否还需要继续扩写设计，或应该进入实现切片。

本轮仍未修改业务代码。

## What Is Now Settled

Profile 架构已经稳定：

- `leader.default`：用户协作入口、canon 决策入口、World Engine owner；第一阶段不直接持有全套 Plot write tools。
- `director`：Plot write owner，负责 Thread / Scene / Chapter Plot 结构与 future brief compiler。
- `writer`：只写正文，不直接使用 Plot tools；消费完整 writer brief，写入目标只来自 `invoke_agent.input.path`。
- `world.engine`：复杂 World Engine schema/calendar/state 维护 specialist。

实现顺序已经稳定：

1. Profile Contract Cleanup
2. OpenAPI Explicit Path
3. Chapter Writer Brief Module
4. Agent Tool Binding

第一阶段工具暴露已经稳定：

- 采用 Director-only brief。
- 不给 writer Plot tools。
- 不给 leader 全套 Plot write tools。
- Leader Readonly Brief 只作为真实使用中 director 往返成本过高后的观察项。

brief v1 合同已经稳定：

- 输入：`projectPath` + `chapterPath`。
- 不接 writer target；writer target 只由 `invoke_agent.input.path` 指定。
- 状态优先级：path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`。
- 输出必须包含可编辑 `suggestedBriefMarkdown`。
- markdown 不包含 raw patch JSON、完整 attrs dump、不伪造 ChapterOverride 的 POV/tone/do-not-reveal 字段。

OpenAPI 前置修复已经稳定：

- `RouteMetaEntry` 需要 `path?: string`。
- `buildPath(file, entry)` 应优先使用 `entry.path`。
- `world-context` 和 `chapter-writer-brief` 两个 catch-all GET operation 必须生成独立公开 path。

## Remaining Unknowns

剩余未知不阻塞进入实现：

- `ChapterWriterBriefService` 最终 markdown 文案细节可以在 fixture 测试中迭代。
- `findChapterScenesForBrief()` 的 query shape 需要在实现时按 Prisma relation 实际字段确认。
- `SceneWorldContextService` 与 brief service 是否共享更深的 query-oriented anchor Module，可以等重复出现后再抽；当前 `SceneWorldAnchorResolutionService` 已足够支撑 v1。
- 真实 Agent smoke 需要等 tool binding + compiled profile 完成后再做，不能在 Slice 1 之前证明。

## Go / No-Go

Go：

- 进入 Slice 1 `Profile Contract Cleanup`。
- 直接删除旧 `simulator_requests` 和 `plot` kind，不做兼容 alias。
- 同步改 source profile、reference、schema 和 tests。
- 验收时包含 compiled artifact 新格式证据。

No-Go：

- 不继续扩写新的 profile 拓扑方案。
- 不先实现 `get_chapter_writer_brief`，否则新 tool 会绑定到旧 director contract 上。
- 不把 World Engine readwrite tool 交给 director；世界状态推进仍由 leader / world.engine owner 负责。
- 不把 Plot tools 交给 writer。

## Recommended Next Slice

下一步实现建议：

1. 修改 `DirectorOutputSchema`，使 `world_engine_requests` 成为唯一世界状态请求字段，并 strict。
2. 修改 `director.profile.tsx`，删除 simulator gate，改为 Scene-only Plot + World Engine request 输出。
3. 修改 writer 注释和普通写作 reference，让 writer 的职责变成“消费 brief”，不是“写作模式不用 Plot”。
4. 修改 `profile-routing.md` / `leader-default.md` / `novel-writing-workflow.md`，允许 leader 将 Plot 结构与 brief 编译任务路由给 director。
5. 补 `simulation-director-profiles.test.ts` 和 schema-only `Value.Check()` 负例。
6. 编译 system director，并处理或显式验收 user director shadow。

## Completion Audit Impact

当前 Task 78 的 Scene / World Engine UI 和后端桥接已经有实现证据；但目标里“改造 plot 工具，让 Agent 很方便使用 Plot 系统和 World Engine”仍未完成。缺口是明确的：

- profile contract 尚未改。
- OpenAPI explicit path 尚未改。
- `ChapterWriterBriefService` 尚未实现。
- `get_chapter_writer_brief` 尚未进入 tool registry / typed binding / director exposure。
- compiled director artifact 仍是旧 simulator gate 合同。

因此 active goal 不能标记完成。继续纯探索的边际收益很低；下一轮若用户没有要求继续只读，应进入 Slice 1 实现。
