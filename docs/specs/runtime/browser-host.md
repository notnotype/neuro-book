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

每个浏览器窗口在根组件挂载前建立自己的运行实例，从服务端取得有效插件集合，激活 `nbook.workbench` 并恢复布局，再挂载界面。页面不再自行创建运行时。窗口只在插件集合、事件流与引导接口上依赖服务端，为以后外壳独立部署保留边界。

明确不承诺：

- 第一版只支持同源部署（后端同时提供页面与接口）；外壳独立部署（例如 CDN）不是第一版目标。
- 不定义第三方浏览器代码的装载与共享模块表（[`runtime.plugin-code-loading`](plugin-code-loading.md)），不定义远程服务与 RPC 协议（[远程服务与 RPC 协议](plugin-channel.md)）。
- 不定义 workbench 的布局算法与视图实例模型，它们沿用 View Host 设计与 workbench 的能力 Spec。
- 浏览器卸载页面时不保证任何异步清理完成。

## 术语与参与者

- **外壳**：`index.html` 与前端入口（Vite 构建）。内置插件的浏览器入口随外壳一起构建。
- **前端入口**：`packages/neuro-book/src/web/main.ts`，在挂载根组件前建立窗口运行实例。
- **引导接口**：窗口启动时向服务端取有效插件集合与协议版本的宿主内部接口。加载鉴权插件后需要登录；壳子阶段不加载鉴权插件，服务端只监听本机（[`runtime.server-host`](server-host.md)）。
- **窗口运行实例**：每个窗口一个，彼此隔离；关闭窗口即结束该实例。
- **连接对象**：窗口与服务端之间唯一的通信出口，承载引导接口与远程服务的链路；服务端地址可配置。2026-10-07 起远程服务走内核专用 RPC 端口上的 WebSocket，握手与端口告知随 K2 修订本文（[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)）。
- **宿主页**：窗口还没有可挂载的工作台时显示的页面：启动中、连接失败、版本不一致或启动失败。

## 输入与前置条件

- 加载鉴权插件时用户已登录，未登录时交给鉴权插件的登录流程（鉴权插件尚未实现）。
- 服务端运行实例已就绪（请求在就绪前等待，[`runtime.server-host`](server-host.md)）。
- 浏览器不低于基线：Chrome、Edge 119，Firefox 124，Safari 17.4。基线由内核用到的 `Promise.withResolvers`、`AbortSignal.any` 决定，前端构建目标与它一致。

## 输出与可观察行为

**启动序列：**

1. 加载外壳：`index.html` 与前端入口；脚本运行前页面只有静态的“正在启动”占位。
2. 前端入口在挂载根组件前调用引导接口，取得有效插件集合（每个插件的 id 与版本）、集合修订号与协议版本。请求失败时显示带重试的连接失败页，不渲染半个工作台；协议版本不同、或服务端启用了本外壳没有的插件或版本时提示刷新；响应结构不符合协议或缺少窗口必需的插件（`nbook.diagnostics`、`nbook.commands`、`nbook.workbench`）时显示启动失败页。
3. 建立窗口运行实例：按集合登记本外壳构建进去的浏览器插件，插件集合以服务端为准，浏览器不自行增减。内置插件的浏览器定义随外壳构建，引导只给 id 与版本；第三方插件的浏览器入口随 [`runtime.plugin-code-loading`](plugin-code-loading.md) 加入，届时引导响应加回清单并建立宿主模块表。
4. 激活 `nbook.workbench`，解析它交出的页面表，恢复布局，挂载根组件。页面由工作台的贡献点 `workbench.pages` 汇集（工作台自己的 `/` 加上其它插件贡献的页面，例如开发模式的 `/lab`）；宿主按页面表建立路由，等首次导航完成（当前页面的模块已加载）才挂载，页面表之外的路径显示“页面不存在”。声明了“离开时整页加载”的页面，导航去别的路径时整页加载。
5. 可见视图触发 `onView`，激活其所属入口；不可见视图的入口不加载。
6. 建立本窗口的事件流。事件流建立（含重连）时，窗口核对服务端发来的集合修订号，与引导时取得的不同就重新取得集合并对齐，保证引导与事件流之间发生的变化不会丢失（[`runtime.plugin-channel`](plugin-channel.md)）；此后的插件集合变化经事件流到达，按 [`runtime.plugin-hot-plug`](plugin-hot-plug.md) 同步。

**窗口关闭：** 按依赖逆序停止本窗口的入口，尽力而为，不等待异步完成；服务端随事件流断开结束本窗口的连接作用域与订阅。

**失败呈现：** 宿主页按原因给出动作：连接失败可以原地重试；版本不一致与启动失败要刷新页面才可能恢复（取得与服务端同一次构建的外壳），只给刷新；页面附带原因。本窗口中某个浏览器入口激活失败时，只影响本窗口；插件管理把各窗口的失败与服务端状态分开显示。视图原位显示失败原因，workbench 保留其布局项。

