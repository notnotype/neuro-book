# 2026-06-30 Round 51 - Profile Contract Current Diff Map

## Scope

本轮按当前 worktree 重新核对 Slice 1 `Profile Contract Cleanup` 的真实差距。目标是把“要改哪些 profile/source/reference/test”从抽象计划落到当前文件状态。

本轮不修改业务代码。

## Evidence

当前 `director.profile.tsx`：

- `description` 仍说“不维护 simulation state”。
- System prompt 仍写：
  - “把用户、leader.default 或 simulator.leader 确认后的剧情结构落库”。
  - “在需要未裁决世界状态时调用 simulator.leader，或在 simulator_requests 中列出需要裁决的问题”。
  - “Simulation gate”。
  - `Report` 返回 `simulator_requests`。
- toolset 已包含 Scene-only Plot tools 和 `get_scene_world_context`。
- toolset 还没有未来的 `get_chapter_writer_brief`。
- 不包含 `execute_world`，符合 director 不直接写 World Engine 的第一阶段边界。

当前 `builtin-contracts.ts`：

- `DirectorOutputSchema.plot_updates.kind` 仍允许 `"plot"`。
- `DirectorOutputSchema` root 未显式 `{additionalProperties: false}`。
- `plot_updates` item 未显式 `{additionalProperties: false}`。
- 仍有 `simulator_requests` 字段，没有 `world_engine_requests`。

当前 `leader.default.profile.tsx` 与 reference：

- leader prompt 正确强调 World Engine 是动态世界状态与时间线唯一真相源。
- 但 `reference/agent/profile-routing.md` 仍写 `leader.default` 不路由到 Plot / simulator / director / RP。
- `reference/agent/leader-default.md` 仍写不维护 Plot 系统或旧 simulation workflow，且 “plot / simulator / director / emulation 都不在 leader.default 的职责内”。
- 这会让 leader 继续避开 director，无法把 Scene-only Plot 结构层纳入写作流程。

当前 `writer.profile.tsx`：

- toolset 只有 file + readonly `execute_world` + `report_result`，符合 writer 不持有 Plot tools。
- prompt 合同已经强调 `message` 是 brief，`input.path` 是唯一写入目标。
- 但 `normalizePayloadContext()` 注释仍写“写作模式不使用 Plot 系统”，容易把“writer 不直接使用 Plot tools”误写成“普通写作模式没有 Plot 结构层”。

当前测试：

- `server/agent/profiles/simulation-director-profiles.test.ts` 已覆盖 director root tools、prompt 和 output schema 引用，是 Slice 1 最直接落点。
- `server/agent/profiles/leader-assets-profile.test.ts` 覆盖 leader.default prompt/history/toolKeys，是 leader reference/profile 修改后的回归面。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 覆盖 writer 无 Plot tools，应保留这个断言。

## Required Diff

Slice 1 应做的最小系统性改动：

1. **Director prompt/source**
   - 删除 `simulator.leader` 和 `simulator_requests` 作为普通写作主链。
   - 把未决世界状态改成 `world_engine_requests`，返回给 leader.default 处理。
   - 保留“不直接写 World Engine，不直接调用 writer”的边界。
   - 明确 Scene-only Plot：Thread / Scene / Chapter Scene order / Scene World Anchor / writer handoff。

2. **Director output schema**
   - `plot_updates.kind` 改为 `thread | scene`。
   - `simulator_requests` 改为 `world_engine_requests`。
   - root 和 `plot_updates` item 增加 `additionalProperties: false`。
   - 字段 description 面向 leader 写清楚，不能只服务 TypeScript。

3. **Leader prompt/reference**
   - 保持 leader 不持有 Plot write tools。
   - 但改成：需要 Plot 结构变更、Scene 编排、brief 编译时 route 到 director。
   - leader 继续负责用户/canon/World Engine readwrite。
   - 不再把 director 与普通写作模式一起归入 legacy boundary。

4. **Writer prompt/source**
   - 保持不持有 Plot tools。
   - 把注释/说明改为“writer 不直接消费 Plot tools；上游应通过完整 message brief 注入 Scene/World Context”。
   - 保留 `input.path` 唯一写入目标。

## Test Updates

推荐测试断言：

- director prompt 不包含 `simulator_requests` / `Simulation gate` / `调用 simulator.leader`。
- director prompt 包含 `world_engine_requests`、Scene World Anchor、brief compiler 或 writer handoff。
- director `rootToolKeys` 仍包含 Plot tools 和 `get_scene_world_context`，仍不包含 `execute_world` / `write` / `edit`。
- `DirectorOutputSchema` 拒绝：
  - `plot_updates.kind: "plot"`。
  - root 额外字段 `simulator_requests`。
  - `plot_updates` item 额外字段。
- leader visible prompt/reference 不再说普通写作不路由到 director；应包含“剧情结构转 director”。
- writer toolKeys 仍不包含 Plot tools；prompt/注释不再表达“写作模式不使用 Plot 系统”。

## Result

Slice 1 的核心不是“换几个词”，而是把普通写作主链从旧 simulator gate 改成：leader 负责 World Engine/canon，director 负责 Scene-only Plot 和 brief handoff，writer 只消费 message brief 和写正文。当前文件差距已经明确，下一步可以按这些断言进入实现。

