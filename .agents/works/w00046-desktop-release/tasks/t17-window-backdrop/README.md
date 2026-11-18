---
schema: nbook.task/v2
taskId: t17-window-backdrop
status: active
updated: 2026-11-18
---

# 磨砂透明的窗口背景（实验）

## 目标与范围

Windows 11 22H2 以上的 Mica：bun:ffi 设 DWM 背景，外层面板半透明；实验性选项，最后做

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 调研（2026-11-18，上网查过）

- WebView2 的 `DefaultBackgroundColor` 可以是全透明（alpha 只有 0 与 255 两档，半透明会 E_INVALIDARG）：透明时“WebView 把宿主窗口的内容当背景渲染”，页面里没定义不透明背景的地方透出窗口；半透明在页面 CSS 里用 rgba 做。也可由环境变量 `WEBVIEW2_DEFAULT_BACKGROUND_COLOR`（ARGB 十六进制，只生效一次）设置，文档说它能避免 API 设置时的白闪。来源：[ICoreWebView2Controller2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller2)。
- 窗口式托管不是障碍的间接证据：用同一套 WebView2 窗口式托管的 Tauri、Wails 都有 Mica 选项（DWM 的 `DWMWA_SYSTEMBACKDROP_TYPE` 加透明的 WebView）。没有找到 Microsoft 对“窗口式托管下透出 Mica”的明文表态，要实测。
- Electrobun：[#123 窗口原生 Vibrancy 与 Acrylic](https://github.com/blackboardsh/electrobun/issues/123) 是开着的功能请求，没有官方支持，也没人给出可用做法；`BrowserWindow` 有 `transparent` 选项（[#52](https://github.com/blackboardsh/electrobun/issues/52)，2026 年 2 月说在 beta 里），Windows 上的实现细节没查到，2.0.6 上没验证。壳自己用 bun:ffi 调 dwmapi（`DwmSetWindowAttribute`、`DwmExtendFrameIntoClientArea`）不依赖上游。

## 探针（2026-11-18）

[probe-r1.ts](evidences/probe-r1.ts)：对 pc-notype 上正在跑的测试窗口（Windows 11 build 26200）从外部调 `DwmExtendFrameIntoClientArea(-1)`、`DWMWA_USE_IMMERSIVE_DARK_MODE`、`DWMWA_SYSTEMBACKDROP_TYPE = 2`（Mica），三个调用都返回 S_OK；再用 CDP 的 `Emulation.setDefaultBackgroundColorOverride` 把页面默认背景设成全透明、CSS 让根容器透明、标题栏 35% 不透明。
`PrintWindow` 对这个窗口的采样前后完全一样（它拿不到 WebView2 的内容也拿不到 DWM 背景），所以没法用程序判断“透出了没有”，只能靠眼睛：探针把窗口留在屏幕上，等开发者看。

## 探针结果（2026-11-18）

第 1 轮（外部给普通窗口加 DWM 调用）：没有效果。窗口是普通的有重定向位图的窗口，不透明的重绘面挡在 Mica 前面。
第 2 轮（壳在建窗口时传 `transparent: true`，再由壳调 dwmapi；分支 `feat/w00046-t17-backdrop`，环境变量 `NBOOK_BACKDROP_PROBE=1`）：
- Electrobun 2.0.6 的 `transparent: true` 让窗口带 `WS_EX_NOREDIRECTIONBITMAP`（扩展样式 0x40100 变 0x240100），WebView 默认背景同时成为全透明；`DwmExtendFrameIntoClientArea(-1)`、`DWMWA_USE_IMMERSIVE_DARK_MODE`、`DWMWA_SYSTEMBACKDROP_TYPE` 都返回 S_OK。`transparent` 只能在窗口创建时设；产品窗口是启动页窗口换页后变成的，所以所有受管窗口建窗口时都要设。
- 开发者看到的是黑色背景，截图（开发者当场允许，只截这个窗口自己的矩形，看完即删）显示：类型 2（Mica）在深色系统下是带壁纸色调的深色底（左上偏蓝、右下偏棕），不随背后的窗口变化，页面是亮色主题，字发暗读不清；类型 3（Acrylic）把窗口背后的内容模糊着透出来，这才是“磨砂透明”。`EnableTransparency=1`，Windows 11 build 26200。
- 结论：方案可行，不需要上游改动；`DWMWA_SYSTEMBACKDROP_TYPE` 取 2 或 3 就是两种效果。

## 当前状态

可行性已证实，产品实现未做。要开发者定：用 Acrylic（背后窗口模糊透出，开发者描述的效果）还是 Mica（壁纸色调），或设置里两种都给；页面一侧的深浅色要跟系统走（探针里亮色主题放在深色玻璃上字读不清）。

## 下一步

开发者定了效果后写 plan.md：`nbook.desktop` 下加窗口背景选项（关、Mica、Acrylic），改设置要重开窗口才生效（`transparent` 只能创建时设）；壳建窗口时读设置（缓存）传 `transparent` 并调 DWM；页面在开着时让外层面板半透明、关掉主题自己的 `--window-backdrop`、颜色方案跟系统明暗；Windows 10、22H2 以下、高对比度、系统“透明效果”关着时退回普通背景，不出现或不生效。
