# AGENTS.md

仓库共享协作、安全、Git、临时目录、报告和通用 TypeScript 规则见 [`../../AGENTS.md`](../../AGENTS.md)；本文件只保留 NeuroAgentHarness 的项目边界与专属合同。

## 项目边界

- 本包已冻结：只服务 llmlint，不接收新功能，待 llmlint 退出后处置（开发者决定见 [w00002 t01 context](../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t01-product-host-success-research/context.md)）。NeuroBook 的 harness 由 w00002 在 [`packages/nb-harness`](../nb-harness/AGENTS.md) 重建。
- 本包现状：独立的、宿主无关的 TypeScript Agent Harness；NeuroBook 不是本包的运行时依赖。
- Core 保持宿主无关；NeuroBook、Nuxt、Prisma、Pi、provider、路径和 UI 逻辑通过 Adapter、Capability 或 Workflow 注入。
- Core 不依赖 NeuroBook、llmlint、Nuxt、Prisma、Vue 或具体 Project Workspace 布局。

## 开发流

1. 确认任务范围，阅读 `README.md`、`CONTEXT.md`、[`docs/README.md`](docs/README.md)、根 Work 与指定 Task。Issue #193 的 current 合同位于 `w00002-neuro-agent-harness-redesign`；包内 `.agents/tasks/` 只作 legacy provenance。
2. 从公开导出追到实现和行为测试；涉及 Session、Invocation、Snapshot、Event Cursor、Store、Capability、Workflow、Approval、Compaction 或 Tool 调度时，以 `CONTEXT.md` 和对应设计文档为准。
3. 做最小变更；公共合同变化同步类型、导出、测试和文档。
4. 按风险先跑聚焦测试，再跑 `bun run verify`；涉及打包或发布边界时再跑 `bun run pack:smoke`，分别报告各项结果和未运行项。
5. 跨模块、架构、公共合同、goal 或包内新工作统一在根 `.agents/works/` 建立或复用 Work，并在 Work 内维护 current Task（不设正式角色）；每轮把变更、证据、未验证项、绕道和下一步写回该 Task 引用的报告或 evidence。

## 项目合同

- Session、Entry 和 Invocation 事实保持 append-only；Snapshot 是恢复真相源。
- Profile 和 Tool 不直接操作 Store，只返回 `SessionWritePlan` 或 Tool result。
- 保持严格类型、ESM 兼容和公开导出/行为测试/文档三者一致；注释只解释合同或非显然取舍。
- 测试和运行数据使用隔离的临时根，不触碰用户真实数据。

## 详细索引

任务协作规则见 [`../../AGENTS.md`](../../AGENTS.md) 与根 [`.agents/works/`](../../.agents/works/README.md)；源码/测试地图和验证入口见 [`docs/README.md`](docs/README.md)。包内 `.agents/tasks/` 只保留 legacy 记录。
