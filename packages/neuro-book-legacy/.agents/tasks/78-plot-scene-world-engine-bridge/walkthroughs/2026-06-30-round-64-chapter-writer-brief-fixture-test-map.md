# 2026-06-30 Round 64 - Chapter Writer Brief Fixture Test Map

## Scope

本轮审计 `ChapterWriterBriefService` 的数据来源、fixture 形状和测试落点。目标是避免 brief v1 退化为 Agent tool 层临时串 `get_chapter_plot` + `get_scene_world_context`。

本轮不修改业务代码。

## Evidence

当前 `shared/dto/plot.dto.ts`：

- 已有 `ChapterPlotSceneDtoSchema` / `ChapterPlotDetailDtoSchema`。
- 已有 `SceneWorldContextDtoSchema`。
- 尚无 `ChapterWriterBriefDtoSchema`。
- `ChapterPlotSceneDtoSchema` 不包含 Scene `writingTip`，也不包含 thread `summary/writingTip`。

当前 `server/plot/contracts/plot-repositories.ts`：

- `SceneRepository.findChapterScenes(chapterPath)` 返回 `ChapterPlotSceneWithThread[]`。
- `ChapterPlotSceneWithThread.thread` 当前只 pick `id/title/isMainThread`。

当前 `server/plot/repositories/prisma-scene.repository.ts`：

- `findChapterScenes()` 的 Prisma select 只取 thread `id/title/isMainThread`。
- Scene 本体里有 `summary/purpose/writingTip/worldAnchor` 等字段，但 assembler 的 chapter DTO 没有全部暴露。

当前 `server/plot/services/scene-world-context.service.ts`：

- 已集中处理 Scene 时间范围、subject/location 去重、resolved/unresolved subject、slice/state 查询。
- 全部 unresolved 时返回空 context + `unresolvedSubjectIds`，不抛错。
- 缺完整时间范围时抛出 `Scene 尚未设置完整 World Engine 时间范围`。

## Service Interface

推荐新增 Plot 只读深 Module：

```ts
class ChapterWriterBriefService {
    async getChapterWriterBrief(projectPath: string, chapterPath: string): Promise<ChapterWriterBriefDto>
}
```

外部 Interface 只接受：

- `projectPath`
- `chapterPath`

不接受：

- `writerPath`
- `sceneId[]`
- raw instant
- ChapterOverride v2 字段

## Repository Query

推荐新增 `findChapterScenesForBrief(chapterPath)`，不要复用现有 `findChapterScenes()` 后再补多次 thread 查询。

该查询一次拿到：

- Scene：`id/chapterPath/chapterSortOrder/threadSortOrder/title/status/summary/purpose/writingTip/startInstant/endInstant/subjectIdsJson/locationSubjectId`
- Thread：`id/name/title/isMainThread/status/summary/writingTip`

原因：

- `ChapterWriterBriefService` 的 Interface 应该隐藏 brief 组装所需的查询复杂度。
- 如果 tool 层或 service 层先拿 `ChapterPlotDetailDto` 再补查 thread，会把 brief 的实现细节扩散到多个调用点。
- 这符合 Module Depth：调用方只学一个 brief Interface，就拿到 writer handoff 所需的结构化摘要和 markdown 草案。

## DTO Shape

`ChapterWriterBriefDtoSchema` 放在 `shared/dto/plot.dto.ts`，建议包含：

- `chapterPath`
- `status: "ready" | "needs_plot" | "needs_world_anchor" | "needs_world_context"`
- `scenes`
- `warnings`
- `suggestedBriefMarkdown`

每个 scene item 至少包含：

- Scene 标识、排序、标题、状态、summary、purpose、writingTip
- Thread 标识、标题、isMainThread、summary、writingTip
- resolved/unresolved World Anchor
- 可压缩后的 `SceneWorldContextDto`

`suggestedBriefMarkdown` 是 leader/director 可编辑文本，不是 raw JSON dump。

## Fixture Map

新增 `server/plot/services/chapter-writer-brief.service.test.ts`。

推荐 fixture：

1. `needs_plot`
   - 章节存在但没有挂载 Scene。
   - 不调用 World Context。
   - markdown 明确提示需要先规划/挂载 Scene。

2. `needs_world_anchor`
   - 至少一个 Scene 缺 `startInstant` 或 `endInstant`。
   - 不把时间未连接伪装成可写 brief。
   - markdown 列出缺 anchor 的 Scene。

3. `needs_world_context`
   - Scene 有完整时间，但 World Context 返回全部 unresolved subject。
   - 或 `SceneWorldContextService` 查询抛出非 path 类业务错误。
   - markdown 保留 Scene 计划，但明确不能作为 ready brief。

4. `ready_with_empty_context_warning`
   - Scene anchor 完整，subject 已解析，但时间范围内没有相关 slice。
   - status 可为 `ready`，但 `warnings` 提醒上下文为空。

5. `ready`
   - 多个 Scene 按 `chapterSortOrder/id` 稳定排序。
   - markdown 包含 Scene summary/purpose、thread summary/writingTip、World Context 摘要和 unresolved warning。
   - markdown 不包含 raw patch JSON、完整 attrs dump、伪造的 POV/tone/do-not-reveal/ChapterOverride 字段。

## HTTP / Facade Tests

实现 `GET /api/projects/plot/chapter-writer-brief?projectPath=...&chapterPath=...` 后，扩展：

- `server/api/projects/plot/[...segments].test.ts`
  - 缺 `projectPath` -> 400。
  - 缺 `chapterPath` -> 400。
  - 非法或不存在 chapterPath 继续由 `PlotScopeGuard.assertChapterPath()` 归一化和报错。
  - 成功返回 `ChapterWriterBriefDtoSchema` shape。

Facade 可只加薄测试或依赖 service/HTTP 测试；重点是不要让 Agent tool 自己承担业务组装。

## Result

brief v1 的实现重点是加深 Plot 的只读 brief Module，而不是给 Agent 多一个串工具脚本。只要 `ChapterWriterBriefService` 能在一个 Interface 后面集中处理 Scene、Thread、World Context 和 markdown，后续 ChapterOverride 扩展也能进入同一个 DTO / renderer，而不是分散到 profile prompt。

