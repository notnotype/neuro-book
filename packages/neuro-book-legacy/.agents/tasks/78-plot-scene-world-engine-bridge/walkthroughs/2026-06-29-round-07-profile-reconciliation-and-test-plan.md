# 2026-06-29 Round 07 - Profile Reconciliation and Test Plan

## Scope

本轮把前几轮探索收敛成 profile / prompt / test 的落地计划。重点是 Agent 认知边界，而不是新增 UI。

## Current Profile Gap

### leader.default

当前问题：

- 有 `execute_world` readwrite。
- 没有 Plot tools。
- prompt 明确说“不维护旧 Plot / simulation 系统——这些在你这里不存在”。
- HistorySet 没有导入 `reference/plot/system.md` / `reference/plot/agent-spec.md`。

这会让 leader 在普通写作模式里忽略 Task 78 新定位：Plot 不是状态源，而是 Scene-only 作者结构层。

### director

当前问题：

- 有 Plot tools 和 `get_scene_world_context`。
- 没有 `execute_world`。
- prompt 残留 “simulator handoff / simulator gate / simulator_requests”。

这会让 director 的 Plot 结构职责仍挂在旧 simulation 裁决模型上，而不是 World Engine canonization 流程。

### writer

当前状态基本正确：

- 有 readonly `execute_world`。
- 不直接读写 Plot。
- 忽略 legacy plot payload 字段。

需要保持：writer 不接管 Plot 结构设计。

## Recommended Profile Strategy

### Route A - Director Specialist（当前推荐）

leader 不直接持有 Plot tools。需要 Plot 结构编辑时：

1. leader 用 `execute_world` 处理状态和用户确认。
2. leader invoke director，交给 director 读写 Plot Scene。
3. director 返回 chapter_plan / writer_handoff。
4. leader 调 writer。

优点：

- leader 工具面不继续膨胀。
- Plot Scene 粒度和摘要质量由 director 专门负责。
- 更容易约束 writer 不碰 Plot。

缺点：

- 多 agent 往返成本高。
- 如果缺少 `get_chapter_writer_brief`，leader/director 都需要手动串很多工具。

### Route B - Direct Leader Plot Tools

给 leader.default 增加 Plot tools：

- `get_chapter_plot`
- `get_story_scene_context`
- `get_scene_world_context`
- `create_story_scene`
- `update_story_scene`

优点：

- 单 agent 完成常见剧情整理。
- 适合轻量任务，不必每次启动 director。

风险：

- leader 已有 file/sql/world/agent/task 等能力，工具面继续扩大。
- Prompt 必须更强约束：Plot 是结构层，World Engine 是状态源。

当前建议：

- 先走 Route A。
- 等聚合 brief 工具落地后，再评估 Route B 是否仍必要。

## Concrete Prompt Changes

### reference/agent/novel-writing-workflow.md

应改：

- 从 “Plot System 是 legacy boundary” 改为 “Plot System 是 Scene-only 作者结构层，不是动态状态源”。
- Standard Flow 增加 Plot Scene 环节：
  - 规划阶段可建 Scene。
  - canon 确认后写 World Engine。
  - 写章前用 Chapter Scene brief。

### leader.default.profile.tsx

应改：

- “旧 Plot / simulation 系统不存在” 拆开：
  - simulation/RP legacy 不存在于普通写作主路径。
  - Plot System 可作为 Scene-only 作者结构层使用，但不保存动态状态。
- HistorySet 增加 `reference/plot/system.md` 和 `reference/plot/agent-spec.md`，或至少在 prompt 中说明需要 Plot 时 invoke director。

### director.profile.tsx

应改：

- 删除或降级 simulator gate。
- `simulator_requests` 字段后续可改名，但第一步可保持 schema，prompt 中解释为 legacy compatibility，普通写作使用 `open_questions` / `world_engine_questions` 语义。
- 明确 director 不写 World Engine；需要事实确认时回 leader。
- `get_scene_world_context` 是读取已连接 Scene 的上下文，不是世界裁决工具。

### writer.profile.tsx

暂不改工具。

可选小改：

- 在 input contract 中说明：brief 可能来自 Plot Scene，但 writer 不直接读取 Plot tools。

## Test Plan

### Unit / Text Contract Tests

更新或新增：

- `server/agent/profiles/leader-assets-profile.test.ts`
  - system prompt 不再说 Plot 完全不存在。
  - history includes Plot reference 或 prompt 包含 Scene-only boundary。
- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director prompt 不再要求 simulator gate 作为普通写作默认路径。
  - director prompt 包含 Scene World Anchor / World Context boundary。
- `server/agent/profiles/rp-profiles.test.ts`
  - legacy RP / simulator 仍保留，不被普通写作改动破坏。
- `app/utils/novel-writing-mode-entries.test.ts`
  - Plot 入口仍可见。

### Typecheck Gate

先修 Round 05 的 DTO drift，再跑：

```powershell
bun run typecheck
```

当前失败原因已经记录在 Round 05，不应在 profile prompt 改动时继续叠加。

### Future Brief Tool Tests

若实现 `get_chapter_writer_brief`：

- `server/plot/services/chapter-writer-brief.service.test.ts`
- `server/agent/tools/plot-tools.test.ts`
- `server/openapi/route-map` schema snapshot / route contract

## Acceptance Criteria For P0

P0 完成后应满足：

- 文档和 prompt 不再把 Plot 一概归为 legacy。
- Plot 被明确限制为 Scene-only 作者结构层。
- World Engine 仍是动态状态与时间线唯一真相源。
- director 不再默认依赖 simulator 处理普通写作状态裁决。
- writer 仍不直接读写 Plot。
- `bun run typecheck` 通过。

## Open Decision

是否在 P0 同时给 `leader.default` 加 Plot tools？

当前建议：不加。先修 prompt + director 专家路线 + 聚合 brief 工具。若真实使用中多 agent 成本明显，再开放 leader 直接 Plot tools。

