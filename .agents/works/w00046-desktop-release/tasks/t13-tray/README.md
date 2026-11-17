---
schema: nbook.task/v2
taskId: t13-tray
status: active
updated: 2026-11-16
---

# 系统托盘与关掉最后一个窗口时的去向

## 目标与范围

托盘图标与菜单；关最后一个窗口默认退出、设置里可改为留在托盘。计划 r3 起不做缺省模式下的“在后台继续”（拆出另建 Task，见待确认清单），`runtime.browser-host` 不变。

合同：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 28 到 31（后台与托盘、关最后一个窗口的去向）与 [`runtime.desktop-update`](../../../../../docs/specs/runtime/desktop-update.md) 输出 6（留在托盘时的更新文字），都是 planned。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 写好计划，设计审查三轮（Opus）收敛；切片 1（Spec，master c3088ead3）提交。

切片 2 到 5 已合入 master（2026-11-16，82d15e3cc；分支与 worktree 已删；表里除最后一行外是变基前的提交号）：

| 切片 | 提交 | 内容 |
|---|---|---|
| 2 设置值与桥 | c7c221816 | `closeLastWindow` 的声明、桥、缓存逐项读、逐键去重 |
| 3 协调器 | 769751fd2 | 按输出 29 的表定原因；后台、应用级退出、托盘打开与退出 |
| 4 壳与适配层 | 37bb293ec | `trayView`、托盘退出取工作（8 秒）与对话框、`Tray` 的生命周期、后台时意外退出的正文 |
| 5 页面 | fca6ee29b |
| 实现审查 r1 | 07ce676f7、5da60e861（合入后为 a306f03d4、82d15e3cc） | 前端 Sonnet 7 条、后端 Opus 5 条，见 evidences 的 disposition | 更新文字按托盘、插件说明 |

与计划的出入：页面的更新文字不从配置读模式，改由壳在 `update-hint` 里标 `tray`（托盘图标此刻显示着）。页面宿主层没有设置服务；壳知道关窗后会不会真的留在后台（图标没建出来时不会），文字照它写更准。通知发出后不随设置变化改写，两种做法一样。

收口验证（2026-11-16，负载约 9 到 20）：`bun test src/desktop/` 125 项通过；`bun run test:affected --since c3088ead3` 通过（其间一次全量里 `pack.test.ts`、`plugins.test.ts` 因负载超时，单独重跑通过）；类型检查通过；e2e `desktop-settings`、`desktop-update` 7 项通过。

Windows 上的验收（切片 6，2026-11-17，开发者恢复 hutch.exe 之后）：测试版在 pc-notype 上构建与安装通过，托盘主流程通过，证据见 [windows-acceptance-r1.txt](evidences/windows-acceptance-r1.txt)。通过的：设置 `tray` 后图标建出来（16 像素，100% 缩放）；窗口开着时提示“NeuroBook”，关掉最后一个窗口后没有可见窗口、四个进程与服务端都在、提示变成“NeuroBook（在后台运行）”；托盘“打开”开出窗口，最小化的窗口被还原；后台时再次启动应用开出窗口（第二个实例退出）；后台时结束服务端进程，壳弹出“服务意外退出”对话框，文字是“现在没有打开的窗口。”，选重新启动后服务端回来、托盘图标还在、没有窗口；托盘“退出”无工作时先删图标、服务端有序停止（`forced=false exitCode=0`）、进程全部退出、通知区域没有残影。局限：托盘点击是向壳的托盘窗口发 Electrobun 的回调消息（真实点击由 Windows 转成它，没有验证那一段），菜单项用 WM_KEYDOWN 选；UIA 的 Invoke 不产生这两种消息、菜单也不暴露菜单项。没做：有工作在跑时的退出对话框（单元测试覆盖，没有造一个真工作）、开机自启加 `tray`、后台 30 分钟后再打开、改缩放后的图标、Explorer 重启后图标重建、图标建不出来后的重试、Esc 与 Enter 与点 X。

## 下一步

切片 6 余下的几项要在 Windows 上做：开机自启加 `tray`（顺带验图标建不出来后的重试）、有工作在跑时的退出对话框（含 Esc、Enter、点 X）、后台 30 分钟后再打开、改缩放后的图标、Explorer 重启。通过后 Spec 条目晋升由开发者批准。
