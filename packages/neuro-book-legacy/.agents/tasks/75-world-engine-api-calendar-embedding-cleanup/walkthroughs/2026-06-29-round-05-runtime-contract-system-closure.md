# Round 05：runtime 契约系统收口

## 背景

广审查发现 Round 04 后仍有三类契约漂移：

- system profile `.compiled` artifact 仍因共享 `world-engine-tool-description.ts` 依赖变化而 stale，部分 compiled profile 内嵌的 `execute_world` description 也缺少 `subjectIds` / `subjectMode`。
- `server/world-engine` 测试使用 `bun:test`，但仓库默认 `bun run test` 是 Vitest，导致任务验收命令不可直接执行。
- calendar/schema 热加载已修复为临时副本 import，但使用随机文件名会在长跑进程里为同一内容不断制造新的 module cache entry。后续 Round 07 按用户决策进一步收紧为单文件配置入口。

## 修复内容

1. Runtime profile artifact：
   - 全量重新编译 system profiles。
   - compiled artifact 同步当前 `execute_world` description：`world.slice.list` 暴露 `subjectIds` / `subjectMode`，并保留 `title/message/explanation` issue 解释口径。

2. World Engine 测试入口：
   - 将 `server/world-engine/**/*.test.ts` 从 `bun:test` import 迁移到 `vitest`。
   - `server/agent/tools/world-engine-tools.test.ts` 增加 description 契约断言，钉住 `specified Project Workspace`、`subjectIds`、`subjectMode` 与 `title/message/explanation`。

3. calendar/schema 热加载：
   - 新增内容 hash 临时模块 helper。
   - 用同目录内容 hash 临时文件导入 TypeScript 配置，确保入口文件内容变化后模块路径变化。
   - 进程内按 hash 复用 import promise，避免同一内容重复写随机文件和重复进入 Bun module cache。
   - 导入完成后删除临时文件，并清理异常中断留下的旧临时文件。
   - 当轮边界：缓存键只覆盖入口文件内容；入口文件相对 import 的依赖变化不保证同进程自动失效。后续 Round 07 已按用户决策改为单文件配置契约，本地文件、绝对路径和 URL/protocol import/export 直接拒绝，不再留下“依赖图级热加载”技术债。

4. 文档契约：
   - `docs/tasks/56-world-engine/agent-tools.md` 同步 `subjectIds` / `subjectMode` 和 severity 文案。
   - task 75 README 修正热加载边界和 Vitest 验收命令。

## 验证

- `bun scripts/build/profile.ts compile --all --system`：通过，写入 14 个 system profile artifact。
- `bun scripts/build/profile.ts status --all --system`：14 个 system profiles 全部 `loaded`。
- `rg -n 'subjectIds\?: string\[\]|subjectMode\?: "any" \| "all"' assets/workspace/.nbook/agent/profiles/.compiled`：14 个 compiled profile 均命中新签名。
- `rg -n 'world\.slice\.list\(options\?: \{from\?: bigint, to\?: bigint, limit\?: number, withPatches\?: boolean\}\)' docs/tasks/56-world-engine assets/workspace/.nbook/agent/profiles/.compiled`：无命中。
- `rg -n 'E/A 判断|broken-relative / dangling-ref|current Project Workspace World Engine' server/agent assets/workspace/.nbook/agent/profiles/.compiled docs/tasks/56-world-engine -g '!*.test.ts'`：无命中。
- `rg -n 'bun:test' server/world-engine`：无命中。
- `Get-ChildItem -Path workspace -Recurse -Force -Filter '.world-engine-*.ts'`：无残留。
- `bun run test server/world-engine server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts server/agent/profiles/leader-assets-profile.test.ts`：通过，15 files / 161 tests。
- `bun run typecheck`：失败，但不再包含 World Engine 相关错误；剩余错误来自既有 `assets/workspace/.nbook/agent/skills/llmlint/src/**` 的 `.ts` extension import 与 undefined 检查问题。

## 与计划出入

本轮不改变 World API 行为、不迁移 `workspace/ming-ding-zhi-shi-2` 既有 string events / SQLite 数据；只收口 runtime artifact、测试入口、热加载实现质量和当前契约文档。

迁移到 Vitest 后，`world-engine.facade.test.ts` 的临时 Project Root 清理在 Windows 上暴露 SQLite 句柄释放问题。最初复用生产 `deleteProjectWorkspace` 会把锁失败转成标记删除和后台清理，虽然 suite 通过，但这掩盖了资源释放缺陷并在真实 `workspace/` 留下 `world-engine-test-*` 残留。

后续 Round 06 已修正该偏差：`WorldEngineFacade.runInTransaction` 不再使用 `@libsql/client.transaction()`，改为普通 client 显式事务；Node/Vitest 下的 SQLite 句柄释放也通过 `collectReleasedSqliteHandles` 触发 GC。`world-engine.facade.test.ts` 已恢复严格 `fs.rm` 清理，cleanup 再遇到 EBUSY 应直接失败，不再接受生产删除 fallback warning。
