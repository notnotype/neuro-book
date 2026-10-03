---
标签: [state:local, state:inject, state:shared-write, io:read, io:mutate, env:portal]
---

# DesktopTitleBar

`DesktopTitleBar` 是绑定 NeuroBook Workbench 页面能力的标题栏宿主。它把页面登记的 Project、焦点目标、菜单命令、Agent 面板回调与可用能力投影到 `DesktopTitleBarChrome`，并在桌面运行时读取 desktop bridge 来派发窗口及系统菜单动作；它不是可以只靠 props 复现的纯标题栏。

## 布局与交互

chrome 高度由 Workbench 标题栏几何常量决定（标准为 36px），内部品牌、菜单、Project 切换、命令中心、布局按钮和可选窗口控制由 `DesktopTitleBarChrome` 绘制。屏幕宽度和标题栏测量决定完整菜单与紧凑菜单切换；详细键盘漫游、折行与子控件规格见同目录 `DesktopTitleBarChrome.md`。

浏览器与桌面共用标题栏，但能力不同：浏览器没有桌面 bridge 时不显示桌面窗口控制；File/Edit/View/Help 动作按页面注册的实际焦点和功能可用性显示、隐藏或禁用。Project 的本标签切换、书架打开、菜单命令、Agent 面板与命令面板都调用页面注册的回调；如果当前没有页面注册信息，标题显示 NeuroBook，Project 列表为空，页面动作没有可执行回调。桌面状态读取失败时连接状态为空。组件不自行提供业务路由或 Project 加载。

真实页面集成位于 `app/pages/index.vue`：页面把标题栏放进 `WorkbenchShell` 的 `titlebar` 插槽，同时作为 Workbench Chrome 注册项的持有页面。app 根另行提供注册表。当前 Component Lab 的 `WorkbenchShellLayout` 场景展示的是纯 `DesktopTitleBarChrome`，没有挂载这个宿主，也没有可直接跳转的 Lab 集成条目；不能用纯 chrome 场景代替宿主链验证。

## 数据

```ts
interface DesktopTitleBarProps {}
interface DesktopTitleBarEmits {}
```

组件没有声明 props、emits 或 slots；WorkBenchChrome 注册数据不是组件 props。它通过子 chrome 默认根节点继承 Vue attrs，但未承诺额外属性为稳定公共入口；不 expose 任何公开句柄。内部数据来源为 `useWorkbenchChrome()` 当前注册项与 `window.neuroBookDesktop`（仅客户端桌面桥存在时读取）。

## 状态与边界

- 未注册页面信息：仍画出标题栏，使用 NeuroBook 标题和空 Project 列表；页面动作没有宿主回调。
- 浏览器宿主：菜单按浏览器可用能力呈现，不显示桌面窗口控制；已注册页面回调仍可执行。
- 桌面 bridge 存在：挂载时读取一次 desktop status，按状态决定菜单呈现方式、窗口控件与连接指示。读取失败回落到无状态。
- 工作面未激活或焦点不能承接编辑操作时，相关项目/编辑/Agent 动作按 chrome 的能力映射置灰或不显示。
- 标题栏挂载时登记「标题栏在场」共享事实，卸载时清除，以供通知视口避让；这不是页面偏好。
- 不支持由外部直接传入标题、Project 列表或动作回调；这些值只由 Workbench Chrome 页面登记提供。

## 隐藏通道理由

- `state:inject`：`useWorkbenchChrome()` 必须从 app 根取得注册表，缺失时组件抛错；页面注册项提供标题、Project、焦点能力与宿主动作。可选命令面板句柄同样通过 Workbench Commands 注入读取，不存在时不执行。
- `state:shared-write`：挂载/卸载时调用 `markTitleBarPresent` 写入模块级标题栏在场 ref；通知视口通过只读 composable 观察此共享事实，避免标题栏与通知区域争用空间。
- `state:local`：只持有菜单打开值与 desktop status 快照；注册表和平台状态不由它持久化。
- `io:read`：桌面 bridge 存在时，挂载主动调用 `status()` 查询窗口菜单呈现、窗口控件和连接状态；该状态不是页面可以从通用 props 推导的事实，但组件没有可替换查询入口。调用失败折回空状态。
- `io:mutate`：桌面菜单、窗口控制与外观同步直接调用 desktop bridge 的 `menu`、`window`、`setAppearance`；browser 下命令通过 WorkbenchChrome 页面回调执行。桌面 bridge 的副作用不可由父级 props 替换。
- `env:portal`：内部 `DesktopTitleBarChrome` 的菜单由 nb-ui Dropdown portal 到标题栏组件树之外，以逃离 Workbench overflow 裁剪。

此组件声明 `state:shared-write` 与 `io:` 通道，Lab 自动判为不可独立挂载。现有真实验证位置为 `app/pages/index.vue` 的 `WorkbenchShell #titlebar` 页面集成；当前 Lab 没有对应的可链接宿主场景，故不声明 `验证入口`。
