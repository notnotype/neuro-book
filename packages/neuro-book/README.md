# NeuroBook 应用（v2）

NeuroBook 的应用源码：Bun 服务端、Vue 前端、内置插件与插件平台、命令行 `nbook`、插件 SDK 与作者工具。方案与技术选型见 [NeuroBook v2：并排重建应用](../../docs/proposals/neuro-book-v2-rebuild.md) 与 [ADR 0023](../../docs/adr/0023-v2-frontend-backend-stack.md)；旧应用在 [`../neuro-book-legacy/`](../neuro-book-legacy/AGENTS.md)，只作参照。

这份 README 写给开发者。用户装的是 npm 上的 `@notnotype/neuro-book`，它的说明在 [`scripts/app-package/README.md`](scripts/app-package/README.md)；写插件看 [SDK 的作者文档](plugin-sdk/README.md)。

## 开发

在仓库根 `bun install` 之后，在本目录里：

| 命令 | 做什么 |
|---|---|
| `bun run dev` | 开发模式：Vite 前端加后端监督进程，改后端文件有序重启；`/lab` 是 Component Lab。开发 Agent 用 `nbdev dev start`（[说明](../dev-panel/docs/cli.md)） |
| `bun run test`、`bun run typecheck` | Bun 测试与 Vitest 组件测试、类型检查；平时用仓库根的 `bun run test:affected` |
| `bun run test:e2e` | 构建后在本机 Chrome 上跑 Playwright |
| `bun run build`、`bun run start` | 构建服务端与前端；用构建产物启动（要给 `NBOOK_STATE_ROOT`） |
| `bun run smoke:server` | 打包后的服务端的进程级冒烟 |
| `bun run build:app-package` | 生成要发布的应用包（[ADR 0033](../../docs/adr/0033-app-delivered-as-built-npm-package.md)） |
| `bun run build:sdk` | 生成插件 SDK 包 `@notnotype/nb-plugin-sdk` |

目录约定、内置插件的写法与改动前要读的规则见 [`AGENTS.md`](AGENTS.md)；行为合同在 [`docs/specs/`](../../docs/specs/)。发布由维护者按 [repository-workflow 的“发布授权”](../../docs/standards/repository-workflow.md#发布授权)执行：打标签发布，本机发布作备用。

## 许可证

AGPL-3.0-only，见仓库根的 [LICENSE](../../LICENSE)。
