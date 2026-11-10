# t02 实施计划：把两端宿主的通用部分与模型服务抽成包

## Context

NeuroBot（[提案](../../../../../docs/proposals/neurobot.md) 第三节、第四节第 2、3、10 小节）是第二个建在 nb-runtime 上的应用。开发者 2026-11-10 选了提案第二稿待定项 1 的 (b)：仍在 NeuroBook 应用里、NeuroBot 也要的部分，只把安全攸关、已经调好的抽成包两边共用；设置、存储、Agent 接线、网页对话宿主 NeuroBot 自己写。同日开发者同意另写 ADR 把 [ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md) 决策 2 的搬包条件改为“出现第二个需要第三方插件的应用”。

要解决的问题：

- 只许监听回环、`Host` 421、`Origin` 403、状态根认领这几条安全规则（[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)）现在只有 NeuroBook 一份实现，NeuroBot 第一版必须满足同样的规则并有验收（提案第四节第 10 小节）。照抄一份，两边会分叉。
- 启动与停止的顺序（RPC 监听先于插件装配、升级先过门再核对来源、两路排空、退出码一次算出）是调过多轮的，NeuroBot 要同一套。
- 模型服务（`nbook.models` 的 `core.ts`）NeuroBot 也要，但它读的是 NeuroBook 的设置服务。

期望结果：新包 `packages/nb-host` 拿到两端宿主与 HTTP 中与应用无关的部分，nb-harness 的 `./models` 拿到模型服务的通用部分；NeuroBook 只剩装配与自己的配置。NeuroBook 用户可观察的行为、配置、环境变量、诊断事件名与 HTTP 错误码都不变。

