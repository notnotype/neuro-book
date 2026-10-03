# Round 66: Profile Contract Cleanup Patch Surface

## Context

本轮继续只读探索 Task 78 的 Agent 易用性后续，不修改业务代码。目标是把 Slice 1 `Profile Contract Cleanup` 从“方向明确”推进到可直接实现的补丁面，并确认当前 worktree 是否仍存在旧 `simulator` / `Plot Beat` 语义。

已读取和核对：

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/simulation-director-profiles.test.ts`
- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`
- `reference/agent/profile-compiled-artifacts.md`
- `docs/tasks/79-profile-build-system/README.md`
- `PROJECT-STATUS.md`

## Current Evidence

当前 `director.profile.tsx` 仍把普通写作剧情设计连接到旧 simulator route：

- 核心职责仍写“把用户、leader.default 或 simulator.leader 确认后的剧情结构落库”。
- 核心职责仍写“在需要未裁决世界状态时调用 simulator.leader，或在 simulator_requests 中列出需要裁决的问题”。
- 工具边界仍要求“需要世界裁决时，创建或复用 simulator.leader”。
- 工作流程第 4 步仍是 `Simulation gate`。
- Report 合同仍要求 `simulator_requests`。

当前 `server/agent/profiles/builtin-contracts.ts` 的 `DirectorOutputSchema` 仍有旧字段和旧对象类型：

- `plot_updates.kind` 仍允许 `"plot"`。
- 根对象仍包含 `simulator_requests`。
- root object 与 `plot_updates` item 没有显式 strict 选项，因此 TypeBox 默认是否拒绝额外字段不能作为验收依据，Slice 1 应显式声明 `additionalProperties: false`。

当前 writer profile 的注释仍把 Plot 整体描述为“不使用 Plot 系统”：

- `writer.profile.tsx` 中 `normalizePayloadContext()` 注释写“写作模式不使用 Plot 系统”。
- 这会误导维护者。新架构不是写作模式不使用 Plot，而是 writer 不直接持有 Plot tools；writer 消费上游完整 brief。

当前 reference 仍与目标拓扑冲突：

- `reference/agent/profile-routing.md` 仍写 `leader.default` “不路由到 Plot / simulator / director / RP”。
- 同文件 `director` 行仍写“世界状态未裁决先转 simulator.leader”。
- `reference/agent/novel-writing-workflow.md` 仍写 writer 不读取 Plot，且普通写作中 `director` / Plot System 只作为 legacy 或历史维护资料保留。

## Patch Surface

Slice 1 应分为四组文件，保持小补丁，不进入 brief tool 实现：

1. `director.profile.tsx`
   - 移除普通写作主链里的 `simulator.leader` / `Simulation gate`。
   - 将 director 定义为 Plot write owner + future brief compiler。
   - 世界状态未裁决时不调用 simulator；改为返回 `world_engine_requests`，由 `leader.default` 处理 World Engine 推进或转 `world.engine`。
   - Report 合同改为 `summary/status/plot_updates/chapter_plan/writer_handoff/world_engine_requests/open_questions`。
   - prompt 中明确 `get_chapter_writer_brief` 是后续 brief compiler 工具；工具未落地前不能写成当前可调用能力。

2. `builtin-contracts.ts`
   - `DirectorOutputSchema.plot_updates.kind` 只允许 `"thread" | "scene" | "chapter"`，不要保留 `"plot"` alias。
   - 删除 `simulator_requests`，新增 `world_engine_requests`。
   - root object 和 `plot_updates` item 显式 strict。
   - 字段 description 写给 `leader.default` 能直接理解：这些是需要 World Engine owner 确认、推进或查询的问题，不是 director 自己模拟的问题。

3. Reference files
   - `reference/agent/profile-routing.md`：允许 `leader.default` 在需要 Plot 结构或 chapter writer brief 时路由到 `director`；`director` 未裁决世界状态回报给 leader / World Engine，不转 simulator。
   - `reference/agent/novel-writing-workflow.md`：普通写作主链改为 `leader.default -> director -> leader.default -> writer`，其中 World Engine 推进仍由 leader 或 `world.engine` owner 负责。
   - `reference/agent/leader-default.md` 如仍排除 Plot/director，也要同步。

4. `writer.profile.tsx`
   - 仅改维护注释和 prompt 语义：writer 不直接使用 Plot tools，不接 Plot ids 作为写入指令；writer 消费 `invoke_agent.message` 中的完整 brief，并只写 `invoke_agent.input.path` 指定目标。
   - 不给 writer 增加 Plot tools。

## Test Surface

主测试落点仍是 `server/agent/profiles/simulation-director-profiles.test.ts`，但需要新增 schema-only 测试。

建议断言：

- director prompt 不再包含 `Simulation gate`、`simulator_requests`、普通写作中调用 `simulator.leader` 的指令。
- director prompt 包含 `world_engine_requests` 和 Scene-only Plot 语义。
- director root tools 仍含 Plot read/write tools 与 `get_scene_world_context`，不含 file write/edit。
- writer profile 不暴露 Plot tools。
- `Value.Check(DirectorOutputSchema, validNewOutput)` 为 true。
- `Value.Check(DirectorOutputSchema, { ..., simulator_requests: [] })` 为 false。
- `Value.Check(DirectorOutputSchema, { plot_updates: [{ kind: "plot", ... }] })` 为 false。
- `Value.Check(DirectorOutputSchema, { extra: true, ... })` 为 false。

## Conclusion

Slice 1 的关键不是“改几句 prompt”，而是加深 `director` 这个 Module 的 Interface：让调用者只需要知道 director 负责 Plot/brief，不需要同时理解旧 simulator、Plot Beat、World Engine owner 的混合规则。删除旧字段不做兼容 alias 是正确方向；当前项目处于快速开发阶段，保留 alias 会继续把错误合同暴露给 Agent。

继续纯探索对 Slice 1 的新增收益很低。下一步若用户确认实现，应先做这组 Profile Contract Cleanup，而不是先实现 `get_chapter_writer_brief`。
