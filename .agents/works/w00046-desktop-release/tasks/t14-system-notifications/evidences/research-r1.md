# t14 调研：WebView2 的网页通知与 Electrobun 2.0.6（2026-11-16，桌面调研，未在 Windows 上实测）

## 结论

能不能直接用页面的 `Notification`，要在 Windows 上实测一次 WebView2 的缺省通知界面才定得了；代码与文档只能确定下面几件事。

1. **权限**：Electrobun 2.0.6 自己处理 WebView2 的 `PermissionRequested`（`src/native/win/nativeWrapper.cpp` 约 7977 行起）。缺省时第一次请求通知权限弹一个英文的 Win32 消息框“This page wants to show notifications.”（`MB_YESNO | MB_TOPMOST`），结果按来源缓存在进程内（不跨启动持久化，从代码推断）。构建配置 `build.win.autoGrantPermissions: ["notifications"]`（`src/config/ElectrobunConfig.ts`、`windowsPermissions.ts`）可以跳过它直接授予，只影响 WebView2，不影响 CEF。
2. **显示**：WebView2 从 Runtime 128.0.2739.15 / SDK 1.0.2739.15 起有 `NotificationReceived`，只管非持久的网页通知；宿主不处理时显示 WebView2 自己的缺省通知界面。Electrobun 2.0.6 在 Windows 上没有订阅这个事件（`nativeWrapper.cpp` 里没有 `NotificationReceived`），所以走的是缺省界面。缺省界面在 Windows 上长什么样（系统 Toast 还是 WebView2 自绘的弹窗、显示什么应用名与图标、点它会不会把窗口带到前台、进不进通知中心）文档没有写，要实测。
3. **壳的替代**：`Utils.showNotification` 在 Windows 上用的是旧式气泡（`Shell_NotifyIconW` 加 `NIF_INFO`，临时建一个图标为系统缺省应用图标 `IDI_APPLICATION` 的通知区域图标，气泡消失后删掉），没有点击回调，标题与正文都会显示，Windows 10/11 会把它转成 Toast，但应用名与图标不是 NeuroBook 的（从代码推断）。
4. **来源**：桌面壳的服务端用固定的端口（重新启动复用上一次的两个端口），来源跨启动不变，不会遇到 qwen-code 那种“每次启动一个新来源，拒绝一次就永远拒绝”的问题（[QwenLM/qwen-code#15109](https://github.com/QwenLM/qwen-code/issues/15109)：WebView2 首选项里每个端口一条 BLOCK）。浏览器里照常经 `Notification.requestPermission`，应在用户手势里请求。
5. 服务工作线程推送的通知在 WebView2 里不可用的报告：[MicrosoftEdge/WebView2Feedback#5051](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5051)；本产品只需要非持久通知。

## 探针（等 Windows 开发机 能构建）

在 t18 的构建上加一个调试入口（或在开发者工具里）执行 `new Notification("NeuroBook", {body: "…", icon: …})`，分别看：

- 缺省构建（会弹英文消息框）与 `autoGrantPermissions: ["notifications"]` 的构建；
- 窗口在前台、最小化、在后台时显示成什么样，应用名与图标，进不进 Windows 通知中心；
- 点通知：`onclick` 有没有触发，窗口会不会被带到前台（不会时要壳经桥置前）；
- 勿扰模式、系统里关掉通知时的表现；`Notification.permission` 的值。

缺省界面可用就只写页面一侧（发什么、什么时候发），壳只加 `autoGrantPermissions`；不可用（没有应用标识、不进通知中心、点了没反应）才在 `src/web/host/` 加一个“有没有系统通知能力”的窄接口，由壳经 WinRT Toast（要 AppUserModelID 与开始菜单快捷方式，安装程序已有快捷方式）或 `NotificationReceived` 自己显示，这是 Work README 决定里写的分法。

## 产品上要定的（写计划时列进待确认）

- 哪些通知发成系统通知：Agent 回合结束、需要确认、后台任务结束或失败（Task 目标里的三类）；更新提示不发。
- 只在窗口不在前台时发；同一来源的连续通知要不要合并。
- 设置项：总开关，放在哪个分区（浏览器与桌面都有，所以不在“桌面窗口”）。

参考：[CoreWebView2.NotificationReceived](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.notificationreceived)、[ICoreWebView2NotificationReceivedEventArgs](https://learn.microsoft.com/zh-cn/microsoft-edge/webview2/reference/win32/icorewebview2notificationreceivedeventargs)、[SDK 1.0.2739.15 release notes](https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/sdk/1-0-2739-15)。
