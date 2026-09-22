---
schema: nbook.task/v2
taskId: t03-package-ci-wiring
role: tasker
---

# 新包 CI 接线：agent-file-tools 与 agent-sse

## 目标

把 `t02` 新建的两个通用包接入仓库 CI 契约，使它们的测试真的会跑、工作流合同测试恢复绿色：

1. `scripts/ci/workspace-package-matrix.ts`：新增两个包的 `WORKSPACE_PACKAGE_CHECKS` 条目（`bun run typecheck` + `bun run test`）。
2. `.github/workflows/workspace-packages.yml`：把 `packages/agent-file-tools/**`、`packages/agent-sse/**` 加入触发路径。
3. `.github/workflows/code-baseline.yml` 与 `.github/workflows/product-platforms.yml`：按既有合同（`workspace-workflows.test.ts` 要求每个 `packages/` 目录都出现在这两个工作流的 PR paths 中）补齐两条路径。
4. 复跑 `scripts/ci/workspace-workflows.test.ts` 至全绿，并用本地矩阵选择验证新包会被选中。

## 背景与证据

- 建包前该合同测试为绿；新建包后 RED：`code-baseline.yml: packages/agent-file-tools: expected [...] to include 'packages/agent-file-tools/**'`（2026-09-11 实测）。
- 现有 12 个包的 path、矩阵条目与命令格式见 `scripts/ci/workspace-package-matrix.ts:11-42` 与两个工作流的 `on.pull_request.paths`。

## 允许文件

- `scripts/ci/workspace-package-matrix.ts`
- `.github/workflows/workspace-packages.yml`、`.github/workflows/code-baseline.yml`、`.github/workflows/product-platforms.yml`
- 本 Task `evidences/**`、`walkthroughs/**`

## 完成门禁

- `bun x vitest run --config scripts/vitest.config.ts scripts/ci/workspace-workflows.test.ts` 全绿。
- 本地矩阵选择：仅改 `packages/agent-sse/**` 时该包被选中；`package.json`/`bun.lock` 变更时全量选择。
- `docs:check`、`governance:check`、`diff-check` 有真实结果；未运行项写明原因。

## 决策与权限边界

开发者授权（2026-09-11「都授权」「继续」）。只做接线，不改包内实现、不改 CI 语义（除新增路径与条目）、不动其它包与工作流。
