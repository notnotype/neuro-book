---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.browser-host
owners:
  - application-runtime
---

# 浏览器宿主与窗口运行实例

## 目标与非目标

每个浏览器窗口在根组件挂载前建立自己的运行实例，从服务端取得有效插件集合，连上服务端的内核 RPC 端口（地址栏指定了项目时同时绑定该项目），激活 `nbook.workbench` 并恢复布局，再挂载界面。页面不再自行创建运行时。窗口只在引导接口与远程服务链路上依赖服务端，为以后外壳独立部署保留边界。

明确不承诺：

- 第一版只支持同源部署（后端同时提供页面与接口）；外壳独立部署（例如 CDN）不是第一版目标。
- 不定义第三方浏览器代码的装载与共享模块表（[`runtime.plugin-code-loading`](plugin-code-loading.md)），不定义远程服务与 RPC 协议本身（[远程服务与 RPC 协议](plugin-channel.md)）。
- 窗口一生只绑定一个项目代次或不绑定，不在页面内切换项目：切换项目即导航到新地址、整页重新加载。
- 不定义 workbench 的布局算法与视图实例模型，它们沿用 View Host 设计与 workbench 的能力 Spec。
- 浏览器卸载页面时不保证任何异步清理完成。

## 术语与参与者

- **外壳**：`index.html` 与前端入口（Vite 构建）。内置插件的浏览器入口随外壳一起构建。
- **前端入口**：`packages/neuro-book/src/web/main.ts`，在挂载根组件前建立窗口运行实例。
- **引导接口**：窗口启动时向服务端取有效插件集合与协议版本的宿主内部接口。加载鉴权插件后需要登录；壳子阶段不加载鉴权插件，服务端只监听本机（[`runtime.server-host`](server-host.md)）。
- **窗口运行实例**：每个窗口一个，彼此隔离；关闭窗口即结束该实例。
- **连接对象**：窗口与服务端之间唯一的通信出口，承载引导请求与远程服务的链路；服务端地址可配置。远程服务走内核 RPC 端口上的 WebSocket（[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)）：引导响应给出 RPC 端口与路径，窗口用页面自己的主机名与协议（`http` 对应 `ws`，`https` 对应 `wss`）拼出地址，使连接的 `Origin` 与页面一致。
- **浏览器节点**：窗口运行实例的远程节点，实例描述为 `{id: 实例 id, kind: "browser", role: "client", project: null, client: 客户端身份}`；绑定项目后描述带上服务端回复的项目代次。
- **项目绑定**：地址栏查询参数 `project`（`/?project=<短名或 id>`）指定窗口要绑定的项目，握手时交给服务端；服务端打开项目并回复 `{id, name, generation}`（[`runtime.projects`](projects.md)）。没有这个参数的窗口不绑定项目。
- **客户端身份**：存在浏览器本地存储（键 `nbook.client-identity`）里的随机标识，同一浏览器配置下跨刷新与多个窗口不变；本地存储不可用（隐私模式、被禁用）时退回本页随机值。与每次启动都换新的实例 id 区分。
- **宿主页**：窗口还没有可挂载的工作台、或已不能继续使用时显示的页面：启动中、连接失败、版本不一致、启动失败、服务端已重启、无法打开项目或项目已关闭。

## 输入与前置条件

- 加载鉴权插件时用户已登录，未登录时交给鉴权插件的登录流程（鉴权插件尚未实现）。
- 服务端运行实例已就绪（请求在就绪前等待，[`runtime.server-host`](server-host.md)）。
- 浏览器不低于基线：Chrome、Edge 119，Firefox 124，Safari 17.4。基线由内核用到的 `Promise.withResolvers`、`AbortSignal.any` 决定，前端构建目标与它一致。

## 输出与可观察行为

**启动序列：**

