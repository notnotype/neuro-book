# agent-kit 聚合迁移证据（2026-09-11）

> Task：`t04-agent-kit-aggregation`；执行者：Leader；授权：开发者 2026-09-11 命名与聚合决定。

## 变更

- 新建 `packages/agent-kit`（`@notnotype/agent-kit`，private，`type: module`），命名空间导出 `./sse`、`./file-tools`，另有汇总入口 `.`。
- 成员实现与测试迁入（公共符号名不变）：
  - `agent-sse/src/sse-writer.ts(.test.ts)` → `src/sse/writer.ts(.test.ts)`（导入路径同步改为 `./writer.js`）
  - `agent-file-tools/src/truncate.ts(.test.ts)` → `src/file-tools/truncate.ts(.test.ts)`
  - 新增包级 smoke `src/smoke.test.ts`（覆盖两个命名空间的最小真实路径）；原两包 smoke 合并为这一条。
- 删除旧包目录 `packages/agent-sse`、`packages/agent-file-tools`。
- 登记与 CI：root `workspaces` 两条换一条（`packages/agent-kit`）；`scripts/ci/workspace-package-matrix.ts` 两条条目换一条；`workspace-packages.yml`/`code-baseline.yml`/`product-platforms.yml`（push+PR）路径改为 `packages/agent-kit/**`。

## 验证（实测）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 包测试 | `bun run --cwd packages/agent-kit test` | **3 files / 10 tests passed**（truncate 6 + writer 3 + smoke 1） |
| 包类型检查 | `bun run --cwd packages/agent-kit typecheck` | 通过 |
| 工作流契约 | `bun x vitest run --config scripts/vitest.config.ts scripts/ci/workspace-workflows.test.ts` | **13 passed** |
| 矩阵选择 | `printf 'packages/agent-kit/src/sse/writer.ts\n' \| EVENT_NAME=pull_request bun scripts/ci/workspace-package-matrix.ts` | `include=[agent-kit]` |
| lock 同步 | `bun install` | `Removed: 2`；`bun.lock` +`packages/agent-kit` 条目与链接 |

测试数说明：合并前两包合计 11 条（含 2 条 smoke）；合并后 smoke 归 1 条，其余成员测试 9 条不变，合计 10 条。

## 未运行与边界

- 未触发真实 CI（本机无法运行 GitHub Actions）；正确性由工作流契约测试 + 本地矩阵选择证明。
- `bun.lock` 中两处既有版本号刷新（`neuro-book` canary 版本、`manager` canary.58→.60）与 `t02` 相同，属 lock 既有滞后被同步，未回滚。
- 未改任何成员行为；未建领域 harness 包（名称待旧包退役后复用）。
