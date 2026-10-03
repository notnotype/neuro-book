# 2026-06-30 Round 26 - Brief V1 Status Contract

## Scope

本轮把 `get_chapter_writer_brief` v1 收敛到可实现的 DTO/status/test 合同。目标是让 director 能一键取得 writer 可用的 scene/world-only brief，同时不提前实现 Task 80 的 ChapterOverride。

本轮不修改业务代码。

## Interface

建议新增 `ChapterWriterBriefDto`：

```ts
{
    chapterPath: string;
    status: "ready" | "needs_plot" | "needs_world_anchor" | "needs_world_context";
    scenes: ChapterWriterBriefSceneDto[];
    threadSummaries: Array<{
        threadId: string;
        title: string;
        summary: string;
        isMainThread: boolean;
    }>;
    worldQueryHints: Array<{
        sceneId: string;
        subjectIds: string[];
        timeRange: {startTime: string | null; endTime: string | null};
    }>;
    warnings: string[];
    suggestedBriefMarkdown: string;
}
```

`ChapterWriterBriefSceneDto` 可从 `ChapterPlotSceneDto` 扩展，不需要塞完整 raw patch JSON。必要字段：

- scene id/title/order/status。
- thread id/title。
- summary/purpose/writingTip。
- resolved `worldAnchor`。
- filtered world context summary：slice title/time/summary/patchCount，subject state names/types；attrs 第一版可不直接写入 markdown。
- warnings。

## Status Rules

### `needs_plot`

条件：

- 章节没有 Scene。
- Scene 缺少可写作的 summary/purpose，导致 writer 只能凭空发挥。

行动：

- director 先补 Scene、顺序、summary 和 purpose。

### `needs_world_anchor`

条件：

- 任一关键 Scene 缺少完整 `startInstant/endInstant`。
- Scene 有时间但没有任何 subject，且该 Scene 明显需要查状态。

行动：

- director 先补 worldAnchor；如果时间或 subject 未被 canon 确认，返回 `world_engine_requests/open_questions` 给 leader。

### `needs_world_context`

条件：

- World Engine 查询失败。
- 所有需要查询的 subject 都 unresolved。
- `calendar.ts` 损坏，无法可靠格式化时间或查询。

行动：

- leader 处理 World Engine 数据或让 world.engine 修复 schema/calendar/subject。

### `ready`

条件：

- 章节已有可写 Scene 顺序。
- 关键 Scene 有足够 summary/purpose。
- World Anchor 足以生成查询提示。
- World Context 查询没有阻塞性错误。

注意：

- 有部分 unresolved subject 时可以仍为 `ready`，但必须进入 warnings。
- 缺 ChapterOverride 不应把状态降级；它只在 markdown 中提示 POV/tone/info-control 需要 leader 补充。

## Service Flow

建议实现 `ChapterWriterBriefService`，而不是在 Agent tool 内串调用：

1. `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)`。
2. 用 repository 新增 `findChapterScenesForBrief(chapterPath)`，include thread summary/writingTip/isMainThread。
3. 用 `PlotDtoAssembler` 或专用 assembler 形成 scene DTO，并复用已存在的 World Anchor resolution。
4. 对每个有完整时间与 subject 的 Scene 调 `SceneWorldContextService.getSceneWorldContext()`。
5. 聚合 status、warnings、query hints。
6. 渲染 `suggestedBriefMarkdown`。

第一版允许逐 Scene 查询 World Context。通常一章 Scene 数量有限，先换取清晰 Locality；若真实性能不足，再做 batch context Module。

## HTTP And Tool

建议新增：

- `GET /api/projects/plot/chapter-writer-brief?projectPath=...&chapterPath=...`
- Agent tool `get_chapter_writer_brief`
- `builtin.plot.getChapterWriterBrief`
- director profile 持有该 tool

在新增 route-map 前必须先做 OpenAPI `RouteMetaEntry.path?: string`，否则 `projects/plot/[...segments].ts` 会把多个 GET operation 都生成到 `/api/projects/plot/[...segments].ts` 推导路径上，互相覆盖。

## Markdown Contract

`suggestedBriefMarkdown` 必须：

- 可直接作为 `invoke_agent.message` 的基础。
- 包含 target chapter、Scene order、Thread context、World query hints、Warnings。
- 不包含 raw patch JSON。
- 不编造 POV/tone/do-not-reveal。
- 明确 `input.path` 才是 writer 的唯一写入目标。

## Tests

聚焦测试：

- DTO schema 校验 `suggestedBriefMarkdown` 必填。
- 无 Scene 返回 `needs_plot`。
- 缺时间返回 `needs_world_anchor`。
- unresolved subject 进入 warnings。
- World Context 查询失败返回 `needs_world_context`。
- `suggestedBriefMarkdown` 包含 Scene 顺序、thread summary、world query hints。
- `suggestedBriefMarkdown` 不包含 raw patch JSON。
- 缺 ChapterOverride 时不生成虚假的 POV/tone/do-not-reveal。
- director toolKeys 含 `get_chapter_writer_brief`，leader/writer 仍不含 Plot 写工具。

## Result

本轮结论：brief v1 的核心 Interface 是 `status + warnings + suggestedBriefMarkdown`。JSON details 用于 UI/工具，`suggestedBriefMarkdown` 用于 profile 协作。该 Module 的 Depth 来自把“章节 Scene 顺序 + World Anchor + World Context + writer handoff markdown”集中在一个只读 Interface 后面，避免每个 Agent 自己手动串 Plot 和 World Engine。

