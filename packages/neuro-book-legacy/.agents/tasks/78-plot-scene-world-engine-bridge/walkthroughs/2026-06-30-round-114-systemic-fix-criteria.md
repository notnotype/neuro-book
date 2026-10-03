# Round 114: Systemic Fix Criteria

## Scope

本轮按项目规则检查即将进入的 Profile Contract Cleanup 是否是系统性修复，而不是 hack。重点回答三个问题：是否系统性、是否能约束 Agent 以后少犯同类错误、哪些测试会受影响。没有改业务代码、没有运行测试。

## Is This Systemic?

系统性修复必须同时改四类 Interface：

1. `DirectorOutputSchema`
   - 删除旧 `simulator_requests`。
   - 删除旧 `plot` kind。
   - root 和 `plot_updates[]` item strict。
   - 新增 `world_engine_requests`。
2. profile source
   - system/user director source 删除 simulator gate。
   - leader.default 能路由 Scene / Chapter / brief 到 director。
   - writer 表达“不直接持有 Plot tools，可消费上游 brief”。
3. reference
   - `leader-default.md`、`profile-routing.md`、`novel-writing-workflow.md` 同步新协作链。
4. runtime artifact
   - system/user compiled manifest 和 active artifact 都更新。

只做其中一类都不是系统性修复。例如：

- 只改 prompt，不改 schema：旧字段仍能通过，Agent 仍可能报告 `simulator_requests`。
- 只改 schema，不改 prompt/reference：Agent 仍会按旧规则调用或排除 director。
- 只改 system source，不处理 user root：runtime 可能仍被 user profile shadow。
- 只改 source，不编译 artifact：运行仍使用旧 contract。

## Design Constraints To Prevent Future Drift

建议用以下约束防止以后 Agent 重新犯同类错误：

- TypeBox strict schema：让旧输出结构机械失败，而不是靠 prompt 约束。
- profile tests 对旧语言做负断言：`simulator_requests`、`Simulation gate`、`不路由到 Plot / director` 不应出现在新 prompt/reference。
- writer rendered context 继续不渲染 `threadIds/sceneIds/plotIds`，避免兼容字段重新变成普通路径。
- `get_agent_profile` discovery 测试固定“只返回 toolKeys/schema summary”，避免验收时误以为 caller 能看到完整 tool description。
- compiled artifact 检查固定在 Slice 1 验收里，避免 source/runtime 双状态漂移。

这些约束把错误从“Agent 是否听话”变成“schema/test/artifact 是否允许”，Locality 更好。

## Tests Impact

### Must Update

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director rootToolKeys 后续应包含 `get_chapter_writer_brief`，但 Slice 1 先改 prompt/schema。
  - prompt 应不含 `Simulation gate` / `simulator_requests`。
  - prompt 应含 `world_engine_requests`。
- `server/agent/profiles/leader-assets-profile.test.ts`
  - leader.default prompt/reference 应含 director routing。
  - writer payload 测试保留：legacy Plot ids 不进入 rendered context。
  - writer prompt 需要新断言：可消费上游 Scene / World Context brief。
- schema-only test
  - 对 `DirectorOutputSchema` 做 `Value.Check()` 正负例。
  - 旧 `simulator_requests`、旧 `kind: "plot"`、root extra、item extra 都失败。

### Should Keep

- writer rootToolKeys 不含 Plot tools。
- writer `invoke_agent.input.path` 是唯一写入目标。
- leader.default 不直接持有 Plot write tools。
- world.engine 不持有 Plot tools。

这些约束与新架构一致，不能因为允许 director 参与普通写作而放松。

### Likely Remove Or Replace

- 任何断言普通写作“不要路由 director / Plot”的测试都应删除或替换。
- 任何断言 director 输出 `simulator_requests` 的测试都应删除或替换。
- 任何断言 `plot_updates.kind` 支持 `"plot"` 的测试都应删除或替换。

## Stop Conditions

实现时遇到以下情况应停止并报告，而不是 hack 绕过：

- user root director profile 已手改且不能安全同步。
- `report_result.data` 必填性被误当成 runtime guarantee。
- 新 schema 需要 `any/unknown` 才能表达正常输出。
- compiled artifact 不能更新，但 source tests 已绿。
- leader.default 需要直接持有 full Plot write tools 才能让测试过。

这些都是设计矛盾，不应通过兼容 alias 或 prompt 堆叠解决。

## Conclusion

Profile Contract Cleanup 的系统性来自“schema + prompt + reference + compiled runtime + tests”同时移动。目标不是让当前 prompt 看起来更合理，而是用 Interface 和测试约束旧 simulator/Plot 语义不能再次混入普通写作链。

