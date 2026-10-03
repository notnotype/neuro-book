# Round 76: Director / Writer Handoff Language Drift

## Scope

本轮只审计语言与 Interface 漂移：同一条写作链在 reference、director prompt、writer prompt 和 tool descriptions 中是否表达一致。

## Evidence Checked

- `reference/agent/profile-routing.md`
  - `leader.default` 仍明确“不路由到 Plot / simulator / director / RP”。
  - `director` 错位建议仍是“世界状态未裁决先转 simulator.leader”。
- `reference/agent/novel-writing-workflow.md`
  - 当前普通写作链是 `leader.default -> writer`。
  - `writer` 被要求“不读取 Plot / simulation 作为普通写作状态源”。
  - Legacy Boundary 把 `director`、Plot System 和 RP Tick reference 放在 legacy 语境。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - director 仍把用户、leader.default 或 simulator.leader 确认后的剧情结构落库。
  - workflow 中仍有 `Simulation gate`。
  - output contract 仍返回 `simulator_requests`。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  - writer 的输入 Interface 已经正确区分：
    - `invoke_agent.message` 是任务正文 / brief。
    - `invoke_agent.input.path` 是唯一写入目标。
    - `invoke_agent.input.context` 是建议读取上下文。
  - 但 `normalizePayloadContext()` 注释写“写作模式不使用 Plot 系统”，且丢弃 payload 中遗留 `threadIds / sceneIds / plotIds`。

## Drift

目标架构不是“普通写作不使用 Plot”。更准确的说法是：

- 普通写作使用 Scene-only Plot 作为作者结构层。
- `director` 是 Plot write owner 和 future brief compiler。
- `writer` 不直接持有 Plot tools，也不接 Plot ids 作为结构化 input。
- `writer` 通过完整 `invoke_agent.message` brief 消费上游已经编译好的 Scene / World Context 信息。
- World Engine 仍是动态世界状态和时间线真相源。

当前 reference 和注释把“writer 不直接读 Plot”扩大成“普通写作链不走 Plot/director”。这会导致两个实际风险：

1. `leader.default` 继续跳过 director，直接手写 brief 给 writer。
2. `writer` 侧维护者看到注释后，可能拒绝从 director/brief 引入 Scene 信息。

## Required Language Update

Slice 1 应统一以下表达：

- `leader.default`
  - 普通写作入口仍由 leader 统筹。
  - 需要创建/更新 Thread、Scene、章节 Scene 顺序、Scene World Anchor 时调用 `director`。
  - leader 仍负责 canon 判断和 World Engine 写入。

- `director`
  - 负责 Plot 结构和 writer handoff。
  - 不写 World Engine。
  - 不直接调用 writer。
  - 世界状态缺口返回 `world_engine_requests`，交给 leader/world.engine。

- `writer`
  - 不直接使用 Plot tools。
  - 不接 `threadIds / sceneIds / plotIds` 作为本轮结构化 input。
  - 可以消费来自 director/brief compiler 的完整 Scene / World Context brief。
  - 写入目标只来自 `invoke_agent.input.path`。

- `reference/agent/novel-writing-workflow.md`
  - 普通写作链应从 `leader.default -> writer` 改为：
    - 简单章节可由 leader 直接组织 brief 调 writer；
    - 涉及 Plot 结构、Scene 编排或 World Anchor 时，走 `leader.default -> director -> leader -> writer`。
  - `director` / Plot System 不应再作为普通写作 legacy 边界。

## Test Impact

Slice 1 prompt/reference 测试应加入负断言：

- director prompt 不含 `simulator_requests`。
- director prompt 不含 `Simulation gate`。
- director prompt 不要求调用 `simulator.leader`。
- profile routing 不再说 `leader.default` 不路由到 director/Plot。
- novel writing workflow 不再把 `director` / Plot System 放在普通写作 legacy 语境。

writer prompt 测试应加入正断言：

- `message` 是完整写作 brief。
- `input.path` 是唯一写入目标。
- writer 不持有 Plot tools。
- writer 可消费上游 brief 中的 Scene / World Context 信息。

## Conclusion

这不是文案问题，而是 Agent-facing Interface 问题。当前漂移会直接改变 Agent 规划路线。Profile Contract Cleanup 必须同时改 reference 和 active profile System，否则 `get_chapter_writer_brief` 即使落地，也可能被旧写作 workflow 绕开。

