# nb-site-identity 包入口

本包位于 `packages/nb-site-identity`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-identity` 是官方站的账号模块（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md)、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md)）：自己的 SQLite 库 `identity.db` 与它的迁移、挂在 `IDENTITY_API_PREFIX` 下的 Hono 子应用。行为合同是 [`site/accounts.md`](../../docs/specs/site/accounts.md)。

## 边界

- 工作区依赖只许自己的合同包 `nb-site-identity-contract`（devDependencies 另许测试支持包）；第三方通用包不限。由 `nb-site-server/src/architecture.test.ts` 检查。
- 不导入 `nb-site-server`：公开入口 `src/index.ts` 导出迁移清单、`parseIdentityConfig` 与 `createIdentityModule`，选项与返回值的类型由本包声明，进程入口的适配器对上形状。
- 只经交进来的连接读写自己的库，不附加别的库文件（`ATTACH`），由同一个架构测试检查源码与迁移。
- 迁移放 `migrations/NNNN_<小写下划线名>.sql`，在 `src/migrations.ts` 里按编号逐个导入；写法见入口包的“迁移”一节。

## 完成门禁

```text
bun run typecheck
bun test
```

改了本包，另跑 `nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
