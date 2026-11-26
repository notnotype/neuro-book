# nb-page-agent 包入口

本包位于 `packages/nb-page-agent`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则；职责与接口见 [`README.md`](README.md)。

## 边界

- 与应用无关：源码不写 NeuroBook 的标记、命令与插件 id，不导入应用包。只认 Spec 公开的属性（`data-nb-target`、`data-nb-key`、`data-nb-agent`）与自己的节点（`data-nb-page-agent`）。
- `./attrs` 不碰 DOM、没有依赖。

## 完成门禁

`bun run typecheck` 与 `bun test` 在本包目录通过。
