# Round 122: Slice 1 Atomic Contract Delta

## Scope

本轮继续只做架构探索和实现前收敛，没有改业务代码、没有运行测试。

目标是把 `Profile Contract Cleanup` 从“要改哪些文件”压成一个不可拆散的原子合同变更。这个 Slice 不是提示词微调，而是 profile Interface 迁移。

## Current Evidence

只读核查结果：

- `server/agent/profiles/builtin-contracts.ts`
  - `DirectorOutputSchema.plot_updates.kind` 仍允许 `"plot"`。
  - `DirectorOutputSchema` 仍返回 `simulator_requests`。
  - root `Type.Object` 和 `plot_updates` item 都没有 `additionalProperties: false`。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - System prompt 仍写 `simulator.leader`、`simulator_requests`、`Simulation gate`。
- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - user root 同名 source 与 system 一样旧，会覆盖 system。
- `reference/agent/leader-default.md`
  - 仍写 `leader.default` 不维护 Plot 系统，不路由、创建或调用 `plot / simulator / director / emulation`。
- `reference/agent/profile-routing.md`
  - `leader.default` 行仍写“不路由到 Plot / simulator / director / RP”。
  - `director` 行仍把世界状态未裁决转 `simulator.leader`。
- `reference/agent/novel-writing-workflow.md`
  - 仍写 writer 不读取 Plot，并把 `director` 与 Plot System 放在普通写作 legacy 段。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  - `renderInputContext()` 注释仍写“写作模式不使用 Plot 系统”。
- `workspace/.nbook/.system-assets-sync-state.json`
  - director `upstreamHash` 和 `lastSyncedUserHash` 都等于旧 hash `80394e5e...`，说明当前 user director 仍跟随 system。实现后非 force sync 理论上可更新 user root，但必须以 sync 输出和 artifact grep 验收。

## Atomic Change

Slice 1 是一个原子变更，必须同时移动这些 Interface：

1. **Schema Interface**
   - 删除 `plot_updates.kind = "plot"`。
   - 删除 `simulator_requests`。
   - 新增 `world_engine_requests`。
   - root 和 `plot_updates` item 显式 `additionalProperties: false`。

2. **Director Prompt Interface**
   - 删除 `simulator.leader` / `Simulation gate` / `simulator_requests`。
   - 改成“World Engine 未决问题通过 `world_engine_requests` 交回 leader.default”。
   - 明确 director 不写 World Engine、不写正文。

3. **Leader Routing Interface**
   - leader.default 仍是用户 / canon / World Engine owner。
   - 涉及 Scene / Chapter Plot / writer brief 时调用 director。
   - 不给 leader.default 增加 Plot write tools。

4. **Writer Isolation Interface**
   - writer 仍无 Plot tools。
   - writer 不接 Plot ids；legacy `threadIds/sceneIds/plotIds` 继续不渲染。
   - 但 prompt/comment 要改成“不直接持有 Plot tools，可消费上游完整 Scene / World Context brief”，避免把 Plot/brief 误判为普通写作禁区。

5. **Runtime Interface**
   - system compiled artifact 更新。
   - active user compiled artifact 更新。
   - catalog discovery 不再暴露旧 director output schema。

## Why It Must Be Atomic

这些 Interface 不能分批提交为“部分可用”：

- 只改 schema：director prompt 仍会指导模型返回 `simulator_requests`，导致 report_result 失败。
- 只改 prompt：schema 仍允许旧字段和 `"plot"`，无法阻止回归。
- 只改 reference：旧 session 和当前 profile System 不会自动刷新完整意图。
- 只改 system source：user source 会覆盖 system。
- 只改 source：runtime 仍可能加载旧 artifact。

从 Module 深度看，`DirectorOutputSchema + director System + leader routing reference + compiled artifact` 才是完整 Interface。任一层留旧合同，都会把复杂度重新泄漏给 Agent 行为。

## Stop Conditions

实现 Slice 1 时遇到以下情况应停止：

- 需要保留 `simulator_requests` alias 才能让测试通过。
- 需要继续允许 `plot_updates.kind = "plot"` 才能兼容旧代码。
- user director 已手改，非 force sync 输出 warning。
- compiled artifact 无法生成或 active manifest 指向旧 sha。
- writer 需要 Plot tools 才能通过测试。

## Conclusion

Slice 1 的本质是 profile Interface 硬切。正确实现不是“让提示词更像新架构”，而是让 schema、prompt、reference、tests、system/user compiled runtime 同时拒绝旧 simulator contract。

