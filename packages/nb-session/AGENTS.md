# nb-session 包入口

本包位于 `packages/nb-session`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的项目专属规则。

- 行为真相源是 [`docs/specs/harness/session-log.md`](../../docs/specs/harness/session-log.md)；改动条目形状、JSONL 行格式或中断尾语义时先改 Spec，再同步 [`docs/api.md`](docs/api.md)、[`README.md`](README.md) 与示例。
- JSONL 行格式是持久化合同：新增条目 kind 时，读取端必须先能识别它，否则旧读取端会把新行当作中断尾。
- 只依赖 Node 内置模块，不引入 OMP、NeuroBook 产品或其它领域包。

## 完成门禁

```text
bun run typecheck
bun test
```

触及 `docs/` 或本文件时，另跑仓库门禁 `bun run docs:check` 与 `bun run governance:check`。
