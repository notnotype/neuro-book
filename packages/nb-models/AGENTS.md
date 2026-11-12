# nb-models 包入口

本包位于 `packages/nb-models`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-models` 是建在 nb-runtime 与 nb-harness 上的模型服务（[ADR 0045](../../docs/adr/0045-shared-host-packages-for-second-app.md)）：服务商与角色的配置形状、内置角色、设置页的远程合同。行为合同是 [`models/service.md`](../../docs/specs/models/service.md)；用它的应用给合同 id、服务键、设置项的分区与文字。

## 边界

- 子路径与运行位置：

  | 子路径 | 运行位置 |
  |---|---|
  | `./config` | 不限（设置页用）：配置形状、内置角色与 `MODEL_ROLE_IDS`、引用与服务商 id 的纯规则、压缩触发点 |
  | `./contract` | 不限：快照与结果的形状、设置页远程合同的定义 `modelsSettingsSpec`（缺 id）与推出的 `ModelsSettingsContract`、进程内的 `ModelsService` |

- 浏览器会加载 `src/config/`、`src/contract/`：值导入只许 `typebox` 与 nb-harness 的 `kit/shapes`，类型导入另许 nb-harness 的 `kernel/contracts` 与 nb-runtime 的 `remote`。不取 nb-harness 的根入口与 `kernel`（它们值导出 OMP 的适配器）。规则由 `src/boundary.test.ts` 检查。
- 与应用无关：源码不写应用名，不导入应用包（`src/app-neutral.test.ts`）。内置角色的名字与说明是应用的本地化文字，不在这里。

## 完成门禁

```text
bun run typecheck
bun test
```

`typecheck` 用两份配置：`tsconfig.json` 带 Bun 类型；`tsconfig.browser.json` 只查 `src/config/`、`src/contract/`，带 DOM、不带 Bun 与 Node 类型。改了形状或合同，另跑应用 `packages/neuro-book` 的 `src/plugins/models`、`src/plugins/agent/web` 与类型检查。
