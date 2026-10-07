---
schema: nbook.proposal/v1
status: accepted
created: 2026-09-28
decided: 2026-09-30
supersedes: []
superseded-by: null
specs:
  - docs/specs/runtime/plugin-manifest.md
  - docs/specs/runtime/server-host.md
  - docs/specs/runtime/browser-host.md
  - docs/specs/runtime/plugin-channel.md
  - docs/specs/runtime/api-docs.md
  - docs/specs/runtime/plugin-hot-plug.md
  - docs/specs/runtime/plugin-install.md
  - docs/specs/runtime/plugin-code-loading.md
  - docs/specs/runtime/plugin-api.md
  - docs/specs/runtime/stall-watchdog.md
adrs:
  - docs/adr/0022-extensible-platform-and-plugin-trust.md
---

# 可扩展应用平台：内核、插件模型与推进路线

- 需求与五项长期决定已由开发者于 2026-09-28 确认，记于 [ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)；此后的设计走查逐项确认了启动流程、热插拔与卸载规则、协作方式、插件的浏览器部分、执行位置与插件通道、热升级、入口与服务级依赖，确认日期见[决策记录](#决策记录)。“Agent 工具与 Profile 的装配”已移交 nb-harness 重构。风险门 G0、G1、G2 已于同日验证（见 [w00017 t27](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/README.md)），结论写入 P2、P4、P5、P6、P7、P11；接受不等于实施授权；行为合同已于同日写入 `planned` Spec（见[对 Spec 的预期改动](#对-spec-的预期改动)），实施按阶段另行授权。
- 与既有提案的关系：
  - [应用运行时总提案](../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md)的内核合同（资源作用域、服务装配、激活事务、有序关闭）继续有效；其非目标“不加载第三方代码”由 ADR 0022 取代。
  - [产品装配提案](../../packages/neuro-book-legacy/docs/proposals/application-runtime-product-integration.md)中后端启动（S0）与 HTTP 入口的设计由本文 [P6](#p6-服务端宿主内核拥有进程) 替代；其余阶段待按本文复核。
  - [Workbench 与 View Host](workbench-view-host.md) 的布局算法与视图实例模型保留，贡献来源改由 workbench 插件的贡献点提供。
- 2026-10-07 起，运行位置、插件通道、`nbook.project`、`ctx.storage`/`ctx.config`/`ctx.secrets`、视图实例释放（P7）与 Agent 的位置，以 [ADR 0024](../adr/0024-multi-instance-runtime-topology.md)、[多实例运行时拓扑](multi-instance-runtime-topology.md)、[插件的数据与状态](plugin-data-model.md) 与 [外壳设计稿](workbench-shell-abstractions.md) 为准；本文相应段落随各切片修订。
- 本文不是 Spec，也不授权实施。设计过程与证据见 [w00017 t26](../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/README.md)。

## 问题

w00017 已经交付一个经过合同测试的小内核，但它还没有成为产品的骨架，第三方也没有可以接入的入口。可观察的问题有四个：

1. **内核是 Nitro 的客人。** Nitro 中间件 `00-product-startup.ts`（w00017 阶段 1 已删除） 在模块加载时调用 [`productRuntimeReady()`](../../packages/neuro-book-legacy/server/runtime/product-startup.ts) 建立运行实例，挂在 `globalThis.__nbookProductApplicationV1` 上，创建时传 `signals: []`；启动失败靠 `setImmediate` 抛出未捕获异常终止进程，因为 Nitro 不能等待异步插件。进程退出由 `product-shutdown.ts`（w00017 阶段 1 已删除） 的手写清单编排：agent-harness、product-runtime、workspace-file-indexes、storage-host、app-sqlite-checkpoint、app-prisma、app-logger。运行实例只是其中一项。
2. **功能接线靠手写。** 浏览器运行时由 3605 行的 [`index.vue`](../../packages/neuro-book-legacy/app/pages/index.vue) 创建；[`product-browser-runtime.ts`](../../packages/neuro-book-legacy/app/runtime/product-browser-runtime.ts) 中的视图和命令接收者只接受写死的 Files 常量声明；服务端清单的接收者为空数组。
3. **插件分层很浅。** 服务端 [`workspace-files`](../../packages/neuro-book-legacy/server/features/workspace-files/plugin.ts) 插件只提供一个服务工厂，不依赖平台文件或 SQLite 插件；诊断、平台文件、SQLite 三个插件只在 smoke 清单中装配。同一个 Files 功能在两端是两个插件身份（`workspace-files` 与 `nbook.files`）。
4. **没有面向第三方的面。** 没有插件包格式、运行时加载、由插件定义的贡献点、公开 SDK 或两端通信通道。

结果是：加一项功能要同时改主页面、启动清单和关闭清单；第三方无从接入。

## 目标与非目标

### 目标

以下目标来自 2026-09-28 确认的需求，理由见 ADR 0022。

1. **内核拥有进程。** 宿主适配器建立运行实例，内核只提供机制；进程信号、停止和关闭顺序由内核按依赖图决定，取代手写清单。
2. **内置与第三方同一机制。** HTTP、workbench、命令、编辑器、Agent、模型、Project、Files 都是内置插件；插件只经贡献点与导出 API 协作，命令建在这两者之上（[P3](#p3-插件之间的协作)）。
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
| 内核机制 | [`runtime/`](../../packages/neuro-book-legacy/runtime/) 下 lifecycle、services、plugins、application 四个模块，约 4.2k 行非测试代码；七项 runtime/platform Spec 为 `implemented` | 作用域、服务装配、激活事务可以直接复用 |
| 贡献接收者 | [`runtime/plugins/contracts.ts`](../../packages/neuro-book-legacy/runtime/plugins/contracts.ts) 的 `PluginHostOptions.receivers` 由宿主在创建时传入 | 需要改为由拥有者插件提供，第三方才能扩展内置插件定义的能力 |
| 服务端宿主适配 | [`server-host.ts`](../../packages/neuro-book-legacy/server/runtime/foundation/server-host.ts) 已能挂接进程信号、按实例 id 隔离、有界停止 | 可作为“内核拥有进程”的基础 |
| Nitro 入口能力 | nitropack 2.13.4 的 node preset 包含只导出 `listener` 而不监听端口的 `node-listener` 入口；`NitroOptions.entry` 可覆盖 preset 入口 | 可以让自有入口与 Nitro 共用一次构建和同一模块图；**仅从源码与类型推断，未构建验证** |
| 产品构建 | 产品镜像以 `NITRO_PRESET=node-server` 构建（`build-product-runtime-image.ts`（v2 整理时随交付链删除）），Desktop 与 Manager 启动 `.output/server/index.mjs` | 入口文件路径不变即可保持 Manager、Desktop、容器的启动合同 |
| 运行时加载先例 | [`runtime-artifact-import.ts`](../../packages/neuro-book-legacy/server/utils/runtime-artifact-import.ts) 在 Product 中绕过打包器导入落盘 ESM，已用于 Profile 编译产物与 World Engine schema | 服务端加载第三方插件代码有成熟机制 |
| 浏览器宿主 | Nuxt 4.4 `ssr: false`；Nuxt client plugin 先于根组件挂载 | 浏览器运行实例可以在挂载前建立，不必由页面创建 |
| Agent 工具 | [`AgentToolRegistry`](../../packages/neuro-book-legacy/server/agent/tools/tool-registry.ts) 区分注册与 Profile 允许（`toolKeys`），但同 key 后注册会静默覆盖 | 适合改造成 `agent.tools` 贡献点的接收者，重复身份需改为拒绝 |
| Files HTTP | [`server/api/workspace-files/`](../../packages/neuro-book-legacy/server/api/workspace-files/) 下 read/write/batch/events 等路由通过 `withProductWorkspaceFiles()` 借用插件服务 | 竖切需要把这些入口迁进插件 |

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
3. **激活事件（2026-10-06 开发者修订：由拥有者插件定义）。** 入口在清单中声明何时激活。内核只认识 `onStartup`；其它事件写作 `<前缀>:<参数>`，前缀像贡献点一样由拥有者插件声明为自己所有，例如 `nbook.commands` 的 `onCommand:<命令 id>`、`nbook.workbench` 的 `onView:<视图 id>`、`nbook.agent` 的 `onAgentTool:<工具名>`、`nbook.http` 的 `onChannel:<插件 id>`（该插件的通道首次被调用，激活它实现通道的服务端入口）。拥有者在需要时请内核触发自己前缀下的事件，内核激活本运行位置上声明了该事件的入口；新增激活方式只需新的拥有者声明前缀，不改内核。事件只是触发现有激活机制的条件，激活事务语义不变。
4. **运行期启用与禁用。** 贡献点接收者除实现层的 prepare、commit、revoke 外，还接收声明层通知（插件启用或禁用时声明出现或消失）；禁用按 [P11](#p11-启动停止与插件状态) 的三步停止执行；撤回后被调用的贡献实现与导出 API 统一返回结构化的 `plugin-unavailable` 错误（命令随其贡献撤回从命令表消失）；禁用前能列出该插件的在途调用供用户确认。
5. **引用账本。** 跨插件的引用只经内核建立，内核逐项记账：导出 API 以转发器交出，贡献实现以句柄交出，事件订阅以登记在订阅方作用域上的句柄交出。撤销后转发器与句柄失效，且不再引用提供方，即使使用方仍持有它们，提供方也能被回收。
6. **跨插件调用包装。** 导出 API 调用与贡献调用（执行命令即调用命令的贡献实现）都经内核包装：合成终止信号（调用方传入的信号、调用方被禁用、提供方被禁用），登记在途调用，禁用超时后替调用方结算为“已中断”。在做编辑器扩展点这类每次按键都会触发的路径之前，先对这层包装做基准测试。
7. **入口与服务级依赖（2026-09-30 开发者确认，取代原“联动项”）。** 插件是安装、启用、禁用、升级的单位；入口是运行与依赖的单位，沿用 `runtime.plugins` 已有的入口模型：每个入口声明运行位置、代码文件、激活事件、依赖的服务、提供的服务与贡献，各自激活、各自受阻。依赖指向服务而不是插件，只在同一运行位置内解析。原先的联动项就是一个依赖可选插件服务的入口，不再单列概念。见 [P2](#p2-插件包与清单)、[P3](#p3-插件之间的协作)。
8. **代码装载器。** 加载与卸载插件代码经一个接口完成。第一版用 `import()` 加载；卸载时按插件安装目录删除 Bun `require.cache` 中的全部模块，使代码可被回收（未文档化行为，用回归测试固定，失效时退回“保留到重启”）。`Bun.ModuleGraph` 进入稳定版后可替换实现，插件与公开 API 不变（[调研](../research/runtime-module-unloading.md)的“4.4 `require.cache` 对 ESM 生效”与“5. `Bun.ModuleGraph`”两节）。
9. **开发模式检查。** 卸载后用弱引用确认插件的激活上下文已被回收，未回收时报告“插件卸载后仍被引用”；对跨插件调用的参数与结果做一次结构化克隆，提前暴露传递活对象的违规。

### P2 插件包与清单

一个插件是一个目录，清单沿用 `package.json`。插件由一个或多个入口组成（P1 第 7 项）。下面是文生图插件的清单示意，由 SDK 构建预设生成（见下文）：

```json
{
  "name": "text-to-image",
  "publisher": "example",
  "version": "0.1.0",
  "engines": {"neurobook": "^1.0.0"},
  "entries": {
    "generator": {
      "location": "server",
      "main": "./dist/generator.mjs",
      "channel": true,
      "requires": ["nbook.models/image-generation", "nbook.assets/writer"],
      "activationEvents": ["onChannel:example.text-to-image", "onAgentTool:generate_illustration"],
      "contributes": {
        "agent.tools": [{"name": "generate_illustration", "description": "为场景生成插图", "inputSchema": {"type": "object"}}]
      }
    },
    "editor-ui": {
      "location": "browser",
      "main": "./dist/editor-ui.cjs",
      "requires": ["nbook.editor/document", "example.text-to-image/channel"],
      "activationEvents": ["onCommand:example.text-to-image.generate", "onView:example.textToImage.candidates"],
      "contributes": {
        "commands": [{"id": "example.text-to-image.generate", "title": "生成插图"}],
        "views": {"right": [{"id": "example.textToImage.candidates", "name": "候选插图"}]}
      }
    }
  },
  "contributes": {
    "menus": {"editor/context": [{"command": "example.text-to-image.generate", "when": "editorHasSelection"}]},
    "configuration": {"example.textToImage.style": {"type": "string", "default": "watercolor"}}
  }
}
```

用户禁用编辑器插件时，只有 `editor-ui` 受阻，右键菜单与候选视图消失；`generator` 照常运行，Agent 工具仍然可用，插件状态显示为部分可用。

- 插件 id 为 `publisher.name`；内置插件使用 `nbook.*`，第三方插件的 id 不得以 `nbook.` 开头，安装时拒绝。
- **入口：** `entries` 的键是插件内唯一的入口 id。`location` 第一版取 `server` 或 `browser`，但不写死两种：以后加 `tui` 等运行位置，只需新增对应的宿主（该位置的内核实例、代码装载器、通道客户端，以及拥有该位置贡献点的外壳插件），清单格式与依赖规则不变。插件可以只有浏览器入口，不需要服务端占位：清单统一由服务端内核登记，启停身份不依附于某个入口。现有 Files 的两个插件身份合并为 `nbook.files` 的两个入口。
- **服务与依赖：** 服务 id 写作 `<插件 id>/<名称>`，归提供它的插件所有，同一服务只有一个提供者；需要多个提供者时用贡献点。提供方入口在 `provides` 中声明服务 id，例如 `nbook.models` 的服务端入口提供 `nbook.models/image-generation`。`requires` 一律是必需依赖，可选能力用单独的入口表达（P3）。依赖只在同一运行位置内解析；唯一的跨位置依赖是浏览器入口依赖本插件的通道 `<插件 id>/channel`，它由声明 `"channel": true` 的服务端入口提供，一个插件最多一个（P5）。
- **版本范围：** 依赖内置插件的服务时不写版本：内置插件的公开 API 跟随 SDK，由 `engines.neurobook` 统一约束。依赖第三方插件的服务时，在顶层 `pluginVersions` 中写该插件的版本范围；它只约束版本，是否必需由各入口的 `requires` 决定。
- **贡献：** 需要实现的贡献（命令、视图、Agent 工具、路由）写在提供实现的入口下；纯声明（菜单、设置项、上下文键、菜单位置）写在顶层 `contributes`。
- **清单由 SDK 生成：** 作者在代码里用 `defineEntry({location, requires, provides, contributes, activate})` 声明入口，构建预设据此生成清单中的 `entries`，与贡献对应的激活事件一并生成。依赖只写一次，又能在执行插件代码之前完成登记检查、连带计算与升级检查。
- 入口都是预构建产物。服务端入口是把依赖打进单文件的 ESM，不在 State Root 解析 `node_modules`。浏览器入口是 SDK 构建预设生成的登记工厂式 CommonJS（G1 结论，见 [P7](#p7-浏览器宿主与第三方界面)），`vue`、`@notnotype/nb-ui` 与 SDK 从宿主模块表取得。构建预设带纯度检查：把 Vue、nb-ui 或 SDK 打进插件时构建失败，因为插件自带一份 Vue 会静默失效（G1 实测：点击后界面不更新，没有任何报错）。
- 内置插件使用同一清单格式，但代码随产品构建静态进入镜像，不走运行时加载，因为它们依赖 Vue SFC 与 Nuxt 构建。
- 走查中新增的清单内容：上下文键声明 `contextKeys` 与菜单位置 `menuLocations`（P7）、路由贡献 `http.routes`（P5）；`http.endpoints` 由合同生成，不手写。

### P3 插件之间的协作

| 方式 | 何时用 | 机制 |
|---|---|---|
| 贡献点 | 向另一插件拥有的能力提交声明，例如命令、菜单、视图、Agent 工具、设置项、模型适配器 | 清单 `contributes` 登记时校验；拥有者激活后接收；贡献方按激活事件提供实现。也可以在激活时经拥有者注入的 API 命令式注册，返回的句柄自动登记到调用方的激活作用域，同样记入内核账本 |
| 导出 API | 调用另一插件的能力，例如“用图像模型生成”“把图片写入 Project 资产” | 提供方入口在 `provides` 中声明服务 id，激活时交出实现；使用方入口在 `requires` 中声明后，于激活上下文中取得。内部即 runtime.services 的服务键 |

**命令建在这两种机制之上（2026-10-06 开发者修订，原为与贡献点、导出 API 并列的第三种方式）。** 命令用来弱耦合地触发动作，也让用户与 Agent 可以不经界面操作软件。它由内置插件 `nbook.commands` 提供，各运行位置（服务端、每个浏览器窗口、以后的终端界面）都有入口、各有一份命令表：插件经它的贡献点登记命令（声明加处理函数），调用方入口依赖它导出的命令服务并按 id 执行，参数可序列化。调用方依赖的是命令服务，不是提供命令的插件；目标命令不存在或已撤回时得到结构化的 `unknown-command`。菜单、快捷键与命令面板是命令的界面，归各运行位置的界面插件（浏览器里是 workbench）。

插件不在运行时 import 其它插件的模块：这样的 import 形成内核看不见的引用，提供方被禁用、卸载或升级后，使用方手里仍是旧模块，旧代码无法回收，还可能新旧两份并存。内置插件之间可以使用进程内的内部服务，这些服务可以是同步的、传对象引用；凡是提供给第三方的导出 API 必须满足 [P4](#p4-sdk-与远程形态约束) 的远程形态约束。

**模块与插件分开。** 要共享的东西按层归位：

| 要共享的东西 | 层 | 共享方式 |
|---|---|---|
| 类型 | 编译期 | 提供方发布类型包，使用方 `import type`，构建后不留痕迹；内置插件 API 的类型由 SDK 提供 |
| 无状态的纯函数、工具库 | 编译期代码 | 普通 npm 包，各自打包，不构成插件关系 |
| 有状态的运行时能力 | 插件 | 入口声明依赖的服务，运行时经内核取得导出 API |

VS Code 的 git 扩展是同一模式：使用方声明依赖 `vscode.git`，运行时取得其导出 API，类型来自 git 扩展提供的 `git.d.ts`。

**可选能力。** 不提供“检测某插件是否启用，然后持有它的引用”的写法，也不借贡献把服务回传给使用方（依赖方向与声明相反、撤回无法记账、初始化顺序难以追踪）。可选能力分两种表达：

1. **通用能力用门面加贡献。** 由始终存在的内置插件拥有门面，可选的提供方向门面贡献实现，使用方只调用门面并在调用时判断能力是否可用。例如日志后端贡献给 `nbook.diagnostics`，语音合成等模型能力以适配器贡献给 `nbook.models`。
2. **插件独有的可选联动用单独的入口**（P1 第 7 项）。例如插件 B 的 `tts` 入口依赖 B 自己的文本服务与 TTS 插件的语音服务：没有安装或禁用了 TTS 时只有这个入口受阻，B 的其它入口照常工作。这个入口的存活期落在所依赖服务的存活期之内，所以可以安全持有对方的导出 API；B 的其它入口不判断 TTS 是否存在。

**激活不互相等待。** 依赖图以入口为节点在登记阶段检查，必须无环；承担联动的入口依赖本插件的其它入口，反过来不行。拥有者不在自己的 `activate` 中调用贡献或等待依赖自己的插件；违反时由 `runtime.services` 现有的运行时等待环检测报错，而不是卡住。

- 选用原则是耦合越弱越好：只有必须取得结果或持续交互时才声明依赖、使用导出 API。只有入口的 `requires` 构成依赖，也只有它触发连带受阻，受阻按入口计算。
- 事件属于拥有者的导出 API（`onDidX(cb)` 返回可释放句柄），不设全局事件总线；“按顺序询问多个插件”的钩子由拥有者定义贡献点，并规定收集顺序、合并方式与失败处理。
- 插件通道只连接同一插件的服务端入口与浏览器入口。既跨端又跨插件时，先经自己的通道，再调用对方在同一端的服务；服务按运行位置分开。
- 共享数据经数据的拥有者读写，例如文生图经 `nbook.assets` 写入图片，资源管理器从 `nbook.files` 的变更事件看到新文件，两者互不依赖。

**为什么以入口为依赖单位。** 两端都有代码的插件如果只有一张插件级依赖表，依赖只有一端代码的插件（例如只在服务端的 `nbook.models`、只在浏览器的 `nbook.editor`）时，另一端会被误判为缺少依赖。调研的两个系统都没有“依赖某插件的某一端”的写法，但都只在同一端内解析依赖（[VS Code 调研](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/deps-vscode/REPORT.md)、[DeepSeek Harness 调研](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/deps-dsh/REPORT.md)）：

- VS Code 的一个扩展在一个窗口里只运行在一个宿主。依赖在另一个宿主时，要求被依赖方声明 `api: none` 并放弃导出 API；需要两端代码的功能拆成两个扩展，用命令通信。
- DeepSeek Harness 没有插件级的激活依赖。一个包的两端是两个独立的 cordis 插件，各自在代码里按服务名声明依赖；浏览器端经本地的远程调用网关使用服务端能力，服务端不在时到调用才失败。

本设计与 DeepSeek Harness 一样以入口为单位、按服务依赖，但有三处不同：依赖写进清单（由 SDK 从代码生成），使登记、禁用与升级之前就能判断影响；服务 id 归插件所有且只有一个提供者，缺少依赖时能告诉用户该装哪个插件；跨位置依赖只指向本插件的通道。

### P4 SDK 与远程形态约束

- SDK 是一个只含类型与少量纯函数的包，不依赖宿主内部模块。宿主把 API 对象注入 `activate(context)`，插件不在运行时 import 宿主代码。
- 公开 API 的约束：
  1. 方法全部返回 Promise；
  2. 参数与结果可被结构化克隆，不传函数、类实例、DOM 或 Vue 对象；
  3. 事件以“订阅返回可释放句柄”的形式提供，句柄登记到插件的激活作用域；
  4. 错误以结构化结果返回，失败原因可被定位；
  5. 每个处理函数都收到终止信号 `signal`，宿主 API 都接受 `signal`。
- 这些约束让第一版同进程直接调用与以后的跨进程 RPC 使用同一份接口定义；不跨插件传递活对象，也让撤回引用可以完整记账（P1 第 5 项）。
- 插件开发者须遵守的规则：状态只在 `activate` 内建立并登记到激活作用域，不在模块顶层保存；把收到的 `signal` 传给自己的 I/O；CPU 密集的工作交给 SDK 提供的 worker 池，不在主线程上长时间同步计算。构建预设可以提示从未使用 `signal` 的异步处理函数。
- worker 池（G2 原型在 Bun 与 Chrome 中实测，见 [G2 报告](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g2/REPORT.md)的“4. worker 池 API 原型”一节）：
  - 形态：`ctx.workers.run(module, input, {signal, transfer, onProgress})`，返回结构化结果（成功值，或 `interrupted`、`task-error`、`input-not-cloneable`、`output-not-cloneable`、`load-failed`、`worker-crashed` 之一），不抛异常；中止、插件禁用、宿主停止都以 `interrupted` 结算，迟到的结果与进度一律丢弃。
  - worker 模块是插件预构建的单文件 ESM，默认导出一个纯计算函数；输入输出必须可结构化克隆，大块二进制用 `transfer` 移交；worker 内拿不到宿主 API。
  - 按（插件，模块）复用空闲 worker，设全局与每插件上限，满员时排队；插件禁用时拒绝新调用、结算排队与在途调用并终止其全部 worker。
  - 限制：调用方在中止后立即得到“已中断”，但 Bun 中 WebAssembly 与原生阻塞调用要等其返回 JS 才停止（死循环只能随进程重启回收），Chrome 终止后约 2 秒才停；未停止的 worker 继续占名额并在诊断中按插件显示。开发者 2026-09-30 确认不强制插件把 WebAssembly 计算切成小段，只在文档中写明这一限制。

### P5 运行位置与插件通道

以下细化由开发者于 2026-09-30 确认。

插件的入口分布在服务端与浏览器，下文分别称为插件的服务端部分与浏览器部分。浏览器部分运行在页面里，与界面之间的交互是页面内调用，不走网络；只有需要服务端能力时才经插件通道访问自己的服务端部分。VS Code 的扩展代码全部在扩展宿主，界面交互每次都跨边界；本设计与 DeepSeek Harness 相同，插件的浏览器一半就在页面里。

| 通路 | 例子 | 机制 |
|---|---|---|
| 浏览器部分与界面之间 | Files 向侧栏贡献视图；文生图向编辑器插入图片 | 贡献、浏览器端导出 API、命令，页面内调用 |
| 浏览器部分与自己的服务端部分之间 | 资源管理器读取目录树、订阅文件变更 | 插件通道 |
| 浏览器部分使用另一插件的服务端能力 | 文生图浏览器部分生成图片 | 先经自己的通道到自己的服务端部分，再调用对方在服务端的导出 API；或调用对方在浏览器端的导出 API，由对方经自己的通道完成 |
| 服务端通知浏览器 | 文件变更、插件集合变化 | 只推事件，不向浏览器发请求并等回复 |

**合同。** 每个插件一份合同模块（zod），含三种原语：调用 `call`、订阅 `subscription`、流 `stream({up, down})`。参数是一个输入对象，两端严格校验。SDK 构建预设由合同生成清单中的 `http.endpoints` 贡献、两端 TS 类型与 OpenAPI。服务端部分用 `ctx.channel.handle`、`ctx.channel.subscribe`、`ctx.channel.stream` 交出实现；浏览器部分用 `ctx.channel.call`、`ctx.channel.subscribe`、`ctx.channel.open` 使用。实现合同的服务端入口在清单中声明 `"channel": true`，并提供服务 `<插件 id>/channel`，供本插件的浏览器入口声明依赖（P2）。

**物理通道：**

- 调用走 `POST /api/plugins/<id>/rpc/<method>`；
- 事件与下行流走每个窗口一条多路复用的 SSE。本机服务是 HTTP/1.1，浏览器对同一来源的并发连接有上限，每条 SSE 长期占用一条，所以插件事件不各开连接；
- 上行流与双向流走每个窗口按需打开的一条 WebSocket 多路复用。合同原语现在定义，传输在第一个需要上行的功能（例如语音输入）落地时实现；调用与事件不迁移。Chromium 的流式上传只支持 HTTP/2，所以上行流不用 `fetch`。G0 实测：Bun 1.4.2 下自有入口用 crossws 0.3.5 的 node 适配器完成升级与双向收发，带登录 Cookie 的升级成功、不带或伪造时返回 401。现有 `getCurrentUser` 会在会话失效时写回 Cookie，而升级请求没有可写的响应，所以要拆出不写 Cookie 的只读身份判定，HTTP 中间件与 WebSocket 升级共用；WebSocket 处理注册到 `h3App.websocket`，让开发与生产共用同一份（开发模式未验证）。

**通道语义：**

1. 取消：浏览器中止请求即服务端处理函数收到的终止信号，并与内核合成的信号（P1 第 6 项）合并。
2. 订阅：带参数，不是广播；事件不重放；断线重连后自动重新订阅，并通知插件重新查询基线（例如按消息 id 游标补齐）。
3. 二进制：调用与事件不携带二进制，经有时效、需鉴权的 URL 传递；流的帧可以携带二进制。
4. 服务端需要用户回答时，把待处理事项持久化并推送事件，用户经普通调用回答；不采用 DeepSeek Harness 的 waterfall 事件回传。NeuroBook 现有的 Agent 审批即此模式。
5. 连接作用域：服务端为每个窗口建立连接作用域，订阅同时登记在插件作用域与连接作用域上，任一关闭即结束；插件集合的变化经同一条流通知所有窗口。
6. 身份：每次调用与订阅经过现有认证中间件，处理函数上下文携带已鉴权的用户；涉及 Project 的调用在参数中显式携带 Project 身份与代次，服务端重新校验，不依赖“当前 Project”。
7. 插件私有存储 `ctx.storage` 在阶段 3 提供（例如聊天记录）。
8. 版本：浏览器部分发出的调用与订阅携带插件版本；与服务端当前生效的版本不一致时返回“版本已变化”，浏览器等待插件集合变化事件后重新加载该插件。这一条在热升级（[P8](#p8-安装发现兼容与安全模式)）切换的瞬间兜住在途请求。

**HTTP 入口两层。** 两层都是向 `nbook.http` 的贡献，都随插件禁用撤回，在途请求都经内核调用包装记账，都进入 API 文档：

| 层 | 作者写什么 | 路径 | 用途 |
|---|---|---|---|
| 合同端点（默认） | 合同加 `ctx.channel.handle` | 生成：`/api/plugins/<id>/rpc/<method>` | 新端点，内置与第三方一致 |
| 路由贡献 `http.routes` | 清单声明方法、路径、鉴权方式，可附 schema；激活时交出处理函数 | 内置插件可保留现有路径；第三方固定在 `/api/plugins/<id>/raw/` 下 | 把现有 Nitro 路由原样迁进插件；webhook、OAuth 回调、兼容外部协议 |

第三方的路由处理函数使用 Web 标准的 `(request: Request, ctx) => Response`，不暴露 h3 类型；内置插件迁移期可以交出现有 h3 处理函数，由 `nbook.http` 适配。竖切中的 Files 与后续新内置插件的新端点走合同端点，让内置插件先用上第三方将用的同一路径；现有约 160 个 Nitro 文件路由不做横向迁移，随所属功能迁入插件时可先以路由贡献保持 URL 不变，再在功能改动时改为合同端点。端点声明与 API 文档见 [P11](#p11-启动停止与插件状态)。

走查中用来检验这一设计的例子（不是本路线的交付项）：聊天室是调用加按房间参数的订阅扇出，断线后按游标补齐；AI 补全是调用加终止信号，新按键到来即中止上一次；内置中文输入法在浏览器部分同步处理按键，词库放在浏览器端 worker；语音输入需要双向流。

### P6 服务端宿主：内核拥有进程

风险门 G0、G2 已于 2026-09-30 验证（[G0 报告](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md)、[G2 报告](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g2/REPORT.md)）。开发者同日同意生命周期部分按验证证据直接写入，本节即按结论修订。

**生产构建：** 用 Nitro 的 `entry` 选项指定自有宿主入口，入口与所有服务端代码处于同一次构建、同一模块图（G0 实测：入口与路由取得的是同一份模块实例）。`entry` 由一个 Nuxt 模块只在非开发构建时注入，并在 `prerender:config` 中移除：直接写在 nuxt.config 的 `nitro.entry` 会同时替换开发 worker 与预渲染器的入口。自有入口依赖 nitropack 的内部导出（`#nitro-internal-pollyfills`、`trapUnhandledNodeErrors`），升级 nitropack（尤其是 Nitro 3）时要重新验证。入口的职责：

1. 用 [`ServerRuntimeHost`](../../packages/neuro-book-legacy/server/runtime/foundation/server-host.ts) 建立运行实例；进程信号与 Desktop/Manager 的停止通道只由宿主挂接一次；
2. 按清单登记内置与已安装插件，执行启动门禁。入口等待启动结果，失败时有序停止并以约定退出码退出，不依赖未捕获异常：Nitro 的 `trapUnhandledNodeErrors()` 会把它吞掉，进程存活并对所有请求返回 500（现有产品的同一问题由 w00020 / [PR #245](https://github.com/notnotype/neuro-book/pull/245) 修复）；
3. `nbook.http` 插件激活时用 `toNodeListener(useNitroApp().h3App)` 建立 HTTP 服务并监听端口（G0 实测 Bun 1.4.2 下先监听、约 50 毫秒后就绪）。沿用现在的语义：端口先监听，业务请求等待运行实例就绪；
4. 所有停止来源（进程信号、`PRODUCT_SHUTDOWN_PATH` 控制请求、租约失效）都经宿主的 `requestStop` 汇合：http 插件先停止接纳新请求（排空期间保持监听、对新请求返回 503），关闭 WebSocket，等待在途请求，其它插件再按依赖逆序关闭。现有的 HTTP 停止路由直接调用关闭控制器、绕过了停止接纳这一步，迁入时改正。

`.output/server/index.mjs` 路径不变，Manager、Desktop、容器的启动合同不变（G0 用 Manager 自己的就绪探测与停止函数实测通过；Desktop 经 Manager 间接依赖，未实跑）。Nitro 自带的 `setupGracefulShutdown` 与 node-server 监听不再使用。`server/plugins/`（w00017 阶段 1 已删除） 下现有的 Nitro 插件（日志、Boot Config、Storage 定义、错误日志、Project 会话关闭、Server Timing）逐项改为内核插件的职责。

**开发模式：** 与生产有三处不同，不只是“谁监听端口”：

1. 运行时：`bun x nuxt dev` 按 nuxt 可执行文件的 shebang 由 Node 运行，生产运行在 Bun；
2. 实例重叠：Nitro 热重载时不等旧 worker 关完就启动新 worker，每个 worker 是独立线程，进程级全局单例保护不起作用；
3. 停止：worker 中的 `process.exit` 只结束 worker 线程，nuxi 也不处理 SIGTERM，现有停止通道都不能有序停止开发进程。

开发适配器是一个 Nitro 插件，在 Nitro 初始化时（不是首个请求时）建立同一运行实例，http 插件在开发模式只提供 h3 应用、不监听。适配器要处理上述差异：

- 新实例取得进程级资源（Session Store 租约等）前，有界等待同一进程中的旧实例释放；
- 开发模式不缓存启动失败，下一次请求或热重载可以重试；
- 内核只注册一个不会抛错的 Nitro `close` 钩子，其余关闭由内核按依赖逆序管理：hookable 串行执行钩子，第一个抛错会跳过其余钩子；
- 停止通道另行设计，候选做法是只在开发时启用、运行在 nuxi 主进程中的 Nuxt 模块，接管信号与停止请求并调用 `nuxt.close()`（未验证）。

现有开发模式的同类问题登记为 [#244](https://github.com/notnotype/neuro-book/issues/244)，随阶段 1 解决。

**主线程卡死看门狗：** 插件与宿主同线程运行，主线程上的同步计算无法被打断，宿主的超时定时器也会停摆。服务端宿主启动一个看门狗 worker，经共享内存读取主线程心跳（G2 实测开销约 0.13% 单核 CPU、10MB 内存；主线程穿插 200 至 500 毫秒的同步任务时无误报）：

- **阈值 10 秒。** 必须小于 Session Store 租约的心跳间隔 15 秒，而不是过期时间 30 秒：卡死若发生在一次续期之前，锁在约 15 秒后即可被其它进程接管（G2 实测第 17.3 秒被接管，原进程恢复后还执行了一次写入）。
- **何时计时。** 启动完成后才开始计时；识别整个进程被暂停（例如系统睡眠）并重新计时；检测到调试器连接时停用，开发模式默认关闭，因为断点只暂停主线程，看门狗会误判为卡死。
- **卡死时的动作。** 写出卡死报告（在途插件调用，嫌疑按可信度分为 direct、candidate、weak、unknown），以专用退出码经 FFI 结束进程（POSIX `_exit`，Windows `TerminateProcess`）。不用 `SIGKILL`：经产品两层启动包装后，Manager 看到的是退出码 1，与启动失败无法区分。租约锁由 Manager 在确认进程已退出后删除再重启（不删锁则重启后要等锁过期，实测 9.6 秒）；看门狗自己不删锁，因为卡死的主线程可能在删锁与进程结束之间恢复，与新的锁持有者同时写入（2026-09-30 跨模型审查指出，据此修订）。
- **重启与提示的职责。** Manager 负责重启与重启次数上限，Desktop 负责重启期间的呈现，内核在下次启动时读报告并提示禁用相关插件；只有 direct 与 candidate 计入“反复卡死自动进入安全模式”。现有 Desktop 与 Manager 在服务就绪后既不重启也不提示，需要改产品运行时合同、Manager、Electron 与 Tauri。
- **分期（2026-09-30 开发者确认）。** 阶段 1 只做“只统计、不结束进程”的记录模式，也可以暂不做；结束进程、自动重启与提示禁用放在阶段 3，随第三方插件加载器一起做。难度不高，主要是跨五处的工作量。

**风险门 G0：** 已验证。生产侧成立：`entry` 自有入口构建、同一模块图、Bun 下自建 HTTP 服务并有序停止、Manager 就绪与停止合同、WebSocket 升级与会话鉴权。开发模式只部分成立，按上文重新设计。

**风险门 G2：** 已验证。看门狗、卡死报告与 worker 池可行；阈值、结束方式与重启职责按上文修订。Windows 上从 worker 结束进程只依据文档与源码，未实测。

### P7 浏览器宿主与第三方界面

- 浏览器运行实例在 Nuxt client plugin 中、根组件挂载前建立，每个窗口一个；主页面不再创建运行时。
- `nbook.workbench` 内置插件拥有外壳布局与界面类贡献点（页面、视图容器、视图、菜单，以后加编辑器），每个贡献点随第一个真实消费者加入，不预先做全（2026-10-06 开发者确认）。命令与默认键位由 `nbook.commands` 定义（[P3](#p3-插件之间的协作)），workbench 负责浏览器里的键位分发与命令面板。页面只负责渲染 workbench 插件提供的根组件。
- 插件向 workbench 的视图贡献点提供组件与初始位置；视图最终出现在哪里由 workbench 决定，用户调整后的布局也由 workbench 持久化（沿用 [View Host](workbench-view-host.md) 的布局状态分层）。清单中的视图声明不含组件与模块路径，组件由拥有者插件在激活时交出，取代 View Host 提案中由宿主静态白名单解析 `factoryKey` 的做法。组件在 workbench 的组件树内渲染，外包错误边界。
- 视图实例沿用 View Host 的生命周期：首次可见才创建，隐藏（侧栏收起、切换容器）不销毁，离开容器或所属插件被禁用时释放。插件被禁用或卸载时，workbench 同时清理该插件视图的布局项；重新启用后视图回到贡献声明的初始位置。插件启用但激活失败或依赖受阻时保留布局项，原位显示原因。
- 第一版完全信任，第三方插件的浏览器部分可以为自己的视图提供 Vue 组件。浏览器端从 `/api/plugins/<id>/files/<version>/` 加载插件代码，由 http 插件从 State Root 提供文件。这条路径需要登录：插件代码与已安装插件列表不对未登录用户公开（认证中间件对 `/api/` 只按白名单公开，见 w00020）；插件代码同源加载，请求自带登录 Cookie。
- 以后引入隔离时，第三方视图改为 iframe 或数据驱动视图，公开 API 不变。

**插件的浏览器部分。** 插件的浏览器部分指它在浏览器的入口。一个插件的入口可以只在服务端、只在浏览器或两端都有，不拆成两类插件。浏览器部分只放必须在页面里运行的东西：组件、编辑器扩展、操作选区与焦点等的命令实现、上下文键；领域逻辑、密钥与跨窗口一致的状态放在服务端部分。浏览器入口在每个窗口各激活一次，内部分三层：

| 层 | 内容 | 生命周期 |
|---|---|---|
| 数据模型 | 缓存、事件订阅、加载状态 | 插件激活作用域，视图隐藏或释放后仍在 |
| 组件 | 渲染模型、把用户操作转成命令或模型调用；不直接发请求 | 视图实例 |
| 贡献实现 | 命令处理函数、全局上下文键 | 插件激活作用域 |

- 只提供组件的插件可以省略 `activate`。
- 激活结果分两类：`local` 只交给本插件自己的组件，可以是响应式对象；`provides` 中声明的服务给其它插件，必须满足远程形态约束。
- 宿主只统一插件通道（鉴权、服务端地址、请求随作用域取消、断线重连与重新订阅、统一错误格式、事件复用一条流、请求日志）；请求什么、缓存什么由插件决定。
- 菜单位置由拥有者定义，并规定菜单项收到的参数与局部上下文，例如 Files 定义 `explorer/context`。上下文键分全局键（窗口级，登记在设置方的作用域上）与局部键（单次菜单调用时由菜单位置拥有者传入）；键在清单中声明，`when` 由 workbench 求值。

**风险门 G1：** 已于 2026-09-30 验证（[G1 报告](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g1/REPORT.md)）。import map 与宿主模块表两种做法，在开发与生产构建、Chromium 151、WPE WebKit 26.5、Electron 43、WebKitGTK 2.52.6 上，响应式更新、宿主 i18n 与主题与 `inject`、nb-ui 浮层、卸载无残留、抛错隔离全部成立。两者的区别在卸载：原生 ESM 模块被浏览器的模块映射永久持有，禁用后代码要到刷新页面才释放，升级必须换 URL；宿主模块表注销后代码可被回收（Chromium 与 Electron 堆快照实测）。Tauri 本体与 WebView2 未运行。

**采用宿主模块表：**

- 宿主在根组件挂载前建立一张冻结的共享模块表，放入 Vue、nb-ui 的共享入口与 SDK；插件浏览器部分由构建预设包装为登记工厂，执行时只登记，首次使用时经宿主提供的 `require` 从表中解析依赖。不需要改写 `index.html`、生成导出名单或放宽 CSP，开发与生产构建路径相同。
- 插件 `require` 表外模块时，在物化阶段返回结构化错误；同一 id 重复登记时拒绝。
- 禁用时依次注销表项、移除插件样式、释放视图；插件 CSS 的加载与移除由加载器负责。
- 错误边界（`onErrorCaptured`）只覆盖 Vue 调用路径上的错误（渲染、生命周期、事件处理）；插件自己的定时器与未被 Vue 接管的 Promise 中的错误不在其内。为此 SDK 提供登记在激活作用域上的定时器与异步包装（例如 `ctx.setTimeout`、`ctx.run(promise)`），其中抛出的错误记入该插件的诊断，插件禁用时自动清理（开发者 2026-09-30 确认）；服务端部分同样适用。生产构建的 Vue 只给出错误参考链接，诊断记录需另存组件名与错误信息。
- 共享哪些 nb-ui 入口等于对插件作者承诺哪些 API 保持兼容，纳入 `engines.neurobook` 兼容范围。第一版只共享 `@notnotype/nb-ui/components`，其余入口按需再加；开发者 2026-09-30 同意，并要求配合一个需要界面的插件（例如 Files）一起设计。内置插件随宿主构建、不经模块表，所以模块表由阶段 3 的示例外部插件实际检验。共享会让宿主包对 Vue 与 nb-ui 失去 tree-shaking，体积影响待测。
- SDK 声明插件编译所用 Vue 的版本范围，纳入 `engines.neurobook` 兼容检查。
- 浏览器侧的“卸载后仍被引用”开发检查沿用 G1 的方法：弱引用加强制 GC；Vue 开发构建会缓冲页面加载后前 3 秒的组件事件，检查要等缓冲清空后进行。

### P8 安装、发现、兼容与安全模式

- 已安装插件位于 `<State Root>/plugins/<publisher.name>/<version>/`，启用列表记录在同目录的清单文件中。
- 从本地文件夹安装：校验清单与 `engines.neurobook` 兼容范围，复制（不链接）到安装目录，标记启用，即时生效。安装确认界面必须说明完全信任的后果。
- 不兼容或清单无效的插件不登记，原因可在插件目录中查询；一个插件失败不影响其它插件与内置插件。
- 内置插件不可卸载；启动必需的内置插件不可禁用。
- **安全模式：** 提供启动参数与环境变量，使本次启动不激活任何第三方插件，用于插件拖垮启动时的恢复。

**热升级（2026-09-30 开发者确认，阶段 3 实现）：** 第三方插件升级不重启。内置插件随 NeuroBook 升级，NeuroBook 升级要重启，不在此列。VS Code 更新扩展后要重启扩展宿主，DeepSeek Harness 替换插件版本要重启进程；本设计复用禁用与启用的机制做到即时生效，新增的只有升级前检查、失败回滚、通道版本校验与迁移提示。

1. **准备：** 新版本复制到 `<State Root>/plugins/<id>/<新版本>/`，与旧版本并存；校验清单与 `engines.neurobook`。依赖它的插件如果在 `pluginVersions` 中声明的范围不接受新版本，列出这些插件，由用户确认升级后它们受阻。
2. **切换：** 旧版本按禁用执行三步停止（[P11](#p11-启动停止与插件状态)），依赖它的入口先停；登记新版本。旧版本原先处于激活状态时新版本立即激活，否则只登记；依赖者重新激活，取得新版本的导出 API。确认界面提示依赖者会短暂停止、在途调用会被中断。
3. **两端同步：** 服务端经插件集合变化事件通知所有窗口；窗口停止旧的浏览器部分、从宿主模块表注销旧代码、加载新版本，页面不刷新。切换瞬间的在途通道请求由版本校验兜住（P5 通道语义第 8 条）。
4. **失败回滚：** 升级只在服务端判定：新版本登记失败，或旧版本已激活、新版本仍存在的服务端入口激活失败时，自动切回旧版本；这两步成功之前不删除旧版本目录。浏览器入口在某个窗口中失败不触发回滚，按窗口失败呈现，升级不是跨运行位置的原子操作。同一版本重装被拒绝。
5. **数据：** 插件私有存储与配置跨版本保留。数据格式的迁移由插件自己完成，激活时 SDK 提供上一次激活的版本号。回滚后旧版本可能读到已被新版本迁移的数据，内核不回滚数据，插件作者文档写明这一限制。
6. **回收旧代码：** 服务端删除旧版本的模块缓存，浏览器注销旧模块表项，按 L2 尽力回收（P11）。

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
| 1 | `nbook.workbench` | 浏览器 | 外壳布局与界面类贡献点；命令面板与浏览器键位分发 | `index.vue` 中的运行时创建 |
| 1 | `nbook.commands` | 两端 | 命令贡献点、各运行位置的命令表与执行管线、上下文键与 `when` 求值 | `index.vue` 中的命令注册 |
| 2 竖切 | `nbook.files` | 两端 | 合并现有两个 Files 插件；向 workbench 贡献视图与命令，定义 `explorer/context` 菜单位置；读写、批量、事件走插件通道；打开文件执行 `nbook.editor.open` 命令，编辑器插件就绪前由现有主页面编辑区注册该命令过渡 | Files 的 Nitro 路由、`product-browser-runtime.ts` |
| 2 | `nbook.api-docs` | 浏览器 | 展示 `nbook.http` 生成的 API 文档 | 无 |
| 3 扩展点 | `nbook.models` | 服务端 | 按能力（chat、vision、image-generation、embedding）提供模型调用；`models.adapters` 贡献点；密钥不外交 | `server/models/` 的直接调用方 |
| 3 | `nbook.agent`（扩展） | 服务端 | `agent.tools`、`agent.skills` 贡献点；导出“以某 Profile 发起任务” | `AgentToolRegistry` 的静态注册 |
| 3 | `nbook.editor` | 浏览器 | `editor/context` 菜单位置、编辑器上下文键；导出插入节点等 API | 编辑器组件内的直接调用 |
| 3 | `nbook.assets` | 服务端 | 写入 Project 资产并返回可访问 URL | 无统一入口 |
| 3 | `nbook.settings` | 两端 | `configuration` 贡献点、有效值、秘密字段；插件经 `ctx.config` 读取自己的配置，经 `ctx.secrets` 存取自己的密钥（只在服务端可用，落盘加密，不发给浏览器） | 分散的配置读写 |
| 3 | 加载器与安装 | 两端 | P8 全部能力；运行期安装、启用、禁用、卸载、热升级与失败回滚；插件私有存储 `ctx.storage`；宿主模块表与共享的 nb-ui 入口；看门狗结束进程、自动重启与提示禁用（P6）；先用一个示例外部插件验证 | 无 |
| 4 验收 | 文生图（第三方） | 两端 | 放在产品源码之外的独立目录 | — |

各阶段的退出条件：

- **阶段 1：** `product-shutdown.ts`、启动中间件与 `productRuntimeReady()` 的全局单例删除；进程信号与停止通道由宿主适配器处理；关闭顺序由依赖图产生；`index.vue` 不再创建运行时。G0、G1、G2 已于 2026-09-30 验证完成（[t27](../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/README.md)）。
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
  贡献点与贡献校验、端点收集。清单无效的插件不登记；依赖不满足的入口及依赖它的入口标为受阻；
  启动必需的内置插件受阻则启动失败
4 启动激活：启动必需插件的入口与声明 onStartup 的入口，依赖先于依赖者
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
- 入口的 `requires` 直接对应 `runtime.services` 的必需依赖，失败连带、激活去重与关闭顺序直接复用。`pluginVersions` 不兼容时，依赖该插件的入口在登记阶段受阻。

**端点与 API 文档：**

- `http.endpoints` 贡献点归 `nbook.http` 所有，每项包含方法名、输入与输出 schema、错误与说明。
- 声明是清单中的静态数据，由 SDK 构建预设从 TS/zod 定义生成；登记阶段即可收集，未激活插件的端点也出现在文档中；首次调用触发激活。
- 内核只做通用的贡献收集；`nbook.http` 据此生成 OpenAPI 并导出，收到请求时按同一 schema 校验输入。
- `nbook.api-docs` 插件展示文档；迁移期可合并 Nitro 为旧文件路由生成的文档（现有配置仅开发模式生成，且多数路由没有 schema）。

**插件状态与连带受阻（2026-09-29 修订为运行期即时生效）：**

- 状态分两类。用户状态只有三种：已启用、已禁用、未安装，持久化，由用户操作改变。运行状态由内核按入口推导，不写入用户设置：已登记、激活中、可用、失败、受阻（必需依赖不可用）。插件的运行状态由入口汇总：全部入口正常为可用，部分入口受阻或失败为部分可用，全部受阻为受阻；界面列出每个受阻入口缺少的服务。
- 服务不可用时，直接或间接依赖它的入口全部受阻，同一插件的其它入口不受影响；依赖恢复后自动解除，各自按激活事件重新激活，代次加一。这与 `runtime.services` 的必需消费者闭包是同一规则；Cordis 由服务提供者变化驱动消费者卸载与重载，语义相同（[调研](../research/cordis-plugin-kernel.md)）。
- 浏览器入口依赖本插件的通道时，服务端的通道入口受阻或失败，该浏览器入口在所有窗口受阻；没有声明这一依赖的浏览器入口照常加载，调用通道时得到 `plugin-unavailable`。
- 只经贡献点协作不构成依赖（向 `nbook.commands` 贡献命令也是贡献）：拥有者缺席时贡献挂起，拥有者恢复后重新生效。执行命令的入口依赖的是 `nbook.commands` 的命令服务，不是提供命令的插件；命令不存在时返回结构化错误。
- 安装、启用、禁用、卸载、升级都即时生效，升级流程见 [P8](#p8-安装发现兼容与安全模式)。禁用前按入口列出会连带受阻的范围（例如“文生图的 editor-ui 停用，generator 继续提供 Agent 工具”）与在途调用，由用户确认。
- 启动必需的内置插件不能禁用。
- 插件状态界面把各窗口中浏览器部分的失败与服务端状态分开显示。

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
3. **三步停止。** 一次启停中受影响的全部入口同时进入每一步，时间预算按整次操作计算（等待 5 秒、中止宽限 2 秒），之后按依赖逆序关闭：
   1. 等待：停止接纳新调用，按声明逆序撤回它交出的贡献，有界等待在途调用自然完成；
   2. 中止：触发插件的终止信号，再给一段短时间；
   3. 放弃：仍未结束的调用由内核替调用方结算为“已中断”，撤销该插件持有的全部宿主 API 转发器，删除其模块缓存；迟到的结果一律丢弃。
4. **两层变化。** 声明层是插件启用或禁用使清单声明出现或消失；实现层是激活或停止。声明在而实现不在时可以显示、用到时激活；声明不在时不显示。

**在途工作不依赖开发者自觉来保证宿主正确。** 调用方不会被卡住，被放弃的工作无法再经宿主 API 产生副作用，迟到结果不会发布；只有效率（后台空转、外部费用）依赖插件把信号传给自己的 I/O。唯一的例外是主线程上的同步 CPU 计算：JS 无法打断它，所以规定 CPU 工作进 worker 池（P4），并由看门狗兜底（P6）。

| 插件实现 | 调用方看到 | 插件一侧 |
|---|---|---|
| 配合中止 | 最迟在三步停止结束时得到“已中断” | I/O 被中止，资源立即释放 |
| 不响应中止的异步工作 | 同上 | 在后台继续执行；再调用宿主 API 时失败；结束后被回收 |
| CPU 工作在 worker 池中 | 同上 | JS 计算在 4 至 30 毫秒内终止；Bun 中 WebAssembly 与原生阻塞调用要等其返回，死循环只能随进程重启回收；Chrome 终止后约 2 秒才停 |
| CPU 工作直接在主线程上 | 计算结束前整个服务端没有响应 | 阶段 3 起，超过看门狗阈值（10 秒）时进程被结束并重启 |

各协作方式的终止信号来源：导出 API 调用与贡献调用（含命令执行）由内核合成；事件不需要（发出方不等待监听者，监听者的异常互相隔离）；插件通道的请求随浏览器端作用域关闭或断线取消。

**代码与内存：** 已加载的 ESM 没有公开的卸载 API；Bun 1.4.2 中删除 `require.cache` 对 ESM 同样生效，本机实测撤回引用并删除缓存后内存不随启用、禁用、升级次数增长，弱引用检测在 2 至 3 轮 GC 后确认回收（[调研](../research/runtime-module-unloading.md)的“4.4 `require.cache` 对 ESM 生效”一节，[t26 证据](../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)）。这一行为失效时退回“旧代码保留到重启”，L1 不受影响。浏览器端采用宿主模块表，禁用时同样删除插件代码（G1 在 Chromium 与 Electron 中实测注销后被回收；原生 ESM 被浏览器模块映射永久持有）。

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
| 检测某插件是否启用后持有其引用（可选依赖） | 拒绝 | 撤回无法记账、每个使用方都要处理出现与消失；改用门面加贡献或单独的入口 |
| 插件级依赖表（服务端与浏览器两个入口共用一张） | 拒绝 | 依赖只有一端代码的插件时，另一端被误判缺少依赖；改为各入口声明依赖的服务（P2） |
| 依赖只写在代码里（DeepSeek Harness） | 拒绝 | 执行插件代码之前无法判断受阻范围、禁用连带与升级影响；改为 SDK 从代码生成清单 |
| 需要两端代码的功能拆成两个插件（VS Code） | 拒绝 | 违背一个插件一个身份，两部分可以被分别启用与卸载 |
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

2026-09-30 已按本文写入 `planned` Spec（[w00017 t28](../../.agents/works/w00017-application-runtime-architecture/tasks/t28-platform-planned-specs/README.md)）。已 `implemented` 的 [`runtime.plugins`](../specs/runtime/plugins.md) 与 [`runtime.application`](../specs/runtime/application.md) 描述当前行为，不改为 `planned`；新行为按可独立验收的能力拆成下列 Spec，旧 Spec 只补相邻链接，实现后再修订其非目标。

| Capability | 内容 | 实施阶段 |
|---|---|---|
| [`runtime.plugin-manifest`](../specs/runtime/plugin-manifest.md) | 清单格式、入口与服务级依赖、同一运行位置解析、受阻推导、启停顺序 | 1 起 |
| [`runtime.server-host`](../specs/runtime/server-host.md) | 内核拥有进程、启动与停止序列、停止来源、退出码、开发模式 | 1 |
| [`runtime.browser-host`](../specs/runtime/browser-host.md) | 挂载前建立窗口运行实例、引导接口、多窗口隔离、可分离边界 | 1 |
| [`runtime.plugin-channel`](../specs/runtime/plugin-channel.md) | 合同端点、订阅与重连、错误格式、版本校验、路由贡献（流的传输另立） | 1、2 |
| [`runtime.api-docs`](../specs/runtime/api-docs.md) | 端点收集、OpenAPI 生成与展示 | 2 |
| [`runtime.plugin-hot-plug`](../specs/runtime/plugin-hot-plug.md) | 热插拔三档、引用账本、三步停止、在途调用 | 3 |
| [`runtime.plugin-install`](../specs/runtime/plugin-install.md) | 安装、卸载、兼容、安全模式、热升级 | 3 |
| [`runtime.plugin-code-loading`](../specs/runtime/plugin-code-loading.md) | 服务端装载与回收、浏览器宿主模块表、纯度检查、插件文件端点 | 3 |
| [`runtime.plugin-api`](../specs/runtime/plugin-api.md) | SDK 公开面、错误码、worker 池、私有存储、配置与密钥 | 3 |
| [`runtime.stall-watchdog`](../specs/runtime/stall-watchdog.md) | 卡死检测与报告、退出码 76、自动重启与提示 | 3 |

以下随各阶段的功能落地再写：`workbench.*` 的视图与菜单改由 workbench 插件的贡献点提供，命令与默认键位改由 `nbook.commands` 的贡献点提供（`workbench.commands` 随 w00017 t49 修订）；`workspace.files`、`workbench.files-explorer` 的传输改走插件通道（行为合同不变）；模型、Agent 工具、编辑器、资产、设置在阶段 3 按各自能力沿原 Spec 修订或新建；流原语的传输在第一个需要上行的功能落地时另立。

## 评审问题

以下三项已由开发者于 2026-09-28 批准：

1. **清单载体：** 采用 `package.json`。
2. **内置插件的新端点一律走插件通道（含 Files 竖切）：** 采用。Nitro 文件路由的类型推导与 OpenAPI 生成由 SDK 端点声明替代：内核收集端点声明生成 API 文档，可由 API 文档插件展示（见 [P5](#p5-运行位置与插件通道)）。
3. **G0 与 G1 放在阶段 1 之前单独验证：** 采用。两者任一不成立都会改变 P6 或 P7 的方案。

此后的两项：

4. **Agent 工具与 Profile 的装配**（2026-09-29 开发者决定移交）：工具如何装配到 Profile、工具变化与提示词缓存，留给 nb-harness 重构，见 [w00002 研究材料](../../.agents/works/w00002-neuro-agent-harness-redesign/research/2026-09-29-plugin-agent-tools-and-profiles.md)。本设计只保留贡献方被禁用时使用方的通用处理（P1、P11）。

5. **插件代码的执行位置与强制终止**（2026-09-30 开发者确认）：第三方插件与宿主同线程运行，不采用“每插件一个 worker”。本机 Bun 1.4.2 实测每个 worker 只增加约 1 至 4MB，内存不是障碍；否决的理由是跨线程代理层的工程量，DeepSeek Harness 同样以“传输项目”为由否决隔离路线。保护手段：引用账本与转发器（P1）、三步停止（P11）、CPU 工作进 worker 池（P4）、主线程卡死看门狗（P6）。升级路径是共享插件宿主 worker。证据：[worker 实验](../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/worker-probe/output.txt)、[同线程实验](../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)。

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
| 2026-09-30 | 开发者 | 风险门结论出来后：插件用 WebAssembly 做 CPU 工作时不强制切分为可返回 JS 的小段，限制写入文档并在诊断中显示未停止的 worker。验证中发现的现有问题：启动失败不退出与 API 路径按扩展名放行认证在 w00020 修复；开发模式热重载与停止问题登记为 [#244](https://github.com/notnotype/neuro-book/issues/244)，随阶段 1 解决。其余设计修改待开发者确认 |
| 2026-09-30 | 开发者 | 插件系统与进程生命周期分两条线推进，生命周期部分按验证证据直接写入设计（P6 按 G0、G2 结论重写）；看门狗阶段 1 只统计不结束进程（也可暂不做），结束进程、自动重启与提示禁用放在阶段 3；浏览器侧采用宿主模块表，共享的 nb-ui 入口第一版只放 `components`，配合一个需要界面的插件一起设计；w00020 修复开 PR #245，等 master 上的工作完成后合并 |
| 2026-09-30 | 开发者 | 插件静态文件改由需要登录的 `/api/plugins/<id>/files/<version>/` 提供；依赖内置插件不写版本范围，由 `engines.neurobook` 约束；插件密钥 `ctx.secrets` 与插件配置 `ctx.config` 在阶段 3 提供；SDK 提供登记在作用域上的定时器与异步包装，异步错误记入插件诊断。联动项激活时机、插件状态分端显示、调用包装基准测试、第三方 id 不得以 `nbook.` 开头按默认做法采纳。依赖按端生效与插件热升级待讨论 |
| 2026-09-30 | 开发者 | 插件热升级按 P8 的六步在阶段 3 实现：新旧版本并存、复用三步停止切换、两端同步、失败自动回滚、数据跨版本保留并由插件自行迁移。依赖能否细分到“哪个插件的哪一端”，先调研 VS Code 与 DeepSeek Harness 再讨论 |
| 2026-09-30 | 开发者 | 参考 VS Code 与 DeepSeek Harness 调研，采用“插件、入口、服务”三层：插件是安装与启停的单位，入口是运行与依赖的单位，依赖指向归插件所有的服务，只在同一运行位置解析，跨位置只可依赖本插件的通道；依赖写进清单并由 SDK 从代码生成；联动项并入入口。运行位置保持开放集合，TUI 宿主不进入当前路线。改写 P1、P2、P3、P5、P7、P8、P11 |
| 2026-09-30 | 开发者 | 确认 10 份 planned Spec 中由 t28 选定的 25 项默认值（三步停止时限、插件登记表与复制规则、插件管理限 admin、错误码与状态码、worker 上限、看门狗重启策略等），并说明尚无代码验证，实现中可按实测修订 |
| 2026-10-06 | 开发者 | w00017 t49 规划时修订：命令系统做成内置插件 `nbook.commands`，不进内核，各运行位置都有入口，用户与 Agent 可以不经界面执行命令（以后的终端界面也消费它，用终端界面打开时 workbench 不激活）；内核不提供 `ctx.commands`，命令经贡献点登记、经命令服务执行，协作机制只剩贡献点与导出 API 两种（P3，ADR 0022 同步修订）；激活事件由拥有者插件定义，内核只认 `onStartup`，新增激活方式不改内核（P1）；workbench 的贡献点随真实消费者逐个加入（P7） |
