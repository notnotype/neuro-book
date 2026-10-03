# Round 12 — User Assets Sync Release Consistency

## Summary

- 修复 user-assets 同步入口的 release 一致性缺口：HTTP runtime 的 `/api/workspace-files/sync-user-assets` 不再走纯 `disk_only`，而是通过 in-process Publisher 在返回前同步翻转 system/user profile roots 的 `ProfileRegistry`。
- profile assets sync 从逐 profile full manifest 发布改为单次 batch patch release；同步过程只准备 staging entries，不直接修改真实 `.compiled/artifacts/**`，也不发布旧基底 full manifest。
- corrupt content-addressed artifact 的修复下沉到 `ProfileReleaseStore`，在 publish lock 内完成，保持 Publisher 是唯一 release seam。
- `ProfileBuildCoordinator` 在 worker 启动前增加 freshness gate：watcher 看到 user profile 源码变化后，如果当前 manifest 的 source/artifact/type artifact 都 fresh，则清理 queued 状态，不重复编译。

## Contract

- HTTP runtime sync = `in_process`，返回时 system/user profile 磁盘 manifest 与 server 内存 Registry 已一致。
- CLI/preflight sync = `disk_only`，只写磁盘，不依赖 server 进程。
- profile assets sync 在一次同步内最多发布一次 user profile patch；多个 profile entry 在 publish lock 内合并到当前 manifest。
- workspace sync 不得锁外删除或覆盖真实 profile artifact；真实 `.compiled` 目录只由 Store/Publisher 写入。
- watcher 事件不能把已经由 runtime sync 强一致发布且 artifact 完整的 profile 重新打成 compiling。

## Verification

- 新增回归覆盖：runtime sync 多 profile 只触发一次 user Registry publish；Publisher batch patch 不覆盖并发 single-entry 发布；system compile 可用 in-process Publisher 翻 Registry；Publisher 发布时能修复同名 corrupt artifact；watcher 事件遇到 fresh manifest 不启动 worker，artifact 缺失时必须启动 worker；原有 user-assets sync 语义继续覆盖缺失、force、用户手改与 compiled 修复路径。
