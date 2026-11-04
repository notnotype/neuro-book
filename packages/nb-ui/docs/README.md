# nb-ui 文档

本目录维护 nb-ui 自己的规范与设计资料，只约束 `packages/nb-ui` 的公共组件、主题、token、样式和 playground。

- [开发规范](ui-development-spec.md)：组件、样式、主题和 playground 的工程合同。
- [设计语言](design-language.md)：视觉判据与设计取舍。
- [主题作者规范](authoring-themes.md)：主题包格式与作者指南。
- [从 0.3 升级到 0.4](migration-0.4.md)：公开 API 的逐项对照。
- [使用说明](../README.md)：安装、接入与公开入口。
- [项目状态](../PROJECT-STATUS.md)：包的现状。

组件的行为写在源码目录里的同名 `.md`（例如 [`Dialog.md`](../src/components/feedback/Dialog.md)、[`grid.md`](../src/components/layout/grid.md)）；哪些组件必须有，见[组件规范](../../../docs/standards/code/components.md)的“组件文档”。

项目 Agent 规则见 [`../AGENTS.md`](../AGENTS.md)，仓库共享合同见 [`../../../AGENTS.md`](../../../AGENTS.md)。当前的 Work 与 Task 在根 [`.agents/works/`](../../../.agents/works/README.md)，本包的历史 Task 在 [`../.agents/tasks/`](../.agents/tasks/README.md)。
