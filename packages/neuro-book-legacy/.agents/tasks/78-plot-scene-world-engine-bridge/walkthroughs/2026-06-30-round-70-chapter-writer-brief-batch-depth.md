# Round 70: Chapter Writer Brief Batch Depth

## Context

本轮继续只读探索 `ChapterWriterBriefService` 的数据 Interface。目标是确认它为什么应该是 Plot 模块内的深 Module，而不是 Agent tool 层串 `get_chapter_plot` + `get_scene_world_context`。

已读取：

- `shared/dto/plot.dto.ts`
- `server/plot/contracts/plot-repositories.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/plot/core/types.ts`
- `server/plot/assemblers/plot-dto.assembler.ts`
- `server/plot/services/scene-world-context.service.ts`
- `server/plot/facade/plot.facade.ts`

## Current Evidence

现有 `ChapterPlotSceneWithThread` 类型只有：

```ts
StoryScene & {
    thread: Pick<StoryThread, "id" | "title" | "isMainThread">;
}
```

`PrismaSceneRepository.findChapterScenes()` 也只 select：

- `thread.id`
- `thread.title`
- `thread.isMainThread`

`ChapterPlotSceneDtoSchema` 当前包含：

- Scene `summary`
- Scene `purpose`
- `worldAnchor`
- thread title / isMain

但不包含：

- Scene `writingTip`
- Thread `summary`
- Thread `writingTip`
- Thread `status/tags/note`

这对 UI 的 chapter plot 概览够用，但对 writer brief 不够。writer handoff 最需要的是长期因果摘要和写作提示，而这些字段当前不会穿过 `get_chapter_plot`。

## Deletion Test

如果不新增 `ChapterWriterBriefService`，而让 Agent tool 层自己串调用：

1. `get_chapter_plot(projectPath, chapterPath)`
2. 对每个 Scene 调 `get_story_scene_context`
3. 对每个 Scene 调 `get_scene_world_context`
4. Agent 自己合成 markdown

删除这个“隐形 brief Module”后，复杂度不会消失，只会分散到每次 Agent 调用里：

- status 聚合逻辑分散。
- world context warning 分散。
- unresolved subject 解释分散。
- markdown include/exclude 信息边界分散。
- 章节 Scene 顺序、thread 因果摘要、World Engine 查询失败的降级语义都变成提示词约束。

这说明 `ChapterWriterBriefService` 是值得保留的深 Module。

## Required Repository Interface

推荐新增一个专用查询：

```ts
findChapterScenesForBrief(chapterPath: string): Promise<ChapterBriefSceneWithThread[]>
```

其中 `ChapterBriefSceneWithThread` 至少包含：

- Scene 全部 writer-facing 字段：`title/status/summary/purpose/writingTip/worldAnchor/chapterSortOrder/threadSortOrder`
- Thread writer-facing 字段：`id/title/isMainThread/summary/writingTip/status`

不建议复用现有 `findChapterScenes()` 后再对每个 thread 单独查询。brief 编译是章节级读取，应该一次穿过 repository Interface 获取足够材料。

## Service Flow

`ChapterWriterBriefService.getChapterWriterBrief(projectPath, chapterPath)` 应：

1. 用 `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)` 归一化和校验章节目录。
2. 调 `sceneRepository.findChapterScenesForBrief(normalizedChapterPath)`。
3. 如果没有 Scene，返回 `needs_plot`。
4. 对 Scene 的 `worldAnchor` 复用 `SceneWorldAnchorResolutionService` 语义，保留 resolved/unresolved。
5. 对每个 Scene 查询 World Context，但把查询失败收敛为 status/warnings，不把异常结构暴露给 writer markdown。
6. 聚合 status：path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`。
7. 渲染 `suggestedBriefMarkdown`。

## Fixture Test Matrix

建议 service 层 fixture：

- `needs_plot`：章节存在但没有挂载 Scene。
- `needs_world_anchor`：存在 Scene，但至少一个关键 Scene 缺完整 `startInstant/endInstant`。
- `needs_world_context`：Scene 有 anchor，但 subject 全 unresolved 或 World Context 查询失败。
- `ready_with_empty_context_warning`：Scene 有 anchor 且 subjects resolved，但时间范围内没有相关 patch；status 可仍为 `ready`，warnings 说明上下文为空。
- `ready`：有 Scene、anchor、resolved subject 和 context。

`suggestedBriefMarkdown` 断言：

- 包含 Chapter path、Scene 顺序、Thread title/summary、Scene summary/purpose/writingTip、World Context 摘要和 warnings。
- 不包含 raw patch JSON。
- 不 dump 完整 attrs object。
- 不伪造 ChapterOverride 的 POV、tone、do-not-reveal 等 Task 80 字段。

## Conclusion

`ChapterWriterBriefService` 的 Interface 应该比现有 `get_chapter_plot` 深：调用者只提供 `projectPath/chapterPath`，得到可直接给 writer 的 brief 和机器可判定 status。它把章节级 Plot、Scene World Anchor、World Context、warnings 和 markdown 信息边界集中在一个 Module 内，提高 Locality，也让测试能跨同一个 Interface 验证真实行为。
