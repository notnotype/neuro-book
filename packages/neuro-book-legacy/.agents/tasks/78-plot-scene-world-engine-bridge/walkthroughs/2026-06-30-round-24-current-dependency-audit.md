# 2026-06-30 Round 24 - Current Dependency Audit

## Scope

本轮继续 Task 78 的 Agent 易用性探索，先重新核对当前 worktree，避免基于过期记录重复设计。重点检查 `SceneWorldAnchorResolutionService`、profile 合同、Plot tools 和 OpenAPI catch-all route。

本轮不修改业务代码。

## Evidence

当前代码状态：

- `server/plot/services/scene-world-anchor-resolution.service.ts` 已存在。
- `PlotFacade` 已用 `SceneWorldAnchorResolutionService.resolveMany()` 批量格式化 Plot tree、Thread detail、Chapter plot 和 Scene detail 中的 World Anchor。
- `server/plot/services/scene-world-anchor-resolution.service.test.ts` 覆盖 resolved subject、unresolved subject、location subject、缺失 `calendar.ts` 降级和损坏 `calendar.ts` 抛错。
- `SceneWorldContextService` 仍自己解析 `subjectIdsJson/locationSubjectId`、去重、查询 subject identity 并计算 `unresolvedSubjectIds`。
- `server/agent/tools/plot-tools.ts` 仍只有 `get_chapter_plot`，没有 `get_chapter_writer_brief`。
- `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 仍没有 brief tool binding。
- `DirectorOutputSchema` 仍允许 `plot_updates.kind = "plot"`，并仍使用 `simulator_requests`。
- `director.profile.tsx` 仍有 `Simulation gate`，并提示调用 `simulator.leader`。
- `reference/agent/profile-routing.md` 和 `reference/agent/leader-default.md` 仍把普通写作下的 Plot/director 路由排除。

## Correction To Earlier Plan

Round 09/19 的“实现 brief 前先抽 `SceneWorldAnchorResolutionService`”已经完成主要落地。后续不应再把它当成未开始的前置任务。

新的判断：

- `SceneWorldAnchorResolutionService` 已经是可复用 Module。
- 它当前 Interface 适合“展示型 anchor 解析”：输入 `StorySceneWorldAnchorDto`，输出 resolved/unresolved/time-formatted DTO。
- `SceneWorldContextService` 需要的是“查询型 subject 集合”：resolved ids、unresolved ids、subject display names。这部分目前仍在 context service 内部处理。
- `ChapterWriterBriefService` v1 不应新增第三套 subject resolution 规则；可以先复用 Facade/Assembler 已解析的 chapter scenes，再调用 `SceneWorldContextService` 取上下文。

## Architecture Implication

`SceneWorldAnchorResolutionService` 通过删除测试能证明它有 Depth：删除后，subject identity 查询、缺失 calendar 降级、unresolved 状态会回到 Facade、Workbench、brief 等多个调用方，Locality 会变差。

但它的 Interface 目前只覆盖展示语义。不要为了 brief v1 立刻把它扩成万能 world-anchor Module。更稳的路径是：

1. brief v1 先消费已解析的 `ChapterPlotDetailDto.scenes[].worldAnchor`。
2. brief v1 调 `SceneWorldContextService` 获取每个 Scene 的 filtered context 和 unresolved subject。
3. 如果 context 与 brief 后续都需要同一份 resolved subject id 集合，再把 `SceneWorldAnchorResolutionService` 的内部解析结果扩出一个查询用 Interface，而不是在 brief 内复制解析。

## Updated Implementation Order

当前后续顺序应调整为：

1. P1 修 profile/routing 去旧 Plot/simulator 语义。
2. P2 修 OpenAPI catch-all route 显式 `path`。
3. P3 让 `SceneWorldContextService` 在需要时复用 anchor resolution 语义；这不是阻塞 brief v1 的大型重构。
4. P4 实现 `ChapterWriterBriefService` + `get_chapter_writer_brief` v1，并优先暴露给 director。

## Result

本轮结论：`SceneWorldAnchorResolutionService` 已落地，Task 78 的关键未完成项从“先抽解析服务”变成“让 brief v1 不再新增解析规则，并在后续必要时让 Scene World Context 共享同一解析 Interface”。

