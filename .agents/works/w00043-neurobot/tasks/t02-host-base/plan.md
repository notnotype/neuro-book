# t02 实施计划：把两端宿主的通用部分、模型服务与加锁替换抽成包

## Context

本稿按第一轮计划审查与独立设计修订，处理见 [README](README.md) 的“计划第一稿的处理”与“开发者定的”。

NeuroBot（[提案](../../../../../docs/proposals/neurobot.md) 第三节、第四节第 2、3、10 小节）是第二个建在 nb-runtime 上的应用。开发者 2026-11-10 选了提案第二稿待定项 1 的 (b)：仍在 NeuroBook 应用里、NeuroBot 也要的部分，只把安全攸关、已经调好的抽成包两边共用；设置、存储、Agent 接线、网页对话宿主 NeuroBot 自己写。同日开发者同意另写 ADR 把 [ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md) 决策 2 的搬包条件改为“出现第二个需要第三方插件的应用”，并同意三项：模型服务放进新包 `nb-models`；加锁替换抽成与应用无关的小包；诊断日志的输出插件 `runtime.diagnostics` 进 `nb-host`。

要解决的问题：

- 只许监听回环、`Host` 421、`Origin` 403、状态根认领这几条安全规则（[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)）现在只有 NeuroBook 一份实现，NeuroBot 第一版必须满足同样的规则并有验收（提案第四节第 10 小节）。照抄一份，两边会分叉。
- 启动与停止的顺序（RPC 监听先于插件装配、升级先过门再核对来源、两路排空、退出码一次算出）是调过多轮的，NeuroBot 要同一套。
- 模型服务（`nbook.models` 的 `core.ts`）NeuroBot 也要，但它读的是 NeuroBook 的设置服务、远程合同的 id 带 NeuroBook 的插件 id。
- 跨进程的加锁替换（`src/backend/locked-replace.ts`）是设置层文件与 Files 的写入基础，NeuroBot 写自己的设置与记忆也要；留在应用里，NeuroBot 只能抄一份，锁参数会有第二份。
- 诊断的 JSONL 出口是宿主“记录先于任何插件存在”的前提，NeuroBot 也必须有日志。

期望结果：三个新包。`packages/nb-file-lock` 拿到加锁替换与跨进程锁，工作区里只有它直接用 `proper-lockfile`；`packages/nb-host` 拿到两端宿主、HTTP 与诊断出口中与应用无关的部分；`packages/nb-models` 拿到模型服务的配置形状、纯规则、选择顺序、远程合同的定义对象与核心。NeuroBook 只剩装配、自己的 id 与配置。NeuroBook 用户可观察的行为、配置、环境变量、诊断事件名与 HTTP 错误码都不变。

