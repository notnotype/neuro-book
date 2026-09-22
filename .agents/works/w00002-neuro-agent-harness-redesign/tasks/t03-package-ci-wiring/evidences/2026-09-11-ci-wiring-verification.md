# CI 接线证据（2026-09-11）

> Task：`t03-package-ci-wiring`；执行者：Leader；授权：开发者 2026-09-11。

## RED（接线前，实测）

`bun x vitest run --config scripts/vitest.config.ts scripts/ci/workspace-workflows.test.ts`

- 结果：**12 passed / 1 failed**
- 失败：`code-baseline 与 product-platforms 的 PR paths 覆盖全部 packages 目录` → `code-baseline.yml: packages/agent-file-tools: expected [...] to include 'packages/agent-file-tools/**'`

## 变更

| 文件 | 变更 |
| --- | --- |
| `scripts/ci/workspace-package-matrix.ts` | 追加两条 `WORKSPACE_PACKAGE_CHECKS`：`agent-file-tools`、`agent-sse`（命令 `bun run typecheck` + `bun run test`） |
| `.github/workflows/workspace-packages.yml` | 触发路径 +`packages/agent-file-tools/**`、`packages/agent-sse/**` |
| `.github/workflows/code-baseline.yml` | PR 路径 +同上两条 |
| `.github/workflows/product-platforms.yml` | push 与 pull_request 两份路径各 +同上两条 |

## GREEN（接线后，实测）

| 检查 | 结果 |
| --- | --- |
| `scripts/ci/workspace-workflows.test.ts` | **13 passed / 0 failed** |
| `bun x tsc --noEmit -p scripts/tsconfig.json` | 通过 |
| 矩阵选择：`packages/agent-sse/src/sse-writer.ts` | `include=[agent-sse]`，`run_web_island=false` |
| 矩阵选择：`packages/agent-file-tools/src/truncate.ts` | `include=[agent-file-tools]` |
| 矩阵选择：`package.json` | 全量选择（14 条） |

## 未运行与边界

- 未实际触发 GitHub Actions（本机无法运行 CI）；接线正确性由工作流合同测试 + 本地矩阵选择证明。
- CI 上 `bun install --frozen-lockfile --linker hoisted` 依赖 lock 与 `package.json` 同步——本 Work 已同步 `bun.lock`（见 `t02` 证据）。
- 未改包内实现、未改其它工作流语义。
