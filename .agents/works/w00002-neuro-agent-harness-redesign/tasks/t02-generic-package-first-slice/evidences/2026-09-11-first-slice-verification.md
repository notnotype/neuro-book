# 首个切片验证证据（2026-09-11）

> Task：`t02-generic-package-first-slice`；执行者：Leader；授权：开发者 2026-09-11「可以，都授权」。

## 命令与结果

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| RED（先写测试） | `bun x vitest run --config packages/agent-file-tools/vitest.config.ts`；同 sse | 两包各 2 个测试文件失败（`Cannot find module`，实现不存在） |
| GREEN | `bun run --cwd packages/agent-file-tools test` | **2 files / 7 tests passed**（298ms） |
| GREEN | `bun run --cwd packages/agent-sse test` | **2 files / 4 tests passed**（296ms） |
| 类型检查 | `bun run --cwd packages/agent-file-tools typecheck`；同 sse（`tsc --noEmit`） | 两包均通过 |
| 工作区登记 | 编辑 root `package.json` `workspaces` 后 `bun install` | `13 packages installed`，`bun.lock` 已同步 |
| 包名导入 | `bun -e 'await import("@notnotype/agent-sse")'` 等 | sse → `writeAgentEventStream`；file-tools → `DEFAULT_MAX_BYTES/…/truncateHead/truncateTail` |

## `bun.lock` 差异说明（26 insertions / 2 deletions）

- 必要变更：`packages/agent-file-tools`、`packages/agent-sse` 两个 workspace 条目 + 两行 workspace 链接。
- 附带变更：`@notnotype/neuro-book` 版本号（`0.10.0-canary.20260907…` → `0.10.2-canary.20260908…`）与 `neuro-book-manager`（`0.1.0-canary.58` → `0.1.0-canary.60`）——属 lockfile 既有滞后被 `bun install` 同步为 package.json 现值，非本次引入的功能性变更；未回滚（手工改 lock 风险更高）。

## 包结构（约定遵循）

- 两个包均不建 `docs/`、`PROJECT-STATUS.md`、`.agents/`，因此不触发治理的"自治 workspace 包"资产要求；无运行时依赖，devDependencies 仅 `@notnotype/neuro-book-test-support`（workspace）+ `@types/node` + `typescript` + `vitest`。
- 导出：`@notnotype/agent-file-tools` → `.`、`./truncate`；`@notnotype/agent-sse` → `.`、`./sse-writer`。
- 测试：`src/truncate.test.ts`（6）+ `src/smoke.test.ts`（1）；`src/sse-writer.test.ts`（3）+ `src/smoke.test.ts`（1）。

## 已完成的清理与未覆盖项

- spike 目录 `.local/spike-extract-20260911/` 已删除（脚手架内容已落进两个真包）。
- 未接线：新包尚未纳入根级聚合测试入口或 CI 清单（仓库没有面向新包的根 `test` 脚本；接线方式待确认后单独处理）。
- 未做（不属本轮）：产品 `server/agent` 改为消费新包；`patch`/`tools` 等后续成员；bash 归属决定。
