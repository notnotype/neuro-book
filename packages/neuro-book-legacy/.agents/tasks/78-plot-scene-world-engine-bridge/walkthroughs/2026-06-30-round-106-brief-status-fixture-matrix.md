# Round 106: Brief Status Fixture Matrix

## Scope

本轮把 `ChapterWriterBriefService` 的 status 聚合和 fixture 测试压成明确矩阵。目标是让后续 Slice 3 实现时不把各种缺失状态混成一个泛泛错误。没有改业务代码、没有运行测试。

## Status Contract

brief v1 的顶层 status 固定为：

```ts
"needs_plot" | "needs_world_anchor" | "needs_world_context" | "ready"
```

聚合优先级保持既定顺序：

1. path error -> HTTP/service 直接抛错，不返回 brief DTO。
2. `needs_plot`
3. `needs_world_anchor`
4. `needs_world_context`
5. `ready`

## Fixture Matrix

| Fixture | 条件 | 预期 status | 预期行为 |
| --- | --- | --- | --- |
| invalid chapter path | `PlotScopeGuard.assertChapterPath()` 失败 | 抛 400/404 | 不返回 brief DTO；这是输入错误，不是 brief 状态。 |
| no scenes | 章节存在，但 `findChapterScenesForBrief()` 返回空 | `needs_plot` | `scenes=[]`，`suggestedBriefMarkdown` 提示需要先规划 Scene。 |
| scene missing anchor | 至少一个 Scene 缺 `startInstant` 或 `endInstant` | `needs_world_anchor` | 返回所有可读 Scene；缺 anchor Scene 有 warning；不因为该 Scene 抛 HTTP 400。 |
| all subjects unresolved | 至少一个 Scene 有 anchor，但相关 subject/location 全部 unresolved | `needs_world_context` | 返回 unresolved ids；提示需要先创建或对齐 World Engine subjects。 |
| world context query error | 有 anchor/resolved subject，但 `listSlices/queryState/formatTime` 失败 | `needs_world_context` | 捕获为 scene warning；不靠错误 message 判断缺 anchor。 |
| empty but valid context | Scene 有完整 anchor，但没有 subject/location 或查询结果为空 | `ready` 或 warning-only | 如果 Scene 本身可写，空 context 不应阻断；markdown 明示“未检索到相关 World Engine 状态”。 |
| ready | 至少一个 Scene 有完整 anchor，且可生成 context 或明确空 context | `ready` | `suggestedBriefMarkdown` 可直接交给 writer 审阅/执行。 |

## DTO Shape Implications

`ChapterWriterBriefDtoSchema` 建议包含：

- `chapterPath`
- `status`
- `warnings`
- `scenes`
- `suggestedBriefMarkdown`

scene item 建议包含：

- `id/title/status/summary/purpose/writingTip`
- `thread`
  - `id/title/isMainThread/summary/writingTip`
- `worldAnchor`
- `worldContext`
- `warnings`

`warnings` 分两层：

- 顶层 warnings：章节级问题，例如没有 Scene、多个 Scene 都缺 World Context。
- Scene warnings：单个 Scene 的缺 anchor、unresolved subject、context 查询失败。

## Markdown Assertions

`suggestedBriefMarkdown` fixture 不应只 snapshot 全文。推荐用 section marker 和正负断言：

必须包含：

- 章节路径。
- status。
- 每个 Scene 的标题、summary、purpose。
- Scene `writingTip`。
- Thread summary / writingTip。
- World Anchor 时间、subjects、location。
- World Context 摘要：slice title/summary/patchCount、subject state 简要。
- unresolved subject warnings。

必须不包含：

- raw patch JSON。
- 完整 `attrs` 原始对象 dump。
- `ChapterOverride`、POV、tone、do-not-reveal 等尚未实现字段。
- writer 写入目标 path；writer path 仍由 `invoke_agent.input.path` 提供。

## Service Boundary

`ChapterWriterBriefService` 负责：

- 调 `PlotScopeGuard.assertChapterPath()`。
- 调 `findChapterScenesForBrief()`。
- 调 Scene 实体级 World Context helper。
- 聚合 status/warnings。
- 渲染 `suggestedBriefMarkdown`。

它不负责：

- 修改 Plot selection。
- 写 Plot / World Engine。
- 调 Agent tools。
- 伪造 ChapterOverride。
- 决定 writer 输出文件。

## Conclusion

brief status 不是异常分类的副产品，而是 writer handoff 的显式 Interface。后续 Slice 3 的测试应先覆盖上面的 fixture matrix，再接 HTTP/tool adapter；否则很容易把缺 Plot、缺 anchor、缺 World Context 和输入 path 错误混成一个不可操作的失败态。
