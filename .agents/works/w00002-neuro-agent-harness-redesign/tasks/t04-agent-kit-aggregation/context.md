# agent-kit 聚合迁移恢复卡

## 当前状态

- Current Task：`t04-agent-kit-aggregation`（canonical role: tasker）；Work `w00002-neuro-agent-harness-redesign`；Issue #193。
- 授权：开发者 2026-09-11 命名与聚合决定（`@notnotype/agent-kit`；领域 harness 名待旧包退役复用）。
- 起点：`packages/agent-sse`（`sse-writer` + 测试 4 条）、`packages/agent-file-tools`（`truncate` + 测试 7 条）已建且 CI 已接线；本 Task 把它们合并为单包 `packages/agent-kit`。
- 依据：`../t01-product-host-success-research/walkthroughs/006-decision-record.md`（补充决定）、`../../research/2026-09-11-package-map.md` §2.5。

## 恢复顺序

1. [Issue #193](https://github.com/notnotype/neuro-book/issues/193)；2. `../../research/2026-09-11-package-map.md`；3. 本 Task `README.md`；4. `packages/agent-kit`、`scripts/ci/workspace-package-matrix.ts`、三个工作流；5. 存在时读 `evidences/`。

## 下一合法动作

本 Task 已完成（2026-09-11）：`packages/agent-kit` 建成，两个成员（`sse/writer`、`file-tools/truncate`）与包级 smoke 迁入并通过（3 files / 10 tests，typecheck 通过）；旧包目录已删除；`workspaces`/`bun.lock`/矩阵条目/三个工作流路径已同步；`workspace-workflows.test.ts` 13/13。证据见 `evidences/2026-09-11-agent-kit-aggregation-verification.md`。

后续：下一批成员（`sse/frame`、`file-tools/patch`）以命名空间加入本包；`agent-shell` 若建，按新命名决定归属（可作为 `agent-kit` 的 `./shell` 命名空间或独立包，待定）；领域 harness 名称 `@notnotype/neuro-agent-harness` 待旧包退役后复用。
