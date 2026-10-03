# 2026-06-30 Round 28 - Tool Exposure Matrix

## Scope

本轮专门比较 `get_chapter_writer_brief` 与 Plot write tools 应该暴露给哪些 profile。目标是避免只从“方便”出发扩大工具面，破坏 World Engine 真相源和 Scene-only Plot System 的职责结构。

本轮不修改业务代码。

## Options

| 方案 | Tool exposure | 优点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. Director-only brief | `director` 持有 Plot read/write + `get_chapter_writer_brief`；leader/writer 不持有 Plot tools。 | Interface 清晰；Plot 结构和 brief 编译在同一 profile；leader 只处理 canon/World Engine。 | leader 想快速查看 brief 时需要调用 director。 | 第一阶段采用。 |
| B. Director + leader readonly brief | `director` 同 A；`leader.default` 只额外持有 `get_chapter_writer_brief`。 | leader 可在不改 Plot 的情况下快速检查 handoff。 | 容易诱导 leader 绕过 director 的 Scene 修正流程。 | 后置观察项。仅当 director 往返成本真实过高时加。 |
| C. Leader full Plot tools | `leader.default` 持有 create/update Thread/Scene + brief。 | 单 profile 操作最快。 | leader 同时拥有文件、World Engine、Plot、Agent 调度，Interface 过宽；更容易把 Plot 当第二状态源。 | 不采用。 |
| D. Writer brief tool | `writer` 持有 `get_chapter_writer_brief` 或 Plot read tools。 | writer 自取材料。 | writer 需要理解 Plot/World Context 查询顺序，且可能越过 leader 的信息控制。 | 不采用。 |
| E. World.engine brief tool | `world.engine` 持有 brief 或 Plot read tools。 | 世界状态维护时可看到章节需求。 | world.engine 会被拉向 Plot/正文协作，职责变宽。 | 不采用。 |

## Chosen Matrix

### `leader.default`

第一阶段：

- 保留 `execute_world(readwrite)`。
- 保留 writer / retrieval / director 调度能力。
- 不持有 Plot write tools。
- 不持有 `get_chapter_writer_brief`。

后置可选：

- 只读 `get_chapter_writer_brief`，但不加 create/update Thread/Scene。

### `director`

第一阶段：

- 持有 Plot read/write tools。
- 持有 `get_scene_world_context`。
- 新增 `get_chapter_writer_brief`。
- 不持有 `execute_world`。
- 不直接调用 writer；只产出 `writer_handoff` / `suggestedBriefMarkdown`。

### `writer`

第一阶段：

- 持有 readonly `execute_world`。
- 不持有 Plot tools。
- 不读取 `threadIds/sceneIds/plotIds`。
- 消费 `invoke_agent.message` 中完整 brief。

### `world.engine`

第一阶段：

- 持有 World Engine maintenance tools。
- 不持有 Plot tools。
- 不产出 writer brief。

## Why This Is A Better Interface

这个矩阵把每个 profile 的 Interface 缩到稳定职责：

- leader：canon 和 World Engine 写入。
- director：Plot 结构和 brief 编译。
- writer：正文。
- world.engine：复杂 World Engine 数据维护。

如果直接给 leader full Plot tools，短期减少一次 agent 调用，但长期让 leader prompt 必须同时约束多套写入系统。那不是更深的 Interface，而是把多个 Interface 并进一个更宽的 profile。

## Acceptance Evidence

实现后应能用测试证明：

- `leader.default.rootToolKeys` 不含 `create_story_thread/update_story_scene`。
- `director.rootToolKeys` 含 `get_chapter_writer_brief` 和 Plot read/write。
- `writer.rootToolKeys` 不含任何 Plot tool。
- `world.engine.rootToolKeys` 不含任何 Plot tool。
- writer prompt 明确 Plot/World Context 只通过 message brief 进入。

## Result

第一阶段 tool exposure 采用 A：Director-only brief。B 作为真实使用反馈后的优化，不提前实现。这样 profile 系统的可用性来自 `get_chapter_writer_brief` Module 的 Depth，而不是扩大 leader 或 writer 的工具面。

