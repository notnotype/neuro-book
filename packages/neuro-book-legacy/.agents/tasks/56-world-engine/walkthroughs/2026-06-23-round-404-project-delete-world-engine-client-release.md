# Round 404 - Project Delete World Engine Client Release

## Goal

修复 Round 403 暴露的临时 Project 清理问题：打开过真实 World Engine Workbench、写过 World Engine SQLite 的 Project，在删除时不应因为当前进程仍占用 `.nbook/project.sqlite` 而超时或留下 `.nbook` 残留。

## Context

Round 403 用临时 Project 跑通 `events.jsonl` commit 的真实浏览器验收后，调用正式删除入口：

```text
DELETE /api/projects/item?projectPath=workspace%2Fworld-engine-round-403-acceptance
```

实际观察到：

- 请求 30 秒超时。
- Project 已从列表消失。
- 目录仍残留 `workspace/world-engine-round-403-acceptance/.nbook`。

该问题不影响 Round 403 的 commit 验收结论，但会影响后续把“临时 Project 浏览器验收”常规化。

## Root Cause

`deleteProjectWorkspace()` 删除 Project Workspace 前已释放：

- `plotFacade.closeProject(projectPath)`
- `closeAgentSqliteClient(projectPath)`
- `closeWorkspaceTreeIndex(projectRoot)`

但没有释放 World Engine facade 持有的 Project PrismaClient。只要本进程打开过 World Engine SQLite，Windows 下删除目录时就可能因为 `.nbook/project.sqlite` 仍被占用而出现 `EBUSY`、API 超时或 `.nbook` 残留。

最小复现脚本确认：

- 创建临时 Project。
- 初始化 Project SQLite。
- 写入 `world-engine/schema.yaml`。
- 调用 `worldEngineFacade.createSubject()`。
- 调用 `worldEngineFacade.writeSlice()`。
- 直接 `deleteProjectWorkspace()`。
- 删除失败，报 `EBUSY: resource busy or locked, rm ...`。

对照脚本在删除前显式调用 `worldEngineFacade.closeProject(projectPath)` 后可以成功删除。

## Change

`server/workspace-files/project-workspace-delete.ts` 在 `fs.rm(projectRoot)` 前增加：

```ts
await worldEngineFacade.closeProject(normalizedProjectPath);
```

删除 Project Workspace 前现在会统一释放：

- Plot Prisma client
- World Engine Prisma client
- Agent `execute_sql` SQLite client
- workspace tree watcher / index

`server/workspace-files/project-workspace-delete.test.ts` 的删除资源释放测试扩展到真实打开 World Engine client：写入 schema、创建 subject、写入 slice，再执行删除，确保打开过 World Engine SQLite 的 Project 也能被完整删除。

## Verification

目标测试通过：

```bash
bunx vitest run server/workspace-files/project-workspace-delete.test.ts
```

结果：

```text
1 file / 3 tests passed
```

原始最小复现脚本在修复后重跑，输出：

```json
{"ok":true,"elapsedMs":12,"exists":false}
```

说明打开过 World Engine client 后，`deleteProjectWorkspace()` 已能释放句柄并删除目录。

## Actual Result Vs Plan

- 本轮没有重新执行浏览器验收；这是后端资源释放问题，目标测试加最小复现脚本已经覆盖 Round 403 的失败条件。
- 本轮没有触碰真实 `ming-ding-zhi-shi-2` 六文件。
- Round 403 的临时 Project 目录已在上一轮安全清理；本轮修的是后续正式删除入口的同类问题。

## Follow-ups

- 临时 Project 浏览器验收链路现在可以继续使用正式删除入口清理；若后续仍发现残留，应优先检查是否还有新的 Project 级资源句柄没有接入 `deleteProjectWorkspace()` 的释放序列。
- 继续推进 World Engine 作者流时，下一步更值得讨论的是 `memory.jsonl` / `state.md` 是否需要显式 commit，而不是继续扩大 `events.jsonl` 自动写入范围。
