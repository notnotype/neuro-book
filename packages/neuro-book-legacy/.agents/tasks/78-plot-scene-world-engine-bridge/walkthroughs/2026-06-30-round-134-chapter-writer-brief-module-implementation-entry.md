# Round 134: Chapter Writer Brief Module Implementation Entry

## Scope

本轮继续只读探索 Slice 3 `Chapter Writer Brief Module` 的实际开工入口。Round 130 已经确认 read model gap；本轮把 DTO、repository、service、facade、HTTP route 和测试顺序压成可执行补丁线。没有修改业务代码，没有运行测试。

## Current Evidence

### Existing Chapter Plot DTO Is UI-facing

`shared/dto/plot.dto.ts` 当前有：

- `ChapterPlotSceneDtoSchema`
- `ChapterPlotDetailDtoSchema`

`ChapterPlotSceneDtoSchema` 包含：

- scene id / thread id / thread title / thread main flag
- chapter path / chapter order / thread order
- scene title / status / summary / purpose
- worldAnchor

它不包含：

- Scene `writingTip`
- Thread `summary`
- Thread `writingTip`
- per-scene `worldContext`
- per-scene warnings
- `suggestedBriefMarkdown`

因此它是 UI Interface，不应被扩胖成 writer brief Interface。

### Existing Repository Query Is Too Narrow

`server/plot/core/types.ts` 当前：

```ts
export type ChapterPlotSceneWithThread = StoryScene & {
    thread: Pick<StoryThread, "id" | "title" | "isMainThread">;
};
```

`server/plot/repositories/prisma-scene.repository.ts` 的 `findChapterScenes()` 只 select thread：

- `id`
- `title`
- `isMainThread`

`server/plot/assemblers/plot-dto.assembler.ts` 的 `toChapterPlotSceneDto()` 不输出 Scene `writingTip`。这再次证明 current chapter plot read model 不够支撑 writer brief。

### Existing Scene World Context Is HTTP-strict

`SceneWorldContextService.getSceneWorldContext(projectPath, sceneId)` 当前职责：

- `ensureStory(projectPath)`
- `scopeGuard.assertScene(story.id, sceneId)`
- `findSceneById(sceneId)`
- 缺 `startInstant/endInstant` 时直接抛 `Scene 尚未设置完整 World Engine 时间范围`
- subject/location 为空时返回空 context
- unresolved subject 全部无法解析时返回 unresolved 且不查 slices/state

这适合作为 HTTP Adapter 的 strict read 方法，不适合 brief service 逐 Scene 捕获错误 message 做状态聚合。brief 需要把缺 anchor、unresolved、query error 转成全章 status/warnings。

### Composition Root

`PlotFacade.createModuleFromExecutor()` 当前构建：

- `StoryService`
- `ThreadService`
- `SceneService`
- `SceneWorldContextService`
- `RefResolverService`

`SceneWorldAnchorResolutionService` 是 facade 私有字段，用于格式化 tree/workbench/thread/chapter DTO 的 resolved anchor。

`ChapterWriterBriefService` 应作为 `SceneWorldContextService` 同级的 Plot Module read model Module 接入，而不是塞进 HTTP handler 或 Agent tool。

### HTTP Route

`server/api/projects/plot/[...segments].ts` 当前已有：

- `GET /api/projects/plot/chapter?projectPath=&chapterPath=`
- `GET /api/projects/plot/scenes/:sceneId/world-context?projectPath=`

没有 `chapter-writer-brief` branch。后续 route 建议是：

```text
GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=
```

HTTP layer 只做 query 非空，chapter path 归一化和存在性语义仍交给 Plot Module。

## Target Module Interface

新增 DTO：

```ts
type ChapterWriterBriefStatus =
    | "ready"
    | "needs_plot"
    | "needs_world_anchor"
    | "needs_world_context";

type ChapterWriterBriefDto = {
    status: ChapterWriterBriefStatus;
    chapterPath: string;
    scenes: ChapterWriterBriefSceneDto[];
    warnings: string[];
    suggestedBriefMarkdown: string;
};
```

