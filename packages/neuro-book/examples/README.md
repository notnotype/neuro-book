# 示例插件

五个按第三方插件写法写的示例插件，演示内核的主要机制与内置插件（`nbook.storage`、`nbook.state`、`nbook.commands`）的用法，也可以当写新插件的样板。每个示例插件都装进真实的内置插件运行，由五个场景测试核对行为。

讲解写在代码旁边：每个文件开头说明它演示什么、对应哪个场景，关键的每一步说明做什么、为什么、不这样会怎样，并链接 Spec。本文件只做目录、概念与阅读顺序，不贴代码。

## 阅读顺序

先读下面的“几个概念”，再按场景编号读，每个场景先读它用到的插件，最后读场景本身：

1. [01-services](scenarios/01-services.test.ts)：服务与依赖。先读 [clock](plugins/clock/)（`shared/contracts.ts` → `backend/plugin.ts`），再读 [notes](plugins/notes/) 的 `shared/contracts.ts` 与 `backend/plugin.ts`。
2. [02-per-consumer](scenarios/02-per-consumer.test.ts)：按调用方提供。重读 notes 服务端入口里 `provideRemote` 的工厂。
3. [03-contribution-point](scenarios/03-contribution-point.test.ts)：贡献点。先读 [menu](plugins/menu/)，再读 [file-menu](plugins/file-menu/)。
4. [04-remote-service](scenarios/04-remote-service.test.ts)：远程服务、项目实例、插件状态与命令。读 [counter](plugins/counter/)。
5. [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts)：以调用方身份代理。读 notes 的 `web/plugin.ts`。

场景用到的场地与探针在 [`testing/`](testing/)，宿主给示例插件的时钟能力的键在 [`shared/host.ts`](shared/host.ts)。

## 运行

在应用包目录运行 `bun test examples` 只跑示例的场景；`bun run test` 连同应用包的其它测试一起跑（示例随它运行，内核的公开接口改了、示例没跟上会直接失败）。类型检查随 `bun run typecheck`：后端、共用代码与场景在 `tsconfig.json`，浏览器与共用代码在 `tsconfig.web.json`。

## 几个概念

| 概念 | 是什么 | 范围 | 代码里 | 示例 |
|---|---|---|---|---|
| 插件 | 发布、启用、版本的单位，一个目录 | 跨所有运行位置 | `plugin.ts` 的插件描述 `PluginDescriptor`（id、版本、运行位置） | 每个插件目录的 `plugin.ts` |
| 入口 | 插件在某一种运行位置上的代码，单独激活、单独受阻，有自己的激活代次；同一位置可以有多个入口 | 一个运行实例 | 插件定义常量 `PluginDefinition` 的 `entries`，每个实例只激活本位置的入口 | counter 一份后端定义含 `server` 与 `project` 两个入口；notes 有服务端与浏览器两份定义 |
| 服务 | 一个入口交给**同一实例里**其它入口用的对象，以服务 id 标识 | 同一实例 | `provide`（共享一份）、`providePerConsumer`（每个调用方一份） | clock 的报时服务（共享）；notes 窗口里的笔记视图（按调用方） |
| 依赖 | **入口**声明“我需要服务 id 为 S 的服务”；只在本实例里解析，提供方先激活、后停止；必需依赖缺了只有这个入口受阻，可选依赖缺了只有用到它的那一处不可用 | 同一实例 | 入口的 `dependencies`；激活时 `context.services.require(键)`（必需）或 `resolve(键)`（可选） | notes 必需依赖 `nbook.storage`、可选依赖 clock |
| 宿主能力 | 宿主交给本实例插件的东西（时钟、状态根、项目），插件像依赖服务一样声明 | 同一实例 | 宿主在应用清单的 `capabilities` 里给出；插件在 `dependencies` 里声明 | clock 依赖宿主时钟 |
| 远程服务 | 跨实例的协议：异步、可序列化、有失败码，不构成依赖；第一次调用时激活提供方。同一实例里的调用方也直接用合同 | 任意实例之间 | `defineRemoteService`、`provideRemote`；调用方 `context.remote.use(合同).at(目标)` | notes、counter 的合同 |
| 贡献与贡献点 | 声明式扩展：拥有者定义扩展点，别的插件交“声明 + 实现”，彼此没有依赖 | 同一实例 | 插件定义的 `contributionPoints`，入口的 `receives` 与 `contributions` | menu 定义、file-menu 贡献；counter 向 `nbook.commands`、`nbook.state` 贡献 |
| 插件状态 | 一个入口的内存、持久化、派生与公开状态，只经 action 写，随入口代次创建与释放 | 一个入口 | `defineStore`（`nbook/shared/store/store`），公开键 `definePublicState` | counter 的计数与公开键 `example.counter/nonzero` |

