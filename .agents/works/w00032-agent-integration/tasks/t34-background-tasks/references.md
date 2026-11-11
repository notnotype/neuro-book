# 后台任务：现状与参照

2026-11-11 整理，供注意力排序与静态稿用。VS Code 的通知中心与状态栏行为文档写得少，多数取自 `main` 分支的源码（当天读取），是实现而不是对外承诺。

## 应用现状

- **通知服务**（[`workbench/notifications`](../../../../../docs/specs/workbench/notifications.md)，已实现）：每个窗口一份内存队列，右下角堆叠；通知能带进度条（确定、不确定）、能改成成功或失败、带动作与“详情”；失败、带动作、带详情的常驻。不承诺：通知中心（翻历史）、活动栏角标、跨窗口的通知。应用代码里还没有用进度通知的地方。
- **状态栏**（[`ui/workbench-shell`](../../../../../docs/specs/ui/workbench-shell.md) 输出 33、35）：插件经 `workbench.statusbar-items` 贡献条目，左右两侧；固定区先占：左侧项目名与布局问题，最右是“显示面板”。条目只显示贡献方给的真实数据，放不下的收进“更多”。
- **Agent 的任务中心**（[`agent/jobs`](../../../../../docs/specs/agent/jobs.md)，已实现）：后台 `shell` 与子代理运行，按会话登记，Agent 用 `wait`、`kill`、`jobs`；用户只在对话的卡片上看得到、停得了，没有活动面板。[t22](../t22-background-work/README.md)（搁置）记着全局“活动”面板的草稿。
- **工作台插件只有浏览器入口**（`nbook.workbench` 的 `locations: ["browser"]`）。第一个使用者 Skill 初始化跑在服务端（Agent 插件的后端），确认框经远程 `initSkill` 发起。
- 旧应用：只有 Agent 自己的任务管理（`server/agent/jobs/agent-job-manager.ts`），没有通用的后台任务界面。

## VS Code

- **进度的位置**（`vscode.d.ts` 的 `ProgressLocation`）：`Notification` 在通知里显示，可带“取消”、确定与不确定进度都支持；`Window` 在状态栏显示转圈与文字，不能取消、没有确定进度；`SourceControl` 与按视图 id 的位置画在视图里（视图顶的进度条、活动栏图标的角标）。扩展调 `withProgress` 时自己挑位置。
- **取消**：只有 `cancellable` 为真时才有“取消”按钮（`progressService.ts`）。
- **收起正在跑的进度通知**：源码注释“Switch to window based progress once the notification changes visibility to hidden and is still ongoing”：通知收起后仍在通知中心里，状态栏同时出现一条转圈的条目，文字是“标题：最新消息”，点它打开通知中心；通知重新显示时这条消失（`progressService.ts`）。
- **多件同时在跑**：状态栏只有一条，显示最近开始的那件，结束后换下一件（`windowProgressStack`）；悬停是同样的文字（`progressService.ts`）。
- **延迟**：状态栏进度 150 毫秒后才出现、出现后至少留 150 毫秒；进度通知没给延迟时立即出现、至少留 800 毫秒，“to reduce the chance of the notification flashing up and hiding”（`progressService.ts`）。
- **通知中心**：状态栏最右一个铃铛，点开是通知列表（[界面文档](https://code.visualstudio.com/docs/getstarted/userinterface)）。铃铛有新通知或有进行中的时变成带点的铃铛；悬停写“2 New Notifications (1 in progress)”这类；打开中心后未读数归零。“未读”是只以弹出的形式出现过、还没在中心里看过的（`notificationsStatus.ts`）。勿扰模式下铃铛画斜杠，进度通知不弹、只在状态栏显示。
- **UX 指南**（[Notifications](https://code.visualstudio.com/api/ux-guidelines/notifications)、[Status Bar](https://code.visualstudio.com/api/ux-guidelines/status-bar)）：全局的进度通知“should be used as a last resort as progress is best kept within context”；低优先级的进度放状态栏，要用户注意时才升级为进度通知；进度通知要带看详情（日志）的链接、能取消的给取消。

## JetBrains（IntelliJ IDEA）

- **状态栏**：显示进程的进度，点图标打开进程管理器（Processes）（[界面导览](https://www.jetbrains.com/help/idea/guided-tour-around-the-user-interface.html)）。文档里没写进度条样式、几件时怎样显示、能不能在管理器里取消。
- **通知**：右下角气泡，另有“通知”工具窗口按时间列出全部通知与事件，“remain in the tool window until you manually clear them or until you reopen your project”；工具窗口图标上蓝点表示普通事件，红点表示错误（[Notifications](https://www.jetbrains.com/help/idea/notifications.html)）。气泡分会自动消失、常驻、不弹三种，按事件组设置。
- 后台任务就是进程管理器里的一项；通知历史是另一个入口，两者分开。

## 与本 Task 相关的几点

- VS Code 里“后台任务”就是一条进度通知，通知中心兼作任务列表；JetBrains 把进行中的进程（状态栏与进程管理器）与通知历史分成两个入口。
- 两家的任务都只活在本窗口（扩展宿主、IDE 进程）。NeuroBook 的长任务跑在服务端，页面刷新、开第二个窗口时任务还在，所以任务要能从服务端取回，不能只放在窗口的通知队列里。
