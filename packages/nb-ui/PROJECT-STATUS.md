# nb-ui 项目状态

## 当前状态

- `@notnotype/nb-ui` 发布到 npm，发布的是 TypeScript 与 `.vue` 源码（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。版本号见 `package.json`；公开 API 已按 0.4 改完，版本号与发布留到下次发版，清单见 [`docs/migration-0.4.md`](docs/migration-0.4.md)。
- 新应用 `packages/neuro-book` 与 nb-form、nb-agent-ui、nb-markdown、nb-story、dev-panel 都在用它。
- 样式：没有预编译产物，宿主的 Tailwind v4 编译 `src/tailwind.css`（导出为 `@notnotype/nb-ui/tailwind.css`），见 [`README.md`](README.md#宿主里的样式) 与 [ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)。
- 许可证：`AGPL-3.0-only`，与仓库根一致。

## 治理入口

- 项目规则：[`AGENTS.md`](AGENTS.md)
- 项目文档：[`docs/README.md`](docs/README.md)
- 历史 Task：[`.agents/tasks/README.md`](.agents/tasks/README.md)；当前工作在根 [`.agents/works/`](../../.agents/works/README.md)
- 仓库共享规则：[`../../AGENTS.md`](../../AGENTS.md)
