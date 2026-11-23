---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.background-tasks
owners:
  - nbook.tasks
---

# 后台任务

## 目标与非目标

插件的服务端入口把一件要跑一阵的事（安装 Skill 的依赖这类）登记成后台任务。任务跑在服务端，发起它的对话框关掉不影响它；每个窗口都在底部面板的“后台任务”视图里看到同一份清单，看得到进度与结果，能取消、重试、移除；状态栏右侧有一个条目；任务结束时窗口弹一条通知，弹出的通知进通知中心（[`workbench/notifications`](notifications.md) 输出 13 起）。

（planned）清单也汇总别的插件交出的行（[提案“统一后台任务”](../../proposals/unified-background-tasks.md)、[ADR 0056](../../adr/0056-background-work-providers-and-session-notices.md)）：拥有状态的服务端插件把自己登记成提供方，交出“现在有哪些行”，用户对行的停止转回给它；状态、寿命与操作的执行都留在提供方那里，清单只汇总显示、分组与转发。第一个提供方是 Agent（[`agent/jobs.md`](../agent/jobs.md) 输出 20、[`agent/sessions.md`](../agent/sessions.md) 输出 30）。视图按归属分组。

不承诺：

- 持久化：清单只在服务进程的内存里，服务重启后为空。应用整体关停时窗口看不到“已中断”：窗口的订阅先于清单结束，窗口最后看到的仍是“在跑”；“已中断”只在发起方入口单独停止、`nbook.tasks` 仍在时看得到（已知限制）。
- 浏览器入口登记任务；插件 SDK 给第三方插件的登记接口。
- （planned 改写）提供方的行的状态与寿命：清单不存、不改，行何时出现、何时离开由提供方定；Agent 的任务中心、`jobId` 与它的远程合同照旧（[`agent/jobs`](../agent/jobs.md)）。
- （planned）按形态（一次性、服务、定时）与种类筛选：行带这两个字段、种类在行上显示，筛选等第一个服务或定时的提供方出现时再加。
- （planned）项目子进程里发起的工作：第一批只收服务端插件登记的，`project` 只是归属。
- （planned）分页：超出上限没列出的行只写件数（输出 23、26），视图里没有入口。
- 暂停、排队、依赖与优先级；进度的历史。
- 书架页（`/`）没有状态栏与底部面板：在那里只有结束时的通知（输出 15）。

## 术语与参与者

