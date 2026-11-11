---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: workbench.background-tasks
owners:
  - nbook.tasks
---

# 后台任务

## 目标与非目标

插件的服务端入口把一件要跑一阵的事（安装 Skill 的依赖这类）登记成后台任务。任务跑在服务端，发起它的对话框关掉不影响它；每个窗口都在底部面板的“后台任务”视图里看到同一份清单，看得到进度与结果，能取消、重试、移除；状态栏右侧有一个条目；任务结束时窗口弹一条通知，弹出的通知进通知中心（[`workbench/notifications`](notifications.md) 输出 13 起）。

不承诺：

- 持久化：清单只在服务进程的内存里，服务重启后为空；重启前在跑的任务记为“已中断”只在关停的那一刻看得到，重启后看不到（已知限制）。
- 浏览器入口登记任务；插件 SDK 给第三方插件的登记接口。
- Agent 自己的后台工作（后台命令、子代理运行），它们由 [`agent/jobs`](../agent/jobs.md) 管，不进这份清单。
- 暂停、排队、依赖与优先级；进度的历史。
- 书架页（`/`）没有状态栏与底部面板：在那里只有结束时的通知（输出 15）。

## 术语与参与者

- **任务**：清单里的一项：标题、一行进展、进度、能否取消与重试、状态、开始与结束时刻，失败时可能带详情原文。
- **在跑**、**结束**：状态 `running` 是在跑；`succeeded`（成功）、`failed`（失败）、`cancelled`（已取消）、`interrupted`（已中断）是结束。
- **发起方**：调用 `start` 的那个插件入口（按调用方门面识别，[`runtime/services`](../runtime/services.md) 输出 12）。
- **看过**：按窗口记，见输出 13。
- 参与者：发起方；`nbook.tasks`（服务端的清单、服务与远程，浏览器端的视图、状态栏条目与结束通知）；窗口；用户。

## 输入与前置条件

服务（只在服务端，按调用方提供；`nbook/plugins/tasks/shared/contracts`）：

```ts
interface BackgroundTasks {
    start(input: TaskInput): TaskHandle;
}
interface TaskInput {
    title: Text;                    // 一行：做什么，例如“初始化 Skill epub-export”
    message?: Text;                 // 一行进展，例如“正在安装 23 个包”
    progress?: number | null;       // 0 到 100；null 或不给是不确定进度
    cancellable?: boolean;          // 缺省 false
    retry?: () => void;             // 给了才能重试（输出 6）
}
interface TaskHandle {
    readonly id: string;
    readonly signal: AbortSignal;   // 用户取消（reason "cancelled"）或发起方入口停止（reason "interrupted"）时 abort
    report(patch: {message?: Text | null; progress?: number | null}): void;
    succeed(message?: Text): void;
    fail(failure: {message: Text; detail?: string}): void;
    cancelled(message?: Text): void;
}
```

- 标题与进展是文字值 `Text`（[`ui/i18n`](../ui/i18n.md)）：清单原样存、原样交给窗口，窗口渲染时按自己的语言翻。文字引用要带命名空间，并且指向有浏览器入口的插件的目录（窗口只装了这些目录）；字符串是不翻译的字面文字。
- `detail` 是开发诊断原文（不翻译），**交进来时必须已脱敏**；去掉首尾空白后为空的等于没有，至多留 8000 个 UTF-16 码元，超出的截掉并注明已截断（同 [`workbench/notifications`](notifications.md) 的详情）。
- `progress` 不是有限数时当作 `null`，超出 0 到 100 的夹到范围内。

远程服务 `nbook.tasks/tasks`（版本 1，服务端提供，浏览器调用）：

| 名字 | 种类 | 输入 | 结果 |
|---|---|---|---|
| `list` | 读 | 无 | 整份清单 |
| `changed` | 事件 | 无过滤 | 整份清单 |
| `detail` | 读 | `{id}` | 详情原文与是否截断，没有详情时 `null` |
| `cancel` | 写 | `{id}` | 无 |
| `retry` | 写 | `{id}` | 无 |
| `remove` | 写 | `{id}` | 无 |
| `clearFinished` | 写 | 无 | 移出的件数 |

清单的每项：`{id, title, message, state, progress, cancellable, cancelRequested, retryable, hasDetail, startedAt, endedAt}`：`message` 没有时 `null`；`progress` 只对在跑的有意义（数字或 `null`），结束的为 `null`；`retryable` 是“状态为失败或已中断，且发起方给了 `retry`”；时刻是 ISO 8601 字符串，在跑的 `endedAt` 为 `null`。

命令（`nbook.tasks` 的浏览器入口贡献，不对 Agent 开放）：`nbook.tasks.show` 打开“后台任务”视图（同 [`workbench/views`](views.md) 输出 14 的 `nbook.view.open`）；`nbook.tasks.clear-finished` 清除已结束的任务（视图头的动作）。

## 输出与可观察行为

