# 2026-06-29 Round 06 - Chapter Writer Brief Design

## Scope

本轮基于 Round 05 的 DTO drift 发现，继续设计 `get_chapter_writer_brief`。目标是让 Agent 少串工具，同时不把 Plot 变成状态源。

## Design Goal

`get_chapter_writer_brief` 不是“自动写作大纲生成器”，而是一个只读聚合工具：

- 读取某章承载的 Scene 列表。
- 读取每个 Scene 的 parent Thread 信息。
- 对已连接 World Engine 的 Scene 查询 context。
- 汇总缺失信息、warning 和 writer query hint。
- 返回 leader/director 可直接改写成 `invoke_agent.message` 的素材。

它不应该：

- 替用户确认 canon。
- 写 World Engine。
- 自动补 Scene summary。
- 自动写 Chapter Override。
- 直接调用 writer。

## Proposed API

HTTP：

```text
GET /api/projects/plot/chapter-writer-brief?projectPath=...&chapterPath=...
```

Agent tool：

```text
get_chapter_writer_brief
```

Input：

```ts
{
    projectPath: string;
    chapterPath: string;
}
```

Output draft：

```ts
type ChapterWriterBriefDto = {
    chapterPath: string;
    status: "ready" | "needs_plot" | "needs_world_anchor" | "needs_world_context";
    scenes: ChapterWriterBriefSceneDto[];
    worldQueryHints: string[];
    warnings: ChapterWriterBriefWarningDto[];
    suggestedBriefMarkdown: string;
};

type ChapterWriterBriefSceneDto = {
    sceneId: string;
    title: string;
    order: number;
    threadId: string;
    threadTitle: string;
    threadSummary: string;
    summary: string;
    purpose: string | null;
    writingTip: string | null;
    worldAnchor: StorySceneWorldAnchorDto;
    worldContext: SceneWorldContextDto | null;
};

type ChapterWriterBriefWarningDto = {
    sceneId?: string;
    severity: "info" | "warning" | "blocking";
    code:
        | "chapter_has_no_scenes"
        | "scene_missing_summary"
        | "scene_missing_world_time"
        | "scene_missing_subjects"
        | "scene_has_unresolved_subjects"
        | "world_context_empty"
        | "world_context_query_failed";
    message: string;
};
```

## Status Semantics

- `ready`：有 Scene，关键 Scene 均有摘要；已连接 World Engine 的 Scene 查询成功。允许少量 info warning。
- `needs_plot`：章节没有 Scene，或 Scene 摘要为空，不足以生成 writer handoff。
- `needs_world_anchor`：Scene 需要世界状态但缺时间或 subject anchor。
- `needs_world_context`：World Context 查询失败，或 unresolved subjects 导致查询不可信。

`status` 不阻止用户自由写作，但要阻止 Agent 假装状态已确认。

## Suggested Brief Content

`suggestedBriefMarkdown` 应包含：

1. 章节目标：来自 Scene purpose / Thread summary 的压缩摘要。
2. Scene 顺序：章内 Scene 按 `chapterSortOrder`。
3. 世界查询提示：列出 subject id/name/time range。
4. 信息控制提醒：从 Scene summary / writingTip 中提取，不自动发明。
5. 写作约束：Scene writingTip、后续 Chapter Override。
6. 缺口：warning 原样列出，方便 leader 决定是否先补 Plot/World。

它不应包含：

- 完整 subject attrs JSON。
- patch JSON。
- slice id。
- 过长的 World Engine 原始状态。

## Service Composition

推荐新增服务：

```text
ChapterWriterBriefService
```

依赖：

- `SceneService.getChapterPlotDetailDto`
- `ThreadService.getStoryThreadDetailDto` 或 repository 批量查 thread summary
- `SceneWorldContextService.getSceneWorldContext`
- `SceneWorldAnchorResolutionService`（Round 05 建议）

性能注意：

- 对同一 chapter 的 scenes，应批量查 thread summary，避免每个 Scene 单独查 Thread。
- World Context 查询可以对 Scene 并发，但要限制并发数，避免一个大章触发过多 World Engine reduce。
- 第一版可以只对有完整 `start/end/subjectIds/location` 的 Scene 查询 World Context；缺项直接 warning。

## Agent Workflow

推荐普通写章流程：

1. leader/director 调 `get_chapter_writer_brief`。
2. 若 status 不是 `ready`，先修 Plot 或 World Anchor。
3. ready 后，leader 把 `suggestedBriefMarkdown` 精简后传给 writer。
4. writer 仍用 readonly `execute_world` 自查，brief 只是导航，不是真相源。

## Tests Needed

- 章节无 Scene：返回 `needs_plot` + `chapter_has_no_scenes`。
- Scene 缺 summary：返回 `needs_plot` 或 warning。
- Scene 缺时间：返回 `needs_world_anchor`。
- Scene 有 unresolved subjects：返回 `needs_world_context`。
- Scene context 查询成功：返回 `ready` + world query hints。
- Scene context 查询失败：不中断整章，记录 per-scene `world_context_query_failed`。
- Agent tool schema：`get_chapter_writer_brief` 能被 director 调用，返回 details。

## Implementation Boundary

这个工具不需要修改数据库。它应先作为只读聚合层落地。等 Chapter Override 模型确定后，再把 chapter-level POV / tone / ending hook 合并进去。

