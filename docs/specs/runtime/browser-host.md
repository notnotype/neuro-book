---
schema: nbook.spec/v1
kind: behavior
status: implemented
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

- （planned）加载鉴权插件时用户已登录，未登录时交给鉴权插件的登录流程；缺口：鉴权插件尚未实现，当前没有登录流程。
- 服务端运行实例已就绪（请求在就绪前等待，[`runtime.server-host`](server-host.md)）。
- 浏览器不低于基线：Chrome、Edge 119，Firefox 124，Safari 17.4。基线由内核用到的 `Promise.withResolvers`、`AbortSignal.any` 决定，前端构建目标与它一致。

## 输出与可观察行为

**启动序列：**

1. 加载外壳：`index.html` 与前端入口；脚本运行前页面只有静态的加载页：底色上一条居中的进度条，不带文字。底色、文字与进度条的颜色取这个浏览器上一次应用的主题：宿主在主题每次写到文档根时记下明暗与这几种颜色（浏览器本地存储），`index.html` 头部的内联脚本在第一帧前读回；这个浏览器第一次打开、记录读不出（明暗或任一种颜色不合格就整条不用）或本地存储不可用时，取主题缺省配色、明暗跟随系统。记录里还可以有两个各自独立的可选字段：主题的场景图（同源路径）与进度样式（`dots`、`pulse`、`page`，缺省的 `bar` 不记），内联脚本读回后把场景图画成加载页的背景、按样式换进度指示的形状（[`theme.skins`](../theme/skins.md) 输出 19）；字段不合格（不同源、含不安全字符、不认识的样式名）只丢这一项，不影响颜色，也不影响另一项。加载页的样式在 head 里直接引用，第一帧起就是这个样子；之后出现的书名与提示定位在进度条上下，不推动它。
2. 前端入口在挂载根组件前调用引导接口（地址栏带 `project` 时一并带上），取得有效插件集合（每个插件的 id 与版本：有浏览器入口的插件，加上只有顶层声明式贡献的插件，[`runtime.plugin-manifest`](plugin-manifest.md) 输出 11）、消息目录索引、集合修订号与协议版本；目录索引列出本次启动集合里写了 `l10n` 的全部第三方插件（不只是在浏览器登记的，只有服务端入口的插件也在内），每项是插件 id、源语言、语言列表、内容摘要与目录端点的地址前缀；带 `project` 且这部作品已登记时还有它的显示名（书名，没有时是目录原名，[`runtime.projects`](projects.md) 术语），加载页随即在进度条上方显示书名、下方提示“正在打开”。服务端还没就绪或作品没登记时不带，加载页只有进度条。请求失败时显示带重试的连接失败页，不渲染半个工作台；协议版本不同、或服务端启用了本外壳没有的内置插件（id 以保留发布者 `nbook.` 或内核的 `runtime.` 开头）或内置插件的版本不同时提示刷新；第三方插件不要求在外壳构建内（第 4 条）；响应结构不符合协议或缺少窗口必需的插件（`runtime.diagnostics`、`nbook.state`、`nbook.commands`、`nbook.workbench`）时显示启动失败页。
3. 首连：读取客户端身份与地址栏的 `project` 参数，建立浏览器节点，按引导给出的端口连接 RPC 端口并完成握手（[远程服务与 RPC 协议](plugin-channel.md)；带 `project` 参数时握手同时请求绑定，项目没在运行时服务端会先启动它，握手可能要等几秒），之后才建立运行实例，使插件激活时远程服务已可用。连接或握手失败显示带重试的连接失败页；握手以 `wire-version` 被拒显示版本不一致页；以 `project-unavailable` 被拒显示“无法打开项目”页。
4. 建立窗口运行实例：浏览器节点交给运行实例；按集合登记本外壳构建进去的浏览器插件，插件集合以服务端为准，浏览器不自行增减；集合里没有浏览器入口的插件只登记它描述里的顶层贡献。内置插件的浏览器定义随外壳构建，引导只给 id 与版本；第三方插件另给清单（`package.json` 的原始内容，入口只留浏览器的）与插件文件 URL 的前缀，窗口用同一个 `readPluginManifest` 读出清单，按清单登记它的浏览器入口与顶层贡献，读不了时显示版本不一致页；入口的代码在激活时经插件文件端点取回（[`runtime.plugin-code-loading`](plugin-code-loading.md) 输出 2），宿主模块表在第一个第三方入口激活时建立。清单引用了本窗口不认识的内置合同等登记不了的情况，只登记它的顶层贡献并记诊断，不挡窗口启动。有样式的第三方插件在窗口登记时就加入样式表，窗口结束时移除。
5. 激活 `nbook.workbench`，解析它交出的页面表，恢复布局，挂载根组件。窗口就绪的状态带绑定结果 `project: {id, name, title, generation} | null`（`title` 是引导给的显示名，引导时没拿到则退回短名）；宿主以本地能力把它提供给浏览器插件（例如工作台在标题栏显示 `title`），插件不经远程服务另取。整页导航同样是本地能力（`windowNavigationKey`）：`navigateDocument(href)` 整页加载到地址（例如“打开项目”），`reloadDocument()` 重新载入当前文档、地址不变，`openExternal(href)` 在新标签页打开外部地址、返回 `opened` 或被浏览器拦截时的 `blocked`（后两个用于[外壳四](../ui/workbench-shell.md)的“重新载入”与“文档”命令）；三者都只发出请求，页面已有的离开保护照常生效；另有 `currentUrl()`（当前文档的地址）与 `replaceUrl(href)`（不导航地替换地址栏，读过一次性参数后去掉它们，例如编辑器的继续写作参数）；远程服务链路的在线、离线与变化也是（`windowConnectionKey`：`state()` 与 `onChange(listener)`，例如配置插件在回到在线时重新订阅失败的层）；时钟 `clockKey` 与服务端相同。页面由工作台的贡献点 `workbench.pages` 汇集（工作台自己的 `/` 加上其它插件贡献的页面，例如开发模式的 `/lab`）；宿主按页面表建立路由，等首次导航完成（当前页面的模块已加载）才挂载，页面表之外的路径显示“页面不存在”。声明了“离开时整页加载”的页面，导航去别的路径时整页加载。
6. （planned，缺口：全仓库找不到 `onView:<id>` 触发逻辑）可见视图触发 `onView`，激活其所属入口；不可见视图的入口不加载。
7. （planned，随 [`runtime.plugin-hot-plug`](plugin-hot-plug.md) 实现）订阅插件集合变化（经远程服务）。订阅建立（含重连后重建）时，窗口核对服务端发来的集合修订号，与引导时取得的不同就重新取得集合并对齐，保证引导与订阅之间发生的变化不会丢失；此后的插件集合变化经订阅到达，按 `runtime.plugin-hot-plug` 同步。
8. **界面语言。**窗口建一个翻译引擎（[`ui/i18n`](../ui/i18n.md)），作为窗口能力 `windowTextKey`（`src/shared/window-text.ts`）交给本窗口插件，并注入宿主页、页面与启动失败页三个 Vue 根。引擎的当前语言在设置插件激活前取本地记录（键 `nbook.host-locale`，值不在宿主语言集合里当作没有），没有记录取 `zh-CN`；设置插件的 `locale` 入口激活后由它推设置里的值，值来自用户层时宿主把它写成本地记录，缺省值不写。没有翻译引擎能力的实例（只装插件的测试场地）里这个入口什么都不做。首连之后、登记插件之前，窗口按目录索引经消息目录端点（[`runtime.plugin-code-loading`](plugin-code-loading.md) 输出 10）取齐第三方插件的每种语言的目录，按 [`runtime.plugin-manifest`](plugin-manifest.md) 输出 12 检查后以插件 id 为命名空间登记进引擎；内置插件的目录随外壳构建，不经端点，同一时刻登记。某种语言的目录取不到（404 为 `not-found`，其它网络或服务端错误为 `fetch-failed`）或内容不合规则（`invalid`）时，这种语言不登记，其余语言照常登记，文字按回退链显示；每份取不到的目录在 `window.plugins.problems()` 里是一条 `catalog-unavailable` 问题（插件 id、语言、原因与详情），另记一条诊断；插件的入口与贡献照常登记与激活，窗口照常启动。失败页、找不到页面、离线横幅与加载页的文字在宿主目录 `nbook.host`（`src/web/locales/`）；加载页在脚本运行前按本地记录设 `<html lang>` 与读屏名，引擎建好后 `<html lang>` 跟随当前界面语言。

