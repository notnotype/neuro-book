# nb-site-telemetry-contract 包入口

本包位于 `packages/nb-site-telemetry-contract`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-telemetry-contract` 是官方站统计模块对外的 HTTP 合同（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md) 决策 2）：站点地址上的路径前缀 `TELEMETRY_API_PREFIX`，以后是写入口与统计接口的 schema。客户端、前端、合同测试与统计模块都只经它认识统计的接口。

## 边界

- 运行时依赖只许 `typebox`（第一个 schema 进来时再加），devDependencies 里的工作区包只许测试支持包；由 `nb-site-server/src/architecture.test.ts` 检查。
- 只放合同：路径、schema、错误码。不放实现，也不放只有统计模块自己用的类型。
- 改这里就是改对外合同：写入口的形状由已发布的客户端在用，变了要按 Spec 判断是否破坏兼容。

## 完成门禁

```text
bun run typecheck
bun test
```

改了合同，另跑 `nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
