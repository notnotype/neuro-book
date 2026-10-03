# Round 71: Tool Binding And Profile Discovery Interface

## Context

本轮继续只读探索 `get_chapter_writer_brief` 的 Agent tool binding 与 profile discovery。目标是确认这个工具从实现到 Agent 可发现需要经过哪些 Interface，而不是只在一个文件里加函数。

已读取：

- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/index.ts`
- `server/agent/profiles/profile-tools.ts`
- `server/agent/tools/agent-collaboration-tools.ts`
- `server/agent/profiles/catalog.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`

## Current Evidence

当前 Plot tools runtime 包含：

- `get_plot_tree`
- `get_story_thread`
- `get_story_scene_context`
- `get_scene_world_context`
- `get_chapter_plot`
- `create_story_thread`
- `update_story_thread`
- `create_story_scene`
- `update_story_scene`

没有 `get_chapter_writer_brief`。

全局 registry `server/agent/tools/index.ts` 通过 `buildAgentTools()` 把 runtime tools 转成 definitions。这里也没有 `getChapterWriterBrief`。

profile typed binding `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 没有：

```ts
getChapterWriterBrief: registeredTool("get_chapter_writer_brief")
```

因此 `director.profile.tsx` 当前也无法在 `toolset(...)` 里声明 brief tool。

## Discovery Interface

`get_agent_profile` 的结果来自 profile catalog snapshot + loaded profile：

- 返回 `toolKeys: [...profile.rootToolKeys]`
- 返回 `initialSchema` summary
- 返回 `payloadSchema` summary
- 返回 `outputSchema` summary
- 不返回完整 prompt

这意味着 Agent 发现能力主要依赖三类 Interface：

1. profile `rootToolKeys`
2. tool description / parameter schema
3. profile output schema summary

如果 `get_chapter_writer_brief` 只在 runtime registry 里存在，但 director profile 没暴露它，leader 通过 `get_agent_profile({profileKey:"director"})` 看不到这个能力。

如果 director profile 暴露了 tool key，但 tool description 太弱，leader 只知道“有个工具”，不知道它是 writer handoff 的推荐入口。

如果 `DirectorOutputSchema.world_engine_requests` description 不清楚，leader 也不知道 director 返回的问题应该由 World Engine owner 处理，而不是让 director 自己模拟。

## Required Tool Binding Chain

后续 Agent Tool Binding 切片需要同时改：

1. `server/agent/tools/plot-tools.ts`
   - 增加 `GetChapterWriterBriefSchema`。
   - 增加 runtime tool `get_chapter_writer_brief`。
   - 调 `plotFacade.getChapterWriterBrief(projectPath, chapterPath)`。
   - 不读写 `plot.selection`。

2. `server/agent/tools/index.ts`
   - 在 `buildAgentTools()` 中加入 `getChapterWriterBrief: requireDefinition(plotTools, "get_chapter_writer_brief")`。

3. `server/agent/profiles/profile-tools.ts`
   - 在 `builtin.plot` 中加入 `getChapterWriterBrief` typed binding。

4. `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
   - toolset 暴露 `builtin.plot.getChapterWriterBrief`。
   - prompt 明确它用于按 chapter 编译 writer handoff。

5. compiled artifacts
   - 编译 system director。
   - 若 active user root 有 director shadow，同步或消除 shadow。
   - 检查 manifest `profiles.director.artifactSha` 和 artifact 内容。

## Tool Description Requirements

`get_chapter_writer_brief` description 应表达：

- 输入只需要 `projectPath` 和 `chapterPath`。
- 它是只读聚合工具，不写 Plot，不写 World Engine，不改 `plot.selection`。
- 它返回 chapter scenes、thread summaries、Scene World Anchors、World Context summaries、warnings 和 `suggestedBriefMarkdown`。
- `suggestedBriefMarkdown` 可直接作为 `invoke_agent.message` 给 writer，但 leader/director 可先编辑。
- 如果 status 不是 `ready`，director 应先补 Plot/World Anchor 或把 `world_engine_requests` 交给 leader，而不是直接调用 writer。

## Test Surface

建议测试：

- `server/agent/tools/plot-tools.test.ts`
  - tool 存在。
  - 参数 schema 要求 `projectPath/chapterPath`。
  - 调用 facade 的 `getChapterWriterBrief`。
  - 不写 `plot.selection`。

- `server/agent/tools/index` 相关测试或现有 harness 工具列表测试
  - `createBuiltinTools()` 包含 `get_chapter_writer_brief`。

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director rootToolKeys 包含 `get_chapter_writer_brief`。
  - writer rootToolKeys 不包含任何 Plot tool。

- `get_agent_profile` harness 测试
  - `get_agent_profile({profileKey:"director"})` 的 `toolKeys` 包含 `get_chapter_writer_brief`。
  - output schema summary 包含 `world_engine_requests`，不含 `simulator_requests`。

## Conclusion

`get_chapter_writer_brief` 的可用性不是单点实现问题，而是一条 Interface 链：runtime tool -> global registry -> typed profile binding -> director source -> compiled artifact -> profile discovery。只有这条链全部成立，leader 才能通过 `get_agent_profile` 发现 director 的 brief compiler 能力，Agent 易用性目标才算向真实运行状态推进。
