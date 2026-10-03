# Round 80: Profile Discovery Runtime Interface Acceptance

## Scope

本轮检查 Agent 运行时如何发现 profile 能力，尤其是 `get_agent_profile` 是否会暴露完整 prompt。结论是：不会。后续验收必须把 tool description、toolKeys 和 schema summary 当成真正的 Agent-facing Interface。

## Current Evidence

- `server/agent/tools/agent-collaboration-tools.ts`
  - `get_agent_profile` 的描述要求在 `create_agent` / `invoke_agent` 前查看目标 profile 的 InitialSchema、PayloadSchema、OutputSchema 和 profile root tools。
  - 返回内容只有 `profileKey`、`name`、`description`、`toolKeys`、`initialSchema`、`payloadSchema`、`outputSchema`。
  - 不返回目标 profile 的完整 System prompt。
- `server/agent/profiles/profile-http-service.ts`
  - profile detail API 会给 UI 返回 source、toolKeys、schema detail 和 reportResultSchema。
  - 这是工作台/设置页的编辑视角，不等同于 Agent 运行时通过 `get_agent_profile` 得到的协作视角。
- `server/agent/profiles/profile-dsl.ts`
  - schema summary 会读取 TypeBox field description。
  - 因此 `world_engine_requests`、`writer_handoff`、`projectPath`、`defaultChapterPath` 等字段 description 会实际进入 Agent 可见摘要。

## Interpretation

后续不能依赖 hidden prompt 让调用方理解 `director` 或 `writer`。Leader 在运行时能稳定看到的只有：

- profile description。
- root `toolKeys`。
- InitialSchema / PayloadSchema / OutputSchema summary。

而 `director` 自己能稳定看到的是：

- 当前 profile System。
- 当前 root tool list 及每个 tool description / parameter schema。

这意味着：

- `DirectorOutputSchema` description 是 leader-facing API。
- `get_chapter_writer_brief` tool description 和参数 schema 是 director-facing API。
- writer PayloadSchema description 是 leader/director 调用 writer 时的 API。

## Acceptance Requirements

Slice 4 `Agent Tool Binding` 不能只检查工具存在。最小验收应覆盖：

- `get_agent_profile({profileKey: "director"})` 的 `toolKeys` 包含 `get_chapter_writer_brief`。
- `get_agent_profile({profileKey: "director"})` 的 output schema summary 包含 `world_engine_requests`，且不包含 `simulator_requests`。
- `DirectorOutputSchema` 字段 description 明确 `world_engine_requests` 是交回 leader 的 World Engine 请求，不是 director 自行写入。
- `get_chapter_writer_brief` 的 tool description 明确：
  - 输入只接 `{projectPath, chapterPath}`。
  - 不写 `plot.selection`。
  - 返回 `status`、`warnings`、`scenes`、`worldContexts` 和 `suggestedBriefMarkdown`。
  - `suggestedBriefMarkdown` 可作为 writer message 草案，但不包含 raw patch JSON / 完整 attrs / 伪造 ChapterOverride 字段。
- writer PayloadSchema summary 继续强调 `input.path` 是唯一写入目标，Plot/Scene id 不作为 writer 的结构化输入。

## Testing Implication

后续测试应分两层：

- profile discovery 测试：验证 `get_agent_profile` 的 toolKeys / schema summary 符合协作接口。
- current-profile tool definition 测试：验证 `get_chapter_writer_brief` 的 runtime tool description 和 parameters 对 director 足够清晰。

不能用“source prompt 包含某段话”替代 `get_agent_profile` 的运行时发现证据。

## Conclusion

Profile/tool 改造完成的标准必须是 Agent 运行时能发现、理解并调用，而不是源码里写了说明。`get_agent_profile` 暴露面决定了 schema description 和 tool description 必须被当成稳定接口维护。

