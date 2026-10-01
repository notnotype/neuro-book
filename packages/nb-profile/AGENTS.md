# nb-profile 包入口

本包位于 `packages/nb-profile`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的项目专属规则。

- 行为真相源是 [`docs/specs/harness/profile-dsl.md`](../../docs/specs/harness/profile-dsl.md)；新增节点或改变渲染规则时先改 Spec，再同步 [`docs/api.md`](docs/api.md)、[`README.md`](README.md) 与示例。
- 新增节点要同时登记到 `src/nodes.ts`、`src/index.ts` 和 `src/jsx-runtime.ts` 的组件表；`jsx-dev-runtime.ts` 复用同一张表。
- `renderProfile` 保持纯函数：不读环境、不读文件、不修改输入。
- 只依赖 Node 内置模块，不引入 OMP、NeuroBook 产品或其它领域包；本包与产品 Profile SDK（`nbook/profile-sdk`）是两套实现，不要互相导入。

## 完成门禁

```text
bun run typecheck
bun test
```

触及 `docs/` 或本文件时，另跑仓库门禁 `bun run docs:check` 与 `bun run governance:check`。
