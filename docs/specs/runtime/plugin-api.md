---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.plugin-api
owners:
  - runtime
---

# 插件公开 API（SDK）

## 目标与非目标

给插件作者一套稳定的公开 API：插件只经宿主注入的上下文访问宿主与其它插件，远程服务合同与数据面接口按远程调用的形态设计，使第一版同进程直接调用与以后的跨进程调用共用同一份接口定义，也使内核能完整记账并撤回引用；同一实例里的内部服务可以同步、传对象引用（见选用规则）。CPU 密集的工作有 worker 池可用，不必在主线程上长时间计算。

明确不承诺：

- 不承诺插件可以 import 宿主内部模块或其它插件的模块；这样写的插件不受兼容承诺保护，热插拔的撤回也不覆盖它们。
- 不提供权限模型与沙箱；信任所有插件（[ADR 0027](../../adr/0027-builtin-and-third-party-plugins-are-equal.md)）。
- 不定义各内置插件导出服务的具体方法；它们由各自的能力 Spec 定义，远程合同与数据面接口遵守本文的形态约束，内部服务不受此限。
- 不打断 worker 中的 WebAssembly 与原生阻塞调用（见“边界与兼容”）。

## 术语与参与者

- **SDK**：作者依赖的包 `@notnotype/nb-plugin-sdk`，只含类型与少量纯函数，不依赖宿主内部模块；内置插件的合同、宿主能力的键与设置窗口给页面用的组件由它提供。根入口是插件框架（`definePlugin`、内核的入口、服务、远程服务（含 `remoteService`、`eventSource`）与诊断、宿主能力）。界面文字不属于哪个内置插件，占两个子路径：`/text` 是文字值的类型（`Text`、`TextRef`、`LocaleMap`、`TextParams`）与构造文字引用的 `pluginText`，不连带 Vue，各运行位置可用；`/text/browser` 是组件里取文字的 `usePluginText`、`useText` 与 `TextPort`，只给浏览器入口。其余按内置插件各占子路径：`/state`、`/storage`、`/settings`、`/commands` 各运行位置可用；`/settings/browser`（设置页、选项来源与设置页组件）与 `/workbench`（视图、状态栏条目）要 Vue，只给浏览器入口；`/components` 是 nb-ui 的组件，只给浏览器入口；`/agent`（内核的定义写法、类型、模板节点与 `nbook.agent` 贡献点的助手，[`agent.contributions`](../agent/contributions.md)）与 `/agent/jsx-runtime`（Profile 模板的 JSX 运行时）只给服务端，浏览器的宿主模块表不含它们。要 Vue 的部分：整个内置插件只在浏览器里有意义的占一个只给浏览器的子路径，两端都要的把浏览器部分放在 `/<插件>/browser`。插件运行时，这些入口由宿主模块表给出宿主自己的那一份（[`runtime.plugin-code-loading`](plugin-code-loading.md) 输出 2）；作者安装的包里是类型与构建期执行入口定义用的实现。
- **激活上下文 `ctx`**：宿主在激活入口时注入的对象，按运行位置提供不同成员。
- **远程形态**：满足下文五条约束的接口形态。
- **结构化结果**：`{ok: true, value}` 或 `{ok: false, code, cause?, detail?}`，调用不以抛出异常表达失败；只想要值的调用方可以用 `orThrow` 把失败转成异常（[远程服务与 RPC 协议](plugin-channel.md) 输出第 1 条）。
- **作用域登记**：经 `ctx` 建立的订阅、定时器、句柄都登记在入口的激活作用域上，入口停止时自动撤回；作者自己要在停止时做的事用 `ctx.onStop` 登记。
- **作者 API**：SDK 在 `defineEntry` 之上给作者的一层：`definePlugin` 绑定插件 id，贡献助手只收短名（见下文“作者 API”）。内置插件不用它。

## 输入与前置条件

