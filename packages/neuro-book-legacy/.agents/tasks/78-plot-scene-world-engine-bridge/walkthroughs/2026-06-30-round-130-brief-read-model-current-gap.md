# Round 130: Brief Read Model Current Gap

## Scope

本轮聚焦 Slice 3 `Chapter Writer Brief Module`，只读复查当前 Plot Module 的 DTO、repository、service、facade 和 HTTP route。目标是确认 `ChapterWriterBriefService` 应该复用什么、不能复用什么。没有改业务代码，没有运行测试。

## Current Evidence

### Existing Chapter Plot Interface

当前章节剧情入口是：

- HTTP：`GET /api/projects/plot/chapter?projectPath=&chapterPath=`
- handler：`server/api/projects/plot/[...segments].ts`
- facade：`PlotFacade.getChapterPlotDetailDto(projectPath, chapterPath)`
- service：`SceneService.getChapterPlotDetailDto(projectPath, chapterPath)`
- repository：`SceneRepository.findChapterScenes(chapterPath)`
- DTO：`ChapterPlotDetailDtoSchema`

这个 Interface 面向 UI / 当前章节 Plot 查看，返回：

- scene id / thread id / thread title / thread main flag
- chapter order / thread order
- scene title / status / summary / purpose
- worldAnchor

它缺少 brief v1 需要的两个 writer-facing 信息：

- Thread `summary` / `writingTip`
- Scene `writingTip`

`ChapterPlotSceneWithThread` 当前只包含：

```ts
thread: Pick<StoryThread, "id" | "title" | "isMainThread">;
```

`PlotDtoAssembler.toChapterPlotSceneDto()` 也没有输出 Scene `writingTip`。

### Existing Scene World Context Interface

当前 `SceneWorldContextService.getSceneWorldContext(projectPath, sceneId)` 是 HTTP strict 入口：

- 先 `storyService.ensureStory(projectPath)`。
- 再 `scopeGuard.assertScene(story.id, sceneId)`。
- 通过 `sceneRepository.findSceneById(sceneId)` 重新查 Scene。
- 如果 `startInstant` 或 `endInstant` 缺失，直接抛 `Scene 尚未设置完整 World Engine 时间范围`。
- 没有 subject / location 时返回空 context。
- 只有占位 subject 时返回 `unresolvedSubjectIds`，不查 slices / state。

已有测试覆盖：

- 按 Scene 时间和 subject/location 收窄。
- 缺时间范围会 reject。
- 无 subject/location 返回空 context。
- 只有 unresolved subject 返回 unresolved 且不查询切面/状态。

这个 Interface 适合 HTTP caller，不适合作为 brief service 的直接循环调用点。brief v1 需要聚合多个 Scene 的状态，并把缺 anchor / unresolved / 查询错误转成全章 status 和 warnings；如果逐 Scene 调 HTTP strict 方法再捕获 error message，会把业务规则分散到 caller。

### Existing Facade Module

`PlotFacade.createModuleFromExecutor()` 当前构建：

- `StoryService`
- `ThreadService`
- `SceneService`
- `SceneWorldContextService`
- `SceneWorldAnchorResolutionService` 作为 facade 私有字段，用于格式化 tree/workbench/thread/chapter DTO 的 anchor。

后续新增 `ChapterWriterBriefService` 时，推荐作为同级 Plot Module，而不是塞进 Agent tool 或 HTTP handler。

## Required Read Model

新增 repository 查询：

```ts
findChapterScenesForBrief(chapterPath: string): Promise<ChapterWriterBriefSceneRecord[]>
```

建议 record 包含：

- Scene：id, title, status, summary, purpose, writingTip, chapterPath, chapterSortOrder, threadSortOrder, startInstant, endInstant, subjectIdsJson, locationSubjectId
- Thread：id, title, isMainThread, summary, writingTip

不要扩胖 `findChapterScenes()`。它当前是 UI Interface，删除测试或前端时能单独演化；brief read model 是另一个 caller 需求。

## Required World Context Helper

在 `SceneWorldContextService` 内新增 Scene 实体级 helper，而不是由 brief service 捕获 HTTP 方法异常：

