# Round 131: Agent Tool Binding Current Gap

## Scope

本轮继续只读探索 Slice 4 `Agent Tool Binding` 的当前源码缺口。目标不是实现 `get_chapter_writer_brief`，而是把从 `ChapterWriterBriefService` 到 director 可用能力之间的 Interface 证据重新落到当前 worktree。没有修改业务代码、没有运行测试。

## Current Evidence

- `server/plot` / `shared` / `assets` 源码中尚无 `ChapterWriterBriefService`、`ChapterWriterBriefDtoSchema`、`PlotFacade.getChapterWriterBrief()` 或 `get_chapter_writer_brief`。
- `server/agent/tools/plot-tools.ts` 的 `createPlotTools()` 仍只有现有 Plot tools：`get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_scene_world_context`、`get_chapter_plot` 和 Thread / Scene 写工具。
- `get_scene_world_context` 会写 `plot.selection`；`get_chapter_plot` 不写 selection。未来 `get_chapter_writer_brief` 应沿用 `get_chapter_plot` 的 selection-free 读工具属性，而不是复用会默认 JSON 输出的 `plotResult()` 语义。
- `server/agent/tools/index.ts` 的 `buildAgentTools()` 只把现有 Plot tools 纳入 global builtin registry；没有 `getChapterWriterBrief` definition。
- `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 没有 typed binding，director profile 不能用 `builtin.plot.getChapterWriterBrief` 声明 root tool。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 的 toolset 没有 brief tool，prompt 仍包含 `Simulation gate`、`simulator.leader` 和 `simulator_requests`。即使现在强行加 brief tool，也会绑定到旧 director contract 上。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 的 toolset 仍无 Plot tools，这一点符合第一阶段 writer isolation；后续只需要改 prompt 语言，让 writer 明确可消费上游 Scene / World Context brief。
- `server/agent/tools/agent-collaboration-tools.ts` 的 `get_agent_profile` 只返回 `profileKey/name/description/toolKeys/schema summary`。它可以证明 `toolKeys` 可发现，不能证明 tool description 或 director workflow 文案。

## Binding Gap By Seam

`get_chapter_writer_brief` 不能作为单个 runtime tool 文件补丁处理。当前缺口跨越这些 Seam：

| Seam | Current state | Required state |
| --- | --- | --- |
| Plot read model Module | 无 `ChapterWriterBriefService` / `ChapterWriterBriefDtoSchema` | `projectPath + chapterPath -> ChapterWriterBriefDto`，集中 status/warnings/world context/markdown |
| Facade Interface | 无 `PlotFacade.getChapterWriterBrief()` | Agent tool 与 HTTP route 都走 facade，不直接 import service |
| Runtime tool Adapter | `createPlotTools()` 无 brief tool | 新增 `get_chapter_writer_brief`，参数只含 `{projectPath, chapterPath}` |
| Result Interface | `plotResult()` 默认 JSON text | brief tool text 必须是 `suggestedBriefMarkdown`，完整 DTO 放 `details` |
| Selection state | 部分 Plot tools 写 `plot.selection` | brief tool 不读、不写 `plot.selection` |
| Global registry | `buildAgentTools()` 未纳入 brief tool | `createBuiltinTools()` 可返回 `get_chapter_writer_brief` |
| Typed profile binding | `builtin.plot` 无 binding | 增加 `getChapterWriterBrief: registeredTool("get_chapter_writer_brief")` |
| Director source | root toolset 无 brief tool，旧 simulator contract 仍在 | Slice 1 清理后再加入 brief tool，并在 prompt 写清 brief compiler workflow |
| Discovery | `get_agent_profile` 只返回 toolKeys/schema summary | 验 `toolKeys` 含 brief key；tool description 另由 runtime definition 验 |
| Compiled runtime | active artifact 仍可能是旧 director | profile compile/status 后查 manifest 与 artifact 内容 |

## Deep Module Check

`ChapterWriterBriefService` 是深 Module；`get_chapter_writer_brief` 是浅 Adapter。这个划分应该保持：

- Service 的 Interface 小：`projectPath`、`chapterPath` 进，`ChapterWriterBriefDto` 出。
- Service 的 Implementation 负责章节 Scene 查询、Thread summary/writingTip、Scene writingTip、Scene 实体级 World Context helper、status precedence、warnings 和 `suggestedBriefMarkdown` renderer。
- Tool Adapter 只负责 TypeBox 参数、description、调用 facade、返回 text/details、确认 selection-free。

删除 `ChapterWriterBriefService` 后，复杂度会散到 HTTP route、Agent tool、director prompt 和 fixture；删除 tool Adapter 后，复杂度只回到 runtime/profile 绑定层。因此真正要加深的是 brief read model Module，不是 tool 层。

## Implementation Ordering Guard

本轮没有发现推翻四切片顺序的新证据。Slice 4 仍必须排在最后：

1. **Profile Contract Cleanup**：先删除旧 `simulator_requests` / `Simulation gate`，建立 `world_engine_requests` 与 leader/director/writer 的新职责合同。
2. **OpenAPI Explicit Path**：让 catch-all route 能表达 `/api/projects/plot/chapter-writer-brief`，避免 route-map / metadata 覆盖。
3. **Chapter Writer Brief Module**：实现 DTO、read model、service、facade、HTTP route 和 markdown renderer。
4. **Agent Tool Binding**：再接入 runtime tool、global registry、typed binding、director toolset、discovery 和 compiled artifact。

如果跳过 Slice 1，brief tool 会被旧 director 输出合同吸走；如果跳过 Slice 3，tool Adapter 会被迫承载业务规则，破坏 Locality。

## Slice 4 Test Implications

实现 Slice 4 时，最小证据应覆盖：

- `plot-tools.test.ts`：`createPlotTools()` 包含 `get_chapter_writer_brief`；参数只接受 `projectPath/chapterPath`；执行调用 `plotFacade.getChapterWriterBrief(projectPath, chapterPath)`；`content[0].text === suggestedBriefMarkdown`；`details` 是完整 DTO；不调用 `appendCustomState()`。
- `builtin-tools-smoke.test.ts` 或对应 registry 测试：`createBuiltinTools()` 包含 `get_chapter_writer_brief`。
- `simulation-director-profiles.test.ts`：director rootToolKeys 包含 brief tool，prompt 含 brief compiler / writer handoff workflow，不含旧 simulator gate。
- writer profile 测试：writer rootToolKeys 仍不含 Plot / brief tools，但 prompt 允许消费 `invoke_agent.message` 中的完整 Scene / World Context brief。
- `agent-collaboration-tools.test.ts`：保持 `get_agent_profile` 只返回 `toolKeys/schema summary` 的发现口径；验证 `director.toolKeys` 含 brief key时，不把该测试误用为 tool description 证明。
- compiled proof：检查 system/user director source、manifest `artifactSha` 和 active artifact 内容；artifact 应含 `get_chapter_writer_brief` 且不含旧 simulator contract。

## Conclusion

当前 worktree 仍没有 brief tool 的任何实现层。Agent 可用性最终需要同时证明 service/facade、runtime tool、global registry、typed profile binding、director source、writer isolation、`get_agent_profile` 的 `toolKeys`、以及 compiled artifact。下一步仍应先进入 Slice 1 `Profile Contract Cleanup`，不要直接实现 brief tool。
