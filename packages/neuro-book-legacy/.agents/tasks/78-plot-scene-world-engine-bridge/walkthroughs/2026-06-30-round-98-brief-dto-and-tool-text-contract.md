# Round 98: Brief DTO and Tool Text Contract

## Scope

本轮继续只读探索 `ChapterWriterBriefDto` v1 的最小公开合同，以及 `get_chapter_writer_brief` tool 应返回什么文本给 Agent。没有改业务代码、没有运行测试。

## Current Evidence

- `shared/dto/plot.dto.ts` 是 Plot 对外 DTO 的稳定 seam，当前包含 `StorySceneWorldAnchorDtoSchema`、`SceneWorldContextDtoSchema`、`ChapterPlotSceneDtoSchema` 和类型导出。
- `StorySceneSummaryDtoSchema` 已包含 `writingTip`，但 `ChapterPlotSceneDtoSchema` 不包含 `writingTip`。
- `ChapterPlotSceneDtoSchema` 只包含 `threadId/threadTitle/threadIsMain`，不包含 `Thread.summary` 或 `Thread.writingTip`。
- `SceneWorldContextDtoSchema` 已包含 `subjectStates.attrs`，因此 JSON details 中可保留结构化 state；但 markdown 不应 dump 完整 attrs。
- `plotResult()` 当前把完整 DTO `JSON.stringify(details, null, 2)` 放进 tool text。这适合普通 Plot DTO，但不适合 writer brief：brief 的核心 handoff 是 `suggestedBriefMarkdown`，不是 raw JSON。
- `worldResult()` 已经采用双消费者模式：`content[0].text` 面向模型阅读，`details` 保留结构化 JSON。这是 `get_chapter_writer_brief` 更合适的输出模式。
- Round 54 的草案建议 `ChapterWriterBriefSceneDtoSchema.scene = ChapterPlotSceneDtoSchema`。按 Round 96 的当前代码证据，这会漏掉 Scene `writingTip`，因此需要修正。

## DTO Decision

`ChapterWriterBriefDtoSchema` 仍应归属 `shared/dto/plot.dto.ts`，但 v1 不应把 `ChapterPlotSceneDtoSchema` 作为 scene item 的唯一主体。

推荐最小 shape：

```ts
export const ChapterWriterBriefStatusSchema = z.enum([
    "ready",
    "needs_plot",
    "needs_world_anchor",
    "needs_world_context",
]);

export const ChapterWriterBriefThreadDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    isMainThread: z.boolean(),
    summary: z.string(),
    writingTip: z.string().nullable(),
});

export const ChapterWriterBriefSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    chapterPath: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    purpose: z.string().nullable(),
    writingTip: z.string().nullable(),
    thread: ChapterWriterBriefThreadDtoSchema,
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    worldContext: SceneWorldContextDtoSchema.nullable(),
    warnings: z.array(z.string()),
});

export const ChapterWriterBriefDtoSchema = z.object({
    chapterPath: z.string(),
    status: ChapterWriterBriefStatusSchema,
    scenes: z.array(ChapterWriterBriefSceneDtoSchema),
    warnings: z.array(z.string()),
    suggestedBriefMarkdown: z.string(),
});
```

不建议单独保留 top-level `threadSummaries` v1 必填字段。每个 Scene 内嵌 thread summary 更符合 writer handoff 的阅读顺序；如后续 UI 需要跨 Scene dedupe，再在 DTO 中增加派生 `threads`，不要让第一版同时维护两套等价结构。

## Warning Decision

v1 继续使用 `warnings: string[]`，不先引入 warning code enum。

原因：

- brief status 已经提供机器可判定状态；调用方不需要 parse warning string 才能分支。
- warning 主要面向 leader/director 编辑 brief 和 writer handoff 前检查。
- 过早引入 code taxonomy 会把第一版测试面扩大到错误分类，而当前更重要的是 status precedence 和 markdown 信息边界。

如果后续 UI 要按 warning 类型筛选，再把 warning 扩展为 `{code, level, message, sceneId?}`，并保留 renderer 的单一出口。

## Tool Text Decision

`get_chapter_writer_brief` 不应直接复用当前 `plotResult()` 的文本渲染。它应采用专用 wrapper：

- `content[0].text = dto.suggestedBriefMarkdown`
- `details = dto`

这样对模型可读文本是 handoff 草案，避免把 raw attrs、internal JSON shape 和 warning details 全部推到主上下文；同时 `details` 仍保留完整结构，供 UI、测试、调试和后续自动处理使用。

这不是破坏 Plot tool 风格，而是把 tool text 的 Interface 调整为 brief 的真实主要产物。普通 Plot tools 返回 JSON；brief tool 返回 markdown + structured details。

## Acceptance Impact

Slice 3 / Slice 4 实现时应修正验收：

1. `ChapterWriterBriefSceneDtoSchema` 必须显式包含 Scene `writingTip`，不能只包 `ChapterPlotSceneDtoSchema`。
2. scene item 内必须携带 Thread `summary/writingTip`。
3. `suggestedBriefMarkdown` 必填，且 tool text 应等于或以它为主体，而不是完整 JSON。
4. `details` 必须保留完整 `ChapterWriterBriefDto`。
5. markdown fixture 继续断言不包含 raw patch JSON、完整 attrs dump、伪造 ChapterOverride 字段。
6. OpenAPI route-map 使用 `ChapterWriterBriefDtoSchema` 作为 response body，不单独定义 tool-only output schema。

## Plan Deviation

本轮原计划确认 DTO/tool 输出边界；实际新增一条修正：Round 54 的“scene 复用 `ChapterPlotSceneDtoSchema`”应被 Round 98 取代。第一版 brief DTO 要使用专用 scene item，同时复用更底层的 `StorySceneWorldAnchorDtoSchema`、`SceneWorldContextDtoSchema` 和 `StorySceneStatusSchema`。
