# 2026-06-30 Round 65 - Agent Tool Binding And Profile Discovery Acceptance

## Scope

本轮审计 `get_chapter_writer_brief` 从 runtime tool 到 director 可发现性的完整证据链。目标是避免 service/HTTP 已实现，但 Agent 仍不可用或被旧 director prompt 错用。

本轮不修改业务代码。

## Evidence

当前 `server/agent/tools/plot-tools.ts`：

- 已有 `get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_scene_world_context`、`get_chapter_plot` 和 Scene/Thread 写工具。
- 尚无 `get_chapter_writer_brief`。
- `get_scene_world_context` 会写入 `plot.selection`；brief tool 不应这样做，因为它是 chapter-level 聚合读取，不应改变当前 Scene 焦点。

当前 `server/agent/tools/index.ts`：

- `buildAgentTools()` 已把现有 Plot tools 注册为 typed definitions。
- 尚无 `getChapterWriterBrief` registry binding。

当前 `server/agent/profiles/profile-tools.ts`：

- `builtin.plot` 已有 `getSceneWorldContext` 和 `getChapter`。
- 尚无 `getChapterWriterBrief` typed binding。

当前 `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`：

- toolset 尚无 brief tool。
- system prompt 仍包含 `simulator.leader`、`Simulation gate`、`simulator_requests`。

当前 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`：

- writer 没有 Plot tools，符合目标。
- 注释仍说“写作模式不使用 Plot 系统”，应改成“writer 不直接使用 Plot tools；消费上游完整 brief”。

当前 `server/agent/tools/agent-collaboration-tools.test.ts`：

- `get_agent_profile` 只返回 `toolKeys` 与 agent-facing schema summary。
- 因此 `DirectorOutputSchema` 字段 description 和 tool key 暴露是 director 被 leader 正确发现的关键 Interface。

## Required Binding Chain

`get_chapter_writer_brief` 真正可用必须同时满足：

1. Runtime tool
   - `createPlotTools()` 增加 `get_chapter_writer_brief`。
   - 参数只包含 `projectPath` 和 `chapterPath`。
   - 不读取或写入 `plot.selection`。
   - 调用 `plotFacade.getChapterWriterBrief(projectPath, chapterPath)`。
   - `content[0].text` 可以是 `suggestedBriefMarkdown` 或 JSON 摘要；`details` 保留完整 DTO。

2. Global registry
   - `server/agent/tools/index.ts` 增加 `getChapterWriterBrief: requireDefinition(plotTools, "get_chapter_writer_brief")`。
   - `createBuiltinTools()` 能返回该 key。

3. Typed profile binding
   - `builtin.plot.getChapterWriterBrief = registeredTool("get_chapter_writer_brief")`。

4. Director exposure
   - director toolset 加入 `builtin.plot.getChapterWriterBrief`。
   - director system prompt 写清：先维护 Scene/World Anchor，再用 brief tool 编译 writer handoff。
   - director 不直接写 World Engine，不直接调用 writer；返回 `world_engine_requests` / `writer_handoff`。

5. Writer non-exposure
   - writer root tools 不包含任何 Plot tools。
   - writer 只消费 `invoke_agent.message` 中的完整 brief 和 `invoke_agent.input.path`。

6. Profile discovery
   - `get_agent_profile({profileKey:"director"})` 返回的 `toolKeys` 包含 `get_chapter_writer_brief`。
   - output schema summary 包含 `world_engine_requests`，不包含 `simulator_requests`。

7. Runtime build
   - system source、compiled manifest current pointer、artifact 内容、active user root shadow 状态全部检查。
   - 未做真实 Agent smoke 前，只能声明静态合同成立。

## Test Map

### `server/agent/tools/plot-tools.test.ts`

新增断言：

- tool schema 接受 `{projectPath, chapterPath}`。
- schema 拒绝 `writerPath`。
- execute 调用 `plotFacade.getChapterWriterBrief()`。
- 不调用 `appendCustomState()`，不污染 `plot.selection`。
- `result.details.suggestedBriefMarkdown` 原样可见。

### `server/agent/tools/agent-collaboration-tools.test.ts`

扩展 `createBuiltinTools` 聚合断言：

- tool keys 包含 `get_chapter_writer_brief`。

`get_agent_profile` 测试不必 mock 真实 director，但需要保留其只返回 schema summary/toolKeys 的约束，提醒实现者不要依赖 hidden source 字段。

### `server/agent/profiles/simulation-director-profiles.test.ts`

重写 director 断言：

- `directorProfile.rootToolKeys` 包含 `get_chapter_writer_brief`。
- 不包含 `write/edit/apply_patch`。
- prompt 包含 `get_chapter_writer_brief`、`world_engine_requests`、`suggestedBriefMarkdown`。
- prompt 不包含 `Simulation gate`、`simulator_requests`、`simulator.leader`。
- writer prompt/toolset 断言继续证明 writer 没有 Plot tools。

### Schema-only strict tests

新增或扩展 `builtin-contracts` 测试：

- 新 `DirectorOutputSchema` 接受 `thread/scene` plot_updates。
- 拒绝旧 `plot` kind。
- 拒绝 root 额外字段 `simulator_requests`。
- 拒绝 `plot_updates[]` item 额外字段。

## Acceptance Gate

Agent tool binding 完成时，不能只看 `plot-tools.ts` 有实现。必须同时证明：

- runtime registry 有 key。
- `builtin.plot` typed binding 有 key。
- director rootToolKeys 暴露 key。
- `get_agent_profile` 可发现 key。
- writer 没有 Plot tools。
- compiled director artifact 含新 prompt 和新 toolset。
- active user root 没有旧 director shadow，或 shadow 已明确处理。

## Result

`get_chapter_writer_brief` 是 Agent 易用性的主 Interface。它的完成证据必须跨 service、runtime registry、profile binding、director prompt、profile discovery 和 compiled artifact；缺任一层，leader/director/writer 的协作链都只能算源码局部完成，不能算真实 Agent 可用。

