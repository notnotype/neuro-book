# .agents Agent 入口

目录用途和真相源分工见 [`README.md`](README.md)，通用入口见根 [`AGENTS.md`](../AGENTS.md)。非 OMP Agent 开始工作时显式读取 [`.omp/RULES.md`](../.omp/RULES.md)。本文件只定义 Agent 的加载动作：

以下读取在首次进入对应任务或恢复缺失上下文时触发；已加载且未变化的内容不重读。

- 处理或恢复尚无远端编号的 Issue 时读取 [`issues/README.md`](issues/README.md) 和 `issues/drafts/`；草稿路径只作恢复键，不写入 Work `issueId`。
- 创建、推进或审查 current 工作时，先读 [`works/README.md`](works/README.md) 和 [`works/AGENTS.md`](works/AGENTS.md)，再读具体 Work 与 Task。修复历史 provenance 时追加读取 [`tasks/README.md`](tasks/README.md) 和 [`tasks/AGENTS.md`](tasks/AGENTS.md)。
- 修改测试、fixture、验收或临时数据时读取 [`../docs/testing/README.md`](../docs/testing/README.md)；进入 `packages/`、`scripts/`、`scripts/release/` 或 `app/` 时读取最近的作用域 `AGENTS.md`。
- [技能索引](skills/README.md) 按当前缺失的方法选读，不替代 Task 或产品规范；主 Agent 可自行实现，也可按独立边界委派。