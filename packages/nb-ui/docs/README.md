# nb-ui 文档

这里维护 `nb-ui` 组件库自己的规范与设计资料。文档只约束 `packages/nb-ui` 的公共组件、主题、token、样式和 playground，不替代仓库根文档治理。

## 当前入口

- [UI development spec](ui-development-spec.md)：组件、样式、主题和 playground 的开发合同。
- [Design language](design-language.md)：视觉规则与设计取舍。
- [Authoring themes](authoring-themes.md)：主题包格式与作者指南。
- [Project Status](../PROJECT-STATUS.md)：nb-ui 当前包状态与快照边界。

### 组件级契约

组件源代码目录中包含组件级说明文档（如 [`DialogWindow.md`](../src/components/feedback/DialogWindow.md) 与 [`grid.md`](../src/components/layout/grid.md)）。在进行 UI 开发或查阅具体组件时，每个受管组件均有同名 `.md` 文件作为其行为与能力标签说明。

项目 Agent 规则见 [`../AGENTS.md`](../AGENTS.md)，仓库共享合同见 [`../../../AGENTS.md`](../../../AGENTS.md)。项目 Task 索引见 [`../.agents/tasks/README.md`](../.agents/tasks/README.md)。

本目录没有从根 `docs/` 复制的共享正文；NeuroBook 主应用和跨项目事项仍归仓库根文档治理。
