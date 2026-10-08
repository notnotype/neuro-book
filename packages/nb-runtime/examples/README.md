# nb-runtime 示例插件

一组按生产格式写的示例插件，演示内核的典型用法，也可以当写新插件的样板。插件放在 `plugins/`，示例宿主给插件的本地能力的键放在 `shared/host.ts`，把插件装进运行实例、核对行为的场景放在 `scenarios/`。

```text
bun test packages/nb-runtime/examples                 # 只跑示例的场景
bun run --cwd packages/nb-runtime test                # 连同内核测试一起跑
```

## 几个概念

| 概念 | 是什么 | 范围 | 代码里 |
|---|---|---|---|
| 插件 | 发布、启用、版本的单位，一个目录 | 跨所有运行位置 | `plugin.ts` 的插件描述 `PluginDescriptor`（id、版本、运行位置） |
| 入口 | 插件在某一种运行位置上的代码，单独激活，有自己的激活代次 | 一个运行实例 | 插件定义常量 `PluginDefinition` 的 `entries`，每个实例只激活本位置的入口 |
| 服务 | 一个入口交给**同一实例里**其它入口用的对象：同步调用、声明依赖、按依赖顺序激活与释放 | 同一实例 | `provide`（共享一份）、`providePerConsumer`（每个调用方一份） |
| 宿主能力 | 宿主交给本实例插件的东西（时钟、状态根、整页导航），插件像依赖服务一样声明 | 同一实例 | 宿主在应用清单的 `capabilities` 里给出；插件在 `dependencies` 里声明 |
| 远程服务 | 跨实例的协议：异步、可序列化、有失败码，不构成依赖；第一次调用时激活提供方 | 跨实例 | `defineRemoteService`、`provideRemote`；调用方 `context.remote.use(合同).at(目标)` |
| 贡献与贡献点 | 声明式扩展：拥有者定义扩展点，别的插件交“声明 + 实现”，彼此没有依赖 | 同一实例 | 命令、页面、菜单项 |

典型结构：**插件两端之间用远程服务，对外用本地服务**。一个插件的后端入口与浏览器入口以远程服务通信，这是插件自己两端的协议；浏览器入口再把它包成本地服务交给窗口里的其它插件。别的插件只依赖本地服务，不直接调远程合同。`counter`、`board`、`cloud-notes` 都是这样，`nbook.storage` 也是。

## 运行位置与目录

| 级别 | 运行位置 | 实例 | 代码目录 |
|---|---|---|---|
| 应用级 | `server` | 服务端进程，一个 | `backend/` |
| 项目级 | `project` | 每个打开的项目一个（产品里是一个项目子进程） | `backend/`（与服务端共用，入口声明的运行位置不同） |
| 客户端级 | `browser`（以后有 `tui`） | 每个窗口一个 | `web/` |

```text
plugins/<插件>/
├── plugin.ts            # 插件描述：id、版本、有入口的运行位置
├── shared/contracts.ts  # 对其它插件公开的合同：服务接口与键、远程服务合同、贡献点
├── backend/plugin.ts    # 后端代码的插件定义常量（server、project 位置的入口）
└── web/plugin.ts        # 浏览器代码的插件定义常量
```

目录格式与应用包的内置插件相同（[`packages/neuro-book/AGENTS.md`](../../neuro-book/AGENTS.md) 的“目录约定”）：

- 服务键按服务 id 识别，只在提供方的 `shared/contracts.ts` 定义一次（[ADR 0026](../../../docs/adr/0026-plugin-definitions-as-constants.md) 沿用 ADR 0025 的这条约定）。别的插件在运行时只引用对方的这个文件，类型可以 `import type`。
- 插件定义是常量，没有工厂参数（[ADR 0026](../../../docs/adr/0026-plugin-definitions-as-constants.md)）：要宿主的东西就依赖宿主能力（例如 `clock` 依赖 `shared/host.ts` 的 `hostClockKey`），对别的插件的依赖同样写在入口的 `dependencies` 里。定义按代码所在的一侧导出，后端不能引用浏览器代码；一份后端定义可以含 `server` 与 `project` 两个位置的入口，它们可以提供同一个服务 id，各在本位置的实例里提供。只有宿主自己的适配器（应用包的诊断与 HTTP）是工厂，例外要说明启动或停机依赖。
- `web/` 与 `backend/` 互不引用，只经 `shared/` 交换类型与 schema；`plugins/` 下的代码也过浏览器那份类型检查，不用 Bun 与 Node 的接口。
- 插件清单文件（`package.json`，[`runtime.plugin-manifest`](../../../docs/specs/runtime/plugin-manifest.md)）实现后，示例随之改成清单格式。

