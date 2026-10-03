# Round 14 - Final Guard And Test Isolation

## 目标

- 修复 full replacement 发布前只校验 source file set、漏校验同名源码内容变化的问题。
- 清理 `workspace-files.test.ts` / `profile-compile-worker.test.ts` / `catalog.test.ts` 并行污染真实 `workspace/.nbook` 的测试隔离债。
- 不改 HTTP DTO、不改 manifest 格式、不引入 release history。

## 实现

- `profile-artifact-compiler` 新增 `assertProfileFullReleaseFresh(profileRoot, filesAtStart, entries)`：
  - 先校验 source file set。
  - 再逐条校验 entry 对应源码当前 `sha256/bytes` 仍等于编译时记录。
  - 任一变化都禁止 full replacement 发布。
- `compileProfileArtifacts()`、`ProfileCompileWorkerService.runCompileAllFanout()`、旧 `runProfileCompileAll()` 统一复用 full release guard。
- 新增 `WorkspaceAssetRootContext`，生产默认仍解析真实 bundled/user roots；测试可显式覆盖 system/user `.nbook` root。
- profile catalog、worker、workbench、source-check、system assets preflight、workspace sync 默认 root 改为运行时解析 context，不再在 import-time 固定真实路径。
- 新增 `workspace-assets-test-helper`：
  - `createIsolatedWorkspaceAssets()` 创建独立 system/user `.nbook`。
  - `useAsCwd` 模式为 workspace-files 测试提供临时 cwd，并用 symlink 暴露项目源码和依赖。
  - `dispose()` 会恢复创建前的 root context，嵌套隔离 fixture 不会把外层 context 清成空值。
  - workspace-files 测试使用 beforeAll base system fixture 编译一次，每个测试复制 base，避免重复 esbuild 编译导致 OOM。
- `workspace-files.test.ts` 不再依赖真实 user-assets 旧模板覆盖；相关断言改为当前 bundled system template 契约。
- `profile-compile-worker.test.ts` 补齐 worker service 与旧 worker runtime 的同名源码内容变化端到端 stale 测试：artifact import 写 marker 后，测试覆盖同名 source，再释放 import，确保发布前 guard 拦下旧 full manifest。

## 验证

- `bun run typecheck`
- `bunx vitest run server/workspace-files/workspace-files.test.ts server/agent/profiles/profile-compile-worker.test.ts server/agent/profiles/catalog.test.ts --testTimeout=120000 --hookTimeout=120000`
  - 3 files / 148 tests passed
- `bunx vitest run server/agent/profiles/profile-build-coordinator.test.ts server/config/config-service.test.ts --testTimeout=120000 --hookTimeout=120000`
  - 2 files / 41 tests passed
- 补洞聚焦验证：
  - `bunx vitest run server/workspace-files/workspace-files.test.ts -t "隔离 Workspace assets context 支持嵌套恢复" --testTimeout=120000 --hookTimeout=120000`
    - 1 file / 1 test passed
  - `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts -t "同名 profile 源码内容变化" --testTimeout=120000 --hookTimeout=120000`
    - 1 file / 3 tests passed

## 结论

- full replacement freshness 现在是底层发布契约：source file set + entry source hash/bytes 都必须未变。
- 并行测试不再写真实 `workspace/.nbook/agent/profiles/.compiled`，不需要 `--no-file-parallelism` 作为长期方案。
- Workspace assets 测试隔离 context 支持嵌套恢复，后续测试 helper 不应通过清空全局 context 破坏外层 fixture。
