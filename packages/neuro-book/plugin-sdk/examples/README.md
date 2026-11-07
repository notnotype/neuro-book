# 示例插件

八个按第三方插件写法写的示例插件，演示内核的主要机制与内置插件（`nbook.storage`、`nbook.state`、`nbook.commands`、`nbook.settings`）的用法，也可以当写新插件的样板。每个示例插件都装进真实的内置插件运行，由八个场景测试核对行为。

讲解写在代码旁边：每个文件开头说明它演示什么、对应哪个场景，关键的每一步说明做什么、为什么、不这样会怎样，并链接 Spec。本文件只做目录、概念与阅读顺序，不贴代码。

## 阅读顺序

先读下面的“几个概念”，再按场景编号读，每个场景先读它用到的插件，最后读场景本身：

1. [01-services](scenarios/01-services.test.ts)：服务与依赖。先读 [clock](plugins/clock/)（`shared/contracts.ts` → `backend/plugin.ts`），再读 [notes](plugins/notes/) 的 `shared/contracts.ts` 与 `backend/plugin.ts`。
2. [02-per-consumer](scenarios/02-per-consumer.test.ts)：按调用方提供。重读 notes 服务端入口里 `provideRemote` 的工厂。
3. [03-contribution-point](scenarios/03-contribution-point.test.ts)：贡献点。先读 [menu](plugins/menu/)，再读 [file-menu](plugins/file-menu/)。
4. [04-remote-service](scenarios/04-remote-service.test.ts)：远程服务、项目实例、插件状态与命令。读 [counter](plugins/counter/)。
5. [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts)：以调用方身份代理。读 notes 的 `web/plugin.ts`。
6. [06-settings-page](scenarios/06-settings-page.test.ts)：配置项与设置窗口的 page 分区。读 [snippets](plugins/snippets/)：`plugin.ts` → `shared/contracts.ts` → `web/plugin.ts` → `web/snippets.ts` → `web/SnippetsPage.vue`（与 `SnippetsEditor.vue`）。
7. [07-focus](scenarios/07-focus.test.ts)：完整示例，前面几样连在一起。读 [focus](plugins/focus/)：`shared/contracts.ts` → `backend/plugin.ts` → `web/focus-store.ts` → `web/plugin.ts` → `web/FocusPanel.vue`。
8. [08-scene-provider](scenarios/08-scene-provider.test.ts)：主题与场景提供者（浏览器入口的贡献，实现随入口交付）。读 [scene-clock](plugins/scene-clock/)：`shared/contracts.ts` → `plugin.ts` → `web/sky.ts` → `web/plugin.ts`。

场景用到的场地与探针在 [`testing/`](testing/)。示例插件只从 SDK（根入口是插件框架，各内置插件在自己的子路径，例如 `/storage`、`/workbench`）导入宿主与内置插件的东西，宿主给的时钟能力也在 SDK 里（`hostClockKey`）。

## 运行

在应用包目录运行 `bun test plugin-sdk/examples` 只跑示例的场景；示例插件界面组件的测试（`*.dom.test.ts`，例如 snippets 的设置页）由 Vitest 在 happy-dom 里跑，`bun run test:vitest` 连同应用包的组件测试一起跑（Bun 不能加载 `.vue`）。`bun run test` 两样都跑（示例随它运行，内核的公开接口改了、示例没跟上会直接失败）。类型检查随 `bun run typecheck`：后端、共用代码与场景在 `tsconfig.json`，浏览器与共用代码在 `tsconfig.web.json`。

## 几个概念

