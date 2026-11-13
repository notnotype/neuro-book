---
schema: nbook.task/v2
taskId: t34-background-tasks
status: done
updated: 2026-11-12
---

# 工作台的后台任务

## 目标与范围

给工作台一个通用的后台任务系统：插件登记长任务（标题、进度、能否取消），关掉发起它的对话框任务照常进行，进度与结果有固定的去处（参照 VS Code 的进度服务与通知中心）。第一个使用者是 t15 的 Skill 初始化（t15 第 33 条），t15 的界面几片排在它之后。

合同：新建 [`workbench/background-tasks`](../../../../../docs/specs/workbench/background-tasks.md)（2026-11-12 晋升 `implemented`）；[`workbench/notifications`](../../../../../docs/specs/workbench/notifications.md) 输出 13–17、[`ui/workbench-shell`](../../../../../docs/specs/ui/workbench-shell.md) 输出 42–44、[`workbench/views`](../../../../../docs/specs/workbench/views.md) 输出 17（planned）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-11 开工（开发者：“可以，开 t34”）。现状与参照整理在 [references.md](references.md)：VS Code 把后台任务做成进度通知、通知中心兼作任务列表；JetBrains 把进行中的进程与通知历史分成两个入口；两家的任务都只活在本窗口，而 NeuroBook 的长任务跑在服务端。

## 设计决定

2026-11-11 在会话里定（我先给了推荐，开发者答复第 2、3 条，其余没有异议）：

1. 任务在服务端登记：刷新页面、开几个窗口都看到同一份；服务重启后清空，在跑的记为“已中断”。工作台插件只有浏览器入口，服务端要有一个所有者（计划里定）。
2. 范围是 NeuroBook 级的任务，即插件发起的长任务（Skill 安装这类）。Agent 的后台任务（后台命令、后台子代理）归 [t22](../t22-background-work/README.md)，本 Task 不收。
3. 通知中心要做（翻看本窗口的通知），类似 JetBrains 进程管理器的任务列表也做；两者都作为视图放在界面底部的面板。
4. 注意力排序：
   - 先看到状态栏右侧的一个条目：有任务在跑时转圈加文字，一件写它的标题，几件写“3 个任务”；悬停列出各件的标题与进度。点它打开底部面板里的任务视图。
   - 任务视图：在跑的在上、结束的在下，各按新到旧；每行标题与一行状态，在跑的画进度条、能取消的有“取消”，结束的画成功或失败图标，失败的带“重试”“详情”；每行能单独移除，视图头有“清除已结束”。
   - 安装输出这类原文默认收起，点“详情”看（通知现有的详情对话框）。
   - 开始时不弹通知，由发起的地方显示进度；结束时弹，成功的按时消失，失败的常驻、带“重试”“详情”。关掉通知不影响任务列表。
   - 没有在跑的、只剩结束的任务时，条目只剩一个图标（有没看过的失败时画失败图标）；列表清空后条目消失。

评审第 1 轮（[评审板](artifacts/review/index.html)，2026-11-11 答复）：

5. 任务视图一行一件（选 A）：整个列表共用几列（图标、名字、状态、进度条、时间、按钮、移除），窄时名字与状态截断、悬停看全文；状态一列直接写原因或进展，不重复图标已表达的结果。开发者备注：空的时候说明文字要居中。
6. 通知视图照第 1 轮的稿（选“可以”）：列出本窗口发过的通知、新的在前，弹出的关掉或到时消失后仍在；每条一行，与任务视图同一套列；没看过的行首一个点、标题加粗，面板标签上写条数，打开视图就算看过；视图开着、看得见时新通知不弹出、直接进列表；只记本窗口，刷新后清空。
7. 状态栏：铃铛一直在“隐藏面板”左边（选 A），有没看过的通知时带点；任务条目照稿（一件写名字、几件写件数，悬停列出各件进度，都结束后只剩图标，清空后消失）。开发者备注“样式优化一下”：第 2 轮出优化过的状态栏稿。

评审第 2 轮（2026-11-11 答复）：

8. 状态栏样式照第 2 轮的稿（选“可以”）：任务条目、铃铛与“隐藏面板”用同一种按钮（20px 高、条目间 4px）；图标统一为 12px 的 lucide 线条图标，转圈用同一套的 loader-circle、颜色随文字、减少动画时不转；铃铛不变色，有新通知时右上角一个强调色小点；悬停用 nb-ui 的 Tooltip，每件两行（名字与进度条一行、状态一行），与条目右对齐；都结束后有没看过的失败时是红色失败图标，否则是淡色任务图标。空状态的说明居中（第 5 条）已照改。

