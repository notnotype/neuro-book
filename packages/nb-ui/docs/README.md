# nb-ui 文档

这里维护 `nb-ui` 组件库自己的规范与设计资料。文档只约束 `packages/nb-ui` 的公共组件、主题、token、样式和 playground，不替代仓库根文档治理。

## 当前入口

- [UI development spec](ui-development-spec.md)：组件、样式、主题和 playground 的开发合同。
- [Design language](design-language.md)：视觉规则与设计取舍。
- [Authoring themes](authoring-themes.md)：主题包格式与作者指南。
- [Project Status](../PROJECT-STATUS.md)：nb-ui 当前包状态与快照边界。

### 组件级契约

组件源代码目录中包含组件级说明文档（如 [`DialogWindow.md`](../src/components/feedback/DialogWindow.md) 与 [`grid.md`](../src/components/layout/grid.md)）。在进行 UI 开发或查阅具体组件时，查阅范围限于**受管组件**：通过 [`src/components/index.ts`](../src/components/index.ts) 对外导出的组件，以及 `packages/neuro-book/app/components/common/**` 下的 `.vue`。这批组件必须有同名 `.md` 作为行为与能力标签说明；缺失会使 `bun run docs:check` 失败。其余组件不在门禁内，改动时补齐。

项目 Agent 规则见 [`../AGENTS.md`](../AGENTS.md)，仓库共享合同见 [`../../../AGENTS.md`](../../../AGENTS.md)。current Work/Task 位于根 [`.agents/works/`](../../../.agents/works/README.md)；[`../.agents/tasks/`](../.agents/tasks/README.md) 只保存本包 legacy 记录。

本目录没有从根 `docs/` 复制的共享正文；NeuroBook 主应用和跨项目事项仍归仓库根文档治理。
