# Round 72: User Profile Shadow Rollout Strategy

## Scope

本轮只审计 Profile Contract Cleanup 落地后的 rollout 风险，不改业务代码。重点是：system profile 改完并编译后，runtime 是否真的会使用新 director。

## Evidence Checked

- `server/agent/profiles/catalog.ts`
  - catalog 先加载 system profile，再加载 user profile。
  - 同一个 `manifest.key` 下，user source 会 `profiles.set()` 覆盖 system source。
  - `system_profile_shadowed` 是 warning，不会阻止 user profile 加载。
- `server/workspace-files/system-assets-preflight.ts`
  - `prepareSystemAssets()` 先编译 system variables/profile artifacts。
  - 只有传入 `syncUserAssets` 时才同步到 user assets。
  - 只有传入 `forceSyncUserAssets` 时才强制覆盖 user assets。
- `server/workspace-files/novel-workspace.ts`
  - `syncSystemProfilesToUserAssets()` 默认只同步缺失、与 system 相同、或仍跟随上游的 user profile。
  - 若 user profile 缺 sync state，默认保留用户文件。
  - 若 user profile 已手改，默认保留用户文件并写 warning。
  - `options.force` 才覆盖 user profile，并同步 compiled artifact。
- 当前本地状态
  - system director source 仍包含 `simulator_requests` / `Simulation gate`。
  - user director source 也仍包含 `simulator_requests` / `Simulation gate`。
  - system manifest `profiles.director.artifactSha` 当前指向 `33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17`。
  - user manifest `profiles.director.artifactSha` 当前指向 `b2fd54a5c661c7211d4fc48deb6e829885012573db49d4ac1cf310a92639dadd`。
  - 两个 active artifact 都能搜到旧 `simulator_requests`。
  - `workspace/.nbook/.system-assets-sync-state.json` 当前记录 director `upstreamHash` 和 `lastSyncedUserHash` 都是旧 source hash `80394e5e4ada1a54c87cb920526671392e493eb4bd060621ebc4efacb0a8ceb6`。

## Conclusion

Slice 1 不能只验证 `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 和 system `.compiled`。runtime catalog 会把 user root 也纳入加载，且 user profile 会覆盖 system profile。

当前 user director 看起来仍跟随上游，没有手改 hash；因此后续正常 `--sync-user-assets` 很可能可以把新的 director source/artifact 同步过去。但这只是当前机器状态，不是普遍保证。缺 sync state、用户手改、同步失败都会导致 user root 继续 shadow system。

## Rollout Strategy

推荐 Slice 1 验收分三层：

1. System source/artifact
   - 修改 `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`。
   - 编译 system profiles。
   - 检查 system manifest `profiles.director.artifactSha` 指向新 artifact。
   - 检查新 system artifact 不含 `simulator_requests` / `Simulation gate`，且含 `world_engine_requests`。

2. User source/artifact
   - 执行正常 user assets sync 后检查 `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`。
   - 检查 user manifest `profiles.director.artifactSha` 指向同步后的可运行 artifact。
   - 检查 active user artifact 不含旧字段和旧 prompt。

3. Catalog/runtime
   - 通过 profile catalog 或 build-status 确认 active director 是 loaded。
   - 若 user root 仍保留旧 director，不声明 runtime 使用新 director。
   - 若出现 `system_profile_shadowed`，必须把它当作 rollout warning，而不是忽略。

## Force Sync Boundary

`prepare-system-assets --sync-user-assets --force-sync-user-assets` 可以覆盖 user assets，但会覆盖用户手改内容。除非用户明确确认，不应把 force sync 作为默认实现步骤。

可接受的默认路线是：先正常同步；如果同步结果显示 user director 未更新，再报告具体 shadow 文件、sync state 和风险，由用户决定是否强制覆盖、手动合并或保留 user override。

## Acceptance Impact

后续 checklist 应增加：

- active user director source 已更新，或明确不存在 user shadow。
- active user director artifact 已更新，且 manifest `profiles.director.artifactSha` 指向新 artifact。
- `rg "simulator_requests|Simulation gate"` 不应命中 active director source/artifact。
- `rg "world_engine_requests"` 应命中 active director source/artifact。
- 如果只更新了 system root，验收结论只能写“system artifact 已更新”，不能写“runtime director 已更新”。

