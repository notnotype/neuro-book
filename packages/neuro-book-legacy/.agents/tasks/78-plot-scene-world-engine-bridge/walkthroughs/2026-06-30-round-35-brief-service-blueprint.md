# 2026-06-30 Round 35 - Brief Service Blueprint

## Scope

本轮把 `ChapterWriterBriefService` 的第一阶段实现拆成 Module blueprint。目标是让后续实现集中在一个只读 Interface 上，避免 Agent tool handler 手动串 Plot 和 World Context。

本轮不修改业务代码。

## Module Interface

建议 Facade 入口：

```ts
getChapterWriterBrief(projectPath: string, chapterPath: string): Promise<ChapterWriterBriefDto>
```

建议 DTO：

```ts
type ChapterWriterBriefDto = {
    chapterPath: string;
    status: "ready" | "needs_plot" | "needs_world_anchor" | "needs_world_context";
    scenes: ChapterWriterBriefSceneDto[];
    threadSummaries: ChapterWriterBriefThreadDto[];
    worldQueryHints: ChapterWriterBriefWorldQueryHintDto[];
    warnings: string[];
    suggestedBriefMarkdown: string;
};
```

第一阶段不加入 ChapterOverride 字段。

## Dependencies

`ChapterWriterBriefService` 依赖：

- `PlotScopeGuard`：验证 `chapterPath`。
- `SceneRepository`：读取章节 Scene + thread summary。
- `SceneWorldContextService`：按 Scene 获取 filtered World Context。
- `SceneWorldAnchorResolutionService` 或 Facade 已解析 DTO：复用 resolved/unresolved 语义。
- markdown renderer：可先作为 service 内私有函数，后续若 UI/editor 复用再抽 Module。

## Repository Query

新增：

```ts
findChapterScenesForBrief(chapterPath: string): Promise<ChapterWriterBriefSceneWithThread[]>
```

需要 include：

- thread `id`
- thread `title`
- thread `summary`
- thread `isMainThread`
- thread `writingTip` 如后续 brief 需要

不要把 brief 逻辑塞进 Prisma repository。repository 只负责一次性取足数据。

## Status Aggregation

建议顺序：

1. 无 Scene -> `needs_plot`。
2. Scene 没有足够 summary/purpose -> `needs_plot`，但可保留已有 Scene details。
3. 关键 Scene 缺 `startInstant/endInstant` -> `needs_world_anchor`。
4. Scene 有 anchor 但所有查询 subject unresolved -> `needs_world_context`。
5. World Context 查询抛出配置错误 -> `needs_world_context`，warning 带错误摘要。
6. 其余 -> `ready`，warnings 可非空。

注意：

- 部分 unresolved subject 不必阻塞写作；进入 warnings。
- 缺 ChapterOverride 不改变 status，只在 markdown 中提示 leader 补 POV/tone/info-control。

## Markdown Renderer

`suggestedBriefMarkdown` 第一阶段必须包含：

- Target：chapterPath、建议 target file 说明。
- Status。
- Chapter Goal：空位，提醒 leader 补。
- Scene Order：按 chapterSortOrder。
- Thread Context：thread title + summary。
- World Query Hints：subject ids/name、time range。
- Information Control：明确第一阶段需 leader 补充。
- Writing Constraints：不新增改变世界线的关键事实；新事实在 summary 报告。
- Warnings。

必须避免：

- raw patch JSON。
- 完整 attrs dump。
- 假造 POV/tone/do-not-reveal。
- 在 markdown 中宣称写入目标，写入目标仍由 `writer.input.path` 承担。

## Error Handling

`ChapterWriterBriefService` 不应吞掉所有错误。

- 缺 chapterPath / 非当前 Project chapter：沿用 PlotScopeGuard error。
- Scene World Context 的业务缺口：转成 `status/warnings`。
- World Engine 配置损坏：可转成 `needs_world_context`；如果是无法继续的编程错误，继续抛出。

## Agent Tool

`get_chapter_writer_brief` 参数：

```ts
{
    projectPath: string;
    chapterPath: string;
}
```

返回 `plotResult(await facade.getChapterWriterBrief(...))`。

该 tool 第一阶段只绑定给 director。

## Tests

建议测试面：

- service：状态聚合、warnings、markdown。
- facade：projectPath normalize + service 调用。
- HTTP route：query param + response shape。
- agent tool：参数传递 + selection 不必改变。
- profile：director 持有 tool，leader/writer 不持有 Plot write tools。

## Result

`ChapterWriterBriefService` 的 Depth 来自把“章节 Scene 顺序、Thread summary、World Anchor、World Context、warnings、writer markdown”压到一个只读 Interface 后面。Agent 易用性应由这个 Module 提供，而不是让 director 或 leader 记住一串工具调用步骤。

