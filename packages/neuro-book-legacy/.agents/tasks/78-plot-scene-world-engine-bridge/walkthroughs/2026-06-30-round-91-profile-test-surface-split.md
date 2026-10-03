# Round 91: Profile Test Surface Split

## Scope

本轮复查 Slice 1 `Profile Contract Cleanup` 的测试落点。目标是避免实现时只更新 director 测试，却漏掉 leader / writer 现有断言。

## Evidence

- `server/agent/profiles/simulation-director-profiles.test.ts` 当前集中覆盖 `simulator.leader` 与 `director`：
  - director `initialSchema/outputSchema`；
  - director `rootToolKeys` 包含 `get_scene_world_context`，不含旧 plot 工具与文件写入工具；
  - director prompt 仍断言旧 `Thread / Scene`、`reference/plot/agent-spec.md` 等内容。
- `server/agent/profiles/leader-assets-profile.test.ts` 当前会 prepare `leader.default`，并检查可见 prompt：
  - 包含 `create_agent/invoke_agent/get_agent_profile`、`execute_world`、writer/retrieval/researcher 语义；
  - 当前没有正向断言 leader 可路由 `director`；
  - 由于 leader.default prompt/reference 仍写着“不维护旧 Plot / simulation 系统，不要调用 director/Plot”，Slice 1 改完后这里应补正负断言。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 当前已有 writer 工具边界断言：
  - writer 有 `execute_world`；
  - writer 不持有 `get_story_thread/get_story_scene_context/get_chapter_plot` 等 Plot tools；
  - 这符合目标架构，不应被 Slice 1 破坏。
- `server/agent/profiles/leader-assets-profile.test.ts` 还覆盖 writer payload prepare：
  - `threadIds/sceneIds/plotIds` 不再渲染给 writer；
  - `invoke_agent.message` 原文在 appending messages 中传给 writer；
  - 这与新设计兼容：Scene / World Context brief 应进入 `invoke_agent.message`，而不是通过 writer payload 的旧 ids 字段进入。

## Test Adjustment

Slice 1 的测试不应只写 director schema strict 负例，还应覆盖三个 profile 的协作合同：

1. `simulation-director-profiles.test.ts`
   - director prompt 不再包含 `Simulation gate`、`simulator_requests`、`simulator.leader`；
   - director prompt 包含 `world_engine_requests` 和“director 不直接写 World Engine”；
   - director output schema 用 `Value.Check()` 证明：
     - 新合同通过；
     - 旧 `simulator_requests` 失败；
     - 旧 `plot_updates.kind = "plot"` 失败；
     - root extra field 失败；
     - `plot_updates[]` item extra field 失败。
2. `leader-assets-profile.test.ts`
   - leader.default prompt/reference 包含“涉及 Thread / Scene / Chapter / writer handoff 时调用 director”；
   - 不再包含“Plot / director 在 leader.default 职责内不存在”这类硬排除语言；
   - 继续证明 leader.default 不直接持有 Plot write tools。
3. `writer.profile.test.ts` 或 `leader-assets-profile.test.ts`
   - 继续证明 writer 不持有 Plot tools；
   - 增加 prompt 语言断言：writer 不直接使用 Plot tools，但可以消费上游完整 Scene / World Context brief；
   - 保持旧 id 字段不渲染给 writer 的 payload 测试。

## Minimal Command Update

Round 89 的最小测试命令可以扩展为：

```powershell
bun vitest run server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts
```

如果实现选择把所有关键断言集中到 `simulation-director-profiles.test.ts`，仍建议至少跑一次 `leader-assets-profile.test.ts`，因为它会真实 prepare `leader.default` 并加载 reference/history 文本。

## Conclusion

Slice 1 的测试 seam 是 profile contract，但当前测试文件已经自然分裂为 director、leader、writer 三块。实现时应跟随这个事实，避免只让 director 测试变绿而留下 leader 继续排斥 director、writer prompt 继续表达“写作模式不使用 Plot 系统”的语言漂移。
