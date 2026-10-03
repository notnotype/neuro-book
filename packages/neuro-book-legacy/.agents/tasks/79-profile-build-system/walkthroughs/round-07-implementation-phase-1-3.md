# Round 07 — Implementation Phase 1–3

> 当前实现已被 [round-08 收口](round-08-implementation-closeout.md) 与 [round-09 收尾](round-09-worker-fanout-and-contract-closeout.md) 更新：HTTP runtime 发布 seam 已改为 worker staging → server 主线程 in-process Publisher；`ProfileArtifactStore` / `ProfileFreshnessChecker` / `ProfileRegistry` 已拆出；worker service 已扩为受互斥约束的 worker 池，且全量编译已改为 worker 池 entry fan-out + 主线程 fan-in；artifact GC 已补齐。

## 目标映射

- Phase 1：`.compiled` 切到内容寻址 artifact、profileKey 映射 manifest、`compile_failed` entry、原子发布锁和 Publisher seam。
- Phase 2：保存/外部编辑后自动后台编译，500ms 单窗口去抖，build-status 显示 queued/running，启动后 boot sweep 自愈 user profile。
- Phase 3：profile assets sync 改为 staging → Publisher 发布，copy-if-absent 安装内容寻址 artifact，并修复同 sha 路径已损坏的 user artifact。

## 关键变更

- `profile-artifact-compiler.ts`
  - `PROFILE_ARTIFACT_COMPILER_VERSION = 6`。
  - artifact 落在 `.compiled/artifacts/<sha>.mjs`，`sha` 为编译输出字节 sha256。
  - esbuild banner 写入 `nbook-profile-artifact-compiler-version:<version>`，保证 compilerVersion bump 会改变输出字节和 sha。
  - 磁盘 `manifest.json` 改为 `profiles: { [profileKey]: entry }` 映射；reader 返回规范化 `entries` + loaded-only `profiles` 视图。
  - 单 profile 编译失败不再整批抛错，而是发布 `status: "compile_failed"` entry。
  - 新增 `ProfileReleaseStore` / `ProfileReleasePublisher`，所有编译发布先经过 per-root `proper-lockfile` advisory lock。
  - 全量编译改为受控并发 fan-out，并用 per-artifact promotion lock 保护同 sha 写入，避免内容寻址目标覆盖竞态。

- `catalog.ts`
  - catalog 读取完整 `entries`，`compile_failed` 直接进入不可运行状态。
  - user `source_changed/dependency_changed` 不再容忍旧 artifact 继续 loaded，统一变成 `compile_stale` 且 `get()` 抛错。
  - 暴露 build coordinator port：settings/build-status 可读取 queued/running 状态。
  - HTTP runtime 启用 server 进程内 runtime registry；warm 后 `get/resolveMany/snapshot` 只读内存视图，显式 `refreshRuntimeRegistry()` 才重新扫描/import。
  - queued/running profile 在 `get()` 中直接拒绝运行，snapshot loadStatus 覆盖为 `compiling`。
  - watcher 对 user profile source/helper 事件触发后台 enqueue；`artifacts/**`/tmp/types 仍忽略。

- `profile-build-coordinator.ts`
  - 新增 500ms debounce coordinator，支持单文件 compile 与多文件/依赖事件 compile-all 合并。
  - HTTP Harness 在 `watchProfiles: true` 时挂载 coordinator、启用 runtime registry，并非阻塞启动 `bootSweep()`。
  - `bootSweep()` 改为源码集合 vs manifest entry 的源码 sha/bytes 对账，不走 catalog snapshot，也不做依赖全量 rehash。
  - worker 完成后主线程 `refreshRuntimeRegistry()`，确保 HTTP runtime 内存视图随构建结果翻转。
  - Workbench 保存/创建和 API draft 保存/创建都会入队后台编译。

- `novel-workspace.ts`
  - profile compiled artifact sync 不再手写 manifest 或使用覆盖式 rollback。
  - 系统 artifact 复制到 staging，由 Publisher copy-if-absent + manifest 原子发布。
  - 若 user artifact store 中同 sha 文件内容损坏，sync 会先删除损坏文件再安装系统 artifact；非 force 的用户手改源码不会进入 compiled sync，因此不会覆盖用户自编结果。

## 实际结果与计划出入

- 已实现内容寻址 artifact、profileKey 映射 manifest、Publisher 发布锁、compile_failed 记账、严格无 stale、自动编译、build-status 状态、runtime registry、boot sweep 源码对账和 profile assets sync Publisher 化。
- Round 07 当时 `AgentProfileCatalog` 仍作为 facade 承载规范化内存视图；Round 08 已拆出 `ProfileArtifactStore/ProfileFreshnessChecker/ProfileRegistry` 文件组件。
- Round 07 当时 worker service 还是单 worker_thread；Round 08 扩为受互斥约束的 worker 池；Round 09 已把全量 profile 编译从单个原子 build job 改为 service 级 worker 池 entry fan-out + 主线程 fan-in 一次发布。
- variable definition compiled sync 暂未并入 Profile Publisher；它使用独立 `server/agent/variables/definition-artifact.ts` 格式，本轮只退役 profile artifact 的覆盖式发布路径。

## 验证

- `bunx vitest run server/agent/profiles/catalog.test.ts`
- `bunx vitest run server/agent/profiles/workbench-service.test.ts`
- `bunx vitest run server/agent/profiles/profile-build-coordinator.test.ts`
- `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts -t "director artifact"`
- `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts`
- `bunx vitest run server/config/config-service.test.ts server/agent/profiles/workbench-service.test.ts server/agent/profiles/profile-build-coordinator.test.ts server/agent/profiles/catalog.test.ts --testTimeout=30000`
- `bunx vitest run server/workspace-files/workspace-files.test.ts --hookTimeout=60000`
- `bun run typecheck`

## 备注

- `bun add proper-lockfile@latest` 在线解析曾卡住；先用 `bun pm view proper-lockfile version` 确认 latest 为 `4.1.2`，随后 `bun add proper-lockfile@4.1.2 --offline` 成功落为直接依赖。
- `server/workspace-files/workspace-files.test.ts` 默认 10s hook timeout 会在变量定义编译 beforeAll 超时；验证时需要显式 `--hookTimeout=60000`。