依据：[ADR 0023](../../../../../docs/adr/0023-v2-frontend-backend-stack.md)（Bun、Hono、TypeBox）、[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)（RPC 端口与拓扑）、[ADR 0025](../../../../../docs/adr/README.md)（插件之间只引用对方的 `shared/contracts.ts`）、[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（工作区包以源码发布，决定 6：其它包要发布时另定）、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)（内核与应用无关、应用名由档案传入、扫描测试守住）、[ADR 0033](../../../../../docs/adr/0033-app-delivered-as-built-npm-package.md)（应用发构建产物）、[`monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)（迁移不留旧路径别名与转发）、[`packages/AGENTS.md`](../../../../../packages/AGENTS.md)（exports 与包名变化先记为跨模块决策）。

与其它工作的关系：[w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/README.md) 第三稿不再搬模型规则：`models/shared/rules.ts`、`compaction.ts` 与 `port.resolve` 的选择顺序都由本 Task 搬进 `nb-models`；t32 只在 nb-harness 的 `kit/shapes.ts` 定压缩角色 id `MODEL_ROLES.compaction`（kit 的摘要方法按它取模型），并给 nb-harness 加“不导入 `@notnotype/nb-runtime`”的扫描。模型几片要用 `kit/shapes.ts`，排在 t32 合入之后；`nb-file-lock`、`nb-host` 不碰 t32 与 t14 的文件，先做先合。

工作方式与约束：

- 代码在 Work 分支 `feat/w00043-neurobot`（worktree `.worktree/w00043-neurobot`，开工时用 `/usr/bin/git worktree add` 建）；ADR、Spec、Task 记录在主工作区 master 上改。
- 行为不变的搬家：搬过去的代码、诊断文字（现有中文诊断不顺手改成英文，[`common.md`](../../../../../docs/standards/code/common.md)）与错误码原样保留；每片搬完就删旧文件、改完全部调用方，不留转发的旧入口。插件自己的 `shared/contracts.ts` 是 ADR 0025 规定的跨插件入口，它转出包里的形状不算旧入口。

## 技术选型

| 通用问题 | 选用 | 理由；否决 |
|---|---|---|
| 跨进程锁与加锁替换 | `proper-lockfile` 4.1.2（根 `patchedDependencies` 有补丁），只由 `nb-file-lock` 导入；`holdLock`、`replaceLocked` 原样搬 | 已调好的实现，搬家不换库；否决 nb-host 自带一份只取锁放锁的模块（会丢 `onCompromised` 与放锁前的身份核对，参数成两份） |
| 宿主自有接口的路由（`/api/runtime/health` 与宿主路由） | Hono（应用已依赖，ADR 0023） | 现有实现就用它；否决换成手写的路径表（行为不变的搬家不顺手换实现） |
| 包内类型检查分前后端 | 照 nb-runtime：`tsconfig.json`（Bun 类型）加 `tsconfig.browser.json`（DOM 库、无 Bun 类型，`exclude: ["src/**/*.test.ts"]`） | 现成写法 |

没有用库替换手写实现的地方，不需要对照测试切片。

## 关键设计

### 通用与应用专有的划分

逐块判断（行数是非测试代码，估算）：

| 现在的位置 | 去向 | 理由 |
|---|---|---|
| `src/backend/locked-replace.ts`（241） | `nb-file-lock` | 设置、Files、canon、plugin-platform、认领共用；开发者 2026-11-10 定 |
| `src/backend/staged-commit.ts` | 留应用，改从 `nb-file-lock` 取锁 | 只有 Files 的写入接口用它 |
| `src/server/host.ts`（162） | nb-host `server/host.ts` | 停止来源汇合、`beforeStop`、监听的挂接与移除；项目子进程（`src/project/start.ts`）也用 |
| `src/server/instance.ts`（301） | nb-host `server/claim.ts`；应用留认领档案 | 认领协议是安全不变量；套接字名前缀、版本、应答里的 `plugins` 字段归应用 |
| `src/server/ports.ts`（68） | nb-host `server/ports.ts` | 成组顺延；开发监督进程也用 |
| `src/server/rpc/listener.ts`（105） | nb-host `server/rpc-listener.ts` | RPC 端口的门、来源、路径、消息上限 |
| `src/server/config.ts` 的回环与来源校验、`loopbackOrigins`（约 50） | nb-host `server/loopback.ts` | 安全规则；`NBOOK_*` 的读取、缺省端口、项目时限留应用 |
| `src/server/start.ts`（462）的诊断存储、准入、远程节点与路由、RPC 监听与顺延、来源判定、HTTP 与诊断两个宿主插件、排空、退出码、认领的发布与放下（约 280） | nb-host `server/start.ts` 的 `startHostServer` | 已调好的启动与停止顺序 |
| `start.ts` 其余：插件平台、项目管理器、`userDirectories`、`startupEnv`、`devTask`、平台档案 | 留应用 `src/server/start.ts`，作为装配者 | NeuroBook 专有 |
| `src/plugins/http/backend/`（admission 153、dispatch 230、static 109、plugin 94）与 `shared/contracts.ts`（37） | nb-host `http/`、`shared/http-contracts.ts` | 准入、分发、`Host` 与 `Origin` 核对、页面资源、`http.routes` 合同 |
| `src/plugins/diagnostics/backend/`（jsonl-exporter 243、log-writer 169、plugin 95）与 `web/`（console-exporter 65、plugin 26） | nb-host `server/diagnostics/`、`web/diagnostics/` | 开发者 2026-11-10 定；不含应用词汇 |
| `src/plugins/http/plugin.ts`、`src/plugins/diagnostics/plugin.ts`（两个描述） | 留应用 | 描述带应用版本与清单位置 |
| `src/shared/rpc-socket.ts`（85） | nb-host `shared/socket.ts` | 两端共用的套接字链路 |
| `src/web/host/browser-host.ts`（93）、`remote-session.ts`（189）、`client-identity.ts`（46） | nb-host `web/` | 浏览器一侧的内核实例、首连与退避重连、握手身份 |
| `src/web/host/connection.ts` 的 `openRemote`（约 35）与 `ConnectionError` | nb-host `web/rpc-socket.ts`、`web/connection-error.ts` | 拼地址、打开 WebSocket |
| `src/plugins/models/shared/rules.ts`、`compaction.ts`、`settings.ts` 的配置形状与内置角色 | `nb-models` `./config` | 开发者 2026-11-10 定（原 t32 的搬家改由本 Task） |
| `models/shared/contracts.ts` 的快照形状、方法与事件表、`ModelsService`、`ProfileModelDefaults`、`hasCredentials` | `nb-models` `./contract` | 定义对象随服务进包，应用只填 id |
| `models/backend/core.ts`（555） | `nb-models` `./core`；应用留设置存储的适配 | 快照、解析、选择顺序、串行写入、检测与发现 |
| `models` 的 `modelsKey`、远程合同 id、`defineSettings`、分区、文字、设置页、插件入口（打开凭据库） | 留应用 | 带应用 id 的一律由应用定 |
| 开发监督进程 `src/server/dev/`、项目 `src/server/projects/` 与 `src/project/`、`plugin-platform`、命令行 `src/cli/`、`process.ts`、`plugins.ts`、`browser-bootstrap.ts`、`plugin-files.ts`、`user-directories.ts`、`startup-env.ts`、`omp-process.ts` | 留应用 | 开发者 2026-11-10 的划分；`startup-env.ts`、`omp-process.ts` 必须是每个入口的前两条导入，包替入口做不了这件事 |
| `src/web/` 的 `window.ts`、`boot.ts`、`mount.ts`、路由、宿主页、`browser-bootstrap` 协议、`connection.ts` 的 `bootstrap` 与 `catalog`、插件装配、文字引擎、Lab | 留应用 | 书架、工作台、插件集合、消息目录都是 NeuroBook 的 |

合计约 240 行进 `nb-file-lock`，约 2,300 行进 nb-host（其中约 950 行出自 `src/server/`、约 600 行是诊断出口），约 900 行进 `nb-models`。

### `packages/nb-file-lock/`：加锁替换与跨进程锁

新包 `@notnotype/nb-file-lock`（命名随近来的 `nb-*` 包；见“需要开发者确认”第 1 项），`private: true`，只有 `.` 一个子路径，只在 Bun 进程里用。

- `src/index.ts`：`locked-replace.ts` 原样搬，导出 `holdLock`、`HeldLock`、`replaceLocked`、`ReplaceOptions`、`ReplaceResult`、`ReplaceFailure`、`ReplaceDecision`、`CurrentFile`、`statOrNull`、`sameFile`、`readOnly`、`errno`、`describe`、`LOCK_STALE_MS`。注释里“所有 NeuroBook 进程必须一致”改为“所有共用这把锁的进程必须一致”。
- 新增 `lockHeld(lockPath): Promise<boolean>`：用同一个 `LOCK_STALE_MS` 调 `proper-lockfile` 的 `check`。plugin-platform `backend/startup.ts` 改用它，不再自己 `import {check} from "proper-lockfile"` 加 `LOCK_STALE_MS`。这样这把锁的过期与退避参数只在本包一处。
- 原样转出 `proper-lockfile` 的 `lock` 与 `LockOptions`，给锁参数不同的另一把锁（nb-host 诊断出口的日志位置授予：30 秒过期、10 秒心跳，长期持有，与加锁替换不是同一把锁，参数仍在 nb-host 的出口里一处）与 plugin-platform 的 `plugins.test.ts`。工作区里因此只有本包直接导入 `proper-lockfile`。
- 类型声明：`src/types/proper-lockfile.d.ts` 由应用的那份搬来（`lock`、`lockSync`、`check`、`LockOptions`）；`src/index.ts` 第一行 `/// <reference path="./types/proper-lockfile.d.ts" />`，任何导入本包的类型检查都带上它。应用删掉 `src/types/proper-lockfile.d.ts` 与 `tsconfig.browser-test.json` 里的这一项（两份同名环境声明会报重复标识符）。`scripts/types/proper-lockfile.d.ts` 不动：脚本的程序不导入本包。
- `package.json`：`dependencies` 为 `proper-lockfile`（`4.1.2`，与根一致）；`devDependencies` 为 `@types/bun`、`typescript`、`@notnotype/neuro-book-test-support`；脚本 `test` 为 `bun test`、`typecheck` 为 `tsc --noEmit`。应用 `package.json` 去掉 `proper-lockfile`、加 `@notnotype/nb-file-lock`。
- 根补丁：Bun 按“包名@版本”打补丁，本包声明同一精确版本时提升到根上那一份。`scripts/ci/validate-proper-lockfile-patch.ts` 加一条：工作区成员（`neuro-book-legacy` 除外）里声明 `proper-lockfile` 的只有 `packages/nb-file-lock`，且版本是 `4.1.2`；另一个版本会装出一份不带补丁的嵌套副本。
- 测试：`locked-replace.test.ts`、`staged-commit.test.ts` 里与锁本身有关的用例搬来；新增两条用真实子进程（`Bun.spawn` 跑本包的测试入口 `src/testing/lock-child.ts`）的用例：两个进程同时 `replaceLocked` 同一文件各 20 次、结果不丢更新；持锁进程被 `SIGSTOP` 超过 `LOCK_STALE_MS` 后被另一进程接管，恢复后它的 `stillHeld` 报失去锁、`release` 不删接管者的锁目录、进程不崩（`lock.compromised` 只经 `report` 报出）。`src/app-neutral.test.ts` 照 nb-runtime 扫应用名（正则见 nb-host 一节）。
- 应用侧 26 个文件的导入（19 个非测试源文件：plugin-platform 的 8 个、`files/backend/` 4 个、`settings/backend/layer-file.ts`、`canon/backend/world-host.ts`、`canon/testing/world-child.ts`、`projects/backend/browse.ts`、`server/projects/identity.ts`、`server/dev/sample.ts`、`backend/staged-commit.ts`；加 7 份测试）机械改成 `@notnotype/nb-file-lock`；`server/instance.ts` 那处随第 3 片进 nb-host。`architecture.test.ts` 的 `PLATFORM_SHARED_UTILITIES` 去掉 `backend/locked-replace`，`PLATFORM_ALLOWED_PACKAGES` 把 `proper-lockfile` 换成 `@notnotype/nb-file-lock`，对应反例改指向；`packages/neuro-book/AGENTS.md` 里 `src/backend/` 与 `src/plugin-platform/` 两句跟着改说法。

### `packages/nb-host/`：包骨架

新包 `@notnotype/nb-host`，`private: true`，许可证同仓库，`engines.bun` 同 nb-runtime。子路径（`./http/contracts` 的文件放在 `src/shared/`，由浏览器配置检查）：

| 子路径 | 文件 | 运行位置 | 依赖 |
|---|---|---|---|
| `./server` | `src/server/index.ts`（`claim.ts`、`host.ts`、`loopback.ts`、`ports.ts`、`rpc-listener.ts`、`start.ts`、`diagnostics/`） | Bun | nb-runtime、nb-file-lock、typebox、`node:*` |
| `./http/contracts` | `src/shared/http-contracts.ts` | 不限 | 无 |
| `./socket` | `src/shared/socket.ts` | 不限 | nb-runtime `./remote` |
| `./web` | `src/web/index.ts`（`browser-host.ts`、`remote-session.ts`、`rpc-socket.ts`、`connection-error.ts`、`client-identity.ts`、`diagnostics/`） | 浏览器 | nb-runtime |
| `./testing` | `src/testing/index.ts`（应用 `src/server/testing/` 的 `rpc-client.ts`、`tcp-proxy.ts`；分发层的 `createDispatcher`、`RouteTable`、`HttpAdmission`） | Bun，只给测试 | 同 `./server` |

- HTTP 插件的实现在 `src/http/`（`admission.ts`、`dispatch.ts`、`static.ts`、`plugin.ts`），只由 `startHostServer` 装配，不单独导出（见下文 HTTP 一节）；测试要用的分发层经 `./testing` 取。
- 浏览器目录叫 `web/`：应用开发监督进程的后端文件判定（`src/server/dev/watch.ts` 的 `isBackendFile`）按路径段 `web` 排除前端文件，改 nb-host 的浏览器代码不会触发后端重启。
- `package.json`：`dependencies` 为 `@notnotype/nb-runtime`、`@notnotype/nb-file-lock`（`workspace:^`）、`typebox`、`hono`；`devDependencies` 为 `@types/bun`、`typescript`、`@notnotype/neuro-book-test-support`；`files` 白名单同 nb-runtime（不发测试）。脚本 `test` 为 `bun test`；`typecheck` 为 `tsc --noEmit && tsc --noEmit -p tsconfig.browser.json`。`tsconfig.browser.json` 只含 `src/web/`、`src/shared/`，排除测试。
- `AGENTS.md`（引用 `../../AGENTS.md`）与 `README.md`：职责、子路径与运行位置、“应用名一律由宿主传入”、验证命令；README 写明已知限制：不支持两个应用共用同一个状态根（套接字前缀只影响长路径时的地址，短路径时后来者报“有实例但没有应答”，长路径时两者都能认领），以及宿主必须让 `startHostServer` 装配诊断与 HTTP 两个插件。
- `src/architecture.test.ts`：
  - 应用名：非测试源码（含注释）不出现 `/nbook|neurobook|nbot|neurobot/i`；导入说明符不以 `nbook/`、`@notnotype/neuro-book`、`@notnotype/neuro-bot` 开头（`neuro-bot` 以 t03 起的实际包名为准）。每个名字各带一个反例。
  - 分层：`web/` 与 `shared/` 的包导入用白名单，只许 `@notnotype/nb-runtime/<子路径>` 与 `typebox`；违规时的失败信息写明“浏览器侧新增第三方依赖要同时加进应用 `vite.config.ts` 的 `optimizeDeps.include`”。`shared/http-contracts.ts` 没有任何运行时导入；`server/`、`http/` 不导入 `../web`；`web/`、`shared/` 不导入 `../server`、`../http`。测试文件豁免（`remote-session.test.ts` 起真实服务端）。
  - 只有 `web/browser-host.ts` 与 `server/host.ts` 导入内核的 `createApplication`（同应用的 `KERNEL_CREATE`）。
  - 每条规则带一个反例，证明规则能拦下违规（同应用 `architecture.test.ts` 的写法）。

### 应用 `src/architecture.test.ts`：新包子路径的运行位置

应用的前后端规则靠 `targetInSrc`，包名一律当作“不在 src 内”，搬家后 `web/` 里写 `@notnotype/nb-host/server` 拦不住。加一张包子路径的运行位置表，参与 web、server、neutral 三条规则：

| 说明符 | 运行位置 |
|---|---|
| `@notnotype/nb-host/server`、`@notnotype/nb-file-lock`、`@notnotype/nb-models/core` | 只后端 |
| `@notnotype/nb-host/web` | 只前端 |
| `@notnotype/nb-host/socket`、`@notnotype/nb-host/http/contracts`、`@notnotype/nb-models/config`、`@notnotype/nb-models/contract` | 不限 |

`./testing` 已由“产品代码引用了测试支持代码”一条拦下。每个方向带一个反例；`nb-host` 两行随第 2 片加，`nb-file-lock` 一行随第 1 片加，`nb-models` 三行随第 7 片加。以 `nbook/plugins/http/backend/dispatch` 为例的反例换成 `@notnotype/nb-host/server`。

### `packages/nb-host/src/server/loopback.ts`：回环与来源

```ts
/** 监听地址的写法：127.0.0.1、::1、localhost。 */
export const LOOPBACK_BIND_HOSTS: ReadonlySet<string>;
/** `URL.hostname` 的写法（IPv6 带方括号）：127.0.0.1、localhost、[::1]。 */
export const LOOPBACK_URL_HOSTS: ReadonlySet<string>;
export class HostConfigError extends Error { readonly code: "non-loopback-host" | "invalid-origin" }
/** 不是回环地址就抛；`label` 是诊断里说明来源的写法（应用传 `NBOOK_HOST=…`）。 */
export function assertLoopbackHost(host: string, label: string): void;
/** 每项必须是回环主机上的 http 来源；返回规范化的来源。 */
export function parseAllowedOrigins(value: string | undefined, label: string): string[];
export function assertLoopbackOrigins(origins: ReadonlyArray<string>, label: string): void;
export function loopbackOrigins(pageUrl: string): string[];
```

- 两个集合用途不同，不合并：合并后 `NBOOK_HOST=::1` 与 `Host: [::1]` 必有一边坏。`loopback.test.ts` 各放一条用例钉住两种写法。分发层（`dispatch.ts` 现在自带一份）与配置都只从这里取，包里不再有第三份。
- 应用的 `readServerConfig` 用这几个函数读 `NBOOK_HOST`、`NBOOK_ALLOWED_ORIGINS`，错误文字与现在逐字相同，`ServerConfigError` 的码不变（应用把 `HostConfigError` 的码原样转成 `ServerConfigError`）。NeuroBook 的观察行为不变：非法值仍先在读配置时以 `runtime.config.invalid` 退出。
- 第二道校验在任何监听之前：`startHostServer` 第一步对 `listen.host` 与 `allowedOrigins` 一起校验，失败走装配失败路径（写致命诊断 `runtime.startup.failed`、放下认领、抛 `ServerAssemblyError`）；`ports.ts` 的试探函数（`probePort`、`freePort`、`freeGroupOffset`，开发监督进程直接用）与 `startRpcListener` 在调 `Bun.serve` 之前各调一次 `assertLoopbackHost`。这样“只许监听回环”不靠应用解析环境变量时没漏。鉴权插件上线时这里加放行条件，现在没有。

### `packages/nb-host/src/server/claim.ts`：状态根认领

搬 `instance.ts` 的全部逻辑（地址、锁、hello 协议、残留套接字、0600、只删自己建的文件），认领锁直接用 `nb-file-lock` 的 `holdLock`（`onCompromised`、放锁前的身份核对、事件名 `instance.claim.lock.compromised` 与 `instance.claim.lock.release-failed` 都随它保住，参数只有那一份）。三处由宿主传入：

```ts
export interface ClaimProfile<E extends TProperties> {
    /** 运行时目录与 Windows 命名管道的名字前缀（NeuroBook 是 "nbook"）。 */
    readonly socketPrefix: string;
    readonly version: string;
    /** 应答里应用自己的字段（就绪前为 null）；读者按 基础字段 + 这些字段 完整校验。键不得与基础字段重名，定义时核对。 */
    readonly fields: E;
}
export interface StateRootClaim<E extends TProperties> {
    /** 发布时用 `Value.Check` 核一次应用字段，不合 `fields` 就抛错：不合的应答会让后来者把本实例判成“没有应答”。 */
    publish(ready: {readonly url: string | null; readonly rpcUrl: string; readonly extra: Static<TObject<E>>}): void;
    stopping(): void;
    release(): Promise<void>;
}
claimStateRoot<E>(options: {stateRoot, kind, report, profile: ClaimProfile<E>}): Promise<ClaimResult<E>>;
queryInstance<E>(stateRoot, profile: ClaimProfile<E>, timeoutMs?): Promise<InstanceQuery<E>>;
instanceAddress(stateRoot, socketPrefix): Promise<string>;
```

- 基础字段 `{schema: 1, pid, version, kind, status, url, rpcUrl}` 与 `kind` 的三个取值不变；NeuroBook 的应答形状与现在逐字段相同（`plugins` 由应用档案给出 schema，`NotLoadedSchema` 留在应用）。
- 文件名 `server.sock`、`server.claim.lock`、`HELLO_TIMEOUT_MS`、1 MB 上限、100 字节路径上限是协议的一部分，留在包里不参数化。
- 应用 `src/server/instance.ts` 变成 NeuroBook 的认领档案：`NBOOK_CLAIM`（前缀 `nbook`、`PRODUCT_VERSION`、`plugins` 字段）与绑定档案的 `claimNeuroBook`、`queryNeuroBook`、`InstanceInfo` 类型；`cli/start.ts`、`cli/plugin.ts`、`process.ts`、`testing/claimed-server.ts`、`testing/fixture-entry.ts` 改用它们。这是应用的配置，不是转发旧入口。
- `reportClaimFailure` 与 `claimReport` 留在应用 `process.ts`（写致命行与事件名 `runtime.state-root.*`，事件名不变）。

### `packages/nb-host/src/server/start.ts`：`startHostServer`

```ts
export interface HostServerOptions<E extends TProperties> {
    readonly product: {readonly name: string};            // 503 文案里的产品名（NeuroBook 传 "NeuroBook"，文字不变）
    readonly platform: PluginPlatform;                      // 必填：漏传时内置插件的跨命名空间贡献被拒且没有类型错误
    readonly listen: {host, port, rpcPort, shiftPorts, allowedOrigins};
    readonly logDirectory: string;                          // 诊断出口的目录
    readonly claim: StateRootClaim<E>;
    readonly http: {readonly id: string; readonly hostRoutes?: ReadonlyArray<HostRoute>; readonly staticRoot: string | null};
    /** 应用的插件表，必须含 `context.hostPlugins` 的两个（可经 `definitionAt` 之类的包装并上描述的贡献）。 */
    readonly plugins: (context: HostPluginContext) => ReadonlyArray<PluginDefinition>;
    readonly capabilities?: ReadonlyArray<CapabilityProvider>;
    readonly requiredPlugins?: (plugins: ReadonlyArray<PluginDefinition>) => ReadonlyArray<string>;  // 缺省全部
    readonly backgroundStartupPlugins?: ReadonlyArray<string>;
    readonly satisfies?: ApplicationManifest["satisfies"];
    readonly router?: Pick<RemoteRouterOptions, "bindProject" | "projectAccess">;
    readonly extensions?: ReadonlyArray<HostServerExtension>;
    /** 就绪时随 claim.publish 发布的应用字段，类型与认领档案的 `fields` 是同一个参数。 */
    readonly readyInfo: () => Static<TObject<E>>;
    readonly process?, signals?, stopInput?, clock?, onListening?, onRpcListening?, writeFatal?;
}
export interface HostPluginContext {
    readonly store: DiagnosticsStore;
    readonly rpc: {readonly port: number; readonly path: string};
    readonly listen: {readonly host: string; readonly port: number; readonly rpcPort: number};  // 顺延之后的实际端口
    /** 由宿主建好的两个宿主插件：`runtime.diagnostics`（JSONL 出口）与 HTTP（id 取 `options.http.id`）。 */
    readonly hostPlugins: {readonly diagnostics: PluginDefinition; readonly http: PluginDefinition};
}
export interface HostAttachContext {
    readonly application: Application;
    readonly router: RemoteRouter;
    readonly store: DiagnosticsStore;
    readonly instanceId: string;                            // "server"
}
export interface HostServerExtension {
    /** 运行实例建立之后、同一同步段里调用；此时运行实例、路由与诊断存储都已就绪。项目管理器在这里建。 */
    attach?(context: HostAttachContext): void;
    /** 运行实例可用、`admission.ready()` 与 `claim.publish` 之后调用；停止已开始时不调用。 */
    ready?(): void;
    /** 停止开头的同步段里按顺序调用，先于两路排空开始；返回的 Promise 与排空并行等待，拒绝计为“停止步骤失败：排空”、退出码 1。 */
    stopping?(): void | Promise<void>;
    /** 停止结算后读；非空即停止不完整，退出码 1。 */
    problems?(): ReadonlyArray<string>;
}
export interface HostServer { application, ready, stopped, url, rpcUrl, requestStop(source) }
export class ServerAssemblyError, ServerStartupError;   // 原样搬
```

要守住的顺序与时序（读过 `start.ts`、`rpc/listener.ts` 的实现与 Spec 的实现合同确认）：

- 第一步核对 `listen.host` 与 `allowedOrigins`（见回环一节），然后 RPC 监听先于插件装配（引导接口要实际端口）；监听或顺延失败、插件装配失败、宿主插件核对失败时写致命诊断、放下认领、抛 `ServerAssemblyError`，此时没有运行实例要关。
- HTTP 与诊断由宿主装配，应用换不掉判定、漏不掉插件：`allowOrigin` 由宿主按 `allowedOrigins` 加实际 HTTP 端口在三个回环写法上的来源算出，同一个函数实例交给 HTTP 分发与 RPC 升级；`admission`、`onListening` 也由宿主接好，应用拿不到。应用交回插件表后，宿主按 id 找到两个宿主插件，核对其入口元素与签发时是同一批对象（`definitionAt` 交回的是新对象，但入口数组元素的身份保留，所以不按定义对象的身份核对）；id 不在、入口被换掉或删掉都抛 `ServerAssemblyError`。两者的 id 并入 `requiredPlugins`。
- 升级先过准入的门，再核对 `Origin`；`allowOrigin` 读的 HTTP 地址在 HTTP 插件 `onListening` 时才有，端口为 0 时顺序反了会拒掉本页。
- 停止：`claim.stopping()` → 各扩展的 `stopping()`（同步段，按传入顺序）→ 同一同步段里 `router.stopAdmission()` 与 `admission.drain()` 开始 → 两路排空各 20 秒、用同一个注入时钟 → 内核停止 → 插件全部关闭后才 `router.close()`、`rpc.stop()` → 等启动结果确定再算退出码 → 最后 `claim.release()`。
- 就绪：`admission.ready()` → `claim.publish({url, rpcUrl, extra: readyInfo()})` → 停止还没开始时各扩展的 `ready()`。
- 启动失败两次通知：紧急报告时就让等待中的请求得到 503，启动结果到达时只在还没报告过时补报，再写 `runtime.startup.causes`。
- 退出码现在只有 0 和 1（`ExitCode = 0 | 1`）：启动失败、致命事件、排空或扩展的 `stopping()` 失败、插件关闭未完成、扩展的 `problems()` 非空都是 1。Spec 里租约失效的 75 现在没有实现，以后从哪里进来见“不做”。
- 关闭未完成时 `store.flush()`，失败写 `runtime.diagnostics.flushFailed`，原样搬。

NeuroBook 的 `src/server/start.ts` 改成装配者：读 `prepared` 与插件平台，拼能力表（`stateRootKey`、`startupEnvKey`、`userDirectoriesKey`、`clockKey`、`plugin-inventory`、`projectsKey`），`http` 给 `{id: "nbook.http", hostRoutes: [引导、插件文件、插件目录三条], staticRoot}`，`plugins(context)` 按清单装配并把 `runtime.diagnostics` 与 `nbook.http` 两项换成 `context.hostPlugins` 的定义（经 `definitionAt` 并上描述的贡献），给两个扩展（顺序与现在相同：开发任务在前、项目管理器在后）。项目管理器在 `attach` 里用 `{application, router, store, instanceId}` 建，`projectsKey` 的 `create` 等它；`projectTitle`、`plugin-inventory` 的 `problems()` 这类要晚绑定运行实例的闭包也读 `attach` 时存下的值；项目管理器扩展的 `stopping()` 调 `stopAdmission()`、`problems()` 交 `shutdownProblems()`；开发任务扩展的 `ready()` 启动任务、`stopping()` 返回 `stop()` 的 Promise。`router` 接项目管理器的 `bind` 与 `access`，`readyInfo` 交出第三方插件集合。`server/plugins.ts` 的 `serverHostPlugins` 表删去（两项改由宿主建），`startServer` 的选项与 `RunningServer` 形状不变，应用里调用它的测试与入口不用改。

### `packages/nb-host/src/server/rpc-listener.ts`、`host.ts`、`ports.ts`

- `rpc-listener.ts` 原样搬，选项加 `productName`（由 `startHostServer` 传 `product.name`），503 文字“NeuroBook 暂不接受 RPC 连接。”由它拼出、逐字不变；监听前 `assertLoopbackHost`。
- `host.ts` 原样搬，`platform` 改为必填参数（原来写死 `nbook/application` 的包装），`location: "server" | "project"`、`signals` 等不变；项目子进程 `project/start.ts` 改从 `./server` 取并传 `NEUROBOOK_PLATFORM`。
- `ports.ts` 原样搬，试探前 `assertLoopbackHost`；`dev/run.ts` 的 `loopbackOrigins`、`freeGroupOffset`、`PORT_SHIFT_ATTEMPTS` 改从 `./server` 取。

### `packages/nb-host/src/http/`：HTTP 插件

- `admission.ts`、`dispatch.ts`、`static.ts` 原样搬；`HttpAdmissionRejected` 的消息里的产品名从选项来（文字不变）；`dispatch.ts` 的回环集合改用 `LOOPBACK_URL_HOSTS`。
- `plugin.ts`：`createHttpPlugin({id, productName, admission, host, port, onListening, allowOrigin, hostRoutes?, staticRoot?})` 只在包内由 `startHostServer` 调用；诊断的 `source.plugin` 用这个 id，事件名 `http.listening`、`http.request.failed`、`http.request.aborted` 不变；依赖 `diagnosticsKey`。
- `shared/http-contracts.ts`（子路径 `./http/contracts`）：`HTTP_ROUTES_POINT`、`HttpRouteEnv`、`HttpRouteHandler`、`rethrowRouteError`。12 个应用文件（`files`、`projects`、`agent` 的后端，`server/testing/test-plugins.ts` 与几份测试）改从这里导入；`files/theme-asset-route.test.ts` 用的 `createDispatcher`、`RouteTable`、`HttpAdmission` 从 `./testing` 取。
- 应用 `src/plugins/http/` 只剩 `plugin.ts`（描述）。`packages/neuro-book/AGENTS.md`“后端”一节与 `architecture.test.ts` 的 Hono 规则（`.onError(rethrowRouteError)`）跟着改说法，规则本身不变。

### `packages/nb-host/src/server/diagnostics/`、`src/web/diagnostics/`：诊断出口

- 服务端：`jsonl-exporter.ts`、`log-writer.ts`、`plugin.ts` 原样搬，`createServerDiagnosticsPlugin({store, exporter, location})` 从 `./server` 导出（项目子进程 `project/plugins.ts` 用它，`location: "project"`）；服务端进程由 `startHostServer` 建。日志位置授予的锁改从 `nb-file-lock` 取 `lock`，参数（30 秒过期、10 秒心跳）留在出口里，注释里“所有 NeuroBook 进程”改为“所有写同一日志位置的进程”。形状核对不再引用应用的描述，改为核对 nb-runtime 交回的定义只有一个入口、id 为 `runtime.diagnostics`。事件名、日志文件名 `server-*.jsonl` 与位置 `<状态根>/logs/` 不变。
- 浏览器：`console-exporter.ts`、`plugin.ts` 原样搬，`createBrowserDiagnosticsPlugin`、`createConsoleExporterFactory`、`createConsoleFallback`、`DiagnosticsConsole` 从 `./web` 导出。应用 `web/plugins.ts`、`web/host/window.ts` 与约 30 份测试的导入机械改过去。
- 描述 `plugins/diagnostics/plugin.ts`（`runtime.diagnostics`、`PRODUCT_VERSION`、三个位置）留在应用；`architecture.test.ts` 里以 `nbook/plugins/diagnostics/web/plugin` 为例的两条用例改用别的真实路径。
- `jsonl-exporter.test.ts`、`plugin.test.ts`（改用 nb-runtime 的 `createApplication` 与中性平台档案）、`console-exporter.test.ts` 随代码搬。

### `packages/nb-host/src/shared/socket.ts`、`src/web/`：浏览器宿主

- `socket.ts`：`createSocketLink`、`RPC_PATH`、`RPC_MAX_MESSAGE_BYTES` 原样搬；应用里导入它的文件改导入（含浏览器会加载的 `plugins/canon/shared/contracts.ts`、`plugins/files/shared/contracts.ts`，以及 `server/projects/` 的进程间链路）。从这一片起浏览器包经 Vite 解析 nb-host，第 2 片的验证因此加 `build:web` 与开发模式页面加载。
- `browser-host.ts`：`BrowserRuntimeHost.start({instanceId, client?, manifest, page, emergency, stopTimeoutMs?, platform})`，`manifest: Omit<ApplicationManifest, "platform">`，内部 `{...manifest, platform}`（档案放后面，清单覆盖不了），然后调内核的 `createApplication`。应用的 `KERNEL_CREATE` 检查只扫应用源码，`src/application.ts` 仍有消费者（`server/testing/projects.ts`、`plugin-sdk/examples/testing/stage.ts` 与几份测试），保留。
- `remote-session.ts`：`createRemoteSession({openRemote, refreshEndpoint, node, clock, onState, onRetryFailed?})`。

  ```ts
  /** 应用实现：取引导、核协议版本与结构。不得抛错；中止或失败交回 retry。 */
  refreshEndpoint(signal: AbortSignal): Promise<RpcEndpoint | {readonly incompatible: string} | {readonly retry: string}>;
  ```

  `incompatible` 的原因由应用拼（NeuroBook 是“服务端的引导协议版本已不是 N”），包里没有协议版本的概念；现有两处 `onRetryFailed`（取引导失败、结构不符）归入 `{retry}`；`close()` 时中止在途的 `refreshEndpoint`。退避间隔、终态（`server-restarted`、`project-gone`、`incompatible`）与首连的结果形状不变；退避表仍是模块常量，不做成选项（没有使用者）。终态之后由应用丢弃旧窗口实例、用新节点与新 `instanceId` 重建，包不支持原地恢复；这一点与 `project-gone` 只在绑定项目时出现一起写进 README。`typebox/value` 随 `refreshEndpoint` 回到应用，nb-host 的 `web/` 不再用它。
- `rpc-socket.ts`：`openRpcSocket(baseUrl, endpoint): Promise<RemoteLink>`，地址拼接抽成纯函数 `rpcSocketUrl(baseUrl, endpoint)`（`http→ws`、`https→wss`、换端口、保持主机名）。
- `connection-error.ts`：`ConnectionError`（带 `status`）单独成文件，从 `./web` 导出，`openRpcSocket` 与应用的 `bootstrap`、`catalog` 共用；要改导入的是应用 `web/host/connection.ts`、`web/host/window.ts`、`web/mount.dom.test.ts`。
- `client-identity.ts`：`readClientIdentity(key, storage)`。应用的 `src/web/host/client-identity.ts` 留下键 `CLIENT_IDENTITY_KEY = "nbook.client-identity"` 与一行包装（e2e 有 8 个文件从这里取键，不用改）。`client-identity.dom.test.ts` 改写成 nb-host 的 `client-identity.test.ts`（`bun test`，存储替身用 `Map`，“不可用”用抛 `DOMException("…", "SecurityError")` 的取存储函数）；替身与真实 `localStorage` 对契约的依据是 `lab.e2e.ts` 读 `nbook.client-identity` 的那条，合入前跑它。

### `packages/nb-models/`：模型服务

新包 `@notnotype/nb-models`，`private: true`，依赖 `@notnotype/nb-runtime`、`@notnotype/nb-harness`（`workspace:^`）与 `typebox`；`devDependencies` 同 nb-host。两份 tsconfig：浏览器配置只含 `src/config/`、`src/contract/`。

| 子路径 | 内容 | 运行位置 | 对 nb-harness 只取 |
|---|---|---|---|
| `./config` | 配置形状 `ModelConfigSchema`、`ProviderConfigSchema`、`RoleConfigSchema`、`ProvidersSchema`、`RolesSchema` 与类型、`PROVIDER_ID`；内置角色 `BUILTIN_ROLES`、`DEFAULT_ROLES`、`MODEL_ROLE_IDS`；`rules.ts` 全部；`compaction.ts` 全部 | 不限（设置页用） | `./kit/shapes` 的 `MODEL_ROLES`（值导入，t32 定为可进浏览器） |
| `./contract` | 快照与结果形状（`KeyStatusSchema` 到 `CheckResultSchema`）、失败码表、`modelsSettingsSpec`（方法、事件、版本、`provider`、`callers` 的 `as const` 定义对象）、`ModelsSettingsContract` 类型、`ModelsService`、`ProfileModelDefaults`、`hasCredentials` | 不限 | `./kernel/contracts` 的类型（`ModelPort`，只 `import type`） |
| `./core` | `createModelsCore`、`ModelsConfigStore`、`chooseModel` | Bun | `./models`（目录、`buildResolution`、发现、凭据与环境的类型）、`./kernel/contracts` 的类型 |
| `./testing` | 存储一致性测试 `runModelsConfigStoreContract`、内存实现 `memoryModelsConfig`、假的 OpenAI 兼容端点 | Bun，只给测试 | 同 `./core` |

- 不取 nb-harness 的根入口与 `./kernel`（它们值导出 OMP 适配器）。`src/boundary.test.ts`：`config/`、`contract/` 的值导入只许 `typebox`、`@notnotype/nb-harness/kit/shapes`，类型导入另许 `@notnotype/nb-harness/kernel/contracts`、`@notnotype/nb-runtime/remote`，不许 `node:`、`bun`；`src/app-neutral.test.ts` 同 nb-host 的应用名扫描。nb-harness 不反向依赖本包或 nb-runtime（t32 的扫描照常通过）。
- 内置角色：`BUILTIN_ROLES`（`tiny`、`fast`、`main`、`deep` 四档与专精 `compaction`）归本包，两个应用共用；名字与说明的文字（`builtinRoleNameKey`、本地化）留在各应用。`MODEL_ROLE_IDS = {main: "main", fast: "fast", compaction: MODEL_ROLES.compaction} as const`。`config/roles.test.ts`：`BUILTIN_ROLES` 含 `MODEL_ROLE_IDS` 的每个 id，也含 nb-harness `MODEL_ROLES` 的每个 id（kit 的摘要方法按它取模型）。
- 选择顺序 `chooseModel(query, profileDefaults)`：纯函数，交回 `{role: string} | {selection: string} | {reference: string}`，顺序与现在 `port.resolve` 相同（显式角色 → 用途 `compaction` 取 `MODEL_ROLE_IDS.compaction` → 用途 `approval` 取 `fast` → 会话选择 → Profile 缺省的模型 → Profile 缺省的角色或 `main`）。`setRole` 里“第一次绑 `fast` 而压缩未绑时压缩跟着它”同样用这两个常量。`choice.test.ts` 逐行覆盖，变异检查带上（见“验证”）。
- 存储接口（接口注释即合同，由一致性测试守住）：

  ```ts
  export type SlotWriteResult =
      | {readonly ok: true}
      | {readonly ok: false; readonly code: "conflict"}
      | {readonly ok: false; readonly code: "invalid-value"; readonly detail: string}
      | {readonly ok: false; readonly code: string; readonly detail: string};   // 其余映射成合同的 settings-unavailable，code 原样带上
  export interface ConfigSlot<T> {
      /** 当前有效值；同步、不失败、只读。 */
      read(): T;
      /** 可写那一层的值；value 为 undefined 表示这层没有这个键（服务用缺省值合并）。 */
      editable(): {readonly status: "ok"; readonly value: T | undefined} | {readonly status: "unavailable" | "invalid"};
      /** expect.value 与可写那一层的当前值按规范化后的值比较，不等得 conflict、不写。 */
      write(next: T, expect: {readonly value: T | undefined}): Promise<SlotWriteResult>;
  }
  export interface ModelsConfigStore {
      readonly providers: ConfigSlot<ProviderConfig[]>;
      readonly roles: ConfigSlot<RolesConfig>;
      compaction(): CompactionSetting;
      stream(): {readonly firstEventTimeoutSeconds: number; readonly idleTimeoutSeconds: number};
      /** 有效值变化时调用，带变化的键；自己写入也要通知，外部写入同样通知。 */
      onChange(listener: (changed: ReadonlySet<"providers" | "roles" | "compaction">) => void): () => void;
  }
  ```

  四条语义写进注释：自己的写入也触发 `onChange`（快照与解析缓存只在这时作废）；`write` 交回 `ok` 后 `read()` 立刻读到新值（`setKey`、`clearKey` 第二步之后要读）；外部写入造成的 `conflict` 之后，存储要经 `onChange` 送来那次变化（服务最多等 `CATCH_UP_MS`，不送就每次冲突等满 1 秒）；`expect` 的比较如上。`runModelsConfigStoreContract(makeFixture)` 逐条检查这四条，加取消订阅后不再回调、非法值得 `invalid-value`、层不可写得 `unavailable` 或 `invalid`；包里对 `memoryModelsConfig` 跑一遍，应用对自己的适配器加真实设置场地跑一遍。
- `createModelsCore({config, credentials, env, record}) → {service, remote(consumer), close()}`：搬 `core.ts` 里的全部，形状与现在相同，只把设置服务换成 `ModelsConfigStore`。`remote(consumer)` 交回 `RemoteImplementation<ModelsSettingsContract>`；写入步骤的失败类型由合同的失败码表推出（`writeErrors`、`providerWriteErrors` 与各方法的码随定义对象进包），`relay` 只剩“这一步属于哪个方法”这一处断言。诊断事件名（`models.catalog.missing`、`models.credentials.failed`）不变。
- 应用 `plugins/models/`：
  - `shared/contracts.ts` 保留为 ADR 0025 的跨插件入口：`modelsKey = defineServiceKey<ModelsService>("nbook.models/models")`、`modelsSettingsContract = defineRemoteService({id: "nbook.models/settings", ...modelsSettingsSpec})`，转出别的插件在用的形状与函数（`ModelsSnapshot` 等类型、`hasCredentials`、`roleReference`、`roleOfReference`），`builtinRoleNameKey`、`modelsText` 不变。`agent`、`plot` 的导入因此不改。
  - `shared/settings.ts` 只剩 `modelsSettings`（`defineSettings`、分区 id、文字、`nbook.agent.reliability` 的分组与顺序），形状与缺省值从 `./config` 取；删 `shared/rules.ts`、`shared/compaction.ts`，`compaction.test.ts` 搬成 `nb-models` 的 `config/compaction.test.ts`。
  - `backend/settings-store.ts`：`settingsModelsConfig(settings)`，用 `get`、`inspect(...).user`、`update(..., {expect})`、`onDidChange` 实现存储接口，层状态映射与现在逐条相同（`absent`、`unavailable` 为 `unavailable`，`invalid` 为 `invalid`，对应合同 detail 的 `unavailable` 与 `layer-invalid`）。`backend/plugin.ts` 打开凭据库、建核心、`provideRemote(modelsSettingsContract, core.remote)`；`backend/core.ts` 删去。
  - 模型插件内部（设置页组件、`models-store.ts`、Lab 的 `models-scene`）与 `agent` 的几份 `*.llm.test.ts`（导入 `shared/rules` 的 `splitReference`）改从 `@notnotype/nb-models/config`、`/contract` 直接导入。
- NeuroBot 要在设置里配“压缩”角色与缓存寿命（提案第四节第 4、8 小节），本 Task 不实现，接口不堵死：“压缩”已是内置角色；缓存寿命以后作为服务商配置的可选字段加进 `ProviderConfigSchema`、经 `ModelTarget` 交给内核，存储接口交的是整份配置对象，不用改。

## Spec 与文档改动

行为合同不变，只改 owner、实现合同与证据（[`docs/specs/README.md`](../../../../../docs/specs/README.md#实现合同与证据)）。这些文档链接了要搬的文件，在代码合入 master 之后、在主工作区紧接着提交，再推送 master（CI 的 `docs:check` 看到的是两者一起到位的状态）。

| 文件 | 改什么 |
|---|---|
| `docs/adr/0045-…md` 与 `docs/adr/README.md` | 新 ADR（编号取写时的下一个空号，现在是 0045），见“切片”第 0 片；索引 0030 那一行补注“其中决策 2 的搬包条件已被 0045 取代” |
| `docs/specs/runtime/server-host.md` | `owners` 加 `nb-host`；实现合同：认领、宿主适配器、端口、RPC 监听、`startHostServer`（含 HTTP 与诊断由宿主装配）、HTTP 插件与回环校验改到 nb-host，应用侧写装配者、认领档案、`NBOOK_*` 读取与项目；关键不变量加“回环与来源由 nb-host 在任何监听前再核一次”；合同测试与证据改到新路径 |
| `docs/specs/runtime/browser-host.md` | `owners` 加 `nb-host`；实现合同：浏览器适配器、远程会话、RPC 套接字、客户端身份改到 nb-host，`refreshEndpoint` 由应用实现；证据路径 |
| `docs/specs/runtime/diagnostics.md` | JSONL 出口与浏览器出口的实现路径改到 nb-host |
| `docs/specs/runtime/application.md` | 实现合同里两个适配器的路径与签名（必填 `platform`） |
| `docs/specs/runtime/cli.md` | 依赖方向一句：命令行经应用的认领档案用 nb-host 的认领 |
| `docs/specs/models/service.md` | `owners` 加 `nb-models`；公开入口与依赖方向写“配置形状、规则、选择顺序、合同定义与核心在 nb-models，id、设置项与远程合同实例在 `nbook.models`”；证据路径 |
| `docs/specs/settings/configuration.md`、`docs/specs/workspace/files.md` | 若实现合同提到加锁替换的路径，改到 `nb-file-lock`（开工时 `rg locked-replace docs/specs` 核对） |
| `docs/modules/monorepo-boundaries.md` | 新增 `nb-file-lock`、`nb-host`、`nb-models` 三行（职责、子路径、依赖、不依赖应用包、private）；“新应用”一行里 plugin-platform 的搬包条件改为 ADR 0045 的说法 |
| `packages/AGENTS.md`、根 `AGENTS.md` 的仓库结构树 | 加三个包。根 `AGENTS.md` 在主工作区常有别的会话未提交的改动：先看 `git diff AGENTS.md`，别人的改动还在就等它提交后再改，或只暂存自己这几行（`git apply --cached` 一份只含这几行的补丁） |
| `docs/standards/code/common.md` 第 25 行 | 样例路径改到 nb-host 的 `start.ts` |
| `.agents/works/w00043-neurobot/README.md`、本 Task README | 决定、进度与合入记录 |

包内文档随代码在分支上改：三个新包的 `AGENTS.md`、`README.md`；`packages/neuro-book/AGENTS.md` 的目录约定（`src/backend/`、`src/plugin-platform/`）与“后端”一节。

分支上的 `docs:check` 预期只报主工作区 Spec 副本里指向已删文件的链接（`docs/specs/runtime/server-host.md`、`browser-host.md`、`diagnostics.md`、`models/service.md`、`docs/standards/code/common.md` 里指向 `src/server/host.ts`、`instance.ts`、`rpc/listener.ts`、`plugins/http/backend/`、`shared/rpc-socket.ts`、`web/host/remote-session.ts`、`plugins/diagnostics/backend/`、`plugins/models/backend/core.ts`、`shared/rules.ts`、`shared/compaction.ts`、`backend/locked-replace.ts` 的几条）；第 9 片跑完后把实际报出的清单记进 Task README，清单之外的失败仍算阻断。

## 切片

| 片 | 内容（对应关键设计） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 0 | 主工作区：主 Agent 在开发者确认本计划后写 ADR 0045，一份记四件事：新包 `nb-host`（应用名、环境变量、端口缺省、产品名、插件 id 由应用传入，安全不变量与 HTTP、诊断两个宿主插件只在包里实现）、新包 `nb-models`（合同只给定义对象、应用用自己的 id 定义，内置角色与选择顺序归包）、加锁替换的小包 `nb-file-lock`（工作区里只有它直接用 `proper-lockfile`）、部分取代 0030 决策 2（搬包条件改为“出现第二个需要第三方插件的应用”，其余不变）；索引补注；Task README 记决定。不链接还不存在的新包路径 | 一次提交（`git commit -- <路径>`） | `bun run docs:check` |
| 1 | `nb-file-lock` 整片；根 `workspaces` 加它；`scripts/ci/test-conventions.ts` 的 `STRICT_TEST_ROOTS` 加 `packages/nb-file-lock/`；应用 26 个文件改导入、`startup.ts` 改用 `lockHeld`、类型声明与依赖迁移、`architecture.test.ts` 的平台允许表与运行位置表一行；补丁校验脚本加一条；`bun install` | 一次提交 | nb-file-lock：`bun run typecheck`、`bun test`；neuro-book：`bun run typecheck`、`bun test src/backend src/plugins/files src/plugins/settings src/plugins/canon src/plugin-platform src/server/projects src/architecture.test.ts`；根：`bun scripts/ci/validate-proper-lockfile-patch.ts`；`bun run test:affected` 的选择结果里出现 nb-file-lock |
| 2 | nb-host 包骨架：`package.json`、两份 tsconfig、`AGENTS.md`、`README.md`、`architecture.test.ts`；根 `workspaces`、`STRICT_TEST_ROOTS` 加 nb-host；应用 `dependencies` 加 nb-host 与 `src/server/dev/watch.test.ts` 的监视根列表；`shared/socket.ts` 与 `./testing` 的套接字工具搬入、改全部导入；应用 `architecture.test.ts` 的运行位置表加 nb-host 两行；`bun install` | 一次提交 | nb-host：`bun run typecheck`、`bun test`；neuro-book：`bun test src/server/dev/watch.test.ts src/server/rpc src/web/host/window.test.ts src/architecture.test.ts`、`bun run typecheck`、`bun run build:web`、`bun run build:sdk`（产物的 d.ts 不出现 `@notnotype/nb-host`）；开发模式页面加载：`nbdev dev start` 后 `nbdev shot` 打开工作台，页面正常、控制台没有模块解析错误；`bun run test:affected` 的选择结果里出现 nb-host |
| 3 | `loopback.ts`、`ports.ts`、`claim.ts`；应用 `config.ts` 改用校验函数、`instance.ts` 改成认领档案、命令行与测试支持改用档案、`dev/run.ts` 改导入；`instance.test.ts`（连同真实子进程入口 `claim-child.ts`，改成只用 nb-host 与 `acme` 档案）、`ports.test.ts` 搬入；回环与来源的校验测试 | 一次提交 | nb-host：`bun test src/server`；neuro-book：`bun test src/server/config.test.ts src/cli src/server/server.test.ts src/server/dev` |
| 4 | `http/` 与 `shared/http-contracts.ts`：搬准入、分发、页面资源、插件工厂与合同；应用 `src/plugins/http/` 只留描述，12 个文件改导入；`admission.test.ts`、`dispatch.test.ts`、`static.test.ts` 搬入；分发层的来源用例（真实服务的来源测试随第 5 片，见“验收映射”）；应用 `serverHostPlugins["nbook.http"]` 改调过渡用的 `createHostPlugins`（见表后说明） | 一次提交 | nb-host：`bun test src/http`；neuro-book：`bun test src/server src/plugins/files src/plugins/workbench/theme-editor.test.ts src/architecture.test.ts`、`bun run typecheck` |
| 5 | 诊断出口（服务端与浏览器两份）、`host.ts`、`rpc-listener.ts`、`start.ts` 的 `startHostServer`；应用 `start.ts` 改成装配者、`plugins.ts` 删 `serverHostPlugins`、`project/start.ts` 与 `project/plugins.ts` 改从 nb-host 取并传必填的 `platform`；约 30 份测试的控制台出口导入；`rpc/listener.test.ts`、诊断的三份测试搬入；`server.test.ts` 按“验收映射”逐条拆 | 一次提交 | nb-host：`bun test`、`bun run typecheck`；neuro-book：`bun test src/server src/project src/web/host src/plugins/diagnostics`、`bun run typecheck` |
| 6 | `web/`：浏览器适配器、远程会话（注入 `refreshEndpoint`）、`openRpcSocket`、`ConnectionError`、客户端身份；应用 `connection.ts`、`window.ts`、`boot.ts` 改接线；`browser-host.test.ts`、`remote-session.test.ts` 搬入（远程会话改用 nb-host 的 `startHostServer` 与 `acme` 档案起真实服务端）；新增 `rpc-socket.test.ts`、`client-identity.test.ts`；应用新增 `refreshEndpoint` 的直接测试与重连时版本变化的窗口用例 | 一次提交 | nb-host：`bun test src/web`、`bun run typecheck`；neuro-book：`bun test src/web`、`bun run test:vitest src/web`、`bun run typecheck`、`bun run build:web`；开发模式页面加载同第 2 片 |
| 7 | t32 合入、本分支变基到 master 之后：`nb-models` 包骨架、`./config`（含 `roles.test.ts` 对 `MODEL_ROLES` 的断言）、`./contract`；第一步先核对 `defineRemoteService({id, ...modelsSettingsSpec})` 推出的合同类型能交给 `provideRemote` 与 `context.remote.use`、不退化成 `unknown`；应用 `shared/contracts.ts`、`shared/settings.ts` 改从包取，删 `shared/rules.ts`、`shared/compaction.ts`，设置页、Lab 夹具、`agent` 的 `*.llm.test.ts` 改导入；运行位置表加 nb-models 三行 | 一次提交 | nb-models：`bun run typecheck`、`bun test src/config src/contract`；neuro-book：`bun test src/plugins/models src/plugins/agent/web src/architecture.test.ts`、`bun run test:vitest src/plugins/models src/plugins/agent/web`、`bun run typecheck`、`bun run build:web`、`bun run build:sdk` |
| 8 | `./core`（`chooseModel`、`createModelsCore`、存储接口）与 `./testing`（一致性测试、内存实现、假端点）；应用 `backend/settings-store.ts`、`backend/plugin.ts` 改接线，删 `backend/core.ts`；应用对 `settingsModelsConfig` 跑一致性测试 | 一次提交 | nb-models：`bun test`、`bun run typecheck`；neuro-book：`bun test src/plugins/models src/plugins/agent/backend src/plugins/plot`、`bun run typecheck` |
| 9 | 包内文档；“验证”一节的合入前清单 | 一次提交 | 见“验证” |
| 合入后 | 主工作区先 `bun install`（master 新增了工作区成员）；“Spec 与文档改动”表里除 ADR 外的各项 | 一次提交（`git commit -- <路径>`；根 `AGENTS.md` 见该表的注） | `bun run docs:check`、`bun run governance:check` |

第 4 片的过渡：HTTP 插件的工厂在包内不导出，但第 4 片时 `startHostServer` 还没有。做法是第 4 片把“宿主插件签发”做成包内模块 `server/host-plugins.ts`，先从 `./server` 导出 `createHostPlugins({store, admission, allowOrigin, onListening, listen, http})`（此时只签发 HTTP）给应用的 `serverHostPlugins` 过渡使用；第 5 片它加上诊断、由 `startHostServer` 接管，并从 `./server` 的导出里删掉，此后应用不再能自带 `allowOrigin`。

顺序的理由：`nb-file-lock` 没有依赖、不碰 t32 的文件，先做；认领要用它。套接字链路是两端共用的底，随骨架搬；认领与回环校验不依赖别的块；HTTP 插件是 `startHostServer` 的插件之一，先于它；诊断出口与 `startHostServer` 同片，因为宿主要自己建它；浏览器侧的测试要起真实服务端，排在服务端之后；模型要 t32 的 `kit/shapes.ts`，放最后，其中形状与规则（第 7 片）先于核心（第 8 片），核心那片单独审。每片结束时应用完整可用。第 1 到 6 片可以在 t32 合入之前做完、先合入，第 7、8 片单独再合一次。

## 验收映射

| Spec 编号或用例 | 覆盖 |
|---|---|
| `runtime.server-host` 验收 11（非回环、来源格式） | nb-host `server/loopback.test.ts`（校验函数与两种回环写法；非回环 host 加 `shiftPorts` 时没有发生任何监听、认领已放下；`startRpcListener` 与端口试探收到 `0.0.0.0` 时不监听即失败）；应用 `config.test.ts`（`NBOOK_*` 的读与拒绝）、`server.test.ts`“产品入口拒绝在非回环地址上监听”（真实子进程） |
| 验收 17（`Host` 421、写请求 `Origin` 403） | nb-host `http/origin.test.ts`：真实 `startHostServer` 与 `acme` 档案，用 `node:net` 发原始请求带 `Host: evil.example:<端口>` 得 421；`POST` 带 `Origin: null` 与 `http://evil.example` 得 403；本页来源、不带 `Origin` 的写与任意来源的 `GET` 照常；同一张来源表分别走 HTTP 写请求与 RPC 升级，放行与拒绝逐项相同。`dispatch.test.ts` 搬入的两条留作分发层用例。应用 `server.test.ts` 留一条产品冒烟：经 `startClaimedServer` 的真实服务端得 421 与 403 |
| 宿主插件核对 | nb-host `server/start.test.ts` 同进程组：经 `definitionAt` 式包装后仍通过；漏掉 HTTP 插件、换掉它的入口时 `ServerAssemblyError` 且认领已放下 |
| 验收 12、13（RPC 来源、门、端口占用与顺延、RPC 停止） | nb-host `server/rpc-listener.test.ts`（真实 Bun 监听与真实 WebSocket，503 文字带传入的产品名）、`server/start.test.ts` 的 RPC 组；应用 `server.test.ts` 留“三个回环来源与 `NBOOK_ALLOWED_ORIGINS` 放行、其它 403”；`e2e/rpc.e2e.ts`“页面来源”；`smoke:server` 的外站握手 |
| 验收 18（一个状态根一个实例） | nb-host `server/claim.test.ts`（搬自 `instance.test.ts`：真实子进程的第二个认领者、`SIGSTOP` 不接管、`SIGKILL` 后重新认领、同时认领只有一个；发布不合 `fields` 的应用字段时抛错）；应用 `server.test.ts` 的第二个服务端（产品入口与测试入口）、`cli/cli.test.ts`、`smoke:server` S10 |
| 验收 2、3、4、6、9、10、19、21 | nb-host `server/start.test.ts`（真实子进程：启动失败、SIGTERM 与 SIGHUP 与标准输入停止、在途请求、关闭失败、未捕获异常、未处理拒绝、标准输入结束；同进程：排空超时、等待就绪的请求 503、装配失败）与 `http/dispatch.test.ts`（路由抛错）；应用 `server.test.ts` 留“启动后 health 200、标准输入 stop 依赖逆序关闭”一条经产品装配的真实子进程用例；`smoke:server` |
| 扩展钩子的三条时序 | nb-host `server/start.test.ts` 同进程组：启动中请求停止时 `ready()` 不调用；`stopping()` 拒绝时退出码 1、失败里有“停止步骤失败：排空”；`ready()` 调用时认领已发布、等待中的请求已放行 |
| `server.test.ts`“后端宿主（同进程）”组的用例去向 | 逐条按用例名列：两个插件同时提交 `http.routes` 各挂自己的前缀、同一插件两个入口都提交 `http.routes` 都判 `duplicate-contribution` 且别的插件照常挂载，进 nb-host `http/routes.test.ts`（真实宿主、中性 id 的测试插件）；前端构建目录缺少 `index.html` 时 http 入口激活失败、以 1 退出、“缺少 index.html”出现在致命通道（`runtime.startup.causes`），进 nb-host `server/start.test.ts` 同进程组；其余用例第 5 片按名逐条列进提交说明（进 nb-host、留应用或删除并写理由） |
| 验收 14、15、16、20（项目）与 7、8（开发模式） | 应用不变：`server-projects.test.ts`（含“停止开始后打开被拒”，证明项目扩展的 `stopping()` 先于排空）、`projects/manager.test.ts`、`dev/supervisor.test.ts`、`dev/run.test.ts`；e2e `projects`、`dev` |
| `runtime.diagnostics` 的服务端出口与浏览器出口 | nb-host `server/diagnostics/jsonl-exporter.test.ts`、`plugin.test.ts`、`web/diagnostics/console-exporter.test.ts`（搬入）；应用 `server.test.ts` 的“诊断先发布”一条（`published[0]` 为 `runtime.diagnostics`） |
| `runtime.browser-host` 验收 6、8、9 | nb-host `web/remote-session.test.ts`（真实服务端与 WebSocket、手动时钟：退避间隔、每次重取端点、换进程转终态、`incompatible` 带应用给的原因、`close()` 中止在途的 `refreshEndpoint`）；应用 `refreshEndpoint` 的直接测试（版本不同交回 `incompatible`、结构不符交回 `retry`、取引导抛错交回 `retry` 且记原因）与 `window.test.ts`“重连时引导版本变化转 incompatible”（真实后端，经 TCP 转发掐断）；`e2e/rpc.e2e.ts` |
| `runtime.browser-host` 的 RPC 套接字与客户端身份 | nb-host `web/rpc-socket.test.ts`（真实 `Bun.serve` WebSocket：打开成功、端口没人听得 `ConnectionError`、打开前关闭、服务端关闭后 `onClose`；`rpcSocketUrl` 的 `http→ws`、`https→wss`、换端口、保持主机名）、`web/client-identity.test.ts`；`e2e/lab.e2e.ts` 读 `nbook.client-identity`（真实存储） |
| `runtime.application` 的两个适配器 | nb-host `web/browser-host.test.ts`（搬入，加“清单里带 `platform` 覆盖不了档案”）、`server/start.test.ts` 的停止来源汇合与监听移除 |
| `runtime.plugin-channel` “WebSocket 传输与握手”第 2 条 | nb-host `server/rpc-listener.test.ts` |
| `settings.configuration` 输出 14、`workspace/files` 的“读取与保存” | nb-file-lock `index.test.ts`（搬入的接管用例，加两条真实子进程用例：并发替换不丢更新、持锁进程被暂停后接管只报诊断不崩）；应用 `settings`、`files` 的现有测试只改导入 |
| `models.service` 输出 6、13、15 | nb-models `core/core.test.ts`（内存存储：冲突后重读再写、三次仍冲突为 `write-conflict`、`setKey` 两步、删除时解绑）；一致性测试对内存实现与应用的 `settingsModelsConfig`（真实设置场地）各跑一遍，证明两边的冲突语义一致；应用 `models.test.ts` 原样保留 |
| `models.service` 输出 8（选择顺序） | nb-models `core/choice.test.ts`（每一步一条，含用途 `compaction`、`approval` 与 Profile 缺省）、`config/roles.test.ts`（内置角色含 `MODEL_ROLE_IDS` 与 `MODEL_ROLES`）；应用 `models.test.ts` |
| `models.service` 输出 17 | nb-models `config/compaction.test.ts`（搬自应用） |
| `models.service` 输出 7、9、12，验收 1 到 3 | 应用 `models.test.ts`、`models.llm.test.ts`（`test:llm`，本 Task 不跑，见风险）；`e2e/models.e2e.ts` |

## 验证

每片按上表自跑。合入前（第 9 片；第 7、8 片另合时只跑与模型有关的几项）：

- 根：`bun run test:affected --typecheck`（基准 master）、`bun run governance:check`、`bun run docs:check`（预期报出的链接见“Spec 与文档改动”末段）、`bun scripts/ci/validate-proper-lockfile-patch.ts`。
- neuro-book：`bun run build`（含 `check:dist`：服务端 bundle 里仍有 `Listening on` 与 `nbook.http`）、`bun run build:sdk`（d.ts 不出现三个新包）、`bun run smoke:server`：打包后的产物里新包的代码在同一模块图里（场景 1）、认领、RPC 握手与外站来源、页面资源。打包与 smoke 按验证门禁在主工作区或干净克隆跑一遍分支的提交。
- 变异检查（[测试写法](../../../../../docs/testing/README.md#测试写法)）：逐条改坏 nb-host 的 `assertLoopbackHost`、分发的 `Host` 判断、写请求的 `Origin` 判断、RPC 升级的来源判断、宿主插件的入口核对、认领的“有应答即退出”，`nb-file-lock` 的放锁前身份核对，`nb-models` 的 `chooseModel` 里 `compaction` 与 `approval` 两步，确认对应测试失败后还原（改之前先提交或备份文件），输出存进 `evidences/`。
- e2e，合入前跑一次（7 个文件；先 `bun run build && bun run build:e2e`，再 `bunx playwright test -c e2e/playwright.config.ts e2e/rpc.e2e e2e/browser-host.e2e …`，核对 `Running N tests` 的数目）：
  - `rpc.e2e.ts`：真实 Chrome 下 RPC 来源核对、断线重连与服务端换进程，经 nb-host 的监听与远程会话；
  - `browser-host.e2e.ts`：生产构建的启动序列与协议不一致页，浏览器包解析了 nb-host 的 `./web`；
  - `projects.e2e.ts`：项目子进程走 nb-host 的宿主适配器与诊断出口（`project` 位置）、重连与宽限期；
  - `dev.e2e.ts`：开发监督进程用 nb-host 的端口顺延与来源，后端改文件后有序重启；
  - `app-package.e2e.ts`：装出来的包在仓库 `node_modules` 之外运行，三个新包与带补丁的 `proper-lockfile` 都打进了 bundle；
  - `lab.e2e.ts`：真实 `localStorage` 下的客户端身份；
  - `models.e2e.ts`（第 7、8 片）：设置页经新的远程适配走完添加、绑定、删除。
- 实施中改动后只重跑覆盖改动的文件与失败项；第 7、8 片单独合入时只跑 `models.e2e.ts`。

明确留下的未验证边界：Windows 上的认领（命名管道，Spec 已标未实测）与整个新应用；`models.llm.test.ts`（真实模型，改动不碰请求路径，本 Task 不跑）；NeuroBot 实际装配三个包（它还不存在，只由各包自己用 `acme` 档案与内存存储的测试代表）。

写计划时没有核实、在实施中核对的：Bun 收到 `Host: evil.example` 时 `request.url` 的主机名取自这个头（`dispatch.ts` 的注释这么写，第 4 片的真实服务测试核对）；`/// <reference path>` 让导入 `nb-file-lock` 的各个类型检查都拿到 `proper-lockfile` 的声明（第 1 片的 `typecheck` 核对）；`test:affected` 能自动选到新包（第 1、2 片核对）；`defineRemoteService` 展开 `modelsSettingsSpec` 后的类型推导（第 7 片第一步）；t32 合入后 `kit/shapes.ts` 的实际导出（第 7 片开工时重读）。

## 不做与风险

发布影响：应用包按 ADR 0033 发构建产物，三个新包与它们的依赖打进 `nbook.js` 与 `project.js` 的 bundle，`scripts/third-party-notices.ts` 跳过 `@notnotype/*`，新增的第三方依赖（`proper-lockfile`、Hono）应用本来就带，`THIRD-PARTY-NOTICES.md` 不变（推断，合入前的 `app-package.e2e.ts` 与打包核对）。nb-harness 不改公开面、不升版本；nb-story 的导入不变。

不做：NeuroBot 的任何代码；`plugin-platform` 搬包（条件改了，现在仍只有一个需要第三方插件的应用）；`startup-env.ts`、`omp-process.ts`、`user-directories.ts`、开发监督进程、项目管理、命令行的抽取；`staged-commit.ts` 进 `nb-file-lock`（只有 Files 用）；诊断出口的日志位置锁与加锁替换合成一把（一个长期持有带心跳、一个只在读到改名之间持有）；退出码 75（租约失效）的通道，以后加 Session Store 租约时在停止来源或扩展上加退出码，届时另定；退避表做成选项；认领应答加应用名、两个应用共用一个状态根（已知限制，写进 nb-host README）；nb-story `serve.ts` 改用 nb-host（它有一次性口令登录加会话 Cookie）；鉴权插件；三个新包发 npm（`private: true`，以后要发时按 ADR 0029 决定 6 另定，届时要处理 `proper-lockfile` 的补丁）；模型服务的缓存寿命与 NeuroBot 设置页。

风险与兜底：

- **搬坏启动与停止的顺序**：兜底是 nb-host `server/start.test.ts` 的真实子进程用例与同进程用例（真实 `Bun.serve`、真实 WebSocket、nb-runtime 的手动时钟），以及应用 `server.test.ts`、`server-projects.test.ts` 经产品装配的用例。实施时核对“停止开头的同步段”确实先调扩展的 `stopping()` 再开始两路排空：`server-projects.test.ts`“停止开始后打开被拒”就是这条。
- **宿主插件核对误判**：`definitionAt` 交回新对象；兜底是第 5 片先写“经包装后仍通过”的用例，再写“换掉入口或漏掉插件时失败”的用例，并由应用 `server.test.ts` 经真实清单装配跑通。
- **漏传平台档案或被清单覆盖**：`platform` 在两个适配器与 `startHostServer` 上都必填，适配器的清单类型去掉 `platform`、档案放后面；`browser-host.test.ts` 的覆盖用例守住。
- **应用名漏进包**：三个包的 `app-neutral` 扫描（含 `nbot`、`neurobot`）与 `acme` 档案的测试。503 文案、套接字前缀、插件 id 由选项传入，NeuroBook 的观察结果逐字相同；实施时用 `smoke:server` 与 `server.test.ts` 的现有断言核对。
- **锁参数分叉或补丁失效**：加锁替换的参数只在 `nb-file-lock`；补丁校验脚本拦下另一份 `proper-lockfile` 声明；`app-package.e2e.ts` 证明打进 bundle 的是带补丁的那份。
- **前端误引后端的新子路径**：应用 `architecture.test.ts` 的运行位置表（每个方向带反例）。
- **浏览器第一次从 nb-host 取运行时代码**：发生在第 2 片（`files`、`canon` 的合同经浏览器入口导入 `./socket`）；兜底是第 2 片起的 `build:web` 与开发模式页面加载、第 6 片再跑一次，加合入前的 `browser-host.e2e.ts`、`rpc.e2e.ts`（真实构建产物）。nb-host `web/` 的第三方依赖白名单使它不用改 `optimizeDeps`。
- **模型存储的语义两边不一致**：一致性测试对内存实现与 NeuroBook 适配器（真实设置场地）各跑一遍；应用 `models.test.ts` 不改。
- **合同类型推导不成立**：第 7 片第一步核对；不成立时包改为导出 `defineModelsSettingsContract(id)`（内部固定方法与事件、返回类型显式标注），应用仍用自己的 id 调它，再继续。
- **t32 的导出与本计划假设不同**：第 7 片开工时重读 t32 合入后的 `kit/shapes.ts`，以它为准改本计划再动手。
- **与 t32 并行时的冲突**：第 1、2、5 片改的导入行（`files`、`canon`、`agent` 的后端测试）可能与 t32 撞在同一文件；只是导入行，变基时逐处合。

## 需要开发者确认

2026-11-10 三项都按推荐算定（见 Task README“第二稿的确认项”）。

1. **小包的名字 `@notnotype/nb-file-lock`（`packages/nb-file-lock`）**：内容是跨进程锁 `holdLock` 与加锁替换 `replaceLocked`，名字按锁而不按其中一个函数取；近来的新包都用 `nb-` 前缀（`owned-process`、`file-snapshot-cache` 是更早的命名）。推荐 `nb-file-lock`；`staged-commit.ts` 留在应用（只有 Files 用）。
2. **三个新包的 exports 与 `private`**：`nb-file-lock` 只有 `.`；`nb-host` 为 `./server`、`./http/contracts`、`./socket`、`./web`、`./testing`；`nb-models` 为 `./config`、`./contract`、`./core`、`./testing`，其中 `./config`、`./contract` 可进浏览器。三个都 `private: true`、不发 npm。按 `packages/AGENTS.md` 是跨模块决策；推荐按此确认，写进第 0 片的 ADR。
3. **内置角色表归 `nb-models`、两个应用共用**：`tiny`、`fast`、`main`、`deep` 与 `compaction` 五个内置角色及选择顺序在包里，NeuroBot 的设置里也是这五个（可再加自建角色）；名字与说明的文字各应用自己写。推荐如此：选择顺序与“绑快速档时压缩跟着它”写死了其中三个 id，让应用另给内置表反而要多一层“必须包含”的核对。
