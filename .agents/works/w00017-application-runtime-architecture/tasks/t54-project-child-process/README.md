---
schema: nbook.task/v2
taskId: t54-project-child-process
---

# NeuroBook v2 第 5 步 K3：项目子进程、项目管理与客户端绑定

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K3：服务端宿主管理项目（身份、登记表、租约、宽限期、崩溃通知；锁已去掉，见计划确认第 4 项），每个打开的项目一个子进程、里面一个 `project` 位置的内核实例，经进程间链路接入服务端路由；浏览器窗口按 `/?project=` 绑定项目代次，宽限期内重连恢复、超过宽限期要求重新加载；服务端停止时先封闭接纳、再停项目子进程；最小的“打开项目”命令。

实施计划：[plan.md](plan.md)（2026-10-07 开发者确认，Context 里列出了讨论中确认的 8 项）。

行为合同（本 Task 修订）：新 Spec [`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)，以及 [`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、 [`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/application.md`](../../../../../docs/specs/runtime/application.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)。

## 前置

K1 [t52](../t52-kernel-instances-remote/README.md)（子实例与租约、远程服务路由）；K2 [t53](../t53-rpc-port-browser-connection/README.md)（服务端 RPC 端口、浏览器连接与重连）。

## 当前状态

2026-10-07 计划确认：进程间通信用 Bun IPC；宽限期 5 分钟、崩溃不自动重启；项目身份写进 `.nbook/project.json`；不做防双开的锁（遗留设计，推迟到出现项目级持久数据时再定）；项目管理由宿主以本地能力 `projectsKey` 提供，`nbook.projects` 只做界面与客户端的远程入口；合同声明提供方位置、`.at()` 可省略；无租约访问只到 `available` 的项目。

omp（默认模型）只读审查了设计：[omp-design-review.txt](evidences/omp-design-review.txt)，10 条（重要 3、建议 7），无阻断，逐条核实均成立，已修订 plan.md：
- 1 重连的同一实例判定会把绑定窗口当冒名：改为比较 `kind`、`role`、`client` 与绑定；
- 2 K1 的 `acquire` 不能按代次取租约：加 `generation` 选项与 `generation-gone`，节点再核对绑定作第二道防线；
- 3 列表带项目路径与“浏览器不获得服务端路径”冲突：开发者确认带路径，S0 改两处 Spec 的表述；
- 4 `onDisconnect` 时拿不到退出码；5 等 `started` 没有截止（加 `NBOOK_PROJECT_START_MS`）；6 `remote-location-mismatch` 的角色从远程节点取；7 租约持有者编码统一为 `leaseHolderOf`、`via` 不参与；8 停止时非 0 退出与 `started: failed` 的收口；9 绑定期间开始停止要再查一次门；10 S4 加打包验证。

2026-10-07 开发者确认列表带项目路径，开始实施。

| 片 | 状态 |
|---|---|
| S0 Spec 与文档 | 完成：新 Spec `runtime/projects.md`（`planned`）；`plugin-channel`、`plugins`、`server-host`、`browser-host`、`application`、`workspace/resources` 与拓扑稿按计划修订，README 注册表与包 AGENTS 同步。计划之外补了两条失败语义：登记副本（身份文件里的 id 仍在原路径）为 `identity-conflict`，登记表无法解析时不覆盖、相关操作以 `registry-invalid` 失败 |
| S1 合同的提供方位置 | 完成：`defineRemoteService` 必填 `provider`，`use(合同)` 在 `server`、`project` 时就是缺省目标的客户端，`at` 只接受该位置的目标；目标不符在未派发阶段 `invalid-input`；激活产出的远程提供项与实例角色不符为 `remote-location-mismatch`；方法名不能是 `at`。内核 251 例、`window.test.ts` 18 例通过，三处判据变异各被一例抓住 |
| S2 内核绑定与访问 | 完成：wire 2（`hello.bind`、`hello.boot`、`welcome.binding`，拒绝原因 `project-unavailable`、`project-gone`、`server-restarted`）；路由的 `bindProject`、`projectAccess`（取代 `holdsProjectLease`）、`accept(link, {expect})`、绑定期间链路关闭即释放、租约失效即关客户端链路；重连的同一实例按绑定判定；节点记下绑定、`project-gone` 与改投都进终态；`leaseHolderOf`；`ChildInstances.acquire` 的 `generation` 选项与 `generation-gone`；本地能力可按调用方门面提供。实施中发现服务端重启后按旧代次号判断绑定会误报“项目已关闭”，hello 加 `boot` 先比进程（Spec 与计划已补）。内核 264 例通过，12 处判据变异各被抓住 |
| S3 身份与登记表 | 完成：`src/shared/projects.ts`（共用类型）、`src/server/projects/identity.ts`（目录校验、读写身份文件，独占创建）、`registry.ts`（登记表、短名、移动、副本冲突、坏文件不覆盖、写入串行）。计划之外补一条：已登记目录丢了身份文件时按原 id 重建（Spec 已补）。`registry.test.ts` 11 例在真实临时目录上通过，8 处判据变异各被抓住；`test:bun` 204 例通过 |
| S4 项目子进程与管理器 | 完成：项目宿主 `src/project/`（启动参数、`currentProjectKey`、按清单装配 `project` 入口、`startProject`：先连路由再建实例、可用后才报 `started`、`stop` 或 IPC 断开即停、不因 SIGINT 退出）；IPC 信封与链路 `src/server/projects/ipc.ts`；项目管理器 `manager.ts`（先交路由带 `expect` 再起进程、启动截止、启动中退出与启动失败的收口、停止截止强制结束、非 0 退出写 `project.stop.incomplete`、意外退出即结束这一代、输出逐行加前缀转发、接纳门与取得后再查、停止期间的问题计入退出码）；服务端启动参数 `NBOOK_PROJECT_GRACE_MS`、`START_MS`、`STOP_MS`；`startServer` 建管理器并在停止的同步段先关项目接纳；`build:server` 另打 `dist/server/project.js`；`nbook.diagnostics` 加 `project` 位置，项目日志在 `<状态根>/logs/projects/<短名>/`（诊断出口按目录持有授予，S4 中改）。`manager.test.ts` 12 例（真实子进程、注入时钟）连跑 3 次通过，9 处判据变异各被抓住；`test:bun` 217 例、`bun run build`（含 `check:dist`）通过；实测见 [measure-project.txt](evidences/measure-project.txt)：启动 p50 约 55 ms、RSS 约 49 MB |
| S5 宿主接线与 `projectsKey` | 完成：路由的 `bindProject`、`projectAccess` 接到项目管理器（客户端绑定的租约记在客户端实例名下，窗口里的插件都用它；按代次重连不读登记表）；`projectsKey` 以按调用方门面作为服务端的本地能力，租约记在 `leaseHolderOf(调用方)` 名下、入口停止时随门面释放；`ServerPluginContext.projects`。实施中发现内核在建立运行实例的同步段里就开始启动激活，宿主能力改为等管理器建好再交出。测试：探针加项目入口（`test.remote-probe/project`：echo、tick、crash、订阅）与服务端的无租约控制路由，故障插件加 `start-on-signal`；`src/server/testing/projects.ts` 共用真实子进程的测试支持；`projects-capability.test.ts` 3 例、`server-projects.test.ts` 7 例（同进程注入时钟推宽限期；真实子进程看停止顺序与强制结束的退出码）连跑通过，7 处判据变异各被抓住；`test:bun` 227 例通过 |
| S6 `nbook.projects` | 完成：插件描述进产品清单；服务端入口把 `projectsKey` 的列出与登记包成远程服务 `nbook.projects/projects`（列表带短名、目录路径、运行状态，不含 pid）；浏览器入口贡献命令 `nbook.project.open`：列出项目，选中即整页导航 `/?project=<短名>`，输入路径先登记再导航，登记失败带原因重新选择。“经命令面板的快速输入”落成命令面板的**选择模式**（工作台提供 `quickPickKey`，单步、无前缀，结果在浮层关闭完成后交回命令），`workbench.quick-open` Spec 与组件 `.md` 同步；整页导航经窗口选项 `navigateDocument` 交给浏览器插件工厂。两个入口都以诊断为依赖根，`server.test.ts` 的插件列表随之更新。`projects.test.ts` 3 例、面板组件测试 2 例、`searchPickItems` 1 例；6 处判据变异各被抓住；`test:bun` 231 例、`test:vitest` 55 例通过。未做：Lab 命令场景里的选择模式（四主题与 390px 的视觉验收），选择模式复用同一 QuickInput |
| S7 窗口绑定与宿主页 | 完成：窗口选项 `project`（启动时从地址栏 `project` 参数取）交给浏览器节点的绑定请求；ready 带 `project`，并以本地能力 `windowProjectKey` 交给本窗口插件；工作台 `/` 页显示当前项目短名（`data-workbench-project`）；新失败状态 `project-unavailable`（可原地重试）与 `project-gone`（终态，同服务端已重启，停止运行实例、不再重连）；宿主页加“无法打开项目”“项目已关闭”，两页另给“不打开项目”链接到 `/`。`window.test.ts` 新增 5 例（真实服务端与项目子进程：绑定与共用代次、未登记后登记重试、宽限期内重连 onResync、宽限期满后 project-gone、崩溃后 project-gone），`FailurePage.dom.test.ts` 2 例；5 处窗口判据与 1 处宿主页判据变异各被抓住；`test:bun` 236 例、`test:vitest` 57 例通过 |
| S8 真实 Chrome 与打包产物 | 完成：浏览器探针在窗口绑定项目时挂上项目探针（echo、tick、crash、订阅）；`e2e/projects.e2e.ts` 5 例在本机 Chrome 上通过（“打开项目”登记并整页打开、工作台显示短名；两页共用代次、掐断一页后宽限期内重连 onResync；宽限期满后子进程收口、再开得到新代次；崩溃转项目已关闭、“不打开项目”回 `/`；未登记项目的无法打开项目页）；`commands.e2e.ts` 改为面板列出“打开项目”；`smoke:server` 加 S7（打包产物起项目子进程、welcome 带代次、以 0 退出）。实施中发现命令 id 必须用 `workbench.commands` 的域词表：`nbook.projects.open` 被命令表拒绝，改为 `nbook.project.open`（Spec 与命令目录同步），并补一例在产品浏览器插件装配后核对命令已登记的测试（旧 id 的变异被它抓住）；浏览器入口改为 `onStartup` 激活（命令随贡献方激活才进命令表）。待 S9 跑全量 e2e |
