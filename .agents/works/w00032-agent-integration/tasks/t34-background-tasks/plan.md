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
- `shared/contracts.ts`：`tasksKey`（`nbook.tasks/tasks`）与 `BackgroundTasks`、`TaskInput`、`TaskHandle`；远程合同 `tasksContract`（`defineRemoteService`，`provider: "server"`、`callers: ["browser"]`，方法与事件按 Spec 的表；`TaskItemSchema` 的 `title`、`message` 用 `nbook/shared/text` 的 `TextSchema`）；错误码五个，各带 `{detail}`。
- `backend/core.ts`：清单与规则，纯逻辑，时钟与 id 生成注入。
  - `TaskRecord`：快照字段加 `owner`（门面）、`retry`、`detail`、`controller: AbortController`。在跑的放一个 `Map`，结束的按结束顺序放一个数组，超过 50 件时丢最早的（输出 8）。
  - `facade(owner)`：返回 `BackgroundTasks`；`release()` 把这个门面登记的在跑任务转为已中断、以 `"interrupted"` abort（输出 5）。句柄的方法先查“这件还在跑、门面没释放”，不在就直接返回（输出 3 的“之后都不起作用”）。
  - 详情原文的截断在核心里做（8000 个码元、不切开代理对，规则同通知的详情）：服务端代码目前不引用 nb-ui，它的通知子路径带 Vue 的响应式，不为一个常量把它拉进服务端。浏览器端显示时仍走 nb-ui 的 `DetailDialog`。
  - `progress` 的归一：非有限数当 `null`，夹到 0–100。
  - `close()`：把全部在跑的转为已中断并推一次，再清空（“时序与寿命”最后一条）。
- `backend/plugin.ts`：服务端入口，依赖 `diagnosticsKey`、`clockKey`；`provides: [tasksKey]` 用 `provideServicePerConsumer`（`@notnotype/nb-runtime/plugins`），门面释放时调用 `core.facade(owner).release()`；`remoteProvides: [tasksContract]`，`changed` 每个订阅一个 `PushThrottle`（250 毫秒）。`retry` 抛错写诊断 `nbook.tasks`。
- `web/store.ts`：先订阅 `changed` 再 `list`，`onResync` 重取（同 `plugins/agent/web/activity.ts`）。
  - 派生：在跑的、结束的（排序按输出 10），`running.length`，`unseenFailure`。
  - 看过：一个按 id 的集合；第一份清单里已结束的全部记入；视图可见时把此刻结束的全部记入（输出 13）。
  - 结束通知：保留上一份清单的“id → 状态”；之后每份清单里，上一份在跑而这一份成功或失败的，以及上一份没有、这一份已经成功或失败的，各发一条（输出 14）。失败的先 `detail({id})` 取原文再 `notify`。
- `web/plugin.ts`：浏览器入口。贡献视图 `nbook.tasks.view`（`location: "panel"`、`order` 在“通知”之前、`layout: "fill"`、动作“清除已结束”）、状态栏条目 `nbook.tasks.status`（`alignment: "right"`、`order: 1000`、`when` 为公开状态 `nbook.tasks/nonEmpty`、命令 `nbook.tasks.show`）、两条命令与公开状态。条目实现：`text()` 一件写标题、几件写“N 个任务”、没有在跑写空串；`icon()` 按输出 12；`hover` 加载 `TasksHover.vue`；`state()` 在有没看过的失败时为 `error`。
- `web/components/TasksView.vue`（与 `.md`）：输出 10、11。列用 CSS grid 与 `subgrid`，同草稿 `TasksPanelDraft` 的一行一件；按钮用 nb-ui `Button`（`ghost`、`inset` 焦点）；转圈用 `i-lucide-loader-circle` 加旋转、减少动画时不转；不确定进度条用 nb-ui 的 `nb-ui-indeterminate-runner`；详情用 nb-ui `DetailDialog`。组件收 `context: ViewContext`，`context.visible` 为真时调用 store 记看过。
- `web/components/TasksHover.vue`（与 `.md`）：悬停提示里的在跑任务，每件两行（标题与 56px 进度条一行，进展一行）。
- `locales/zh-CN.json`、`en-US.json`：视图与条目的文字、命令标题、时间写法。

### `src/shared/`

