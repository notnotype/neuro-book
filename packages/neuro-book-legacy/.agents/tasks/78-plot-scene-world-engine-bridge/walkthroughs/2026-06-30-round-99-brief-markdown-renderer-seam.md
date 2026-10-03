# Round 99: Brief Markdown Renderer Seam

## Scope

本轮继续只读探索 `suggestedBriefMarkdown` 的 renderer 应归属哪里，以及测试应如何锁住信息边界。没有改业务代码、没有运行测试。

## Current Evidence

- Round 22 已定义 writer handoff 合同：writer 通过 `invoke_agent.message` 接收完整 brief，正文目标由 `invoke_agent.input.path` 单独提供。
- Round 37 已定义 markdown include/exclude：包含 Scene 顺序、Thread context、World query hints、warnings 和 writing constraints；排除 raw patch JSON、完整 attrs dump、伪造 ChapterOverride 字段。
- Round 98 已确认 tool text 应以 `suggestedBriefMarkdown` 为主体，完整 DTO 留在 `details`。
- 当前代码中没有 `ChapterWriterBriefService` 或 dedicated brief renderer；现有 markdown helpers 多用于 workspace reference、Markdown Studio 或 HTML render，不适合作为 writer handoff renderer。
- `ChapterWriterBriefService` 将拥有 status、warnings、Scene/Thread/World Context 聚合结果；renderer 如果放到 tool 或 profile，会重新分散信息边界。

## Decision

第一版 renderer 应作为 `ChapterWriterBriefService` implementation 内的私有函数或同文件私有 helper，例如：

```ts
function renderSuggestedBriefMarkdown(input: ChapterWriterBriefRenderInput): string
```

暂不新增公开 Module，也不放进 `shared/`。

原因：

- renderer 只有一个 Adapter 使用：`ChapterWriterBriefService`。
- 它的输入依赖 service 内部聚合后的 Scene/Thread/World Context/warnings；如果提前公开，会把内部中间 shape 固化成第二个 Interface。
- 后续 Task 80 引入 ChapterOverride 后，renderer 会改动较大；先保持 Locality，等第二个真实调用方出现再抽 seam。

## Renderer Input

renderer 不应直接读取 repository、World Engine 或 facade。它只接收 service 已经归一化后的数据：

- normalized `chapterPath`
- brief `status`
- ordered scene items
- top-level warnings
- per-scene warnings
- per-scene resolved `worldAnchor`
- per-scene compact `worldContext` summary material

这让 service 的外部 Interface 仍是 `projectPath + chapterPath -> ChapterWriterBriefDto`，renderer 是 implementation detail。

## Markdown Sections

v1 section 顺序建议固定：

1. `# Chapter Writer Brief`
2. `## Target`
3. `## Status`
4. `## Scene Order`
5. `## Thread Context`
6. `## World Query Hints`
7. `## Information Control`
8. `## Writing Constraints`
9. `## Warnings`

`Information Control` 在 Task 78 v1 中只能留给 leader 补充，不能生成 POV、tone、do-not-reveal 的假默认值。`Writing Constraints` 可以包含稳定约束：writer 不直接改 Plot、不新增关键世界线事实；若正文自然产生新事实，在 report summary 中列出，交给 leader 回补 World Engine。

## Test Strategy

不要只做大快照测试。建议组合：

- section marker 断言：固定章节标题存在且顺序稳定。
- positive assertions：包含 scene title、scene summary、scene purpose、scene writingTip、thread summary、thread writingTip、subject name/id、human-readable time。
- status assertions：`needs_plot / needs_world_anchor / needs_world_context / ready` 都在 markdown 中明确说明用途。
- negative assertions：不包含 raw patch JSON、`patchId`、完整 attrs dump、`POV:`、`tone:`、`do-not-reveal`、`ChapterOverride` 伪字段。
- tool assertions：`content[0].text` 使用 renderer 输出，`details.suggestedBriefMarkdown` 与 text 一致或同主体。

## Acceptance Impact

Slice 3 实现 `ChapterWriterBriefService` 时，renderer 测试属于 service fixture，不属于 Agent tool 测试。Agent tool 只验证它返回 service 的 markdown text 和 full details，不重新验证 markdown 内容边界。

如果后续 UI 也要展示或编辑 renderer 输出，再考虑把 renderer 抽成 `server/plot/renderers/chapter-writer-brief-markdown.ts`。当前不需要提前建立公开 seam。

## Plan Deviation

本轮原计划只补 DTO/tool 输出；实际发现 renderer 所有权仍会影响实现 Locality，因此新增本轮记录。结论保持保守：renderer 是 service 内部 implementation detail，测试锁 section 与负边界，不提前抽共享 Module。