依据：[ADR 0023](../../../../../docs/adr/0023-v2-frontend-backend-stack.md)（Bun、Hono、TypeBox）、[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)（RPC 端口与拓扑）、[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（工作区包以源码发布，决定 6：其它包要发布时另定）、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)（内核与应用无关、应用名由档案传入、扫描测试守住）、[ADR 0033](../../../../../docs/adr/0033-app-delivered-as-built-npm-package.md)（应用发构建产物）、[`monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)（迁移不留旧路径别名与转发）、[`packages/AGENTS.md`](../../../../../packages/AGENTS.md)（exports 与包名变化先记为跨模块决策）。

与其它工作的关系：模型服务部分建在 [w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/plan.md) 之上（它把 `models/shared/rules.ts`、`compaction.ts` 与选择顺序 `modelChoice` 搬进 `@notnotype/nb-harness/models/rules`，并给 nb-harness 加“不导入 `@notnotype/nb-runtime`”的扫描），排在 t32 合入之后；本计划不重复搬那部分。两端宿主与 HTTP 不碰 t32 与 t14 的文件，可以先做。

工作方式与约束：

- 代码在 Work 分支 `feat/w00043-neurobot`（worktree `.worktree/w00043-neurobot`，开工时用 `/usr/bin/git worktree add` 建）；ADR、Spec、Task 记录在主工作区 master 上改。
- 行为不变的搬家：搬过去的代码、诊断文字（现有中文诊断不顺手改成英文，[`common.md`](../../../../../docs/standards/code/common.md)）与错误码原样保留；每片搬完就删旧文件、改完全部调用方，不留转发的旧入口。
- `implementation-planning` 要求的“独立设计”这次没有派子代理（派发说明不许开），请审查时一并补上。

## 技术选型

| 通用问题 | 选用 | 理由；否决 |
|---|---|---|
| 认领锁（`server.claim.lock`，只在认领的几毫秒里持有） | `proper-lockfile` 4.1.2（应用已依赖，根 `patchedDependencies` 有补丁），nb-host 里一个只做取锁与放锁的私有模块，参数与现在的 `holdLock` 相同（`stale` 10 秒、约 3 秒的退避） | 认领只用到 `holdLock` 的取与放，不用 `stillHeld`；锁文件只有认领一个使用者，参数一致的要求只针对同一把锁。否决把 `holdLock` 整个搬进 nb-host：它是 Files、设置、canon 共用的加锁替换工具，归宿主包不对，还要改 20 多个消费者 |
| 宿主自有接口的路由（`/api/runtime/health` 与宿主路由） | Hono（应用已依赖 `^4.12.30`，ADR 0023） | 现有实现就用它；不手写 |
| 包内类型检查分前后端 | 照 nb-runtime：`tsconfig.json`（Bun 类型）加 `tsconfig.browser.json`（DOM 库、无 Bun 类型，只含 `src/web/`、`src/shared/`） | 现成写法 |

没有用库替换手写实现的地方，不需要对照测试切片。

## 关键设计

### 通用与应用专有的划分

逐块判断（行数是非测试代码，估算）：

| 现在的位置 | 去向 | 理由 |
|---|---|---|
| `src/server/host.ts`（162） | nb-host `server/host.ts` | 停止来源汇合、`beforeStop`、监听的挂接与移除，与应用无关；项目子进程（`src/project/start.ts`）也用它 |
| `src/server/instance.ts`（301） | nb-host `server/claim.ts`；应用留认领档案 | 认领协议与锁是安全不变量；套接字名前缀 `nbook-`、版本、应答里的 `plugins` 字段归应用 |
| `src/server/ports.ts`（68） | nb-host `server/ports.ts` | 成组顺延；开发监督进程也用 |
| `src/server/rpc/listener.ts`（105） | nb-host `server/rpc-listener.ts` | RPC 端口的门、来源、路径、消息上限 |
| `src/server/config.ts` 的回环与来源校验、`loopbackOrigins`（约 50） | nb-host `server/loopback.ts` | 安全规则；`NBOOK_*` 的读取、缺省端口 4217/4218、项目时限留应用 |
| `src/server/start.ts`（462）的诊断存储、准入、远程节点与路由、RPC 监听与顺延、来源判定、排空、退出码、认领的发布与放下（约 260） | nb-host `server/start.ts` 的 `startHostServer` | 已调好的启动与停止顺序 |
| `start.ts` 其余：插件平台（`prepared`、`plugin-inventory`）、项目管理器、`userDirectories`、`startupEnv`、`devTask`、平台档案 | 留应用 `src/server/start.ts`，作为装配者 | NeuroBook 专有 |
| `src/plugins/http/backend/`（admission 153、dispatch 230、static 109、plugin 94）与 `shared/contracts.ts`（37） | nb-host `http/` | 准入、分发、`Host` 与 `Origin` 核对、页面资源、`http.routes` 合同 |
| `src/plugins/http/plugin.ts`（描述 `nbook.http`） | 留应用 | 插件 id 与版本是应用的 |
| `src/shared/rpc-socket.ts`（85） | nb-host `shared/socket.ts` | 两端共用的套接字链路 |
| `src/web/host/browser-host.ts`（93） | nb-host `web/browser-host.ts` | 浏览器一侧的内核实例 |
| `src/web/host/remote-session.ts`（189） | nb-host `web/remote-session.ts`，端点刷新改为注入 | 首连、退避重连、终态判定 |
| `src/web/host/connection.ts` 的 `openRemote`（约 35） | nb-host `web/rpc-socket.ts` 的 `openRpcSocket` | 拼地址、打开 WebSocket、交出链路 |
| `src/web/host/client-identity.ts`（46） | nb-host `web/client-identity.ts`，存储键由应用传 | 握手带的客户端身份 |
| `src/plugins/models/backend/core.ts`（555）的快照、解析、串行写入、读改写、检测、发现 | nb-harness `models/service.ts`（t32 之后） | 见下文模型一节 |
| `core.ts` 的远程实现 `remote()`、`modelsKey`、远程合同 `nbook.models/settings`、设置项定义与设置页 | 留应用 | 合同 id 与设置归应用；nb-harness 不导入 nb-runtime（t32 的扫描） |
| 开发监督进程 `src/server/dev/`、项目 `src/server/projects/` 与 `src/project/`、`plugin-platform`、命令行 `src/cli/`、`process.ts`、`plugins.ts`、`browser-bootstrap.ts`、`plugin-files.ts`、`user-directories.ts`、`startup-env.ts`、`omp-process.ts` | 留应用 | 开发者 2026-11-10 的划分；`startup-env.ts`、`omp-process.ts` 必须是每个入口的前两条导入，包替入口做不了这件事 |
| `src/web/` 的 `window.ts`、`boot.ts`、`mount.ts`、路由、宿主页、`browser-bootstrap` 协议、`connection.ts` 的 `bootstrap` 与 `catalog`、插件装配、文字引擎、Lab | 留应用 | 书架、工作台、插件集合、消息目录都是 NeuroBook 的 |

合计约 1,700 行进 nb-host（其中约 950 行出自 `src/server/`），约 400 行进 nb-harness。

### `packages/nb-host/`：包骨架

新包 `@notnotype/nb-host`，`private: true`，许可证同仓库，`engines.bun` 同 nb-runtime。目录与子路径：

| 子路径 | 文件 | 运行位置 | 依赖 |
|---|---|---|---|
| `./server` | `src/server/index.ts`（`claim.ts`、`claim-lock.ts`、`host.ts`、`loopback.ts`、`ports.ts`、`rpc-listener.ts`、`start.ts`） | Bun | nb-runtime、typebox、proper-lockfile、`node:*` |
| `./http` | `src/http/index.ts`（`admission.ts`、`dispatch.ts`、`static.ts`、`plugin.ts`） | Bun | nb-runtime、hono |
| `./http/contracts` | `src/http/contracts.ts` | 不限 | 无 |
| `./socket` | `src/shared/socket.ts` | 不限 | nb-runtime `./remote` |
| `./web` | `src/web/index.ts`（`browser-host.ts`、`remote-session.ts`、`rpc-socket.ts`、`client-identity.ts`） | 浏览器 | nb-runtime |
| `./testing` | `src/testing/index.ts`（现在应用 `src/server/testing/` 的 `rpc-client.ts`、`tcp-proxy.ts`） | Bun，只给测试 | 同 `./server` |

- 浏览器目录叫 `web/`：应用开发监督进程的后端文件判定（`src/server/dev/watch.ts` 的 `isBackendFile`）按路径段 `web` 排除前端文件，改 nb-host 的浏览器代码不会触发后端重启。
- `package.json`：`dependencies` 为 `@notnotype/nb-runtime`（`workspace:^`）、`typebox`、`hono`、`proper-lockfile`（4.1.2，与根一致）；`devDependencies` 为 `@types/bun`、`typescript`、`@notnotype/neuro-book-test-support`；`files` 白名单同 nb-runtime（不发测试）。`proper-lockfile` 没有官方类型包，应用自带 `src/types/proper-lockfile.d.ts`，nb-host 照它放一份只含 `lock` 的声明。
- 脚本：`test` 为 `bun test`；`typecheck` 为 `tsc --noEmit && tsc --noEmit -p tsconfig.browser.json`。
- `AGENTS.md`（引用 `../../AGENTS.md`）与 `README.md`：职责、子路径、“应用名一律由宿主传入”、验证命令。
- `src/architecture.test.ts`：
  - 照 `packages/nb-runtime/src/app-neutral.test.ts`：非测试源码（含注释）不出现 `/nbook|neurobook/i`；导入说明符不以 `nbook/`、`@notnotype/neuro-book` 开头。
  - 分层：`web/` 与 `shared/` 不导入 `node:*`、`bun`、`hono`、`proper-lockfile` 与 `../server`、`../http`；`http/contracts.ts` 没有任何运行时导入；`server/`、`http/` 不导入 `../web`。每条规则带一个反例，证明规则能拦下违规（同应用 `architecture.test.ts` 的写法）。

### `packages/nb-host/src/server/loopback.ts`：回环与来源

```ts
export const LOOPBACK_HOSTS: ReadonlySet<string>;          // 监听地址：127.0.0.1、::1、localhost
export const LOOPBACK_ORIGIN_HOSTS: ReadonlySet<string>;   // URL.hostname 写法：127.0.0.1、localhost、[::1]
export class HostConfigError extends Error { readonly code: "non-loopback-host" | "invalid-origin" }
/** 不是回环地址就抛；`label` 是诊断里说明来源的写法（应用传 `NBOOK_HOST=…`）。 */
export function assertLoopbackHost(host: string, label: string): void;
/** 逗号分隔的额外来源，每项必须是回环主机上的 http 来源；返回规范化的来源。 */
export function parseAllowedOrigins(value: string | undefined, label: string): string[];
export function loopbackOrigins(pageUrl: string): string[];
```

- 应用的 `readServerConfig` 用这几个函数读 `NBOOK_HOST`、`NBOOK_ALLOWED_ORIGINS`，错误文字与现在逐字相同（`label` 带变量名），`ServerConfigError` 的码不变（应用把 `HostConfigError` 的码原样转成 `ServerConfigError`）。
- 不变量（第二道）：`startRpcListener` 与 HTTP 插件在调 `Bun.serve` 之前各自 `assertLoopbackHost`；`startHostServer` 在监听任何端口之前核对 `allowedOrigins` 每一项都是回环 http 来源。这样“只许监听回环”不靠应用解析环境变量时没漏，NeuroBot 也逃不掉。NeuroBook 的观察行为不变：非法值仍先在读配置时以 `runtime.config.invalid` 退出。鉴权插件上线时这里加放行条件，现在没有。

### `packages/nb-host/src/server/claim.ts`、`claim-lock.ts`：状态根认领

搬 `instance.ts` 的全部逻辑（地址、锁、hello 协议、残留套接字、0600、只删自己建的文件），改三处由宿主传入：

```ts
export interface ClaimProfile<E extends TProperties> {
    /** 运行时目录与 Windows 命名管道的名字前缀（NeuroBook 是 "nbook"）。 */
    readonly socketPrefix: string;
    readonly version: string;
    /** 应答里应用自己的字段（就绪前为 null）；读者按 基础字段 + 这些字段 完整校验。 */
    readonly fields: E;
}
claimStateRoot(options: {stateRoot, kind, report, profile}): Promise<ClaimResult<Info>>;
queryInstance(stateRoot, profile, timeoutMs?): Promise<InstanceQuery<Info>>;
instanceAddress(stateRoot, socketPrefix): Promise<string>;
StateRootClaim.publish({url, rpcUrl, extra}): void;   // extra 是应用字段的值
```

- 基础字段 `{schema: 1, pid, version, kind, status, url, rpcUrl}` 与 `kind` 的三个取值不变；`schema` 仍是 1，NeuroBook 的应答形状与现在逐字段相同（`plugins` 由应用档案给出 schema，`NotLoadedSchema` 留在应用）。
- 文件名 `server.sock`、`server.claim.lock`、`HELLO_TIMEOUT_MS`、1 MB 上限、100 字节路径上限是协议的一部分，留在包里不参数化。
- 应用 `src/server/instance.ts` 变成 NeuroBook 的认领档案：`NBOOK_CLAIM`（前缀 `nbook`、`PRODUCT_VERSION`、`plugins` 字段）与绑定档案的 `claimNeuroBook`、`queryNeuroBook`、`InstanceInfo` 类型；`cli/start.ts`、`cli/plugin.ts`、`process.ts`、`testing/claimed-server.ts`、`testing/fixture-entry.ts` 改用它们。这是应用的配置，不是转发旧入口。
- `reportClaimFailure` 与 `claimReport` 留在应用 `process.ts`（写致命行与事件名 `runtime.state-root.*`，事件名不变）。

### `packages/nb-host/src/server/start.ts`：`startHostServer`

```ts
export interface HostServerOptions {
    readonly product: {readonly name: string};          // 503 文案里的产品名（NeuroBook 传 "NeuroBook"，文字不变）
    readonly platform: PluginPlatform;                    // 必填：漏传时内置插件的跨命名空间贡献被拒且没有类型错误（应用 application.ts 头注释）
    readonly listen: {host, port, rpcPort, shiftPorts, allowedOrigins};
    readonly claim: StateRootClaim;
    readonly plugins: (context: HostPluginContext) => ReadonlyArray<PluginDefinition>;
    readonly capabilities?: ReadonlyArray<CapabilityProvider>;
    readonly requiredPlugins?: (plugins: ReadonlyArray<PluginDefinition>) => ReadonlyArray<string>;  // 缺省全部
    readonly backgroundStartupPlugins?: ReadonlyArray<string>;
    readonly satisfies?: ApplicationManifest["satisfies"];
    readonly router?: Pick<RemoteRouterOptions, "bindProject" | "projectAccess">;
    readonly extensions?: ReadonlyArray<HostServerExtension>;
    readonly readyInfo?: () => unknown;                   // 就绪时随 claim.publish 发布的应用字段
    readonly process?, signals?, stopInput?, clock?, onListening?, onRpcListening?, writeFatal?;
}
export interface HostPluginContext { store, admission, rpc: {port, path}, allowOrigin, onListening, listen }
export interface HostServerExtension {
    /** 运行实例建立之后、同一同步段里调用（项目管理器以运行实例为父，在这里建）。 */
    attach?(application: Application): void;
    /** 运行实例可用时调用。 */
    ready?(): void;
    /** 停止开头的同步段里按顺序调用，先于两路排空开始；返回的 Promise 与排空并行等待。 */
    stopping?(): void | Promise<void>;
    /** 停止结算后读；非空即停止不完整，退出码 1。 */
    problems?(): ReadonlyArray<string>;
}
export interface HostServer { application, ready, stopped, url, rpcUrl, requestStop(source) }
export class ServerAssemblyError, ServerStartupError;   // 原样搬
```

要守住的顺序与时序（都读过 `start.ts`、`rpc/listener.ts` 的实现与 Spec 的实现合同确认）：

- RPC 监听先于插件装配（引导接口要实际端口）；监听或顺延失败、插件装配失败时写致命诊断、放下认领、抛 `ServerAssemblyError`，此时没有运行实例要关。
- 升级先过准入的门，再核对 `Origin`；`allowOrigin` 读的 HTTP 地址在 HTTP 插件 `onListening` 时才有，端口为 0 时顺序反了会拒掉本页。
- 停止：`claim.stopping()` → 各扩展的 `stopping()`（同步段）→ 同一同步段里 `router.stopAdmission()` 与 `admission.drain()` 开始 → 两路排空各 20 秒、用同一个注入时钟 → 内核停止 → 插件全部关闭后才 `router.close()`、`rpc.stop()` → 等启动结果确定再算退出码 → 最后 `claim.release()`。
- 启动失败两次通知：紧急报告时就让等待中的请求得到 503，启动结果到达时只在还没报告过时补报，再写 `runtime.startup.causes`。
- 退出码按 75 > 1 > 0 一处算出；扩展的 `problems()` 并进停止失败。

NeuroBook 的 `src/server/start.ts` 改成装配者：读 `prepared` 与插件平台，拼能力表（`stateRootKey`、`startupEnvKey`、`userDirectoriesKey`、`clockKey`、`plugin-inventory`、`projectsKey`），给两个扩展（顺序与现在相同：开发任务在前、项目管理器在后；项目管理器在 `attach` 里建、`projectsKey` 的 `create` 等它），`router` 接项目管理器的 `bind` 与 `access`，`readyInfo` 交出第三方插件集合。`startServer` 的选项与 `RunningServer` 形状不变，应用里调用它的测试与入口不用改。

### `packages/nb-host/src/http/`：HTTP 插件

- `admission.ts`、`dispatch.ts`、`static.ts` 原样搬；`HttpAdmissionRejected` 的消息里的产品名从选项来（文字不变）。
- `plugin.ts`：`createHttpPlugin({id, productName, admission, host, port, onListening, allowOrigin, hostRoutes?, staticRoot?})`，`id` 由应用传（NeuroBook 传描述里的 `nbook.http`）；诊断的 `source.plugin` 用这个 id，事件名 `http.listening`、`http.request.failed`、`http.request.aborted` 不变。
- `contracts.ts`：`HTTP_ROUTES_POINT`、`HttpRouteEnv`、`HttpRouteHandler`、`rethrowRouteError`。12 个应用文件（`files`、`projects`、`agent` 的后端，`server/testing/test-plugins.ts` 与几份测试）改从 `@notnotype/nb-host/http/contracts` 导入；`files/theme-asset-route.test.ts` 用的 `createDispatcher`、`RouteTable`、`HttpAdmission` 从 `./http` 取；`architecture.test.ts` 里以 `nbook/plugins/http/backend/dispatch` 为例的反例换成 `@notnotype/nb-host/server`。
- 应用 `src/plugins/http/` 只剩 `plugin.ts`（描述），`server/plugins.ts` 的 `serverHostPlugins["nbook.http"]` 调 nb-host 的工厂。`packages/neuro-book/AGENTS.md`“后端”一节与 `architecture.test.ts` 的 Hono 规则（`.onError(rethrowRouteError)`）跟着改说法，规则本身不变。

### `packages/nb-host/src/shared/socket.ts`、`src/web/`：浏览器宿主

- `socket.ts`：`createSocketLink`、`RPC_PATH`、`RPC_MAX_MESSAGE_BYTES` 原样搬；应用里导入它的文件改导入（含 `plugins/canon/shared/contracts.ts`、`plugins/files/shared/contracts.ts` 的消息上限与 `server/projects/` 的进程间链路）。
- `browser-host.ts`：`BrowserRuntimeHost.start({instanceId, client?, manifest, page, emergency, stopTimeoutMs?, platform})`，`platform` 必填，内部调内核的 `createApplication`。应用的 `architecture.test.ts` 有“装配运行实例一律经 `nbook/application`”的检查（`KERNEL_CREATE`），它只扫应用源码，nb-host 内调内核不受影响；包里由必填的 `platform` 守住同一件事。`src/application.ts` 在两个适配器搬走后仍有消费者（`server/testing/projects.ts`、`plugin-sdk/examples/testing/stage.ts` 与几份测试），保留，那条检查也不变。
- `remote-session.ts`：`createRemoteSession({openRemote, refreshEndpoint, node, clock, onState, onRetryFailed?})`。`refreshEndpoint(): Promise<RpcEndpoint | "incompatible" | {readonly retry: string}>` 由应用实现（NeuroBook 取引导、核协议版本、校验 `BrowserBootstrapSchema`，与现在的 `refreshEndpoint` 同一段代码）；退避间隔、终态（`server-restarted`、`project-gone`、`incompatible`）与首连的结果形状不变。
- `rpc-socket.ts`：`openRpcSocket(baseUrl, endpoint): Promise<RemoteLink>` 与 `ConnectionError`；应用的 `connection.ts` 的 `openRemote` 调它，`bootstrap`、`catalog` 留在应用。
- `client-identity.ts`：`readClientIdentity(key, storage)`。应用的 `src/web/host/client-identity.ts` 留下键 `CLIENT_IDENTITY_KEY = "nbook.client-identity"` 与一行包装（e2e 有 8 个文件从这里取键，不用改）。

### `packages/nb-harness/src/models/`：模型服务（t32 合入之后）

开工前重读 t32 合入后 `./models/rules` 的实际导出，以它为准；下面写的形状若与之冲突，以 t32 为准并改本节。

- 新文件 `models/schema.ts`，新子路径 `./models/schema`（只引 `typebox`，浏览器可用）：配置形状 `ModelConfigSchema`、`ProviderConfigSchema`、`RoleConfigSchema`、`ProvidersSchema`、`RolesSchema`、`PROVIDER_ID`；快照与结果形状 `KeyStatusSchema`、`SnapshotModelSchema`、`SnapshotProviderSchema`、`RoleStatusSchema`、`SnapshotRoleSchema`、`ModelsSnapshotSchema`、`CatalogProviderSchema`、`CatalogModelSchema`、`DiscoveredSchema`、`CheckResultSchema`。`CompactionSettingSchema` 已由 t32 放进 `rules.ts`，这里引用它。
- 新文件 `models/service.ts`，从 `./models` 导出（已是服务端入口，引 OMP）：

```ts
/** 宿主的配置存储：读当前值、对可写那一层带 expect 写回。NeuroBook 用设置服务实现，NeuroBot 用自己的设置。 */
export interface ModelsConfigStore {
    providers(): readonly ProviderConfig[];
    roles(): RolesConfig;
    compaction(): CompactionSetting;
    stream(): {readonly firstEventTimeoutSeconds: number; readonly idleTimeoutSeconds: number};
    onDidChange(listener: (keys: ReadonlySet<"providers" | "roles" | "compaction">) => void): () => void;
    /** 可写那一层的当前值；层不可用时给出原因码（映射成 settings-unavailable）。 */
    editable(key: "providers" | "roles"): {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string};
    write(key: "providers" | "roles", next: unknown, expect: unknown): Promise<{readonly ok: true} | {readonly ok: false; readonly code: "conflict" | "invalid-value" | (string & {}); readonly detail: string}>;
}
export function createModelService(options: {
    readonly config: ModelsConfigStore;
    readonly credentials: CredentialStore;
    readonly env: StartupEnv;
    readonly roles: {readonly builtin: ReadonlyArray<Pick<RoleConfig, "id" | "axis">>; readonly defaults: RolesConfig};
    readonly record: (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}): ModelService;
export interface ModelService {
    port(profileDefaults?: (profile: string) => ProfileModelDefaults): ModelPort;
    snapshot(): ModelsSnapshot;
    onChange(listener: () => void): () => void;
    // 与远程合同同名、同形状的操作，结果 {ok: true, value} | {ok: false, code, detail}
    catalogProviders(); catalogModels(input); addProvider(input); updateProvider(input); removeProvider(input);
    upsertModel(input); removeModel(input); setModels(input); setRole(input); addRole(input); updateRole(input); removeRole(input);
    setKey(input); clearKey(input); discover(input, signal); check(input, signal); checkAll(input, signal);
    close(): Promise<void>;
}
```

- 搬的是 `core.ts` 里除 `remote()` 外的全部：快照与解析缓存、`resolve`（按 t32 的 `modelChoice`）、串行队列、`mutate` 的读改写与冲突后等变化（`CATCH_UP_MS`）、`stored`、`incomplete`、`unbind`、`setKey` 两步与 `partially-applied`、检测与发现。诊断事件名（`models.catalog.missing`、`models.credentials.failed`）不变。
- 内置角色与缺省角色表由宿主传（t32 已定 `BUILTIN_ROLES` 的轴与顺序留在应用）。
- NeuroBot 要在设置里配“压缩”角色与缓存寿命（提案第四节第 4、8 小节），本 Task 不实现，接口不堵死：“压缩”是角色表里的一项，NeuroBot 的缺省角色表带上它即可；缓存寿命以后作为服务商配置的可选字段加进 `ProviderConfigSchema` 并经 `ModelTarget` 交给内核，形状归 nb-harness，`ModelsConfigStore` 交的是整份配置对象，不用改接口。
- 应用 `src/plugins/models/backend/core.ts` 只剩两件事：`settingsModelsConfig(settings)`（用 `get`、`inspect(...).user`、`update(..., {expect})`、`onDidChange` 实现存储接口，层状态的映射与现在逐条相同）与 `modelsRemote(service)`（`RemoteImplementation`、`eventSource` 推 `changed`，每个方法转给服务）。`modelsKey`、`ModelsService` 类型、远程合同的方法表与 id `nbook.models/settings`、`shared/settings.ts` 的 `defineSettings`、分区 id、`BUILTIN_ROLES`、`DEFAULT_ROLES` 与文字留在应用，形状从 `./models/schema` 取。
- nb-harness 不导入 nb-runtime（t32 的扫描照常通过）。

## Spec 与文档改动

行为合同不变，只改 owner、实现合同与证据（[`docs/specs/README.md`](../../../../../docs/specs/README.md#实现合同与证据)）。这些文档链接了要搬的文件，`docs:check` 检查活跃文档的链接，所以在代码合入 master 之后、在主工作区紧接着提交。

| 文件 | 改什么 |
|---|---|
| `docs/adr/0045-…md`（编号取写时的下一个空号）与 `docs/adr/README.md` | 新 ADR，见“切片”第 0 片；索引 0030 那一行补注“其中决策 2 的搬包条件已被 0045 取代” |
| `docs/specs/runtime/server-host.md` | `owners` 加 `nb-host`；实现合同：认领、宿主适配器、端口、RPC 监听、`startHostServer`、HTTP 插件与回环校验改到 nb-host，应用侧写装配者、认领档案、`NBOOK_*` 读取与项目；关键不变量加“回环与来源由 nb-host 在监听前再核一次”；合同测试与证据改到新路径 |
| `docs/specs/runtime/browser-host.md` | `owners` 加 `nb-host`；实现合同：浏览器适配器、远程会话、RPC 套接字、客户端身份改到 nb-host，`refreshEndpoint` 由应用实现；证据路径 |
| `docs/specs/runtime/application.md` | 实现合同里两个适配器的路径与签名（加必填 `platform`） |
| `docs/specs/runtime/cli.md` | 依赖方向一句：命令行经应用的认领档案用 nb-host 的认领 |
| `docs/specs/models/service.md` | 公开入口加 `./models/schema` 与 `createModelService`；owner 与依赖方向写“服务在 nb-harness，存储与远程合同在 `nbook.models`”；证据路径 |
| `docs/modules/monorepo-boundaries.md` | 新增 nb-host 一行（职责、子路径、依赖、不依赖应用包、private）；“新应用”一行里 plugin-platform 的搬包条件改为 ADR 0045 的说法；nb-harness 一行加模型服务 |
| `packages/AGENTS.md`、根 `AGENTS.md` 的仓库结构树 | 加 nb-host。根 `AGENTS.md` 在主工作区有别的会话未提交的改动，`git commit -- AGENTS.md` 会把它们一起提交：先看 `git diff AGENTS.md`，别人的改动还在就等它提交后再改，或只暂存自己这一行（`git apply --cached` 一份只含这一行的补丁） |
| `docs/standards/code/common.md` 第 25 行 | 样例路径改到 nb-host 的 `start.ts` |
| `.agents/works/w00043-neurobot/README.md`、本 Task README | 决定、进度与合入记录 |

包内文档随代码在分支上改：`packages/nb-host/AGENTS.md`、`README.md`；`packages/neuro-book/AGENTS.md` 的目录约定与“后端”一节；`packages/nb-harness/README.md` 加 `./models/schema` 与服务一段。

## 切片

| 片 | 内容（对应关键设计） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 0 | 主工作区：开发者确认后写 ADR 0045 与索引补注、Task README 记决定；不链接还不存在的 nb-host 路径 | 一次提交（`git commit -- <路径>`） | `bun run docs:check` |
| 1 | 包骨架：`package.json`、两份 tsconfig、`AGENTS.md`、`README.md`、`architecture.test.ts`；根 `workspaces` 加 `packages/nb-host`；`scripts/ci/test-conventions.ts` 的 `STRICT_TEST_ROOTS` 加 `packages/nb-host/`；应用 `dependencies` 加 nb-host 与 `src/server/dev/watch.test.ts` 的监视根列表；`shared/socket.ts` 与 `./testing` 搬入、改全部导入（`files`、`canon` 的合同与项目管理器等，要搬的文件随后续片再改）；`bun install` | 一次提交 | nb-host：`bun run typecheck`、`bun test`；neuro-book：`bun test src/server/dev/watch.test.ts src/server/rpc src/web/host/window.test.ts`、`bun run typecheck`；根：`bun scripts/ci/validate-proper-lockfile-patch.ts`；`bun run test:affected` 的选择结果里出现 nb-host（`scripts/cli/test-affected.ts` 按 `packages/` 目录与依赖图找包，推断能自动选到；选不到就改脚本，否则 CI 永远不跑这些测试） |
| 2 | `loopback.ts`、`ports.ts`、`claim.ts`、`claim-lock.ts`；应用 `config.ts` 改用校验函数、`instance.ts` 改成认领档案、命令行与测试支持改用档案，`dev/run.ts` 的 `loopbackOrigins`、`freeGroupOffset` 改从 nb-host 取；`instance.test.ts`（连同真实子进程入口 `claim-child.ts`，改成只用 nb-host）、`ports.test.ts` 搬进 nb-host；回环与来源的校验测试 | 一次提交 | nb-host：`bun test src/server`；neuro-book：`bun test src/server/config.test.ts src/cli src/server/server.test.ts` |
| 3 | `http/`：搬准入、分发、页面资源、插件工厂与合同；应用 `src/plugins/http/` 只留描述，12 个文件改导入；`admission.test.ts`、`dispatch.test.ts`、`static.test.ts` 搬入；新增真实服务的来源测试（见“验收映射”） | 一次提交 | nb-host：`bun test src/http`；neuro-book：`bun test src/server src/plugins/files src/plugins/workbench/theme-editor.test.ts src/architecture.test.ts`、`bun run typecheck` |
| 4 | `host.ts`、`rpc-listener.ts`、`start.ts` 的 `startHostServer`；应用 `start.ts` 改成装配者、`project/start.ts` 改从 nb-host 取宿主适配器并传必填的 `platform`（`NEUROBOOK_PLATFORM`）；`rpc/listener.test.ts` 搬入；`server.test.ts` 按“验收映射”拆：通用用例搬进 nb-host `server/start.test.ts`（真实子进程用 nb-host 自己的测试入口与 `acme` 档案），应用留装配用例 | 一次提交 | nb-host：`bun test`；neuro-book：`bun test src/server src/project src/web/host`、`bun run typecheck` |
| 5 | `web/`：浏览器适配器、远程会话（注入 `refreshEndpoint`）、`openRpcSocket`、客户端身份；应用 `connection.ts`、`window.ts`、`boot.ts` 改接线；`browser-host.test.ts`、`remote-session.test.ts` 搬入（远程会话改用 nb-host 的 `startHostServer` 起真实服务端） | 一次提交 | nb-host：`bun test src/web`、`bun run typecheck`；neuro-book：`bun test src/web`、`bun run test:vitest src/web`、`bun run typecheck` |
| 6 | t32 合入、本分支变基到 master 之后：nb-harness `models/schema.ts`、`models/service.ts` 与测试；应用 `models/backend/core.ts` 改成存储加远程适配，`shared/settings.ts`、`shared/contracts.ts` 改从 `./models/schema` 取形状；设置页与 Lab 的 `models-scene` 改导入 | 一次提交 | nb-harness：`bun test src/models`、`bun run typecheck`；neuro-book：`bun test src/plugins/models`、`bun run test:vitest src/plugins/models`、`bun run typecheck` |
| 7 | 包内文档；“验证”一节的合入前清单 | 一次提交 | 见“验证” |
| 合入后 | 主工作区先 `bun install`（master 新增了工作区成员）；“Spec 与文档改动”表里除 ADR 外的各项 | 一次提交（`git commit -- <路径>`；根 `AGENTS.md` 见该表的注） | `bun run docs:check`、`bun run governance:check` |

顺序的理由：套接字链路是两端共用的底，先搬；认领与回环校验不依赖别的块；HTTP 插件是 `startHostServer` 的插件之一，先于它；浏览器侧的测试要起真实服务端，排在服务端之后；模型服务等 t32。每片结束时应用完整可用。第 1 到 5 片可以在 t32 合入之前做完、先合入，第 6 片单独再合一次。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| `runtime.server-host` 验收 11（非回环、来源格式） | nb-host `server/loopback.test.ts`（校验函数；`startRpcListener` 与 HTTP 插件收到 `0.0.0.0` 时不监听即失败）；应用 `config.test.ts`（`NBOOK_*` 的读与拒绝）、`server.test.ts`“产品入口拒绝在非回环地址上监听”（真实子进程） |
| 验收 17（`Host` 421、写请求 `Origin` 403） | nb-host `http/origin.test.ts`：真实 `Bun.serve` 加 `createHttpPlugin`，用 `node:net` 发原始请求带 `Host: evil.example:<端口>`（不依赖 `fetch` 能否改 `Host`，未核实），得 421；`POST` 带 `Origin: null` 与 `http://evil.example` 得 403；本页来源、不带 `Origin` 的写与任意来源的 `GET` 照常；`dispatch.test.ts` 搬入的两条留作分发层用例。应用 `server.test.ts` 加一条：经 `startClaimedServer` 的真实服务端同样 421 与 403（证明装配把同一份 `allowOrigin` 交给了 HTTP） |
| 验收 12、13（RPC 来源、门、端口占用与顺延、RPC 停止） | nb-host `server/rpc-listener.test.ts`（真实 Bun 监听与真实 WebSocket）、`server/start.test.ts` 的 RPC 组；应用 `server.test.ts` 留“三个回环来源与 `NBOOK_ALLOWED_ORIGINS` 放行、其它 403”；`e2e/rpc.e2e.ts`“页面来源”；`smoke:server` 的外站握手 |
| 验收 18（一个状态根一个实例） | nb-host `server/claim.test.ts`（搬自 `instance.test.ts`：真实子进程的第二个认领者、`SIGSTOP` 不接管、`SIGKILL` 后重新认领、同时认领只有一个）；应用 `server.test.ts` 的第二个服务端（产品入口与测试入口）、`cli/cli.test.ts`、`smoke:server` S10 |
| 验收 2、3、4、6、9、10、19、21 | nb-host `server/start.test.ts`（真实子进程：启动失败、SIGTERM 与 SIGHUP 与标准输入停止、在途请求、关闭失败、未捕获异常、未处理拒绝、标准输入结束；同进程：排空超时、等待就绪的请求 503、装配失败）与 `http/dispatch.test.ts`（路由抛错）；应用 `server.test.ts` 留“启动后 health 200、标准输入 stop 依赖逆序关闭”一条经产品装配的真实子进程用例；`smoke:server` |
| 验收 14、15、16、20（项目）与 7、8（开发模式） | 应用不变：`server-projects.test.ts`、`projects/manager.test.ts`、`dev/supervisor.test.ts`、`dev/run.test.ts`；e2e `projects`、`dev` |
| `runtime.browser-host` 验收 6、8、9 | nb-host `web/remote-session.test.ts`（真实服务端与 WebSocket、手动时钟：退避间隔、每次重取端点、换进程转终态）；应用 `window.test.ts`（真实后端，经 TCP 转发掐断）；`e2e/rpc.e2e.ts` |
| `runtime.application` 的两个适配器 | nb-host `web/browser-host.test.ts`（搬入）、`server/start.test.ts` 的停止来源汇合与监听移除 |
| `runtime.plugin-channel` “WebSocket 传输与握手”第 2 条 | nb-host `server/rpc-listener.test.ts` |
| `models.service` 输出 6、13、15 | nb-harness `models/service.test.ts`（内存存储：冲突后重读再写、三次仍冲突为 `write-conflict`、`setKey` 两步、删除时解绑）；应用 `models.test.ts` 原样保留（真实设置场地与真实远程合同），其中“设置文件视图在服务端合并期间写入”一条同时证明内存存储与设置服务的冲突语义一致 |
| `models.service` 输出 7、8、9、12，验收 1 到 3 | 应用 `models.test.ts`、`models.llm.test.ts`（`test:llm`，本 Task 不跑，见风险）；`e2e/models.e2e.ts` |

## 验证

每片按上表自跑。合入前（第 7 片，第 6 片另合时只跑与模型有关的几项）：

- 根：`bun run test:affected --typecheck`（基准 master）、`bun run governance:check`、`bun run docs:check`。
- `bun run --cwd packages/neuro-book smoke:server`：打包后的产物里 nb-host 的代码在同一模块图里（场景 1）、认领、RPC 握手与外站来源、页面资源。打包与 smoke 按验证门禁在主工作区或干净克隆跑一遍分支的提交。
- 变异检查（[测试写法](../../../../../docs/testing/README.md#测试写法)）：逐条改坏 nb-host 的 `assertLoopbackHost`、分发的 `Host` 判断、写请求的 `Origin` 判断、RPC 升级的来源判断、认领的“有应答即退出”，确认对应测试失败后还原（改之前先提交或备份文件）。
- e2e，合入前跑一次（6 个文件；先 `bun run build && bun run build:e2e`，再 `bunx playwright test -c e2e/playwright.config.ts e2e/rpc.e2e e2e/browser-host.e2e …`，核对 `Running N tests` 的数目）：
  - `rpc.e2e.ts`：真实 Chrome 下 RPC 来源核对、断线重连与服务端换进程，经 nb-host 的监听与远程会话；
  - `browser-host.e2e.ts`：生产构建的启动序列与协议不一致页，浏览器包解析了 nb-host 的 `./web`；
  - `projects.e2e.ts`：项目子进程走 nb-host 的宿主适配器（`project` 位置）、重连与宽限期；
  - `dev.e2e.ts`：开发监督进程用 nb-host 的端口顺延与来源，后端改文件后有序重启；
  - `app-package.e2e.ts`：装出来的包在仓库 `node_modules` 之外运行，nb-host 与带补丁的 `proper-lockfile` 都打进了 bundle；
  - `models.e2e.ts`（第 6 片）：设置页经新的远程适配走完添加、绑定、删除。
- 实施中改动后只重跑覆盖改动的文件与失败项；第 6 片单独合入时只跑 `models.e2e.ts`。

明确留下的未验证边界：Windows 上的认领（命名管道，Spec 已标未实测）与整个新应用；`models.llm.test.ts`（真实模型，改动不碰请求路径，本 Task 不跑）；NeuroBot 实际装配 nb-host（它还不存在，只由 nb-host 自己用 `acme` 档案的测试代表）。

写计划时没有核实、在实施中核对的：Bun 的 `fetch` 能否改 `Host`（第 3 片改用 `node:net`，不依赖它）；Bun 收到 `Host: evil.example` 时 `request.url` 的主机名取自这个头（`dispatch.ts` 的注释这么写，第 3 片的真实服务测试核对）；Vite 解析 nb-host 的 `./web` 不用加 `optimizeDeps`（从 nb-runtime 的用法推断，第 5 片的构建与 e2e 核对）；根的 `proper-lockfile` 补丁对 nb-host 声明的同一版本同样生效（Bun 按包名与版本打补丁，推断，第 1 片核对）；`test:affected` 能自动选到新包（第 1 片核对）；t32 合入后 `./models/rules` 的最终导出（第 6 片开工时重读）。

## 不做与风险

发布影响：应用包按 ADR 0033 发构建产物，nb-host 与它的依赖打进 `nbook.js` 与 `project.js` 的 bundle，`scripts/third-party-notices.ts` 跳过 `@notnotype/*`，新增的第三方依赖（`proper-lockfile`、Hono）应用本来就带，`THIRD-PARTY-NOTICES.md` 不变（推断，合入前的 `app-package.e2e.ts` 与打包核对）。nb-harness 是 ADR 0029 已发布的 9 个包之一，`./models/schema` 与 `createModelService` 是公开面的新增：本 Task 不升版本、不发布，nb-story 现有的导入（`./models` 的目录与凭据）不变；以后发布时随下一次版本另请授权。

不做：NeuroBot 的任何代码；`plugin-platform` 搬包（条件改了，现在仍只有一个需要第三方插件的应用）；`startup-env.ts`、`omp-process.ts`、`user-directories.ts`、开发监督进程、项目管理、命令行的抽取；nb-story `serve.ts` 改用 nb-host（它有自己的令牌登录，不在开发者这次划的范围里）；鉴权插件；nb-host 发 npm（`private: true`，以后要发时按 ADR 0029 决定 6 另定，届时要处理 `proper-lockfile` 的补丁）；模型服务的缓存寿命与 NeuroBot 设置页。

风险与兜底：

- **搬坏启动与停止的顺序**：兜底是 nb-host `server/start.test.ts` 的真实子进程用例与同进程用例（真实 `Bun.serve`、真实 WebSocket、nb-runtime 的手动时钟），以及应用 `server.test.ts`、`server-projects.test.ts` 经产品装配的用例。实施时核对“停止开头的同步段”确实先调扩展的 `stopping()` 再开始两路排空：`server-projects.test.ts`“停止开始后打开被拒”就是这条。
- **漏传平台档案**：`platform` 在两个适配器与 `startHostServer` 上都是必填，类型检查拦下。
- **应用名漏进包**：`architecture.test.ts` 的扫描。503 文案与套接字前缀由选项传入，NeuroBook 的观察结果逐字相同；实施时用 `smoke:server` 与 `server.test.ts` 的现有断言核对。
- **认领锁两份配置分叉**：只有认领用 `server.claim.lock`，同一把锁的参数只在 nb-host 一处；`claim.test.ts`“同时认领只有一个”用真实子进程守住。
- **模型服务的内存存储与设置服务的冲突语义不一致**：兜底是应用 `models.test.ts` 不改、整份经真实设置场地跑，含冲突重试的那条。
- **浏览器第一次从 nb-host 取运行时代码**：兜底是第 5 片的 `vue-tsc`、Vitest 的 DOM 用例（用前端的 Vite 配置解析）与合入前的 `browser-host.e2e.ts`、`rpc.e2e.ts`（真实构建产物）。
- **t32 的导出与本计划假设不同**：第 6 片开工时重读 t32 合入后的 `./models/rules`，以它为准改本计划再动手。

## 需要开发者确认

1. **新包 `packages/nb-host`（`@notnotype/nb-host`），不放进 nb-runtime**：nb-runtime 的运行时依赖只有 TypeBox、前后端共用、已发 npm，而服务端宿主要 `Bun.serve`、`node:net`、`proper-lockfile`、Hono。推荐新包，`private: true`，子路径 `./server`、`./http`、`./http/contracts`、`./socket`、`./web`、`./testing`。按 `packages/AGENTS.md` 是跨模块决策。
2. **写一份 ADR（0045）合记三件事**：新包与“应用名、环境变量、端口缺省、产品名由应用传入，安全不变量只在包里实现”；模型服务的通用部分进 nb-harness；部分取代 0030 决策 2（搬包条件改为“出现第二个需要第三方插件的应用”，其余不变）。推荐合写，主 Agent 在开发者确认本计划后、第 1 片之前在主工作区写（第 0 片）。
3. **认领锁由 nb-host 自带（同一个库、同样的参数），`holdLock` 留在应用**。推荐如此；把 `holdLock` 搬进 nb-host 会让宿主包拥有 Files 与设置用的加锁替换工具，并改 20 多个消费者。
4. **模型服务拆成两半**：服务进 nb-harness（`./models` 导出 `createModelService`，新子路径 `./models/schema` 放形状），设置经宿主实现的 `ModelsConfigStore` 读写；`modelsKey`、远程合同 `nbook.models/settings` 与它的适配、设置项定义与设置页留应用。推荐如此：t32 让 nb-harness 不导入 nb-runtime，远程合同只能留在应用；整块放进 nb-host 会让宿主包依赖 OMP。
5. **HTTP 插件的工厂进 nb-host、插件 id 由应用传**，`http.routes` 合同改从 `@notnotype/nb-host/http/contracts` 取（12 个应用文件改导入，第三方插件的 SDK 不涉及：SDK 现在不导出 HTTP 合同）。推荐如此。
