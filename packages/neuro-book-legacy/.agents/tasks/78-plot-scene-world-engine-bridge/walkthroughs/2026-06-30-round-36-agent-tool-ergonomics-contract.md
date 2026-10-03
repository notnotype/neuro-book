# 2026-06-30 Round 36 - Agent Tool Ergonomics Contract

## Scope

本轮专门定义 `get_chapter_writer_brief` 作为 Agent tool 时的易用性合同。目标是让 director 调一次工具就能拿到可执行 handoff，而不是把业务复杂度转移到 tool handler 或 prompt 里。

本轮不修改业务代码。

## Tool Interface

建议参数：

```ts
{
    projectPath: string;
    chapterPath: string;
}
```

不建议参数：

- `sceneIds`：brief 以 chapter 为最小调度单位，Scene order 来自 Project SQLite。
- `includeRawWorldState`：禁止让 Agent 请求 raw attrs / patch JSON。
- `targetFile`：writer 的唯一写入目标属于 `writer.input.path`，brief 只给建议说明。
- `profileKey` / `writerMode`：profile 协作由 leader/director/writer 合同负责，不进入 Plot tool。

## Result Shape

tool result 应直接返回 `ChapterWriterBriefDto`，并使用既有 `plotResult()` 包装，保持 Plot tool 风格一致。

必填字段：

- `chapterPath`
- `status`
- `warnings`
- `scenes`
- `threadSummaries`
- `worldQueryHints`
- `suggestedBriefMarkdown`

## Selection State

现有 Plot tools 会维护 `plot.selection`，例如选中 thread/scene。`get_chapter_writer_brief` 不应修改 selection：

- 它读取的是 chapter 聚合视图，不是选中某个 Scene。
- 修改 selection 会让后续 `get_story_scene_context` 默认目标变得隐蔽。
- brief tool 的 Interface 已经要求显式 `chapterPath`，不需要依赖 session state。

## Agent-Facing Description

tool description 建议明确：

> Compile a scene/world-only writer brief for a manuscript chapter. Returns chapter scenes, resolved Scene World Anchors, filtered World Engine context hints, warnings, and suggestedBriefMarkdown. Does not write Plot or World Engine.

描述重点：

- compile，不是 create/update。
- scene/world-only。
- suggestedBriefMarkdown 是核心产物。
- 不写 Plot / World Engine。

## Status Handling In Director Prompt

director 使用规则：

- `ready`：把 `suggestedBriefMarkdown` 作为 `writer_handoff` 基础。
- `needs_plot`：补 Scene / summary / purpose / chapter order 后重试。
- `needs_world_anchor`：补 Scene World Anchor；若缺 canon，返回 `open_questions`。
- `needs_world_context`：返回 `world_engine_requests` 给 leader，不自行写 World Engine。

## Failure Handling

tool 不应把所有错误转成成功 DTO：

- 参数错误、chapter 不存在：直接返回 Plot error。
- World Context 业务缺口：返回 DTO status/warnings。
- 代码错误或损坏数据无法解释：抛出，让测试和日志暴露。

## Tests

Agent tool tests 应覆盖：

- 参数传入 facade/service。
- 返回 `suggestedBriefMarkdown`。
- 不修改 `plot.selection`。
- status 透传。
- error 透传。

Profile tests 应覆盖：

- director 持有 `get_chapter_writer_brief`。
- leader/writer 不持有该 tool 第一阶段。
- director prompt 说明 status 处理规则。

## Result

`get_chapter_writer_brief` 的 Agent 易用性来自一个明确、只读、显式 chapterPath 的 Interface。它不依赖 selection，不暴露 raw state，不承担写入目标，不替代 leader 的 canon 判断。

