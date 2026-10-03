# Round 83: Brief Read Model Module

## Scope

本轮审查 `get_chapter_writer_brief` 是否应该由 Agent tool 层串调用已有 Plot tools。结论仍是不应该。brief v1 需要一个 deeper read model Module：`ChapterWriterBriefService` + `findChapterScenesForBrief()`。

## Current Evidence

- `shared/dto/plot.dto.ts`
  - `ChapterPlotSceneDtoSchema` 包含 scene 基本字段、thread title、thread main flag、worldAnchor。
  - 不包含 thread summary / thread writingTip。
  - 不包含 Scene writingTip。
  - 不包含 Scene World Context、warnings 或 `suggestedBriefMarkdown`。
- `server/plot/core/types.ts`
  - `ChapterPlotSceneWithThread` 的 thread 只选 `id/title/isMainThread`。
- `server/plot/repositories/prisma-scene.repository.ts`
  - `findChapterScenes()` 只 include thread `id/title/isMainThread`。
  - 查询结果足够给 Chapter Plot 面板展示，不足以生成 writer brief。
- `server/agent/tools/plot-tools.ts`
  - `get_story_scene_context` / `get_scene_world_context` 会读写 `plot.selection`。
  - `get_chapter_plot` 只返回章节 scenes，不聚合 World Context。
  - 让 Agent tool 层自行串 `get_chapter_plot` + N 次 `get_scene_world_context` 会把 status 聚合、warning 优先级、markdown 信息边界散到调用方。

## Interface Problem

`get_chapter_plot` 是一个 UI/read helper Interface，不是 writer brief Interface。它的 Depth 不足：调用方还要知道如何补 thread summary、Scene writingTip、World Context、unresolved subject、status precedence 和 markdown exclusions。

如果把这些逻辑放进 Agent tool 层，tool 变成业务编排 Implementation，而不是 thin adapter。后续 HTTP route、director tool、测试 fixture 会各自复制规则，Locality 变差。

## Deepening Opportunity

新增 `ChapterWriterBriefService`，把 brief read model 做成 Plot 模块的只读 Module：

- 输入 Interface：`{projectPath, chapterPath}`。
- 内部 Implementation：
  - `PlotScopeGuard.assertChapterPath()` 归一化和存在性检查。
  - `findChapterScenesForBrief()` 一次查询 Scene + thread summary/writingTip + Scene writingTip。
  - 复用 `SceneWorldAnchorResolutionService` 的 resolved/unresolved 语义。
  - 对每个 Scene 调用 Scene World Context 查询 Module。
  - 按固定优先级聚合 `needs_plot / needs_world_anchor / needs_world_context / ready`。
  - 渲染 `suggestedBriefMarkdown`。
- 输出 Interface：
  - `status`。
  - `chapterPath`。
  - `scenes`。
  - `worldContexts`。
  - `warnings`。
  - `suggestedBriefMarkdown`。

`get_chapter_writer_brief` Agent tool 应只做 adapter：

- 参数校验。
- 调用 facade/service。
- 返回 DTO。
- 不读写 `plot.selection`。

## Acceptance

最小 fixture 应覆盖：

- `needs_plot`：章节没有 Scene。
- `needs_world_anchor`：Scene 缺时间范围或 subject。
- `needs_world_context`：全部 unresolved 或 World Context 查询失败。
- `ready`：Scene、anchor、resolved subjects、context 都可用。
- markdown 不含 raw patch JSON、完整 attrs、伪造 ChapterOverride 字段。
- `findChapterScenesForBrief()` 返回 thread summary/writingTip 和 Scene writingTip。

## Benefits

- **Leverage**：HTTP route、Agent tool 和后续 director 都只学习一个 brief Interface。
- **Locality**：status precedence、warning 文案、markdown 信息边界集中在一个 Module。
- **Deletion test**：删除 `ChapterWriterBriefService` 后，复杂度会回流到 Agent tool、HTTP handler 和 profile prompt；说明该 Module 应该存在。

## Conclusion

brief v1 的关键不是新增一个工具名，而是建立一个深的 read model Module。Agent tool 只是 adapter，不能承载业务规则。

