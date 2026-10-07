# t53 实施计划：K2 服务端 RPC 端口与浏览器宿主连接

## Context

- **为什么做**：K1（[t52](../t52-kernel-instances-remote/README.md)）在内核实现了远程服务的合同、路由与协议，只用进程内链路验证。K2 接上真实传输：服务端宿主开一个内核 RPC 专用端口（WebSocket），浏览器窗口在启动时连上它，之后插件经 `context.remote` 跨实例调用。本片只做**未绑定项目**的客户端；项目绑定、项目子进程与服务端停止顺序的其余步骤归 K3。
- **依据**：[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 3、5、6 节与第 11 节 K2 行、[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)（2026-10-07 `accepted`）；Spec `docs/specs/runtime/plugin-channel.md`（`planned`）、`runtime/server-host.md`（`implemented`）、`runtime/browser-host.md`（`planned`）、`runtime/api-docs.md`（`planned`）。
- **开发者已确认的**：客户端与服务端之间用 WebSocket；RPC 端口与 HTTP 端口分离，RPC 端口校验 `Origin`、只监听回环地址；客户端实例一生只绑定一个项目代次或不绑定，切换项目即重新加载；K1–K5 先于外壳实现。
- **拓扑稿要求开始前固定**：握手字段、`Origin` 策略、重连规则。本计划在“关键设计”第 1–3 节给出，其中改变产品行为的几点经开发者确认，列在末尾。
- **已核实的机制**（2026-10-07，Bun 1.4.2 临时脚本）：`Bun.serve` 的 `fetch` 里 `await` 之后仍可 `server.upgrade()`；Bun 的客户端 `WebSocket` 能带自定义 `Origin` 头，也能不带；`server.stop(true)` 关闭存活的 WebSocket（客户端收到 1006）。G0 报告的 WebSocket 结论针对旧 Nuxt 栈，不适用于 v2。
- **工作方式**：在 worktree `.worktree/w00017-runtime-foundation` 逐片提交，只暂存本片文件；测试用真实内核实例、真实 Bun WebSocket 与本机 Chrome，不用 mock、spy、假计时器、固定等待，时间用注入时钟；交付前对验收映射的每条判据做变异检查；主 Agent 编码，最后 omp（默认模型）只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 握手与重连（内核 `packages/nb-runtime/src/remote/`）

- **hello**：`{type: "hello", wire, instance: {id, kind, role, project, client}}`。`InstanceSchema` 新增 `client: string | null`，即客户端身份：浏览器跨刷新稳定的标识（第 3 节），服务端与项目实例为 `null`。K4 的 Storage `local` 分区按它分区。拓扑稿列的“各插件版本”不放进 hello：K1 已让每个请求帧带调用方期望的合同版本，路由逐个请求核对。
- **先核对 wire 版本**：`Peer` 收到 `type: "hello"` 且 `wire` 是整数、但与本端不同的帧时，不做其余字段的 schema 校验，直接交给 `onHello` 作为版本不符处理，路由回 `reject {reason: "wire-version"}`。`reject` 帧的形状 `{type, reason, message}` 跨 wire 版本冻结，旧客户端总能读懂新服务端的拒绝。
- **welcome**：`{type: "welcome", wire, boot}`。`boot` 是服务端这一次进程的标识，由 `createRemoteRouter(hub, {boot?})` 给出，缺省 `crypto.randomUUID()`。
- **客户端节点识别服务端重启**：`RemoteNodeImpl` 记住第一次 welcome 的 `boot`。之后 `connect(link)` 收到不同的 `boot`：结束本节点全部远程订阅（`onEnd("server-restarted")`），不重建，关闭这条链路，返回 `{ok: false, reason: "server-restarted"}`；此后远程调用为 `unavailable`。`boot` 相同时沿用 K1：重建仍有效的订阅并调用 `onResync`。
- **重连接管**：hello 的实例 id 已登记时，若 `kind`、`role`、`project`、`client` 都与已登记的一致，路由关闭旧链路（其上在途请求与订阅按断开结算）、登记新链路；否则仍以 `duplicate-instance` 拒绝。服务端自己的 id 一律拒绝。这样服务端尚未察觉旧连接断开（半开连接）时客户端也能重连。
- **协议违规**：握手前收到非 hello 帧、或任何无法解析的帧，路由记诊断并关闭这条链路（K1 只记诊断，调用方要等到超时）。
- **JSON 编解码**：新增 `json-codec.ts`，从 `./remote` 导出 `encodeJsonFrame(frame) → string` 与 `decodeJsonFrame(text) → unknown`。只接受 JSON 能如实表示的值（普通对象、数组、字符串、有限数、布尔、`null`；对象上的 `undefined` 属性省略），遇到函数、symbol、bigint、非有限数、数组里的 `undefined`、非普通对象（`Date`、`Map` 等）与循环引用时抛错，满足 K1 写进 `RemoteLink.send` 的“无法编码时同步抛错”；解码失败返回原文交给 `parseFrame` 判为无效帧。WebSocket 链路两端（以后的 TUI）共用。

### 2. 路由的停止接纳与排空（内核 `router.ts`）

- `router.stopAdmission()`：之后的 hello 以 `stopping` 拒绝；`role: "client"` 成员的新请求与新订阅得到 `unavailable`（`detail` 说明服务端正在停止）。项目成员不受影响：K3 停止项目子实例时还要用 RPC 收口。
- `router.drain(signal) → Promise<"drained" | "deadline">`：等路由已接纳的在途请求（发往服务端或转发给其它实例）全部结算，或信号触发。
- `router.close()`：关闭全部成员链路。
- 三者都是幂等的；计数随请求结算递减，在 `#routeRequest` 与上游请求处统一登记，不另起第二条请求路径。

### 3. 服务端 RPC 端口（宿主 `packages/neuro-book/src/server/rpc/`）

- **启动参数**（`src/server/config.ts`）：`NBOOK_RPC_PORT`（缺省 0，由系统分配；浏览器经引导接口得知），`NBOOK_ALLOWED_ORIGINS`（逗号分隔的额外页面来源，给不由本进程 HTTP 端口提供页面的情形，即开发模式的 Vite 页面）。额外来源必须是回环地址上的 `http` 来源，否则按参数无效处理（未加载鉴权时的回环约束）。
- **监听**（`rpc/listener.ts`）：`startRpcListener({host, port, router, allowedOrigin(origin), ready})`，用 `Bun.serve` 的 `websocket` 处理器。只有 `GET /` 带升级头可升级，其余路径 404。升级前依次：
  1. 等运行实例就绪（经 HTTP 准入 `admission.admit()`，与页面资源同一道门）：启动失败或已停止接纳为 503。先等就绪再核对来源，因为 HTTP 端口为 0 时允许的来源要等 `nbook.http` 监听后才知道。
  2. `Origin` 核对：没有 `Origin` 头放行（浏览器的 WebSocket 握手总会带，网页无法省略；不带的只有本机非浏览器客户端，例如以后的 TUI）；带了就必须在允许集合里，否则 403。
  3. `server.upgrade(req, {data})`，`open` 时把链路交给 `router.accept(link)`。
  选项：`maxPayloadLength` 1 MiB（二进制走 HTTP 资源地址），`idleTimeout` 120 秒加 `sendPings`（Bun 发 ping，客户端不回应即断开，服务端由此发现失联客户端），不开压缩。
- **允许的来源**：`http://<别名>:<HTTP 端口>`，别名取 `127.0.0.1`、`localhost`、`[::1]`（HTTP 端口为 0 时按实际监听端口算），加上 `NBOOK_ALLOWED_ORIGINS`。比较前按 `new URL(origin).origin` 规范化。
- **链路**（`src/shared/rpc-socket.ts`，两端共用）：`createSocketLink({send(text), close()})` 把套接字包成 `RemoteLink`，宿主把收到的消息与关闭事件转进来；收发经第 1 节的 JSON 编解码；关闭通知只触发一次。服务端在 `rpc/listener.ts` 里接 Bun `ServerWebSocket`，浏览器在 `connection.ts` 里接 `WebSocket`。K2 不做发送背压。
- **装配**（`src/server/start.ts`）：建立服务端节点 `createRemoteNode({instance: {id: "server", kind: "server", role: "hub", project: null, client: null}, clock})` 与路由，清单的 `remote` 给它；RPC 监听先于插件装配与运行实例建立（插件装配要把端口交给引导接口；与 HTTP 一样先监听、请求等就绪），标准输出打印 `RPC listening on ws://...`。`RunningServer` 增加 `rpcUrl`。RPC 端口监听失败时还没有运行实例：写出致命诊断、抛出与插件装配失败同类的错误，进程以 1 退出；插件装配失败时先关闭已开的 RPC 监听。
- **引导接口**（`src/server/browser-bootstrap.ts`、`src/shared/browser-bootstrap.ts`）：响应增加 `rpc: {port, path}`；`BROWSER_PROTOCOL_VERSION` 升为 2（新外壳依赖这个字段，旧外壳遇到新服务端提示刷新）。浏览器用自己页面的主机名与协议（`ws`/`wss`）拼地址，所以 `localhost` 与 `127.0.0.1` 打开的页面各自得到与自己 `Origin` 一致的连接。
- **停止**（`start.ts` 的 `beforeStop`）：HTTP 排空与 RPC 排空并行：`router.stopAdmission()` 后 `router.drain()`，上限与 HTTP 相同（20 秒），超时记为停止步骤失败、退出码 1；运行实例停止之后 `router.close()` 并 `stop(true)` 关闭 RPC 监听。顺序与拓扑稿第 2 节一致，其中“停止项目子实例”归 K3。
- **开发模式**（`src/server/dev/`）：监督进程把 `NBOOK_RPC_PORT`（`NBOOK_DEV_RPC_PORT`，缺省 0）与 `NBOOK_ALLOWED_ORIGINS`（页面服务的实际来源，三个回环别名）传给后端子进程。页面经引导接口得知端口后**直连**后端 RPC 端口，不经 Vite 代理 WebSocket。理由：引导接口已经告知端口，直连少一道门；Vite 代理的门只能管 HTTP 请求，后端重启期间的升级仍会失败，客户端照样要靠重连。代价：与拓扑稿第 6 节“开发模式由 Vite 代理”不同，需要 `NBOOK_ALLOWED_ORIGINS`；后端每次重启对页面来说都是服务端重启（第 4 节）。

### 4. 浏览器连接（宿主 `packages/neuro-book/src/web/host/`）

- **连接对象**（`connection.ts`）：增加 `openRemote(endpoint: {port, path}) → Promise<RemoteLink>`，按页面协议与主机名连接，`open` 时完成；连接前失败抛 `ConnectionError`。浏览器 WebSocket 经第 3 节的共用链路适配包成链路。
- **客户端身份**（`client-identity.ts`）：`localStorage` 键 `nbook.client-identity` 存一个 UUID；存储不可用（隐私模式、被禁用）时退回本页随机值，读写包在 try/catch 里。
- **连接会话**（`remote-session.ts`）：`createRemoteSession({connection, node, clock, onState})` 管理首连与重连。
  - 首连属于窗口启动（下一条）。
  - 链路意外关闭：状态转 `offline`，按注入时钟退避重试（0.5、1、2、4、8 秒，之后每 10 秒）。每次重试先重新取引导（服务端重启后 RPC 端口可能变了），再 `openRemote`，再 `node.connect(link)`：成功转 `online`（K1 已重建订阅并发 `onResync`）；`server-restarted` 转 `server-restarted` 并停止重试；`wire-version` 转 `incompatible`；其它失败继续退避。
  - 窗口停止或 `pagehide` 时关闭链路、取消重试。
- **窗口**（`window.ts`）：启动序列变为：取引导 → 选插件 → 客户端身份 → 建立浏览器节点（`{id: instanceId, kind: "browser", role: "client", project: null, client}`）→ 首连 → 建立运行实例（清单带 `remote: node`）→ 启动 → ready。首连失败为 `connection-failed`（可原地重试，重试换新的 instanceId，沿用现有不变量），`wire-version` 为 `incompatible`。`ready` 状态增加 `connection: "online" | "offline"`；新增只能刷新的 `server-restarted`。`BrowserWindowOptions` 增加可选 `clock`。
- **界面**：`PageOutlet.vue` 在离线时显示一条横幅，根元素带 `data-rpc-state="online|offline"`；`FailurePage.vue` 增加 `server-restarted`（“服务端已重启”，只给刷新）。按 [UI 开发](../../../../skills/ui-development/SKILL.md) 与组件规范修改；两个组件目前没有同名 `.md`，按规范“下次修改时补齐”在本片补上；需要新组件时补 Lab 场景。

### 5. 真实浏览器验收用的探针（只在 `testing/`）

- 测试插件 `test.remote-probe`：
  - 共用合同 `src/shared/testing/remote-probe-contract.ts`（服务端测试插件与浏览器测试入口都要引用，放在 `shared/`）：方法 `echo`（读，返回调用方身份）、`hold`（写，等测试放行；记录收到的终止信号）；事件 `ticks`。S3 的服务端停止测试已先用上它。
  - 服务端入口加进 `src/server/testing/test-plugins.ts`，并给 `http.routes` 贡献控制路由：推一次 `ticks`、放行 `hold`、读各 `hold` 的结局。
  - 浏览器入口 `src/web/testing/remote-probe.ts` 在激活时把 `window.__nbRemoteProbe` 挂上去（调用、订阅，以及收到的事件、`onResync`、`onEnd` 计数），供 Playwright 读取。
- 测试外壳：`src/web/testing/e2e.html` 与 `e2e-main.ts`，经 `createBrowserWindow({builtin, factories})`（现有的测试注入口）加入探针插件；`vite.e2e.config.ts` 构建到 `dist-e2e/web`（加入 git 忽略）。产品的 `dist/web` 不变，`check:dist` 照旧。
- e2e 夹具（`e2e/fixtures.ts`）：`startProbeServer` 运行 `src/server/testing/fixture-entry.ts`，带 `NBOOK_TEST_PLUGINS=test.remote-probe`、`NBOOK_WEB_ROOT=dist-e2e/web`；`fixture-entry.ts` 的清单加入探针描述，引导接口才会列出它的浏览器入口。需要固定端口的用例（服务端重启）由夹具先取一个空闲端口。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/runtime/plugin-channel.md` | WebSocket 传输：JSON 编解码与编码失败；`Origin` 策略；握手字段（客户端身份，不带插件版本）；先核对 wire 版本、`reject` 形状冻结；welcome 的 `boot` 与服务端重启后客户端必须重启；同一实例重连接管；路由停止接纳、排空与关闭；协议违规关闭链路；开发模式直连。保持 `planned` |
| `docs/specs/runtime/server-host.md` | 启动参数 `NBOOK_RPC_PORT`、`NBOOK_ALLOWED_ORIGINS`；启动序列加 RPC 监听与 `RPC listening on`；握手等就绪；停止序列加停止接纳与 RPC 排空（与 HTTP 排空并行）、插件关闭后关 RPC；开发模式传端口与来源、页面直连；RPC 端口被占用即启动失败；新增验收场景。新条目标“随 t53 实现” |
| `docs/specs/runtime/browser-host.md` | 连接对象承载 RPC 链路；启动序列加首连；`offline`、`server-restarted` 状态与重连规则；客户端身份；场景 6 先实现离线与重连部分；引导协议版本 2。保持 `planned` |
| `docs/specs/runtime/api-docs.md` | 按拓扑稿：只覆盖显式对外的 HTTP 贡献，去掉由插件合同生成的 `http.endpoints` 端点 |
| `docs/specs/runtime/plugin-hot-plug.md` | 窗口同步改为经远程服务的订阅，不再写“事件流” |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 4 份 Spec 与 README 注册表 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 1 节 | 握手字段、wire 先核对、`boot` 与重启识别、重连接管、协议违规、JSON 编解码 | `bun run --cwd packages/nb-runtime typecheck`、`bun run --cwd packages/nb-runtime test`、`bun run --cwd packages/neuro-book typecheck` |
| S2 | 第 2 节 | 路由停止接纳、排空、关闭 | 同 S1 |
| S3 | 第 3 节（开发模式除外） | 启动参数、RPC 监听与 `Origin`、装配、引导接口、停止序列 | 同 S1，另 `bun run --cwd packages/neuro-book test:bun` |
| S4 | 第 3 节开发模式 | 监督进程传端口与来源 | 同 S3 |
| S5 | 第 4 节（界面除外） | 连接对象、链路、客户端身份、连接会话、窗口 | 同 S3 |
| S6 | 第 4 节界面 | 离线横幅与 `server-restarted` 页 | 同 S3，另 `bun run --cwd packages/neuro-book test:vitest` |
| S7 | 第 5 节 | 探针、测试外壳、e2e | `bun run --cwd packages/neuro-book test:e2e` |
| S8 | — | Spec 实现合同与证据、Task 证据、omp 审查与修正 | `bun run test:affected --typecheck`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 测试 |
|---|---|
| hello 带客户端身份；wire 不同的 hello（即使其余字段是另一版本的形状）得到 `wire-version` 拒绝；welcome 带 `boot` | `packages/nb-runtime/src/remote/protocol.test.ts`、`routing.test.ts` 增补 |
| 同一 `boot` 重连：订阅重建并 `onResync`；不同 `boot`：订阅以 `server-restarted` 结束、不重建，`connect` 返回 `server-restarted`，之后调用为 `unavailable` | `routing.test.ts` 增补（两个路由模拟两次服务端进程） |
| 同一实例重连接管旧链路，旧链路上的写请求为 `unknown-outcome`；描述不一致仍为 `duplicate-instance` | `routing.test.ts` 增补 |
| 握手前的业务帧与无法解析的帧使链路关闭并留诊断 | `routing.test.ts` 增补 |
| 停止接纳后新 hello 以 `stopping` 拒绝、客户端新请求为 `unavailable`、项目成员不受影响；排空等在途请求，截止返回 `deadline`；关闭断开全部成员 | `routing.test.ts` 增补（复用其中的四实例拓扑；截止由测试的 `AbortController` 触发，宿主用注入时钟产生这个信号） |
| JSON 编码遇函数、symbol、bigint、非有限数抛错；`Peer` 据此按阶段结算 | `packages/nb-runtime/src/remote/json-codec.test.ts`（新） |
| 带不允许 `Origin` 的升级 403；没有 `Origin` 放行；允许集合含 HTTP 端口的三个回环别名与 `NBOOK_ALLOWED_ORIGINS`；非 `/` 路径 404；非回环的额外来源是参数错误 | `packages/neuro-book/src/server/rpc/listener.test.ts`（新，真实 Bun 服务与 WebSocket 客户端）、`config.test.ts` 增补 |
| 就绪前的升级等待、启动失败为 503；RPC 端口被占用以 1 退出 | `listener.test.ts`、`server.test.ts` 增补 |
| 停止：新升级 503、在途请求完成后插件才关闭、排空超时退出码 1、停止后 RPC 端口不再接受连接 | `server.test.ts` 增补（同进程与真实子进程） |
| 引导响应带 `rpc` 与协议版本 2 | `src/server/browser-bootstrap.test.ts` 增补 |
| 开发模式后端收到 RPC 端口与页面来源，页面能连上 | `src/server/dev/run.test.ts` 增补；`e2e/dev.e2e.ts` 增补一条连上的检查 |
| 窗口：首连成功后 ready 且 `online`；首连失败 `connection-failed` 可重试；`wire-version` 为 `incompatible`；链路断开转 `offline`、退避重连后 `online` 并 `onResync`；服务端换进程后转 `server-restarted` 且不再重试；停止窗口关闭链路 | `src/web/host/window.test.ts` 增补（同进程真实后端、Bun WebSocket、注入时钟）、`remote-session.test.ts`（新） |
| 客户端身份跨两次窗口启动不变；存储不可用时退回本页随机值 | `src/web/host/client-identity.test.ts`（新） |
| 离线横幅与 `data-rpc-state`；`server-restarted` 页只有刷新 | `src/web/mount.dom.test.ts`、`FailurePage.dom.test.ts` 增补 |
| 真实 Chrome：连上后远程调用拿到本页实例身份；外站页面连不上 RPC 端口；断开后离线横幅出现、重连后消失，订阅收到 `onResync` 且之后的事件到达；刷新页面后旧页的 `hold` 收到终止、新页是新实例；mock 服务端回 `wire-version` 时显示版本不一致页；服务端换进程后显示服务端已重启页 | `e2e/rpc.e2e.ts`（新；断开与 mock 用 Playwright 的 `routeWebSocket`，外站页面用 `page.route` 伪造来源） |
| 打包产物上 RPC 握手可用 | `scripts/smoke-server.ts` 增补一次 Bun WebSocket 握手 |

## 验证

- 每片：上表的自跑命令；类型改动影响新应用时跑 neuro-book `typecheck`。
- 收口：`bun run test:affected --typecheck`、`bun run --cwd packages/neuro-book test:e2e`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check`；对验收映射的每条判据做变异检查。
- 端到端：`e2e/rpc.e2e.ts` 用测试外壳与真实子进程服务端，在本机 Chrome 里走完“取引导 → 连 RPC 端口 → 浏览器插件远程调用服务端插件 → 断开重连 → 刷新 → 服务端换进程”。
- 未验证的边界（留给后续）：项目绑定、超过宽限期的重连与服务端停止项目子实例（K3）；TUI 客户端；鉴权、Cookie 与 wss/TLS；反向代理；Windows。

## 不做与风险

- **不做**：项目绑定与租约（K3）；TUI 宿主；鉴权与 Cookie；wss 与证书；Vite 的 WebSocket 代理；应用层心跳（服务端靠 Bun 的 ping 发现失联，客户端靠关闭事件）；发送背压；浏览器诊断经 RPC 汇到服务端；插件集合变化的事件（随热插拔）。
- **风险**：
  - 开发模式下每次改后端文件，已打开的页面都会进入“服务端已重启”，需要刷新（开发者已接受）。
  - 没有 `Origin` 的连接放行，意味着本机任何进程都能连 RPC 端口；与未加载鉴权时的 HTTP 端口同等信任，鉴权上线时要一并收紧。
  - Bun 的 `send` 背压不处理：本机回环下风险低，大量事件推送时可能堆积内存，记入已知限制。
  - `routeWebSocket` 若不能稳定制造断开，e2e 改为由探针的控制路由让服务端关闭该页的连接（需要宿主给测试插件一个关闭连接的入口，届时先改计划）。

## 开发者已确认（2026-10-07）

1. **`Origin` 策略**：没有 `Origin` 的连接放行（给以后的 TUI 等非浏览器客户端）；带 `Origin` 的必须是本进程 HTTP 端口的回环来源或 `NBOOK_ALLOWED_ORIGINS` 列出的来源。
2. **服务端重启后**：页面显示“服务端已重启”、由用户点刷新，不自动刷新；开发模式改后端文件也会出现这一页。
3. **开发模式直连**：页面经引导接口得知端口、直连后端 RPC 端口，不经 Vite 代理 WebSocket（与拓扑稿第 6 节不同）。
4. **握手字段**：hello 带客户端身份（`localStorage` 里的稳定标识，供 K4 的 `local` 分区），不带各插件版本；RPC 端口缺省由系统分配，浏览器经引导接口得知。