- 作者用 `defineEntry({id, location, activationEvents?, dependencies?, provides?, remoteProvides?, receives?, contributions?, activate})` 声明入口，编译期核对激活产出与这些声明一致（[`runtime.plugins`](plugins.md) 的“输入与前置条件”）；清单实现后，构建预设据此生成清单（[`runtime.plugin-manifest`](plugin-manifest.md)）。只提供组件、不需要初始化逻辑的浏览器入口可以省略 `activate`。
- `activate(ctx)` 在入口激活时调用一次，返回激活结果：本入口提供的服务实现、需要实现的贡献的实现，以及浏览器入口只交给本插件自己组件的 `local` 对象。
- 其它插件的接口来自提供方的合同模块（`shared/contracts.ts`，[ADR 0026](../../adr/0026-plugin-definitions-as-constants.md) 第 2 条）：运行时可以导入其中的服务键与远程服务合同这类无副作用的值，例如 `import {counterContract} from "<提供方>/shared/contracts"` 后 `ctx.remote.use(counterContract)`；服务类型只以 `import type` 使用；不导入提供方的实现与宿主内部模块。第三方提供方随包发布合同模块，内置插件的合同模块由 SDK 提供。

## 输出与可观察行为

### 选用规则

插件之间协作按接口的性质选方式：

