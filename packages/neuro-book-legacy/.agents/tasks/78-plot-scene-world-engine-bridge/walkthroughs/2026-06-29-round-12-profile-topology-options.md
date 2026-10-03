# 2026-06-29 Round 12 - Profile Topology Options

## Scope

本轮专门设计“Agent 怎么方便使用 Plot System + World Engine”的 profile 拓扑。目标是给出可执行的 profile 系统架构，而不是只改几句 prompt。

本轮不修改业务代码。

## Design Constraints

- World Engine 是动态状态与时间线唯一真相源。
- Plot System 是 Scene-only 作者结构层，不保存动态状态。
- writer 不直接拥有 Plot tools，也不写 World Engine。
- director 可以写 Plot，但不应裁决世界事实。
- leader.default 是用户协作入口和 canon 决策入口。
- `get_chapter_writer_brief` 应是只读聚合层，不替用户确认 canon。

## Options

| 方案 | 核心思路 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. Leader Monolith | 给 `leader.default` 全套 Plot tools；leader 同时写 World Engine 和 Plot。 | 单 Agent 路径最短，适合轻量任务。 | leader 工具面过宽；容易把 Plot 当状态源；prompt 压力大。 | 暂不采用为默认架构。可作为后续 power-user 开关。 |
| B. Current Director Specialist | 保持 director 拥有 Plot tools，leader 只推进 World Engine。 | 权责清晰；director 专注 Scene/Thread。 | 现在 prompt 仍走 simulator gate；leader 不路由 director；缺少 brief 聚合导致多工具往返重。 | 作为基础，但必须修正 prompt 和 brief 工具。 |
| C. Director + Brief Compiler | director 拥有 Plot tools 和 `get_chapter_writer_brief`；leader 负责 World Engine 与 writer 调度。 | 工具面可控；writer handoff 稳定；不让 Plot 保存状态。 | 多 agent 路径仍存在，但 brief 工具能显著降低成本。 | 推荐第一期目标架构。 |
| D. Director Readonly World | director 增加 readonly `execute_world`，可自行查世界状态但不能写。 | 设计 Scene 时更方便，不必全靠 scene anchor。 | director 可能越过 canon 边界；和 `get_scene_world_context` 重叠。 | 后置评估。先用 Scene World Context / brief。 |
| E. New Story Coordinator Profile | 新建 `story.coordinator` 或 `chapter.planner`，专门编译 Plot + World brief。 | 职责很纯；可避免 director prompt 历史包袱。 | 新 profile 增加用户理解成本；现有 director 已能承载。 | 暂不新建，先改 director。 |

## Recommended Architecture

第一期采用 **C. Director + Brief Compiler**。

### leader.default

职责：

- 用户协作入口。
- canon 决策与用户确认。
- World Engine readwrite owner。
- 调用 director 处理 Scene/Thread/Chapter Plot 结构。
- 调用 writer 生成正式正文。

工具：

- 保持 `execute_world` readwrite。
- 第一阶段不加全套 Plot tools。
- 可选后续只加 `get_chapter_writer_brief` 这一个只读工具，用于低成本查看 brief；不加 create/update Plot tools。

Prompt 要改：

- 不再说 Plot 不存在。
- 明确 simulation/RP legacy 不存在于普通写作主路径。
- Plot 是 Scene-only 作者结构层；需要改 Plot 时 invoke director。

### director

职责：

- Thread / Scene 结构设计与落库。
- Chapter Scene 顺序与 writer handoff。
- 使用 Scene World Anchor 连接 World Engine。
- 通过 `get_chapter_writer_brief` 编译上游可用 handoff。

工具：

- 保持 Plot read/write tools。
- 增加 `get_chapter_writer_brief`。
- 暂不加 `execute_world`。

Prompt 要改：

- 移除普通写作里的 simulator gate。
- 未裁决事实不调用 simulator；返回 `world_engine_requests` 或 `open_questions` 给 leader。
- `get_scene_world_context` 只读取已连接 Scene 的 World Engine 上下文，不是裁决工具。

### writer

职责：

- 根据 leader/director 提供的 brief 写指定 Markdown 正文。
- 使用 readonly `execute_world` 自查状态。
- 回报正文是否引入新事实或状态变化。

工具：

- 保持 readonly `execute_world`。
- 不加 Plot tools。

Prompt / contract 要改：

- 不说“Plot 是 legacy”；改为“Plot 不通过 payload 直连 writer，上游必须把 Scene/Thread/World Context 编译成 message brief”。
- `threadIds/sceneIds/plotIds` 兼容字段仍可暂留，但描述应降级为历史字段，不作为普通写作路径。

### world.engine

职责：

- 复杂 schema/calendar/World Engine 数据维护。
- 可被 leader 调用处理高风险世界状态修复。

不负责：

- Plot 结构设计。
- writer handoff。
- 正文写作。

## Tool Entitlement Matrix

| Profile | Plot read | Plot write | Scene World Context | Chapter Writer Brief | World Engine write | World Engine read | Writer call |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `leader.default` | 暂无 | 否 | 暂无 | 可选后置只读 | 是 | 是 | 是 |
| `director` | 是 | 是 | 是 | 是 | 否 | 仅通过 Scene Context | 默认不直接调用 |
| `writer` | 否 | 否 | 否 | 否 | 否 | 是 | 不适用 |
| `world.engine` | 否 | 否 | 否 | 否 | 是 | 是 | 否 |

## Why This Is Better Than Direct Leader Plot Tools

直接给 leader 全套 Plot tools 虽然方便，但它会把普通写作入口变成“文件 + SQL + World Engine + Plot + 多 Agent + variables”的巨型 profile。当前真正缺的是低成本 handoff，而不是 leader 自己改每个 Scene。

因此优先把复杂串联压进 `get_chapter_writer_brief`，再让 director 持有 Plot 写权限。若真实使用中仍频繁卡在 director 往返，再考虑给 leader 加只读 brief 工具，而不是直接开放 Plot 写工具。

## Final Recommendation

Profile 系统架构应收敛为：

```text
leader.default
  -> execute_world(readwrite): canon / timeline / state
  -> invoke director: Plot Scene / Thread / Chapter structure
  -> invoke writer: final prose

director
  -> Plot tools(readwrite): Scene-only structure
  -> get_scene_world_context: connected scene context
  -> get_chapter_writer_brief: compile handoff
  -> report world_engine_requests back to leader

writer
  -> execute_world(readonly): self-check state
  -> file write/edit: prose only
```

这让 Plot、World Engine、Writer 三层都保留边界，同时让 Agent 使用路径足够短。

