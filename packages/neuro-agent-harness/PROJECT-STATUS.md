# neuro-agent-harness 项目状态

## 当前快照

- **身份**：`@notnotype/neuro-agent-harness`，版本 `0.1.0`，宿主无关的 TypeScript Agent Harness。
- **来源**：`C:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-agent-harness`，S0 快照 HEAD `1e4774f299eae78dc304ca750d105ce2584e5cff`，分支 `master`，upstream `origin/master`。
- **状态**：已按 S0 import manifest 收编到 monorepo `packages/neuro-agent-harness`；源 checkout 保持不变且不作为本包开发路径。
- **范围**：保留 Core、Memory/JSONL Store、Workflow、事件/Session 合同、`scripts/pack-smoke.ts`、全部源码、测试、设计文档、历史 Task 和包消费合同；本次收编不声明替换 NeuroBook 自有 Harness。
- **包治理**：monorepo 包设为 `private: true`，删除源 `publishConfig` 和自动发布入口；保留原 name、版本、exports、scripts、build/pack smoke 行为和依赖语义。Registry 已有版本不在此处修改。

## S0 导入记录

manifest 共记录 299 个候选条目，其中 298 个 included、1 个明确排除条目（`.github/workflows/release.yml`，根 workflow 归 monorepo 治理）。按共享约束复制 296 个 included 文件；源 `.gitignore` 与根 `bun.lock` 虽在 manifest included 记录中，但按收编约束跳过，因此目标包不维护第二套 ignore 或 workspace lockfile。

复制前后使用逐文件 SHA-256 与 manifest `bytes` 对照复核；其中 `.agents/tasks/**` 的 101 个历史 Task 文件重定位到 `.agents/tasks/**`，文件字节保持不变。源 checkout 未运行 Git 操作、写入命令或项目验证。

本次按任务要求**未运行**包测试、`verify`、`pack:smoke`、typecheck、formatter、linter、build、install 或其他项目级验证；Leader 集成后统一执行项目合同命令。

## 治理入口

项目规则见 [`AGENTS.md`](AGENTS.md)，文档索引见 [`docs/README.md`](docs/README.md)，current Work 入口见 [`../../.agents/works/README.md`](../../.agents/works/README.md)，历史 Task 入口见 [`.agents/tasks/README.md`](.agents/tasks/README.md)。NeuroBook monorepo 共享规则、跨项目协调和根安装图见 [`../../AGENTS.md`](../../AGENTS.md)；项目行为变化只在 current Work/Task 记录，跨自治项目事项由根治理协调。