```ts
getSceneWorldContextForScene(projectPath: string, scene: StoryScene): Promise<SceneWorldContextDto>
```

职责划分：

- `getSceneWorldContext(projectPath, sceneId)` 保持 HTTP strict Adapter：assert story/scene、查 scene、缺时间直接抛。
- entity-level helper 接收已查出的 Scene，复用 subject resolution、slice/state 查询和 formatTime implementation。
- brief service 决定缺时间、无 subject/location、unresolved subject、查询错误分别如何进入 status/warnings。

这样 `SceneWorldContextService` 保持查询 Locality，`ChapterWriterBriefService` 保持 brief 状态 Locality。

## Brief Status Interpretation

延续既定优先级：

1. path error -> `needs_plot`
2. no scenes -> `needs_plot`
3. missing `startInstant` / `endInstant` -> `needs_world_anchor`
4. no subject and no location -> `needs_world_anchor`
5. unresolved subject exists -> `needs_world_context`
6. World Context query error -> `needs_world_context`
7. valid but empty context -> warning only, status 可继续 `ready`

这里要区分“没有 anchor”与“anchor 有效但上下文为空”：

- 没时间或没有 subject/location，brief 没有足够查询条件，属于 `needs_world_anchor`。
- 有时间、有 resolved subject/location，但查不到相关 slice，可能是剧情本章不需要动态事实或当前 World Engine 还没有对应记录；第一版可以 warning，不阻断 writer handoff。

## DTO Shape Guard

`ChapterWriterBriefDtoSchema` 不应复用 `ChapterPlotSceneDtoSchema` 作为 scene item。推荐显式 DTO：

- `status: "ready" | "needs_plot" | "needs_world_anchor" | "needs_world_context"`
- `chapterPath`
- `scenes[]`
  - scene id/title/status/summary/purpose/writingTip/order/worldAnchor
  - thread id/title/isMainThread/summary/writingTip
  - `worldContext`
  - `warnings[]`
- `warnings[]`
- `suggestedBriefMarkdown`

`suggestedBriefMarkdown` 是 writer handoff Interface；DTO 的其他字段是 caller / UI / tests 的 details。

## Test Shape

新增 `server/plot/services/chapter-writer-brief.service.test.ts`：

- `needs_plot`：章节存在但没有 scenes。
- `needs_world_anchor`：有 scene 但缺时间，或缺 subject/location。
- `needs_world_context`：存在 unresolved subject，或 World Context query throw。
- `ready`：scene anchor 有效，world context 成功；即使 slices 为空，也可以 ready + warning。
- markdown 正向断言：包含 chapter path、Scene title、Thread summary/writingTip、Scene writingTip、World Context 摘要和查询提示。
- markdown 负向断言：不包含 raw patch JSON、完整 attrs dump、伪造 ChapterOverride 字段。

新增或扩展 repository/facade 测试：

- repository 查询确实包含 Thread summary/writingTip 和 Scene writingTip。
- `PlotFacade.getChapterWriterBrief(projectPath, chapterPath)` 作为唯一外部 Plot Module Interface。
- HTTP route 只做 query 非空，路径归一化仍由 `PlotScopeGuard.assertChapterPath()` / service 处理。

## Stop Conditions

- 如果实现要通过 `getChapterPlotDetailDto()` 再补查 thread/scene writingTip，说明 UI DTO 被误当作 brief read model，应停止并新增 repository 查询。
- 如果实现需要捕获 `getSceneWorldContext()` 的错误 message 来判断 status，应停止并新增 Scene 实体级 helper。
- 如果 DTO 只返回 JSON，没有 `suggestedBriefMarkdown`，Agent 易用性目标没有完成。

## Conclusion

`ChapterWriterBriefService` 应是 Plot Module 内的 deep read model Module。它的 Interface 是 `{projectPath, chapterPath} -> ChapterWriterBriefDto`，背后集中章节 Scene 查询、World Anchor 判断、World Context 聚合、status precedence 和 markdown renderer。Agent tool、HTTP route 和 director profile 都只应作为 Adapter 调用它。
