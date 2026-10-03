# Round 09 — Worker Fan-out 与契约收尾

## 目标映射

- 补齐 round-08 遗留偏差：全量编译不能继续是单 worker 内部受控 fan-out，必须由 `ProfileCompileWorkerService` 向 worker 池派发单文件 entry，再由主线程 fan-in 一次 manifest 发布。
- 补齐发布前 generation/source 重校验：源码在编译期间再次变化时，旧 build 必须 `stale` 丢弃并重新入队。
- 落实 freshness 降级：runtime catalog / Registry refresh 不再全依赖 rehash；依赖变化由 watcher 触发重编，CLI `profile check` 仍保留完整校验。
- 删除用户 profile 后必须确定性移除 user manifest entry，不能只靠 watcher eventual fallback。

## 关键变更

- `profile-artifact-compiler.ts`
  - 新增 `stageProfileArtifactEntry()`：单文件编译到独立 staging，只返回一条 `ProfileArtifactManifestEntry`，不读取旧 manifest、不发布。
  - 新增 `listProfileArtifactSourceFiles()`，供 full build 主线程列出 fan-out 目标。
  - `validateProfileArtifact()` 增加 `checkDependencies` 选项；默认仍检查依赖，runtime catalog 调用时显式关闭依赖 rehash。
  - 新增 `ProfileArtifactSourceMissingError`，把编译期间源码消失表达为 stale/generation 变化，而不是普通 compile_failed。

- `profile-compile-worker-runtime.ts` / `profile-compile-worker-entry.ts`
  - 新增 worker `entry` 模式：只返回单文件 staging release。
  - `entry` 模式遇到源码已消失时返回 `stale: true`，由上层重排。

- `profile-compile-worker.ts`
  - `compileAll()` 改为主线程 orchestrator：列出 user profile files，向 worker 池并行派发 `entry` 任务，复制各 staging artifact 到 fan-in staging，构造整批 manifest，经 `ProfileReleasePublisher` 一次发布。
  - 发布前对 entry 的 `sourceSha256/sourceBytes` 与当前源码重校验；不一致则返回 `stale: true`，不发布旧 manifest。
  - 单文件 compile 发布前同样做源码重校验，避免 running 旧任务后发布覆盖新源码。

- `profile-build-coordinator.ts`
  - worker 返回 `stale: true` 时丢弃旧结果并重新 enqueue 原 batch。

- `catalog.ts` / `profile-freshness-checker.ts`
  - runtime catalog 构建不做依赖 rehash，只检查源码与 artifact/type artifact；依赖变更依靠 watcher enqueue full build。

- `workbench-service.ts` / `delete.post.ts`
  - 删除用户 profile 后调用 `profiles.enqueueBuild({reason: "profile_source_deleted"})`，触发 full build 生成不含已删文件的新 manifest。

## 实际结果与计划出入

- 已补齐 round-04/IMPLEMENTATION-GOAL 中的 worker 池 fan-out/fan-in 契约。
- full build 仍保持“整批一次 manifest 发布”的产品语义；变化只是编译 fan-out 从单 worker 内部并发迁到 service 级 worker 池。
- freshness 降级后，单纯修改 helper 文件不会被 reader 重新 hash 后立刻判 stale；运行期一致性由 watcher enqueue compile-all 兑现。这与 Decisions 中“依赖变化由 watcher 兑现，不靠 reader 每读 rehash”一致。

## 验证

- `bun run typecheck`
- `bunx vitest run server/agent/profiles/profile-build-coordinator.test.ts server/agent/profiles/workbench-service.test.ts --testTimeout=30000`
- `bunx vitest run server/agent/profiles/catalog.test.ts server/agent/profiles/profile-compile-worker.test.ts --testTimeout=120000`
