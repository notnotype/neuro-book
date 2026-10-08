# 示例插件

一组按生产格式写的示例插件，演示内核的典型用法，也可以当写新插件的样板。插件放在 `plugins/`，示例宿主给插件的本地能力的键放在 `shared/host.ts`，把插件装进运行实例、核对行为的场景放在 `scenarios/`。

```text
bun test packages/neuro-book/examples                 # 只跑示例的场景
bun run --cwd packages/neuro-book test:bun            # 连同应用包的其它 bun 测试一起跑
```

## 几个概念

| 概念 | 是什么 | 范围 | 代码里 |
|---|---|---|---|
| 插件 | 发布、启用、版本的单位，一个目录 | 跨所有运行位置 | `plugin.ts` 的插件描述 `PluginDescriptor`（id、版本、运行位置） |
| 入口 | 插件在某一种运行位置上的代码，单独激活、单独受阻，有自己的激活代次；同一位置可以有多个入口 | 一个运行实例 | 插件定义常量 `PluginDefinition` 的 `entries`，每个实例只激活本位置的入口 |
| 服务 | 一个入口交给**同一实例里**其它入口用的对象，以服务 id 标识 | 同一实例 | `provide`（共享一份）、`providePerConsumer`（每个调用方一份） |
| 依赖 | **入口**声明“我需要服务 id 为 S 的服务”；只在本实例里解析，提供方先激活、后停止，缺了只有这个入口受阻 | 同一实例 | 入口的 `dependencies`，激活时 `context.services.require(键)` |
| 宿主能力 | 宿主交给本实例插件的东西（时钟、状态根、整页导航），插件像依赖服务一样声明 | 同一实例 | 宿主在应用清单的 `capabilities` 里给出；插件在 `dependencies` 里声明 |
| 远程服务 | 跨实例的协议：异步、可序列化、有失败码，不构成依赖；第一次调用时激活提供方。同一实例里的调用方也直接用合同 | 任意实例之间 | `defineRemoteService`、`provideRemote`；调用方 `context.remote.use(合同).at(目标)` |
| 贡献与贡献点 | 声明式扩展：拥有者定义扩展点，别的插件交“声明 + 实现”，彼此没有依赖 | 同一实例 | 命令、页面、菜单项 |

几个概念之间的关系：

```text
插件 example.writer（发布单位，本身不运行）
├─ 入口 server（server）──依赖──▶ 服务 nbook.storage/storage        由同一服务端实例里 nbook.storage 的 server 入口提供
├─ 入口 main（browser） ──依赖──▶ 服务 nbook.workbench/quick-pick   由同一窗口里 nbook.workbench 的 browser 入口提供
│                       ──远程调用──▶ 合同 example.writer/remote     不是依赖
└─ 入口 tts（browser）  ──依赖──▶ 服务 example.tts/speak             缺了只有这个入口受阻
```

依赖属于入口，指向服务 id，只在入口所在的实例里解析；插件和插件之间没有依赖。远程调用与贡献都不是依赖：不会让任何入口受阻。

一个入口能做的事：

- **静态声明**（激活前内核就知道）：`location`、`activationEvents`、`dependencies`、`provides`、`remoteProvides`、`receives`、`contributions`，内置代理插件另有 `remoteDelegates`。
- **激活时能用的**（`activate(context)`）：`context.services.require` 与 `resolve` 拿本地服务；`context.remote.use(合同).at(目标)` 调用、订阅远程服务，`instances()` 列出实例；`context.declarations` 查询已接受的贡献声明；`context.scope` 登记资源，`context.signal` 得知自己被停止。
- **激活产出**：本地服务、远程服务、贡献的实现，以及本插件贡献点的接收者；用 `defineEntry` 定义时，产出与静态声明不一致在编译期报错。
- **内核替它做的**：依赖的服务先激活；停止时先停依赖它的入口；撤回它交出去的服务、贡献、远程门面与订阅；关闭它的作用域。

选哪种方式（全文见 [`runtime.plugin-api`](../../../docs/specs/runtime/plugin-api.md) 的“选用规则”与“可选功能”）：只传数据、调用方可能在别的实例的接口定义成远程服务合同，所有调用方直接用合同，不写只原样转发的本地服务包装；只在同一实例里用的接口是本地服务（给第三方插件的仍按数据面约束写：异步、可序列化；要同步调用或传运行期对象的只限内置插件之间）；许多插件各交声明与实现的是贡献点；在远程服务之上加东西（缓存、选路、代调用方身份访问）时才用本地服务包装远程服务，`notes` 的浏览器入口与 `nbook.storage` 就是这样。

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

目录格式与应用包的内置插件相同（[`packages/neuro-book/AGENTS.md`](../AGENTS.md) 的“目录约定”）：