**断线与重连：** 窗口可用后 RPC 链路意外断开时，窗口转为离线：界面保留，页面根元素标注离线并显示一条离线横幅，远程调用返回 `unavailable`。窗口按退避间隔重连（0.5、1、2、4、8 秒，之后每 10 秒），每次先重新取引导（服务端重启后 RPC 端口可能已变），再连接与握手：

- 连回同一服务端进程（绑定了项目时还要是同一项目代次，即在宽限期内重连）：转回在线，横幅消失，仍有效的订阅重建并收到 `onResync`；
- 服务端已换进程（握手的 `boot` 不同）：转为“服务端已重启”宿主页，不再重连、不自动刷新，只给刷新；
- 绑定的项目代次已结束（握手以 `project-gone` 被拒，或服务端回复的绑定与原来的不同）：转为“项目已关闭”宿主页，不再重连，只给刷新与“回到 `/`”（不打开项目）；刷新即按地址栏重新打开项目，得到新代次；
- 握手以 `wire-version` 被拒：转为版本不一致页；
- 其它失败：继续退避。

**窗口关闭：** 按依赖逆序停止本窗口的入口，尽力而为，不等待异步完成；关闭 RPC 链路、取消重连。服务端随链路断开结算本窗口的在途请求与订阅：刷新页面时，旧页发出、仍在执行的请求收到终止信号，新页是新的实例。