## 插件

| 插件 | 运行位置 | 演示什么 |
|---|---|---|
| [clock](plugins/clock/) | server | 依赖宿主能力里的时钟，包成共享的报时服务（`provide`）；不声明激活事件，有入口依赖它时才激活 |
| [greeter](plugins/greeter/) | server | 依赖另一个插件的服务：服务键从对方的合同模块引用，激活前内核先解析依赖 |
| [notes](plugins/notes/) | server | 按调用方生成门面（`providePerConsumer`）：每个插件只看到自己的数据，门面随调用方释放 |
| [menu](plugins/menu/) | server | 定义贡献点：逐条校验声明、接收者维护表、每次执行经 `implementation()` 取实现 |
| [file-menu](plugins/file-menu/) | server | 向贡献点提交声明与实现，与拥有者之间没有服务依赖 |
| [counter](plugins/counter/) | server、browser | 一个插件两端之间的远程服务：合同、第一次调用时按需激活、订阅；浏览器入口把它包成本地服务 |
| [board](plugins/board/) | project、browser | 项目级插件：每个项目实例一份，窗口经 `.at("project")` 到达它绑定的那个项目 |
| [cloud-notes](plugins/cloud-notes/) | server、browser | 浏览器入口以调用方身份代理（`remote.on`、`remoteDelegates`、代理允许清单），`nbook.storage` 的同款结构 |

## 场景

| 场景 | 用到的插件 | 行为合同 |
|---|---|---|
| [01-services](scenarios/01-services.test.ts) | clock、greeter（宿主给时钟能力；不给时 clock 受阻） | [services](../../../docs/specs/runtime/services.md)、[plugins](../../../docs/specs/runtime/plugins.md)、[application](../../../docs/specs/runtime/application.md) |
| [02-per-consumer](scenarios/02-per-consumer.test.ts) | notes | [services](../../../docs/specs/runtime/services.md) 输出第 11–12 条 |
| [03-contribution-point](scenarios/03-contribution-point.test.ts) | menu、file-menu | [plugins](../../../docs/specs/runtime/plugins.md) 输出第 15–18 条 |
| [04-remote-service](scenarios/04-remote-service.test.ts) | counter | [plugin-channel](../../../docs/specs/runtime/plugin-channel.md) |
| [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts) | cloud-notes | [services](../../../docs/specs/runtime/services.md) 输出第 13 条、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md) 输出第 10 条 |
| [06-project-instance](scenarios/06-project-instance.test.ts) | board | [projects](../../../docs/specs/runtime/projects.md)、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md) |

- [`hosts.ts`](scenarios/hosts.ts) 像应用包的宿主那样把插件与宿主能力装进运行实例：服务端带路由，项目实例与窗口经 `@notnotype/nb-runtime/remote/testing` 的进程内链路连上它（产品里项目实例经 Bun IPC、窗口经 WebSocket，帧同样经 JSON 编解码），窗口按项目名绑定项目、可以断线重连；同一项目上一代停完才能起下一代。每个场景在 `afterEach` 里停止全部实例并核对正常关闭。
- [`probes.ts`](scenarios/probes.ts) 的探针站在“使用这些服务的插件”的位置上，把拿到的服务交给场景；产品里没有这样的插件。
- 场景遵守 [测试写法](../../../docs/testing/README.md#测试写法)：真实内核实例，不用 mock、spy、假计时器与固定等待，时间由注入的时钟推进。

## 写法与维护

- 示例只经包的公开入口（`@notnotype/nb-runtime/<机制>`）引用内核，和包外的插件一样，不深导入 `src/`。
- 注释写这样做的原因与要遵守的约束，行为细节链接 Spec；一个插件只演示一两件事。
- 内核的公开接口改动时，同一提交里更新受影响的示例；新增机制或出现新的典型用法时，补插件与场景。场景随 `bun run test` 运行，接口改了示例没跟上会直接失败。
