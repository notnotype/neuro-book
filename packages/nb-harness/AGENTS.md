# nb-harness 包入口

本包位于 `packages/nb-harness`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的项目专属规则。

`@notnotype/nb-harness` 是域无关的 agent 内核，直接以 OMP 包族（`@oh-my-pi/*`）为底座：模型取自 `pi-catalog`、循环与工具协议来自 `pi-agent-core`、传输用 `pi-ai` 的 `streamSimple`、编辑走 `pi-natives` 的 `EditSession`。域工具不在本包内，通过插件缝（`HarnessPlugin`）由宿主注入。

## 开工前

- 读 [`docs/omp-capabilities.md`](docs/omp-capabilities.md)：OMP 包族的能力面、最小调用样例、`omp://` 文档入口与陷阱（裸 TS 入口、import 期 env 副作用、原生包体积、编辑语义）。
- 改公共接口前先确认调用方：`packages/nb-harness/src/index.ts` 的导出面就是本包的合同。
- 依赖版本**精确锁定**（OMP 日更）；升级要一次改完所有 `@oh-my-pi/*`，并同步更新 `docs/omp-capabilities.md` 的版本表与测试。

## 实施

- 只通过 OMP 的公开子路径取能力；不要 import `@oh-my-pi/pi-coding-agent`（47 MB 级闭包，含 puppeteer 与 12 个 OTel 包）。
- 工具一律实现 OMP 的 `AgentTool` 接口；不要另造平行工具抽象。
- 预期失败不抛裸异常：工具失败用 `AgentToolResult.isError`，内核启动期契约错误才抛错（并带可读 message）。
- 测试用 `bun test`；临时目录用 `createTestTmpRoot`；需要 LLM 的用例真实调用 DeepSeek，缺凭据时 `skip` 并在记录里写「未验证」，禁止 mock 充当通过。
- Windows 上删除/移动包目录前，确认没有遗留 `bun test`/vitest 进程持有句柄。

## 完成门禁

```text
bun run typecheck
bun test
```

- 涉及内核装配或工具的改动，必须跑 `tests/harness.e2e.test.ts`（含真实 LLM 两条，无凭据时 skip）。
- 触及包级资产（`docs/`、本文件）时，另跑仓库门禁：`bun run governance:check` 与 `bun run docs:check`。