**失败呈现：** 宿主页按原因给出动作：连接失败可以原地重试；无法打开项目可以原地重试，另给“不打开项目”的链接回到 `/`；版本不一致、启动失败与服务端已重启要刷新页面才可能恢复（取得与服务端同一次构建的外壳、与新服务端进程重新握手），只给刷新；项目已关闭给刷新与回到 `/`；页面附带原因。服务端已重启、项目已关闭与版本不一致页另列出浏览器插件经本地能力 `windowRescueKey`（`register(provider) → release`，提供者同步返回 `{path, text, note?}` 列表，`note` 是可选的说明，文字值，按窗口的当前语言显示）交出的未保存正文，每项给文件路径、提供者的说明（有时才有）、可选中的只读文本与“复制正文”：宿主转入这些终态时，在停止插件之前同步调用全部提供者；没有内容时页面不变（planned，第一个提供者是 [workbench.editor](../workbench/editor.md) 输出 22）。本窗口中某个浏览器入口激活失败时，只影响本窗口；插件管理把各窗口的失败与服务端状态分开显示。视图原位显示失败原因，workbench 保留其布局项；工作台经本地能力 `windowPluginsKey`（`window.plugins`，外壳二）查询入口状态、订阅变化，并对激活失败的入口执行恢复与重新激活（工作台只用于视图所属的入口，[`workbench.views`](../workbench/views.md) 输出 8）；`window.plugins.problems()` 返回本窗口的问题（入口激活失败、受阻与被拒的贡献、取不到的消息目录，前三种形状同插件管理列表里的问题，[`runtime.plugin-install`](plugin-install.md) 输出 10），插件页用它显示浏览器一侧的问题。

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
- **安全**：（planned，鉴权插件未实现前不生效）加载鉴权插件后，引导接口与插件文件需要登录；浏览器不获得状态根、安装目录等服务端内部路径，也不获得数据库对象与凭据（引导响应只有协议版本、修订号、插件 id 与版本、第三方插件的清单与文件 URL 前缀、消息目录索引、RPC 端口与路径）。用户自己登记的项目目录路径可以经 `nbook.projects` 显示给用户（[`runtime.projects`](projects.md)）。
- **现状**：按需激活（输出 6）、插件集合的订阅与热插拔联动（输出 7）、鉴权（“输入与前置条件”、本节“安全”）与第三方浏览器入口（随 [`runtime.plugin-code-loading`](plugin-code-loading.md)）标 `(planned)`；布局恢复随工作台外壳加入。
- **兼容**：引导接口是宿主内部协议，以协议版本协商（引导响应加入 RPC 端口时升为 2，带第三方插件的清单与文件 URL 前缀时升为 4，带消息目录索引时升为 5）；集合修订号由插件 id 与版本得出，第三方插件另并入版本目录的内容摘要，同版本重装后修订号也变；目录索引的每一项（插件 id、摘要、源语言与语言列表）同样并入修订号；远程服务链路以 wire 协议版本协商；外壳与服务端版本不一致时提示刷新。浏览器基线见输入与前置条件。

