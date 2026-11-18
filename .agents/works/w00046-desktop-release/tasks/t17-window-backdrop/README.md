---
schema: nbook.task/v2
taskId: t17-window-backdrop
status: done
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

2026-11-18：已合入 master（f92d24efd，没有 push），实验设置，缺省关。开发者在测试版里看过 Acrylic 与 Mica，说“有半透明磨砂了但有点丑、想要 NeuroBook surface 那种磨砂，得用眼睛看；这个磨砂有点难做，默认设置不开启”，所以不继续调外观，留作实验。

- `nbook.desktop` 的“窗口背景”：关（缺省）、Mica、Acrylic（`windowBackdrop`，只在 Windows 11 22H2 以上、窗口有自画外框时有效，别的情形按普通窗口建）。壳在建每个窗口前按缓存里的值定要不要 `transparent: true`（启动页窗口也一样，它之后换成产品页），建好后用 dwmapi 设 `DwmExtendFrameIntoClientArea(-1)` 与 `DWMWA_SYSTEMBACKDROP_TYPE`，并去掉 `WS_SYSMENU`；预加载脚本在 `<html>` 上设 `data-window-backdrop`；页面把当前明暗经 `window-appearance` 交给壳。改设置只对之后新开的窗口生效。样式只留一种：窗体底透明加 38% 主题底色，外层面板（活动栏、侧栏、右栏）52%，编辑器所在卡片不透明。Spec：desktop-shell 输出 32、场景 18，browser-host 的“窗口外框”。
- 实测发现并处理的坑：DWM 在磨砂窗口的非客户区画系统标题按钮，透过透明的页面叠在我们画的那组后面成重影，去掉 `WS_SYSMENU` 后不再画（关 `DWMWA_NCRENDERING_POLICY` 也能去，但带出 8px 灰边和直角，否决）；代价是没有系统菜单。外层面板样式一度“四种供挑”并不真的不同：卡片自己的底色规则带 `[data-panel-role]` 与作用域属性，优先级压过半透明样式，直到 e2e 量计算值才发现，现已用 `[data-shell-card][data-shell-card]` 抬高。
- 验证：桌面 bun 测试 145 项、`desktop-frame` e2e 12 项（含磨砂样式与“减少透明”回退）、`desktop-settings` e2e 3 项、类型检查、`docs:check` 通过；Windows 实机在 pc-notype 的测试版上看过（截图是开发者当场允许，只截测试窗口自己，看完即删）。
- 实现审查 r1（omp，6 条，报告 [review-r1-omp.txt](evidences/review-r1-omp.txt)）：成立并已改的 3 条：减少透明偏好下没退回不透明（改成变量盖满，写在媒体查询之外，不认该特性的 WebView2 不受影响）；高对比度与强制颜色下根上没有实底（根上无条件铺主题底色）；Spec 里 Alt+Space 的旧承诺与场景 15 与磨砂窗矛盾（限定为普通窗口，磨砂窗写键盘替代 Alt+F4 与 Win+方向键）。部分采纳 1 条：DWM 调用失败后仍去 `WS_SYSMENU`（改成背景设成功才去；页面标记已按请求设、窗口创建后改不了 `transparent`，Spec 写为已知限制，不另加回退，22H2 以上这两个调用不会失败）。不改 1 条：`dropSystemMenu` 的 `SWP_FRAMECHANGED` 是同步调用（只是理论上的等待，实测多次开窗没有卡过，Spec 已写明 UI 线程不等 Bun；改成异步要在 Windows 上重验重影，收益小）。记为已知限制 1 条：`DWMWA_USE_IMMERSIVE_DARK_MODE` 微软只保证可跟随系统深色，系统与页面明暗相反时材质是否同向没有实测（Spec 已改成“意图”并标明未实测）。
- 没验证：Alt+F4、双击标题栏最大化、贴边（去掉 `WS_SYSMENU` 后）、Win+方向键最小化与还原、深色主题下的样子、系统与页面明暗相反、改设置后新开窗口且旧窗口并存的流程、高对比度；都留给开发者或以后真有人开这个实验设置时再验。

## 下一步

没有。以后若要做成默认效果，先让开发者看一版“NeuroBook surface”那种磨砂的样子（靠 CSS 在不透明窗口里做，不靠 DWM 材质，可能比 Acrylic 更好控制），再定是否继续。
