# Round 92: Profile Discovery Tool Description Limit

## Scope

本轮复查 `get_agent_profile` 的真实返回结构，确认后续 `get_chapter_writer_brief` 的 Agent-facing 可发现性应该如何验收。

## Evidence

- `server/agent/tools/agent-collaboration-tools.ts` 的 `getAgentProfileDetail()` 返回：
  - `profileKey`
  - `name`
  - `description`
  - `toolKeys`
  - `initialSchema`
  - `payloadSchema`
  - `outputSchema`
- 它不会返回 profile prompt，也不会返回每个 tool 的 description / parameters。
- `server/agent/tools/agent-collaboration-tools.test.ts` 明确断言 `get_agent_profile` 只返回 agent-facing schema 摘要，并且不会泄漏 `reportResultSchema` 等内部字段。

## Correction To Previous Acceptance Language

Round 80/89 中“用 `get_agent_profile` 的 toolKeys/schema summary 和 tool description 验证 Agent-facing Interface”这句话需要收窄：

- `get_agent_profile` 可证明的只有目标 profile 是否暴露某个 tool key，以及 Initial/Payload/Output schema summary 是否对调用方可读。
- tool description 仍然重要，但它不是通过 `get_agent_profile` 返回给调用方的；它只在目标 agent 自己运行时的 tool list 中作为模型工具说明出现。
- 因此 `get_chapter_writer_brief` 的可发现性验收应拆成两层：
  - caller discovery：`get_agent_profile({profileKey:"director"})` 返回 `toolKeys` 包含 `get_chapter_writer_brief`，director schema summary 中有 `world_engine_requests/writer_handoff` 等字段描述；
  - target execution guidance：director prompt/reference 明确要求在 writer handoff 前优先调用 `get_chapter_writer_brief`，tool 自身 description/parameter description 明确 `{projectPath, chapterPath}`、selection-free、不写状态。

## Implementation Impact

Slice 4 `Agent Tool Binding` 的验收不要写成“`get_agent_profile` 返回 tool description”。应改为：

1. `profile-tools.ts` / runtime registry 中存在 `get_chapter_writer_brief`。
2. director root tool keys 包含 `get_chapter_writer_brief`。
3. `get_agent_profile` detail 的 `toolKeys` 包含该 key。
4. director prompt/reference 说明何时调用该 tool。
5. tool definition 本身的 description 和 parameters 描述清楚：
   - 输入只接 `{projectPath, chapterPath}`；
   - 不读取或写入 `plot.selection`；
   - 返回 `status/warnings/suggestedBriefMarkdown`；
   - 不包含 raw patch JSON 或伪造 ChapterOverride 字段。
6. 如果未来需要调用方看到 tool descriptions，应单独扩展 `get_agent_profile` 返回结构；不要把这个能力假设为当前已存在。

## Conclusion

当前架构不需要改变：Director + Brief Compiler 仍成立。但验收口径必须精确。`get_agent_profile` 证明“这个 profile 有哪些工具和 schema 入口”，不能证明“调用方已经读到了每个工具的完整说明”。brief tool 的可用性需要同时依赖 director prompt、tool key 暴露和 tool definition 自身描述。
