# 2026-06-29 Round 18 - Brief Service Data Flow

## Scope

本轮把 scene/world-only `get_chapter_writer_brief` v1 的服务端数据流落到当前代码结构上。目标是找出实现时真正要改的 service / repository / facade 边界。

本轮不修改业务代码。

## Current Evidence

当前章节 Plot 查询路径：

- `SceneService.getChapterPlotDetailDto(projectPath, chapterPath)`
- `SceneRepository.findChapterScenes(chapterPath)`
- `PlotDtoAssembler.toChapterPlotDetailDto()`

当前 `findChapterScenes()` 只 include：

```ts
thread: {
    select: {
        id: true,
        title: true,
        isMainThread: true,
    },
}
```

所以当前 `ChapterPlotSceneDto` 有：

- `threadId`
- `threadTitle`
- `threadIsMain`
- Scene summary / purpose / worldAnchor

但没有：

- `threadSummary`
- `threadWritingTip`
- `threadStatus`
- `threadTags`

而 `get_chapter_writer_brief` v1 需要 Thread summary，否则 writer handoff 会缺长期因果线。

## Implementation Options

| 方案 | 做法 | 优点 | 风险 | 判断 |
| --- | --- | --- | --- | --- |
| A. Facade 编排现有 DTO | `PlotFacade.getChapterWriterBrief()` 调 `getChapterPlotDetailDto()`，再按每个 `threadId` 调 `getStoryThreadDetailDto()`，再调 `getSceneWorldContext()`。 | 最少改 repository。 | Facade 变厚；会重复 format anchor / listSubjects；N+1 明显。 | 可做临时原型，不推荐正式落地。 |
| B. 新 `ChapterWriterBriefService` + 扩展 chapter scene 查询 | repository 查询 chapter scenes 时 include thread summary 等 brief 必需字段；service 统一生成 brief。 | 边界清晰；后续 Task 80 可扩展。 | 需要新增 DTO/service/test，改 repository type。 | 推荐。 |
| C. 只在 Agent tool 层串工具 | `get_chapter_writer_brief` tool 内部直接串 facade 现有方法。 | 工具实现很快。 | HTTP/UI 不能复用；难测试；工具层承担业务逻辑。 | 不推荐。 |

推荐 B。

## Proposed Data Flow

```text
GET /api/projects/plot/chapter-writer-brief
  -> PlotFacade.getChapterWriterBrief(projectPath, chapterPath)
    -> ChapterWriterBriefService.getChapterWriterBrief(projectPath, chapterPath)
      -> scopeGuard.assertChapterPath()
      -> sceneRepository.findChapterScenesForBrief(chapterPath)
      -> SceneWorldAnchorResolutionService.resolveMany(projectPath, scenes)
      -> SceneWorldContextService.getSceneWorldContext(projectPath, sceneId) for queryable scenes
      -> build warnings / status / worldQueryHints / suggestedBriefMarkdown
```

## Repository Shape

建议新增而不是直接扩大 `findChapterScenes()`：

```ts
findChapterScenesForBrief(chapterPath: string): Promise<ChapterWriterBriefSceneEntity[]>;
```

原因：

- `findChapterScenes()` 是现有 Chapter Plot DTO 使用面，保持轻量。
- brief 需要更重的 thread summary / writingTip / tags，未来还可能需要 refs 或 information-control 汇总。
- 分开后不影响 Plot Workbench 普通章节视图性能。

候选 entity：

```ts
type ChapterWriterBriefSceneEntity = StoryScene & {
    thread: Pick<
        StoryThread,
        "id" | "title" | "isMainThread" | "summary" | "writingTip" | "status"
    > & {tags: string};
};
```

进入 service 后复用 thread tag normalize。

## Scene World Context Strategy

v1 可以直接调用现有：

```ts
sceneWorldContextService.getSceneWorldContext(projectPath, scene.id)
```

但要注意：

- 缺时间范围时该 service 抛 400；brief service 应捕获并转成 warning。
- unresolved subjects 全部未解析时该 service 返回空上下文，不报错。
- 每个 scene 调用会重复 `listSubjects()`，如果一章多 scene 会有额外成本。

短期可接受，因为章节 scene 数一般较少；系统性优化见 Round 19。

## Status Rules

v1 status 建议继续使用 Round 10 的优先级：

```text
needs_plot > needs_world_anchor > needs_world_context > ready
```

映射：

- `needs_plot`
  - 章节无 Scene。
  - 任一 Scene summary 为空或只有空白。
- `needs_world_anchor`
  - 任一 Scene 缺完整 `startInstant/endInstant`。
  - 任一 Scene 没有 subjectIds 且没有 locationSubjectId。
- `needs_world_context`
  - 任一 Scene 有 unresolved subjects。
  - 任一 Scene world context 查询失败。
- `ready`
  - 结构可写；已连接的 Scene context 查询成功；允许 info warning。

## Warning Codes

v1 最小 warning codes：

- `chapter_has_no_scenes`
- `scene_missing_summary`
- `scene_missing_world_time`
- `scene_missing_subjects`
- `scene_has_unresolved_subjects`
- `world_context_empty`
- `world_context_query_failed`

不要把 ChapterOverride 相关 warning 放进 v1。Task 80 再加：

- `chapter_override_missing`
- `information_control_missing`
- `do_not_reveal_empty`
- `pov_not_set`

## Suggested Brief Markdown

`suggestedBriefMarkdown` v1 只生成结构化 handoff，不写正文：

```text
# Chapter Writer Brief

## Chapter
chapterPath: ...

## Scenes
1. ...

## World Query Hints
- 查询 subject: ...
- 查询时间范围: ...

## Warnings
- ...
```

它应明确提示 writer 使用 readonly `execute_world` 自查状态，不应把完整 subject attrs 或 patch JSON 塞进 markdown。

## Result

正式实现不应把 brief 逻辑写在 Agent tool 层。推荐新增 `ChapterWriterBriefService`，并给 repository 增加 `findChapterScenesForBrief()`，让 HTTP、Agent tool 和未来 Task 80 的 ChapterOverride 扩展共用同一服务。

