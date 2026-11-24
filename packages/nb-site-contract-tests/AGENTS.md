# nb-site-contract-tests 包入口

本包位于 `packages/nb-site-contract-tests`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-contract-tests` 是官方站的黑盒合同测试（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md) 决策 6、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md) 决策 4）：起真实的服务进程，只经 HTTP 与命令行说话。被测程序换语言重写之后，这里的测试照样能跑，所以测试里不能用到被测系统的任何实现。

## 导入的允许清单

ADR 0059 决策 6 的“合同包之外的任何包”指被测系统的工作区包（两个模块、进程入口、前端）与它们带进来的第三方依赖。下面这些不在其内，可以导入：

| 导入 | 在哪里 | 理由 |
|---|---|---|
| `@notnotype/nb-site-identity-contract`、`@notnotype/nb-site-telemetry-contract` | 任何文件 | 合同本身 |
| `bun:test`、`node:` 内置模块 | 任何文件 | 测试运行器与平台 |
| `@notnotype/neuro-book-test-support/tmp`、`/wait` | 任何文件 | 临时目录与等待工具，与被测系统无关 |
| `bun:sqlite` | 只在 `src/testing/fault.ts` 与备份核对的辅助文件 `src/testing/backup.ts` | 按 Spec 写明的数据目录布局直接碰库文件：持写锁做故障注入、只读打开备份副本核对；不读写被测模块的表 |
| `@notnotype/neuro-book-test-support/import-boundary` | 只在 `src/boundary.test.ts` | 做这项检查的工具 |

相对导入只许落在本包的 `src/` 里。清单的运行时依赖只有两个合同包；devDependencies 里的工作区包只有 `nb-site-server`（只用来找到被测程序的启动命令，并让 `test:affected` 改了入口、模块或合同时选中本包）与测试支持包。这些都由 `src/boundary.test.ts` 检查；要放开一项，先改这张表并写明理由，再改检查。

## 完成门禁

```text
bun run typecheck
bun test
```
