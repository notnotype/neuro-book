# Round 11 — Release Atomicity 收尾

## Summary

- 修复 round-10 后续审查发现的 Registry 顺序缺口：single-entry manifest 合并已在磁盘 publish lock 内完成，但 Registry 翻转仍可能被较早 release 晚一步覆盖。
- 最终契约：Profile release 的原子性包含磁盘 manifest 发布和 server 进程内 Registry 翻转；同一 profile root 的发布必须在 `ProfileReleasePublisher` 内串行。

## Changes

- `ProfileReleasePublisher` 增加 per-root in-process publish queue，`publishStaged()` 与 `publishStagedEntry()` 都经过同一队列。
- 队列顺序固定为：持久化 `.compiled` release -> 使用同一份 manifest 翻转 Registry -> 返回调用方。
- `proper-lockfile` 继续只负责跨进程磁盘写入保护；in-process queue 只负责同进程 release 顺序和 Registry 一致性。
- single-entry release 显式传递 `profilesRoot`，避免空 manifest 场景下元数据从稳定 label 漂移为规范化路径。

## Contract

- `ProfileReleaseStore` 只负责持久化，不直接触碰 Registry。
- `ProfileReleasePublisher` 是唯一 release seam；任何需要翻转 Registry 的发布必须经过它的 per-root queue。
- 编译阶段仍可并行；发布阶段按 profile root 串行。

## Verification

- 新增回归覆盖：同 root 两次 in-process single-entry 发布时，第二次发布会等第一次 Registry 翻转完成；真实 worker 并发 single compile 后，内存 Registry snapshot 同时包含两个 profile；cleanup 失败不阻断 compile result 和后续 worker task。