## 验收与 Smoke

1. **挂载前建立实例。** 页面首屏出现前，窗口运行实例已建立、`nbook.workbench` 已激活，布局从持久化中恢复。
2. **引导失败。** 外壳已经加载、但引导请求失败时（例如服务端正在重启、网络中断；同源部署下服务端完全停止时浏览器连外壳都取不到，不属于本场景），显示带重试的连接失败页，没有半个工作台；引导恢复后重试成功。
3. （planned，随输出 6 的按需激活）**懒激活。** 资源管理器视图不可见时 Files 的浏览器入口未激活；展开侧栏显示该视图时激活。
4. **多窗口隔离。** 两个窗口中一个关闭，另一个不受影响，服务端不停止；一个窗口的入口失败不影响另一个窗口。
5. （planned，随输出 7 的插件集合订阅）**插件集合变化。** 服务端启用一个插件后，两个已打开窗口都出现其视图，不刷新页面。
6. **离线与重连。** 断开 RPC 链路后窗口标注离线；重连后离线标注消失、订阅收到 `onResync` 且之后的事件到达。（planned，随输出 7）断开期间服务端禁用一个插件，重连后窗口发现修订号变化并移除该插件。
7. （planned，随输出 7 的插件集合订阅）**引导与订阅之间的变化。** 引导完成后、插件集合订阅建立前服务端启用一个插件，订阅建立后窗口出现该插件的视图。
8. **RPC 连接。** 窗口 ready 后，浏览器插件经远程服务调用服务端插件，提供方看到的调用方是本窗口的实例；客户端身份跨两次窗口启动不变；外站页面连不上 RPC 端口；首次连接失败为可重试的连接失败页；握手 `wire-version` 被拒为版本不一致页。
9. **刷新与服务端重启。** 刷新页面后，旧页发出、仍在执行的请求收到终止信号，新页是新的实例；服务端换进程后已打开的窗口显示服务端已重启页，不再重连。
10. **项目绑定**。`/?project=<短名>` 打开的窗口就绪后绑定结果带项目代次，浏览器插件经 `project` 目标调用项目实例；两个窗口绑定同一项目得到同一代次；地址栏没有 `project` 的窗口不绑定。项目未登记或启动失败时显示无法打开项目页，重试成功后继续启动；“不打开项目”回到 `/`。
11. **项目重连**。宽限期内掐断后重连：同一代次，订阅收到 `onResync`。超过宽限期或项目子进程崩溃后：窗口显示项目已关闭页，不再重连；刷新后得到新代次。
12. **加载页。**从书架打开一部没写书名、目录名是中文的作品：加载页从第一帧起是主题底色上居中的进度条，没有无样式的文字；书名（目录原名）出现在进度条上方、进度条不动；就绪后标题栏显示同一个名字，不显示短名。；书房等写了 `loading` 的主题，下一次整页加载的第一帧就是它的场景图与进度样式（[`theme.skins`](../theme/skins.md) 验收 19）。
13. **加载页跟随上次的明暗。**系统与产品的明暗相反（系统深色、产品浅色，或反过来）：这个浏览器第一次打开时加载页按系统；工作台就绪后再打开（刷新），加载页从第一帧起就是产品明暗的底色。
14. **消息目录。** 写了 `l10n` 的第三方插件：窗口就绪时它的目录已按插件 id 登记进翻译引擎；只有服务端入口的插件不在浏览器登记，但它的目录照样登记。安装后某种语言的目录文件被改坏或删掉：窗口照常启动，插件的顶层声明照常登记，`window.plugins.problems()` 有一条这种语言的 `catalog-unavailable`（坏了为 `invalid`，删掉为 `not-found`），其余语言照常登记。升级到目录不同的新版本后，重启前引导给的仍是旧摘要，重启后目录索引与修订号换成新摘要。