| 接口的性质 | 用什么 | 说明 |
|---|---|---|
| 只传数据，调用方可能在别的运行实例 | 远程服务合同（[远程服务与 RPC 协议](plugin-channel.md)） | 所有调用方都直接 `ctx.remote.use(合同)`，同一实例里的调用方也一样（走本地路径，不序列化，身份与代次照样核对）；不写只原样转发的本地服务包装。本地与远程共用一个提供者登记，只在本实例用、含不可序列化内容的接口才另登记为本地服务（[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 4 节，[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md) 第 4 条）。合同因此是插件对外的公开接口，改动按合同版本处理 |
| 只在同一实例里用、只传数据 | 本地服务（`provideService`、`provideServicePerConsumer`），按下节的数据面约束写 | 以后把插件移出宿主进程时只换传输（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 3 条）；需要同步或传引用时写成内部服务 |
| 要同步调用，或要传响应式值、对象引用 | 内部服务，或下节的宿主适配对象 | 例如命令面板求 `when` 时同步读公开状态；任何插件都可以依赖内部服务（[ADR 0027](../../adr/0027-builtin-and-third-party-plugins-are-equal.md)），代价见“边界与兼容” |
| 许多插件各交“声明 + 实现”，由一个拥有者统一管理 | 贡献点 | 命令、页面、公开状态键；贡献方与拥有者之间没有依赖 |
| 在远程服务之上加东西 | 本地服务包装远程服务 | 同步的响应式视图、缓存、按分区选路、代调用方身份访问（例如 `nbook.storage`）；包装处写明加了什么 |

### 可选功能

插件的一部分功能要另一个插件在场才能用、对方不在时只有这部分不可用（原称“联动项”，2026-09-30 并入入口与依赖）。按场合选：

| 写法 | 适用 | 对方不在时 |
|---|---|---|
| 单独的入口加必需依赖 | 同一实例里，这部分功能整段依赖对方的服务 | 只有这个入口受阻，插件显示为部分可用（[`runtime.plugin-manifest`](plugin-manifest.md) 验收第 4 条）；入口的寿命落在对方服务的寿命之内 |
| 可选依赖加 `ctx.services.resolve(键)` | 同一实例里，入口只有一处要用对方 | `resolve` 返回 `unavailable`：原因 `missing-provider` 表示没有提供方，其它原因表示提供方暂时不可用 |
| 向对方的贡献点贡献 | 反方向：本插件给对方的系统加东西（命令、页面） | 贡献等待接收者，本插件照常 |
| 远程调用 | 对方在别的实例，或只在用到时才需要 | 不使任何入口受阻。`not-provided` 表示目标实例没装（或没启用）提供这份合同的插件，`unavailable` 表示装了但此刻不可用，按领域分别降级；其它失败码按各自含义处理，写请求的 `unknown-outcome` 不能当作没有执行（[远程服务与 RPC 协议](plugin-channel.md) 输出第 4、5 条）。想在调用前知道对方在不在（例如决定显示不显示一个按钮）、又不想激活提供方时，用 `ctx.remote.lookup(合同, 目标?)`（同文输出第 11 条） |
| 公开状态加 `when` | 命令要等对方的某个状态 | 键未声明时命令不可用，原因写明（[`workbench.commands`](../workbench/commands.md)） |

内核不提供“先检测对方在不在、再持有它的引用”：拿到引用之后对方可能停止，引用随之失效（[可扩展应用平台设计](../../proposals/extensible-application-platform.md) 2026-09-30 的决定）。上面几种写法里，引用要么随入口寿命由内核管理，要么每次调用重新解析；`ctx.remote.lookup` 只返回此刻的信息、不返回引用，查到之后的调用照样可能失败。同一实例里判断对方在不在用可选依赖加 `resolve`，不另设查询：它让依赖留在依赖图里，激活顺序与受阻推导照常。

### 远程形态约束

跨插件接口分三类，约束不同：

| 类别 | 例子 | 约束 |
|---|---|---|
| 数据面 | 导出服务的方法、命令、贡献实现被调用时的参数与结果、远程服务方法、宿主 API 的参数与结果 | 满足下面五条；远程服务合同的输入输出由内核按 schema 强制 |
| 宿主适配的对象 | 事件回调与订阅返回的可释放句柄、终止信号 `signal`、浏览器入口交给贡献点拥有者的视图组件 | 不受数据约束，由宿主专门传递与撤回；以后跨进程时由宿主换成等价的远程形式 |
| 内部服务 | 同一实例里同步调用、传对象引用的服务，例如 `nbook.state` 的公开状态读取、命令服务、配置的 `get` | 任何插件都可以依赖，不受数据面约束 |

数据面的五条约束：

1. 方法全部返回 Promise；
2. 参数与结果可被结构化克隆，不传函数、类实例、DOM 或 Vue 对象；
3. 事件以“订阅返回可释放句柄”的形式提供（`onDidX(cb)`），句柄登记在订阅方的激活作用域上；
4. 失败以结构化结果返回，调用不 reject；
5. 每个处理函数都收到终止信号 `signal`，宿主 API 都接受 `signal`。

浏览器入口的 `local` 对象只给本插件自己的组件，可以是响应式对象，不受上述约束。

### 激活上下文

| 成员 | 位置 | 行为 |
|---|---|---|
| `ctx.plugin` | 两端 | 插件 id、当前版本、上一次成功激活的版本（首次为空，用于数据迁移） |
| `ctx.signal` | 两端 | 入口停止时触发 |
| `ctx.onStop(release)` | 两端 | 登记一件这一代入口停止时做的事（释放计时器、句柄），激活失败时同样执行，与别的资源并行释放；这一代已收口后调用抛错。作者不必接触作用域（`ctx.scope`）与资源规格 |
| `ctx.services.require(键)` | 两端 | 取得 `dependencies` 中声明的必需依赖，返回服务本身；键是提供方 `shared/contracts.ts` 里定义的服务键对象（[ADR 0026](../../adr/0026-plugin-definitions-as-constants.md)）。未声明或只声明为可选的键抛错：这是写错了入口定义，不是运行期的失败 |
| `ctx.services.resolve(键)` | 两端 | 解析声明过的依赖（含可选依赖），返回结构化结果，用法见上文“可选功能” |
| `ctx.remote` | 各位置 | `use(合同).at(目标)` 调用与订阅任意实例的远程服务；`lookup(合同, 目标?)` 不激活提供方地查询目标实例是否提供这份合同；本入口的远程提供项经激活产出的 `remote` 交出（[远程服务与 RPC 协议](plugin-channel.md)） |
| `ctx.activation.trigger(事件, {signal?})` | 两端 | 以本入口所属插件的身份触发自己前缀下的激活事件（[`runtime.plugins`](plugins.md) 输出 21），返回同 `triggerActivationEvent`；本代次停止后（包括同一插件 id 之后重新登记）调用得到 `rejected {reason: "requester-stopped"}`，不激活任何入口；`signal` 与本代次的停止信号任一触发都只结束等待 |
| `ctx.workers.run(module, input, options)` | 两端 | 见下文 worker 池 |
| `ctx.setTimeout`、`ctx.setInterval`、`ctx.run(promise)` | 两端 | 作用域登记的定时器与异步包装：其中抛出的错误记入本插件诊断，入口停止时自动清理 |
| `ctx.diagnostics` | 两端 | 写本插件的诊断记录，按插件 id 归类并脱敏 |

配置与密钥不在 `ctx` 上：入口在 `dependencies` 里声明 `nbook.settings` 的服务键，读任何已声明的配置项、只写本插件声明的项；密钥是声明了 `secret` 的配置项，只在服务端有值（[`settings.configuration`](../settings/configuration.md)）。

各贡献点拥有者可以在 `ctx` 上注入命令式注册接口（例如向 `nbook.agent` 注册工具）；返回的句柄同样登记在调用方的激活作用域上，并记入内核账本。

持久化记录不在 `ctx` 上：插件在依赖中声明内置插件 `nbook.storage` 的服务，按记录读写（[`storage.persistence`](../storage/persistence.md)）；插件私有目录随资源寻址与文件服务另定。

命令不在 `ctx` 上：命令由内置插件 `nbook.commands` 提供，插件向它的贡献点登记命令；插件在 `dependencies` 中声明它的命令服务后按 id 执行（[`workbench.commands`](../workbench/commands.md)）。

插件状态不在 `ctx` 上：插件用 `defineStore` 在一处声明一个入口的内存、持久化、派生与公开状态，在 `activate` 里以 `ctx` 创建，随入口代次释放（[`state.store`](../state/store.md)）；公开键是向贡献点 `state.public` 的声明（[`state.public`](../state/public-state.md)）。

### 错误码

宿主合成的错误码：`plugin-unavailable`（提供方入口不可用或已停止）、`interrupted`（调用被中止或在三步停止中被放弃）、`invalid-input`（参数不符合 schema）、`provider-error`（提供方抛出未预期的异常，信息脱敏）、`secret-unreadable`。提供方可以定义自己的错误码，以结构化结果返回。

### worker 池

`ctx.workers.run(module, input, {signal, transfer, onProgress})` 在 worker 中执行插件预构建的单文件 ESM 模块的默认导出（一个纯计算函数），返回结构化结果：

- 成功：`{ok: true, value}`；
- 失败：`interrupted`、`task-error`、`input-not-cloneable`、`output-not-cloneable`、`load-failed`、`worker-crashed` 之一。

行为：

- 输入与输出必须可结构化克隆，大块二进制用 `transfer` 移交；worker 中拿不到宿主 API。
- 每次调用归发起它的入口。中止、发起入口停止、宿主停止都以 `interrupted` 结算，调用方在 100 毫秒内得到结果；结算后到达的结果与进度一律丢弃。
- 按（插件，模块）复用空闲 worker；全局上限为逻辑 CPU 数减 1（至少 1），每个插件上限 2；满员时排队，排队中的调用同样响应中止。
- 入口停止时只拒绝该入口的新调用、结算该入口排队与在途的调用，并终止正在执行这些调用的 worker；同一插件其它入口的调用与 worker 不受影响。
- worker 被终止到真正停止之间仍占用名额：Bun 中执行 JS 的 worker 在 1 秒内停止；Chrome 中约 2 秒；执行 WebAssembly 或原生阻塞调用时要等其返回（见“边界与兼容”）。

### 作者 API

`definePlugin({id, version, locations})`（根入口）返回绑定插件 id 的对象；作者在插件描述的模块里调用一次，别的模块都从那里取。

- **助手与短名**：贡献助手是所属内置插件子路径里的函数，第一个参数是 `plugin`：`/settings` 的 `section(plugin, …)`（list 分区，`category` 缺省 `plugins`）与 `setting(plugin, …)`，`/commands` 的 `command(plugin, …)`，`/workbench` 的 `view(plugin, …)` 与 `statusItem(plugin, …)`，`/settings/browser` 的 `settingsPage(plugin, …)` 与 `choices(plugin, …)`。`plugin` 对象只有 `id`、`version`、`locations`、`descriptor`、`entry`、`definition`。助手只收短名 `name`，贡献 id 是 `<插件 id>.<name>`（设置项的键是 `<插件 id>/<name>`），类型上是字面量；短名不合这个贡献点的 id 规则时加载即抛错，写明是哪一个。
- **文字与缺省值**：界面文字（字符串、语言映射或文字引用，[`ui/i18n`](../ui/i18n.md)）按作者写的原样交给贡献点；省略的标题由宿主登记时补成插件目录里的约定键（各贡献点 Spec 的“约定键”），助手不再要求写标题。代码里自己构造文字引用（可选的 `description`、状态栏条目的 `text()` 这类运行期文字）用 `/text` 的 `pluginText(插件 id)`，传源语言目录的类型（`CatalogKey`）时键写错编译不过；组件里用 `/text/browser` 的 `usePluginText(插件 id)` 取当前语言的字符串，读的是窗口根上注入的端口，界面语言切换时跟着重画（[`ui/i18n`](../ui/i18n.md) 的“目录与键”）。根入口不再有 `localize`、`formatText`：组件不经属性传语言，服务端要给用户看的文字写语言映射；视图 `location` 缺省 `sidebar`、`layout` 缺省 `scroll`；状态栏条目 `alignment` 缺省 `right`、`order` 与 `priority` 缺省 0，`command` 可以直接给命令助手，或者视图助手（点击以它的 id 执行 `nbook.view.open`，[`workbench.views`](../workbench/views.md) 输出 14）；命令 `args` 缺省空对象，没写 `additionalProperties` 的补成 `false`，`effect` 必填。命令的参数不带值就过不了校验（有必填项，或 `minProperties` 这类写法）而没写 `expose: {human: false}` 时加载即抛错：命令面板不收集参数，以空对象执行（[`workbench.commands`](../workbench/commands.md)）。设置项的 `section` 收分区助手，`group` 只能是那个分区的组 id。
- **插件描述与定义**：`plugin.descriptor(声明式贡献)` 给出插件描述；用 `setting`、`section` 定义了却没列进描述的，构建时报出是哪一项（构建执行完描述与全部入口定义模块之后核对）；`plugin.definition(入口)` 或 `plugin.definition({entries, contributionPoints?, activationEventPrefixes?})` 给出插件定义，入口 id 重复时抛错（入口 id 在一个插件里唯一，不按运行位置分）。
- **入口**：`plugin.entry({id?, location, contributions?, rawContributions?, receives?, provides?, remoteProvides?, …, activate})`。`id` 缺省取运行位置名。`contributions` 是 `{键: 助手}`，激活产出的 `contributions` 用同样的键交 `助手.implement(…)`：漏写、多写、在某个键上交了别的助手的实现都编译不过，诊断里写明是哪一项；只在浏览器有意义的助手写进别的位置的入口编译不过。助手带的激活事件（设置页的 `onSettingsPage:`、选项来源的 `onSettingsChoices:`）并进 `activationEvents`。不经助手的贡献（向别的插件定义的贡献点提交、插件状态的公开键）写在 `rawContributions`，实现写在产出的 `rawContributions: {贡献点: {id: 实现}}`；插件自己定义的贡献点写在插件定义的 `contributionPoints`，接收者照 `receives` 与产出的 `receivers` 写。服务、远程服务、接收者与 `rawContributions` 的核对同 `defineEntry`。
- **激活上下文**：作者拿到的上下文类型上没有 `scope`，入口停止时做的事用 `ctx.onStop`；`services.require` 只收入口 `dependencies` 里声明的必需服务，`services.resolve` 只收声明过的服务（必需与可选），没声明的键编译不过（按服务的接口核对：接口相同的两个服务分辨不出，取了没声明的那个时入口激活失败）；运行时是同一个上下文。
- **在编辑器里核对的规则**：类型检查时就报、报错写着问题与改法的有：短名带大写、空格或下划线；设置项名不是小驼峰；参数有必填项（按静态类型）的命令没写 `expose: {human: false}`；`require` 没声明的服务；产出了服务或远程服务却没写 `provides`、`remoteProvides`。TypeBox 的类型里看不出来的（记录与远程方法 `input` 写 `additionalProperties: true`、`minProperties` 让空参数过不了校验）照旧在加载或构建时报。短名的核对要看到字面量：包在泛型函数里的助手调用推不出来。
- **视图与设置页的属性**：`implement(props?)` 的属性类型从 `load` 推出：用 vue-tsc 检查时，必填属性漏写、名字写错或类型不对编译不过，可选属性的笔误查不出；只用 tsc 时不检查。

### 作者工具

SDK 包带命令 `nbooke`，只用 Bun 运行（SDK 包的 `engines.bun`）。类型检查是例外：`vue-tsc` 在 Bun 的运行时里认不出 `.vue` 文件，模板的 `typecheck` 脚本按它自己的抬头行用 Node 运行：

- `nbooke create <目录> [--publisher <段>] [--name <段>] [--sdk <依赖写法>]`：在目录里写出一个能直接构建、类型检查并安装的插件（一个浏览器入口、一个侧栏视图、一条命令、一个设置项）。目录不存在、为空，或只有 `package.json`、`bun.lock`、`node_modules`、`.git` 与 `.npmrc` 时才写，否则拒绝、不写任何文件。已有 `package.json` 时合并：`publisher`、`name`、`version` 与 `type` 用生成的（它们要与生成的插件描述一致），其余字段与依赖保留，脚本与开发依赖按键补缺的。publisher 缺省 `my`；name 缺省取已有 `package.json` 的 `name`，没有时取目录名（转小写，其它字符换成连字符）；不符合清单的 id 段规则、或 publisher 是内置插件用的 `nbook` 时拒绝，写明规则与对应的开关。写到一半失败（权限、磁盘满）时删掉这次写下的文件与目录、`package.json` 写回原样，退出码 1，标准错误一行写明原因。SDK 依赖的写法：给了 `--sdk` 用它，否则保留已有的，都没有时写 `^<SDK 版本>`。作者通常不装 SDK、直接 `bunx -p @notnotype/nb-plugin-sdk nbooke create <目录>`。
- `nbooke build [作者目录] [--out <目录>] [--clean] [--dev] [--verbose]`：按构建预设构建（[`runtime.plugin-code-loading`](plugin-code-loading.md)）。作者目录缺省当前目录，输出目录缺省 `<作者目录>/dist`，`--out` 的相对路径按当前目录解析。构建失败退出码 1，逐行列出每个问题（执行入口定义时作者代码抛错，问题的路径是出错的作者文件“文件:行:列”，不打印打包器的日志；`--verbose` 打印打包器的日志并在问题后附完整堆栈）；只有警告时打印到标准错误、退出码 0；用法不对（不认识的子命令或开关、少了参数）退出码 2。输出目录不为空时拒绝；`--clean` 先清空输出目录里上次构建的同一插件的产物，输出目录是别的内容时拒绝、不删。`--dev` 时产物的版本是 `<version>+dev.<UTC 时间到秒>.<毫秒>`：构建元数据不改变 semver 的优先级，依赖它的插件写的范围照样接受；插件管理按构建元数据排出先后，每次构建都比上一次新，在插件页安装按升级处理，重启后生效，作者不用改版本号或先卸载。开发版本也比同号的正式版本新：之后再装同号的正式构建按降级处理，所以发布前先提高版本号。

## 状态与转换

- 转发器：有效 → 已撤销（提供方入口停止）；撤销后调用返回 `plugin-unavailable`，不再变回有效。
- 作用域登记的定时器与订阅：随入口激活建立，入口停止时撤回；撤回后回调不再触发。
- worker 调用：排队 → 执行中 → 已结算（成功或失败之一）；每个调用只结算一次。
- `nbook.storage` 的记录、配置与密钥跨入口代次与插件版本保留。

## 副作用与数据

- 配置与密钥由 `nbook.settings` 持有与持久化，落点与格式见 [`settings.configuration`](../settings/configuration.md)；禁用插件时保留，卸载时按用户选择删除（[`runtime.plugin-install`](plugin-install.md)）。Storage 记录的落点见 [`storage.persistence`](../storage/persistence.md)。
- `ctx.diagnostics` 与作用域定时器中的错误进入运行时诊断（[`runtime.diagnostics`](diagnostics.md)），按插件 id 归类。

## 失败与恢复

- 调用已停止插件的转发器或通道：立即得到 `plugin-unavailable`，不等待。
- 提供方抛出未预期异常：调用方得到 `provider-error`，异常详情记入提供方诊断；提供方入口不因单次异常停止。
- 参数不可克隆：开发模式下在调用时报告违规；生产模式下跨插件调用照常进行（同进程直接传递），worker 调用返回 `input-not-cloneable`。
- worker 崩溃：本次调用返回 `worker-crashed`，该 worker 被替换，其它调用不受影响。
- 密钥无法解密（例如 State Root 被移到另一台机器，而加密依赖原机器的密钥库）：读取返回 `secret-unreadable`，不返回部分数据；密文保留、不自动删除；设置界面提示用户重新输入，重新输入的值覆盖原密文。密钥能否随 State Root 迁移、备份后能否恢复，由 `nbook.settings` 的密钥存储合同决定（[`settings.configuration`](../settings/configuration.md) 输出 20），本能力只保证不静默丢失、不返回空值。

## 边界与兼容

- **owner**：runtime（SDK 与宿主注入）；配置与密钥归 `nbook.settings`。
- **不在运行时 import 宿主或其它插件。** 状态只在 `activate` 内建立并登记到激活作用域，不在模块顶层保存；这是热插拔撤回与代码回收的前提。
- **worker 的限制。** 调用方在中止后立即得到 `interrupted`，但 worker 中的 WebAssembly 与原生阻塞调用要等其返回 JS 才停止（Bun），死循环只能随进程重启回收；Chrome 中 worker 终止后约 2 秒才停。未停止的 worker 继续占用名额，并在诊断中按插件显示。开发者已确认不强制插件把 WebAssembly 计算切成小段，只在插件作者文档中写明。
- **SDK 的组成**：公开面写在应用里（`src/sdk/` 的各子路径入口），只再导出已有实现，子路径只写在一张子路径表里；`/components` 逐个列出 nb-ui 的组件与它们的属性类型，不整体再导出 nb-ui 的入口；仓库里的示例经别名直接用它的源码。可以安装的包由应用生成（`build:sdk`，用 `bun pm pack` 打出 tarball 并打印路径），与应用同一个版本发到 npm（[ADR 0033](../../adr/0033-app-delivered-as-built-npm-package.md)）：打包的构建期实现、打平的类型声明（只引用 `vue`、`@vue/reactivity` 与 `typebox`，作者项目用普通 tsconfig 即可类型检查）与 `package.json`（版本等于产品版本，`vue`、`@vue/reactivity`、`typebox` 是 peer 依赖），`/build` 子路径是构建预设，带类型声明；包里另有作者命令与模板、作者文档、导出、组件与主题变量三份附表（导出清单列出每个子路径的值与类型、服务端能不能用；组件清单就是 `/components` 导出的组件）、作者文档引用的 Spec 副本，示例插件的源码（`examples/`，不带场景测试），以及仓库的 `LICENSE` 与打进构建期实现的第三方包的许可（`THIRD-PARTY-NOTICES.md`）。作者材料的源在应用包的 `plugin-sdk/`，产品代码不引用它（[ADR 0030](../../adr/0030-plugin-platform-layering.md)）。宿主能力的键带 `host` 前缀（`hostClockKey`、`hostStateRootKey`），免得与插件自己的服务键重名。工作台的视图（`workbench.views`）与状态栏条目（`workbench.statusbar-items`）的贡献点 id 与类型在 `/workbench`；视图助手的 `implement(props?)` 把入口激活时拿到的服务经 `props` 交给视图组件，组件另收 `context`。`/commands` 另有命令服务的键 `commandServiceKey`：入口在 `dependencies` 里声明它，就能从代码查询、执行命令（[`workbench.commands`](../workbench/commands.md)）。
- **兼容**：SDK 的公开面、内置插件导出的服务与合同，以及宿主共享给插件的 Vue 与 TypeBox（[`runtime.plugin-code-loading`](plugin-code-loading.md) 的宿主模块表）属于 `engines.neurobook` 的兼容范围，按产品版本的 semver 判断；产品版本为 0.x 时，minor 号变化表示可能有不兼容的改动。形态约束让以后把插件移到共享插件宿主 worker 时远程合同不变；依赖了内部服务的插件不在此列，移出宿主进程需要改写。
- **构建预设提示**：可以提示从未使用 `signal` 的异步处理函数，不作为构建失败条件。

## 验收与 Smoke

1. **转发器撤销。** 插件 A 取得 B 的服务后 B 被禁用，A 残留的转发器调用立即得到 `plugin-unavailable`。
2. **未声明服务。** `ctx.services.require` 取未在 `dependencies` 中声明、或只声明为可选的键时抛错。
3. **提供方异常。** B 的方法抛错，A 得到 `provider-error`，B 仍然可用。
4. **worker 中止。** 在 worker 中运行 JS 死循环，调用方中止后 100 毫秒内得到 `interrupted`；Bun 中该 worker 在 1 秒内停止并释放名额，Chromium 中在 5 秒内释放名额；插件禁用时其排队与在途调用全部以 `interrupted` 结算。
5. **worker 结果形态。** 返回不可克隆的对象得到 `output-not-cloneable`；模块不存在得到 `load-failed`。
6. **作用域定时器。** `ctx.setInterval` 的回调抛错被记入插件诊断；插件禁用后回调不再触发。
7. **私有数据。** 插件写入 `nbook.storage` 的记录与密钥后禁用再启用，数据仍在；浏览器端读不到密钥的值，密钥不出现在任何发往浏览器的响应中。
8. **上一版本号。** 升级后首次激活时 `ctx.plugin` 给出上一次成功激活的版本。
9. **开发模式克隆检查。** 跨插件调用传函数时，开发模式报告违规。
10. **入口粒度。** 同一插件 `main` 与 `tts` 入口各有一个运行中的 worker 调用；`tts` 停止时只有它的调用被结算，`main` 的调用正常完成。
11. **密钥不可解密。** 用无法解密的密文替换插件密钥后读取，得到 `secret-unreadable`，密文仍在；重新写入后读取成功。
12. **仓库外写插件。** 在仓库外的空目录装上生成的 SDK 包，`create`、类型检查、`build`，在插件页安装产物并重启：模板的视图显示设置项的值，命令可执行，改设置项后视图跟着变；禁用、卸载各在重启后生效。

Smoke：示例外部插件在服务端与 Chromium 中各执行一次 worker 调用与中止，核对场景 1、4、6、7；场景 12 由 `e2e/plugin-authoring.e2e.ts` 与照作者文档的一次手动安装覆盖。

## 证据

- 批准依据：SDK 的文字子路径 `/text` 与 `/text/browser`、去掉根入口的 `localize` 与 `formatText` 依据[《界面文字的消息目录》](../../proposals/i18n-message-catalogs.md)（2026-10-27 接受）第 3 节与 w00028 t03 的实施计划；[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P3、P4、P7（2026-09-30 确认 `ctx.config` 与 `ctx.secrets` 由 `nbook.settings` 提供、SDK 提供作用域定时器与异步包装、WebAssembly 不强制切分）；[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 3 条；跨插件调用一律返回结构化结果、跨插件接口的三类划分、宿主错误码、worker 池上限与结算时限、密钥不可解密时的行为由 [t28](../../../.agents/works/w00017-application-runtime-architecture/tasks/t28-platform-planned-specs/README.md) 选定，开发者 2026-09-30 确认（worker 池原型的实测见 [G2 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g2/REPORT.md)）；2026-10-06 开发者撤回 `ctx.commands` 与错误码 `command-not-found`，命令改由内置插件 `nbook.commands` 提供（[t49](../../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)）；`ctx.storage` 2026-10-07 起由 `nbook.storage` 取代（[t55](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/README.md)）；插件状态用 `defineStore` 由开发者 2026-10-08 确认（[t56 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t56-plugin-state/plan.md)）；选用规则、可选功能的写法与 `defineEntry` 的字段由开发者 2026-10-08 在 [t60 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t60-plugin-api-ergonomics/plan.md) 中确认；`ctx.services.require(键)` 与内核一致、`ctx.remote.lookup` 与 `not-provided` 由开发者 2026-10-08 在 [t61 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t61-kernel-catalog-failure-codes/plan.md) 中确认；`ctx.config`、`ctx.secrets` 由 `nbook.settings` 的服务取代，由开发者 2026-10-08 在 [t64 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t64-plugin-settings/plan.md) 的设计轮确认。
