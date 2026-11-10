# nb-host 包入口

本包位于 `packages/nb-host`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-host` 是建在 nb-runtime 上的应用共用的两端宿主（[ADR 0045](../../docs/adr/0045-shared-host-packages-for-second-app.md)）：服务端只监听回环、`Host` 与 `Origin` 核对、状态根认领、内核 RPC 端口、启动与停止、诊断出口；浏览器一侧的内核实例、首连与断线重连。行为合同是 [`runtime/server-host.md`](../../docs/specs/runtime/server-host.md) 与 [`runtime/browser-host.md`](../../docs/specs/runtime/browser-host.md)；这些安全规则两个应用共用这一份实现。

## 边界

- 与应用无关：应用名、产品名、插件 id、环境变量、端口缺省都由宿主传入；源码（含注释）不写应用名、不导入应用包。测试里的应用用 `acme`。
- 子路径与运行位置：

  | 子路径 | 运行位置 |
  |---|---|
  | `./server` | Bun：回环与来源校验、端口顺延、状态根认领、HTTP 插件、诊断的 JSONL 出口、宿主适配器、内核 RPC 端口的监听 |
  | `./http/contracts` | 不限：贡献点 `http.routes` 的形状，没有运行时导入 |
  | `./socket` | 不限：服务端与浏览器共用的 WebSocket 链路 |
  | `./web` | 浏览器：诊断的 console 出口 |
  | `./testing` | Bun，只给测试：连 RPC 端口的原始客户端、能掐断连接的 TCP 转发 |

- 浏览器会加载 `src/web/` 与 `src/shared/`：它们只许导入 nb-runtime 的子路径与 TypeBox，不用 DOM 之外的平台 API；新加第三方依赖要同时加进应用 `vite.config.ts` 的 `optimizeDeps.include`。目录名叫 `web/`：应用开发监督进程按路径段 `web` 判前端文件，改它不触发后端重启。
- 规则由 `src/architecture.test.ts` 检查，新加目录或子路径先看那里的约定。

## 完成门禁

```text
bun run typecheck
bun test
```

`typecheck` 用两份配置：`tsconfig.json` 带 Bun 类型；`tsconfig.browser.json` 只查 `src/web/`、`src/shared/`，带 DOM、不带 Bun 与 Node 类型。改了两端宿主的行为，另跑应用 `packages/neuro-book` 里经产品装配的测试（`src/server`、`src/web/host`）与覆盖它的 e2e（`rpc.e2e.ts`、`browser-host.e2e.ts`）。