界面评审结束。

写 Spec 前的假设（2026-11-11 会话里问，开发者“都按推荐”）：

9. 任务清单只在内存：服务重启后为空，“已中断”只在关停时短暂可见；记为已知限制，不落盘。
10. 结束时的通知在所有开着的窗口都弹，不只发起的那个窗口。
11. “重试”新开一个任务，顶替原来那条失败的行。
12. 移除、“清除已结束”对所有窗口生效；失败“看过没有”按窗口记，任务视图在本窗口显示过它就算看过。
13. 通知中心：用户关掉或到时消失的通知留在中心；发出方自己撤回（`dismiss`）的同时从中心删掉；在中心点动作，执行后移除这一条；每个窗口至多 100 条，多了先丢最早的。
14. 结束的任务至多留 50 件，多了先丢最早结束的；在跑的不由系统设上限。
15. 本 Task 只让插件的服务端入口登记任务；浏览器端发起的任务以后再说。

计划审查之后（2026-11-11）：

16. 已中断的任务不能重试（改第 2 处确认“失败与已中断的能重试”）：已中断只发生在发起方入口停止时，它给的 `retry` 属于已停止的那一代，调用必然失败；发起方停止时它留下的失败任务也一并不能重试。用户从原来的界面重新发起。

## 下一步

Spec 与计划开发者 2026-11-11 看过（“可以”，含两处：结束通知的标题就是任务标题；只有失败的能重试，见第 16 条）。Opus 设计审查 16 条（重要 9、建议 7），15 条照改、1 条接受取舍（[处理](evidences/design-review.txt)）。五片已实施、审查、合入 master（见下面的进展）。

开发者 2026-11-12 批准 Spec 晋升（“spec 可以晋升”）：`workbench/background-tasks.md` 改为 `implemented`，补实现合同与证据；`workbench/notifications.md` 输出 13–17、`ui/workbench-shell.md` 输出 42–44、`workbench/views.md` 输出 17、18、`ui/workbench-layout.md` 输出 1 的相关句去掉 planned。三条回写也已批准并写入（Lab 夹具定宽、自己滚动的组件看 390 截图、变异检查在仓库外的副本里做）。t34 完成；Skill 初始化接进后台任务在 t15 切片 5、6 做。

进展：