1. 加载外壳：`index.html` 与前端入口；脚本运行前页面只有静态的“正在启动”占位。
2. 前端入口在挂载根组件前调用引导接口，取得有效插件集合（每个插件的 id 与版本：有浏览器入口的插件，加上只有顶层声明式贡献的插件，[`runtime.plugin-manifest`](plugin-manifest.md) 输出 11）、集合修订号与协议版本。请求失败时显示带重试的连接失败页，不渲染半个工作台；协议版本不同、或服务端启用了本外壳没有的插件或版本时提示刷新；响应结构不符合协议或缺少窗口必需的插件（`nbook.diagnostics`、`nbook.state`、`nbook.commands`、`nbook.workbench`）时显示启动失败页。
3. 首连：读取客户端身份与地址栏的 `project` 参数，建立浏览器节点，按引导给出的端口连接 RPC 端口并完成握手（[远程服务与 RPC 协议](plugin-channel.md)；带 `project` 参数时握手同时请求绑定，项目没在运行时服务端会先启动它，握手可能要等几秒），之后才建立运行实例，使插件激活时远程服务已可用。连接或握手失败显示带重试的连接失败页；握手以 `wire-version` 被拒显示版本不一致页；以 `project-unavailable` 被拒显示“无法打开项目”页。
4. 建立窗口运行实例：浏览器节点交给运行实例；按集合登记本外壳构建进去的浏览器插件，插件集合以服务端为准，浏览器不自行增减；集合里没有浏览器入口的插件只登记它描述里的顶层贡献。内置插件的浏览器定义随外壳构建，引导只给 id 与版本；第三方插件的浏览器入口随 [`runtime.plugin-code-loading`](plugin-code-loading.md) 加入，届时引导响应加回清单并建立宿主模块表。
5. 激活 `nbook.workbench`，解析它交出的页面表，恢复布局，挂载根组件。窗口就绪的状态带绑定结果 `project: {id, name, generation} | null`；宿主以本地能力把它提供给浏览器插件（例如 `nbook.projects` 显示当前项目短名），插件不经远程服务另取。整页导航同样是本地能力（`windowNavigationKey`）：`navigateDocument(href)` 整页加载到地址（例如“打开项目”），`reloadDocument()` 重新载入当前文档、地址不变，`openExternal(href)` 在新标签页打开外部地址、返回 `opened` 或被浏览器拦截时的 `blocked`（后两个用于[外壳四](../ui/workbench-shell.md)的“重新载入”与“文档”命令）；三者都只发出请求，页面已有的离开保护照常生效；远程服务链路的在线、离线与变化也是（`windowConnectionKey`：`state()` 与 `onChange(listener)`，例如配置插件在回到在线时重新订阅失败的层）；时钟 `clockKey` 与服务端相同。页面由工作台的贡献点 `workbench.pages` 汇集（工作台自己的 `/` 加上其它插件贡献的页面，例如开发模式的 `/lab`）；宿主按页面表建立路由，等首次导航完成（当前页面的模块已加载）才挂载，页面表之外的路径显示“页面不存在”。声明了“离开时整页加载”的页面，导航去别的路径时整页加载。
6. 可见视图触发 `onView`，激活其所属入口；不可见视图的入口不加载。
7. 订阅插件集合变化（经远程服务，随 [`runtime.plugin-hot-plug`](plugin-hot-plug.md) 实现）。订阅建立（含重连后重建）时，窗口核对服务端发来的集合修订号，与引导时取得的不同就重新取得集合并对齐，保证引导与订阅之间发生的变化不会丢失；此后的插件集合变化经订阅到达，按 `runtime.plugin-hot-plug` 同步。

**断线与重连：** 窗口可用后 RPC 链路意外断开时，窗口转为离线：界面保留，页面根元素标注离线并显示一条离线横幅，远程调用返回 `unavailable`。窗口按退避间隔重连（0.5、1、2、4、8 秒，之后每 10 秒），每次先重新取引导（服务端重启后 RPC 端口可能已变），再连接与握手：

- 连回同一服务端进程（绑定了项目时还要是同一项目代次，即在宽限期内重连）：转回在线，横幅消失，仍有效的订阅重建并收到 `onResync`；
- 服务端已换进程（握手的 `boot` 不同）：转为“服务端已重启”宿主页，不再重连、不自动刷新，只给刷新；
- 绑定的项目代次已结束（握手以 `project-gone` 被拒，或服务端回复的绑定与原来的不同）：转为“项目已关闭”宿主页，不再重连，只给刷新与“回到 `/`”（不打开项目）；刷新即按地址栏重新打开项目，得到新代次；
- 握手以 `wire-version` 被拒：转为版本不一致页；
- 其它失败：继续退避。