**可分离的三条边界：**

1. 浏览器与服务端之间的通信只经连接对象，服务端地址可配置；
2. 浏览器启动只依赖引导接口；
3. 共享模块的接入不依赖服务端改写 `index.html`。

## 状态与转换

| 当前 | 事件 | 结果 |
|---|---|---|
| 外壳已加载 | 引导成功，工作台激活并交出根界面 | 挂载界面 |
| 外壳已加载 | 引导请求失败 | 连接失败页；重试成功后继续启动序列 |
| 外壳已加载 | 协议版本或插件版本不一致 | 版本不一致页，提示刷新 |
| 外壳已加载 | 响应结构错误、缺少必需插件或必需入口激活失败 | 启动失败页附原因，不挂载根组件 |
| 可用 | 插件集合变化 | 按依赖逆序停止、按依赖顺序启动受影响的浏览器入口 |
| 可用 | 事件流断开 | 标注离线；重连后按当时的插件集合对齐并重建订阅 |
| 可用 | 窗口关闭或刷新 | 尽力停止入口；服务端结束本窗口的连接作用域 |

多个窗口互相独立：一个窗口的实例关闭或失败，不向服务端发送全局停止，不影响其它窗口。

## 副作用与数据

- 窗口运行实例的状态都在内存中；布局持久化归 workbench。
- 本能力不写服务端数据；窗口关闭不代表服务端上与该窗口相关的后台任务结束。

## 失败与恢复

- 引导接口失败（网络失败、非 2xx、正文不是 JSON）：连接失败页，原因带状态码与服务端错误码，原地重试；不渲染部分界面。
- 协议版本或插件版本不一致：版本不一致页，刷新页面。
- 启动必需的浏览器入口（例如 `nbook.workbench`）在本窗口激活失败：本窗口显示启动失败页并附原因，不挂载根组件；服务端与其它窗口不受影响。
- 单个浏览器入口失败：只影响该入口；其它入口与窗口照常。
- 远程服务链路长时间无法重连：界面显示离线状态，用户操作经远程服务调用时返回错误。
- 页面被强制卸载：不保证清理；服务端以事件流断开为准。

## 边界与兼容

- **owner**：application-runtime（浏览器宿主适配器）；内核合同沿用 [`runtime.application`](application.md)。
- **迁移**：v2 由前端入口建立窗口运行实例，页面组件不创建运行时；旧应用的 Nuxt client plugin 与页面内创建路径不迁移。
- **安全**：加载鉴权插件后，引导接口与插件文件需要登录；浏览器不获得服务端路径、数据库对象与凭据（引导响应只有协议版本、修订号与插件 id、版本）。
- **兼容**：引导接口与事件流是宿主内部协议，以协议版本协商；外壳与服务端版本不一致时提示刷新。浏览器基线见输入与前置条件。

## 验收与 Smoke

1. **挂载前建立实例。** 页面首屏出现前，窗口运行实例已建立、`nbook.workbench` 已激活，布局从持久化中恢复。
2. **引导失败。** 外壳已经加载、但引导请求失败时（例如服务端正在重启、网络中断；同源部署下服务端完全停止时浏览器连外壳都取不到，不属于本场景），显示带重试的连接失败页，没有半个工作台；引导恢复后重试成功。
3. **懒激活。** 资源管理器视图不可见时 Files 的浏览器入口未激活；展开侧栏显示该视图时激活。
4. **多窗口隔离。** 两个窗口中一个关闭，另一个不受影响，服务端不停止；一个窗口的入口失败不影响另一个窗口。
5. **插件集合变化。** 服务端启用一个插件后，两个已打开窗口都出现其视图，不刷新页面。
6. **离线与重连。** 断开事件流后窗口标注离线；断开期间服务端禁用一个插件，重连后窗口发现修订号变化并移除该插件，订阅恢复。
7. **引导与事件流之间的变化。** 引导完成后、事件流建立前服务端启用一个插件，事件流建立后窗口出现该插件的视图。

Smoke：生产构建的服务端与本机 Chrome 运行场景 1、2、4 与协议不兼容（`bun run test:e2e`）；场景 3、5、6、7 随懒激活、事件流与插件热插拔实现后补上。Electron 与 WebKitGTK 随桌面版删除，不再列入。

## 实现合同