几个概念之间的关系，以 counter 与 notes 为例：

```text
插件 example.notes（发布单位，本身不运行）
├─ 入口 server（server 实例）
│    ──必需依赖──▶ 服务 nbook.storage/storage      同一服务端实例里 nbook.storage 的 server 入口提供
│    ──可选依赖──▶ 服务 example.clock/clock        同一服务端实例里 example.clock 的 server 入口提供；缺了照常工作
│    ──提供──▶ 远程合同 example.notes/remote       任何实例里的插件都可以调用
└─ 入口 browser（每个窗口一个）
     ──提供──▶ 服务 example.notes/view             按调用方各一份
     ──以调用方身份调用──▶ 合同 example.notes/remote   不是依赖

插件 example.counter
├─ 入口 server ──贡献──▶ 贡献点 commands.definitions（nbook.commands）、state.public（nbook.state）   贡献不是依赖
└─ 入口 project（每个打开的项目一个）──提供──▶ 远程合同 example.counter/project
```

依赖属于入口，指向服务 id，只在入口所在的实例里解析；插件和插件之间没有依赖。远程调用与贡献都不是依赖：不会让任何入口受阻。

## 一个入口能做的事

| 类别 | 内容 | 在哪个示例里 |
|---|---|---|
| 静态声明（激活前内核就知道） | `location`、`activationEvents`、`dependencies`、`provides`、`remoteProvides`、`receives`、`contributions`；代理入口另有 `remoteDelegates` | 各插件的 `defineEntry`；`remoteDelegates` 见 notes 的浏览器入口 |
| 激活时能用的（`activate(context)`） | `context.services.require` 与 `resolve` 取本地服务 | clock（`require`）、notes 服务端（`resolve`） |
| | `context.remote.use(合同).at(目标)` 调用、订阅远程服务；`lookup` 不激活地查询提供方；`instances()` 列出实例；代理入口的 `remote.on(调用方)` | 场景 04 的面板（`use`、`lookup`、`instances`）；notes 浏览器入口（`remote.on`） |
| | `context.declarations` 查询已接受的贡献声明 | menu 的 `titles()` |
| | `context.scope` 登记资源，`context.signal` 得知自己被停止 | clock |
| 激活产出 | 本地服务、远程服务、贡献的实现、本插件贡献点的接收者；用 `defineEntry` 定义时，产出与静态声明对不上在编译期报错 | 全部示例 |
| 内核替它做的 | 依赖的服务先激活；停止时先停依赖它的入口；撤回它交出去的服务、贡献、远程门面与订阅；关闭它的作用域 | 场景 01、02、03、04 |

## 选哪种方式

全文见 [`runtime.plugin-api`](../../../docs/specs/runtime/plugin-api.md) 的“选用规则”与“可选功能”。

| 接口的性质 | 用什么 | 示例 |
|---|---|---|
| 只传数据，调用方可能在别的实例 | 远程服务合同，所有调用方（含同一实例里的）直接用合同，不写只原样转发的本地服务 | notes、counter 的合同 |
| 只在同一实例里用 | 本地服务；给第三方插件的按数据面约束写（方法返回 Promise、只传可克隆的数据、失败以结构化结果返回） | clock 的报时服务、menu 的菜单服务 |
| 许多插件各交声明与实现，由一个拥有者统一管理 | 贡献点 | menu 的 `menu.items`；`nbook.commands` 的命令 |
| 在远程服务之上加东西（同步视图、缓存、代调用方身份访问） | 本地服务包装远程服务，包装处写明加了什么 | notes 的浏览器入口；产品里的 `nbook.storage` |
| 对方不在时只有一部分功能不可用 | 可选依赖加 `resolve`；对方在别的实例时用远程调用，按 `not-provided` 与 `unavailable` 分别降级，调用前想知道就 `lookup` | notes 服务端的可选 clock；场景 04 的项目计数 |