- `push-throttle.ts`：从 Agent 插件移来，Agent 的两处引用改指这里。
- `short-time.ts`：`formatShortTime(at, now, locale)`：当天“时:分”，前一天“昨天”，更早“月日”（按浏览器时区）；完整时刻给悬停用。任务视图与通知视图共用。

### `src/plugins/workbench/`

- 状态栏条目的图标与悬停内容（shell 输出 42、43）：`web/contracts.ts` 的 `ItemImplementation` 加 `icon?()` 与 `hover?`；`WorkbenchItemStrip.vue` 在文字前画图标（12px，`spin`、`muted`、`state` 的颜色），`text()` 为空时只画图标；有 `hover` 时用 nb-ui `Tooltip`（`side="top"`，右侧条目 `align="end"`）显示加载的组件，失败退回文字提示并写诊断；`web/items/item-strip.ts` 的宽度测量算上图标。条目按钮的 gap 统一 4px。
- 视图计数（views 输出 17）：`ViewImplementation.badge?()`；外壳给 `WorkbenchPanelHead` 的标签名在标题后接计数；读计数不加载视图。
- 通知中心（notifications 输出 13–16）：
  - `web/notifications.ts`：在现有队列旁加一份中心列表（`shallowRef` 的条目数组：id、输入、发出时刻、没看过）。`notify` 同时写中心；`update` 同步中心；`dismiss` 从两边移除；用户关掉与到时只动队列。`setCenterVisible(visible)`：可见时把中心全部标为看过，之后的 `notify` 只写中心、标为看过、不进队列。中心至多 100 条。动作经同一个 `guarded` 包装。
  - `web/components/WorkbenchNotificationsView.vue`（与 `.md`）：输出 14 的一行一条，列与任务视图同形；空状态居中。视图 `nbook.workbench.notifications`（`location: "panel"`、`layout: "fill"`、`badge()` 是没看过的条数、动作“全部清除”）与命令 `nbook.workbench.clear-notifications` 在 `web/plugin.ts` 贡献。
- 铃铛（notifications 输出 17、shell 输出 44）：`WorkbenchStatusBar.vue` 在“显示面板”左边画铃铛按钮（12px `i-lucide-bell`，没看过时右上角强调色小点、外圈状态栏底色），新 props `unreadNotifications`，事件 `open-notifications`；`WorkbenchShell.vue` 收到后执行 `nbook.view.open {viewId: "nbook.workbench.notifications"}`。

### Lab 与测试插件

- Lab 场景：`TasksView`（在跑、结束各态、空）、`TasksHover`、`WorkbenchNotificationsView`（有没看过、空）、`WorkbenchStatusBar`（带图标条目、铃铛有点与没有点）、`WorkbenchItemStrip`（图标、只有图标、转圈）；数据放各自的 fixture。
- `src/server/testing/test-plugins.ts` 加 `test.tasks-probe`：服务端入口依赖 `tasksKey`，挂控制路由 `POST /tasks/start`（正文是 `TaskInput` 的可序列化部分加 `retry: boolean`）、`POST /tasks/<id>/report|succeed|fail|cancelled`、`GET /tasks/<id>/signal`（是否 abort、reason）。只在 `NBOOK_TEST_PLUGINS` 列出时装。

## Spec 与文档改动

- 新建 `docs/specs/workbench/background-tasks.md`，在 `docs/specs/README.md` 的“待实现规范”登记（已写，随本计划给开发者看）。
- `workbench/notifications.md`：非目标改写；输出 13–17、状态表三行、边界一条、验收 8–10（planned）。
- `ui/workbench-shell.md`：输出 42–44（planned），输出 34 的固定区加铃铛。
- `workbench/views.md`：`badge?()` 与输出 17（planned）。
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
| background-tasks 输出 12 | `store.test.ts`（文字、图标、状态）；Lab `TasksHover` |
| background-tasks 输出 13、14 | `store.test.ts` |
| background-tasks 输出 15 | `background-tasks.e2e.ts` 的书架页一例 |
| background-tasks 输出 16 | `store.test.ts`（切换语言后条目文字）|
| background-tasks 验收 1、2、4 | `background-tasks.e2e.ts` |
| background-tasks 验收 3、5 | `tasks.test.ts` |
| background-tasks 验收 6 | `TasksView.dom.test.ts` |
| notifications 输出 13–16、验收 8–10 | `notifications.dom.test.ts` |
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
  - “视图开着时不弹出”依赖视图实例报告可见性：视图没加载过时一定不可见，规则成立。
