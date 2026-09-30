# 可扩展应用平台：内核、插件模型与推进路线

## 状态

- 状态：`accepted`（2026-09-30）。需求与五项长期决定已由开发者于 2026-09-28 确认，记于 [ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)；此后的设计走查逐项确认了启动流程、热插拔与卸载规则、协作方式、插件的浏览器部分、执行位置与插件通道，确认日期见[决策记录](#决策记录)。“Agent 工具与 Profile 的装配”已移交 nb-harness 重构。实施前先验证风险门 G0、G1、G2（见 [w00017 t27](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/README.md)）；接受不等于实施授权，行为合同写入 `planned` Spec 后才进入阶段 1。
- 与既有提案的关系：
  - [应用运行时总提案](application-runtime-and-plugins.md)的内核合同（资源作用域、服务装配、激活事务、有序关闭）继续有效；其非目标“不加载第三方代码”由 ADR 0022 取代。
  - [产品装配提案](application-runtime-product-integration.md)中后端启动（S0）与 HTTP 入口的设计由本文 [P6](#p6-服务端宿主内核拥有进程) 替代；其余阶段待按本文复核。
  - [Workbench 与 View Host](workbench-view-host.md) 的布局算法与视图实例模型保留，贡献来源改由 workbench 插件的贡献点提供。
- 本文不是 Spec，也不授权实施。设计过程与证据见 [w00017 t26](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/README.md)。

## 问题

w00017 已经交付一个经过合同测试的小内核，但它还没有成为产品的骨架，第三方也没有可以接入的入口。可观察的问题有四个：

1. **内核是 Nitro 的客人。** Nitro 中间件 [`00-product-startup.ts`](../../server/middleware/00-product-startup.ts) 在模块加载时调用 [`productRuntimeReady()`](../../server/runtime/product-startup.ts) 建立运行实例，挂在 `globalThis.__nbookProductApplicationV1` 上，创建时传 `signals: []`；启动失败靠 `setImmediate` 抛出未捕获异常终止进程，因为 Nitro 不能等待异步插件。进程退出由 [`product-shutdown.ts`](../../server/runtime/shutdown/product-shutdown.ts) 的手写清单编排：agent-harness、product-runtime、workspace-file-indexes、storage-host、app-sqlite-checkpoint、app-prisma、app-logger。运行实例只是其中一项。
2. **功能接线靠手写。** 浏览器运行时由 3605 行的 [`index.vue`](../../app/pages/index.vue) 创建；[`product-browser-runtime.ts`](../../app/runtime/product-browser-runtime.ts) 中的视图和命令接收者只接受写死的 Files 常量声明；服务端清单的接收者为空数组。
3. **插件分层很浅。** 服务端 [`workspace-files`](../../server/features/workspace-files/plugin.ts) 插件只提供一个服务工厂，不依赖平台文件或 SQLite 插件；诊断、平台文件、SQLite 三个插件只在 smoke 清单中装配。同一个 Files 功能在两端是两个插件身份（`workspace-files` 与 `nbook.files`）。
4. **没有面向第三方的面。** 没有插件包格式、运行时加载、由插件定义的贡献点、公开 SDK 或两端通信通道。

结果是：加一项功能要同时改主页面、启动清单和关闭清单；第三方无从接入。

## 目标与非目标

### 目标

以下目标来自 2026-09-28 确认的需求，理由见 ADR 0022。

1. **内核拥有进程。** 宿主适配器建立运行实例，内核只提供机制；进程信号、停止和关闭顺序由内核按依赖图决定，取代手写清单。
2. **内置与第三方同一机制。** HTTP、workbench、编辑器、Agent、模型、Project、Files 都是内置插件；插件只经贡献点、导出 API、命令协作。
3. **第三方插件免构建安装、即时生效。** 从本地文件夹安装，不改源码、不重新构建 NeuroBook；安装、启用、禁用、卸载与升级都即时生效，不需要重启（2026-09-29 修订）。
4. **公开 API 是远程形态。** 全部异步、可序列化，插件只经注入的 API 对象访问宿主；密钥由模型插件保管。
5. **竖切验收（路线第 2 步）：** 主页面左侧文件资源管理器作为内置插件挂载与收口，主页面、启动路径、关闭路径中没有它的手写接线。
6. **最终验收（路线第 4 步）：** 文生图第三方插件按 ADR 0022 的四处生效标准通过。

### 非目标

- 插件市场、在线分发、签名、权限沙箱、独立扩展宿主进程。
- 保证禁用或卸载后恢复到启用前的状态（P11 的 L3）；重启应用即完全干净。
- 把第三方插件隔离到独立线程或进程。以后出现第三方插件拖垮服务端的实际问题，或第三方插件数量明显增长时，再加一个共享插件宿主 worker，公开 API 不变（见[评审问题](#评审问题) 5）。
- 服务端多用户各自安装插件。
- 外壳独立部署（例如放在 CDN 上连接远程后端）与跨域认证；第一版只守住可分离的边界，见 [P11](#p11-启动停止与插件状态)。
- 改变现有用户数据格式、数据库布局或迁移策略。
- 替换 Nuxt、Vue 或 Nitro 的构建能力；Nitro 仍负责构建与请求处理，只是不再拥有进程。
- 一次性迁完所有现有功能。World、Plot、Jobs、Workflow、角色等在路线完成后或首次改动时迁入，不阻塞本路线。

## 当前行为与证据

以下事实于 2026-09-28 在分支 `refactor/w00017-runtime-foundation`（HEAD `334cbc88`）上由源码阅读确认，未运行新验证。

| 范围 | 证据 | 对设计的意义 |
|---|---|---|
| 内核机制 | [`runtime/`](../../runtime/) 下 lifecycle、services、plugins、application 四个模块，约 4.2k 行非测试代码；七项 runtime/platform Spec 为 `implemented` | 作用域、服务装配、激活事务可以直接复用 |
| 贡献接收者 | [`runtime/plugins/contracts.ts`](../../runtime/plugins/contracts.ts) 的 `PluginHostOptions.receivers` 由宿主在创建时传入 | 需要改为由拥有者插件提供，第三方才能扩展内置插件定义的能力 |
| 服务端宿主适配 | [`server-host.ts`](../../server/runtime/foundation/server-host.ts) 已能挂接进程信号、按实例 id 隔离、有界停止 | 可作为“内核拥有进程”的基础 |
| Nitro 入口能力 | nitropack 2.13.4 的 node preset 包含只导出 `listener` 而不监听端口的 `node-listener` 入口；`NitroOptions.entry` 可覆盖 preset 入口 | 可以让自有入口与 Nitro 共用一次构建和同一模块图；**仅从源码与类型推断，未构建验证** |
| 产品构建 | 产品镜像以 `NITRO_PRESET=node-server` 构建（[build-product-runtime-image.ts](../../../../scripts/build/build-product-runtime-image.ts)），Desktop 与 Manager 启动 `.output/server/index.mjs` | 入口文件路径不变即可保持 Manager、Desktop、容器的启动合同 |
| 运行时加载先例 | [`runtime-artifact-import.ts`](../../server/utils/runtime-artifact-import.ts) 在 Product 中绕过打包器导入落盘 ESM，已用于 Profile 编译产物与 World Engine schema | 服务端加载第三方插件代码有成熟机制 |
| 浏览器宿主 | Nuxt 4.4 `ssr: false`；Nuxt client plugin 先于根组件挂载 | 浏览器运行实例可以在挂载前建立，不必由页面创建 |
| Agent 工具 | [`AgentToolRegistry`](../../server/agent/tools/tool-registry.ts) 区分注册与 Profile 允许（`toolKeys`），但同 key 后注册会静默覆盖 | 适合改造成 `agent.tools` 贡献点的接收者，重复身份需改为拒绝 |
| Files HTTP | [`server/api/workspace-files/`](../../server/api/workspace-files/) 下 read/write/batch/events 等路由通过 `withProductWorkspaceFiles()` 借用插件服务 | 竖切需要把这些入口迁进插件 |

## 方案

### 总览

```text
进程外壳：Desktop / Manager / 容器 ──启动──▶ .output/server/index.mjs（路径不变）

服务端：自有宿主入口（P6）
  └─ 运行实例 server
       内核：lifecycle · services · plugins · application · 插件加载器（P1）
       内置插件：diagnostics · app-state · sqlite · platform-files · http · session-store
                 · project · storage · files · agent · models · assets · settings …
       第三方插件的 server 入口

浏览器：Nuxt client plugin 中的宿主入口（P7）
  └─ 运行实例 browser（每个窗口一个）
       内核：同一份代码
       内置插件：workbench · editor · files · settings …
       第三方插件的 browser 入口（共享宿主的 Vue 与 nb-ui）

两端之间：插件通道（P5）＝ 调用 + 订阅事件流 + 按需的双向流，经 http 插件传输；服务端对每次调用重新鉴权
```

### P1 内核：保留机制，补充能力

保留 lifecycle、services、plugins 的激活事务与 application 的门禁和有序停止，不重写。补充以下能力：

1. **插件包与加载器。** 内核能从两种来源登记插件：随产品构建的内置插件，以及安装在 State Root 的外部插件（[P8](#p8-安装发现兼容与安全模式)）。两者使用同一清单格式；加载器只读清单即可完成登记与校验，不执行插件代码。
2. **由拥有者插件定义的贡献点。** 贡献点连同声明 schema 写在拥有者插件的清单里，例如 Agent 插件定义 `agent.tools`。登记阶段内核按 schema 校验全部插件的贡献，不需要先激活拥有者；拥有者激活时才接上接收者。这取代现在由宿主传入接收者的做法。
3. **激活事件。** 插件在清单中声明何时激活：`onStartup`、`onCommand:<id>`、`onView:<id>`、`onAgentTool:<id>`、`onChannel`（插件通道首次被调用）。事件只是触发现有激活机制的条件，激活事务语义不变。
4. **运行期启用与禁用。** 贡献点接收者除实现层的 prepare、commit、revoke 外，还接收声明层通知（插件启用或禁用时声明出现或消失）；禁用按 [P11](#p11-启动停止与插件状态) 的三步停止执行；撤回后被调用的贡献实现、命令与导出 API 统一返回结构化的 `plugin-unavailable` 错误；禁用前能列出该插件的在途调用供用户确认。
5. **引用账本。** 跨插件的引用只经内核建立，内核逐项记账：导出 API 以转发器交出，贡献实现以句柄交出，事件订阅以登记在订阅方作用域上的句柄交出。撤销后转发器与句柄失效，且不再引用提供方，即使使用方仍持有它们，提供方也能被回收。
6. **跨插件调用包装。** 导出 API 调用、贡献调用与命令执行都经内核包装：合成终止信号（调用方传入的信号、调用方被禁用、提供方被禁用），登记在途调用，禁用超时后替调用方结算为“已中断”。
7. **联动项。** 插件包可以附带联动项：一段对可选插件有硬依赖的代码，内核把它当作独立的插件身份（例如 `example.b/tts`），在宿主插件与可选插件都启用时自动启用，任一方不可用时先于它关闭。见 [P3](#p3-插件之间的三种协作)。
8. **代码装载器。** 加载与卸载插件代码经一个接口完成。第一版用 `import()` 加载；卸载时按插件安装目录删除 Bun `require.cache` 中的全部模块，使代码可被回收（未文档化行为，用回归测试固定，失效时退回“保留到重启”）。`Bun.ModuleGraph` 进入稳定版后可替换实现，插件与公开 API 不变（[调研](../research/runtime-module-unloading.md) §4.4、§5）。
9. **开发模式检查。** 卸载后用弱引用确认插件的激活上下文已被回收，未回收时报告“插件卸载后仍被引用”；对跨插件调用的参数与结果做一次结构化克隆，提前暴露传递活对象的违规。

### P2 插件包与清单

一个插件是一个目录，清单沿用 `package.json`，与 VS Code 扩展同形。下面是文生图插件的示意：

```json
{
  "name": "text-to-image",
  "publisher": "example",
  "version": "0.1.0",
  "engines": {"neurobook": "^1.0.0"},
  "main": "./dist/server.mjs",
  "browser": "./dist/browser.mjs",
  "pluginDependencies": {"nbook.models": "^1.0.0", "nbook.editor": "^1.0.0", "nbook.assets": "^1.0.0"},
  "activationEvents": ["onCommand:example.textToImage.generate", "onAgentTool:generate_illustration", "onView:example.textToImage.candidates"],
  "contributes": {
    "commands": [{"id": "example.textToImage.generate", "title": "生成插图"}],
    "menus": {"editor/context": [{"command": "example.textToImage.generate", "when": "editorHasSelection"}]},
    "views": {"right": [{"id": "example.textToImage.candidates", "name": "候选插图"}]},
    "agent.tools": [{"name": "generate_illustration", "description": "为场景生成插图", "inputSchema": {"type": "object"}}],
    "configuration": {"example.textToImage.style": {"type": "string", "default": "watercolor"}}
  }
}
```

- 插件 id 为 `publisher.name`；内置插件使用 `nbook.*`。
- `main` 与 `browser` 分别是服务端和浏览器入口，二者同属一个插件身份，现有 Files 的两个身份合并为 `nbook.files`。
- 入口必须是预构建的 ESM。服务端入口需把依赖打进单文件，不在 State Root 解析 `node_modules`；浏览器入口把 `vue`、`@notnotype/nb-ui` 与 SDK 声明为外部依赖（[P7](#p7-浏览器宿主与第三方界面)）。SDK 以后提供构建预设。
- 内置插件使用同一清单格式，但代码随产品构建静态进入镜像，不走运行时加载，因为它们依赖 Vue SFC 与 Nuxt 构建。
- 走查中新增的清单内容：联动项 `integrations`（P1 第 7 项）、上下文键声明 `contextKeys` 与菜单位置 `menuLocations`（P7）、路由贡献 `http.routes`（P5）；`http.endpoints` 由合同生成，不手写。浏览器入口的产物格式随 G1 的结论确定：采用宿主模块表时是登记工厂的 CommonJS 形式，不是 ESM。

### P3 插件之间的三种协作

| 方式 | 何时用 | 机制 |
|---|---|---|
| 贡献点 | 向另一插件拥有的能力提交声明，例如命令、菜单、视图、Agent 工具、设置项、模型适配器 | 清单 `contributes` 登记时校验；拥有者激活后接收；贡献方按激活事件提供实现。也可以在激活时经拥有者注入的 API 命令式注册，返回的句柄自动登记到调用方的激活作用域，同样记入内核账本 |
| 导出 API | 调用另一插件的能力，例如“用图像模型生成”“把图片写入 Project 资产” | 激活结果中的 `exports`；依赖方在 `pluginDependencies` 声明后，于激活上下文中取得。内部由 runtime.services 的服务键实现 |
| 命令 | 弱耦合地触发动作，或从菜单、快捷键、面板调用 | `commands.execute(id, ...args)`，参数可序列化 |

插件不在运行时 import 其它插件的模块：这样的 import 形成内核看不见的引用，提供方被禁用、卸载或升级后，使用方手里仍是旧模块，旧代码无法回收，还可能新旧两份并存。内置插件之间可以使用进程内的内部服务，这些服务可以是同步的、传对象引用；凡是提供给第三方的导出 API 必须满足 [P4](#p4-sdk-与远程形态约束) 的远程形态约束。

**模块与插件分开。** 要共享的东西按层归位：

| 要共享的东西 | 层 | 共享方式 |
|---|---|---|
| 类型 | 编译期 | 提供方发布类型包，使用方 `import type`，构建后不留痕迹；内置插件 API 的类型由 SDK 提供 |
| 无状态的纯函数、工具库 | 编译期代码 | 普通 npm 包，各自打包，不构成插件关系 |
| 有状态的运行时能力 | 插件 | 声明依赖，运行时经内核取得导出 API |

VS Code 的 git 扩展是同一模式：使用方声明依赖 `vscode.git`，运行时取得其导出 API，类型来自 git 扩展提供的 `git.d.ts`。

**可选能力。** 不提供“检测某插件是否启用，然后持有它的引用”的写法，也不借贡献把服务回传给使用方（依赖方向与声明相反、撤回无法记账、初始化顺序难以追踪）。可选能力分两种表达：

1. **通用能力用门面加贡献。** 由始终存在的内置插件拥有门面，可选的提供方向门面贡献实现，使用方只调用门面并在调用时判断能力是否可用。例如日志后端贡献给 `nbook.diagnostics`，语音合成等模型能力以适配器贡献给 `nbook.models`。
2. **插件独有的可选联动用联动项**（P1 第 7 项）。联动项的作用域存活期落在所依赖插件的存活期之内，所以可以安全持有对方的导出 API；宿主插件自身不判断对方是否存在。

**激活不互相等待。** 依赖图在登记阶段检查，必须无环；联动项依赖宿主插件，宿主插件不得依赖自己的联动项。拥有者不在自己的 `activate` 中调用贡献或等待依赖自己的插件；违反时由 `runtime.services` 现有的运行时等待环检测报错，而不是卡住。

- 选用原则是耦合越弱越好：只有必须取得结果或持续交互时才声明依赖、使用导出 API。只有导出 API 构成硬依赖，也只有它触发连带受阻。
- 事件属于拥有者的导出 API（`onDidX(cb)` 返回可释放句柄），不设全局事件总线；“按顺序询问多个插件”的钩子由拥有者定义贡献点，并规定收集顺序、合并方式与失败处理。
- 插件通道只连接同一插件的服务端部分与浏览器部分。既跨端又跨插件时，先经自己的通道，再调用对方在同一端的导出 API；导出 API 按端分开。
- 共享数据经数据的拥有者读写，例如文生图经 `nbook.assets` 写入图片，资源管理器从 `nbook.files` 的变更事件看到新文件，两者互不依赖。

### P4 SDK 与远程形态约束

- SDK 是一个只含类型与少量纯函数的包，不依赖宿主内部模块。宿主把 API 对象注入 `activate(context)`，插件不在运行时 import 宿主代码。
- 公开 API 的约束：
  1. 方法全部返回 Promise；
  2. 参数与结果可被结构化克隆，不传函数、类实例、DOM 或 Vue 对象；
  3. 事件以“订阅返回可释放句柄”的形式提供，句柄登记到插件的激活作用域；
  4. 错误以结构化结果返回，失败原因可被定位；
  5. 每个处理函数都收到终止信号 `signal`，宿主 API 都接受 `signal`。
- 这些约束让第一版同进程直接调用与以后的跨进程 RPC 使用同一份接口定义；不跨插件传递活对象，也让撤回引用可以完整记账（P1 第 5 项）。
- 插件开发者须遵守的规则：状态只在 `activate` 内建立并登记到激活作用域，不在模块顶层保存；把收到的 `signal` 传给自己的 I/O；CPU 密集的工作交给 SDK 提供的 worker 池（`ctx.workers.run(module, input, {signal})`，中止时直接终止对应 worker），不在主线程上长时间同步计算。构建预设可以提示从未使用 `signal` 的异步处理函数。

### P5 运行位置与插件通道

以下细化由开发者于 2026-09-30 确认。

插件最多有服务端部分与浏览器部分。浏览器部分运行在页面里，与界面之间的交互是页面内调用，不走网络；只有需要服务端能力时才经插件通道访问自己的服务端部分。VS Code 的扩展代码全部在扩展宿主，界面交互每次都跨边界；本设计与 DeepSeek Harness 相同，插件的浏览器一半就在页面里。

| 通路 | 例子 | 机制 |
|---|---|---|
| 浏览器部分与界面之间 | Files 向侧栏贡献视图；文生图向编辑器插入图片 | 贡献、浏览器端导出 API、命令，页面内调用 |
| 浏览器部分与自己的服务端部分之间 | 资源管理器读取目录树、订阅文件变更 | 插件通道 |
| 浏览器部分使用另一插件的服务端能力 | 文生图浏览器部分生成图片 | 先经自己的通道到自己的服务端部分，再调用对方在服务端的导出 API；或调用对方在浏览器端的导出 API，由对方经自己的通道完成 |
| 服务端通知浏览器 | 文件变更、插件集合变化 | 只推事件，不向浏览器发请求并等回复 |

**合同。** 每个插件一份合同模块（zod），含三种原语：调用 `call`、订阅 `subscription`、流 `stream({up, down})`。参数是一个输入对象，两端严格校验。SDK 构建预设由合同生成清单中的 `http.endpoints` 贡献、两端 TS 类型与 OpenAPI。服务端部分用 `ctx.channel.handle`、`ctx.channel.subscribe`、`ctx.channel.stream` 交出实现；浏览器部分用 `ctx.channel.call`、`ctx.channel.subscribe`、`ctx.channel.open` 使用。

**物理通道：**

- 调用走 `POST /api/plugins/<id>/rpc/<method>`；
- 事件与下行流走每个窗口一条多路复用的 SSE。本机服务是 HTTP/1.1，浏览器对同一来源的并发连接有上限，每条 SSE 长期占用一条，所以插件事件不各开连接；
- 上行流与双向流走每个窗口按需打开的一条 WebSocket 多路复用。合同原语现在定义，传输在第一个需要上行的功能（例如语音输入）落地时实现；调用与事件不迁移。Chromium 的流式上传只支持 HTTP/2，所以上行流不用 `fetch`。WebSocket 升级与鉴权的验证并入 G0（现有依赖 crossws 0.3.5 带 node 与 bun 适配器，Nitro 的 node-server 入口即用它处理升级）。

**通道语义：**

1. 取消：浏览器中止请求即服务端处理函数收到的终止信号，并与内核合成的信号（P1 第 6 项）合并。
2. 订阅：带参数，不是广播；事件不重放；断线重连后自动重新订阅，并通知插件重新查询基线（例如按消息 id 游标补齐）。
3. 二进制：调用与事件不携带二进制，经有时效、需鉴权的 URL 传递；流的帧可以携带二进制。
4. 服务端需要用户回答时，把待处理事项持久化并推送事件，用户经普通调用回答；不采用 DeepSeek Harness 的 waterfall 事件回传。NeuroBook 现有的 Agent 审批即此模式。
5. 连接作用域：服务端为每个窗口建立连接作用域，订阅同时登记在插件作用域与连接作用域上，任一关闭即结束；插件集合的变化经同一条流通知所有窗口。
6. 身份：每次调用与订阅经过现有认证中间件，处理函数上下文携带已鉴权的用户；涉及 Project 的调用在参数中显式携带 Project 身份与代次，服务端重新校验，不依赖“当前 Project”。
7. 插件私有存储 `ctx.storage` 在阶段 3 提供（例如聊天记录）。

**HTTP 入口两层。** 两层都是向 `nbook.http` 的贡献，都随插件禁用撤回，在途请求都经内核调用包装记账，都进入 API 文档：

| 层 | 作者写什么 | 路径 | 用途 |
|---|---|---|---|
| 合同端点（默认） | 合同加 `ctx.channel.handle` | 生成：`/api/plugins/<id>/rpc/<method>` | 新端点，内置与第三方一致 |
| 路由贡献 `http.routes` | 清单声明方法、路径、鉴权方式，可附 schema；激活时交出处理函数 | 内置插件可保留现有路径；第三方固定在 `/api/plugins/<id>/raw/` 下 | 把现有 Nitro 路由原样迁进插件；webhook、OAuth 回调、兼容外部协议 |

第三方的路由处理函数使用 Web 标准的 `(request: Request, ctx) => Response`，不暴露 h3 类型；内置插件迁移期可以交出现有 h3 处理函数，由 `nbook.http` 适配。竖切中的 Files 与后续新内置插件的新端点走合同端点，让内置插件先用上第三方将用的同一路径；现有约 160 个 Nitro 文件路由不做横向迁移，随所属功能迁入插件时可先以路由贡献保持 URL 不变，再在功能改动时改为合同端点。端点声明与 API 文档见 [P11](#p11-启动停止与插件状态)。

走查中用来检验这一设计的例子（不是本路线的交付项）：聊天室是调用加按房间参数的订阅扇出，断线后按游标补齐；AI 补全是调用加终止信号，新按键到来即中止上一次；内置中文输入法在浏览器部分同步处理按键，词库放在浏览器端 worker；语音输入需要双向流。

### P6 服务端宿主：内核拥有进程

**生产构建：** 用 Nitro 的 `entry` 选项指定自有宿主入口，入口与所有服务端代码处于同一次构建、同一模块图，避免同一模块出现两份实例。入口的职责：

1. 用 [`ServerRuntimeHost`](../../server/runtime/foundation/server-host.ts) 建立运行实例并挂接进程信号与 Desktop/Manager 的停止通道；
2. 按清单登记内置与已安装插件，执行启动门禁；
3. `nbook.http` 插件激活时用 `toNodeListener(useNitroApp().h3App)` 建立 HTTP 服务并监听端口。沿用现在的语义：端口先监听，业务请求等待运行实例就绪；
4. 停止时 http 插件先停止接纳并等待在途请求，其它插件按依赖逆序关闭。

`.output/server/index.mjs` 路径不变，Manager、Desktop、容器的启动合同不变。Nitro 自带的 `setupGracefulShutdown` 与 node-server 监听不再使用。[`server/plugins/`](../../server/plugins/) 下现有的 Nitro 插件（日志、Boot Config、Storage 定义、错误日志、Project 会话关闭、Server Timing）逐项改为内核插件的职责。

**开发模式：** `nuxi dev` 在 worker 中拥有端口监听。开发适配器是一个 Nitro 插件：在 Nitro 初始化时（不是首个请求时）建立同一运行实例，在 Nitro 的 `close` 钩子中停止它；http 插件在开发模式只提供 h3 应用、不监听。开发与生产只在“谁监听端口”上不同。

**主线程卡死看门狗：** 插件与宿主同线程运行，主线程上的同步计算无法被打断，宿主的超时定时器也会停摆。服务端宿主启动一个看门狗 worker，经共享内存读取主线程每秒递增的心跳；停滞超过阈值（低于 Session Store 租约的 30 秒过期时间，例如 20 秒）时，写出卡死报告（含当时在途的插件调用），结束进程，由 Desktop 或 Manager 重启。重启后内核读取报告，提示禁用相关插件；同一插件反复导致卡死或崩溃时自动进入安全模式。本机 Bun 1.4.2 实测：主线程死循环约 1 秒后被检出，报告写出，进程以 `SIGKILL` 结束（[t26 证据](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)）。

**风险门 G0：** 上述自定义入口仅从源码与类型推断可行。实施前先做一次性验证：自定义入口的产品构建能启动与停止；服务端单例只有一份；Desktop 的就绪探测与停止通道正常；开发模式热重载后不残留旧实例；自有入口在 Bun 下能完成 WebSocket 升级并按现有会话鉴权（P5）。

**风险门 G2：** 看门狗阈值、Desktop 与 Manager 在进程被结束后的重启行为、Windows 上结束进程的方式、worker 池 API 形态，在阶段 1 前与 G0、G1 一起验证。

### P7 浏览器宿主与第三方界面

- 浏览器运行实例在 Nuxt client plugin 中、根组件挂载前建立，每个窗口一个；主页面不再创建运行时。
- `nbook.workbench` 内置插件拥有外壳布局，定义贡献点 `viewContainers`、`views`、`commands`、`menus`、`keybindings`，以后加 `editors`。页面只负责渲染 workbench 插件提供的根组件。
- 插件向 workbench 的视图贡献点提供组件与初始位置；视图最终出现在哪里由 workbench 决定，用户调整后的布局也由 workbench 持久化（沿用 [View Host](workbench-view-host.md) 的布局状态分层）。清单中的视图声明不含组件与模块路径，组件由拥有者插件在激活时交出，取代 View Host 提案中由宿主静态白名单解析 `factoryKey` 的做法。组件在 workbench 的组件树内渲染，外包错误边界。
- 视图实例沿用 View Host 的生命周期：首次可见才创建，隐藏（侧栏收起、切换容器）不销毁，离开容器或所属插件被禁用时释放。插件被禁用或卸载时，workbench 同时清理该插件视图的布局项；重新启用后视图回到贡献声明的初始位置。插件启用但激活失败或依赖受阻时保留布局项，原位显示原因。
- 第一版完全信任，第三方插件的浏览器部分可以为自己的视图提供 Vue 组件。浏览器端从 `/plugins/<id>/<version>/` 加载插件代码，由 http 插件从 State Root 提供文件。
- 以后引入隔离时，第三方视图改为 iframe 或数据驱动视图，公开 API 不变。

**插件的浏览器部分。** 一个插件可以有服务端部分与浏览器部分，两者都可选，不拆成两类插件。浏览器部分只放必须在页面里运行的东西：组件、编辑器扩展、操作选区与焦点等的命令实现、上下文键；领域逻辑、密钥与跨窗口一致的状态放在服务端部分。浏览器部分每个窗口激活一次，内部分三层：

| 层 | 内容 | 生命周期 |
|---|---|---|
| 数据模型 | 缓存、事件订阅、加载状态 | 插件激活作用域，视图隐藏或释放后仍在 |
| 组件 | 渲染模型、把用户操作转成命令或模型调用；不直接发请求 | 视图实例 |
| 贡献实现 | 命令处理函数、全局上下文键 | 插件激活作用域 |

- 只提供组件的插件可以省略 `activate`。
- 激活结果分两类：`local` 只交给本插件自己的组件，可以是响应式对象；`exports` 给其它插件，必须满足远程形态约束。
- 宿主只统一插件通道（鉴权、服务端地址、请求随作用域取消、断线重连与重新订阅、统一错误格式、事件复用一条流、请求日志）；请求什么、缓存什么由插件决定。
- 菜单位置由拥有者定义，并规定菜单项收到的参数与局部上下文，例如 Files 定义 `explorer/context`。上下文键分全局键（窗口级，登记在设置方的作用域上）与局部键（单次菜单调用时由菜单位置拥有者传入）；键在清单中声明，`when` 由 workbench 求值。

**风险门 G1：** 运行时加载的第三方组件必须与宿主共用同一份 Vue 与 nb-ui；否则响应式更新失效，`inject` 取不到宿主提供的 i18n、主题与浮层宿主。实施前比较两种做法：

1. import map：裸模块名 `vue`、`@notnotype/nb-ui` 与 SDK 指向宿主的转发模块。要求 import map 出现在 Nuxt 注入的首个模块脚本之前，并在 Electron、Tauri（WebKitGTK、WebView2）中逐个确认。
2. 宿主模块表：插件浏览器部分构建为登记工厂的 CommonJS 形式，外部依赖经宿主提供的 `require` 解析到冻结的共享模块表。DeepSeek Harness 已采用这一做法（[调研](../research/cordis-plugin-kernel.md) §6.6）；它不依赖 import map、不改 `index.html`，禁用时还能从表中删除插件代码让浏览器回收。

倾向第 2 种。验证内容：在源码树外建一个示例插件，在开发构建、生产构建、Electron 与 Tauri 中运行时加载，确认响应式更新、`inject` 取得宿主上下文、nb-ui 浮层正常、卸载无残留、组件抛错只影响本视图。SDK 声明插件编译所用 Vue 的版本范围，纳入 `engines.neurobook` 兼容检查。两种做法都不成立时，第三方视图退回 iframe 方案。

### P8 安装、发现、兼容与安全模式

- 已安装插件位于 `<State Root>/plugins/<publisher.name>/<version>/`，启用列表记录在同目录的清单文件中。
- 从本地文件夹安装：校验清单与 `engines.neurobook` 兼容范围，复制（不链接）到安装目录，标记启用，即时生效。安装确认界面必须说明完全信任的后果。
- 不兼容或清单无效的插件不登记，原因可在插件目录中查询；一个插件失败不影响其它插件与内置插件。
- 内置插件不可卸载；启动必需的内置插件不可禁用。
- **安全模式：** 提供启动参数与环境变量，使本次启动不激活任何第三方插件，用于插件拖垮启动时的恢复。

### P9 内置插件地图与推进阶段

| 阶段 | 插件 | 位置 | 职责与贡献点 | 取代的旧入口 |
|---|---|---|---|---|
| 1 地基 | `nbook.diagnostics` | 两端 | 诊断记录、脱敏、JSONL/console 输出 | Nitro 日志插件、关闭清单中的 app-logger |
| 1 | `nbook.app-state` | 服务端 | App SQLite、Prisma、迁移门禁、State Root 完整性检查 | 启动门禁中的 prerequisites、关闭清单中的 checkpoint 与 prisma |
| 1 | `nbook.sqlite`、`nbook.platform-files` | 服务端 | 已实现的机制插件进入产品清单 | 无（此前只在 smoke 中装配） |
| 1 | `nbook.http` | 服务端 | Nitro h3 应用、端口监听、插件通道、插件静态文件 | node-server 监听、启动中间件、Nitro 优雅关闭 |
| 1 | `nbook.session-store` | 服务端 | Agent Session Store 租约 | 清单中的 `agent-session-store` 能力 |
| 1 | `nbook.project` | 两端 | 服务端：Project 代次、文件索引、History；浏览器：本窗口当前 Project 与切换事件 | 关闭清单中的 file indexes；页面中的当前 Project 状态 |
| 1 | `nbook.storage` | 服务端 | Storage host | 关闭清单中的 storage-host |
| 1 | `nbook.agent`（仅生命周期） | 服务端 | Agent Harness 的创建与释放 | 关闭清单中的 agent-harness |
| 1 | `nbook.workbench` | 浏览器 | 外壳布局；views、commands、menus、keybindings 贡献点 | `index.vue` 中的运行时创建与命令注册 |
| 2 竖切 | `nbook.files` | 两端 | 合并现有两个 Files 插件；向 workbench 贡献视图与命令，定义 `explorer/context` 菜单位置；读写、批量、事件走插件通道；打开文件执行 `nbook.editor.open` 命令，编辑器插件就绪前由现有主页面编辑区注册该命令过渡 | Files 的 Nitro 路由、`product-browser-runtime.ts` |
| 2 | `nbook.api-docs` | 浏览器 | 展示 `nbook.http` 生成的 API 文档 | 无 |
| 3 扩展点 | `nbook.models` | 服务端 | 按能力（chat、vision、image-generation、embedding）提供模型调用；`models.adapters` 贡献点；密钥不外交 | `server/models/` 的直接调用方 |
| 3 | `nbook.agent`（扩展） | 服务端 | `agent.tools`、`agent.skills` 贡献点；导出“以某 Profile 发起任务” | `AgentToolRegistry` 的静态注册 |
| 3 | `nbook.editor` | 浏览器 | `editor/context` 菜单位置、编辑器上下文键；导出插入节点等 API | 编辑器组件内的直接调用 |
| 3 | `nbook.assets` | 服务端 | 写入 Project 资产并返回可访问 URL | 无统一入口 |
| 3 | `nbook.settings` | 两端 | `configuration` 贡献点、有效值、秘密字段 | 分散的配置读写 |
| 3 | 加载器与安装 | 两端 | P8 全部能力；运行期安装、启用、禁用、卸载、升级；插件私有存储 `ctx.storage`；先用一个示例外部插件验证 | 无 |
| 4 验收 | 文生图（第三方） | 两端 | 放在产品源码之外的独立目录 | — |

各阶段的退出条件：

- **阶段 1：** `product-shutdown.ts`、启动中间件与 `productRuntimeReady()` 的全局单例删除；进程信号与停止通道由宿主适配器处理；关闭顺序由依赖图产生；`index.vue` 不再创建运行时。G0、G1、G2 在本阶段开始前完成。
- **阶段 2：** 满足[目标](#目标) 5；Files 的现有合同与性能预算不回退。
- **阶段 3：** 示例外部插件从本地文件夹安装后不重启即可使四类贡献（命令菜单、视图、Agent 工具、设置）全部生效；运行期禁用或安全模式下全部消失，且不影响其它插件与正在运行的 Agent 会话。
- **阶段 4：** 满足[目标](#目标) 6。

### P10 已有实现的去留

| 现有实现 | 去留 | 原因 |
|---|---|---|
| `runtime/lifecycle`、`runtime/services` | 保留 | 与新需求不冲突；services 作为内部服务与导出 API 的实现 |
| `runtime/plugins` | 演进 | 接收者改由拥有者插件提供；加入清单、加载器、激活事件与跨位置同一身份 |
| `runtime/application` | 保留机制，改宿主 | 门禁与有序停止保留；宿主适配器改为拥有进程 |
| diagnostics、platform-files、sqlite 插件 | 保留，进入产品清单 | 已实现并验证，阶段 1 直接消费 |
| `server/runtime/product-startup.ts` | 拆解 | 门禁转为 app-state 与 session-store 插件的激活；删除启动中间件与全局单例 |
| `app/runtime/product-browser-runtime.ts` | 替换 | 由 workbench 插件与 files 插件的浏览器入口取代 |
| Files 服务、客户端、面板 | 保留实现，重新封装 | 行为与性能已验收；只改变装配与传输路径 |

### P11 启动、停止与插件状态

以下内容由开发者于 2026-09-28 走查启动流程后批准。

**前后端边界。** 第一版同源部署（Desktop、Manager、容器）。外壳独立部署不是第一版目标，但守住三条边界，以后只需补跨域认证与版本协商：

1. 浏览器与服务端之间的通信只经一个连接对象（插件通道与引导接口），服务端地址可配置；
2. 浏览器启动只依赖一个引导接口；
3. 浏览器共享模块的接入不依赖服务端改写 `index.html`。

**服务端启动序列：**

```text
0 入口读取启动参数：State Root、端口、安全模式、停止通道
1 建立运行实例：根作用域、服务装配、插件宿主、最小诊断；挂接进程信号与停止通道
2 发现：内置插件表（构建时生成）+ State Root 中已启用插件的清单；安全模式跳过第三方
3 登记，不执行插件代码：清单格式、兼容范围、身份冲突、依赖（缺失、版本、环）、
  贡献点与贡献校验、端点收集。不合格的插件及其必需依赖者标为受阻；
  启动必需的内置插件受阻则启动失败
4 启动激活：启动必需插件与声明 onStartup 的插件，依赖先于依赖者
5 http 插件激活后监听端口；业务请求等待运行实例就绪
6 其余插件按激活事件懒激活
7 停止：http 停止接纳并等待在途请求，其余插件按依赖逆序关闭
```

**浏览器启动序列：**

```text
1 加载外壳：index.html、Nuxt 入口与框架插件
2 宿主 client plugin 在根组件挂载前调用引导接口，取得服务端生效的插件集合与协议版本；
  失败则显示连接失败页，不渲染半个工作台
3 建立运行实例，登记内置浏览器插件与第三方 browser 入口（只登记清单）；插件集合以服务端为准
4 激活 nbook.workbench，恢复布局，挂载根组件
5 可见视图触发 onView，激活其所属插件；不可见视图的插件不加载
6 建立一条事件流；窗口关闭时按依赖逆序停止
```

**顺序规则：**

- 登记顺序没有语义，全部登记后再计算依赖图；诊断按插件 id 排序。
- 激活顺序只由依赖决定。没有依赖关系的插件之间不保证先后、可能并发，插件不得依赖未声明的顺序。
- 关闭严格按依赖逆序，沿用 `runtime.services` 的“消费者先收口、提供者最后释放”，取代 `product-shutdown.ts` 的手写清单。
- `pluginDependencies` 在内核中映射为对被依赖插件导出 API 服务键的必需依赖，失败连带、激活去重与关闭顺序直接复用 `runtime.services`。依赖可以带版本范围，不兼容时在登记阶段受阻。

**端点与 API 文档：**

- `http.endpoints` 贡献点归 `nbook.http` 所有，每项包含方法名、输入与输出 schema、错误与说明。
- 声明是清单中的静态数据，由 SDK 构建预设从 TS/zod 定义生成；登记阶段即可收集，未激活插件的端点也出现在文档中；首次调用触发激活。
- 内核只做通用的贡献收集；`nbook.http` 据此生成 OpenAPI 并导出，收到请求时按同一 schema 校验输入。
- `nbook.api-docs` 插件展示文档；迁移期可合并 Nitro 为旧文件路由生成的文档（现有配置仅开发模式生成，且多数路由没有 schema）。

**插件状态与连带受阻（2026-09-29 修订为运行期即时生效）：**

- 状态分两类。用户状态只有三种：已启用、已禁用、未安装，持久化，由用户操作改变。运行状态由内核推导，不写入用户设置：已登记、激活中、可用、失败、受阻（必需依赖不可用）。
- 必需依赖（导出 API）不可用时，直接或间接依赖它的插件全部受阻；依赖恢复后自动解除，各自按激活事件重新激活，代次加一。这与 `runtime.services` 的必需消费者闭包是同一规则；Cordis 由服务提供者变化驱动消费者卸载与重载，语义相同（[调研](../research/cordis-plugin-kernel.md)）。
- 只经贡献点或命令协作不构成依赖：拥有者缺席时贡献挂起，拥有者恢复后重新生效；命令不存在时返回结构化错误。
- 安装、启用、禁用、卸载、升级都即时生效。禁用前计算会连带受阻的插件并列出在途调用，由用户确认。
- 启动必需的内置插件不能禁用。

**热插拔的承诺分三档（2026-09-30 开发者确认）：**

| 档位 | 内容 | 承诺 |
|---|---|---|
| L1 即时生效 | 安装、启用、禁用、卸载、升级立即生效；禁用后插件的全部可见效果与它交出的全部引用被撤回，在途工作结束或被放弃 | 承诺 |
| L2 回收代码与内存 | 反复启用、禁用、升级不使内存增长 | 尽力而为，开发模式可验证 |
| L3 保证恢复到启用前 | 无论插件如何实现都完全干净 | 不做；重启应用即完全干净 |

**卸载的六个层面：**

| 层面 | 内容 | 能否做到 | 手段 |
|---|---|---|---|
| 可见效果 | 菜单、视图与布局项、命令、工具、端点、设置项、上下文键 | 能 | 内核按账本逐项撤回 |
| 其它插件持有的引用 | 拥有者持有的实现、依赖方持有的 API、订阅回调 | 经内核建立的能 | 句柄与转发器失效（P1 第 5 项）；视图组件由 workbench 在撤回时卸载并丢弃 |
| 插件自行留下的引用 | 全局变量、修改宿主原型、裸定时器、`process.on`、向共享库写入状态 | 完全信任下拦不住 | 开发模式弱引用检测、构建期检查、重启兜底 |
| 代码与内存 | 模块与闭包被回收 | 前两层都清理干净时能 | 删除 `require.cache` 或浏览器模块表中的插件模块（P1 第 8 项） |
| 在途工作 | 在限定时间内结束 | 配合中止的能；在 worker 池中的能；主线程上的同步计算不能 | 见下文三步停止与看门狗 |
| 数据 | 插件写下的内容 | 不回滚 | 禁用保留；卸载时可选删除插件自己的存储；写入作品的内容属于用户数据，永不删除 |

**加载与卸载的四条规则：**

1. **登记跟随作用域。** 贡献实现、命令处理函数、事件订阅、上下文键、借用的导出 API 都登记在登记方的激活作用域上，作用域关闭时自动撤回。
2. **撤回由内核推送。** 贡献点拥有者经接收者得到声明层与实现层通知；导出 API 的使用方按连带规则先于提供方受阻，残留的转发器失效；命令调用方在调用时得到结果。拥有者不轮询。
3. **三步停止。** 连带受阻的插件按依赖逆序先于被禁用插件执行：
   1. 等待：停止接纳新调用，按声明逆序撤回它交出的贡献，有界等待在途调用自然完成；
   2. 中止：触发插件的终止信号，再给一段短时间；
   3. 放弃：仍未结束的调用由内核替调用方结算为“已中断”，撤销该插件持有的全部宿主 API 转发器，删除其模块缓存；迟到的结果一律丢弃。
4. **两层变化。** 声明层是插件启用或禁用使清单声明出现或消失；实现层是激活或停止。声明在而实现不在时可以显示、用到时激活；声明不在时不显示。

**在途工作不依赖开发者自觉来保证宿主正确。** 调用方不会被卡住，被放弃的工作无法再经宿主 API 产生副作用，迟到结果不会发布；只有效率（后台空转、外部费用）依赖插件把信号传给自己的 I/O。唯一的例外是主线程上的同步 CPU 计算：JS 无法打断它，所以规定 CPU 工作进 worker 池（P4），并由看门狗兜底（P6）。

| 插件实现 | 调用方看到 | 插件一侧 |
|---|---|---|
| 配合中止 | 最迟在三步停止结束时得到“已中断” | I/O 被中止，资源立即释放 |
| 不响应中止的异步工作 | 同上 | 在后台继续执行；再调用宿主 API 时失败；结束后被回收 |
| CPU 工作在 worker 池中 | 同上 | worker 被终止（本机实测 3 至 14 毫秒） |
| CPU 工作直接在主线程上 | 计算结束前整个服务端没有响应 | 超过看门狗阈值时进程被结束并重启 |

各协作方式的终止信号来源：导出 API 调用、贡献调用、命令由内核合成；事件不需要（发出方不等待监听者，监听者的异常互相隔离）；插件通道的请求随浏览器端作用域关闭或断线取消。

**代码与内存：** 已加载的 ESM 没有公开的卸载 API；Bun 1.4.2 中删除 `require.cache` 对 ESM 同样生效，本机实测撤回引用并删除缓存后内存不随启用、禁用、升级次数增长，弱引用检测在 2 至 3 轮 GC 后确认回收（[调研](../research/runtime-module-unloading.md) §4.4，[t26 证据](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)）。这一行为失效时退回“旧代码保留到重启”，L1 不受影响。浏览器端采用宿主模块表（P7 G1）时，禁用时同样删除插件代码。

## 备选方案和取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| 竖切优先，内核继续寄居 Nitro | 已由开发者否决 | 见 ADR 0022 |
| Nitro 继续拥有进程，内核在 Nitro 初始化时创建 | 仅用于开发模式 | 改动小，但关闭顺序仍分属 Nitro 与内核两套机制，Worker、CLI 等无 HTTP 宿主也无法复用同一入口 |
| 单独构建内核入口，把 Nitro 产物当库导入 | 拒绝 | 两个模块图会让共享模块各有一份实例，单例与租约失效 |
| 第三方插件贡献原始 HTTP 路由 | 受限采用 | 合同端点表达不了 webhook、OAuth 回调与外部协议；路径固定在 `/api/plugins/<id>/raw/` 下、处理函数用 Web 标准 `Request`/`Response`、清单声明鉴权方式（P5） |
| 每个第三方插件一个 worker 线程 | 拒绝 | 本机实测内存开销小，但需要为全部 API 建跨线程代理层；DeepSeek Harness 以同样理由否决隔离路线 |
| 共享插件宿主 worker | 推迟，作为升级路径 | 出现第三方插件拖垮服务端的实际问题或插件数量明显增长时再加，公开 API 不变 |
| 用一条 WebSocket 多路复用承载全部通道 | 不采用 | 调用与事件沿用现有 Cookie 鉴权与 SSE；WebSocket 只承载上行流与双向流 |
| waterfall 事件回传（服务端向页面提问并等回复） | 拒绝 | 窗口关闭或刷新会丢问题、多窗口不知由谁回答；改用持久化的待处理事项加普通调用 |
| 检测某插件是否启用后持有其引用（可选依赖） | 拒绝 | 撤回无法记账、每个使用方都要处理出现与消失；改用门面加贡献或联动项 |
| 直接以 `Proxy.revocable` 交出导出 API | 拒绝 | 使用方解构出的方法仍是提供方的原始函数；改为内核转发器 |
| 独立清单文件（如 `nbook-plugin.json`） | 备选 | 与 `package.json` 等价；选后者是因为作者熟悉 npm 生态，与 VS Code 同形。评审可改 |
| 第三方插件自带 Vue | 拒绝 | 两个 Vue 运行时无法共享响应式与组件 |
| 第三方界面第一版只允许 iframe | 作为 G1 失败时的退路 | 隔离更好，但与完全信任的第一版目标相比开发成本高 |
| 内置插件也在运行时加载 | 拒绝 | 内置插件依赖 SFC 与 Nuxt 构建，运行时加载收益小；加载器由示例外部插件验证 |

## 数据、接口、安全、迁移、发布与回滚影响

- **数据：** 新增 `<State Root>/plugins/` 目录与启用清单；插件私有存储 `ctx.storage` 在阶段 3 提供，禁用时保留、卸载时可选删除。Project 内的插件数据暂不开放；文生图写入的是 Project 资产，经 assets 插件完成。看门狗的卡死报告写在 State Root 中。现有用户数据格式与数据库布局不变。
- **接口：** 新增公开 SDK 与插件通道路径 `/api/plugins/...`（合同端点、订阅事件流、第三方路由贡献的 `/raw/` 前缀，以后加双向流的 WebSocket）。现有 API 保持不变，直到所属功能迁入插件；迁入时可先以路由贡献保持 URL 不变。
- **安全：** 第一版完全信任；安装确认、安全模式、密钥不外交是兜底。插件通道经过现有认证，处理函数上下文携带已鉴权用户；路由贡献在清单中声明鉴权方式并在安装审查时显示。服务端按单一所有者处理。
- **迁移：** 按 P9 阶段推进；每条功能迁入时旧 owner 同步退出，不保留双写或双重清理。
- **发布：** 产品入口路径不变；需在 G0 中确认 Product Runtime Contract 与 Desktop 就绪、停止语义不变，在 G2 中确认进程被看门狗结束后 Desktop 与 Manager 的重启行为；若有变化则单独评估发布影响。
- **回滚：** 阶段 1 在实现分支按提交推进；若 G0 不成立，退回 node-server 入口并以开发模式适配器的方式在 Nitro 初始化时建立运行实例，其余插件化工作不受影响。

## 对 Spec 的预期改动

G0、G1、G2 验证完成后写入 `planned` Spec；在此之前不修改 Spec。现行的 [`runtime.plugins`](../../../../docs/specs/runtime/plugins.md) 仍把第三方加载与热卸载列为非目标，它描述的是已实现的行为，改写时一并更新。

| Capability | 改动 |
|---|---|
| `runtime.plugins` | 插件包与清单、拥有者插件定义的贡献点（声明层与实现层）、激活事件、跨位置同一身份、外部来源加载与兼容检查、联动项、引用账本与转发器、跨插件调用包装、三步停止、代码装载器与卸载、开发模式检查 |
| `runtime.application` | 宿主适配器拥有进程；开发与生产两种服务端宿主；停止来源；主线程卡死看门狗与卡死报告 |
| 新增：插件安装与发现 | 安装、启用、禁用、卸载、升级即时生效；三种用户状态与推导的运行状态；兼容、安全模式、失败呈现 |
| 新增：插件公开 API | SDK 公开面、远程形态约束、终止信号约定、worker 池、私有存储、错误与释放语义 |
| 新增：插件通道 | 合同三种原语、调用与订阅事件流、双向流、鉴权与用户身份、Project 身份与代次、断线重订阅、连接作用域、路由贡献 |
| 新增：API 文档 | 端点收集、OpenAPI 生成与展示 |
| `workbench.*` | 视图、命令、菜单、快捷键改由 workbench 插件的贡献点提供 |
| `workspace.files`、`workbench.files-explorer` | 传输改走插件通道；行为合同不变 |
| 模型、Agent 工具、编辑器、资产、设置 | 阶段 3 时按各自能力沿原 Spec 修订或新建 |

## 评审问题

以下三项已由开发者于 2026-09-28 批准：

1. **清单载体：** 采用 `package.json`。
2. **内置插件的新端点一律走插件通道（含 Files 竖切）：** 采用。Nitro 文件路由的类型推导与 OpenAPI 生成由 SDK 端点声明替代：内核收集端点声明生成 API 文档，可由 API 文档插件展示（见 [P5](#p5-运行位置与插件通道)）。
3. **G0 与 G1 放在阶段 1 之前单独验证：** 采用。两者任一不成立都会改变 P6 或 P7 的方案。

此后的两项：

4. **Agent 工具与 Profile 的装配**（2026-09-29 开发者决定移交）：工具如何装配到 Profile、工具变化与提示词缓存，留给 nb-harness 重构，见 [w00002 研究材料](../../../../.agents/works/w00002-neuro-agent-harness-redesign/research/2026-09-29-plugin-agent-tools-and-profiles.md)。本设计只保留贡献方被禁用时使用方的通用处理（P1、P11）。

5. **插件代码的执行位置与强制终止**（2026-09-30 开发者确认）：第三方插件与宿主同线程运行，不采用“每插件一个 worker”。本机 Bun 1.4.2 实测每个 worker 只增加约 1 至 4MB，内存不是障碍；否决的理由是跨线程代理层的工程量，DeepSeek Harness 同样以“传输项目”为由否决隔离路线。保护手段：引用账本与转发器（P1）、三步停止（P11）、CPU 工作进 worker 池（P4）、主线程卡死看门狗（P6）。升级路径是共享插件宿主 worker。证据：[worker 实验](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/worker-probe/output.txt)、[同线程实验](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)。

## 决策记录

| 日期 | 决策者 | 记录 |
|---|---|---|
| 2026-09-28 | 开发者 | 需求访谈确认：开放第三方可执行插件、内核拥有进程且领域能力皆为内置插件、第一版完全信任但 API 为远程形态、服务端单一所有者、先地基后竖切的推进顺序。长期决定见 [ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md) |
| 2026-09-28 | 开发者 | 要求把需求记录进仓库并展开架构设计；本文为设计稿，状态 `reviewing`，不授权实施 |
| 2026-09-28 | 开发者 | 批准三项评审问题；追加要求内核收集 SDK 端点声明生成 API 文档，并可由 API 文档插件展示；G0、G1 之前先走查前后端启动流程 |
| 2026-09-28 | 开发者 | 启动流程走查：批准同源部署加可分离边界、连带停用规则（第一版仍重启生效）、端点静态声明与 API 文档插件，记入 [P11](#p11-启动停止与插件状态)；继续走查插件协作与浏览器组件加载 |
| 2026-09-28 | 开发者 | 插件向 workbench 贡献组件与初始位置，实际位置与用户布局由 workbench 决定并持久化（P7）；热插拔、插件的浏览器部分定位与 G1 做法仍在讨论 |
| 2026-09-29 | 开发者 | 批准：插件安装、启用、禁用、卸载、升级即时生效，用户状态只有已启用、已禁用、未安装，加载与卸载四条规则（P1、P11，ADR 0022 同步修订）；插件的浏览器部分三层结构、宿主只统一通道、菜单位置与上下文键、G1 比较两种做法且倾向宿主模块表（P7）；三种协作方式与事件归导出 API（P3）；`nbook.project` 两端、Files 打开文件经命令过渡（P9）；插件被禁用或卸载时 workbench 清理其视图布局项。Agent 工具与 Profile 装配继续讨论 |
| 2026-09-30 | 开发者 | 重新确定需求基线，确认前三条：插件系统内置与第三方同一机制、第三方从本地文件夹安装、完全信任且与宿主同线程运行（撤回“每插件一个 worker”的建议）；热插拔分三档，承诺即时生效并撤回全部可见效果与引用（L1），代码与内存回收尽力而为并可验证（L2），不做保证恢复（L3），重启即完全干净；协作只有硬依赖（运行时导出 API 加编译期类型包）、贡献（内核作中间人）、命令三种，插件之间不在运行时 import 对方模块。可选能力、引用撤回与在途工作三条仍在讨论，确认后统一改写 P1、P3、P11 |
| 2026-09-30 | 开发者 | 确认基线后三条：可选能力用门面加贡献或联动项，不提供“检测是否启用后持有引用”；引用只经内核建立并记账，撤销后转发器失效；跨插件调用由内核包装，禁用分等待、中止、放弃三步，CPU 工作进 worker 池，主线程卡死由看门狗兜底。第三方插件与宿主同线程运行，不采用每插件一个 worker。已写入 P1、P3、P4、P6、P11 |
| 2026-09-30 | 开发者 | 插件与前端通信（P5）细化：同意调用与订阅的处理函数带已鉴权用户、插件私有存储 `ctx.storage` 在阶段 3 提供；服务端需要用户回答时用持久化的待处理事项加普通调用，不用 waterfall；HTTP 入口支持两层：合同生成的端点（默认）与向 `nbook.http` 贡献的路由。开发者提出语音输入、AI 补全、内置中文输入法的需求，双向流是否在合同中预留待确认，确认后统一写入 P5 |
| 2026-09-30 | 开发者 | 全部确认 P5 细化：合同三种原语（调用、订阅、流），流的上行传输在首个需要的功能落地时以 WebSocket 实现；HTTP 入口两层；编辑器输入与补全扩展点只作检验设计的例子，不列入本路线。设计改为 `accepted`，开 t27 验证 G0、G1、G2 |
