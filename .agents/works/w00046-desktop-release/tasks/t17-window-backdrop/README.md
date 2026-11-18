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

## 当前状态

实验性，还没有实现；等开发者看过探针窗口的效果再写计划（要看的是：Mica 有没有透出来、深浅色是否合适、窗口按钮与自绘标题栏有没有问题）。

## 下一步

开发者看过效果、确认方向后：写 plan.md（设置项 `nbook.desktop` 下加窗口背景选项、壳在窗口建立时调 DWM 并用环境变量设全透明的 WebView 背景、页面在开着时让外层面板半透明并关掉主题自己的 `--window-backdrop`、Windows 10 与 22H2 以下不出现选项、高对比度与系统“透明效果”关着时退回），再按 autonomous-delivery 的循环做。
