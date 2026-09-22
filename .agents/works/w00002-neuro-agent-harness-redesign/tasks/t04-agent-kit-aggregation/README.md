---
schema: nbook.task/v2
taskId: t04-agent-kit-aggregation
---

# 聚合为 `@notnotype/agent-kit`

## 当前状态

- 2026-09-11 **已完成**：`packages/agent-kit`（命名空间 `./sse`、`./file-tools`，另有汇总入口）建成；成员与测试自 `agent-sse`/`agent-file-tools` 迁入（公共符号名不变），旧包已删除；`workspaces`/`bun.lock`/CI 矩阵与路径已同步。证据：`evidences/2026-09-11-agent-kit-aggregation-verification.md`（测试 10/10、契约 13/13、矩阵选择通过）。
- 后续：下一批成员以命名空间加入本包；`agent-shell` 的归属（本包命名空间或独立包）与领域 harness 名称待定。

## 目标

按开发者 2026-09-11 决定，把已建的两个通用包合并为单一聚合包 **`@notnotype/agent-kit`**（命名空间 subpath：`./sse`、`./file-tools`），并同步 `workspaces`、`bun.lock` 与 CI 接线。领域 harness 的目标名 `@notnotype/neuro-agent-harness` 待旧包退役后复用，本 Task 不建领域 harness 包。

## Agent 工作

1. 新建 `packages/agent-kit`：`package.json`（name/private/exports/scripts/devDeps）、`tsconfig.json`、`vitest.config.ts`、`src/index.ts`、`src/sse/{index,writer}.ts`、`src/file-tools/{index,truncate}.ts`、`src/smoke.test.ts`（覆盖两个命名空间的最小真实路径）。
2. 迁移既有实现与测试（公共符号名不变）：`agent-sse/src/sse-writer.ts(.test.ts)` → `src/sse/writer.ts(.test.ts)`；`agent-file-tools/src/truncate.ts(.test.ts)` → `src/file-tools/truncate.ts(.test.ts)`；删除旧包目录 `packages/agent-sse`、`packages/agent-file-tools`。
3. root `workspaces` 两条换一条；`bun install` 同步 `bun.lock` 并核实差异。
4. CI：`scripts/ci/workspace-package-matrix.ts` 两条条目换一条（`agent-kit`）；三个工作流路径改为 `packages/agent-kit/**`（`workspace-packages.yml`、`code-baseline.yml`、`product-platforms.yml` 的 push+PR）。
5. 验证：包级 `test`/`typecheck`；`scripts/ci/workspace-workflows.test.ts` 全绿；本地矩阵选择（仅改 `packages/agent-kit/**` → 选中该包）；`docs:check`、`governance:check`、`diff-check`。

## 允许文件

- `packages/agent-kit/**`（新建）；删除 `packages/agent-sse/**`、`packages/agent-file-tools/**`
- root `package.json`（仅 `workspaces`）、`bun.lock`
- `scripts/ci/workspace-package-matrix.ts`、`.github/workflows/{workspace-packages,code-baseline,product-platforms}.yml`
- 本 Task `evidences/**`

## 完成门禁

- `bun run --cwd packages/agent-kit test` 与 `typecheck` 通过；成员测试数不减少（原 7+4，合并后 smoke 合并为 1 条）；smoke 存在且通过。
- `workspace-workflows.test.ts` 全绿；矩阵选择与工作流路径一致；`bun.lock` 差异已核实并说明。
- `docs:check`、`governance:check`、`diff-check` 有真实结果；未运行项写明原因。

## 决策与权限边界

开发者决定（2026-09-11）：通用聚合包命名 `@notnotype/agent-kit`（"不是 harness，但可以组成 harness；领域无关，通常是算法库或工具库"）；领域 harness 复用名 `@notnotype/neuro-agent-harness` 需等旧包退役。本 Task 不改产品源码、不改包内既有行为、不发布 npm。
