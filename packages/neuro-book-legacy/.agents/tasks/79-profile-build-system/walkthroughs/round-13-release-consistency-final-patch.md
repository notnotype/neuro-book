# Round 13 — Release Consistency Final Patch

## Summary

- 本轮按“局部补洞”收口，不引入 release history，也不重做新的发布 Module。
- user-assets sync 增加明确 publish point：发布前错误仍 rollback source；发布成功后 source 不再 rollback，backup cleanup 只 warn。
- `compileAll()` 发布 full replacement 前会重新校验 profile source file set；新增、删除、重命名都会让本轮 full build 标记 stale 并交给 Coordinator 重排。
- staging artifact promotion 改用与 manifest 写入相同的 transient rename retry 策略。

## Contract

- `publishStagedEntries()` 成功后，user profile source 与 manifest/Registry 已组成同一个运行态事实；后续 sync state 写失败不能把 source 回滚成 stale。
- `compileAll()` 的 full replacement 只能基于仍然相同的 source file set 发布；若编译期间 source 集合变化，不能发布旧 full manifest。
- release install、manifest write、staging promotion 对 Windows `EPERM/EBUSY/EACCES` transient rename 使用统一重试。
- 磁盘 release 已提交但 in-process Registry 翻转失败时，Publisher 抛 `ProfileReleaseCommittedButRegistryFailedError`。调用方可以让 HTTP 请求失败，但不得 rollback 已与 manifest 匹配的 source。
- `compileProfileArtifacts()` 这类通用 full replacement 入口也必须执行 source file set gate，不能只在 worker service `compileAll()` 主路径做校验。
- profile artifact staging cleanup 是 best-effort 运维清理；失败只写 warn，不覆盖已发布结果或真实编译错误。

## Verification

- 新增回归覆盖：sync state 写失败后 source 不回滚，manifest entry 仍匹配当前 source；发布前 source 变化会放弃发布并 rollback 本轮替换；full compile 发布前 source file set 变化会被识别。
- 保留 round-12 的 patch release、Registry 翻转、corrupt artifact、watcher freshness 回归。
- 本轮补充回归：Registry 在磁盘发布后失败会抛 committed error 且释放 per-root 队列；single/full/batch 发布路径都覆盖该错误契约；user-assets sync 遇到 committed error 不回滚 source；旧 worker runtime `runProfileCompileAll()` 同样返回 stale。
- 验证结果：`bun run typecheck` 通过；`catalog.test.ts`、`profile-compile-worker.test.ts`、`workspace-files.test.ts`、`profile-build-coordinator.test.ts + config-service.test.ts` 单独/聚焦通过；三文件并行合跑仍受真实 workspace `.compiled` 与 `.publish.lock` 共享状态污染，`--no-file-parallelism` 串行合跑通过。