**窗口关闭：** 按依赖逆序停止本窗口的入口，尽力而为，不等待异步完成；关闭 RPC 链路、取消重连。服务端随链路断开结算本窗口的在途请求与订阅：刷新页面时，旧页发出、仍在执行的请求收到终止信号，新页是新的实例。

**失败呈现：** 宿主页按原因给出动作：连接失败可以原地重试；无法打开项目可以原地重试，另给“不打开项目”的链接回到 `/`；版本不一致、启动失败与服务端已重启要刷新页面才可能恢复（取得与服务端同一次构建的外壳、与新服务端进程重新握手），只给刷新；项目已关闭给刷新与回到 `/`；页面附带原因。服务端已重启、项目已关闭与版本不一致页另列出浏览器插件经本地能力 `windowRescueKey`（`register(provider) → release`，提供者同步返回 `{path, text}` 列表）交出的未保存正文，每项给文件路径、可选中的只读文本与“复制正文”：宿主转入这些终态时，在停止插件之前同步调用全部提供者；没有内容时页面不变（planned，第一个提供者是 [workbench.editor](../workbench/editor.md) 输出 22）。本窗口中某个浏览器入口激活失败时，只影响本窗口；插件管理把各窗口的失败与服务端状态分开显示。视图原位显示失败原因，workbench 保留其布局项；工作台经本地能力 `windowPluginsKey`（`window.plugins`，外壳二）查询入口状态、订阅变化，并对激活失败的入口执行恢复与重新激活（工作台只用于视图所属的入口，[`workbench.views`](../workbench/views.md) 输出 8）。

**可分离的三条边界：**

1. 浏览器与服务端之间的通信只经连接对象，服务端地址可配置；
2. 浏览器启动只依赖引导接口；
3. 共享模块的接入不依赖服务端改写 `index.html`。

## 状态与转换

| 当前 | 事件 | 结果 |
|---|---|---|
| 外壳已加载 | 引导成功，工作台激活并交出根界面 | 挂载界面 |
| 外壳已加载 | 引导请求失败，或 RPC 连接、握手失败 | 连接失败页；重试成功后继续启动序列 |
| 外壳已加载 | 引导协议版本、插件版本或 wire 版本不一致 | 版本不一致页，提示刷新 |
| 外壳已加载 | 响应结构错误、缺少必需插件或必需入口激活失败 | 启动失败页附原因，不挂载根组件 |
| 外壳已加载 | 握手以 `project-unavailable` 被拒（项目不存在、未登记、启动失败、服务端正在停止） | 无法打开项目页附原因；重试成功后继续启动序列 |
| 可用 | 插件集合变化 | 按依赖逆序停止、按依赖顺序启动受影响的浏览器入口 |
| 可用（在线） | RPC 链路断开 | 离线：标注离线，按退避重连 |
| 离线 | 重连到同一服务端进程 | 在线；重建订阅并 `onResync`（按当时的插件集合对齐随热插拔） |
| 离线 | 重连发现服务端已换进程 | 服务端已重启页，只给刷新，不再重连 |
| 离线 | 重连时 wire 版本不一致 | 版本不一致页 |
| 离线 | 重连发现绑定的项目代次已结束 | 项目已关闭页，只给刷新与回到 `/`，不再重连 |
| 可用 | 窗口关闭或刷新 | 尽力停止入口，关闭链路；服务端结算本窗口的在途请求与订阅 |

多个窗口互相独立：一个窗口的实例关闭或失败，不向服务端发送全局停止，不影响其它窗口。

## 副作用与数据

- 窗口运行实例的状态都在内存中；布局持久化归 workbench。
- 本能力不写服务端数据；窗口关闭不代表服务端上与该窗口相关的后台任务结束。

## 失败与恢复

- 引导接口失败（网络失败、非 2xx、正文不是 JSON）：连接失败页，原因带状态码与服务端错误码，原地重试；不渲染部分界面。
- 协议版本或插件版本不一致：版本不一致页，刷新页面。
- 启动必需的浏览器入口（例如 `nbook.workbench`）在本窗口激活失败：本窗口显示启动失败页并附原因，不挂载根组件；服务端与其它窗口不受影响。
- 单个浏览器入口失败：只影响该入口；其它入口与窗口照常。
- 远程服务链路断开：界面显示离线状态并持续退避重连，用户操作经远程服务调用时返回 `unavailable`。
- 服务端已换进程：显示服务端已重启页，由用户刷新；不自动刷新，避免以后丢失页面上未保存的内容。开发模式改后端文件导致后端重启时同样出现这一页。
- 无法打开项目：显示原因（服务端的说明）、重试与回到 `/`；不回退为不绑定项目的窗口。
- 项目已关闭（宽限期满、项目子进程崩溃、服务端停止后又启动）：显示项目已关闭页，由用户刷新或回到 `/`；不把窗口改投新的项目代次。
- 页面被强制卸载：不保证清理；服务端以链路断开为准（WebSocket ping 不回应时空闲 120 秒断开）。

