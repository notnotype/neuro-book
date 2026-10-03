# Round 88: User Assets Sync Decision

## Scope

本轮检查 Slice 1 后如何处理 user profile shadow。结论是：优先使用非 force user assets sync 更新仍跟随上游的 user copy；只有用户明确同意覆盖手改内容时才使用 force。

## Current Evidence

- `server/workspace-files/novel-workspace.ts`
  - `syncSystemAssetsToUserAssets()` 默认只补缺失和仍跟随上游的文件。
  - `options.force` 为 true 时覆盖用户侧受管系统资源。
  - profile sync 判断：
    - user file 不存在：复制 system source，并同步 compiled artifact。
    - user file 与 system source 相同：同步 compiled artifact，更新 sync state。
    - user file hash 等于 `lastSyncedUserHash` 且 system upstream 变化：自动更新 user source 和 compiled artifact。
    - user file 已手改：非 force 保留 user file，并报告 warning。
    - force：覆盖 user file，并同步 compiled artifact。
  - `syncCompiledProfileArtifact()` 会 rehome system artifact 到 user manifest，并通过 `ProfileReleasePublisher` 发布。
- `workspace/.nbook/.system-assets-sync-state.json`
  - 当前 `builtin/director.profile.tsx` 的 `lastSyncedUserHash` 等于旧 `upstreamHash`。
  - 这说明当前 user director 看起来仍是受管同步副本，没有手改迹象。

## Decision

Slice 1 改完 system profile 后，推荐默认路径：

1. 编译 system profile。
2. 执行非 force sync：
   ```powershell
   bun scripts/build/prepare-system-assets.ts --sync-user-assets
   ```
3. 检查输出 warning。
4. 如果 director 没有 warning，继续检查 user source/manifest/artifact。

不推荐默认执行：

```powershell
bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets
```

原因是 force 会覆盖用户侧受管系统资源；即使当前证据显示 director 没有手改，也不应把 force 作为默认验收路径。

## Acceptance

非 force sync 成功后应检查：

- `workspace/.nbook/.system-assets-sync-state.json` 的 `builtin/director.profile.tsx` upstreamHash 更新到新 system hash。
- `lastSyncedUserHash` 等于 user source 新 hash。
- user source 不含旧 simulator gate。
- user manifest/artifact 已更新。
- 没有 profile sync warning 指向 director。

如果非 force sync 出现 warning：

- 不继续声称 runtime 使用新 director。
- 记录 warning。
- 需要用户决定：保留手改 user profile 并手动合并，或允许 force 覆盖。

## Interface Impact

user assets sync 是 system -> user 的 Adapter，不是业务实现的一部分。Profile Contract Cleanup 的 Implementation 不应内嵌“强制覆盖 user assets”的假设；验收文档要把“同步成功”和“用户手改冲突”作为两个分支。

## Conclusion

当前 director user copy 看起来仍跟随上游，所以非 force sync 很可能足够。但验收必须以 sync 输出、sync state、user source 和 user artifact 为准，不能因为当前 state 看起来安全就默认 force。