- 切片 1（服务端）提交 `4806def3b`：`nbook.tasks` 服务端入口、远程接口、`PushThrottle` 移到 `src/shared/`；`tasks.test.ts` 16 例（输出 1–9、输入校验、验收 3、5、清单过大），两条核心判据做过变异检查；类型检查、受影响的测试（2838 例，新插件补进宿主测试的插件清单与内置插件名称表后全过）、治理检查通过。
- 切片 2（外壳扩展）提交 `f1efae161`：条目的 `icon()`、`hover`（新组件 `WorkbenchItemHover`），视图的 `badge()`；`WorkbenchItemStrip.dom.test.ts` 加 3 例（图标、只有图标的读屏名、悬停内容与退回，悬停接线做过变异检查），条目与视图注册表各加 1 例；Lab 场景 `WorkbenchItemStrip/icons`（截图已看过）。面板头标签带计数的外壳接线留到第 3 片由通知视图在真实窗口里测。类型检查、受影响的测试（bun 2847、Vitest 498）、治理检查通过。
- 切片 3（通知中心与铃铛）提交 `52c35e200`：通知服务加中心（`center`），`WorkbenchNotificationsView` 视图（计数经 `badge()`）、命令 `nbook.notifications.clear` 与公开状态 `nbook.workbench/hasNotifications`（单独一组，不并进布局那组键）、状态栏铃铛，`NotificationInput.detailTruncated`，`src/shared/short-time.ts`。测试：`notifications.dom.test.ts` 加 4 例、视图组件 3 例、状态栏铃铛 1 例、时间短写法 2 例；Lab 场景 `WorkbenchNotificationsView`（三个）与 `WorkbenchStatusBar/bell-unread`，截图对照过定稿。真实窗口里“标签带计数、点铃铛打开视图、打开后清零”要真实布局，放进第 5 片的 e2e。受影响的测试：bun 2843 过、4 失败中 3 个是新键与新公开状态未登记（已补，单独重跑通过），1 个是负载 13 时项目子进程停止用例超时（单独重跑通过）；Vitest 506 过。
- 切片 4（任务的浏览器端）提交 `623065eb1`：`web/store.ts`（基线、看过、结束通知与撤回）、`TasksView`、`TasksHover`、浏览器入口（视图 `nbook.tasks.list`、状态栏条目 `nbook.tasks.status`、命令 `nbook.tasks.show` 与 `nbook.tasks.clear-finished`、公开状态 `nbook.tasks/nonEmpty` 与 `hasFinished`）、文字目录。测试：`store.test.ts` 5 例（真实远程、两个窗口；基线与撤回做过变异检查）、`TasksView.dom.test.ts` 5 例（含切换语言）；Lab 场景 `TasksView`（五个）与 `TasksHover`，截图对照过定稿；英文界面“Yesterday”放不下，两个视图的时间列都改成按内容放宽。受影响的测试：bun 2851 过，失败的 3 个里 2 个是命令标题约定键写错（已改，重跑通过），1 个是负载 13 时 Markdown 图片地址用例超时（单独重跑通过）；Vitest 511 过；治理检查过（补登文字目录）。草稿在 `.worktree/w00032-t34-drafts`（不提交）。
- 切片 5（e2e 与收口）提交 `3df4e2fab`：测试插件 `test.tasks-probe`（控制路由登记与推进任务，只在测试入口登记）；`e2e/background-tasks.e2e.ts` 4 例覆盖验收 1、2、4、输出 15 与 notifications 验收 8、输出 17，全过。宽范围外壳 e2e 暴露两个内置底部视图让新客户端的底部面板默认显示：视图声明加 `revealRegion`（[views](../../../../../docs/specs/workbench/views.md) 输出 18、[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 1，master `521b6a0d9`），后台任务与通知都声明为 `false`，默认布局照旧不显示底部面板；三个外壳 e2e 的 7 例改为算上面板里的两个内置标签（dnd 只列测试插件的标签、views 标签数加 2、shell 的框架按钮多“浮动”与标题颜色改读右栏），单独重跑全过。lab-scenes（滤掉下面的 404 后临时单跑）查出新夹具 `TasksFixture`、`NotificationsViewFixture` 在手机画布上横向溢出，宽度改为不超过舞台后干净。类型检查、治理检查过。
- 与本 Task 无关的既有失败（master 上同样会失败，未改）：`e2e/plugins.e2e.ts` 等“插件设置”分区里的 `nbook.agent/toolBindings`，它在 `4d73e28ef`（Profile 设置页）移进 Profile 分区后那个分区在用户层为空、被停用；`e2e/lab-scenes.e2e.ts` 的 ThemeEditor 两个场景用假素材名取预览报 404，另有 AgentDock、BackgroundCommandCard、ProfileRail、ProfileSettingsPage、SubagentCard 的场景在手机画布上越界、不在基线里。
- 实现审查（2026-11-11）：后端 Claude Opus 6 条（重要 1、建议 5）、前端 Claude Sonnet 9 条（重要 5、建议 4 组），逐条处理见 [后端](evidences/impl-review-backend.txt)、[前端](evidences/impl-review-frontend.txt)。修正提交 `3d07ca273`。改动要点：清单存文字的副本；两次推送之间开始又失败的任务照样发通知；没有在跑的任务时悬停写一句说明；通知中心的详情同样截到 8000 码元；任务视图不到 600px 宽时每件排两行（390 宽截图核对过）；只有图标的条目以 `tooltip()` 作可访问描述。Spec 同步在 master `d76dd6031`。与计划的偏差：`TaskItemSchema` 没有带 `maxLength`，长度与 `ns` 改在核心入口保证（远程节点逐份校验推送，放进 schema 后截短出一点差错整份推送都会被丢）。
- 合入 master `15f50e1cd`（合并前用 `git merge-tree` 试算无冲突；master 这段时间改的是品牌素材、Markdown、编辑器与 nb-ui 表单和弹层，与本分支不是同一批代码，分支上的验证仍有效）。分支上的收口验证：`test:affected` 全过，neuro-book 与 nb-ui 类型检查、治理检查、文档检查过，`e2e/background-tasks.e2e.ts` 4 过；外壳 e2e 的 7 例改后单独重跑过。