| 概念 | 是什么 | 范围 | 代码里 | 示例 |
|---|---|---|---|---|
| 插件 | 发布、启用、版本的单位，一个目录 | 跨所有运行位置 | `definePlugin({id, version, locations})`（写在 `shared/contracts.ts`），`plugin.ts` 用它导出插件描述 | 每个插件的 `shared/contracts.ts` 与 `plugin.ts` |
| 入口 | 插件在某一种运行位置上的代码，单独激活、单独受阻，有自己的激活代次；同一位置可以有多个入口 | 一个运行实例 | `plugin.entry(…)`，经 `plugin.definition([…])` 组成插件定义（常量），每个实例只激活本位置的入口 | counter 一份后端定义含 `server` 与 `project` 两个入口；notes 有服务端与浏览器两份定义 |
| 服务 | 一个入口交给**同一实例里**其它入口用的对象，以服务 id 标识 | 同一实例 | `provideService`（共享一份）、`provideServicePerConsumer`（每个调用方一份） | clock 的报时服务（共享）；notes 窗口里的笔记视图（按调用方） |
| 依赖 | **入口**声明“我需要服务 id 为 S 的服务”；只在本实例里解析，提供方先激活、后停止；必需依赖缺了只有这个入口受阻，可选依赖缺了只有用到它的那一处不可用 | 同一实例 | 入口的 `dependencies`；激活时 `context.services.require(键)`（必需）或 `resolve(键)`（可选） | notes 必需依赖 `nbook.storage`、可选依赖 clock |
| 宿主能力 | 宿主交给本实例插件的东西（时钟、状态根、项目），插件像依赖服务一样声明 | 同一实例 | 宿主在应用清单的 `capabilities` 里给出；插件在 `dependencies` 里声明 | clock 依赖宿主时钟 |
| 远程服务 | 跨实例的协议：异步、可序列化、有失败码，不构成依赖；第一次调用时激活提供方。同一实例里的调用方也直接用合同 | 任意实例之间 | `defineRemoteService`、`provideRemote`；调用方 `context.remote.use(合同).at(目标)` | notes、counter 的合同 |
| 贡献与贡献点 | 声明式扩展：拥有者定义扩展点，别的插件交“声明 + 实现”，彼此没有依赖 | 同一实例 | 插件定义的 `contributionPoints`，入口的 `receives` 与 `contributions` | menu 定义、file-menu 贡献；counter 向 `nbook.commands`、`nbook.state` 贡献 |
| 插件状态 | 一个入口的内存、持久化、派生与公开状态，只经 action 写，随入口代次创建与释放 | 一个入口 | `defineStore`（`nbook/shared/store/store`），公开键 `definePublicState` | counter 的计数与公开键 `example.counter/nonzero` |
| 配置项 | 用户主动设定的偏好，用户层（`<状态根>/settings.json`）与项目层（`<项目目录>/.nbook/settings.json`）各存一份，越具体越优先、整体覆盖；所有插件都能读，只有声明它的插件能写 | 跨所有运行位置 | `defineSetting`（`nbook/shared/settings`），写在插件描述的 `contributions` 里；经 `nbook.settings` 的 `settingsKey` 读（`get` 有效值、`inspect` 各层）、写（`update(定义, 值, {layer})`） | snippets 的 `example.snippets/items` |
| 设置分区 | 设置窗口左栏的一项：list 分区由窗口按配置项画通用控件，page 分区由插件自己画页面 | 窗口 | 贡献点 `settings.sections`（list 分区）与 `settings.pages`（page 分区），都由 `nbook.settings` 拥有。list 分区是 `/settings` 的 `section(plugin, …)`，写进插件描述，配置项（`setting(plugin, …)`）的 `section` 收分区本身、`group` 写它的小组 id，不需要代码；page 分区由浏览器入口用 `/settings/browser` 的 `settingsPage(plugin, …)` 贡献，实现交 `load()`，页面用同一子路径的 `SettingsRow` 画每一项 | snippets 的 page 分区 `example.snippets.main`；list 分区见作者模板的 [`shared/contracts.ts`](../template/shared/contracts.ts) |

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

