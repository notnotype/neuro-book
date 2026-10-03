# 2026-06-30 Round 47 - Agent Profile Discovery Contract

## Scope

本轮审查 leader 在调用 director 前通过 `get_agent_profile` 能看到什么。目标是确认 Slice 1 改 director contract 后，上游 Agent 是否能发现新的 `world_engine_requests` 输出合同和工具边界。

本轮不修改业务代码。

## Evidence

当前协作工具合同：

- `create_agent` 描述要求调用前先 `get_agent_profile({profileKey})` 检查 `InitialSchema`、`PayloadSchema`、`OutputSchema` 和 root tools。
- `invoke_agent` 描述要求给不熟悉 profile 发送 input 前先检查 `PayloadSchema`。
- `reference/agent/leader-default.md` 同样要求不熟悉 profile 时先调用 `get_agent_profile`。

`get_agent_profile` 的实际返回：

- `profileKey`
- `name`
- `description`
- `toolKeys`
- `initialSchema` 的 agent-facing summary
- `payloadSchema` 的 agent-facing summary
- `outputSchema` 的 agent-facing summary

它不会返回：

- `reportResultSchema`
- profile source
- compiled runtime status 细节
- strict `additionalProperties` 这类 JSON Schema 原始属性

## Implication

director 的 `OutputSchema` 字段名和 description 是上游 leader 能看到的主要结构化合同。Slice 1 修改时必须让 schema summary 清晰表达：

- `world_engine_requests` 是给 leader 处理的 World Engine 待裁决/待推进事项。
- `open_questions` 是给 leader 或用户确认的问题。
- `writer_handoff` 是可交给 writer 的文本，不等于正文写作任务全部内容。
- `plot_updates.kind` 只可能是 `thread | scene`。

如果 description 含糊，leader 看到的 `get_agent_profile` 信息也会含糊。

## Test Requirement

现有 `agent-collaboration-tools.test.ts` 已证明 `get_agent_profile` 只返回 agent-facing schema summary，不返回 `reportResultSchema`。Slice 1 可增加 director 侧 profile test，而不必改协作工具：

- director `outputSchema` summary 或 profile prompt 包含 `world_engine_requests`。
- director prompt 不包含 `simulator_requests`。
- director toolKeys 包含 Plot tools 和未来 brief tool（Slice 4），但不包含 `execute_world`。
- leader prompt 要求先用 `get_agent_profile` 检查 director，再 create/invoke。

如果需要端到端证明，可新增一个轻量协作工具测试 fixture，确认 `get_agent_profile("director")` 输出中不再出现 `simulator_requests`，但这不是 Slice 1 必须项。

## Result

`get_agent_profile` 是 leader 理解 director Interface 的主要发现入口。Slice 1 的 schema description 必须当成 Agent-facing 文档写，而不是仅给 TypeScript 读。否则即使 schema 字段正确，leader 仍可能不清楚 `world_engine_requests` 和 `open_questions` 的分工。

