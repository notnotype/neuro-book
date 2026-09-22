# Legacy Agent Tasks

`.agents/tasks/`、`packages/neuro-book/.agents/tasks/` 与自治包 `.agents/tasks/` 是 legacy Task archive，只保存历史 `nbook.task/v1` 合同、walkthrough、evidence 和迁移 provenance。current Work 与 Task 的唯一入口是 [`../works/`](../works/README.md)。

## 历史边界

- `ownership.json` 保留根与主应用旧 Task root 的稳定 owner 映射。
- `legacy-index.json` 与 `.migration-complete` 保留密封迁移快照；历史文件、名称、worktree、branch 和 PR 不迁移、不重算 hash。
- 历史 `agentWorkflow`、`actionIssueId`、`kind`、`worktreeId`、`branchId` 仅按原合同校验 provenance，不作为 current 模型。
- legacy root 拒收 `schema: nbook.task/v2`。新 Task 必须位于 `.agents/works/<work>/tasks/<task>/README.md`。
- 无 frontmatter 的导入记录继续只读；旧 walkthrough 与 evidence 不回填。

current schema、Work 容器、Task 快照与 CLI 用法见 [`../works/README.md`](../works/README.md)。
