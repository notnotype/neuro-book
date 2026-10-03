# Round 79: World Engine Specialist Boundary

## Scope

本轮检查 `world.engine` profile 是否需要进入 Plot / writer brief 主链。结论是：不需要。`world.engine` 的当前边界基本符合目标架构，应该保持为复杂 World Engine schema / calendar / state 维护 specialist，而不是 Plot owner 或 brief compiler。

## Current Evidence

- `assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx`
  - 明确不接管 `simulator.leader`、`simulation/subjects`、`events.jsonl` 或 `memory.jsonl`。
  - 明确不写正式章节正文。
  - 明确不做长期剧情结构设计，不替用户决定核心世界观。
  - 主要职责是 World Engine 查询、写入、精确编辑、删除、schema/calendar 问题定位和工具体验反馈。
- `reference/agent/profile-routing.md`
  - `world.engine` 行的职责是世界引擎验证与维护。
  - 排除项包含旧 simulation workflow、RP 主持、正式正文、长期 Plot 设计和用户资产编辑。

## Interpretation

这个边界和 Task 78 的 Director + Brief Compiler 拓扑一致：

- `director` 负责 Plot / Scene / Chapter 结构和 writer handoff。
- `leader.default` 负责 canon 判断、World Engine 写入决策和跨 profile 调度。
- `world.engine` 只在 World Engine 本身复杂时介入，例如 schema 设计、calendar 修正、状态写入/查询异常、subject id 冲突或 ref 类型问题。

因此不应该把 `get_chapter_writer_brief` 暴露给 `world.engine`，也不应该让 `director` 直接把未裁决状态交给 `world.engine`。`director` 应返回 `world_engine_requests` 给 leader；leader 再决定自己处理还是调用 `world.engine`。

## Boundary Rules

- `director` 不写 World Engine，只提出 `world_engine_requests`。
- `world.engine` 不写 Plot，不创建/更新 Thread / Scene / Chapter ordering。
- `writer` 不写 Plot / World Engine。
- `leader.default` 是 World Engine 写入和 post-write reconciliation 的责任入口。

## Acceptance Impact

后续实现验收应包含：

- `director.profile.tsx` 不再出现 `simulator.leader` / `Simulation gate` / `simulator_requests`，改为 `world_engine_requests`。
- `DirectorOutputSchema` 有 `world_engine_requests`，且字段 description 说明这些请求交回 leader 处理。
- `world.engine` toolset 不新增 Plot write tools，也不新增 `get_chapter_writer_brief`。
- profile routing 保持 `world.engine` 不做长期 Plot 设计，但把旧 `schema.yaml` 说法同步到当前 `schema/index.ts` 语义，避免顺手修文档时留下新的陈旧术语。

## Conclusion

World Engine specialist 边界不需要重构。实现上应把 “World Engine 未决问题” 做成 `director -> leader -> world.engine(可选)`，而不是 `director -> world.engine` 或 `world.engine -> writer`。

