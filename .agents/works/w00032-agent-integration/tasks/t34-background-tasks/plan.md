# t34 后台任务：实施计划

## Context

t15 的 Skill 初始化要在关掉确认框后继续在后台装，开发者决定先做通用的后台任务系统（t15 第 33 条）。本 Task 的范围、注意力排序与界面经会话与两轮评审定稿（[Task 记录](README.md)第 1–15 条）。

依据：

- 新 Spec [`workbench/background-tasks`](../../../../../docs/specs/workbench/background-tasks.md)（planned）。
- [`workbench/notifications`](../../../../../docs/specs/workbench/notifications.md) 输出 13–17、验收 8–10（planned）：通知中心、“通知”视图、铃铛。
- [`ui/workbench-shell`](../../../../../docs/specs/ui/workbench-shell.md) 输出 42–44（planned）：状态栏条目的图标与悬停内容、铃铛的位置。
- [`workbench/views`](../../../../../docs/specs/workbench/views.md) 输出 17（planned）：视图标题后的计数。

工作方式：代码在 worktree `.worktree/w00032-t34-background-tasks`（分支 `feat/w00032-t34-background-tasks`）；草稿留在 `.worktree/w00032-t34-drafts`，不提交。计划审查派 Opus；实现审查后端派 Opus、前端派 Sonnet。验证只跑受影响的测试与 e2e 文件。

## 技术选型

- 推送限频：复用 Agent 插件的 `PushThrottle`（`plugins/agent/backend/push-throttle.ts`），移到 `src/shared/push-throttle.ts` 两边共用；不另写。
- 时刻的短写法：`Intl.DateTimeFormat`（浏览器内置），不引库。
- 无新依赖。

## 关键设计

### `src/plugins/tasks/`（新插件 `nbook.tasks`，`locations: ["server", "browser"]`）

- `plugin.ts`：描述；`src/manifest.ts` 的 `productPlugins`、`src/server/plugins.ts`、`src/web/plugins.ts` 各登记一处。
- `shared/contracts.ts`：`tasksKey`（`nbook.tasks/tasks`）与 `BackgroundTasks`、`TaskInput`、`TaskHandle`；远程合同 `tasksContract`（`defineRemoteService`，`provider: "server"`、`callers: ["browser"]`，方法与事件按 Spec 的表；`TaskItemSchema` 的 `title`、`message` 用 `nbook/shared/text` 的 `TextSchema`）；错误码六个，各带 `{detail}`；`TaskItemSchema` 的字符串字段带 `maxLength`，文字引用要求有 `ns`。
- `backend/core.ts`：清单与规则，纯逻辑，时钟与 id 生成注入。
  - `TaskRecord`：快照字段加 `owner`（`ConsumerIdentity`）、`retry`、`detail`、`controller: AbortController`。在跑的放一个 `Map`，结束的按结束顺序放一个数组，超过 50 件时丢最早的（输出 8）。
  - 归属的键是 `ConsumerIdentity`：门面工厂与释放回调收到的是同一个冻结对象。`facade(consumer)` 返回 `BackgroundTasks`；`release(consumer)` 把它名下在跑的转为已中断、以 `"interrupted"` abort，并去掉它名下全部记录（含已结束的）的 `retry`，`retryable` 随之为假（输出 5）。句柄的方法先查“这件还在跑、发起方没释放”，不在就直接返回（输出 3 的“之后都不起作用”）。
  - 输入校验（Spec“输入与前置条件”）：标题、进展与失败原因用远程合同的同一份 `TextSchema` 校验，另要求文字引用带 `ns`；字面字符串按 200、500 码元截短，文字引用序列化超过 1 KiB 算不合格。`start` 不合格抛 `TypeError`；句柄方法不合格这次不起作用、写诊断。这样进了清单的每一项都过得了远程校验，一件坏任务不会让整份清单推不出去。
  - `retry` 调用：先移出旧行，再调用；同步抛错与返回的 Promise 失败都接住、写诊断。
  - 详情原文的截断在核心里做（8000 个码元、不切开代理对，规则同通知的详情）：服务端代码目前不引用 nb-ui，它的通知子路径带 Vue 的响应式，不为一个常量把它拉进服务端。浏览器端显示时仍走 nb-ui 的 `DetailDialog`。
  - `progress` 的归一：非有限数当 `null`，夹到 0–100。
  - `close()`：abort 全部在跑任务的 `signal` 再清空，不推送（整体关停时订阅已先结束，见 Spec“时序与寿命”）。
  - 整份清单的大小：每次算推送与 `list` 时量序列化后的字节数，超过 512 KiB 跳过推送、`list` 得 `too-large`，都写诊断（同 Agent 的 `treeChanged`）。
