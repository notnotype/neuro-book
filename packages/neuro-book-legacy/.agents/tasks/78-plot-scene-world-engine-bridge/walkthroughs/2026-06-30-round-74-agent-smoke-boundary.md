# Round 74: Agent Smoke Boundary

## Scope

本轮定义后续 Agent smoke 应证明什么，以及不能证明什么。目标是避免把“工具注册成功”误写成“真实模型一定会正确规划”。

## Evidence Checked

- `server/agent/tools/agent-collaboration-tools.ts`
  - `create_agent` description 要求先调用 `get_agent_profile()`。
  - `invoke_agent` description 明确 `message` 是普通文本，`input` 是结构化 payload。
  - `get_agent_profile` 返回 schema summary 和 tool keys。
- `server/agent/tools/agent-collaboration-tools.test.ts`
  - `get_agent_profile` 工具结果不暴露完整 source，也不暴露完整 report schema。
  - Agent-facing 可见面主要是 `toolKeys` 和 schema summary。
- `server/agent/harness/neuro-agent-harness.test.ts`
  - faux provider 已能回放 `invoke_agent` 调子 agent，子 agent 再用 `report_result` 返回结构化 data。
  - 已有测试证明父 agent 能收到 child invocation 的 compact result。
  - 已有测试证明 `get_agent_profile` 的输出会进入模型可见消息。
- `server/agent/harness/neuro-agent-harness.black-box.test.ts`
  - black-box harness 能观察 tool call、tool result、lifecycle events 和最终状态。

## Static Proof vs Smoke Proof

后续 `get_chapter_writer_brief` 落地后，应拆成两类证据：

### Static proof

这类测试证明接口存在且绑定正确：

- `server/agent/tools/plot-tools.ts` 有 `get_chapter_writer_brief` runtime tool。
- `server/agent/tools/index.ts` 全局 registry 能找到该 tool。
- `server/agent/profiles/profile-tools.ts` 有 typed binding，例如 `builtin.plot.getChapterWriterBrief`。
- director profile root toolset 包含 brief tool。
- writer profile 不包含 Plot write tools，也不包含 brief tool。
- `get_agent_profile({profileKey:"director"})` 的 `toolKeys` / schema summary 能展示 brief tool。
- compiled active director artifact 包含 brief tool binding。

### Faux smoke proof

这类测试证明调用链可走通：

1. 创建 leader-like parent session。
2. parent 调 `get_agent_profile({profileKey:"director"})`。
3. parent 调 `create_agent({profileKey:"director", initial:{projectPath, mode, defaultChapterPath}})`。
4. parent 调 `invoke_agent()` 把剧情规划任务交给 director。
5. director faux response 调 `get_chapter_writer_brief({projectPath, chapterPath})`。
6. director faux response 调 `report_result`，返回 `writer_handoff` / `world_engine_requests` / `open_questions`。
7. parent 收到 compact invoke result。
8. parent 再调 writer，`message` 使用完整 `suggestedBriefMarkdown`，`input.path` 单独提供正文写入目标。

这个 smoke 可以证明：tool 可发现、schema 校验生效、父子 agent 调用链能传回 brief 和结构化结果。

## What It Cannot Prove

faux smoke 不能证明真实模型会自发：

- 先查 `get_agent_profile` 再 create/invoke。
- 在需要 brief 时主动调用 `get_chapter_writer_brief`。
- 正确判断 `needs_plot / needs_world_anchor / needs_world_context / ready` 的下一步。
- 不把 `chapterPath` 当成 writer 写入路径。
- 写后主动发起 World Engine 回补和 director summary 更新。

这些属于真实模型行为质量，需要后续真实 session smoke 或人工使用反馈。当前项目规范也不要求自动浏览器验证；Agent smoke 应优先落在 harness 层。

## Minimum First Smoke

工具绑定完成后的第一条 smoke 不需要真实 World Engine 大 fixture。可以构造最小 Project fixture：

- 一个 chapter path。
- 一个 chapter scene ref。
- 一个 Scene 带 world anchor。
- brief service 返回 `ready` 或受控 `needs_world_context`。

重点不是覆盖所有 brief 状态，而是证明 director 能发现并调用 brief tool，且 parent 能拿到 director 的 structured handoff。完整状态 fixture 应留给 `ChapterWriterBriefService` 单元/集成测试。

## Acceptance Impact

后续验收结论应分级：

- “静态合同成立”：source/schema/tool registry/profile binding/compiled artifact 都对齐。
- “faux smoke 通过”：测试回放链路可走通。
- “真实 Agent 行为可用”：需要真实 provider/session 证据，且不应由 faux smoke 代替。

在没有真实 smoke 前，不能把 Agent 易用性目标声明为完全完成。