## 运行位置与目录

| 级别 | 运行位置 | 实例 | 代码目录 |
|---|---|---|---|
| 应用级 | `server` | 服务端进程，一个 | `backend/` |
| 项目级 | `project` | 每个打开的项目一个（产品里是一个项目子进程） | `backend/`（与服务端共用，入口声明的运行位置不同） |
| 客户端级 | `browser`（以后有 `tui`） | 每个窗口一个 | `web/` |

```text
examples/
├── plugins/<插件>/
│   ├── plugin.ts            插件描述：id、版本、有入口的运行位置
│   ├── shared/contracts.ts  对其它插件公开的合同：服务接口与键、远程服务合同、贡献点、公开键与命令 id
│   ├── backend/plugin.ts    后端代码的插件定义常量（server、project 位置的入口）
│   └── web/plugin.ts        浏览器代码的插件定义常量
├── shared/host.ts           示例宿主给插件的能力的键（时钟）
├── scenarios/NN-*.test.ts   场景：把插件装进运行实例、核对行为
└── testing/                 场地与探针：测试支持代码，不含断言
```

目录格式与应用包的内置插件相同（[`packages/neuro-book/AGENTS.md`](../AGENTS.md) 的“目录约定”）：

- 示例插件按第三方插件的写法：引用内核只经 `@notnotype/nb-runtime/<机制>`；引用内置插件与别的示例插件，在运行时只引用对方的 `shared/contracts.ts`，类型可以 `import type`；宿主能力的键与 `defineRecord`、`defineStore` 这类各插件都要用的工具来自 `nbook/shared/`。`src/architecture.test.ts` 检查这些规则，产品代码也不能反过来引用 `examples/`。
- 服务键按服务 id 识别，只在提供方的 `shared/contracts.ts` 定义一次（[ADR 0025](../../../docs/adr/0025-service-keys-by-id.md)）。
- 插件定义是常量，没有工厂参数（[ADR 0026](../../../docs/adr/0026-plugin-definitions-as-constants.md)）：要宿主的东西就依赖宿主能力，对别的插件的依赖同样写在入口的 `dependencies` 里。定义按代码所在的一侧导出，后端不能引用浏览器代码；一份后端定义可以含 `server` 与 `project` 两个位置的入口。
- `web/` 与 `backend/` 互不引用，只经 `shared/` 交换类型与 schema；`plugin.ts`、`shared/` 与 `web/` 也过浏览器那份类型检查，不用 Bun 与 Node 的接口。

## 插件

| 插件 | 运行位置 | 演示什么 |
|---|---|---|
| [clock](plugins/clock/) | server | 依赖宿主能力里的时钟，包成共享服务（`provide`）；不声明激活事件，有入口依赖它时才激活；`context.scope` 登记宿主计时器、收口时释放，`context.signal` 一触发就答复还在等的调用 |
| [notes](plugins/notes/) | server、browser | 服务端：必需依赖 `nbook.storage`（真实 SQLite，按调用方插件分开）、可选依赖 clock（`resolve`，按原因分别处理），`provideRemote` 按调用方生成门面，事件 `changed`。浏览器：按调用方提供笔记视图，以调用方身份代理（`remote.on`、`remoteDelegates`、代理允许清单），维护同步可读的缓存，`nbook.storage` 的缩小版 |
| [counter](plugins/counter/) | server、project | 一份后端定义两个入口。服务端：`defineStore` 把计数持久化进 `nbook.storage`，公开键 `example.counter/nonzero`，命令 `example.counter.reset` 的 `when` 引用它，远程合同与订阅、提供方看到的调用方。项目：每个项目实例一份的计数，第一次调用时按需激活，窗口省略 `.at()` 即到达绑定的项目 |
| [menu](plugins/menu/) | server | 定义贡献点 `menu.items`：逐条校验、接收者 `published` 与 `revoke`、执行时经 `implementation()` 取实现；`context.declarations` 列出已接受声明的标题，贡献方还没激活也列得出 |
| [file-menu](plugins/file-menu/) | server | 向贡献点提交声明与实现，与拥有者之间没有服务依赖；注释说明为什么还只能启动即激活 |

## 场景

