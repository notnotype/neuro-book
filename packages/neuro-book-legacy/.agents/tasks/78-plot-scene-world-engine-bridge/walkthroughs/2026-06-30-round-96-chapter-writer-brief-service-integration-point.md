# Round 96: Chapter Writer Brief Service Integration Point

## Scope

本轮继续只读探索 `get_chapter_writer_brief` v1 应接入 Plot 模块的哪一层。没有改业务代码、没有运行测试。

## Current Evidence

- `PlotFacade` 的 `PlotModule` 当前包含 `inputParser / storyService / threadService / sceneService / sceneWorldContextService / refResolverService`。`getSceneWorldContext()` 已通过 facade 转发到 `sceneWorldContextService`，说明 facade 是外部调用的稳定 seam，scene/world 查询逻辑已经放在 Plot 内部 Module。
- `createModuleFromExecutor()` 在同一个组合根里创建 repository、assembler、scopeGuard、scene service 和 `SceneWorldContextService`。`ChapterWriterBriefService` 适合在这里作为 `sceneWorldContextService` 的同级只读 Module 注入，然后由 facade 暴露 `getChapterWriterBrief(projectPath, chapterPath)`。
- `SceneService.getChapterPlotDetailDto()` 当前只做 `PlotScopeGuard.assertChapterPath()`、`sceneRepository.findChapterScenes()` 和 assembler 映射。这个接口服务 UI 的章节剧情列表，不是 writer brief 的深接口。
- `SceneRepository.findChapterScenes(chapterPath)` 只 include `thread.id/title/isMainThread`。类型 `ChapterPlotSceneWithThread` 也只允许这三个 thread 字段。
- `PlotDtoAssembler.toChapterPlotSceneDto()` 输出 `threadTitle/threadIsMain/title/status/summary/purpose/worldAnchor`，没有 Scene `writingTip`，也没有 Thread `summary/writingTip`。
- Prisma schema 中 `StoryThread.summary`、`StoryThread.writingTip`、`StoryScene.writingTip` 已存在，说明 brief v1 缺的是 read model 查询深度，不是数据模型能力。
- `shared/dto/plot.dto.ts` 已包含 `SceneWorldContextDtoSchema` 和 `PlotJsonValueSchema`，适合继续承载 `ChapterWriterBriefDtoSchema`。不需要把 writer-only 字段塞进现有 `ChapterPlotSceneDtoSchema`。
- `SceneWorldContextService` 已独立处理 Scene 时间范围、subject identity、unresolved subject 和 state 查询。`SceneWorldAnchorResolutionService` 已提供批量 anchor 展示解析。brief service 应复用这些语义，避免在 HTTP route 或 Agent tool adapter 层重新拼规则。

## Interpretation

`ChapterWriterBriefService` 应是 Plot 模块内的深 read model Module，而不是 HTTP route、Agent tool 或现有 `ChapterPlotDetailDto` 的薄扩展。

推荐 Interface：

```ts
getChapterWriterBrief(projectPath: string, chapterPath: string): Promise<ChapterWriterBriefDto>
```

实现位置：

- 新增 `server/plot/services/chapter-writer-brief.service.ts`
- `PlotModule` 增加 `chapterWriterBriefService`
- `PlotFacade` 增加 `getChapterWriterBrief(projectPath, chapterPath)`
- `SceneRepository` 增加专用查询，例如 `findChapterScenesForBrief(chapterPath)`
- `shared/dto/plot.dto.ts` 增加 `ChapterWriterBriefDtoSchema`

专用查询至少需要一次拿到：

- Scene：`id/title/status/summary/purpose/writingTip/worldAnchor/chapterSortOrder/threadSortOrder`
- Thread：`id/title/isMainThread/summary/writingTip`

## Architecture Decision

不要扩改 `ChapterPlotSceneDtoSchema` 来满足 writer brief。该 DTO 的 Interface 面向 Plot UI 和章节 Scene 排序；如果把 `Thread.summary/writingTip`、`Scene.writingTip`、brief status、warnings 和 markdown 草案混进去，会让 UI 查询承担 writer handoff 的复杂度。

新增 `ChapterWriterBriefService` 的删除测试成立：如果删除它，status precedence、warning aggregation、World Context 查询、markdown 信息边界和 writer handoff 格式会重新散落到 HTTP route、Agent tool 和 profile prompt。集中成一个 Module 能提高 Locality，也让 service fixture 成为主要测试面。

Agent tool 后续只应是 Adapter：解析 tool input、调用 facade、返回 DTO。它不应承载 `needs_plot / needs_world_anchor / needs_world_context / ready` 判定，也不应手动串 `get_chapter_plot` 与 `get_scene_world_context`。

## Acceptance Impact

Slice 3 `Chapter Writer Brief Module` 的验收应新增这些检查：

1. `ChapterWriterBriefService` 通过 `PlotScopeGuard.assertChapterPath()` 统一校验 chapter path。
2. `findChapterScenesForBrief()` 覆盖 thread summary/writingTip 和 Scene writingTip。
3. DTO 放在 `shared/dto/plot.dto.ts`，并显式包含 `suggestedBriefMarkdown`。
4. service fixture 覆盖 `needs_plot / needs_world_anchor / needs_world_context / ready`。
5. tool/HTTP 层测试证明它们只是 adapter，不读写 `plot.selection`，不内联业务聚合规则。

## Plan Deviation

本轮原计划只确认 service 接入点；实际额外确认了现有 Chapter Plot DTO 不应扩展为 writer brief DTO，以及 repository 查询需要成为专用 read model。没有进入 Slice 1 实现，符合当前“继续探索并记录”的 goal 约束。