1. **登记。** `start` 返回时任务已在清单里、状态在跑，开始时刻是此刻；所有窗口经 `changed` 看到它。
2. **进展。** `report` 改进展或进度（给了的字段才改，`message: null` 去掉进展）；任务结束后再调用不起作用。
3. **结束。** `succeed`、`fail`、`cancelled` 把在跑的任务转为成功、失败、已取消，记下结束时刻；`fail` 的进展换成失败的原因，`detail` 留作详情；另两个给了文字时它就是结束时的进展。只有第一次结束的调用算数，之后句柄上的调用都不起作用、不抛错。
4. **取消。** 用户对可取消的在跑任务执行 `cancel`：句柄的 `signal` 以 `"cancelled"` abort，`cancelRequested` 变真；任务仍在跑，直到发起方调用某个结束方法，状态按那一次调用定。重复的 `cancel` 不再 abort、照样成功。
5. **发起方停止。** 发起方的入口停止（含应用关停）时，它还在跑的任务转为已中断，`signal` 以 `"interrupted"` abort，句柄作废。
6. **重试。** 对 `retryable` 的任务执行 `retry`：先把这一行移出清单，再调用发起方的 `retry`。发起方通常在里面 `start` 一件新任务（新的 id），新任务就顶替了这一行。`retry` 抛错时记诊断，旧行仍已移出。
7. **移除。** `remove` 移出一件结束的任务，`clearFinished` 移出全部结束的；对所有窗口生效。在跑的任务不能移除。
8. **上限。** 结束的任务至多留 50 件，第 51 件结束时先移出结束最早的那件。在跑的件数不设上限。
9. **推送。** 清单有变化时推送整份，合并后每秒至多 4 次；进度连续变化时窗口至多每 250 毫秒看到一次新值。窗口先订阅再取，重连后重取。
10. **“后台任务”视图。** `nbook.tasks` 贡献的视图，第一次放在底部面板，排在“通知”之前。
    - 顺序：在跑的在上、结束的在下；在跑的按开始时刻、结束的按结束时刻，各自新的在前。
    - 每件一行，整个列表共用几列，长短不一的名字不推动后面的列：状态图标、标题、进展、进度条、时间、按钮、移除。名字与进展按 2 比 3 分剩下的宽度，名字至少 8 个字宽；放不下时截断，悬停看全文。
    - 状态图标：在跑的转圈；成功、失败、已取消、已中断各一个图标，失败用危险色、已中断用警告色。系统设了减少动画时转圈不转。
    - 进展一列：在跑写进展；失败写原因（不重复“没有成功”）；已取消写“已取消”或发起方给的文字；已中断写“已中断”；成功写发起方给的文字或“完成”。
    - 进度条只画在在跑的行：数字画确定进度，`null` 画不确定进度。
    - 时间：在跑的写开始时刻，结束的写结束时刻；当天写“时:分”，前一天写“昨天”，更早写月日；悬停写“开始于”或“结束于”加完整时刻。
    - 按钮：可取消的在跑任务有“取消”，`cancelRequested` 为真时它变成不可用的“正在取消”；可重试的有“重试”；有详情的有“详情”。
    - 移除：只结束的行有，点了执行 `remove`。
    - 视图头的动作“清除已结束”：没有结束的任务时不可用。
    - 清单为空时视图中间一句“没有后台任务。安装 Skill 这类要跑一阵的事会列在这里。”
11. **详情。** 点“详情”经 `detail` 取原文，打开详情对话框（同 [`workbench/notifications`](notifications.md) 输出 11）：标题“任务标题：详情”，内容是原文，被截断时注明。
12. **状态栏条目。** `nbook.tasks` 贡献的状态栏条目，在右侧、紧挨通知铃铛左边，点它执行 `nbook.tasks.show`。
    - 有在跑的任务：转圈图标加文字，只有一件时写它的标题，几件时写“N 个任务”。悬停提示列出每件在跑的任务：标题与进度条一行，进展一行，标题过长截断。
    - 没有在跑、清单不空：只有一个图标，本窗口有没看过的失败时是危险色的失败图标，否则是淡色的任务图标。
    - 清单为空：条目不出现。
    - 图标与悬停提示经状态栏条目的图标与悬停内容（[`ui/workbench-shell`](../ui/workbench-shell.md) 输出 42、43）。
13. **看过。** 每个窗口自己记：“后台任务”视图在本窗口有效可见时，清单里此刻结束的任务都算看过；窗口取到第一份清单时，里面已经结束的都算看过。刷新页面就是新的窗口。
14. **结束时的通知。** 窗口开着时有任务转为成功或失败，这个窗口经通知服务发一条通知；转为已取消、已中断的不发。
    - 成功：成功色调，标题是任务标题，正文是结束时的进展或“完成”，按时消失。
    - 失败：错误色调，标题是任务标题，正文是失败的原因；可重试时带动作“重试”（执行 `retry`），有详情时带“详情”（原文先经 `detail` 取到），常驻。
    - 每个开着的窗口各发一条；通知被关掉不影响清单。
15. **书架页。** 没有状态栏与底部面板的页面上，输出 14 的通知照发，没有视图与条目。
16. **文字跟随界面语言。** 视图、条目、提示与通知里的任务标题与进展按窗口当前语言翻；切换语言后原地换文字，任务不变。

## 状态与转换

