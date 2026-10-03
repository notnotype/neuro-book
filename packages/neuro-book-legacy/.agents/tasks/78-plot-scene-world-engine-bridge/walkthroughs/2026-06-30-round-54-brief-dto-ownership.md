# 2026-06-30 Round 54 - Brief DTO Ownership

## Scope

本轮核对 `get_chapter_writer_brief` v1 的 DTO 应放在哪里、应该包含什么、哪些字段不应进入 v1。目标是避免 service、HTTP、Agent tool 各自发明一套 brief shape。

本轮不修改业务代码。

## Evidence

当前 `shared/dto/plot.dto.ts` 已集中承载 Plot 对外合同：

- `ChapterPlotDetailDtoSchema`
- `ChapterPlotSceneDtoSchema`
- `SceneWorldContextDtoSchema`
- `StorySceneWorldAnchorDtoSchema`
- 对应 `z.infer` 类型导出

当前 Chapter Plot DTO 已有：

- Scene id / title / status / summary / purpose
- thread id / title / isMainThread
- chapter sort / thread sort
- resolved `worldAnchor`

当前 Scene World Context DTO 已有：

- filtered slices 摘要
- subject state names/types/attrs
- unresolved subject ids

这说明 `ChapterWriterBriefDtoSchema` 应继续放在 `shared/dto/plot.dto.ts`，作为 Plot HTTP/API/Agent tool 的公共合同，而不是只放在 `server/plot` 内部类型里。

## Proposed DTO Shape

建议新增：

```ts
export const ChapterWriterBriefStatusSchema = z.enum([
    "ready",
    "needs_plot",
    "needs_world_anchor",
    "needs_world_context",
]);
```

```ts
export const ChapterWriterBriefSceneDtoSchema = z.object({
    scene: ChapterPlotSceneDtoSchema,
    worldContext: SceneWorldContextDtoSchema.nullable(),
    worldQueryHints: z.object({
        subjectIds: z.array(z.string()),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
    }),
    warnings: z.array(z.string()),
});
```

```ts
export const ChapterWriterBriefThreadSummaryDtoSchema = z.object({
    threadId: z.string(),
    title: z.string(),
    isMainThread: z.boolean(),
    summary: z.string(),
    writingTip: z.string().nullable(),
});
```

```ts
export const ChapterWriterBriefDtoSchema = z.object({
    chapterPath: z.string(),
    status: ChapterWriterBriefStatusSchema,
    scenes: z.array(ChapterWriterBriefSceneDtoSchema),
    threadSummaries: z.array(ChapterWriterBriefThreadSummaryDtoSchema),
    warnings: z.array(z.string()),
    suggestedBriefMarkdown: z.string(),
});
```

## Include / Exclude

v1 应包含：

- normalized `chapterPath`
- status
- ordered scenes
- per-scene world context summary 或 null
- per-scene warnings
- deduplicated thread summaries
- top-level warnings
- `suggestedBriefMarkdown`

v1 不应包含：

- raw patch JSON
- full unbounded subject attrs dumped into markdown
- writer target path / `writerPath`
- ChapterOverride 的 POV、tone、do-not-reveal 等字段
- raw `Instant` bigint 作为主要人读字段

保留 `worldContext.subjectStates.attrs` 在 JSON details 中是可接受的，因为 `SceneWorldContextDto` 已经如此定义；但 markdown renderer 不应完整展开 attrs，除非后续有字段白名单。

## Schema Ownership Rule

`shared/dto/plot.dto.ts` 是唯一公开 DTO shape。后续实现不应：

- 在 Agent tool 中定义另一个不一致的 `ChapterWriterBrief` TypeBox schema。
- 在 HTTP handler 中手写 response shape。
- 在 markdown renderer 里拼一个只含部分字段的隐式合同。

Agent tool 的 TypeBox 参数 schema 可以独立定义，因为它描述 tool input；但 tool output details 应直接使用 service 返回的 `ChapterWriterBriefDto`。

## Result

`ChapterWriterBriefDtoSchema` 应归属 `shared/dto/plot.dto.ts`，并复用已有 `ChapterPlotSceneDtoSchema` 与 `SceneWorldContextDtoSchema`。这样 HTTP、service、tool、OpenAPI 和测试共享同一个合同，减少 DTO drift。

