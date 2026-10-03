# 2026-06-30 Round 33 - Profile Contract Cleanup Blueprint

## Scope

本轮把 Round 29 Slice 1 拆成可执行 blueprint。目标是后续实现时能按文件推进，不再重新解释为什么要去旧 Plot / simulator 语义。

本轮不修改业务代码。

## Current Evidence

当前仍存在这些真实断点：

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 仍写 `Simulation gate`。
- `director.profile.tsx` 仍要求调用 `simulator.leader` 或返回 `simulator_requests`。
- `server/agent/profiles/builtin-contracts.ts` 的 `DirectorOutputSchema.plot_updates.kind` 仍允许 `"plot"`。
- `DirectorOutputSchema` 仍使用 `simulator_requests`。
- `leader.default.profile.tsx` 仍说写作模式不维护旧 Plot / simulation 系统，且不要路由到它们。
- `writer.profile.tsx` 注释仍写“写作模式不使用 Plot 系统”。
- `reference/agent/novel-writing-workflow.md` 仍把 `director` / Plot System 放到 Legacy Boundary。

## Target Interface

Director 的第一阶段输出 Interface：

```ts
{
    summary: string;
    status: "completed" | "needs_user" | "blocked";
    plot_updates: Array<{
        kind: "thread" | "scene";
        action: "created" | "updated" | "read" | "skipped";
        id?: string;
        title?: string;
        summary: string;
    }>;
    chapter_plan: string;
    writer_handoff: string;
    world_engine_requests: string[];
    open_questions: string[];
}
```

删除旧 Interface：

- `plot_updates.kind = "plot"`
- `simulator_requests`

## File Changes

### `reference/agent/profile-routing.md`

改动目标：

- `leader.default` 适合项加入调度 `director` 管理 Scene-only Plot System。
- `leader.default` 不适合项只排除 RP、资产维护、长期正文亲写，不再排除 director/Plot。
- `director` 错位建议从 `simulator.leader` 改为：世界状态未决回 `leader.default`，复杂 World Engine 数据维护转 `world.engine`。

### `reference/agent/leader-default.md`

改动目标：

- `Writing Mode World State` 不再说 Plot/director 不存在。
- 新增 `Director Collaboration` 小节：
  - Plot 是 Scene-only 作者结构层。
  - leader 不直接维护 Thread / Scene。
  - 需要结构落库时创建或复用 director。
  - director 返回 `world_engine_requests` 时由 leader 用 World Engine 处理。

### `reference/agent/novel-writing-workflow.md`

改动目标：

- Current Contract 加入 director 是 Plot/brief specialist。
- Standard Flow 在 World Engine planning 与 Chapter writing 之间加入 director/brief compiler。
- Legacy Boundary 删除 `director` / Plot System，只保留 `simulation/`、`emulation`、RP Tick。

### `leader.default.profile.tsx`

改动目标：

- World Engine 段落改成“不维护旧 simulation/RP；Plot System 是 Scene-only 作者结构层，由 director 维护”。
- 与 writer 协作段落改成“writer brief 来自 leader 编辑后的完整 brief，可由 director / brief tool 生成基础稿”。
- 不新增 Plot tools。

### `director.profile.tsx`

改动目标：

- description 从“不维护 simulation state”改成“不写 World Engine、不写正文”。
- 核心职责删除 `simulator.leader`。
- `Simulation gate` 改为 `World Engine request gate`。
- 输出合同使用 `world_engine_requests`。
- 工作流程把 read 步骤扩展为 `get_chapter_writer_brief` 可用后优先生成 brief。

### `writer.profile.tsx`

改动目标：

- 注释从“写作模式不使用 Plot 系统”改为“writer 不直接使用 Plot tools；Plot/World Context 已由上游 brief 编译”。
- prompt 中强调：不要根据 Plot id 自行规划剧情；message brief 是执行依据。

### `builtin-contracts.ts`

改动目标：

- 删除 `Type.Literal("plot")`。
- `simulator_requests` 改为 `world_engine_requests`。
- description 用 World Engine / leader 语言，不再写 simulator。

## Tests

最小测试：

- `simulation-director-profiles.test.ts`
  - prompt 不包含 `Simulation gate`。
  - prompt 不包含 `simulator_requests`。
  - prompt 包含 `world_engine_requests`。
  - prompt 包含 `Scene World Anchor` 或 `Scene World Engine 上下文`。
- 新增或扩展 schema test：
  - `Value.Check(DirectorOutputSchema, validWorldEngineRequestsPayload)` 为 true。
  - `kind: "plot"` 为 false。
  - `simulator_requests` payload 为 false。
- `writer.profile.test.ts`
  - writer root tools 仍无 Plot tools。
  - prompt/注释语义改为上游完整 brief。

## Result

Profile Contract Cleanup 的本质是加深 director contract：删除旧 simulator/plot beat 语义，让调用方不能再通过结构化输出走旧路线。后续实现应先做这一步，再添加 `get_chapter_writer_brief`。