| 当前 | 事件 | 下一状态 |
|---|---|---|
| — | `start` | 在跑 |
| 在跑 | `report` | 在跑（进展、进度更新） |
| 在跑 | 用户 `cancel` | 在跑（`cancelRequested`，`signal` abort） |
| 在跑 | `succeed` / `fail` / `cancelled` | 成功 / 失败 / 已取消 |
| 在跑 | 发起方入口停止 | 已中断 |
| 失败、已中断（可重试） | 用户 `retry` | 移出（发起方另开新任务） |
| 结束 | `remove`、`clearFinished`、超过上限 | 移出 |

并发：几个窗口对同一件任务的写操作按到达顺序生效；后到的 `remove`、`retry` 遇到已移出的任务得 `unknown-task`；后到的 `cancel` 遇到已结束的得 `not-running`。

时序与寿命：

- `start` 返回之后取的 `list` 里有这件任务；在这之后订阅的窗口一开始就看得到它。
- 句柄在任务结束或发起方入口停止之后作废：调用不起作用、不抛错；`signal` 只 abort 一次。
- `retry` 先移出旧行、再同步调用发起方的 `retry`；它里面 `start` 的新任务与旧行的移出在同一次或相邻两次推送里出现。
- 结束时的通知只由窗口看到的状态变化触发：窗口连上之前就结束的任务不弹通知；断线期间结束的，重取清单后按输出 13 算看过，也不弹。
- 服务停止时，先把在跑的任务按输出 5 转为已中断并推送，再丢掉清单。

## 副作用与数据

无持久化：清单与详情原文只在服务进程的内存里，服务重启后为空。“看过”只在窗口的内存里。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `unknown-task` | 清单里没有这个 id（从没有过、已移出） | 重取清单 |
| `not-cancellable` | 这件任务登记时不可取消 | 不显示“取消” |
| `not-running` | 对已结束的任务 `cancel` | 重取清单 |
| `not-retryable` | 不是失败或已中断，或发起方没给 `retry` | 不显示“重试” |
| `running` | 对在跑的任务 `remove` | 先取消或等它结束 |

- 发起方的 `retry` 抛错：记诊断（`nbook.tasks`），旧行已移出，用户可以从发起方的界面再来一次。
- `detail` 取不到（任务已移出）：“详情”对话框不打开，通知里的“详情”按发出时已取到的原文显示。

## 边界与兼容

- 公开接口：服务键 `tasksKey` 与类型 `BackgroundTasks`、`TaskInput`、`TaskHandle`（`nbook/plugins/tasks/shared/contracts`）；远程服务 `nbook.tasks/tasks` 版本 1；命令 `nbook.tasks.show`、`nbook.tasks.clear-finished`。
- 信任边界：标题、进展与详情按纯文本渲染，不解释 HTML；详情原文不经脱敏，由发起方保证已脱敏。只有发起方自己的句柄能改它的任务；窗口只能取消、重试、移除。
- 依赖：视图与状态栏条目经 [`workbench/views`](views.md) 与 [`ui/workbench-shell`](../ui/workbench-shell.md) 的贡献点；结束通知经 [`workbench/notifications`](notifications.md) 的通知服务。

## 验收与 Smoke

1. Given 两个窗口与一个测试插件，When 它 `start` 一件可取消的任务并逐步 `report` 进度，Then 两个窗口的视图都有这一行、进度在走，状态栏条目写它的标题；When 窗口 A 点“取消”，Then 两个窗口都显示“正在取消”，测试插件的 `signal` 已 abort；When 测试插件 `cancelled()`，Then 两个窗口都显示已取消，都不弹通知，条目只剩淡色的任务图标。
2. Given 一件带 `retry` 的任务，When 它以带详情的失败结束，Then 窗口弹一条常驻的错误通知（“重试”“详情”），条目是危险色的失败图标；When 打开“后台任务”视图，Then 条目变成淡色的任务图标；When 点“详情”，Then 对话框里是原文；When 点“重试”，Then 旧行消失、新任务出现在最上面。
3. Given 测试插件有一件在跑的任务，When 它的服务端入口停止，Then 任务转为已中断、`signal` 以 `"interrupted"` abort、之后句柄的调用不起作用。
4. Given 清单里有一件失败的任务，When 刷新窗口，Then 清单还在、条目是淡色的任务图标（取到时已结束的算看过）。
5. Given 50 件结束的任务，When 第 51 件结束，Then 结束最早的那件被移出。
6. Given 一件标题与进展是文字引用的在跑任务，When 界面语言从 zh-CN 切到 en-US，Then 视图、条目与悬停提示原地换成英文。

Smoke：`packages/neuro-book/e2e/background-tasks.e2e.ts`（真实浏览器的两个窗口，验收 1、2、4）；服务端的合同测试覆盖验收 3、5。

## 证据

- 批准依据：开发者 2026-11-11 的决定（[w00032 t34 记录](../../../.agents/works/w00032-agent-integration/tasks/t34-background-tasks/README.md)第 1–15 条，界面经两轮评审定稿，[评审板](../../../.agents/works/w00032-agent-integration/tasks/t34-background-tasks/artifacts/review/index.html)）。
