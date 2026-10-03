# 2026-06-30 Round 55 - Brief Service Query Depth

## Scope

本轮核对 `ChapterWriterBriefService` 应如何查询章节 Scene、Thread summary 和 World Context。目标是在“不做过度抽象”和“避免 Agent tool 串调用”之间确定服务层深度。

本轮不修改业务代码。

## Evidence

当前 repository/service 状态：

- `SceneRepository.findChapterScenes(chapterPath)` 返回 `ChapterPlotSceneWithThread[]`。
- `ChapterPlotSceneWithThread.thread` 当前只 select `id/title/isMainThread`。
- `PlotDtoAssembler.toChapterPlotSceneDto()` 因此只能组装 thread title/main 信息，不包含 thread summary/writingTip。
- `ThreadRepository.findThreadById()` 可查单个 thread entity，包含 summary、tags、writingTip、note 等。
- `SceneService.getChapterPlotDetailDto()` 已复用 `PlotScopeGuard.assertChapterPath()`，并返回归一化后的 chapterPath。
- `SceneWorldContextService.getSceneWorldContext(projectPath, sceneId)` 已封装按 Scene 时间范围 + resolved subjects 查询 World Engine 上下文。

## Options

### Option A: service 复用 `SceneService.getChapterPlotDetailDto()`，再逐 thread 补查

优点：

- 直接复用现有章节 path 校验、Scene 排序和 DTO 组装。
- 第一版改动小。

缺点：

- 为 thread summary 需要额外 N 次 `findThreadById()`，或新增批量查。
- service 内要把 string scene id 转回 number 才能调 `getSceneWorldContext()`，略绕。

### Option B: 新增 `findChapterScenesForBrief()`

优点：

- 一次查询拿到 Scene + thread summary/writingTip/isMainThread。
- 直接服务 brief 需求，减少 service 内拼装。

缺点：

- 新增 repository contract 和 Prisma include 类型。
- 第一版若只是一章少量 Scene，收益可能不值得。

### Option C: 在 Agent tool 层串 `get_chapter_plot` + `get_scene_world_context`

优点：

- 不改 service/repository。

缺点：

- 业务逻辑散到 Agent tool。
- status 聚合、warnings、markdown renderer 无法复用到 HTTP/UI。
- Agent 可用性目标会变成“每个 Agent 自己会串工具”，不稳定。

## Recommendation

第一版采用 **Option B 的轻量版**：

- 新增 `findChapterScenesForBrief(chapterPath)`，在 `thread` select 中包含：
  - `id`
  - `title`
  - `isMainThread`
  - `summary`
  - `writingTip`
- 新增 core type，例如 `ChapterBriefSceneWithThread`。
- 在 `ChapterWriterBriefService` 中：
  1. 调 `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)`。
  2. 查 `findChapterScenesForBrief(normalizedChapterPath)`。
  3. 用 assembler 或 brief 专用 mapper 生成 scene DTO。
  4. 复用 `SceneWorldAnchorResolutionService.resolveMany()` 得到 resolved anchor。
  5. 对可查询 Scene 调 `SceneWorldContextService.getSceneWorldContext()`。
  6. 聚合 status/warnings/threadSummaries。
  7. 渲染 markdown。

理由：

- brief 是稳定业务能力，不应放到 Agent tool 编排。
- thread summary 是 writer handoff 的核心上下文，不应靠后续另一个 tool 补。
- 一章 Scene 数量通常有限，World Context 可以先逐 Scene 查询；性能问题出现后再 batch。

## Service Ownership

`ChapterWriterBriefService` 应在 `server/plot/services/` 下，归属 Plot module。它不应：

- 写 Plot 或 World Engine。
- 修改 `plot.selection`。
- 调 writer。
- 读取 writer target path。
- 引入 ChapterOverride 字段。

它可以：

- 读取 Plot Scene / Thread。
- 读取 Scene World Context。
- 生成 warnings/status/markdown。

## Result

`ChapterWriterBriefService` 应是 Plot 模块的只读深接口。推荐新增专用 repository 查询拿到 thread summary/writingTip，避免 brief service 退化成 Agent tool 串调用，也避免一次性引入复杂 batch World Context。