- `backend/plugin.ts`：服务端入口，依赖 `diagnosticsKey`、`clockKey`；`provides: [tasksKey]` 用 `provideServicePerConsumer`（`@notnotype/nb-runtime/plugins`），写成 `provideServicePerConsumer(tasksKey, (consumer) => core.facade(consumer), {release: (_facade, consumer) => core.release(consumer)})`；`remoteProvides: [tasksContract]`，`changed` 每个订阅一个 `PushThrottle`（250 毫秒）。入口由发起方的依赖与远程调用拉起，不必 `onStartup`。
- `web/store.ts`：先订阅 `changed` 再 `list`，`onResync` 重取（同 `plugins/agent/web/activity.ts`）。
  - 派生：在跑的、结束的（排序按输出 10），`running.length`，`unseenFailure`。
  - 比较的基线：`baseline: Map<id, state> | null`。基线为空时收到的第一份清单（不管来自推送还是 `list`）只建立基线、把已结束的记为看过，不发通知；`onResync` 先把基线清空，重取到的清单同样只建基线（输出 13 后两种情形、输出 14）。有基线时，上一份在跑而这一份成功或失败的，以及上一份没有、这一份已经成功或失败的，各发一条。
  - 看过：一个按 id 的集合，记入规则同上，再加“任务视图可见并且页面在前台时，此刻结束的全部记入”。
  - 结束通知：失败的先 `detail({id})` 取原文与是否截断，再 `notify`（带 `detailTruncated`）。记下“任务 id → 通知句柄”；任务不在新清单里时对那条 `dismiss`（输出 14 的撤回）。通知动作里的 `retry` 得 `unknown-task` 时只写诊断：撤回规则让这种情形只剩竞态。
- `web/plugin.ts`：浏览器入口。贡献视图 `nbook.tasks.view`（`location: "panel"`、`order` 在“通知”之前、`layout: "fill"`、动作“清除已结束”）、状态栏条目 `nbook.tasks.status`（`alignment: "right"`、`order: 1000`、`priority: 60`（比 Agent 活动的 50 高、比编辑器条目高，窄时最后才收进“更多”）、`when` 为公开状态 `nbook.tasks/nonEmpty`、命令 `nbook.tasks.show`）、两条命令与公开状态。入口 `activationEvents: ["onStartup"]`，依赖 `notificationsKey`、`commandServiceKey` 与远程；书架页上没有视图与条目的接收者，入口照常激活、只发通知（输出 15）。条目实现：`text()` 一件写标题、几件写“N 个任务”、没有在跑写空串；`icon()` 按输出 12；`hover` 加载 `TasksHover.vue`；`state()` 只在“没有在跑、有没看过的失败”时为 `error`（有在跑的时候条目只表示进行中）。
- `web/components/TasksView.vue`（与 `.md`）：输出 10、11。列用 CSS grid 与 `subgrid`，同草稿 `TasksPanelDraft` 的一行一件；按钮用 nb-ui `Button`（`ghost`、`inset` 焦点）；转圈用 `i-lucide-loader-circle` 加旋转、减少动画时不转；不确定进度条用 nb-ui 的 `nb-ui-indeterminate-runner`；详情用 nb-ui `DetailDialog`。组件收 `context: ViewContext`，`context.visible` 为真且 `document.visibilityState` 为 `visible` 时调用 store 记看过；组件卸载时停止上报。
- `web/components/TasksHover.vue`（与 `.md`）：悬停提示里的在跑任务，每件两行（标题与 56px 进度条一行，进展一行）。
- `locales/zh-CN.json`、`en-US.json`：视图与条目的文字、命令标题、时间写法。

### `src/shared/`

- `push-throttle.ts`：从 Agent 插件移来，Agent 的两处引用改指这里。
- `short-time.ts`：`formatShortTime(at, now, locale)`：当天“时:分”，前一天“昨天”，更早“月日”（按浏览器时区）；完整时刻给悬停用。任务视图与通知视图共用。

### `src/plugins/workbench/`

