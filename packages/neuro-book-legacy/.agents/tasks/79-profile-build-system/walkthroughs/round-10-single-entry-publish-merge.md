# Round 10 — Single Entry Publish Merge 收尾

## Summary

- 修复 round-09 后续审查发现的 single compile 并发发布缺口：worker 池允许不同 profile 并发编译，但不能让 worker 基于旧 manifest 预合并后再发布。
- 最终契约：worker 只产出单条 staging entry；`ProfileReleasePublisher` 在 per-root publish lock 内读取当前 manifest、合并 entry、原子写 manifest，并在 in-process 模式翻转 Registry。
- 外部删除 profile 的 watcher 路径与 Workbench 删除 API 对齐：删除事件触发 full build，确保 user manifest entry 确定性移除。

## Changes

- `ProfileReleasePublisher` 新增 single-entry 发布 seam；full build / assets sync 仍使用 full manifest replacement。
- `runProfileCompile()` 非 dry-run 改为 `stageProfileArtifactEntry()`，不再生成预合并 manifest。
- worker publish/cleanup 失败路径补齐生命周期保护；staging cleanup 失败只记录 warn，不阻断编译结果或队列推进。
- `ProfileBuildCoordinator` 在 stale requeue 时发现源码已删除会升格 full build，避免反复编译不存在的 fileName。

## Contract

- single compile 可以并发，但 manifest 合并只能发生在 Publisher 的 publish lock 内。
- full compile 仍是 worker 池 entry fan-out、主线程 fan-in 一次 manifest 发布。
- `unlink` / `unlinkDir` 的 user profile watcher 事件必须 enqueue full build，不带 `fileName`。
- cleanup 失败是可观测运维问题，不是 compile failure。

## Verification

- 新增回归覆盖：Publisher single-entry 发布不丢已有 entry；真实 worker 并发 single compile 后 manifest 同时保留两个 profile；watcher unlink 触发 full build；stale + source missing 升格 full build。
