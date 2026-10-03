# 2026-06-30 Round 25 - Profile Patch Sequence

## Scope

本轮把 Director + Brief Compiler 架构拆成最小可落地的 profile/routing/schema 补丁顺序。目标是先修 Agent 的认知与输出 Interface，再加新 tool。

本轮不修改业务代码。

## Current Friction

当前 profile 系统的冲突不是工具数量不足，而是职责文字和结构化输出不一致：

- `leader.default` 有 World Engine readwrite，但 reference 仍说普通写作不路由到 Plot/director。
- `director` 有 Plot read/write 和 Scene World Context tool，但 prompt 仍把未裁决世界状态导向 `simulator.leader`。
- `DirectorOutputSchema` 仍有已经删除的 `plot` kind，且字段名仍叫 `simulator_requests`。
- `writer` 的真实实现会忽略 Plot id，但注释和文档容易被理解为“Plot 系统在写作模式不存在”。

这些会让 Agent 即使拿到 `get_chapter_writer_brief`，也可能继续按旧 simulation 方案分派。

## Patch Sequence

### P1 Reference First

先改稳定 reference：

- `reference/agent/profile-routing.md`
  - `leader.default` 的适合项加入“必要时调度 director 维护 Scene-only Plot System”。
  - 错位建议改成：剧情结构/Scene 落库转 `director`；复杂 World Engine 数据维护转 `world.engine`。
  - `director` 的不适合项改为“不写 World Engine、不写正文”，不再导向 `simulator.leader`。
- `reference/agent/leader-default.md`
  - `Writing Mode World State` 不再说 Plot/director 不存在。
  - 加一段 `Director Collaboration`：Plot 是 Scene-only 作者结构层，结构改动由 director 执行，leader 保持 canon 和 World Engine owner。
  - `Writer Collaboration` 明确 writer message 应消费完整 brief，不使用 Plot ids。
- `reference/agent/novel-writing-workflow.md`
  - Standard Flow 在 Plot/state planning 和 Chapter writing 之间加入 director/brief compiler 步骤。
  - Legacy Boundary 只保留 `simulation/`、`emulation`、RP Tick，不再把 Plot System/director 整体放进 legacy。

### P2 Builtin Prompt

再改 profile prompt：

- `leader.default.profile.tsx`
  - 保持不暴露 Plot write tools。
  - 明确需要 Thread / Scene / Chapter Scene order 时创建或复用 `director`。
  - 写入 World Engine 后，再让 director 更新 Scene World Anchor / summary。
- `director.profile.tsx`
  - `description` 改成不维护 World Engine state，而不是不维护 simulation state。
  - 删除 `Simulation gate`。
  - 改为 `World Engine request gate`：未裁决事实写入 `world_engine_requests`，交给 leader 处理。
  - `writer_handoff` 优先来自 brief tool；brief tool 不在时可手写。
- `writer.profile.tsx`
  - 注释从“写作模式不使用 Plot 系统”改为“writer 不直接使用 Plot tools；上游 message brief 已编译 Plot/World Context”。

### P3 Output Schema

最后改结构化输出 Interface：

```ts
plot_updates.kind: "thread" | "scene"
world_engine_requests: string[]
```

删除：

```ts
plot_updates.kind: "plot"
simulator_requests: string[]
```

项目处于快速开发阶段，不需要为旧 `simulator_requests` 做 legacy 兼容。保留兼容字段会降低 Interface 约束力，让 director 继续以旧 simulation 心智工作。

## Tests

最小测试矩阵：

- `simulation-director-profiles.test.ts`
  - director prompt 不含 `Simulation gate` / `simulator_requests`。
  - director prompt 含 `world_engine_requests`。
  - `DirectorOutputSchema` 拒绝 `kind: "plot"`。
  - `DirectorOutputSchema` 接受 `world_engine_requests`。
- `leader-assets-profile.test.ts` 或新增轻量 profile 测试
  - leader prompt/已注入 reference 不再说普通写作不路由 director。
  - leader tool keys 仍不包含 Plot 写工具。
- `writer.profile.test.ts`
  - writer 仍没有 Plot tools。
  - prompt 明确 Plot/World Context 通过完整 message brief 进入。

## Result

本轮结论：profile 改造应先改 reference 和 prompt，再改 schema。原因是 `DirectorOutputSchema` 是 director 的强 Interface；如果先加 `get_chapter_writer_brief`，旧 prompt 仍会把缺失事实导向 simulator，brief tool 的 Leverage 会被旧职责文字抵消。