- **任务**：清单里的一项：标题、一行进展、进度、能否取消与重试、状态、开始与结束时刻，失败时可能带详情原文。
- **在跑**、**结束**：状态 `running` 是在跑；`succeeded`（成功）、`failed`（失败）、`cancelled`（已取消）、`interrupted`（已中断）是结束。
- **发起方**：调用 `start` 的那个插件入口（按调用方门面识别，[`runtime/services`](../runtime/services.md) 输出 12）。
- **看过**：按窗口记，见输出 13。
- （planned）**提供方**：经 `provide` 登记、交出行的服务端插件；**行**：提供方交出的一项；**代次**：每次登记的编号，提供方停用又登记就换一代。
- （planned）**归属**：一行属于应用、某个项目或某个根会话；**前台的行**：对话里正在进行的工作（会话的运行），状态栏不数。
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
    retry?: () => void | Promise<void>; // 给了才能重试（输出 6）
}
interface TaskHandle {
    readonly id: string;
    readonly signal: AbortSignal;   // 用户取消（reason "cancelled"）或发起方入口停止后（reason "interrupted"，见输出 5）abort
    report(patch: {message?: Text | null; progress?: number | null}): void;
    succeed(message?: Text): void;
    fail(failure: {message: Text; detail?: string}): void;
    cancelled(message?: Text): void;
}
```

- 标题与进展是文字值 `Text`（[`ui/i18n`](../ui/i18n.md)）：清单原样存、原样交给窗口，窗口渲染时按自己的语言翻。文字引用要带命名空间，并且指向有浏览器入口的插件的目录（窗口只装了这些目录）；字符串是不翻译的字面文字。
- `detail` 是开发诊断原文（不翻译），**交进来时必须已脱敏**；去掉首尾空白后为空的等于没有，至多留 8000 个 UTF-16 码元，超出的截掉并注明已截断（同 [`workbench/notifications`](notifications.md) 的详情）。
- `progress` 不是有限数时当作 `null`，超出 0 到 100 的夹到范围内。
- 标题、进展与失败原因要过远程合同的文字值校验，文字引用必须带命名空间。字面字符串的标题至多 200、进展与失败原因至多 500 个 UTF-16 码元，超出的截掉；文字引用序列化后至多 1 KiB，超出算不合格。长的原文放进 `detail`。
- 输入不合格时：`start` 同步抛 `TypeError`，不登记；句柄的方法这一次调用不起作用，记诊断（`nbook.tasks`）。

（planned）提供方与归属（同一个服务）：

```ts
interface BackgroundTasks {
    start(input: TaskInput): TaskHandle;
    provide(provider: TaskProvider): () => void;   // 每个调用方同一时刻一个，已有在用的再调用同步抛 TypeError；交回撤回函数
}
interface TaskInput { /* 上面的字段 */ owner?: OwnTaskOwner }   // 缺省应用；不合格同步抛 TypeError
type OwnTaskOwner =
    | {kind: "app"}
    | {kind: "project"; project: string; title: Text}
    | {kind: "session"; session: string; title: Text};             // session 是根会话
