# @notnotype/nb-host

建在 nb-runtime 上的应用共用的两端宿主：只监听回环、`Host` 与 `Origin` 核对、状态根认领、内核 RPC 端口、启动与停止、诊断出口，以及浏览器一侧的连接与重连。应用只做装配，给出自己的名字、插件与配置。

- `./server`：只在 Bun 进程里用。
  - 回环与来源：`assertLoopbackHost`、`parseAllowedOrigins`、`assertLoopbackOrigins`、`loopbackOrigins`；不合时抛 `HostConfigError`（`non-loopback-host`、`invalid-origin`）。
  - 端口：缺省端口被占用时成组顺延（`listenWithShift`、`freeGroupOffset`、`probePort`），试探之前也核对回环。
  - 宿主适配器 `startServerHost`：把进程的停止来源（信号、标准输入、未处理异常）汇合成一次停止；平台档案必填。服务端进程与项目子进程共用。
  - 诊断：`createServerDiagnosticsPlugin` 在宿主授予的日志目录写 JSONL（`server-*.jsonl`），并把 `console.warn`、`console.error` 记进诊断。
  - 内核 RPC 端口：`startRpcListener` 先过准入的门，再核对来源。
  - 状态根认领：一个状态根同一时间只跑一个服务端。应用用 `defineClaimProfile` 给出套接字名前缀、版本与应答里自己的字段，再调 `claimStateRoot`、`queryInstance`。
- `./http/contracts`：贡献点 `http.routes` 的形状（`HTTP_ROUTES_POINT`、`HttpRouteHandler`、`HttpRouteEnv`、`rethrowRouteError`），插件提交路由时用。宿主的 HTTP 插件挂在 `/api/<插件 id>/`，核对 `Host`（不是回环名回 421）与写请求的 `Origin`（不允许的来源回 403）。
- `./web`：浏览器一侧。诊断写 console（`createBrowserDiagnosticsPlugin`）。
- `./socket`：内核 RPC 端口的 WebSocket 链路（`createSocketLink`、`RPC_PATH`、`RPC_MAX_MESSAGE_BYTES`），服务端与浏览器共用。
- `./testing`：宿主测试用的工具，包括单独测路由时要的 HTTP 准入与分发层。

不发 npm（`private`），只在本仓库的工作区里用。边界与验证见 [`AGENTS.md`](AGENTS.md)。

## 已知限制

- 不支持两个应用共用同一个状态根。状态根路径短时套接字在状态根里，后来的应用连上去拿到的应答对不上自己的档案，报“有实例但没有应答”；路径长到放进运行时目录时套接字名带各自的前缀，两个应用都能认领到。