Smoke：生产构建的服务端与本机 Chrome 运行场景 1、2、4、13 与协议不兼容（`bun run test:e2e`）；场景 6 的离线与重连部分、场景 8、9 由测试外壳与探针插件在本机 Chrome 上运行（`e2e/rpc.e2e.ts`）；场景 10、11 由测试外壳、探针插件的项目入口与真实项目子进程在本机 Chrome 上运行（`e2e/projects.e2e.ts`）；场景 3、5、7 与场景 6 的插件集合部分随懒激活与插件热插拔实现后补上。Electron 与 WebKitGTK 随桌面版删除，不再列入。

## 实现合同

- **实现 owner 与入口**：application-runtime。前端入口 `packages/neuro-book/src/web/main.ts`（开发构建另在 `import.meta.env.DEV` 分支里动态加载开发清单的插件），启动流程在 `src/web/boot.ts`（`bootWindowUi({builtin, definitions})`：读客户端身份、建窗口、先 `await browserWindow.start()` 再 `mountWindowUi(...)`；e2e 测试外壳 `src/web/testing/e2e-main.ts` 经同一个函数，只多一个测试插件）；挂载 `src/web/mount.ts`（窗口 ready 时建立路由、等首次导航完成后挂载 `PageOutlet.vue`；未 ready 时先挂 `HostPage.vue`，重试成功后换成页面；首次导航失败显示只能刷新的启动失败页）；路由 `src/web/router.ts`（`createPageRouter({pages, history, navigateDocument})`：router 归宿主，一个文档一个；未匹配路径给 `NotFoundPage.vue`；离开 `reloadOnLeave` 的页面时调用 `navigateDocument` 整页加载，同一路径只改查询参数时照常导航）；窗口 `src/web/host/window.ts`（`createBrowserWindow({connection, page, console, navigateDocument, project?, builtin?, definitions?, hostPlugins?, clientIdentity?, clock?}) → BrowserWindow {state, onChange(listener), start(), stop()}`，状态 `idle | starting | ready{instanceId, root, connection: online | offline, project} | connection-failed | project-unavailable | incompatible | startup-failed | server-restarted | project-gone（失败状态带 reason）| closed`；`project`、`project-unavailable`、`project-gone` 与 `navigateDocument`，窗口以本地能力 `windowProjectKey`（`src/shared/projects.ts`）把绑定交给本窗口插件，`navigateDocument` 以本地能力 `windowNavigationKey`（`src/shared/host.ts`）交出）；远程服务链路 `src/web/host/remote-session.ts`（`createRemoteSession({connection, node, clock, onState, onRetryFailed?})`：首连与退避重连）；客户端身份 `src/web/host/client-identity.ts`（`readClientIdentity(() => storage) → {id, problem}`）；加载页的明暗提示 `src/web/host/appearance-hint.ts`（`rememberDocumentAppearance({root, storage, warn})`，键 `nbook.host-appearance`，读的一方是两份 `index.html` 头部的内联脚本）；浏览器适配器 `src/web/host/browser-host.ts`（见 [`runtime.application`](application.md)）；连接对象 `src/web/host/connection.ts`（`createConnection(baseUrl) → {bootstrap(), openRemote({port, path})}`，失败抛带 `status` 的 `ConnectionError`；RPC 链路经 `src/shared/rpc-socket.ts` 的套接字适配）；浏览器插件装配 `src/web/plugins.ts`（产品：普通插件的定义表 `browserPluginDefinitions` 与宿主适配器的工厂表 `browserHostPlugins`，后者只有诊断）与 `src/web/development-plugins.ts`（开发清单）；宿主页 `FailurePage.vue` 与页面根组件 `PageOutlet.vue`（离线横幅 `.nb-offline-banner`；可观察标记 `data-workbench-root`、`data-window-state`、`data-window-instance`、`data-rpc-state`、`data-page-rendered`（页面首屏画出，由页面自己标，见 PageOutlet.md）、`data-browser-host-status`、`data-page-not-found`）。协议 `src/shared/browser-bootstrap.ts`（`BROWSER_BOOTSTRAP_PATH = /api/runtime/browser-bootstrap`、`BROWSER_PROTOCOL_VERSION = 2`、TypeBox 的 `BrowserBootstrapSchema`）；后端 `src/server/browser-bootstrap.ts`（`browserBootstrap(plugins)`、`createBrowserBootstrapRoute(plugins)`，按本进程加载的清单列出有浏览器运行位置的插件）。工作台交出页面表的服务键 `workbenchRootKey`（`WorkbenchRoot {pages()}`，在 `src/plugins/workbench/web/contracts.ts`），页面贡献点 `WORKBENCH_PAGES_POINT` 与页面声明在 `src/plugins/workbench/shared/contracts.ts`；页面表与贡献校验在 `src/plugins/workbench/web/pages.ts`（贡献 id 写页面路径，同一路径的两条贡献一起被拒绝；`/api`、`/assets` 留给服务端）。
- **关键不变量**：
  - 协议版本先于结构校验：新版本服务端可能改了结构，此时应提示刷新而不是报格式错误。首连与断线重连取引导用同一判定（`src/shared/browser-bootstrap.ts` 的 `declaredProtocolVersion`）：版本号不是整数不算声明了版本，按结构不符合协议处理。
  - 窗口在解析到工作台的页面表后才是 ready，此时其它插件的页面贡献已经在表里（内核先激活全部启动入口、再执行门禁）；只在连接失败后允许原地重试，其它失败要刷新。每次启动尝试使用新的 instanceId。
  - 引导响应 `Cache-Control: no-store`，集合修订号由排序后的 `id@version` 得出，集合与版本不变时跨重启不变。
  - 前端代码不引用后端代码、Node 与 Bun 模块；跨插件的运行时导入只能指向对方的 `shared/contracts.ts`（`src/architecture.test.ts`）。
  - 首连先于建立运行实例：插件激活时远程节点已连上服务端。链路在插件全部停止之后才关闭（插件停止时还要经它释放远程门面）。每次启动尝试新建浏览器节点与连接会话，旧尝试的链路不再改写窗口状态。
  - 重连每次先重新取引导：服务端重启后 RPC 端口可能变了；连回不同的服务端进程即转入 `server-restarted`，不再重连、不自动刷新。退避计时用注入时钟。
  - 客户端身份读写都在 try 里：本地存储不可用时退回本页随机值，原因写到控制台，窗口照常启动。
  - 项目绑定：首连之后绑定已定、窗口一生不变；首连以 `project-unavailable` 被拒时与连接失败一样只允许原地重试；连接会话把 `project-gone` 与 `server-restarted` 同样当终态，窗口停止运行实例、不再重连。