## 边界与兼容

- **owner**：application-runtime（浏览器宿主适配器）；内核合同沿用 [`runtime.application`](application.md)。
- **迁移**：v2 由前端入口建立窗口运行实例，页面组件不创建运行时；旧应用的 Nuxt client plugin 与页面内创建路径不迁移。
- **安全**：加载鉴权插件后，引导接口与插件文件需要登录；浏览器不获得状态根、安装目录等服务端内部路径，也不获得数据库对象与凭据（引导响应只有协议版本、修订号、插件 id 与版本、RPC 端口与路径）。用户自己登记的项目目录路径可以经 `nbook.projects` 显示给用户（[`runtime.projects`](projects.md)）。
- **现状**：懒激活（场景 3）、插件集合的订阅与变化（场景 5、7 与场景 6 的插件集合部分）、鉴权与第三方浏览器入口尚未实现；布局恢复随工作台外壳加入。
- **兼容**：引导接口是宿主内部协议，以协议版本协商（引导响应加入 RPC 端口时升为 2）；远程服务链路以 wire 协议版本协商；外壳与服务端版本不一致时提示刷新。浏览器基线见输入与前置条件。

## 验收与 Smoke

1. **挂载前建立实例。** 页面首屏出现前，窗口运行实例已建立、`nbook.workbench` 已激活，布局从持久化中恢复。
2. **引导失败。** 外壳已经加载、但引导请求失败时（例如服务端正在重启、网络中断；同源部署下服务端完全停止时浏览器连外壳都取不到，不属于本场景），显示带重试的连接失败页，没有半个工作台；引导恢复后重试成功。
3. **懒激活。** 资源管理器视图不可见时 Files 的浏览器入口未激活；展开侧栏显示该视图时激活。
4. **多窗口隔离。** 两个窗口中一个关闭，另一个不受影响，服务端不停止；一个窗口的入口失败不影响另一个窗口。
5. **插件集合变化。** 服务端启用一个插件后，两个已打开窗口都出现其视图，不刷新页面。
6. **离线与重连。** 断开 RPC 链路后窗口标注离线；重连后离线标注消失、订阅收到 `onResync` 且之后的事件到达。断开期间服务端禁用一个插件，重连后窗口发现修订号变化并移除该插件（随热插拔）。
7. **引导与订阅之间的变化。** 引导完成后、插件集合订阅建立前服务端启用一个插件，订阅建立后窗口出现该插件的视图。
8. **RPC 连接。** 窗口 ready 后，浏览器插件经远程服务调用服务端插件，提供方看到的调用方是本窗口的实例；客户端身份跨两次窗口启动不变；外站页面连不上 RPC 端口；首次连接失败为可重试的连接失败页；握手 `wire-version` 被拒为版本不一致页。
9. **刷新与服务端重启。** 刷新页面后，旧页发出、仍在执行的请求收到终止信号，新页是新的实例；服务端换进程后已打开的窗口显示服务端已重启页，不再重连。
10. **项目绑定**。`/?project=<短名>` 打开的窗口就绪后绑定结果带项目代次，浏览器插件经 `project` 目标调用项目实例；两个窗口绑定同一项目得到同一代次；地址栏没有 `project` 的窗口不绑定。项目未登记或启动失败时显示无法打开项目页，重试成功后继续启动；“不打开项目”回到 `/`。
11. **项目重连**。宽限期内掐断后重连：同一代次，订阅收到 `onResync`。超过宽限期或项目子进程崩溃后：窗口显示项目已关闭页，不再重连；刷新后得到新代次。