- 状态栏条目的图标与悬停内容（shell 输出 42、43）：`web/contracts.ts` 的 `ItemImplementation` 加 `icon?()` 与 `hover?`；`WorkbenchItemStrip.vue` 在文字前画图标（12px，`spin`、`muted`、`state` 的颜色），`text()` 为空时只画图标；有 `hover` 时用 nb-ui `Tooltip`（`side="top"`，右侧条目 `align="end"`）显示加载的组件，失败退回文字提示并写诊断；`web/items/item-strip.ts` 的宽度测量算上图标。条目按钮的 gap 统一 4px。`text()` 为空时，可访问名称只用名字（现在是“名字：文字”，`WorkbenchItemStrip.vue` 的 `titled`），“更多”里那一项的文字也用名字（现在用 `entry.text`）。
- 视图计数（views 输出 17）：`ViewImplementation.badge?()`；外壳给 `WorkbenchPanelHead` 的标签名在标题后接计数；读计数不加载视图。
- 通知中心（notifications 输出 13–16）：
  - `web/notifications.ts`：在现有队列旁加一份中心列表（`shallowRef` 的条目数组：id、输入、发出时刻、没看过）。`notify` 同时写中心；`update` 同步中心；`dismiss` 从两边移除；用户关掉与到时只动队列（三种移除在 nb-ui 队列里都是 `remove`，只有服务能分辨：`dismiss` 是发出方调的，动作由 `guarded` 包着）。`guarded` 的 `run` 执行后把这条从中心与队列一起移除，所以在弹出处与中心点动作结果相同。`setCenterVisible(visible)`：由通知视图组件上报，卸载时报 `false`，并与 `document.visibilityState` 合起来算“可见”；可见时把中心全部标为看过，之后的 `notify` 只写中心、标为看过、不进队列。中心至多 100 条。`NotificationInput` 加可选的 `detailTruncated` 透传给 nb-ui 队列（队列已有这个字段）。
  - `web/components/WorkbenchNotificationsView.vue`（与 `.md`）：输出 14 的一行一条，列与任务视图同形；空状态居中。视图 `nbook.workbench.notifications`（`location: "panel"`、`layout: "fill"`、`badge()` 是没看过的条数、动作“全部清除”）与命令 `nbook.notifications.clear` 在 `web/plugin.ts` 贡献。
- 铃铛（notifications 输出 17、shell 输出 44）：`WorkbenchStatusBar.vue` 在“显示面板”左边画铃铛按钮（12px `i-lucide-bell`，没看过时右上角强调色小点、外圈状态栏底色），新 props `unreadNotifications`，事件 `open-notifications`；`WorkbenchShell.vue` 收到后执行 `nbook.view.open {viewId: "nbook.workbench.notifications"}`。

### Lab 与测试插件

- Lab 场景：`TasksView`（在跑、结束各态、空）、`TasksHover`、`WorkbenchNotificationsView`（有没看过、空）、`WorkbenchStatusBar`（带图标条目、铃铛有点与没有点）、`WorkbenchItemStrip`（图标、只有图标、转圈）；数据放各自的 fixture。
- 命令域：`src/plugins/commands/shared/registry.ts` 的 `COMMAND_DOMAINS` 加 `tasks`、`notifications`（Spec 已在 `workbench/commands.md` 的域词表加上）。
- `src/server/testing/test-plugins.ts` 加 `test.tasks-probe`：服务端入口依赖 `tasksKey`，挂控制路由 `POST /tasks/start`（正文是 `TaskInput` 的可序列化部分加 `retry: boolean`）、`POST /tasks/<id>/report|succeed|fail|cancelled`、`GET /tasks/<id>/signal`（是否 abort、reason）。只在 `NBOOK_TEST_PLUGINS` 列出时装。

## Spec 与文档改动

- 新建 `docs/specs/workbench/background-tasks.md`，在 `docs/specs/README.md` 的“待实现规范”登记（已写，随本计划给开发者看）。
- `workbench/notifications.md`：非目标改写；输出 13–17、状态表三行、边界一条、验收 8–10（planned）。
- `ui/workbench-shell.md`：输出 42–44（planned），输出 34 的固定区加铃铛。
- `workbench/views.md`：`badge?()` 与输出 17（planned）。
- `workbench/commands.md`：域词表加 `tasks`、`notifications`（planned）。
- 设计审查（Opus，16 条）后改过一轮，处理见 [evidences/design-review.txt](evidences/design-review.txt)。
- 实现后：各条去掉“（planned）”，补实现合同与证据；`background-tasks.md` 晋升请开发者批准。
- `docs/modules/monorepo-boundaries.md` 不改（插件在 `neuro-book` 包内）。

## 切片

