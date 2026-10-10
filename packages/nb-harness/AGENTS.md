# nb-harness 包入口

本包位于 `packages/nb-harness`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的项目专属规则。

`@notnotype/nb-harness` 是 NeuroBook 的 Agent harness，不依赖插件系统，离开应用也能装配、运行与测试；`nbook.agent` 插件以后建在它上面。设计见 [Agent harness 内核](../../docs/proposals/agent-harness-kernel.md)；模型通信与 Agent 循环基于 OMP 包族（`@oh-my-pi/*`），能力与陷阱见 [`docs/omp-capabilities.md`](docs/omp-capabilities.md)。

## 模块与依赖

- 一个模块一个公开入口：`package.json` 的 `exports` 子路径，指向 `src/<模块>/<模块>.ts`；需要 I/O 或会执行外部代码的部分另开子入口（例如 `./session/jsonl`）。其余文件是实现细节，包外不深导入。
- 模块之间只单向依赖，只经对方的公开入口；允许的模块依赖、外部包与 Node 内置模块登记在 [`src/architecture.test.ts`](src/architecture.test.ts) 的模块表，新增模块或依赖先改表。分层见设计稿的“模块划分与推进顺序”。
- 每个模块的行为合同是 `docs/specs/harness/<模块>.md`；改变可观察行为时先改 Spec。
- 模块顶层没有 I/O、单例与计时器；时钟、存储位置、凭据等由使用方传入。
- `src/prototype/` 是旧原型（原 `src/` 与 `tests/`），没有行为合同，只为过渡期保持可运行，由包根入口 `.` 与 `./testing` 导出；新模块不引用它，它也不引用新模块。`runtime` 模块完成时删除它与 `nb-session`、`nb-profile` 两个包。

## OMP

- 只通过 OMP 的公开子路径取能力；不引入 `@oh-my-pi/pi-coding-agent`（47 MB 级闭包，含 puppeteer 与 12 个 OTel 包）。
- 依赖版本精确锁定（OMP 日更）；升级要一次改完所有 `@oh-my-pi/*`，并同步更新 `docs/omp-capabilities.md` 的版本表与测试。
- OMP 的 `pi-utils` 在导入时会读 `.env` 并改写 `Bun.env`，凭据缺省路径指向 OMP 自己的目录：本包显式传入路径与凭据，不依赖这些缺省。

## 测试

- 测试与源码同目录（`*.test.ts`）；测试辅助放在模块的 `testing/`，作为 `<模块>/testing` 子入口导出；写法按 [测试写法](../../docs/testing/README.md#测试写法)。
- 需要模型响应的测试放在 `*.llm.test.ts`，用 `bun run test:llm` 显式运行；缺凭据时跳过并记为未验证。
- 临时目录用 `@notnotype/neuro-book-test-support/tmp` 的 `createTestTmpRoot`。
- Windows 上删除或移动包目录前，确认没有遗留的 `bun test` 进程持有句柄。

## 完成门禁

```text
bun run typecheck
bun test
```

触及 `docs/` 或本文件时，另跑仓库门禁 `bun run governance:check` 与 `bun run docs:check`。
