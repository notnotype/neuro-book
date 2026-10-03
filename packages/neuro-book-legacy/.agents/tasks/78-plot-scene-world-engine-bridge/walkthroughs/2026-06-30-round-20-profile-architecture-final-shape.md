# 2026-06-30 Round 20 - Profile Architecture Final Shape

## Scope

本轮把前面多轮探索收束成一个可执行的 profile 系统架构。目标是回答“Agent 怎样方便使用 Plot System + World Engine”，并明确不是临时 prompt 修补。

本轮不修改业务代码。

## Current Evidence

当前真实状态仍是：

- `leader.default` 有 `execute_world(readwrite)`，但没有 Plot tools。
- `leader.default` 的 reference/prompt 仍把 Plot / director 排除在普通写作职责外。
- `director` 有 Plot read/write tools 与 `get_scene_world_context`，没有 `execute_world`。
- `director` output schema 仍包含 `plot_updates.kind = "plot"` 和 `simulator_requests`。
- `writer` 有 `execute_world(readonly)`，不持有 Plot tools；`threadIds/sceneIds/plotIds` 仍在 PayloadSchema 中，但 writer prepare 会忽略这些字段。
- `get_chapter_writer_brief` 仍未实现。

## Final Architecture

最终建议采用 **Director + Brief Compiler**，但要把它从“profile 名义”落实到调用协议：

```text
leader.default
  owns: user collaboration, canon decision, World Engine write
  invokes: director for Plot structure
  invokes: writer for prose

director
  owns: Plot Thread / Scene / Chapter scene order
  reads: Scene World Context through Plot bridge
  compiles: chapter writer brief
  reports: world_engine_requests to leader

writer
  owns: manuscript prose only
  reads: World Engine readonly for consistency check
  consumes: message brief, not Plot tools

world.engine
  owns: World Engine schema/calendar/data repair
  does not own: Plot structure, prose, chapter brief
```

## Responsibilities

### leader.default

必须保留：

- 用户协作入口。
- canon 决策入口。
- World Engine read/write owner。
- writer 调度者。

不得新增为默认能力：

- 不给 leader.default 全套 Plot 写工具。
- 不让 leader.default 直接维护 Thread / Scene 结构，除非后续用户明确要求 power-user 模式。

允许后置新增：

- 只读 `get_chapter_writer_brief`，用于 leader 快速查看 handoff；不配套 create/update Plot tools。

### director

必须成为：

- Plot write owner。
- Scene World Anchor 管理者。
- Chapter scene order 规划者。
- `get_chapter_writer_brief` 的首个持有者。

不得成为：

- World Engine 裁决者。
- 正文 writer。
- 旧 simulation 调度者。

### writer

必须保持：

- 只写 `invoke_agent.input.path` 指向的 Markdown。
- 只读 World Engine。
- 不持有 Plot tools。
- 不把 `threadIds/sceneIds/plotIds` 当可读取材料。

writer 的输入应是已经编译好的 message brief。Plot ids 不能替代 brief。

### world.engine

必须保持：

- 复杂 World Engine 数据维护。
- schema/calendar/subject/slice 修复。

不得接管：

- Plot 结构设计。
- writer handoff。
- 正文写作。

## Why Not Leader Monolith

直接给 `leader.default` 全套 Plot tools 会让一个 profile 同时持有：

- 文件写入。
- SQL。
- variables。
- World Engine 写入。
- Plot 写入。
- 多 agent 调度。

这会扩大 prompt 压力，并增加“Plot 变成第二状态源”的风险。当前真正缺口是 brief 编译器，而不是 leader 自己能不能改 Scene。

## Why Not New Profile

新建 `story.coordinator` 或 `chapter.planner` 的好处是语义纯，但会带来：

- 新 profile 概念成本。
- 现有 director prompt / test / UI 入口仍要维护。
- 用户需要理解更多 agent 名称。

当前 `director` 已经是 Plot owner。先修 director 比新增 profile 更稳。

## Required Contract Changes

架构落地需要以下合同变化：

1. `leader.default` reference/prompt：Plot System 是 Scene-only 作者结构层；需要结构改动时 invoke director。
2. `profile-routing.md`：`leader.default -> director` 是普通写作合法路线。
3. `director.profile.tsx`：去掉普通写作 `Simulation gate`；改成 `World Engine boundary`。
4. `DirectorOutputSchema`：去掉 `plot` kind；`simulator_requests` 改为 `world_engine_requests`。
5. `writer.profile.tsx`：改写“写作模式不使用 Plot 系统”为“writer 不直接消费 Plot tools；上游 brief 已编译 Plot/World Context”。
6. `get_chapter_writer_brief`：先给 director。

## Acceptance Criteria

架构落地后，应能证明：

- leader prompt 不再说 Plot 不存在。
- leader tool keys 仍没有 Plot 写工具。
- director tool keys 有 Plot read/write + brief tool。
- director schema 不含 `plot` kind 和 `simulator_requests`。
- writer tool keys 仍没有 Plot tools。
- writer payload 中 Plot id 字段即使存在，也不会进入 writer prompt。
- `get_chapter_writer_brief` 返回可直接贴进 writer message 的 brief。

## Result

这是当前 profile 系统的最终建议架构：**leader.default 负责用户/canon/World Engine，director 负责 Plot 与 brief 编译，writer 负责正文，world.engine 负责复杂世界引擎维护**。后续实现不应再在 Leader Monolith 或新增 Story Coordinator 之间摇摆，除非真实使用反馈证明 director 往返成本不可接受。

