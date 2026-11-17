---
schema: nbook.task/v2
taskId: t14-system-notifications
status: planned
updated: 2026-11-16
---

# 系统通知

## 目标与范围

窗口不在前台时把重要的通知（Agent 回合结束、需要确认、后台任务结束或失败）发成系统通知；先实测 WebView2 的网页通知

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 做了桌面调研（[research-r1](evidences/research-r1.md)）：Electrobun 2.0.6 缺省时用英文消息框问通知权限，可在构建配置里自动授予；不处理 `NotificationReceived`，所以显示的是 WebView2 的缺省通知界面，它在 Windows 上的样子与点击行为要实测才知道，这决定只写页面一侧还是要壳自己发 Toast。

## 探针结果（2026-11-17，pc-notype，缺省构建）

证据见 [probe-r1.txt](evidences/probe-r1.txt)。结论：**页面一侧的 `Notification` 在这个壳里不进系统通知**，要壳自己发。

- 能用：`Notification` 存在、安全上下文成立（固定端口的 `http://127.0.0.1:<端口>`）；第一次请求权限弹 Electrobun 的英文 Win32 消息框，点“是”后 `granted`；授予之后记在 WebView2 的用户数据里，下次启动直接是 `granted`（研究里“不跨启动持久化”的推断不对）。`new Notification(...)` 触发 `show`。
- 不能用：通知发出时，WebView2 与外壳进程没有出现任何通知窗口；Windows 通知平台的数据库里没有这条通知，也没有这个应用的处理器登记（`NotificationHandler` 里没有 neurobook、webview2 相关项）。没有应用标识，Windows 不会显示它，也进不了通知中心；点击回调无从谈起。没有屏幕截图，是靠窗口、进程与数据库证据下的结论。
- 按研究里的判据，要加“有没有系统通知能力”的窄接口，由壳显示。壳这一侧有两条路：（A）`Utils.showNotification`，Windows 上是旧式气泡（`Shell_NotifyIconW` + `NIF_INFO`，Win10/11 转成 Toast），改动小，但应用名与图标不是 NeuroBook、没有点击回调（从 Electrobun 源码推断，还没有实测显示成什么样）；（B）经 FFI 调 WinRT Toast，需要给安装程序的开始菜单快捷方式设 AppUserModelID，能带 NeuroBook 的名字与图标、能点击把窗口带回前台，工作量与脆弱度都大。推荐先做（A）接通整条链路（页面决定发什么与何时发，窗口在前台不发），再按需要升级到（B）；要不要接受（A）的应用名与图标由开发者定，见待确认清单。

## 下一步

等开发者定上面（A）与（B）的取舍；定了之后写计划：页面一侧的触发（Agent 回合结束、需要确认、后台任务结束或失败，只在窗口不在前台时发，总开关）与壳一侧的窄接口。
