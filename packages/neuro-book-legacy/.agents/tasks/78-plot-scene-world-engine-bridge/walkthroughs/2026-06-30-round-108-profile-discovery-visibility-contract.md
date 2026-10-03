# Round 108: Profile Discovery Visibility Contract

## Scope

本轮校正 `get_chapter_writer_brief` 在 Agent 侧“可发现”的证明方式。重点是 `get_agent_profile` 到底暴露什么，以及哪些信息必须放在 director prompt/reference/tool definition 里。没有改业务代码、没有运行测试。

## Current Evidence

当前 `server/agent/tools/agent-collaboration-tools.ts` 的 `get_agent_profile` 返回：

- `profileKey`
- `name`
- `description`
- `toolKeys`
- `initialSchema` summary
- `payloadSchema` summary
- `outputSchema` summary

它不会返回每个 tool 的 description，也不会返回目标 profile 完整 prompt。

当前 `server/agent/profiles/profile-http-service.ts` 的 profile detail 工作台接口会展示源码、schema、toolKeys、report result schema 等，但这不是模型运行时 caller 通过 `get_agent_profile` 能依赖的 Interface。

## Discovery Split

因此 `get_chapter_writer_brief` 的可发现性要拆成两层证明。

### Caller Discovery

leader 或其他 caller 调 `get_agent_profile({profileKey: "director"})` 后，只能确认：

- director 存在且可用。
- director `toolKeys` 包含 `get_chapter_writer_brief`。
- director `InitialSchema` 接受 `projectPath/defaultChapterPath` 等创建语义。
- director `OutputSchema` 摘要包含 `writer_handoff`、未来的 `world_engine_requests`、`open_questions` 等 Agent-facing 字段。

这能证明 caller 知道“director 有 brief 能力”，但不能证明 caller 知道 tool 的详细参数和结果语义。

### Target Execution Guidance

director 自己运行时能看到 root tools 的 provider-visible schema/description。因此以下内容必须在 director 侧可见：

- `get_chapter_writer_brief` tool description：按 chapter 生成 writer-safe Scene / World Context brief。
- parameter description：`chapterPath` 不是 writer output path；writer output path 仍由后续 `invoke_agent.input.path` 指定。
- director system prompt/reference：章节写作前优先调用 brief tool；不要手动串 `get_chapter_plot` + 多个 `get_scene_world_context` 当作常规路径；不要把 raw World Engine patch JSON 直接交给 writer。
- `DirectorOutputSchema` description：`writer_handoff` 可承载 `suggestedBriefMarkdown` 或其摘要；`world_engine_requests` 表示需要 leader/world.engine 写入或修正 World Engine 的请求。

## Design Consequence

不要把关键使用规则只写进 tool description。原因是 caller 看不到它，只有 director 执行时看得到。稳定合同需要三处共同承载：

1. `get_agent_profile` 可见的 profile description/schema summary/toolKeys。
2. director prompt/reference 中的 delegation protocol。
3. runtime tool definition 的 description/parameter description。

这不是重复，而是不同 Agent Interface 的最小可见信息。

## Acceptance Implications

Slice 4 验收不能只断言 `get_agent_profile("director").toolKeys`。应分开验：

- caller discovery：`get_agent_profile` result 含 `get_chapter_writer_brief` toolKey，director schema summary 不再暴露旧 `simulator_requests`。
- target guidance：director prepared prompt 包含 `get_chapter_writer_brief`、`suggestedBriefMarkdown`、writer path 由 `invoke_agent.input.path` 提供。
- runtime tool definition：`createBuiltinTools()` 中 brief tool 的 description 和 parameter description 命中关键短语。
- writer isolation：`get_agent_profile("writer").toolKeys` 不包含 Plot tools，writer prompt 允许消费上游 Scene / World Context brief，但不直接持有 brief/Plot tools。

## Conclusion

`get_agent_profile` 是 caller 的 schema discovery Interface，不是完整工具手册。`get_chapter_writer_brief` 的可发现性必须用 `toolKeys/schema summary`、director prompt/reference 和 runtime tool definition 三段证据共同证明。