每一项的完整说明见 plugin-api 的[“激活上下文”](../../../../docs/specs/runtime/plugin-api.md#激活上下文)，这里只列在哪个示例里：

| 类别 | 内容 | 在哪个示例里 |
|---|---|---|
| 静态声明（激活前内核就知道） | `location`、`activationEvents`、`dependencies`、`provides`、`remoteProvides`、`receives`、`contributions`；代理入口另有 `remoteDelegates` | 各插件的 `plugin.entry`；`remoteDelegates` 见 notes 的浏览器入口 |
| 激活时能用的（`activate(context)`） | `context.services.require` 与 `resolve` 取本地服务 | clock（`require`）、notes 服务端（`resolve`） |
| | `context.remote.use(合同).at(目标)` 调用、订阅远程服务；`lookup` 不激活地查询提供方；`instances()` 列出实例；代理入口的 `remote.on(调用方)` | 场景 04 的面板（`use`、`lookup`、`instances`）；notes 浏览器入口（`remote.on`） |
| | `context.declarations` 查询已接受的贡献声明 | menu 的 `titles()` |
| | `context.onStop` 登记停止时要做的事，`context.signal` 得知自己被停止 | clock |
| 激活产出 | 本地服务、远程服务、贡献的实现、本插件贡献点的接收者；产出与静态声明对不上在编译期报错（助手的贡献按键逐项核对） | 全部示例 |
| 内核替它做的 | 依赖的服务先激活；停止时先停依赖它的入口；撤回它交出去的服务、贡献、远程门面与订阅；关闭它的作用域 | 场景 01、02、03、04 |

## 选哪种方式

规则见 [`runtime.plugin-api`](../../../../docs/specs/runtime/plugin-api.md) 的[“选用规则”](../../../../docs/specs/runtime/plugin-api.md#选用规则)与“可选功能”，这里只列每种情况在哪个示例里：

| 接口的性质 | 用什么 | 示例 |
|---|---|---|
| 只传数据，调用方可能在别的实例 | 远程服务合同 | notes、counter 的合同 |
| 只在同一实例里用 | 本地服务 | clock 的报时服务、menu 的菜单服务 |
| 许多插件各交声明与实现，由一个拥有者统一管理 | 贡献点 | menu 的 `menu.items`；`nbook.commands` 的命令 |
| 在远程服务之上加东西（同步视图、缓存、代调用方身份访问） | 本地服务包装远程服务 | notes 的浏览器入口；产品里的 `nbook.storage` |
| 对方不在时只有一部分功能不可用 | 可选依赖；对方在别的实例时按远程调用的失败码降级 | notes 服务端的可选 clock；场景 04 的项目计数 |
| 用户可以改的偏好 | 配置项（list 分区或 page 分区） | snippets |

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
│   ├── shared/contracts.ts  `definePlugin` 与对其它插件公开的合同：服务接口与键、远程服务合同、贡献点、设置项、公开键与命令
│   ├── backend/plugin.ts    后端代码的插件定义常量（server、project 位置的入口）
│   ├── locales/<语言>.json  界面文字的消息目录，`package.json` 的 `l10n.source` 指出源语言
│   └── web/plugin.ts        浏览器代码的插件定义常量；界面组件（`.vue`）与它并列，只在用到时动态导入
├── scenarios/NN-*.test.ts   场景：把插件装进运行实例、核对行为
└── testing/                 场地与探针：测试支持代码，不含断言
```

目录格式与应用包的内置插件相同（[`packages/neuro-book/AGENTS.md`](../../AGENTS.md) 的“目录约定”）：

- 示例插件按第三方插件的写法：只从 SDK 导入（`@notnotype/nb-plugin-sdk` 与它的子路径），另外只用 `vue`、`@vue/reactivity` 与 `typebox`；引用别的示例插件在运行时只引用对方的 `shared/contracts.ts`，类型可以 `import type`。测试文件（场景、组件测试）不受这条限制。`src/architecture.test.ts` 检查这些规则，产品代码也不能反过来引用 `examples/`。
- 服务键按服务 id 识别，只在提供方的 `shared/contracts.ts` 定义一次（[ADR 0025](../../../../docs/adr/0025-service-keys-by-id.md)）。
- 插件定义是常量，没有工厂参数（[ADR 0026](../../../../docs/adr/0026-plugin-definitions-as-constants.md)）：要宿主的东西就依赖宿主能力，对别的插件的依赖同样写在入口的 `dependencies` 里。定义按代码所在的一侧导出，后端不能引用浏览器代码；一份后端定义可以含 `server` 与 `project` 两个位置的入口。
- `web/` 与 `backend/` 互不引用，只经 `shared/` 交换类型与 schema；`plugin.ts`、`shared/` 与 `web/` 也过浏览器那份类型检查，不用 Bun 与 Node 的接口。
- 界面文字写进插件自己的消息目录，不在代码里写双语对象（[i18n](../../../../docs/specs/ui/i18n.md)）：声明里必填的 `title` 省略，登记时补成约定键；可选的 `description` 与运行时现给的文字用 `/text` 的 `pluginText` 构造引用；组件里用 `/text/browser` 的 `usePluginText`，不经属性传语言。服务端算出、要给用户看的文字（counter 公开键的 `reason`）写语言映射：服务端不翻译目录里的键。写法见 snippets 的 `shared/contracts.ts` 与 `web/SnippetsEditor.vue`。

## 插件

| 插件 | 运行位置 | 演示什么 |
|---|---|---|
| [clock](plugins/clock/) | server | 依赖宿主能力里的时钟，包成共享服务（`provideService`）；不声明激活事件，有入口依赖它时才激活；`context.onStop` 登记还回宿主计时器，`context.signal` 一触发就答复还在等的调用 |
| [notes](plugins/notes/) | server、browser | 服务端：必需依赖 `nbook.storage`（真实 SQLite，按调用方插件分开）、可选依赖 clock（`resolve`，按原因分别处理），`provideRemote` 按调用方生成门面，事件 `changed`。浏览器：按调用方提供笔记视图，以调用方身份代理（`remote.on`、`remoteDelegates`），维护同步可读的缓存，`nbook.storage` 的缩小版 |
| [counter](plugins/counter/) | server、project | 一份后端定义两个入口。服务端：`defineStore` 把计数持久化进 `nbook.storage`，公开键 `example.counter/nonzero`，命令 `example.counter.reset` 的 `when` 引用它，远程合同与订阅、提供方看到的调用方。项目：每个项目实例一份的计数，第一次调用时按需激活，窗口省略 `.at()` 即到达绑定的项目 |
| [menu](plugins/menu/) | server | 定义贡献点 `menu.items`：规则写成 `schema` 与 `idPrefix`、登记时逐条校验，启动即激活、收到菜单项记诊断，接收者 `published` 与 `revoke`、执行时经 `implementation()` 取实现；`context.declarations` 列出已接受声明的标题，贡献方还没激活也列得出 |
| [file-menu](plugins/file-menu/) | server | 向贡献点提交声明与实现，与拥有者之间没有服务依赖；注释说明这里为什么仍启动即激活、按需激活怎样写 |
| [snippets](plugins/snippets/) | browser（配置项在每个实例登记） | 配置项写在插件描述里、由宿主登记进每个实例；向 `settings.pages` 贡献 page 分区，`load()` 按需加载页面；页面用 `SettingsRow` 的宽排法按 `context.layer` 只编辑这一层，按层读（`inspect`）与按层写（`update(..., {layer})`）；什么时候用 page 而不是 list；界面文字的消息目录、约定键与组件里的 `usePluginText`，失败提示存码、显示时按语言拼 |
| [focus](plugins/focus/) | server、browser | 完整示例“专注计时”：list 分区里的设置项、命令、侧栏视图（`view` 助手的 `implement` 把 store 交给组件）、状态栏条目（挂切换命令）、服务端远程服务与私有存储；计时的权威在服务端，到点由结算函数记完成（纯函数，几个请求各自结算不会多记），条件保存防丢更新，坏记录用 `reset` 重来；窗口按 `endsAt` 算剩余、只在计时时走表、重连后重取 |
| [scene-clock](plugins/scene-clock/) | browser | 一个主题（顶层声明，描述里的 `workbench.themes`）加浏览器入口里的场景提供者（`sceneProvider` 助手）：场景图由代码在画布上画，天空的颜色随钟点变，`expiresAt` 取下一个整点；入口写 `onStartup`，工作台不替提供者激活入口；提供者声明带 `title`，主题编辑器的下拉显示它 |

## 主题的三份参考

做外观主题（[`theme.skins`](../../../../docs/specs/theme/skins.md)）时读这三份，由简到繁：

| 参考 | 位置 | 演示什么 |
|---|---|---|
| [theme-dusk](external/theme-dusk/package.json) | 不写代码的外置插件 | 最小的主题：只有配色和一张亮一张暗的场景图，另有一张 Agent 工作中用的场景（`workingScene`），加载页的进度样式用圆点（`loading.indicator`）；装上就能在主题列表里选 |
| [theme-study](../../src/plugins/theme-study/plugin.ts)（“书房”） | 产品内置 | 完整的主题：字体、各位置的裁切、活动栏、浮层画框、手写的图标集（`icons`）、亮暗各一张场景图和一张工作态场景（`workingScene`），加载页用场景图当背景、进度样式是翻动的书页（`loading`）。它随产品提供，也当作字段齐全的参考，改字段要同步 Spec |
| [scene-clock](plugins/scene-clock/) | 带代码的插件 | 场景图由代码画（`sceneProvider`），随钟点重画（`expiresAt`） |

## 外部插件

示例插件都按第三方插件构建、安装运行：每个示例目录有一份 `package.json`（作者合同：`publisher`、`name`、`version` 与可选的 `pluginVersions`），用的构建预设与仓库外作者经 SDK 的 `nbooke build` 用的是同一个（[`plugin-sdk/build.ts`](../build.ts)）。产物里的 `package.json` 是构建预设从代码定义生成的清单（[`runtime.plugin-manifest`](../../../../docs/specs/runtime/plugin-manifest.md)），经 `nbook plugin install` 或设置窗口的“插件”页装进状态根、重启后生效（[`runtime.plugin-install`](../../../../docs/specs/runtime/plugin-install.md)）；入口的代码在激活时才装载（[`runtime.plugin-code-loading`](../../../../docs/specs/runtime/plugin-code-loading.md)）。

装一个示例：

1. 在应用包目录运行 `bun run build:examples [名…]`（不写名字就构建全部），产物在各示例的 `dist/`（git 忽略）。每个入口打成一个文件，宿主共享的模块（Vue、`@vue/reactivity`、SDK 与它的组件入口）不打进去；仓库里构建时 SDK 的包名指到应用源码，应用源码列为不许打进产物的目录，示例绕过 SDK 引用了应用内部时构建失败。
2. `nbook plugin install <示例的 dist>`，装进你启动 NeuroBook 用的那个状态根：在应用包目录给开发服务（`bun run dev`，状态根是 `.dev-state`）装，写 `bun src/cli/main.ts --state-root .dev-state plugin install plugin-sdk/examples/plugins/snippets/dist`；或者在 NeuroBook 的“设置 → 插件”里点“安装…”、填 `dist` 的完整路径并确认。
3. 重启 NeuroBook。menu 与 file-menu 要一起装：file-menu 的菜单项交给 menu，menu 收到时记一条诊断，在服务端日志里看得到。notes 写了 `pluginVersions` 要求 clock 是 `^0.1.0`（clock 是它的可选依赖，不装也能用）。

另有 [theme-dusk](external/theme-dusk/package.json)：不写代码的主题，只有声明与素材，文件夹本身就能安装，装上就能在设置的“主题”里选。

另有 [declarative](external/declarative/package.json)：只有声明、没有代码的插件，文件夹本身就能安装，不用构建。一项配置 `example.hello/greeting`，用户层与本作品层都能改。

外置之后的行为与按源码装配时相同，由 `plugin-sdk/external-examples.test.ts`（构建、按清单登记、装载器装载，再跑场景里同样的调用）与 `e2e/plugin-code.e2e.ts`（真实浏览器与产品服务端）核对。在仓库外从零写插件，看 SDK 包的作者文档（[`plugin-sdk/README.md`](../README.md)）。

## 场景

| 场景 | 用到的插件 | 核对的行为 | 行为合同 |
|---|---|---|---|
| [01-services](scenarios/01-services.test.ts) | clock、notes（服务端） | 按需激活与激活顺序；宿主不给时钟时 clock 受阻、notes 照常，可选依赖的原因 `provider-rejected` 与 `missing-provider`；停止时 `signal` 与 `onStop` 的分工 | [services](../../../../docs/specs/runtime/services.md)、[plugins](../../../../docs/specs/runtime/plugins.md)、[plugin-api](../../../../docs/specs/runtime/plugin-api.md) |
| [02-per-consumer](scenarios/02-per-consumer.test.ts) | notes（服务端） | 两个调用方各自只看到自己的笔记；调用方停止后旧门面不能再用、数据还在；服务端重启后笔记仍在 | [services](../../../../docs/specs/runtime/services.md) 输出第 11–12 条、[plugin-channel](../../../../docs/specs/runtime/plugin-channel.md)、[persistence](../../../../docs/specs/storage/persistence.md) |
| [03-contribution-point](scenarios/03-contribution-point.test.ts) | menu、file-menu | 校验不合格只拒那一条；贡献方停止后撤回；声明先于激活 | [plugins](../../../../docs/specs/runtime/plugins.md) 输出第 15–18、23、24 条 |
| [04-remote-service](scenarios/04-remote-service.test.ts) | counter | 窗口直接用合同、`orThrow`、订阅归发起入口；项目按绑定到达与按需激活；`lookup` 的 `not-provided` 降级；`instances()`；计数持久化，命令随公开键可用与不可用 | [plugin-channel](../../../../docs/specs/runtime/plugin-channel.md)、[projects](../../../../docs/specs/runtime/projects.md)、[store](../../../../docs/specs/state/store.md)、[public-state](../../../../docs/specs/state/public-state.md)、[commands](../../../../docs/specs/workbench/commands.md) |
| [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts) | notes（浏览器端） | 两个插件经代理各写各的，服务端看到原调用方与 `via`；同步缓存随 `changed` 更新 | [services](../../../../docs/specs/runtime/services.md) 输出第 13 条、[plugin-channel](../../../../docs/specs/runtime/plugin-channel.md) 输出第 10 条 |
| [06-settings-page](scenarios/06-settings-page.test.ts) | snippets | 配置项在服务端、项目实例与窗口都被接受；page 分区交付给设置窗口、插件停用后撤回；按层写用户层与本作品层，`inspect` 读回各层、`get` 读有效值，删掉本作品层回到沿用，不带 `layer` 时按 `auto` 选层；写别人的项为 `denied`、不合 schema 为 `invalid-value` | [settings-window](../../../../docs/specs/settings/settings-window.md)、[configuration](../../../../docs/specs/settings/configuration.md) 输出第 3、6、11、12 条 |
| [07-focus](scenarios/07-focus.test.ts) | focus | 命令开始、时长取设置项、到点结算后状态栏更新；`already-running`、`not-running`；没有窗口时服务端到点推送；服务端入口停止时计时器跟着取消，停着时到点的那次之后第一次读时记上；记录版本不同时换成空记录；两个窗口同时开始只开始一次、同时结算只记一次；跨零点算在结束那天；断线重连后补上断开期间的变化；入口停止、空闲后不占计时器 | [plugin-api](../../../../docs/specs/runtime/plugin-api.md)、[persistence](../../../../docs/specs/storage/persistence.md)、[plugin-channel](../../../../docs/specs/runtime/plugin-channel.md)、[workbench-shell](../../../../docs/specs/ui/workbench-shell.md) |
| [08-scene-provider](scenarios/08-scene-provider.test.ts) | scene-clock | 主题被接受且 `sceneProvider` 指向入口贡献的提供者（声明带显示名）；入口启动即激活、实现交到工作台，入口停止后撤回；天空颜色随钟点、明暗与工作中变，`expiresAt` 取下一个整点 | [theme.skins](../../../../docs/specs/theme/skins.md) 输出 18、[plugins](../../../../docs/specs/runtime/plugins.md) |

## 场地与探针

- [`testing/stage.ts`](testing/stage.ts) 像应用包的宿主那样装配运行实例：每个实例装上与产品宿主相同的内置插件（诊断、`nbook.state`、`nbook.storage`，服务端与窗口另有 `nbook.commands`），给出状态根、时钟与项目；服务端带路由，项目实例与窗口经进程内链路连上它，帧照样经 JSON 编解码。状态根在场景的临时目录里，同一个场地再起服务端读到的是上一次写下的数据。`attach` 把一个插件装进子作用域并激活，用来演示调用方停止。
- [`testing/probes.ts`](testing/probes.ts) 的探针站在“使用这些服务的插件”的位置上，把拿到的本地服务（`serviceProbe`）或以探针身份的远程访问（`remoteProbe`）交给场景；产品里没有这样的插件。要以某个示例插件**自己**的身份调用时（场景 06 写这个插件声明的配置项），探针作为一个入口加进那个插件的定义，而不是另起一个插件。
- [`testing/workbench.ts`](testing/workbench.ts) 是工作台的替身：场地不装真正的工作台，替身只拥有视图与状态栏条目两个贡献点，贡献点用产品里同一份定义（补约定键与校验都相同），场景直接读条目的 `text()`。视图组件不在 Bun 里加载，由组件测试（`*.dom.test.ts`）覆盖。
- 场景遵守[测试写法](../../../../docs/testing/README.md#测试写法)：真实内核实例与真实内置插件，不用 mock、spy、假计时器与固定等待；时间由场地时钟推进；每个场景在 `afterEach` 里停止全部实例并核对正常关闭，临时目录在 `afterAll` 删除。

## 还没演示的

- **拥有者触发自己的激活事件**（`activationEventPrefixes` 与 `context.activation.trigger`）：插件可以写出“菜单打开时才激活贡献方”，但示例的 menu 没有“打开菜单”这一步，为了让场景 3 简单，file-menu 仍启动即激活；写法见它的注释。

## 写法与维护

- 示例在精不在多：一个插件只演示少数几件事，新机制优先补进已有插件与场景，确实放不下才加插件。
- 注释是教学材料，是注释规则的例外（根 [`AGENTS.md`](../../../../AGENTS.md) 的“注释”）：逐步讲这一步做什么、为什么、不这样会怎样，链接 Spec 时写路径与条目编号。注释里写的行为要有场景覆盖，改代码时同一提交里改讲解与场景。
- 示例文件头列出的每个教学要点，各要有一条删掉它就会失败的场景断言；写完之后做一次变异核对：逐个删掉这些机制再跑场景，确认各有一例失败（场景 07 的第一版删掉三处核心机制后照样全过）。
- 场景里断言没有计时器时，推进时钟直到没有登记的计时器，不直接断言 `pending()` 为 0：场地的时钟是共用的，设置服务等别的服务也会在上面排计时器。
- 入口都用 `plugin.entry` 定义，贡献只写短名、按键交实现，激活产出与静态声明对不上在编译期报错；不经助手的贡献写在 `rawContributions`（file-menu），自己定义的贡献点写在 `plugin.definition` 的 `contributionPoints`（menu）。
- 内核或内置插件的公开接口改动时，同一提交里更新受影响的示例。
