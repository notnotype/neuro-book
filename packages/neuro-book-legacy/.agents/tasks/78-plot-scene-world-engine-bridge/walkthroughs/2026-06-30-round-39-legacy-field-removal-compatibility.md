# 2026-06-30 Round 39 - Legacy Field Removal Compatibility

## Scope

本轮继续实现前探索，专门审计 Slice 1 中删除旧 director 字段的兼容性风险。问题是：`DirectorOutputSchema` 是否应该硬删除 `plot_updates.kind = "plot"` 和 `simulator_requests`，还是保留一段过渡兼容。

本轮不修改业务代码。

## Current Evidence

当前 worktree 证据：

- `server/agent/profiles/builtin-contracts.ts` 仍定义 `DirectorOutputSchema.plot_updates.kind = "thread" | "scene" | "plot"`。
- 同一 schema 仍要求 `simulator_requests: string[]`。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 仍有 `Simulation gate`，并要求缺失世界状态时调用 `simulator.leader` 或返回 `simulator_requests`。
- `rg` 未发现业务运行时直接读取 `DirectorOutputSchema.simulator_requests` 的代码；当前强引用主要是 director profile、profile catalog/report_result schema 派生和 `simulation-director-profiles.test.ts`。
- `world_engine_requests` 目前主要存在于 Task 78 walkthrough / README 设计文档中，尚未落地到 active profile schema。

结论：旧字段不是普通业务数据读写依赖，而是 profile output interface 的旧心智入口。

## Options

### A. 双字段过渡

保留 `simulator_requests`，新增 `world_engine_requests`，prompt 要求普通写作只填新字段。

优点：

- 旧 director 输出短期仍能通过 schema。
- 改动更小。

缺点：

- Interface 继续允许旧 simulation 心智。
- 测试只能证明“新字段可用”，不能证明旧路径被关闭。
- `get_chapter_writer_brief` 加入后，director 仍可能把 World Engine 缺口错误交给 simulator。

### B. 直接硬删除

`DirectorOutputSchema` 改为：

- `plot_updates.kind = "thread" | "scene"`。
- 删除 `simulator_requests`。
- 新增必填 `world_engine_requests: string[]`。

优点：

- Interface 本身阻止旧 Plot Beat / simulator 输出。
- 与项目当前“快速开发、无需 legacy 兼容”的规则一致。
- 后续 brief tool 不会被旧字段语义稀释。

缺点：

- 旧保存的 director report_result data 若被重新校验，可能不再符合当前 schema。
- 需要同步 profile tests，否则测试会明确失败。

### C. 字段别名

保留 `simulator_requests` 作为 deprecated alias，运行时或 prompt 解释为 World Engine requests。

缺点大于收益：字段名会继续把普通写作导向旧 simulation。该方案不建议采用。

## Decision

采用 **B. 直接硬删除**。

原因：本轮目标不是兼容旧 director 输出，而是让 profile 系统在结构上约束 Agent 不再走旧 Plot / simulator 语义。保留兼容字段会让错误路径继续存在，和 Scene-only Plot System 的架构目标冲突。

## Implementation Guard

Slice 1 测试需要证明：

- 有效 director output 必须包含 `world_engine_requests`。
- `plot_updates.kind = "thread"` / `"scene"` 通过。
- `plot_updates.kind = "plot"` 不通过。
- 只包含 `simulator_requests` 且缺少 `world_engine_requests` 的 payload 不通过。
- director prompt 不包含 `Simulation gate` / `simulator_requests`。
- director prompt 包含 `world_engine_requests`，并说明由 leader 用 World Engine 处理。

如果实现时需要禁止 payload 同时带新旧字段，需要把 `DirectorOutputSchema` 设为 `additionalProperties: false`，并评估 report_result 对额外字段的容忍度。最低限度必须拒绝 legacy-only payload。

## Result

旧字段删除不需要再设计兼容层。Slice 1 应把 `DirectorOutputSchema` 当作强 Interface 直接改掉；历史 RP / simulator profile 继续保留，但普通写作 director 不再通过 `simulator_requests` 表达世界状态缺口。