- **合同测试**：`src/web/host/window-catalogs.test.ts`（真实安装流程与同进程真实后端：场景 14 的目录登记、只有服务端入口的插件、目录损坏与 404 成为问题而窗口照常、升级后重启才换摘要，内置插件随构建带的目录，以及目录端点的 200、404 与 400）、`src/web/host/window.test.ts`（同进程真实后端、真实 WebSocket：场景 1、2、4，503、协议与插件版本不一致、结构错误、缺少必需插件、工作台激活或装配失败、非必需入口失败时窗口照常、页面贡献与重复或保留路径的拒绝；场景 6 的离线与重连、8、9：远程调用的调用方身份与客户端身份、RPC 首连失败与重试、wire-version、经 TCP 转发掐断后的离线与重连、服务端换进程、卸载后服务端收到终止并不再列出旧实例）、`src/web/host/remote-session.test.ts`（退避间隔与每次重取引导）、`src/web/host/client-identity.dom.test.ts`、`src/web/host/appearance-hint.dom.test.ts`（加载页的明暗提示：宿主写下的与两份 `index.html` 的内联脚本读回的一致，坏记录不认）、窗口绑定项目一组（真实服务端与项目子进程：绑定与共用代次、未登记后登记重试、宽限期内重连 onResync、宽限期满与崩溃后 `project-gone`）、`src/web/router.dom.test.ts`（页面不存在、整页加载的判定）、`src/web/mount.dom.test.ts`（真实窗口：直接挂页面、连接失败后重试换成页面、页面模块加载失败给启动失败页、离线横幅与重连后收起、服务端已重启页）、`src/web/FailurePage.dom.test.ts`、`src/web/host/browser-host.test.ts`、`src/server/browser-bootstrap.test.ts`、`src/architecture.test.ts`。
- **实际 smoke**：`e2e/browser-host.e2e.ts`（`bun run test:e2e`，先构建再用本机 Chrome 运行；含页面表之外的路径与生产构建没有 `/lab`）；`e2e/projects.e2e.ts`（测试外壳与带探针的后端、真实项目子进程：“打开项目”、两页共用代次与重连、宽限期满后新代次、崩溃后的项目已关闭页、无法打开项目页）；`e2e/rpc.e2e.ts`（测试外壳 `bun run build:e2e` 与带探针插件的后端：远程调用、来源核对、`routeWebSocket` 掐断后的离线横幅与重连、刷新后旧请求终止、wire-version、服务端换进程）。