- 服务键按服务 id 识别，只在提供方的 `shared/contracts.ts` 定义一次（[ADR 0026](../../../docs/adr/0026-plugin-definitions-as-constants.md) 沿用 ADR 0025 的这条约定）。别的插件在运行时只引用对方的这个文件，类型可以 `import type`。
- 插件定义是常量，没有工厂参数（[ADR 0026](../../../docs/adr/0026-plugin-definitions-as-constants.md)）：要宿主的东西就依赖宿主能力（例如 `clock` 依赖 `shared/host.ts` 的 `hostClockKey`），对别的插件的依赖同样写在入口的 `dependencies` 里。定义按代码所在的一侧导出，后端不能引用浏览器代码；一份后端定义可以含 `server` 与 `project` 两个位置的入口，它们可以提供同一个服务 id，各在本位置的实例里提供。只有宿主自己的适配器（应用包的诊断与 HTTP）是工厂，例外要说明启动或停机依赖。
- `web/` 与 `backend/` 互不引用，只经 `shared/` 交换类型与 schema；`plugins/` 下的代码也过浏览器那份类型检查，不用 Bun 与 Node 的接口。
- 插件清单文件（`package.json`，[`runtime.plugin-manifest`](../../../docs/specs/runtime/plugin-manifest.md)）实现后，示例随之改成清单格式。

## 插件

| 插件 | 运行位置 | 演示什么 |
|---|---|---|
| [clock](plugins/clock/) | server | 依赖宿主能力里的时钟，包成共享的报时服务（`provide`）；不声明激活事件，有入口依赖它时才激活；`context.scope` 登记宿主计时器，`context.signal` 得知停止 |
| [notes](plugins/notes/) | server、browser | 服务端：必需依赖 `nbook.storage`、可选依赖 clock（`resolve`），`provideRemote` 按调用方生成门面；浏览器：按调用方提供笔记视图，以调用方身份代理（`remote.on`、`remoteDelegates`、代理允许清单），维护同步可读的缓存，`nbook.storage` 的同款结构 |
| [menu](plugins/menu/) | server | 定义贡献点：逐条校验声明、贡献方发布后接收者经 `published` 放进表、每次执行经 `implementation()` 取实现 |
| [file-menu](plugins/file-menu/) | server | 向贡献点提交声明与实现，与拥有者之间没有服务依赖 |
| [counter](plugins/counter/) | server、project | 服务端：远程服务、`defineStore` 持久化计数、公开键与命令；项目：每个项目实例一份，窗口省略 `.at()` 即到达绑定的项目 |

## 场景

| 场景 | 用到的插件 | 行为合同 |
|---|---|---|
| [01-services](scenarios/01-services.test.ts) | clock、notes（宿主给时钟能力；不给时 clock 受阻、notes 照常） | [services](../../../docs/specs/runtime/services.md)、[plugins](../../../docs/specs/runtime/plugins.md)、[application](../../../docs/specs/runtime/application.md) |
| [02-per-consumer](scenarios/02-per-consumer.test.ts) | notes（服务端） | [services](../../../docs/specs/runtime/services.md) 输出第 11–12 条 |
| [03-contribution-point](scenarios/03-contribution-point.test.ts) | menu、file-menu | [plugins](../../../docs/specs/runtime/plugins.md) 输出第 15–18 条 |
| [04-remote-service](scenarios/04-remote-service.test.ts) | counter（窗口里的面板直接调用；`orThrow` 只取值；订阅归发起它的入口，入口停止即结束） | [plugin-channel](../../../docs/specs/runtime/plugin-channel.md) |
| [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts) | notes（浏览器端） | [services](../../../docs/specs/runtime/services.md) 输出第 13 条、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md) 输出第 10 条 |

- [`testing/stage.ts`](testing/stage.ts) 像应用包的宿主那样把内置插件（诊断、`nbook.state`、`nbook.commands`、`nbook.storage`）与示例插件装进运行实例，给出状态根、时钟与项目；服务端带路由，项目实例与窗口经进程内链路连上它。
- [`probes.ts`](testing/probes.ts) 的探针站在“使用这些服务的插件”的位置上，把拿到的本地服务（`serviceProbe`）或以探针身份的远程访问（`remoteProbe`）交给场景；产品里没有这样的插件。
- 场景遵守 [测试写法](../../../docs/testing/README.md#测试写法)：真实内核实例，不用 mock、spy、假计时器与固定等待，时间由注入的时钟推进。

## 写法与维护

- 示例只经包的公开入口（`@notnotype/nb-runtime/<机制>`）引用内核，和包外的插件一样，不深导入 `src/`。
- 入口都用 `defineEntry` 定义，激活产出与静态声明不一致在编译期报错；按运行位置分支时在整个产出上分支。
- 注释写这样做的原因与要遵守的约束，行为细节链接 Spec；一个插件只演示一两件事。
- 内核的公开接口改动时，同一提交里更新受影响的示例；新增机制或出现新的典型用法时，补插件与场景。场景随 `bun run test` 运行，接口改了示例没跟上会直接失败。