| 场景 | 用到的插件 | 核对的行为 | 行为合同 |
|---|---|---|---|
| [01-services](scenarios/01-services.test.ts) | clock、notes（服务端） | 按需激活与激活顺序；宿主不给时钟时 clock 受阻、notes 照常，可选依赖的原因 `provider-rejected` 与 `missing-provider`；停止时 `signal` 与 `scope` 的分工 | [services](../../../docs/specs/runtime/services.md)、[plugins](../../../docs/specs/runtime/plugins.md)、[plugin-api](../../../docs/specs/runtime/plugin-api.md) |
| [02-per-consumer](scenarios/02-per-consumer.test.ts) | notes（服务端） | 两个调用方各自只看到自己的笔记；调用方停止后旧门面不能再用、数据还在；服务端重启后笔记仍在 | [services](../../../docs/specs/runtime/services.md) 输出第 11–12 条、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md)、[persistence](../../../docs/specs/storage/persistence.md) |
| [03-contribution-point](scenarios/03-contribution-point.test.ts) | menu、file-menu | 校验不合格只拒那一条；贡献方停止后撤回；声明先于激活 | [plugins](../../../docs/specs/runtime/plugins.md) 输出第 15–18、23、24 条 |
| [04-remote-service](scenarios/04-remote-service.test.ts) | counter | 窗口直接用合同、`orThrow`、订阅归发起入口；项目按绑定到达与按需激活；`lookup` 的 `not-provided` 降级；`instances()`；计数持久化，命令随公开键可用与不可用 | [plugin-channel](../../../docs/specs/runtime/plugin-channel.md)、[projects](../../../docs/specs/runtime/projects.md)、[store](../../../docs/specs/state/store.md)、[public-state](../../../docs/specs/state/public-state.md)、[commands](../../../docs/specs/workbench/commands.md) |
| [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts) | notes（浏览器端） | 两个插件经代理各写各的，服务端看到原调用方与 `via`；同步缓存随 `changed` 更新；不在代理允许清单为 `denied` | [services](../../../docs/specs/runtime/services.md) 输出第 13 条、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md) 输出第 10 条 |

## 场地与探针

- [`testing/stage.ts`](testing/stage.ts) 像应用包的宿主那样装配运行实例：每个实例装上与产品宿主相同的内置插件（诊断、`nbook.state`、`nbook.storage`，服务端与窗口另有 `nbook.commands`），给出状态根、时钟与项目；服务端带路由，项目实例与窗口经进程内链路连上它，帧照样经 JSON 编解码。状态根在场景的临时目录里，同一个场地再起服务端读到的是上一次写下的数据。`attach` 把一个插件装进子作用域并激活，用来演示调用方停止。
- [`testing/probes.ts`](testing/probes.ts) 的探针站在“使用这些服务的插件”的位置上，把拿到的本地服务（`serviceProbe`）或以探针身份的远程访问（`remoteProbe`）交给场景；产品里没有这样的插件。
- 场景遵守[测试写法](../../../docs/testing/README.md#测试写法)：真实内核实例与真实内置插件，不用 mock、spy、假计时器与固定等待；时间由场地时钟推进；每个场景在 `afterEach` 里停止全部实例并核对正常关闭，临时目录在 `afterAll` 删除。

## 还没演示的

- **拥有者定义的激活事件**（`activationEventPrefixes`）：现在只有宿主能触发，插件写不出“菜单打开时才激活贡献方”，file-menu 因此启动即激活（见它的注释）。是否给插件补触发接口由开发者决定。
- **工作台视图**：随工作台外壳实现后补。
- **插件清单文件**（`package.json`，[`runtime.plugin-manifest`](../../../docs/specs/runtime/plugin-manifest.md)）：实现后示例随之改成清单格式。

## 写法与维护

- 示例在精不在多：一个插件只演示少数几件事，新机制优先补进已有插件与场景，确实放不下才加插件。
- 注释是教学材料，是注释规则的例外（根 [`AGENTS.md`](../../../AGENTS.md) 的“注释”）：逐步讲这一步做什么、为什么、不这样会怎样，链接 Spec 时写路径与条目编号。注释里写的行为要有场景覆盖，改代码时同一提交里改讲解与场景。
- 入口都用 `defineEntry` 定义，激活产出与静态声明对不上在编译期报错；按运行位置分支时在整个产出上分支。
- 内核或内置插件的公开接口改动时，同一提交里更新受影响的示例。
