# 2026-06-29 Round 02 - Agent Tool Routing Audit

## Scope

本轮继续探索“让 Agent 很方便地同时使用 Plot System 和 World Engine”的真实可用性。只读检查 profile、workflow reference、Plot tools 和 World Engine 写作流程，不改业务代码。

## Files Read

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `reference/agent/novel-writing-workflow.md`
- `reference/plot/system.md`
- `reference/plot/agent-spec.md`
- `reference/world-engine/workflow.md`
- `server/agent/tools/plot-tools.ts`
- `server/agent/profiles/profile-tools.ts`

## Current Tool Topology

### `leader.default`

已拥有：

- `execute_world` readwrite
- file / agent / task / sql / variable tools

未拥有：

- `get_plot_tree`
- `get_story_thread`
- `get_story_scene_context`
- `get_chapter_plot`
- `get_scene_world_context`
- `create_story_scene`
- `update_story_scene`

Prompt / HistorySet 现状：

- 导入 `reference/world-engine/workflow.md` 和 `reference/world-engine/recording-principles.md`。
- 不导入 `reference/plot/system.md` 或 `reference/plot/agent-spec.md`。
- 系统提示词仍写着：“本 leader 不提供 Roleplay（RP）模式，也不维护旧 Plot / simulation 系统——这些在你这里不存在”。

判断：

- `leader.default` 是普通写作主入口，也是唯一拥有 World Engine readwrite 的普通创作 agent。
- 但它当前无法直接调用 Plot tools，也被 prompt 明确引导“不要维护 Plot”。
- 这和 Task 78 的新状态不完全一致：Plot 已不再是旧状态源，而是 Scene-only 作者结构层。

### `director`

已拥有：

- 全套 Plot tools，包括 `get_scene_world_context`
- file read
- agent invoke / create / get
- report_result

未拥有：

- `execute_world`
- file write/edit/apply_patch

Prompt / HistorySet 现状：

- 导入 `reference/plot/system.md` 和 `reference/plot/agent-spec.md`。
- 仍有旧 wording：“根据 simulator handoff 落库”“需要世界裁决时调用 simulator.leader”。
- 已写入“Scene 是最小剧情单位；事实推进由 World Engine patch 表达”。

判断：

- `director` 是当前最懂 Plot tools 的 agent。
- 但它不能直接查询或推进 World Engine，只能读取 Scene 已封装好的 `get_scene_world_context`。
- 如果 Scene 尚未有 `worldAnchor`，director 无法自己用 World Engine 当前状态推导新 Scene 的合理 anchor。

### `writer`

已拥有：

- `execute_world` readonly
- file read/write/edit/bash
- report_result

未拥有：

- Plot tools

Prompt / payload 现状：

- 明确“写作模式不使用 Plot 系统”：`threadIds / sceneIds / plotIds` 兼容字段会被忽略。
- writer 通过 brief 中的 World Engine 查询提示自查状态。

判断：

- writer 不直接读 Plot 是合理的：它不应接管长期剧情结构。
- 但 leader 调用 writer 前需要有稳定的 scene/chapter brief 组装责任，否则 Plot 里的 Scene 结构无法自然进入正文写作。

## Main Finding

Task 78 的后端和 UI 桥接已经完成，但 Agent 侧存在一层“路由/提示词拓扑不一致”：

1. `leader.default` 有 World Engine 写权限，却没有 Plot tools，且提示词把 Plot 当旧系统排除。
2. `director` 有 Plot tools，却没有 `execute_world`，且提示词还残留 simulator gate。
3. `writer` 有 World Engine readonly，但明确忽略 Plot payload；这要求上游必须生成足够好的 writer brief。
4. `reference/agent/novel-writing-workflow.md` 仍把 Plot System 放在 legacy boundary；这与 Task 78 “Plot 恢复为 Scene-only 桥接层”冲突。

## Design Implication

要让 Agent 方便地使用 Plot + World Engine，不能只靠现有工具存在。还需要把三类能力重新分层：

- `leader.default`：世界状态裁决者 + 用户协作入口；应知道 Plot 是结构层，不是状态源。
- `director`：Plot 结构编辑者；应使用 Scene World Anchor，不再依赖 simulator。
- `writer`：正文执行者；保持不直接写 Plot，但应接收由 Scene + World Context 组装后的简化 brief。

## Candidate Fix Directions

1. **Prompt-only 修正**
   - 更新 `leader.default`、`reference/agent/novel-writing-workflow.md`、`director` prompt，把 Plot 从 legacy 状态源改成 Scene-only 结构层。
   - 优点：成本低。
   - 缺点：leader 仍不能直接调用 Plot tools，只能 invoke director。

2. **Leader 直接获得 Plot tools**
   - 给 `leader.default` 增加 Plot tools，并导入 `reference/plot/system.md` / `agent-spec.md`。
   - 优点：普通主入口可直接建 Scene、查 Scene World Context。
   - 风险：leader 工具面变宽，需要 prompt 明确“不把 Plot 当状态源”。

3. **Director 增加 World Engine readonly**
   - 让 director 能查询当前世界状态，但不能写 World Engine。
   - 优点：director 设计 Scene 时能参考真实状态。
   - 风险：director 可能误以为自己能裁决事实；需要明确写入仍由 leader 或 world.engine 执行。

4. **新增聚合 brief 工具**
   - 例如 `get_chapter_scene_briefs` 或 `get_scene_writer_brief`：一次返回 Scene、Thread、Chapter ordering、World Context 摘要。
   - 优点：减少 agent 手动串工具的负担。
   - 风险：需要新 DTO/API，并定义 brief 生成边界。

## Recommendation From This Round

优先做“Prompt/路由修正 + director 去 simulator 化”，然后再决定是否把 Plot tools 直接开放给 `leader.default`。

最低成本的下一步不是新增数据库字段，而是修正 Agent 认知：

- Plot = Scene-only 作者结构层。
- World Engine = 动态状态与时间线真相源。
- Writer = 不读写 Plot，但接收由 leader/director 从 Plot + World Context 组装出的写作 brief。