type RowOwner = OwnTaskOwner | {kind: "session"; session: string; title: Text; open?: RowOpen};   // 只有提供方的行能带 open
interface TaskProvider {
    rows(): readonly ProvidedRow[];                                       // 同步、不做 I/O
    subscribe(notify: () => void): () => void;                           // 行有变化时调 notify；交回退订
    stop(rowId: string, signal: AbortSignal): Promise<StopOutcome>;      // 撤回、服务停止或清单不再等（输出 24）时 signal abort
}
type StopOutcome = {kind: "accepted"} | {kind: "rejected"; reason: Text} | {kind: "unknown"};
interface ProvidedRow {
    id: string;                          // 这家里唯一，至多 200 个字符
    title: Text;
    message?: Text | null;
    progress?: number | null;
    state: "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "interrupted";
    kind: string;                        // 小写字母开头，只含小写字母、数字与 -，至多 40 个字符
    kindLabel: Text;                     // 行上显示的种类名
    form: "once";
    owner: RowOwner;
    head?: boolean;                      // 根会话自己的运行，画成会话块的组头
    foreground?: boolean;                // 前台的行
    startedAt: number;                   // 毫秒时刻
    endedAt?: number | null;
    stoppable?: boolean;
    open?: RowOpen;
}
type RowOpen = {command: string; args?: Readonly<Record<string, string>>};   // 命令 id 以提供方插件 id 加 "." 开头；至多 4 个参数，值至多 200 个字符
```

- 行的文字值与进度的规则同 `TaskInput`；时刻是 `Date` 能表示的毫秒数；一行按发给窗口的样子编码后至多 2 KiB；一家至多 100 行。`owner` 的标题规则同任务标题。
- `waiting` 是等用户处理（例如等批准），算在跑。

（planned）远程服务 `nbook.tasks/tasks` 版本 2 取代下面的版本 1：

| 名字 | 种类 | 输入 | 结果 |
|---|---|---|---|
| `own` | 读 | 无 | `{tasks, background}`：自己的全部任务（形状同版本 1 的清单，每项加 `owner`）与后台工作的计数，见输出 23 |
| `ownChanged` | 事件 | 无过滤 | 同上 |
| `rows` | 读 | `{project, all}`：窗口的当前项目（没有时为 null）与是否取全部项目 | `{version, groups, more, elsewhere}`，见输出 23 |
| `rowsChanged` | 事件 | 同上 | 同上 |
| `detail`、`cancel`、`retry`、`remove`、`clearFinished` | | 同版本 1 | 只对自己的任务 |
| `stop` | 写 | `{key}` | `{outcome: "accepted" \| "rejected" \| "unknown", reason?}` |

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

清单的每项：`{id, title, message, state, progress, cancellable, cancelRequested, retryable, hasDetail, startedAt, endedAt}`：`message` 没有时 `null`；`progress` 只对在跑的有意义（数字或 `null`），结束的为 `null`；`retryable` 是“状态为失败、发起方给了 `retry`、发起方的入口还没停止”（已中断的不能重试）；时刻是 ISO 8601 字符串，在跑的 `endedAt` 为 `null`。

命令（`nbook.tasks` 的浏览器入口贡献，不对 Agent 开放）：`nbook.tasks.show` 打开“后台任务”视图（同 [`workbench/views`](views.md) 输出 14 的 `nbook.view.open`）；`nbook.tasks.clear-finished` 清除已结束的任务（视图头的动作）；（planned）`nbook.tasks.toggle-all-projects` 切换视图的范围（视图头的开关，按下是全部项目，输出 26）。

## 输出与可观察行为

1. **登记。** `start` 返回时任务已在清单里、状态在跑，开始时刻是此刻；所有窗口经 `changed` 看到它。
2. **进展。** `report` 改进展或进度（给了的字段才改，`message: null` 去掉进展）；任务结束后再调用不起作用。
3. **结束。** `succeed`、`fail`、`cancelled` 把在跑的任务转为成功、失败、已取消，记下结束时刻；`fail` 的进展换成失败的原因，`detail` 留作详情；另两个给了文字时它就是结束时的进展。只有第一次结束的调用算数，之后句柄上的调用都不起作用、不抛错。
4. **取消。** 用户对可取消的在跑任务执行 `cancel`：句柄的 `signal` 以 `"cancelled"` abort，`cancelRequested` 变真；任务仍在跑，直到发起方调用某个结束方法，状态按那一次调用定。重复的 `cancel` 不再 abort、照样成功。
5. **发起方停止。** 发起方的入口停止（含应用关停）时，它还在跑的任务转为已中断，`signal` 以 `"interrupted"` abort，句柄作废；它的全部任务（含已结束的）都不再能重试。这一步在发起方自己的停止步骤做完之后才发生：发起方停自己的工作要用入口的停止信号，不在停止步骤里等 `handle.signal`；停止步骤里不必结束任务，还在跑的会转为已中断。
6. **重试。** 对 `retryable` 的任务执行 `retry`：先把这一行移出清单，再调用发起方的 `retry`。发起方通常在里面 `start` 一件新任务（新的 id），新任务就顶替了这一行。`retry` 抛错或返回的 Promise 失败时记诊断，旧行仍已移出。
7. **移除。** `remove` 移出一件结束的任务，`clearFinished` 移出全部结束的；对所有窗口生效。在跑的任务不能移除。
8. **上限。** 结束的任务至多留 50 件，第 51 件结束时先移出结束最早的那件。在跑的件数不设上限。
9. **推送。** 清单有变化时推送整份，合并后每秒至多 4 次；进度连续变化时窗口至多每 250 毫秒看到一次新值。窗口连上后看到的清单不漏掉连上期间的变化；重连后与服务端一致。
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
    - 没有在跑、清单不空：只有一个图标，本窗口有没看过的失败时是危险色的失败图标，否则是淡色的任务图标；悬停提示是一句说明，写有没看过的失败或都结束了。
    - 清单为空：条目不出现。
    - 图标与悬停提示经状态栏条目的图标与悬停内容（[`ui/workbench-shell`](../ui/workbench-shell.md) 输出 42、43）。
13. **看过。** 每个窗口自己记，下面三种情形里已经结束的任务算看过：“后台任务”视图在本窗口有效可见、并且页面在前台时，清单里此刻结束的；窗口取到的第一份清单里的；断线重连后重取到的清单里的。刷新页面就是新的窗口。
14. **结束时的通知。** 窗口连着时看到任务转为成功或失败（上一份清单里它在跑，或上一份里没有它），这个窗口经通知服务发一条通知；转为已取消、已中断的不发；输出 13 后两种情形里取到的清单只建立比较的起点，不发。
    - 成功：成功色调，标题是任务标题，正文是结束时的进展或“完成”，按时消失。
    - 失败：错误色调，标题是任务标题，正文是失败的原因；可重试时带动作“重试”（执行 `retry`），有详情时带“详情”，常驻。通知发出时就带着原文，之后任务被移出也能看；原文被截断时同样注明。
    - 每个开着的窗口各发一条；通知被关掉不影响清单。
    - 任务离开清单（重试、移除、清除已结束、超过上限）时，窗口撤回为它发的通知，通知中心里也随之删掉（[`workbench/notifications`](notifications.md) 输出 13），不留失效的“重试”。
15. **书架页。** 没有状态栏与底部面板的页面上，输出 14 的通知照发，没有视图与条目。
16. **文字跟随界面语言。** 视图、条目、提示与通知里的任务标题与进展按窗口当前语言翻；切换语言后原地换文字，任务不变。
17. （planned）**关闭服务前报出。** `nbook.tasks` 向宿主的 `runningWorkKey` 登记（[`runtime.server-host`](../runtime/server-host.md) 的“在跑的工作”），每件在跑的任务报一项，写它的标题。
18. （planned）**提供方登记。** 服务端插件经 `provide` 把自己登记成提供方，每次登记是新的一代。交回的撤回函数只第一次调用起作用，清单关闭之后调用是空操作；登记方的入口停止（门面释放）时自动撤回。一个调用方同一时刻只能有一个，再调用同步抛 `TypeError`；撤回之后可以再登记。`start` 的 `owner` 按行的同样规则校验，不合格同步抛 `TypeError`。
19. （planned）**行。** 清单读提供方的 `rows()` 时逐行校验：不合格的行（字段、上限、`kind` 的写法、`open` 的命令不是它自己的）丢掉，记诊断 `provider-row-invalid`（行 id 与原因，不含正文；同一行同一原因只记一次）；同 id 的留第一个；取某一行的字段时抛错，按输出 20 当作这一家出错。提供方在同一代里不复用已经消失的行 id：键只带代次与行 id，复用会让旧窗口迟到的操作落到新的那一行上。一家超过 100 行时先留全部在跑与 `waiting` 的（含组头），结束的按结束时刻新到旧补满，其余不列、只计数（进 `more` 与后台工作的件数），记诊断 `provider-rows-capped`（一直超出时只记一次）。`kind` 盖成 `<提供方插件>.<kind>`。提供方的行没有“移除”“重试”“详情”，输出 7 的移除、清除已结束与输出 8 的上限都不管它们：它们何时离开清单由提供方定。
20. （planned）**隔离。** 提供方的 `notify` 只标记有变化；行在推送合并时读，所有订阅共用一份已读的快照，一次变化只读一次。一家的 `rows()` 抛错时，这一家的行清空、记诊断 `provider-failed`（连续失败只记一次），别家照常；它下一次 `notify` 时再读。
21. （planned）**撤回、关闭与代次。** 撤回时先封住这一家的操作（之后的 `stop` 得 `row-gone`），它在途的 `stop` 立即以“未知”交回窗口并 abort 它们的 `signal`，提供方之后的结果丢弃；再退订，丢掉它的行与回调，推送一次。`nbook.tasks` 停止时对每家照做。撤回之后旧一代的 `notify` 不起作用。窗口拿到的每行有一个带代次的键：提供方停用又登记之后，对旧一代的行的操作得 `row-gone`，不落到新一代的同名行上。
22. （planned）**归属与范围。** 每行属于应用、某个项目或某个根会话；`start` 不给 `owner` 的属于应用。窗口按范围取行：“当前项目”取应用、这个项目与全部会话的行，“全部项目”取全部。
23. （planned）**远程合同版本 2。** 事件 `ownChanged` 推 `{tasks, background}`：`tasks` 是自己的全部任务，规则同输出 9（整份超过 512 KiB 时跳过推送、`own` 得 `too-large`）；`background` 是不分范围的在跑后台一次性工作（自己在跑的任务，加提供方不是前台的在跑行）的件数与前 20 件的标题、进展与进度，它变了也推。事件 `rowsChanged` 按订阅时的范围推 `{version, groups, more, elsewhere}`：`groups` 按输出 26 分好组，每行带键、来源（自己或哪家提供方）、种类与可做的操作；`more` 是范围内因上限（一家 100 行与整份 512 KiB）没列出的件数；`elsewhere` 是范围外在跑的件数；内容没变不重推。整份编码后超过 512 KiB 时依次不列：提供方结束的行（最早结束的先）、自己结束但不是失败的任务（最早结束的先）、不是组头的在跑行（最早开始的先）、组头；自己失败的任务一直列。版本 1 的窗口连上得 `version-changed`。
24. （planned）**停止。** 窗口对 `stoppable` 的提供方的行执行 `stop`：清单按最新读到的行查键，转给提供方，交回它给的结果，已受理、被拒（带原因）或未知；提供方 10 秒内没有结果时交回未知并 abort `signal`；未知的不自动重试。行的状态只随提供方之后交出的行变。窗口里结果回来之前这一行的“停止”变成不可用的“正在停止”；被拒时弹一条提示写原因，未知时提示“不知道停没停下，看一下它的状态”，`row-gone` 时提示“它已经不在了”。
25. （planned）**打开。** 行或会话块组头的 `open` 由窗口经命令服务执行；命令交回失败时弹一条提示写原因，不以命令发出当作打开成功。
26. （planned）**分组视图。** 输出 10 的视图改成按归属分组：
    - 范围：视图头里一个开关“显示全部项目”（命令 `nbook.tasks.toggle-all-projects`），按下是全部项目、松开是当前项目；按窗口记，缺省当前项目。
    - 分组依次是会话、项目、应用。会话块：每个根会话一块浅底的圆角块，块里任何一行在等你处理时是浅警示色底。块里第一行是组头，写会话标题（加粗）、等你处理时的“等你处理”徽标、它此刻在做什么、开始时刻，带“打开”“停止”；组头取自这个会话自己的行（`head`）；几家都交了同一个根会话的组头时只认最早登记的那家，别家的当普通行，记诊断 `provider-head-conflict`。没有这一行时（根会话已空闲、只剩别的行），组头只写标题，带最早登记的那家提供方给的“打开”（只有自己的任务时没有“打开”）。其余行缩进在组头下面。项目组写“项目「名字」”加件数，当前项目在前、其余按名字；应用组写“应用”加件数。
    - 会话块的顺序：等你处理的在前，其余按组头的开始时刻（没有组头时按块里最早开始的一行）新的在前。组内在跑与等你处理的在上、结束的在下，各按新到旧。
    - 组头都有收起箭头，缺省展开；收起与展开按窗口记住。
    - 行的列同输出 10，标题前多一个淡色的种类名。提供方的行：可停的有“停止”，有 `open` 的有“打开”，没有移除。
    - 列表末尾：有没列出的行时写“另有 N 件没列出”；当前项目范围下别的项目有在跑的时写“别的项目还有 N 件在跑”。
27. （planned）**状态栏数后台的一次性工作。** 输出 12 的条目改看 `ownChanged` 的 `background`：自己在跑的任务加提供方不是前台的在跑行；悬停列出前 20 件，更多时末尾写“还有 N 件”。会话的运行（前台的行）不数；视图的范围不影响它。“清单为空”是自己的任务为空且 `background` 的件数为 0。
28. （planned）**看过与通知只对自己的任务。** 输出 13、14 只看 `ownChanged` 的 `tasks`：提供方的行不发结束通知、不算“没看过的失败”。视图可见、页面在前台时，自己的已结束任务里显示着的才算看过：在当前范围、在分组里、所在组展开、没有因上限不列；`rowsChanged` 每次更新、组展开或收起时重算。切换范围不撤回通知、不算任务离开清单。

## 状态与转换

| 当前 | 事件 | 下一状态 |
|---|---|---|
| — | `start` | 在跑 |
| 在跑 | `report` | 在跑（进展、进度更新） |
| 在跑 | 用户 `cancel` | 在跑（`cancelRequested`，`signal` abort） |
| 在跑 | `succeed` / `fail` / `cancelled` | 成功 / 失败 / 已取消 |
| 在跑 | 发起方入口停止 | 已中断 |
| 失败（可重试） | 用户 `retry` | 移出（发起方另开新任务） |
| 结束 | `remove`、`clearFinished`、超过上限 | 移出 |

并发：几个窗口对同一件任务的写操作按到达顺序生效；后到的 `remove`、`retry` 遇到已移出的任务得 `unknown-task`；后到的 `cancel` 遇到已结束的得 `not-running`。

时序与寿命：

- `start` 返回之后取的 `list` 里有这件任务；在这之后订阅的窗口一开始就看得到它。
- 句柄在任务结束或发起方入口停止之后作废：调用不起作用、不抛错；`signal` 只 abort 一次。
- `retry` 先移出旧行、再调用发起方的 `retry`；发起方在 `retry` 里同步 `start` 时，新任务与旧行的移出在同一次或相邻两次推送里出现。
- 结束时的通知只由窗口连着时看到的状态变化触发：窗口连上之前、断线期间结束的任务不弹通知（输出 14）。
- 应用整体关停时，窗口的订阅先以“提供方已停止”结束，之后清单才被丢掉：窗口看不到关停时转成的已中断（非目标里的已知限制）。

## 副作用与数据

无持久化：清单与详情原文只在服务进程的内存里，服务重启后为空。“看过”只在窗口的内存里。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `unknown-task` | 清单里没有这个 id（从没有过、已移出） | 重取清单 |
| `not-cancellable` | 这件任务登记时不可取消 | 不显示“取消” |
| `not-running` | 对已结束的任务 `cancel` | 重取清单 |
| `not-retryable` | 不是失败，或发起方没给 `retry`，或发起方的入口已停止 | 不显示“重试” |
| `running` | 对在跑的任务 `remove` | 先取消或等它结束 |
| `too-large` | `list` 时整份清单超过 512 KiB | 照旧显示上一份 |
| `row-gone` | （planned）`stop` 的行已不在，或提供方已撤回、已换代（不用远程层保留的 `target-gone`） | 重取行 |
| `not-stoppable` | （planned）这一行没有声明可停 | 不显示“停止” |
| `version-changed` | （planned）窗口的远程合同是版本 1 | 刷新窗口 |

- 发起方的 `retry` 抛错或失败：记诊断（`nbook.tasks`），旧行已移出，用户可以从发起方的界面再来一次。
- 整份清单序列化后超过 512 KiB：跳过这次推送、`list` 得 `too-large`，都记诊断（（planned）版本 2 里在进入超限时记一次，超限期间各窗口、各次推送不再重复记）；窗口照旧显示上一份。按输入的长度上限，结束的 50 件到不了这个大小，只有在跑的件数极多时才会发生。
- 发起方给的文字不合格：见“输入与前置条件”。
- `detail` 取不到（任务已移出）：“详情”对话框不打开，通知里的“详情”按发出时已取到的原文显示。

## 边界与兼容

- 公开接口：服务键 `tasksKey` 与类型 `BackgroundTasks`、`TaskInput`、`TaskHandle`（`nbook/plugins/tasks/shared/contracts`）；（planned）类型 `TaskProvider`、`ProvidedRow`、`OwnTaskOwner`、`RowOwner`、`RowOpen`、`StopOutcome`；远程服务 `nbook.tasks/tasks` 版本 1（planned：版本 2，输出 23）；命令 `nbook.tasks.show`、`nbook.tasks.clear-finished`。
- （planned）提供方：种类按登记方盖章，`open` 只收登记方自己的命令；一家的行不合格或出错只影响它自己（输出 19、20）。
- 信任边界：标题、进展与详情按纯文本渲染，不解释 HTML；详情原文不经脱敏，由发起方保证已脱敏。只有发起方自己的句柄能改它的任务；窗口只能取消、重试、移除。
- 依赖：视图与状态栏条目经 [`workbench/views`](views.md) 与 [`ui/workbench-shell`](../ui/workbench-shell.md) 的贡献点；结束通知经 [`workbench/notifications`](notifications.md) 的通知服务。

## 验收与 Smoke

1. Given 两个窗口与一个测试插件，When 它 `start` 一件可取消的任务并逐步 `report` 进度，Then 两个窗口的视图都有这一行、进度在走，状态栏条目写它的标题；When 窗口 A 点“取消”，Then 两个窗口都显示“正在取消”，测试插件的 `signal` 已 abort；When 测试插件 `cancelled()`，Then 两个窗口都显示已取消，都不弹通知，条目只剩淡色的任务图标。
2. Given 一件带 `retry` 的任务，When 它以带详情的失败结束，Then 窗口弹一条常驻的错误通知（“重试”“详情”），条目是危险色的失败图标；When 打开“后台任务”视图，Then 条目变成淡色的任务图标；When 点“详情”，Then 对话框里是原文；When 点“重试”，Then 旧行消失、新任务出现在最上面。
3. Given 测试插件有一件在跑的任务与一件带 `retry` 的失败任务，`nbook.tasks` 一直在跑，When 测试插件的服务端入口单独停止，Then 订阅的窗口看到在跑的那件转为已中断、`signal` 以 `"interrupted"` abort、之后句柄的调用不起作用，失败的那件不再能重试。
4. Given 清单里有一件失败的任务，When 刷新窗口，Then 清单还在、条目是淡色的任务图标（取到时已结束的算看过）。
5. Given 50 件结束的任务，When 第 51 件结束，Then 结束最早的那件被移出。
6. Given 一件标题与进展是文字引用的在跑任务，When 界面语言从 zh-CN 切到 en-US，Then 视图、条目与悬停提示原地换成英文。

7. （planned）Given 一个测试插件作提供方交出一行可停的行，两个窗口都看到它，When 插件撤回又重新登记、交出同 id 的行，Then 一个窗口对旧一代的行迟到的“停止”得“它已经不在了”，新一代的提供方没有收到 `stop`。
8. （planned）Given 三家提供方，其中一家的 `rows()` 抛错、另一家交出一行不合格的行，When 推送，Then 别家的行照常更新、可停，坏的那一家只少了它自己的行，诊断各记一条。
9. （planned）Given 提供方的 `stop` 分别交回已受理、被拒、迟迟不交回，When 窗口点“停止”，Then 依次看到行随提供方的状态变、被拒的原因提示、10 秒后的“不知道停没停下”提示；撤回时在途的那次立即以未知交回。
10. （planned）Given 当前项目 A 的窗口开着视图，项目 B 的自己的任务失败，When 切到“全部项目”再切回，Then 切到之前状态栏仍是失败图标，切到之后才算看过；来回切换不撤回 B 的失败通知。

Smoke：`packages/neuro-book/e2e/background-tasks.e2e.ts`（真实浏览器的两个窗口，验收 1、2、4）；服务端的合同测试覆盖验收 3、5，视图的组件测试覆盖验收 6。（planned）验收 7–9 由服务端的合同测试覆盖，验收 10 由仓库测试覆盖；`background-tasks.e2e.ts` 加两个窗口里的分组、范围开关、提供方的行的停止与打开（测试插件同时作提供方并贡献打开命令，其中一个必然失败）。

## 实现合同

- **公开入口**：服务键与类型 `tasksKey`、`BackgroundTasks`、`TaskInput`、`TaskHandle`（`nbook/plugins/tasks/shared/contracts`）；远程服务 `nbook.tasks/tasks` 版本 1；命令 `nbook.tasks.show`、`nbook.tasks.clear-finished`。
- **owner 与依赖方向**：`nbook.tasks` 的服务端入口持有清单，按调用方门面给每个发起方一份服务，门面释放就是发起方停止；远程服务经推送节流把整份清单推给窗口。浏览器入口持有本窗口的任务仓库（“看过”与结束通知），经工作台的视图、状态栏条目贡献点与通知服务出现在界面上；工作台不引用 `nbook.tasks`。
- **关键不变量**：
  - 门面释放时先清掉这个发起方全部任务的 `retry`，再把在跑的转为已中断、以 `"interrupted"` abort，合成一次推送（输出 5，验收 3）。
  - 标题与进展存的是校验后的副本：发起方之后改手里的对象，清单不变（输入的文字值规则）。
  - 窗口的任务仓库在第一份清单和每次重新订阅取到的清单上只建比较起点、把结束的记为看过；之后只比较相邻两份清单决定发不发通知（输出 13、14）。
  - 浏览器入口停止时退订；订阅还没建好入口就停了的，建好后立即退订，不取清单、不再接收推送。

## 证据

- 批准依据：开发者 2026-11-11 的决定（[w00032 t34 记录](../../../.agents/works/w00032-agent-integration/tasks/t34-background-tasks/README.md)第 1–15 条，界面经两轮评审定稿，[评审板](../../../.agents/works/w00032-agent-integration/tasks/t34-background-tasks/artifacts/review/index.html)）；2026-11-12 同意晋升为 `implemented`。；（planned 的提供方、分组与 Agent 的行）开发者 2026-11-23 的决定（[w00032 t42 记录](../../../.agents/works/w00032-agent-integration/tasks/t42-task-list-providers/README.md)决定 1–6，[评审板](../../../.agents/works/w00032-agent-integration/tasks/t42-task-list-providers/artifacts/review/index.html)）
- 实现入口：[`backend/core.ts`](../../../packages/neuro-book/src/plugins/tasks/backend/core.ts)（清单、句柄与发起方停止）、[`backend/remote.ts`](../../../packages/neuro-book/src/plugins/tasks/backend/remote.ts)（远程服务与推送）、[`web/store.ts`](../../../packages/neuro-book/src/plugins/tasks/web/store.ts)（看过与结束通知）、[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/tasks/web/plugin.ts)（视图、状态栏条目与命令）。
- 合同测试：[`tasks.test.ts`](../../../packages/neuro-book/src/plugins/tasks/tasks.test.ts)（输出 1 到 9、输入校验，验收 3、5）、[`store.test.ts`](../../../packages/neuro-book/src/plugins/tasks/store.test.ts)（输出 6、12 到 14）、[`TasksView.dom.test.ts`](../../../packages/neuro-book/src/plugins/tasks/web/components/TasksView.dom.test.ts)（输出 10、11，验收 6）。
- Smoke：[`background-tasks.e2e.ts`](../../../packages/neuro-book/e2e/background-tasks.e2e.ts)（验收 1、2、4，输出 15）。
