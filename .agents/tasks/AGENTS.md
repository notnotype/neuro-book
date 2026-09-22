# Legacy Task Agent 指令

本目录只维护 legacy Task provenance；current Work 与 Task 使用 [`../works/README.md`](../works/README.md) 和 [`../works/AGENTS.md`](../works/AGENTS.md)。

- legacy `nbook.task/v1` 的 `agentWorkflow`、状态、章节、密封 research/design diff、ownership 与迁移快照按原合同只读校验。
- 修复历史记录时保持原身份和 owner，不重编号、不迁移名称、不重算密封 hash，也不把旧字段解释为 current 工作流。
- 本目录和包级 `.agents/tasks/` 拒收 `nbook.task/v2`；current Task 必须位于 Work 容器内。
- 过程证据继续写入原 legacy Task 的 walkthrough/evidence；新开发工作在 `.agents/works/` 创建或复用 Work 与 Task，不加载正式角色。