1. **服务端**：`shared/push-throttle.ts` 搬家；`plugins/tasks` 的描述、`shared/contracts.ts`、`backend/`，三处登记。测试 `src/plugins/tasks/tasks.test.ts`（核心与经真实远程的场地，场地照 `plugins/models/testing/world.ts`）。验证：`bun run test:affected`（含 Agent 两处引用的测试）、`bun run typecheck`。单独提交。
2. **工作台外壳**：条目的图标与悬停内容、视图计数。测试补在 `WorkbenchItemStrip.dom.test.ts`、`activity-items.test.ts` 同组与面板头的测试里；Lab 场景。单独提交。
3. **通知中心与铃铛**：`notifications.ts`、通知视图、铃铛、命令。测试补在 `notifications.dom.test.ts`（真实队列、视图组件）、`NotificationStack`/状态栏的测试；Lab 场景。单独提交。
4. **任务的浏览器端**：store、视图、悬停、条目、命令、结束通知、文字目录。测试 `src/plugins/tasks/web/store.test.ts`（真实远程、两个窗口）与 `TasksView.dom.test.ts`；Lab 场景。单独提交。
5. **e2e 与收口**：`test.tasks-probe`、`e2e/background-tasks.e2e.ts`；Spec 去掉 planned 标记、补证据；实现审查（后端 Opus、前端 Sonnet），处理后合入 master。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| background-tasks 输出 1–9、失败码 | `tasks.test.ts` |
| background-tasks 输出 10、11 | `TasksView.dom.test.ts`；Lab `TasksView` |
| background-tasks 输出 12 | `store.test.ts`（条目交出的文字、图标、状态）；Lab `TasksHover` |
| background-tasks 输出 13 | `store.test.ts`（第一份、重连后的清单）；`TasksView.dom.test.ts`（真实 `ViewContext.visible` 翻转时记看过） |
| background-tasks 输出 14 | `store.test.ts`（首屏推送先到、重连两个序列不发；撤回：两个窗口、一处重试、另一处通知消失） |
| background-tasks 输出 15 | `background-tasks.e2e.ts` 的书架页一例 |
| background-tasks 输出 16 | `TasksHover.dom.test.ts` 与 `TasksView.dom.test.ts`（宿主翻译引擎切换语言）；条目文字的翻译由 shell 验收 45 覆盖，store 只交文字引用 |
| background-tasks 验收 1、2、4 | `background-tasks.e2e.ts` |
| background-tasks 验收 3、5 | `tasks.test.ts`：验收 3 的探针用 `hub.plugins.register(定义, {scope: hub.root.createChild(...)})` 单独登记，关闭这个子作用域就停止它的入口，窗口的订阅断言收到已中断；整体关停时订阅以 `provider-stopped` 结束另有一例 |
| background-tasks 验收 6 | `TasksView.dom.test.ts` |
| notifications 输出 13–16、验收 8–10 | `notifications.dom.test.ts`（含在弹出处点动作、视图卸载后照常弹出） |
| notifications 输出 17 | `WorkbenchStatusBar` 的测试；`background-tasks.e2e.ts` 点铃铛一例 |
| shell 输出 42、43 | `WorkbenchItemStrip.dom.test.ts` |
| shell 输出 44 | 状态栏测试 |
| views 输出 17 | 面板头与外壳的测试 |

## 验证

- 每片：`bun run test:affected`、`bun run typecheck`、受影响的 Lab 截图（`nbdev shot`，亮色，宽 1440 与 390 两种）。
- 收口：构建 server、web 与 e2e 外壳三份产物后跑 `e2e/background-tasks.e2e.ts`，再跑覆盖状态栏与面板的 `e2e/workbench-shell.e2e.ts`。
- 未验证边界：服务真实重启时“已中断”只在关停那一刻可见（Spec 的已知限制），e2e 不测；Skill 初始化接进来由 t15 做。

## 不做与风险

- 不做：浏览器端登记任务、插件 SDK 的登记接口、持久化、勿扰模式；Skill 初始化的接入（t15 切片 5，t34 合入后在 t15 分支变基接上）。
- 风险：
  - 条目宽度测量要算图标，否则“更多”的收起会错位；切片 2 的测试覆盖只有图标、图标加文字两种。
  - 悬停组件异步加载，第一次悬停可能先显示文字提示；接受（加载很快，退回的文字也对）。
  - “视图开着时不弹出”依赖视图组件上报可见性：没加载过时一定不可见；加载过的在卸载时报 `false`（去书架页、出错重建、句柄撤回都会卸载）。
  - 发起方用 `handle.signal` 停工作会卡住停机（Spec 输出 5）：t15 接 Skill 初始化时按 Spec 用入口的停止信号。