scene item 应显式包含：

- Scene：id, title, status, summary, purpose, writingTip, chapterPath, chapterSortOrder, threadSortOrder, worldAnchor
- Thread：id, title, isMainThread, summary, writingTip
- `worldContext: SceneWorldContextDto | null`
- `warnings: string[]`

不要把 scene item 定义为 `ChapterPlotSceneDtoSchema.extend(...)`，因为 UI DTO 缺字段会继续诱导 caller 复用错误 Interface。

## Implementation Entry Order

1. **DTO patch**
   - 在 `shared/dto/plot.dto.ts` 新增 `ChapterWriterBriefStatusSchema`、`ChapterWriterBriefSceneDtoSchema`、`ChapterWriterBriefDtoSchema` 和 type exports。
   - DTO 明确 `suggestedBriefMarkdown` 是 caller-facing handoff text。
   - `SceneWorldContextDtoSchema` 可复用，但不要输出 raw patch JSON。

2. **Repository read model patch**
   - 新增 record type，例如 `ChapterWriterBriefSceneRecord`。
   - 新增 `SceneRepository.findChapterScenesForBrief(chapterPath)`.
   - Prisma select 必须拿到 Thread `summary/writingTip` 和 Scene `writingTip`。
   - 保留 `findChapterScenes()` 不变，避免 UI Interface 被 brief 需求污染。

3. **SceneWorldContextService helper patch**
   - 保留 `getSceneWorldContext(projectPath, sceneId)` 的 HTTP-strict behavior。
   - 新增 entity-level helper，例如：

```ts
getSceneWorldContextForScene(projectPath: string, scene: StoryScene): Promise<SceneWorldContextDto>
```

   - helper 复用 subject/location resolution、listSlices、queryState、formatTime implementation。
   - helper 不做 `scopeGuard.assertScene()`，因为 caller 已经通过 repository/read model 拿到 Scene。

4. **ChapterWriterBriefService patch**
   - 新增 `server/plot/services/chapter-writer-brief.service.ts`。
   - Interface：`getChapterWriterBrief(projectPath, chapterPath): Promise<ChapterWriterBriefDto>`。
   - 内部负责：
     - `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)`
     - `findChapterScenesForBrief(normalizedChapterPath)`
     - status precedence
     - per-scene world context query
     - warnings aggregation
     - `suggestedBriefMarkdown` renderer

5. **Facade / composition patch**
   - `PlotModule` 增加 `chapterWriterBriefService`。
   - `createModuleFromExecutor()` 构建 service。
   - `PlotFacade` 增加 `getChapterWriterBrief(projectPath, chapterPath)`。
   - Facade 是 HTTP route 和 future Agent tool 唯一调用入口。

6. **HTTP route patch**
   - 在 `projects/plot/[...segments].ts` 增加 `GET chapter-writer-brief` branch。
   - 使用 `requireProjectPathQuery(event)` + `requireChapterPathQuery(event)`。
   - 返回 `plotFacade.getChapterWriterBrief(projectPath, chapterPath)`。

7. **Route-map/OpenAPI patch**
   - 依赖 Slice 2 explicit path 已完成。
   - DTO 存在后再给 `routeMetaMap` 增加 `chapter-writer-brief` entry。
   - 该 entry 可 `emitRouteMeta: false`，canonical spec 仍包含它，route-local representative 仍保留 world-context。

## Status Precedence

全章 status 按最严重状态聚合：

1. `needs_plot`
   - chapter path invalid
   - chapter has no scenes
2. `needs_world_anchor`
   - any scene missing `startInstant/endInstant`
   - any scene has no subject and no location
3. `needs_world_context`
   - any scene has unresolved subject/location
   - any world context query throws
