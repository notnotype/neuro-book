# Round 107: Brief Tool Adapter Result Contract

## Scope

本轮只收敛 `get_chapter_writer_brief` 的 Agent tool adapter Interface。前面 Round 104-106 已经把 service/read model/status 聚合压清楚；这里确认 runtime tool 应该怎样把 service 结果交给 Agent。没有改业务代码、没有运行测试。

## Current Evidence

当前 `server/agent/tools/plot-tools.ts` 的 Plot tools 仍是旧集合：

- `createPlotTools()` 只包含 `get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_scene_world_context`、`get_chapter_plot` 和 Thread/Scene 写工具。
- 读 Thread/Scene/Scene World Context 会通过 `writeSelection()` 写 `plot.selection`；`get_chapter_plot` 不写 selection。
- `plotResult(details)` 当前把完整 JSON 同时放进 `content[0].text` 和 `details`。

这对普通 Plot read/write 可接受，但不适合 writer handoff。`get_chapter_writer_brief` 的主要消费者是 director，然后 director 把 brief 交给 writer；Agent 最先看到的 text 应该是可直接审阅的 handoff，而不是 DTO JSON。

## Adapter Contract

`get_chapter_writer_brief` 的 tool input 固定为：

```ts
{
    projectPath: string;
    chapterPath: string;
}
```

约束：

- `projectPath` 仍然必填，不从 session focus 或 selection 推断。
- `chapterPath` 是 Plot/Manuscript chapter content-node path，不是 writer 输出文件。
- 不接 `sceneId`、`threadId`、`writerPath`、`selectionKey`。
- 不读也不写 `plot.selection`。

tool result 固定为：

```ts
{
    content: [{type: "text", text: brief.suggestedBriefMarkdown}],
    details: brief
}
```

其中 `details` 是完整 `ChapterWriterBriefDto`。这让模型默认读到 writer-safe markdown，同时测试和上层调试仍能拿到结构化 status/warnings/scenes。

## Why Not Reuse `plotResult`

`plotResult()` 的 Interface 是“把结构化 Plot DTO JSON 展示给 Agent”。`get_chapter_writer_brief` 的 Interface 是“把 writer handoff markdown 展示给 Agent，并附带结构化详情”。如果复用 `plotResult()`，会有两个问题：

1. director 需要先在 JSON 里找到 `suggestedBriefMarkdown`，增加工具使用成本。
2. 后续容易把 raw patch JSON / attrs dump 泄漏进默认可见文本，破坏 Round 99 的 renderer 边界。

因此建议新增一个小的 result helper，例如 `briefResult(brief)`，但不要把 status precedence、warning 聚合或 markdown renderer 搬到 tool 层。

## Deep Module Check

按 Module / Interface / Depth / Locality 判断：

- `ChapterWriterBriefService` 是深 Module：小 Interface 背后隐藏 Scene 查询、World Context helper、status/warning 聚合和 markdown renderer。
- `get_chapter_writer_brief` tool adapter 是浅 adapter，但它是必要 adapter：它把 service Interface 转换成 Agent tool Interface。
- adapter 的 locality 只覆盖工具参数、结果 text/details、selection side effect；业务语义继续集中在 service。

删除 adapter 后，复杂度会回到 profile/runtime registry 调用点；删除 service 后，复杂度会散到 Agent tool 和测试 fixture。因此 adapter 不应变深，service 必须保持深。

## Test Implications

Slice 4 的 tool 测试至少验证：

- `createBuiltinTools()` 或 `createPlotTools()` 包含 `get_chapter_writer_brief`。
- tool parameters 只包含 `projectPath` 和 `chapterPath`。
- 执行结果 `content[0].text` 等于 `suggestedBriefMarkdown`。
- `details` 保留完整 DTO。
- 执行该 tool 不调用 `appendCustomState()`，即不写 `plot.selection`。
- tool description 明确它生成 writer handoff brief，不是写 Plot、不是写 World Engine、不是 writer 输出路径选择器。

## Conclusion

`get_chapter_writer_brief` 不是又一个 JSON Plot read tool，而是 writer handoff adapter。默认 text 必须是 `suggestedBriefMarkdown`，完整 DTO 只放 `details`；tool 层只做参数和 result 适配，不承载 brief 业务逻辑，也不触碰 selection。

