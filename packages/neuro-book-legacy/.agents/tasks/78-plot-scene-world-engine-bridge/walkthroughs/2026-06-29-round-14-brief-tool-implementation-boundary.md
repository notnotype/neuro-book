# 2026-06-29 Round 14 - Brief Tool Implementation Boundary

## Scope

本轮继续探索 `get_chapter_writer_brief` 的实现边界。目标不是写业务代码，而是把 Task 78 和 Task 80 的职责切清楚，避免后续把 ChapterOverride、Plot Scene、World Engine context 混成一个不可维护的工具。

## Current Evidence

当前 worktree 证据：

- `shared/dto/plot.dto.ts` 只有 `ChapterPlotDetailDtoSchema`，没有 `ChapterWriterBriefDtoSchema`。
- `server/api/projects/plot/[...segments].ts` 只有 `GET chapter` 和 `GET scenes/:sceneId/world-context`，没有 chapter writer brief route。
- `server/agent/tools/plot-tools.ts` 只有 `get_chapter_plot`、`get_story_scene_context`、`get_scene_world_context` 等基础工具，没有 `get_chapter_writer_brief`。
- `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 没有 brief tool binding。
- Task 80 已明确把 `ChapterOverride` 与 `WriterBriefService` 单列为后续任务。

结论：`get_chapter_writer_brief` 仍是文档设计，不是已实现能力。

## Boundary Problem

`get_chapter_writer_brief` 这个名字同时承载两类需求：

1. **Task 78 需求**：让 Agent 更方便地把 Chapter scenes、Scene World Anchor、Scene World Context 串起来，减少手动多工具调用。
2. **Task 80 需求**：叠加 ChapterOverride，包括 POV、tone、节奏、读者/主角信息控制、禁写事项和章节收尾。

如果 Task 78 直接实现完整 `WriterBriefService`，会把 ChapterOverride 偷渡回 Task 78，违背当前任务边界。如果完全等 Task 80，Task 78 的 Agent 易用性缺口又会继续存在。

## Options

| 方案 | 做法 | 优点 | 风险 | 判断 |
| --- | --- | --- | --- | --- |
| A. Task 80 独占 `get_chapter_writer_brief` | Task 78 只修 prompt/routing，brief 工具等 Task 80。 | 边界最干净。 | Agent 仍要手动串 `get_chapter_plot` + 多次 `get_scene_world_context`；“Plot 工具易用性”目标不完整。 | 不推荐作为最终路径。 |
| B. Task 78 实现 `get_chapter_writer_brief` v1 | v1 只聚合 Chapter scenes + Thread summary + Scene World Context + warnings，不含 ChapterOverride。Task 80 后续扩展 DTO。 | Agent 立即可用；一个稳定工具名。 | 名字叫 writer brief，但 v1 缺 POV/tone/info-control，需要清楚标注。 | 推荐。 |
| C. Task 78 新增 `get_chapter_scene_brief`，Task 80 再新增 `get_chapter_writer_brief` | 两个工具名区分 Plot-only 与 writer-facing。 | 语义清楚。 | Agent 工具面变多；后续容易不知道该用哪个。 | 不推荐。 |

## Recommended Boundary

采用 **B：Task 78 实现 `get_chapter_writer_brief` v1，Task 80 扩展它**。

v1 的定义必须严格限制：

- 输入：`projectPath`、`chapterPath`。
- 读取：章内 scenes、parent thread summary、Scene World Anchor、Scene World Context。
- 输出：scene 顺序、thread 摘要、scene summary/purpose/writingTip、world query hints、warnings、suggested brief markdown。
- 不读取或写入 ChapterOverride。
- 不写 Plot。
- 不写 World Engine。
- 不调用 writer。
- 不替用户确认 canon。

Task 80 后续扩展：

- 增加 ChapterOverride 表、DTO、HTTP API 和 UI。
- 将 ChapterOverride 内容合并进同一个 `get_chapter_writer_brief` 输出。
- 把 `suggestedBriefMarkdown` 从 scene/world-only handoff 升级为完整 writer-facing handoff。

## DTO Implication

v1 DTO 应避免假装已经有 ChapterOverride。建议字段：

```ts
ChapterWriterBriefDto = {
    chapterPath: string;
    status: "ready" | "needs_plot" | "needs_world_anchor" | "needs_world_context";
    scenes: ChapterWriterBriefSceneDto[];
    worldQueryHints: string[];
    warnings: ChapterWriterBriefWarningDto[];
    suggestedBriefMarkdown: string;
};
```

不要在 v1 加空的 `pov`、`tone`、`doNotReveal` 等字段。它们属于 Task 80。

## Tool Exposure

第一期只给 `director`：

- `director` 是 Plot write owner，最需要把 Scene / World Context 编译成 handoff。
- `leader.default` 仍不拿 Plot 写工具。
- `writer` 不拿 Plot tools。

后续如果真实使用中 leader 调 director 的往返成本仍高，可以只给 `leader.default` 增加只读 `get_chapter_writer_brief`，仍不开放 create/update Plot tools。

## Implementation Order

建议顺序：

1. 先做 Round 15 的 prompt/routing/schema 去 simulator 化。
2. 再做 OpenAPI route-map 显式 path 支持，见 Round 16。
3. 再实现 `ChapterWriterBriefDtoSchema`、service、facade、HTTP route、Agent tool 和 director binding。
4. Task 80 再扩展 ChapterOverride。

## Result

本轮结论相对 Round 10/13 的调整：`get_chapter_writer_brief` 不必等待完整 ChapterOverride，但它的 v1 必须被定义为 scene/world-only brief。这样能推进 Task 78 的 Agent 易用性，同时不把 Task 80 的章节覆盖层提前塞回本任务。

