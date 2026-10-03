# Round 119: User Shadow And Compiled Artifact Rollout

## Scope

本轮补齐 Profile Contract Cleanup 的运行时发布口径。没有改业务代码、没有运行测试。

目标是防止一种假完成：system profile source 已改，但 active user profile 或 `.compiled` artifact 仍在运行旧 director。

## Current Evidence

只读核查结果：

- system director manifest：`status=loaded`，`fileName=builtin/director.profile.tsx`，`sourceSha256=80394e5e4ada1a54c87cb920526671392e493eb4bd060621ebc4efacb0a8ceb6`，`artifactSha=33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17`。
- user director manifest：同样 `status=loaded`，同样 source sha 与 artifact sha。
- system/user active artifact `33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17.mjs` 仍包含 `simulator_requests`、`Simulation gate`、`simulator.leader`。
- 这证明当前 active runtime 仍是旧 director contract。只改 source 文件不能证明 Agent 行为已更新。

## Architecture Reading

Profile 在这里不是单个文件，而是三层 Module：

1. **Source Module**：system source 与 user source。
2. **Compiled Artifact Module**：`.compiled/manifest.json -> artifacts/<sha>.mjs`。
3. **Catalog Module**：运行时加载 system 后由 user 覆盖，最终 active profile 来自 catalog。

这三个 Module 的 Interface 不同：

- source Interface 证明人类可读合同已改。
- artifact Interface 证明 runtime 可 import 的代码已改。
- catalog Interface 证明 active profile 没有被 user shadow 回旧版本。

Profile Contract Cleanup 的验收必须跨过这三个 seam。只跨 source seam 是浅证明。

## Rollout Requirement

Slice 1 实现后必须按这个顺序处理：

1. 修改 system profile source、schema、reference 和 tests。
2. 判断 user root 中的同名 profile 是否仍跟随 system。
3. 若 user profile 仍跟随 system，用非 force user assets sync 更新 user source 与 compiled artifact。
4. 若 user profile 已手改，不能静默覆盖；把 user shadow 作为 stop condition，先报告差异并等待明确处理策略。
5. 编译 system source，确认 system manifest 指向新 artifact。
6. 同步或编译 active user root，确认 user manifest 指向新 artifact。
7. 检查 active artifact 内容，不只看 `status=loaded`。

## Acceptance

Profile Contract Cleanup 只有满足以下条件才算运行时完成：

- system source 不再包含 `simulator_requests`、`Simulation gate`、普通写作调用 `simulator.leader`。
- user source 不再包含同一组旧合同文本，或明确不存在 active user shadow。
- system manifest 的 director `sourceSha256` / `artifactSha` 不再是本轮记录的旧值。
- user manifest 的 director `sourceSha256` / `artifactSha` 不再是本轮记录的旧值。
- system/user active director artifact 均不包含旧字段和旧 gate。
- schema strict 测试证明旧 `simulator_requests`、旧 `plot_updates.kind="plot"`、root extra、item extra 均被拒绝。
- `get_agent_profile("director")` 的 discovery 结果与新 schema/toolKeys 一致。

## Stop Condition

如果 user root 存在手改 director 并会覆盖 system director，不能用“system profile 已更新”宣布完成。应停止 Slice 1，报告 user shadow，并让用户决定：

- 合并手改到新 system contract。
- 覆盖 user profile。
- 临时删除/禁用 user shadow。

## Conclusion

Task 78 的 profile 改造必须把 active user runtime 当作最终证据面。compiled artifact 是运行真相源；source diff 和 `profile check passed` 都不足以证明 Agent 已使用新 contract。