4. `ready`
   - all scenes have enough anchor and world context query completed

有效但 empty context 不阻断 writer handoff；加 warning 即可。

## Markdown Renderer Boundary

`suggestedBriefMarkdown` 第一版留在 `ChapterWriterBriefService` Implementation 内，不提前抽 shared Module。它必须包含：

- chapter path
- overall status
- warnings
- Scene order / title / summary / purpose / writingTip
- Thread title / summary / writingTip
- World Anchor readable summary
- World Context slices / subject state 摘要
- writer 可按需查询 World Engine 的提示

它必须排除：

- raw patch JSON
- 完整 attrs dump
- 伪造 ChapterOverride 字段，如 POV/tone/do-not-reveal/ending beat
- writer target path，writer target 仍由 `invoke_agent.input.path` 提供

## Minimum Test Matrix

### DTO

- `ChapterWriterBriefDtoSchema` 接受 ready / needs_* 四种状态。
- scene item 必须能表达 Scene `writingTip` 和 Thread `summary/writingTip`。
- `suggestedBriefMarkdown` 必填。

### Service fixture

新增 `server/plot/services/chapter-writer-brief.service.test.ts`：

- invalid path -> `needs_plot` 或按当前 error policy 抛可控错误，但不要误标 ready。
- no scenes -> `needs_plot`。
- missing time -> `needs_world_anchor`。
- no subject/location -> `needs_world_anchor`。
- unresolved subject -> `needs_world_context`。
- world context query throw -> `needs_world_context`。
- valid context -> `ready`。
- valid but empty context -> `ready` + warning。
- markdown positive assertions：包含 Thread summary/writingTip、Scene writingTip、Scene/World context 摘要。
- markdown negative assertions：不含 raw patch JSON、完整 attrs dump、伪造 ChapterOverride 字段。

### Repository / facade / HTTP

- repository 查询包含 thread summary/writingTip 与 Scene writingTip。
- facade 调用 service，外部不绕过 service。
- HTTP route query 缺失时仍按现有 query validation 报错。
- HTTP route 不承担 status precedence。

## Stop Conditions

- 通过扩胖 `ChapterPlotSceneDtoSchema` 实现 brief：停止。UI Interface 和 writer brief Interface 应分开。
- 通过 `getChapterPlotDetailDto()` + 额外查库补字段：停止。应新增 dedicated read model。
- brief service 捕获 `getSceneWorldContext()` error message 判断状态：停止。应新增 Scene entity-level helper。
- `suggestedBriefMarkdown` 不存在或只返回 JSON：停止。Agent 易用性目标未满足。
- DTO 需要 `any` / `unknown` 才能表达 world context 或 warnings：停止，说明 DTO 设计不清。
- 在 Slice 2 未完成前把 OpenAPI catch-all 多 operation 当成已解决：停止，先完成 explicit path。

## Deep Module Check

`ChapterWriterBriefService` 是本 slice 的深 Module。它的 Interface 小：`projectPath + chapterPath -> ChapterWriterBriefDto`。它的 Implementation 集中 chapter scene read model、World Anchor 判断、World Context 查询、status/warnings 聚合和 markdown renderer。

HTTP route 与 Agent tool 都应是浅 Adapter。删除 `ChapterWriterBriefService` 后，复杂度会回流到 route、tool 和 director prompt；删除 Adapter 只会失去一个调用入口。因此业务语义必须集中在 service，才能获得 Locality 和可测试性。

## Conclusion

当前 worktree 尚未实现 Slice 3。下一步真正开工时，应先完成 Slice 1 / Slice 2，然后按 DTO -> repository read model -> SceneWorldContext helper -> `ChapterWriterBriefService` -> facade -> HTTP route -> route-map/OpenAPI 的顺序落地。这样 future `get_chapter_writer_brief` tool 只需做 selection-free Adapter，不会承载业务逻辑。
