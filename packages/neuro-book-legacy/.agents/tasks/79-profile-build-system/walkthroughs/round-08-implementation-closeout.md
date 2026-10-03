# Round 08 — Implementation 收口

> 后续 [round-09](round-09-worker-fanout-and-contract-closeout.md) 已补齐本文记录的全量编译偏差：`compileAll()` 现在是 worker 池单文件 entry fan-out，主线程 fan-in 一次 manifest 发布。

## 目标映射

- 补齐 round-07 后续审查发现的硬缺口：HTTP runtime 不能由 worker 直接发布真实 `.compiled` 后再由 route 补刷 Registry。
- 将 `AgentProfileCatalog` 中已成型的职责拆出独立组件，降低 facade 继续膨胀的风险。
- 给内容寻址 artifact 增加 grace GC，并给全量编译/依赖 hash 并发加文件句柄护栏。

## 关键变更

- `profile-artifact-compiler.ts`
  - 新增 `stageProfileArtifacts()`：只生成 staging artifact + 下一版 manifest，不发布真实 `.compiled`。
  - `compileProfileArtifacts()` 继续作为 CLI/preflight/test 的 disk-only 包装，保持调用面稳定。
  - `ProfileReleasePublisher` 的 in-process sink 现在携带 `profileRoot`，便于 Registry 精确翻转。
  - 内容寻址 artifact GC 会清理 `.compiled/artifacts/` 中超过 grace 且不被 current manifest 引用的 sha 文件；current 引用永不删除。
  - profile 文件编译并发上限和依赖 hash 并发上限收紧，避免 worker 池 + esbuild dependency fan-out 在 Windows 上触发 `EMFILE`。

- `profile-compile-worker-runtime.ts` / `profile-compile-worker.ts`
  - worker runtime 真实用户编译只返回 `stagedRelease`，不写真实 manifest。
  - worker service 在主线程接收 staging release 后通过 `ProfileReleasePublisher` 发布；HTTP runtime 传 `mode: "in_process"` + `AgentProfileCatalog` registry sink。
  - worker service 从单 worker 改成 worker 池；同一 profile 互斥，全量编译独占，避免旧任务后发布覆盖新任务。

- `catalog.ts`
  - 实现 `publishProfileRelease(profileRoot, manifest)`，in-process 发布后用同一份 manifest 构建并翻转 server 内存 Registry。
  - 拆出 `ProfileArtifactStore`、`ProfileFreshnessChecker`、`ProfileRegistry`、`ProfileSourceWatcher`，Catalog 保持 facade/归并职责。

- `compile.post.ts` / `compile-all.post.ts`
  - route 不再手动 `refreshRuntimeRegistry()` 补刷。
  - 手动单 profile 编译在主线程发布后再读取 detail/preview，前端仍拿到原有交互所需结果。

## 实际结果与计划出入

- 已消除“worker 写盘 + route 补刷”的运行态发布窗口；运行态发布现在收敛到主线程 Publisher seam。
- round-08 当时 worker 池已落地在 service 层，用于并行处理互不冲突的单 profile 任务；全量编译仍作为一个原子 build job 在单 worker 内做受控 fan-out。该偏差已在 round-09 改为 worker 池 entry fan-out + 主线程 fan-in 一次发布。
- `ProfileReleaseStore` / `ProfileReleasePublisher` 仍位于 `profile-artifact-compiler.ts`，其它四个组件已拆出独立文件；后续如文件继续膨胀，可再把 ReleaseStore/Publisher 平移出文件，不影响当前 seam。

## 验证

- `bun run typecheck`
- `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts server/agent/profiles/catalog.test.ts --testTimeout=120000`
- `bunx vitest run server/agent/profiles/profile-build-coordinator.test.ts server/agent/profiles/profile-compile-worker.test.ts server/agent/profiles/catalog.test.ts --testTimeout=120000`
- `bunx vitest run server/config/config-service.test.ts server/agent/profiles/workbench-service.test.ts server/agent/profiles/profile-build-coordinator.test.ts server/agent/profiles/catalog.test.ts --testTimeout=30000`
- `bunx vitest run server/workspace-files/workspace-files.test.ts --hookTimeout=60000 --testTimeout=120000`
- `bunx vitest run server/agent/profiles/profile-build-coordinator.test.ts --testTimeout=30000`
- `bunx vitest run server/agent/profiles/catalog.test.ts --testTimeout=120000`
