# Round 06：SQLite 句柄与测试清理收口

## 背景

Round 05 把 `server/world-engine` 测试迁到 Vitest 后，Windows 下 `world-engine.facade.test.ts` 的 Project Root 清理暴露 `EBUSY`。最初用生产 `deleteProjectWorkspace()` 兜底会把失败转成标记删除和后台清理，但这会污染真实 `workspace/`，也掩盖了 World Engine 资源释放问题。

进一步复查确认根因有两层：

- `WorldEngineFacade.runInTransaction()` 使用 `@libsql/client.transaction()`；该 API 会把 native Database 句柄交给 transaction 对象，commit 后原 client 无法再关闭该句柄，只能等 GC。
- `bun run test` 实际运行 Vitest 的 Node 进程；原 `collectReleasedSqliteHandles()` 只调用 `Bun.gc`，在 Node/Vitest 下不会触发 libsql native Database 回收。

## 修复内容

1. World Engine facade 事务：
   - 不再使用 `entry.client.transaction(mode)`。
   - 改为普通 client 显式执行 `BEGIN IMMEDIATE` / `BEGIN TRANSACTION READONLY` / `BEGIN DEFERRED`。
   - callback 继续复用同一个 client 创建 repository/service。
   - 成功执行 `COMMIT`，失败执行 `ROLLBACK`，finally 关闭 client 并释放 SQLite 句柄。

2. SQLite 句柄释放 helper：
   - `collectReleasedSqliteHandles()` 保留 Bun 下 `Bun.gc(force)`。
   - Node 下若没有 `global.gc`，通过 `node:v8` 暴露并缓存 GC 函数，再触发一次回收。
   - 普通 close 路径对 Node GC 做短间隔节流；测试删除前使用强制 GC，避免并行 profile 测试被频繁全量 GC 拖慢。
   - 该逻辑集中在 SQLite 句柄释放 helper 中，不要求调用方知道当前运行时是 Bun 还是 Node/Vitest。

3. 测试清理：
   - `world-engine.facade.test.ts` 移除生产 `deleteProjectWorkspace()` fallback。
   - 恢复测试专用严格 `fs.rm` helper；若重试后仍 `EBUSY`，suite 必须失败。
   - 跑通后清理本轮遗留的 `world-engine-test-*` Project Root 和 `workspace/.nbook/deleted-projects/world-engine-test-*` 墓碑。

4. 热加载边界：
   - 当轮只补充说明：当前缓存键只覆盖入口文件内容。
   - 后续 Round 07 已按用户决策把 loader 收紧为单文件配置契约：`schema/index.ts` 或 `calendar.ts` 不支持本地文件、绝对路径和 URL/protocol 依赖，入口内容变化可热加载，依赖图级热加载不再作为待补能力。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts -t "首写自动创建"`：通过，单个 Project 能在 Vitest 进程内严格删除。
- `bun run test server/world-engine/world-engine.facade.test.ts`：通过，14 tests。
- `bun scripts/build/profile.ts compile --all --system`：通过，重新写入 14 个 system profile artifact。
- `bun scripts/build/profile.ts status --all --system`：14 个 system profiles 全部 `loaded`。
- `bun run test server/world-engine server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts server/agent/profiles/leader-assets-profile.test.ts`：通过，15 files / 165 tests。
- 旧 runtime 文案静态扫描：`world.slice.list` 旧签名、`E/A 判断`、`broken-relative / dangling-ref`、`current Project Workspace World Engine` 均无当前契约命中。
- compiled artifact 正向扫描：14 个 system profiles 均包含 `subjectIds?: string[]` 与 `subjectMode?: "any" | "all"`。
- 清理后复查 `workspace/world-engine-test-*`：无残留。
- 清理后复查 `workspace/.nbook/deleted-projects/world-engine-test-*`：无残留。
- `Get-ChildItem -LiteralPath workspace -Recurse -Force -Filter '.world-engine-*.ts'`：无热加载临时文件残留。
- `bun run typecheck`：失败，但只剩既有 `assets/workspace/.nbook/agent/skills/llmlint/src/**` 的 `.ts` extension import 和 undefined 检查错误；本轮 World Engine / SQLite helper 无新增 typecheck 错误。

## 与计划出入

本轮没有改变 World API、issue 语义或 compiled profile 契约。实现中额外修正了 `collectReleasedSqliteHandles()` 的 Node/Vitest 路径，因为只修 transaction 后，Vitest 进程仍无法触发 libsql native Database GC；这是让严格测试清理成立的必要条件，不是删除重试或生产 fallback。
