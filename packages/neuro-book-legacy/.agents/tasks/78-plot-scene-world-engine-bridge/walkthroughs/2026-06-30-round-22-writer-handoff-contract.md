# 2026-06-30 Round 22 - Writer Handoff Contract

## Scope

本轮定义 scene/world-only `get_chapter_writer_brief` v1 产出的 writer handoff 应是什么形态，以及 leader 调用 writer 时应如何使用它。

本轮不修改业务代码。

## Current Evidence

当前 writer 合同：

- writer 每轮通过 `invoke_agent.message` 接收写作 brief。
- writer 通过 `invoke_agent.input.path` 确认唯一写入目标。
- writer 可通过 `invoke_agent.input.context.lorebookEntries/readablePaths` 获得建议读取路径。
- writer 有 `execute_world(readonly)`，可自查 World Engine。
- writer 不直接消费 Plot tools。

因此 `get_chapter_writer_brief` 不能只返回 JSON 给上游看；它需要提供一份可以直接作为 writer message 基础的 `suggestedBriefMarkdown`。

## Contract Goals

writer handoff 应满足：

- 足够完整，writer 不需要再读 Plot tools。
- 不塞完整 World Engine attrs / patch JSON。
- 明确 World Engine 查询提示，让 writer 自查状态。
- 明确信息控制，至少区分“角色知道 / 读者可见 / 暂不揭露”。
- 明确写入目标由 `invoke_agent.input.path` 承担，不在 brief 里产生第二写入源。
- 能被 leader 人工编辑后发送给 writer。

## Suggested Brief Markdown v1

scene/world-only v1 建议结构：

```md
# Chapter Writer Brief

## Target

- chapterPath: manuscript/001-volume/001-chapter/
- targetFile: <project>/manuscript/001-volume/001-chapter/index.md
- status: ready | needs_plot | needs_world_anchor | needs_world_context

## Chapter Goal

本章要完成什么叙事目标。

## Scene Order

### 1. <Scene title>

- sceneId: <id>
- thread: <thread title>
- purpose: ...
- scene summary: ...
- writing tip: ...
- world time: <startTime> -> <endTime>
- subjects: <name/id list>
- location: <name/id or none>

## Thread Context

- <thread title>: <thread summary>

## World Query Hints

- 在 writer 中使用只读 execute_world 查询这些 subject：...
- 查询时间范围：...
- 如需核对位置/伤势/库存/关系，请查询 subject 当前状态，不要凭 brief 猜。

## Information Control

- 角色已知：...
- 读者可见：...
- 暂不揭露：...

## Writing Constraints

- POV / tone / pacing 暂由 leader 或用户补充；ChapterOverride 落地后由 Task 80 自动提供。
- 不新增会改变世界线的关键事实。
- 如果正文自然产生新事实，在 report_result.summary 中明确指出，交给 leader 回补 World Engine。

## Warnings

- ...
```

## What v1 Can Fill Automatically

`ChapterWriterBriefService` v1 能自动填：

- chapterPath。
- Scene 顺序。
- scene title / summary / purpose / writingTip。
- thread title / thread summary。
- worldAnchor 的 time / subjects / location。
- unresolved subject warnings。
- World Context 查询成功/失败 warning。
- World query hints。

## What v1 Must Not Pretend To Know

没有 ChapterOverride 时，v1 不应编造：

- POV。
- tone。
- reader/protagonist information-control。
- do-not-reveal 列表。
- chapter opening hook / ending hook。

这些字段可在 `suggestedBriefMarkdown` 中留给 leader 补充，或作为 warning 提醒“ChapterOverride 未实现”。

## Leader Editing Step

leader 收到 director 的 `writer_handoff` 后，应做一次人工/Agent 编辑：

1. 删除对 writer 无用的内部 warning。
2. 补上用户本轮要求的 POV、tone、篇幅、文风。
3. 补上信息控制，尤其是“不要提前揭露”的内容。
4. 确认 target path。
5. 再调用 writer。

brief tool 不替代 leader 的 canon 判断。

## Writer Report Handling

writer 完成后返回：

```ts
{
    summary: "写作摘要，说明时间、地点、参与角色、关键动作、关系变化和伏笔/状态变化。",
    outputPath?: string
}
```

leader 应读取 summary 判断：

- 是否产生新事实。
- 是否改变角色状态。
- 是否引入新地点/物品/关系。
- 是否需要回补 World Engine。
- 是否需要让 director 更新 Scene / Thread summary。

## Post-write Reconciliation

推荐流程：

```text
writer done
  -> leader reads writer summary
  -> if new facts:
       execute_world write/edit patches
       invoke director to update Scene/Thread summary
     else:
       optional mark Scene status written
```

`writer` 不应直接更新 Plot；`director` 不应直接写 World Engine。

## Acceptance Tests Later

brief service 测试应覆盖：

- `suggestedBriefMarkdown` 包含 Scene 顺序、thread summary、world query hints。
- 不包含 raw patch JSON。
- unresolved subject 出现在 warnings。
- 缺 ChapterOverride 时不会生成虚假的 POV/tone/do-not-reveal。

profile 测试应覆盖：

- writer prompt 不再建议读取 Plot ids。
- leader prompt 调 writer 时使用完整 message brief + `input.path`。
- director prompt 把 `suggestedBriefMarkdown` 当 handoff 素材，不直接调用 writer。

## Result

`get_chapter_writer_brief` v1 的输出核心不是“给 Agent 看的 JSON”，而是“给 writer 可执行的 brief 草案”。JSON details 供工具和 UI 使用，`suggestedBriefMarkdown` 才是 profile 协作的关键接口。

