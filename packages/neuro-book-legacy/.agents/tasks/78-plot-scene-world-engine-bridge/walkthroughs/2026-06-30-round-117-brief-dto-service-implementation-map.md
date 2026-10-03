# Round 117: Brief DTO Service Implementation Map

## Scope

本轮把 Slice 3 `Chapter Writer Brief Module` 压到当前 DTO/repository/facade 源码。目标是实现时避免复用 UI DTO 或在 Agent tool 层串调用。没有改业务代码、没有运行测试。

## Current Evidence

当前 `shared/dto/plot.dto.ts`：

- `StoryThreadSummaryDtoSchema` 已有 `summary` 和 `writingTip`。
- `StorySceneSummaryDtoSchema` 已有 `writingTip`。
- `ChapterPlotSceneDtoSchema` 只含 `threadTitle/threadIsMain`，没有 Thread `summary/writingTip`，也没有 Scene `writingTip`。
- 尚无 `ChapterWriterBriefDtoSchema`。

当前 `server/plot/contracts/plot-repositories.ts`：

- `SceneRepository.findChapterScenes(chapterPath)` 返回 `ChapterPlotSceneWithThread[]`。
- 尚无 `findChapterScenesForBrief()`。

当前 `server/plot/repositories/prisma-scene.repository.ts`：

- `findChapterScenes()` 的 thread select 只有 `id/title/isMainThread`。
- 这正好服务 UI chapter plot，不足以服务 writer brief。

当前 `server/plot/facade/plot.facade.ts`：

- 有 `getChapterPlotDetailDto(projectPath, chapterPath)`。
- 有 `getSceneWorldContext(projectPath, sceneId)`。
- 尚无 `getChapterWriterBrief(projectPath, chapterPath)`。

当前 `server/plot/services/scene-world-context.service.ts`：

- 公开 `getSceneWorldContext(projectPath, sceneId)`，缺完整时间范围时会抛错。
- brief service 需要把缺 anchor 聚合为 `needs_world_anchor`，不能直接用 HTTP strict 入口逐 Scene 捕获错误。

## DTO Shape

建议在 `shared/dto/plot.dto.ts` 新增：

```ts
export const ChapterWriterBriefStatusSchema = z.enum([
    "needs_plot",
    "needs_world_anchor",
    "needs_world_context",
    "ready",
]);
```

```ts
export const ChapterWriterBriefThreadDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    isMainThread: z.boolean(),
    summary: z.string(),
    writingTip: z.string().nullable(),
});
```

```ts
export const ChapterWriterBriefSceneDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    purpose: z.string().nullable(),
    writingTip: z.string().nullable(),
    chapterPath: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    thread: ChapterWriterBriefThreadDtoSchema,
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    worldContext: SceneWorldContextDtoSchema.nullable(),
    warnings: z.array(z.string()),
});
```

```ts
export const ChapterWriterBriefDtoSchema = z.object({
    chapterPath: z.string(),
    status: ChapterWriterBriefStatusSchema,
    warnings: z.array(z.string()),
    scenes: z.array(ChapterWriterBriefSceneDtoSchema),
    suggestedBriefMarkdown: z.string(),
});
```

不要让 `ChapterWriterBriefSceneDtoSchema` 只包 `ChapterPlotSceneDtoSchema`。UI DTO 的 Interface 太浅，缺 writer 需要的 Thread/Scene writing guidance。

## Repository Shape

新增 read model 类型，例如：

```ts
export type ChapterWriterBriefSceneWithThread = StoryScene & {
    thread: Pick<StoryThreadEntity, "id" | "title" | "isMainThread" | "summary" | "writingTip">;
};
```

并在 `SceneRepository` 增加：

```ts
findChapterScenesForBrief(chapterPath: string): Promise<ChapterWriterBriefSceneWithThread[]>;
```

排序应与 `findChapterScenes()` 一致：

- `chapterSortOrder asc`
- `id asc`

这样 UI chapter plot 和 writer brief 拥有各自 Interface，不互相加字段。

## Service Shape

新增 `ChapterWriterBriefService`，与 `SceneWorldContextService` 同级。Interface：

```ts
getChapterWriterBrief(projectPath: string, chapterPath: string): Promise<ChapterWriterBriefDto>
```

职责：

- `PlotScopeGuard.assertChapterPath()`。
- 归一化 chapterPath。
- 调 `findChapterScenesForBrief()`。
- 调 Scene entity-level World Context helper。
- 聚合 status/warnings。
- 渲染 `suggestedBriefMarkdown`。

不负责：

- 不写 Plot。
- 不写 World Engine。
- 不读写 `plot.selection`。
- 不决定 writer target path。
- 不伪造 Task 80 的 ChapterOverride。

## Scene World Context Helper

`SceneWorldContextService` 应新增内部/public helper，例如：

```ts
getSceneWorldContextForBrief(projectPath: string, scene: StoryScene): Promise<SceneWorldContextDto>
```

语义：

- scene 缺 `startInstant/endInstant` 时不由 helper 抛 HTTP 400；brief service 先检测并生成 `needs_world_anchor`。
- unresolved subjects 保留为 `unresolvedSubjectIds`。
- query/format 失败转为 scene warning 和 `needs_world_context`。
- 空但有效 context 不阻断，允许 `ready`。

不要靠捕获 `getSceneWorldContext(sceneId)` 的错误 message 来判断缺 anchor。

## Facade And HTTP

`PlotFacade` 新增：

```ts
getChapterWriterBrief(projectPath: string, chapterPath: string): Promise<ChapterWriterBriefDto>
```

HTTP route：

```text
GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=
```

只做 query 非空和 DTO parse，业务 path 校验在 service/guard。

## Tests

Slice 3 建议覆盖：

- DTO schema parse。
- repository query includes thread summary/writingTip and scene writingTip。
- service fixture：
  - invalid path throws。
  - no scenes -> `needs_plot`。
  - missing anchor -> `needs_world_anchor`。
  - unresolved / query error -> `needs_world_context`。
  - empty valid context -> `ready` or warning-only。
  - ready -> markdown can hand off to writer。
- markdown assertions：
  - contains scene/thread guidance。
  - contains world anchor/context summary。
  - does not contain raw patch JSON/full attrs/ChapterOverride/writer output path。

## Conclusion

Slice 3 的核心不是新增一个 route，而是新增一个 deep read model Module。`ChapterWriterBriefService` 应集中 brief 业务语义，HTTP 和 Agent tool 都只是 Adapter。