## 证据

- 实现入口：[`web/main.ts`](../../../packages/neuro-book/src/web/main.ts)、[`web/boot.ts`](../../../packages/neuro-book/src/web/boot.ts)、[`web/mount.ts`](../../../packages/neuro-book/src/web/mount.ts)、[`web/router.ts`](../../../packages/neuro-book/src/web/router.ts)、[`web/host/window.ts`](../../../packages/neuro-book/src/web/host/window.ts)、[`web/host/remote-session.ts`](../../../packages/neuro-book/src/web/host/remote-session.ts)、[`web/host/connection.ts`](../../../packages/neuro-book/src/web/host/connection.ts)、[`web/plugins.ts`](../../../packages/neuro-book/src/web/plugins.ts)、[`shared/browser-bootstrap.ts`](../../../packages/neuro-book/src/shared/browser-bootstrap.ts)、[`server/browser-bootstrap.ts`](../../../packages/neuro-book/src/server/browser-bootstrap.ts)
- 合同测试：[`web/host/window-catalogs.test.ts`](../../../packages/neuro-book/src/web/host/window-catalogs.test.ts)、[`web/host/window.test.ts`](../../../packages/neuro-book/src/web/host/window.test.ts)、[`web/host/remote-session.test.ts`](../../../packages/neuro-book/src/web/host/remote-session.test.ts)、[`web/host/client-identity.dom.test.ts`](../../../packages/neuro-book/src/web/host/client-identity.dom.test.ts)、[`web/host/appearance-hint.dom.test.ts`](../../../packages/neuro-book/src/web/host/appearance-hint.dom.test.ts)、[`web/router.dom.test.ts`](../../../packages/neuro-book/src/web/router.dom.test.ts)、[`web/mount.dom.test.ts`](../../../packages/neuro-book/src/web/mount.dom.test.ts)、[`web/FailurePage.dom.test.ts`](../../../packages/neuro-book/src/web/FailurePage.dom.test.ts)、[`web/host/browser-host.test.ts`](../../../packages/neuro-book/src/web/host/browser-host.test.ts)、[`server/browser-bootstrap.test.ts`](../../../packages/neuro-book/src/server/browser-bootstrap.test.ts)、[`architecture.test.ts`](../../../packages/neuro-book/src/architecture.test.ts)
- Smoke：[`e2e/browser-host.e2e.ts`](../../../packages/neuro-book/e2e/browser-host.e2e.ts)、[`e2e/projects.e2e.ts`](../../../packages/neuro-book/e2e/projects.e2e.ts)、[`e2e/rpc.e2e.ts`](../../../packages/neuro-book/e2e/rpc.e2e.ts)
- 批准依据：消息目录索引、窗口取目录与 `catalog-unavailable` 依据[《界面文字的消息目录》](../../proposals/i18n-message-catalogs.md)（2026-10-27 接受）；[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P7 与 P11（2026-09-28 启动流程走查批准同源部署加可分离边界与浏览器启动序列，风险门验证见 [G1 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g1/REPORT.md)）；v2 的前端入口见 [NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 方案第 4 节与 [ADR 0023](../../adr/0023-v2-frontend-backend-stack.md)；项目绑定、无法打开项目页与项目已关闭页依据 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 3 节与开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md) 中的确认；加载页跟随上次的明暗（启动序列第 1 步、场景 13）为 [t79 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t79-workbench-polish/plan.md)第二轮第 7 节，开发者 2026-10-12 确认。
