# Round 89: Slice 1 Entry Checklist Final

## Scope

本轮把 Slice 1 `Profile Contract Cleanup` 的入口检查表压成可执行顺序。结论是：后续实现不需要再扩展架构设计，应按该 checklist 小步落地。

## Patch Order

1. `server/agent/profiles/builtin-contracts.ts`
   - `DirectorOutputSchema` 删除 `simulator_requests`。
   - 新增 `world_engine_requests`。
   - `plot_updates.kind` 删除旧 `"plot"`。
   - root 和 `plot_updates` item 显式 `additionalProperties: false`。
2. `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
   - 删除 `simulator.leader` / `Simulation gate` / `simulator_requests`。
   - 写清 director 不写 World Engine，只返回 `world_engine_requests` 给 leader。
   - 保留 Plot / Scene / Chapter / writer_handoff 职责。
3. `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
   - 将“不要路由到 Plot/director”改为“当前 Scene-only Plot 结构任务路由 director”。
   - 保持 leader 不直接持有全套 Plot write tools。
   - 写清 leader 处理 director 的 `world_engine_requests` 后再调用 writer。
4. `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
   - 注释和 prompt 统一为 writer 不直接持有 Plot tools，但可消费上游完整 Scene / World Context brief。
   - 保持 `invoke_agent.message + input.path` 合同。
5. `reference/agent/leader-default.md`
   - 移除普通写作下 Plot/director 不存在的说法。
   - 加入 leader -> director -> writer 路由。
6. `reference/agent/profile-routing.md`
   - `leader.default` 可路由 director。
   - `director` 世界状态未决出口改为 leader / World Engine requests。
7. `reference/agent/novel-writing-workflow.md`
   - 普通写作链路从 `leader.default -> writer` 扩展为涉及 Plot/Scene 时 `leader.default -> director -> writer`。
8. `server/agent/profiles/simulation-director-profiles.test.ts`
   - prompt/toolset 正负断言。
   - schema strict `Value.Check()` 负例。

## Test Scope

最小测试：

```powershell
bun vitest run server/agent/profiles/simulation-director-profiles.test.ts
```

如果 `builtin-contracts.ts` 变化影响其它 profile schema，可追加：

```powershell
bun vitest run server/agent/profiles
```

## Runtime Activation Scope

实现和测试通过后，继续：

```powershell
bun scripts/build/profile.ts check director --system
bun scripts/build/profile.ts compile director --system
bun scripts/build/prepare-system-assets.ts --sync-user-assets
bun scripts/build/profile.ts status director --system
bun scripts/build/profile.ts status director
```

然后检查 active user source/artifact 和 `get_agent_profile` discovery。

## Stop Conditions

实现中遇到以下情况应停止：

- 需要保留 `simulator_requests` 兼容 alias 才能让测试通过。
- 需要让 director 直接写 World Engine。
- 需要让 writer 持有 Plot tools。
- 非 force sync 报告 director user profile 已手改，但仍想声明 runtime 更新完成。
- `DirectorOutputSchema` strict 需要用 `any` / `unknown` 绕过。

## Conclusion

这是当前 Task 78 Agent 易用性改造的明确入口。下一步如果开始实现，应只做 Slice 1，不同时混入 OpenAPI、brief service 或 tool binding，避免一次补丁跨越过多 Interface。