- **实现 owner 与入口**：application-runtime。前端入口 `packages/neuro-book/src/web/main.ts`（先 `await browserWindow.start()`，再 `mountWindowUi(...)`；开发构建另在 `import.meta.env.DEV` 分支里动态加载开发清单的插件）；挂载 `src/web/mount.ts`（窗口 ready 时建立路由、等首次导航完成后挂载 `PageOutlet.vue`；未 ready 时先挂 `HostPage.vue`，重试成功后换成页面；首次导航失败显示只能刷新的启动失败页）；路由 `src/web/router.ts`（`createPageRouter({pages, history, navigateDocument})`：router 归宿主，一个文档一个；未匹配路径给 `NotFoundPage.vue`；离开 `reloadOnLeave` 的页面时调用 `navigateDocument` 整页加载，同一路径只改查询参数时照常导航）；窗口 `src/web/host/window.ts`（`createBrowserWindow({connection, page, console, builtin?, factories?}) → BrowserWindow {state, onChange(listener), start(), stop()}`，状态 `idle | starting | ready{instanceId, root} | connection-failed | incompatible | startup-failed{reason} | closed`）；浏览器适配器 `src/web/host/browser-host.ts`（见 [`runtime.application`](application.md)）；连接对象 `src/web/host/connection.ts`（`createConnection(baseUrl)`，失败抛带 `status` 的 `ConnectionError`）；浏览器插件装配 `src/web/plugins.ts`（产品）与 `src/web/development-plugins.ts`（开发清单）；宿主页 `FailurePage.vue`（可观察标记 `data-workbench-root`、`data-window-state`、`data-window-instance`、`data-browser-host-status`、`data-page-not-found`）。协议 `src/shared/browser-bootstrap.ts`（`BROWSER_BOOTSTRAP_PATH = /api/runtime/browser-bootstrap`、`BROWSER_PROTOCOL_VERSION = 1`、TypeBox 的 `BrowserBootstrapSchema`）；后端 `src/server/browser-bootstrap.ts`（`browserBootstrap(plugins)`、`createBrowserBootstrapRoute(plugins)`，按本进程加载的清单列出有浏览器运行位置的插件）。工作台交出页面表的服务键 `src/plugins/workbench/web/contracts.ts` 的 `workbenchRootKey`（`WorkbenchRoot {pages()}`）与贡献点 `WORKBENCH_PAGES_POINT`；页面表与贡献校验在 `src/plugins/workbench/web/pages.ts`（贡献 id 写页面路径，同一路径的两条贡献一起被拒绝；`/api`、`/assets` 留给服务端）。
- **关键不变量**：
  - 协议版本先于结构校验：新版本服务端可能改了结构，此时应提示刷新而不是报格式错误。
  - 窗口在解析到工作台的页面表后才是 ready，此时其它插件的页面贡献已经在表里（内核先激活全部启动入口、再执行门禁）；只在连接失败后允许原地重试，其它失败要刷新。每次启动尝试使用新的 instanceId。
  - 引导响应 `Cache-Control: no-store`，集合修订号由排序后的 `id@version` 得出，集合与版本不变时跨重启不变。
  - 前端代码不引用后端代码、Node 与 Bun 模块；跨插件只用 `import type`（`src/architecture.test.ts`）。
- **合同测试**：`src/web/host/window.test.ts`（同进程真实后端：场景 1、2、4，503、协议与插件版本不一致、结构错误、缺少必需插件、工作台激活或装配失败、非必需入口失败时窗口照常、页面贡献与重复或保留路径的拒绝）、`src/web/router.dom.test.ts`（页面不存在、整页加载的判定）、`src/web/mount.dom.test.ts`（真实窗口：直接挂页面、连接失败后重试换成页面、页面模块加载失败给启动失败页）、`src/web/FailurePage.dom.test.ts`、`src/web/host/browser-host.test.ts`、`src/server/browser-bootstrap.test.ts`、`src/architecture.test.ts`。
- **实际 smoke**：`e2e/browser-host.e2e.ts`（`bun run test:e2e`，先构建再用本机 Chrome 运行；含页面表之外的路径与生产构建没有 `/lab`）。

## 证据

- 批准目标：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P7 与 P11（2026-09-28 启动流程走查批准同源部署加可分离边界与浏览器启动序列）；v2 的前端入口见 [NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 方案第 4 节与 [ADR 0023](../../adr/0023-v2-frontend-backend-stack.md)。
- 验证依据：[G1 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g1/REPORT.md)。
- 实现进展：新应用实现了启动序列第 1–4 步（布局恢复除外，随 workbench 底座加入）与场景 1、2、4，见 [w00017 t47](../../../.agents/works/w00017-application-runtime-architecture/tasks/t47-web-host-dev-supervisor/README.md)；页面表、宿主路由与开发插件的装配见 [t48](../../../.agents/works/w00017-application-runtime-architecture/tasks/t48-web-ui-foundation-lab/README.md)。未实现：懒激活（场景 3）、事件流、插件集合变化与离线重连（场景 5–7）、鉴权、第三方浏览器入口。旧应用阶段 1 的实现见 [t39](../../../.agents/works/w00017-application-runtime-architecture/tasks/t39-browser-host/README.md)。本 Spec 保持 `planned`。
