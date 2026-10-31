# nb-harness 包入口

本包位于 `packages/nb-harness`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的项目专属规则。

`@notnotype/nb-harness` 是 NeuroBook 领域 harness，不追求通用：内核与循环直接以 OMP 包族（`@oh-my-pi/*`）为底座（模型取自 `pi-catalog`、循环与工具协议来自 `pi-agent-core`、传输用 `pi-ai` 的 `streamSimple`、编辑走 `pi-natives` 的 `EditSession`），通用能力由 OMP 覆盖，不另造平行抽象。行为合同是 [`docs/specs/agent/harness.md`](../../docs/specs/agent/harness.md)：只经 Profile 运行，工具只来自 Profile 的声明（内置的读、改文件工具也要宿主登记、Profile 声明才有）；领域工具由插件经登记表贡献，不在本包内实现。

## 新内核 `src/kernel/`

`src/kernel/` 是 harness 的新实现（w00032 t20，[提案](../../docs/proposals/agent-harness-event-model.md)、[ADR 0035](../../docs/adr/0035-harness-log-driven-kernel.md)），不是 `nb-runtime` 的内核。它不套 OMP 的 `Agent`，循环自己写，只经 `model/` 的适配器用 OMP 的 `streamSimple`。迁移 Task 把 nb-story、nb-agent-ui 改到新内核后，删掉旧的 `createHarness` 与 `agent/harness.md`，`kernel/` 整体上移一层；在那之前旧实现只为让它们的测试照跑，不再加功能。

- 行为合同：[`harness/session.md`](../../docs/specs/harness/session.md)（日志与会话目录）、[`harness/extensions.md`](../../docs/specs/harness/extensions.md)（扩展），其余 harness Spec 随实施新建。实施计划在 w00032 t20 的 `plan.md`。
- 分层：`api/` 只放类型与码表；目录之间单向依赖、只用相对导入、不引用 `kernel/` 之外的旧文件；`node:fs` 只在 `log/`，OMP 只在 `model/`；产品代码不引 `testing/`。规则由 `src/kernel/architecture.test.ts` 检查，新增目录先在它的目录表里登记。
- 定稿类型的写错用例在 `tests/kernel/typetest.tsx`，由 `bun run typecheck` 检查；改类型时补用例，编号只追加。
- 各目录的模块头写这个目录的时序与不变量；行为规则链接 Spec，不复述。

## 开工前

- 读 [`docs/omp-capabilities.md`](docs/omp-capabilities.md)：OMP 包族的能力面、最小调用样例、`omp://` 文档入口与陷阱（裸 TS 入口、import 期 env 副作用、原生包体积、编辑语义）。
- 改公共接口前先确认调用方：`packages/nb-harness/src/index.ts` 的导出面就是本包的合同。
- 依赖版本**精确锁定**（OMP 日更）；升级要一次改完所有 `@oh-my-pi/*`，并同步更新 `docs/omp-capabilities.md` 的版本表与测试。

## 实施

- 只通过 OMP 的公开子路径取能力；不要 import `@oh-my-pi/pi-coding-agent`（47 MB 级闭包，含 puppeteer 与 12 个 OTel 包）。
- 工具分声明（`ToolDeclaration`，冻结进会话快照，含 OMP 在执行前就要读的 `concurrency`、`strict`、`customFormat`）与实现（`ToolImpl`，经可撤回的句柄每次调用时取得）；交给 OMP 时由 `tools/bridge.ts` 包成 `AgentTool`。
- 预期失败不抛裸异常：工具失败用 `AgentToolResult.isError`，内核启动期契约错误才抛错（并带可读 message）。
- 文字的语言按 [ADR 0034](../../docs/adr/0034-language-policy.md) 决策 4：新写的工具说明与提醒用中文；现有英文说明先不动；OMP 原生 `read`、`edit` 的错误文本原样保留；领域工具的失败在 `details` 给结构化 `code`。
- 测试用 `bun test`；临时目录用 `createTestTmpRoot`；需要 LLM 的用例真实调用 DeepSeek，缺凭据时 `skip` 并在记录里写「未验证」，禁止 mock 充当通过。
- Windows 上删除/移动包目录前，确认没有遗留 `bun test`/vitest 进程持有句柄。

## 完成门禁

```text
bun run typecheck
bun test
```

- 改新内核时，`bun test` 已包含 `src/kernel/**` 与 `tests/kernel/` 的测试，`bun run typecheck` 包含 `tests/kernel/typetest.tsx`。

- 涉及会话、运行或工具的改动，必须跑 `tests/session.test.ts`、`tests/acceptance.test.ts`（脚本化模型输出，`src/testing` 的 `scriptedModel`）与 `tests/provider.test.ts`（本机起的 OpenAI 兼容端点），都不调用真实模型；再用 `bun run test:llm` 跑 `tests/harness.llm.test.ts` 的两条真实模型 Smoke（缺凭据时跳过，记为未验证）。
- 触及包级资产（`docs/`、本文件）时，另跑仓库门禁：`bun run governance:check` 与 `bun run docs:check`。
