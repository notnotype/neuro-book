# Round 104: Brief Read Model Query Shape

## Scope

本轮只读复核 `ChapterWriterBriefService` 需要的章节 Scene 查询形态。目标是确认 brief v1 应新增专用 read model，而不是复用或扩胖当前 UI 用 `ChapterPlotSceneDtoSchema`。没有改业务代码、没有运行测试。

## Current Evidence

`server/plot/repositories/prisma-scene.repository.ts`:

- `findChapterScenes(chapterPath)` 当前只按 `chapterSortOrder/id` 查询 Scene。
- include 的 thread 只 select `id/title/isMainThread`。
- 返回类型是 `ChapterPlotSceneWithThread[]`。

`server/plot/core/types.ts`:

- `ChapterPlotSceneWithThread = StoryScene & { thread: Pick<StoryThread, "id" | "title" | "isMainThread"> }`。
- 因为它继承 `StoryScene`，Scene `writingTip` 在查询结果里有，但当前章节 DTO 没有输出它。
- Thread `summary/writingTip` 没在类型和查询里。

`server/plot/assemblers/plot-dto.assembler.ts`:

- `toStorySceneSummaryDto()` 会输出 Scene `writingTip`。
- `toChapterPlotSceneDto()` 明确只输出 `summary/purpose/worldAnchor`，没有 Scene `writingTip`。
- `toChapterPlotDetailDto()` 是 UI/Workbench 面向章节 Plot 预览的 DTO，不是 writer handoff DTO。

`shared/dto/plot.dto.ts`:

- `ChapterPlotSceneDtoSchema` 当前字段：`id/threadId/threadTitle/threadIsMain/chapterPath/chapterSortOrder/threadSortOrder/title/status/summary/purpose/worldAnchor`。
- 缺 Scene `writingTip`。
- 缺 Thread `summary/writingTip`。

## Decision

brief v1 应新增 repository read model，不改胖 `ChapterPlotSceneDtoSchema`：

```ts
export type ChapterWriterBriefSceneWithThread = StoryScene & {
    thread: Pick<StoryThread, "id" | "title" | "isMainThread" | "summary" | "writingTip">;
};
```

Repository 增加：

```ts
findChapterScenesForBrief(chapterPath: string): Promise<ChapterWriterBriefSceneWithThread[]>;
```

查询规则：

- where: `{ chapterPath }`
- orderBy: `chapterSortOrder asc`, `id asc`
- include thread select:
  - `id`
  - `title`
  - `isMainThread`
  - `summary`
  - `writingTip`

不建议直接修改 `findChapterScenes()`，原因：

- 它已经是 UI 用读路径，变胖会扩大已有 API 和测试的无关变化。
- `ChapterPlotSceneDtoSchema` 是章节 Plot 预览，不应被 writer handoff 的信息需求牵着走。
- brief 后续要接 ChapterOverride，使用专用 read model 更容易扩展，不会把 UI DTO 变成混合接口。

## DTO Consequence

`ChapterWriterBriefSceneDtoSchema` 应显式声明字段，而不是只包 `ChapterPlotSceneDtoSchema`：

- `id`
- `title`
- `status`
- `summary`
- `purpose`
- `writingTip`
- `thread`
  - `id`
  - `title`
  - `isMainThread`
  - `summary`
  - `writingTip`
- `worldAnchor`
- `worldContext`
- `warnings`

其中 `writingTip` 字段语义：

- Scene `writingTip`：当前 Scene 对正文执行的局部写作提示。
- Thread `writingTip`：该长期线索对正文执行的持续写作提示。
- 二者都进入 DTO 和 `suggestedBriefMarkdown`，不能靠 profile prompt 让 Agent 自己再查。

## Test Surface

后续 Slice 3 应新增或扩展测试：

- repository/service fixture 中构造 Thread `summary/writingTip` 和 Scene `writingTip`。
- 断言 `ChapterWriterBriefDtoSchema` 接受这些字段。
- 断言 `suggestedBriefMarkdown` 同时包含 Scene writingTip 与 Thread summary/writingTip。
- 断言 UI 用 `ChapterPlotSceneDtoSchema` 不被要求包含这些 writer-facing 字段。

## Conclusion

brief v1 的查询深度应停在“章节 Scene + Thread writer-facing 摘要”。这比 tool 层串 `get_chapter_plot` 更系统，也比把 UI DTO 改胖更局部。实现时新增 `findChapterScenesForBrief()` 是当前最清晰的边界。
