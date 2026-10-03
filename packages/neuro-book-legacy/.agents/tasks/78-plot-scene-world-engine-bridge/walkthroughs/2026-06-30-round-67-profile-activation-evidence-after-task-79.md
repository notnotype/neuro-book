# Round 67: Profile Activation Evidence After Task 79

## Context

本轮修正 earlier walkthrough 中关于 compiled profile “current pointer” 的旧表述。Task 79 已把 `.compiled` 切成内容寻址 artifact + manifest profile 映射，因此 Task 78 后续 profile 验收必须按新格式取证。

已读取和核对：

- `reference/agent/profile-compiled-artifacts.md`
- `docs/tasks/79-profile-build-system/README.md`
- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json`
- `workspace/.nbook/agent/profiles/.compiled/manifest.json`
- `assets/workspace/.nbook/agent/profiles/.compiled/artifacts/33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17.mjs`
- `workspace/.nbook/agent/profiles/.compiled/artifacts/33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17.mjs`

## Current Evidence

当前 compiled artifacts 稳定契约是：

- `.compiled/artifacts/<sha>.mjs` 是内容寻址不可变 artifact。
- `.compiled/manifest.json` 是当前指针，磁盘格式为 `profiles[profileKey]` 映射。
- runtime 只接受 `loaded` entry；`compile_failed`、`compile_stale`、`not_compiled`、`compiled_load_failed` 都不能静默回退旧产物。

当前 system root 与 user root 的 director manifest 都仍指向同一个旧 artifact：

- system profilesRoot：`assets/workspace/.nbook/agent/profiles`
- user profilesRoot：`workspace/.nbook/agent/profiles`
- `profiles.director.status = "loaded"`
- `profiles.director.sourceSha256 = 80394e5e4ada1a54c87cb920526671392e493eb4bd060621ebc4efacb0a8ceb6`
- `profiles.director.artifactSha = 33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17`

两个 artifact 都仍包含旧合同：

- `simulator_requests`
- `Simulation gate`
- “调用 simulator.leader”

且都不包含新合同：

- `world_engine_requests`
- `get_chapter_writer_brief`

当前 `workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 也存在旧 source。因为 user assets 会覆盖 system profile，这不是单纯的 stale artifact 问题，而是 active user root shadow 风险。

## Correct Acceptance Evidence

后续实现 Profile Contract Cleanup 后，验收不能再写“检查 current pointer”。应改成检查 manifest profile entry 和 artifact 内容。

建议证据链：

1. Source
   - `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 不含 `Simulation gate` / `simulator_requests`。
   - `workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 若存在，也必须同步或明确不再 shadow。

2. Schema
   - `server/agent/profiles/builtin-contracts.ts` 的 `DirectorOutputSchema` 已删除 `simulator_requests`，新增 `world_engine_requests`，并 strict。
   - `Value.Check()` 负例证明旧字段、旧 kind 和额外字段被拒绝。

3. System compiled artifact
   - `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json` 中 `profiles.director.artifactSha` 变化。
   - 新 artifact 不含 `simulator_requests` / `Simulation gate`。
   - 新 artifact 含 `world_engine_requests`。

4. User compiled artifact
   - 若 active user root 存在 director source，`workspace/.nbook/agent/profiles/.compiled/manifest.json` 中 `profiles.director.artifactSha` 必须同步变化，或明确 user source 已删除/不 shadow system。
   - artifact 内容同样需要 grep 验证。

5. Runtime/catelog
   - `ProfileBuildCoordinator` 和 build-status 只能作为辅助证据。最终 runtime 使用什么，仍以 active root manifest + artifact 内容为准。

## Commands For Later Implementation

后续实现时可使用这些命令验收，但本轮未执行编译或修改代码：

```powershell
bun scripts/build/profile.ts check builtin/director.profile.tsx --system
bun scripts/build/profile.ts compile builtin/director.profile.tsx --system
```

如果要同步 user assets，需要谨慎：

```powershell
bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets
```

该命令可能覆盖 user assets，只有在用户确认本地同步意图后再执行。若不 force，则手改 user source 可能继续 shadow system，这是后续验收必须显式处理的问题。

## Conclusion

Task 79 的新格式使 profile runtime 证据更清楚：`profiles.director.artifactSha` + `.compiled/artifacts/<sha>.mjs` 才是验收目标。当前 director source 和 compiled artifact 仍是旧 simulator gate 合同；因此 Task 78 的 Agent 易用性改造仍未落地，不能用设计文档或 source-only 测试声明完成。