Smoke：生产构建的服务端与本机 Chrome 运行场景 1、2、4 与协议不兼容（`bun run test:e2e`）；场景 6 的离线与重连部分、场景 8、9 由测试外壳与探针插件在本机 Chrome 上运行（`e2e/rpc.e2e.ts`）；场景 10、11 由测试外壳、探针插件的项目入口与真实项目子进程在本机 Chrome 上运行（`e2e/projects.e2e.ts`）；场景 3、5、7 与场景 6 的插件集合部分随懒激活与插件热插拔实现后补上。Electron 与 WebKitGTK 随桌面版删除，不再列入。

## 实现合同

- **实现 owner 与入口**：application-runtime。前端入口 `packages/neuro-book/src/web/main.ts`（开发构建另在 `import.meta.env.DEV` 分支里动态加载开发清单的插件），启动流程在 `src/web/boot.ts`（`bootWindowUi({builtin, definitions})`：读客户端身份、建窗口、先 `await browserWindow.start()` 再 `mountWindowUi(...)`；e2e 测试外壳 `src/web/testing/e2e-main.ts` 经同一个函数，只多一个测试插件）；挂载 `src/web/mount.ts`（窗口 ready 时建立路由、等首次导航完成后挂载 `PageOutlet.vue`；未 ready 时先挂 `HostPage.vue`，重试成功后换成页面；首次导航失败显示只能刷新的启动失败页）；路由 `src/web/router.ts`（`createPageRouter({pages, history, navigateDocument})`：router 归宿主，一个文档一个；未匹配路径给 `NotFoundPage.vue`；离开 `reloadOnLeave` 的页面时调用 `navigateDocument` 整页加载，同一路径只改查询参数时照常导航）；窗口 `src/web/host/window.ts`（`createBrowserWindow({connection, page, console, navigateDocument, project?, builtin?, definitions?, hostPlugins?, clientIdentity?, clock?}) → BrowserWindow {state, onChange(listener), start(), stop()}`，状态 `idle | starting | ready{instanceId, root, connection: online | offline, project} | connection-failed | project-unavailable | incompatible | startup-failed | server-restarted | project-gone（失败状态带 reason）| closed`；`project`、`project-unavailable`、`project-gone` 与 `navigateDocument`，窗口以本地能力 `windowProjectKey`（`src/shared/projects.ts`）把绑定交给本窗口插件，`navigateDocument` 以本地能力 `windowNavigationKey`（`src/shared/host.ts`）交出）；远程服务链路 `src/web/host/remote-session.ts`（`createRemoteSession({connection, node, clock, onState, onRetryFailed?})`：首连与退避重连）；客户端身份 `src/web/host/client-identity.ts`（`readClientIdentity(() => storage) → {id, problem}`）；浏览器适配器 `src/web/host/browser-host.ts`（见 [`runtime.application`](application.md)）；连接对象 `src/web/host/connection.ts`（`createConnection(baseUrl) → {bootstrap(), openRemote({port, path})}`，失败抛带 `status` 的 `ConnectionError`；RPC 链路经 `src/shared/rpc-socket.ts` 的套接字适配）；浏览器插件装配 `src/web/plugins.ts`（产品：普通插件的定义表 `browserPluginDefinitions` 与宿主适配器的工厂表 `browserHostPlugins`，后者只有诊断）与 `src/web/development-plugins.ts`（开发清单）；宿主页 `FailurePage.vue` 与页面根组件 `PageOutlet.vue`（离线横幅 `.nb-offline-banner`；可观察标记 `data-workbench-root`、`data-window-state`、`data-window-instance`、`data-rpc-state`、`data-browser-host-status`、`data-page-not-found`）。协议 `src/shared/browser-bootstrap.ts`（`BROWSER_BOOTSTRAP_PATH = /api/runtime/browser-bootstrap`、`BROWSER_PROTOCOL_VERSION = 2`、TypeBox 的 `BrowserBootstrapSchema`）；后端 `src/server/browser-bootstrap.ts`（`browserBootstrap(plugins)`、`createBrowserBootstrapRoute(plugins)`，按本进程加载的清单列出有浏览器运行位置的插件）。工作台交出页面表的服务键 `workbenchRootKey`（`WorkbenchRoot {pages()}`，在 `src/plugins/workbench/web/contracts.ts`），页面贡献点 `WORKBENCH_PAGES_POINT` 与页面声明在 `src/plugins/workbench/shared/contracts.ts`；页面表与贡献校验在 `src/plugins/workbench/web/pages.ts`（贡献 id 写页面路径，同一路径的两条贡献一起被拒绝；`/api`、`/assets` 留给服务端）。
- **关键不变量**：
  - 协议版本先于结构校验：新版本服务端可能改了结构，此时应提示刷新而不是报格式错误。首连与断线重连取引导用同一判定（`src/shared/browser-bootstrap.ts` 的 `declaredProtocolVersion`）：版本号不是整数不算声明了版本，按结构不符合协议处理。
  - 窗口在解析到工作台的页面表后才是 ready，此时其它插件的页面贡献已经在表里（内核先激活全部启动入口、再执行门禁）；只在连接失败后允许原地重试，其它失败要刷新。每次启动尝试使用新的 instanceId。
  - 引导响应 `Cache-Control: no-store`，集合修订号由排序后的 `id@version` 得出，集合与版本不变时跨重启不变。
  - 前端代码不引用后端代码、Node 与 Bun 模块；跨插件的运行时导入只能指向对方的 `shared/contracts.ts`（`src/architecture.test.ts`）。
  - 首连先于建立运行实例：插件激活时远程节点已连上服务端。链路在插件全部停止之后才关闭（插件停止时还要经它释放远程门面）。每次启动尝试新建浏览器节点与连接会话，旧尝试的链路不再改写窗口状态。
  - 重连每次先重新取引导：服务端重启后 RPC 端口可能变了；连回不同的服务端进程即转入 `server-restarted`，不再重连、不自动刷新。退避计时用注入时钟。
  - 客户端身份读写都在 try 里：本地存储不可用时退回本页随机值，原因写到控制台，窗口照常启动。
  - 项目绑定：首连之后绑定已定、窗口一生不变；首连以 `project-unavailable` 被拒时与连接失败一样只允许原地重试；连接会话把 `project-gone` 与 `server-restarted` 同样当终态，窗口停止运行实例、不再重连。
