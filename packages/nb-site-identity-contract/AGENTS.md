# nb-site-identity-contract 包入口

本包位于 `packages/nb-site-identity-contract`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-identity-contract` 是官方站账号模块对外的 HTTP 合同（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md) 决策 2）：路径前缀 `IDENTITY_API_PREFIX`，以后是请求与响应的 schema。前端、合同测试与账号模块都只经它认识账号的接口。

## 边界

- 运行时依赖只许 `typebox`（第一个 schema 进来时再加），devDependencies 里的工作区包只许测试支持包；由 `nb-site-server/src/architecture.test.ts` 检查。
- 只放合同：路径、schema、错误码。不放实现，也不放只有账号模块自己用的类型。
- 改这里就是改对外合同：路径或形状变了，前端与合同测试要一起改，并按 Spec 判断是否破坏兼容。

## 完成门禁

```text
bun run typecheck
bun test
```

改了合同，另跑 `nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