- **合同测试**：`src/web/host/window.test.ts`（同进程真实后端、真实 WebSocket：场景 1、2、4，503、协议与插件版本不一致、结构错误、缺少必需插件、工作台激活或装配失败、非必需入口失败时窗口照常、页面贡献与重复或保留路径的拒绝；场景 6 的离线与重连、8、9：远程调用的调用方身份与客户端身份、RPC 首连失败与重试、wire-version、经 TCP 转发掐断后的离线与重连、服务端换进程、卸载后服务端收到终止并不再列出旧实例）、`src/web/host/remote-session.test.ts`（退避间隔与每次重取引导）、`src/web/host/client-identity.dom.test.ts`、窗口绑定项目一组（真实服务端与项目子进程：绑定与共用代次、未登记后登记重试、宽限期内重连 onResync、宽限期满与崩溃后 `project-gone`）、`src/web/router.dom.test.ts`（页面不存在、整页加载的判定）、`src/web/mount.dom.test.ts`（真实窗口：直接挂页面、连接失败后重试换成页面、页面模块加载失败给启动失败页、离线横幅与重连后收起、服务端已重启页）、`src/web/FailurePage.dom.test.ts`、`src/web/host/browser-host.test.ts`、`src/server/browser-bootstrap.test.ts`、`src/architecture.test.ts`。
- **实际 smoke**：`e2e/browser-host.e2e.ts`（`bun run test:e2e`，先构建再用本机 Chrome 运行；含页面表之外的路径与生产构建没有 `/lab`）；`e2e/projects.e2e.ts`（测试外壳与带探针的后端、真实项目子进程：“打开项目”、两页共用代次与重连、宽限期满后新代次、崩溃后的项目已关闭页、无法打开项目页）；`e2e/rpc.e2e.ts`（测试外壳 `bun run build:e2e` 与带探针插件的后端：远程调用、来源核对、`routeWebSocket` 掐断后的离线横幅与重连、刷新后旧请求终止、wire-version、服务端换进程）。

## 证据

- 批准依据：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P7 与 P11（2026-09-28 启动流程走查批准同源部署加可分离边界与浏览器启动序列，风险门验证见 [G1 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g1/REPORT.md)）；v2 的前端入口见 [NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 方案第 4 节与 [ADR 0023](../../adr/0023-v2-frontend-backend-stack.md)；项目绑定、无法打开项目页与项目已关闭页依据 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 3 节与开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md) 中的确认。
