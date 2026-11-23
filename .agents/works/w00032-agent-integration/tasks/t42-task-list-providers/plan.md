# t42 计划：后台任务清单的提供方与分组视图

第 1 稿（2026-11-23）。

## 1. Context

`nbook.tasks` 现在只列插件经 `start()` 登记的任务；Agent 的后台命令、子代理、插件工具登记的任务和在跑的会话只在对话里看得到。已接受的[提案“统一后台任务”](../../../../../docs/proposals/unified-background-tasks.md)第四节第 2、3 小节与 [ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md) 定了方向：清单只汇总、状态归提供方。本 Task 把 `nbook.tasks` 改成能收提供方的行，Agent 作第一个提供方，视图按归属分组。

依据：

- 开发者的决定：本 Task README 决定 1–6（第一批的行、按归属分组会话在前、状态栏与通知只管后台的一次性工作、形态与种类筛选后移、每个会话一块、会话组默认展开）。
- 输入：两轮提案审查里归本 Task 的条目（[第一轮](../t22-background-work/evidences/proposal-review-r1.txt) 5、7、8、11、12、16、17、18、19、21、24、27、28；[第二轮](../t22-background-work/evidences/proposal-review-r2.txt) 11、12、13、14、15、17）；t22 推过来的子代理卡片读有界终态。
- 合同：[`workbench/background-tasks.md`](../../../../../docs/specs/workbench/background-tasks.md)（主体）、[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)。

工作方式：代码在 Work 分支 `feat/w00032-agent-integration` 的 worktree；草稿在 `.worktree/w00032-t42-drafts`。审查：碰远程合同的版本与跨插件的提供方隔离、停止的语义，属于高风险后端，计划与实现都走快速审查（Opus 先审，omp `@review` 后台）；视图另派 Sonnet。

## 2. 技术选型

无新的通用问题：推送沿用 `nbook/shared/push-throttle` 的 `PushThrottle`，校验沿用 TypeBox 的 `Value`（同现有 `core.ts`），视图沿用 nb-ui 的零件。

## 3. 关键设计

### 3.1 提供方合同：`packages/neuro-book/src/plugins/tasks/shared/contracts.ts`

`BackgroundTasks` 加 `provide`，`TaskInput` 加归属：

```ts
interface BackgroundTasks {
    start(input: TaskInput): TaskHandle;
    /** 每个调用方同一时刻一个；已有在用的时同步抛 TypeError。交回撤回函数，重复调用无效。门面释放时自动撤回。 */
    provide(provider: TaskProvider): () => void;
}
interface TaskInput { /* 现有字段 */ readonly owner?: TaskOwner }   // 缺省 {kind: "app"}

type TaskOwner =
    | {readonly kind: "app"}
    | {readonly kind: "project"; readonly project: string; readonly title: Text}
    | {readonly kind: "session"; readonly session: string; readonly title: Text; readonly open?: RowOpen};  // session 是根会话

interface TaskProvider {
    /** 同步、有界、不做 I/O：此刻的全部行。抛错时这一家按“出错”处理（输出 20），不影响别家。 */
    rows(): readonly ProvidedRow[];
    /** 行有变化时调 notify；交回退订。撤回时清单先退订再丢回调。 */
    subscribe(notify: () => void): () => void;
    /** 用户停一行。只有声明了 stoppable 的行会收到；signal 在撤回或服务停止时 abort。 */
    stop(rowId: string, signal: AbortSignal): Promise<StopOutcome>;
}
type StopOutcome = {readonly kind: "accepted"} | {readonly kind: "rejected"; readonly reason: Text} | {readonly kind: "unknown"};

interface ProvidedRow {
    readonly id: string;                 // 这家提供方里唯一，至多 200 个字符
    readonly title: Text;                // 同 TaskInput 的上限
    readonly message?: Text | null;
    readonly progress?: number | null;
    readonly state: "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "interrupted";
    readonly kind: string;               // 小写字母开头，只含小写字母、数字与 -；清单盖成 <提供方插件>.<kind>
    readonly kindLabel: Text;            // 行上显示的种类名
    readonly form: "once";               // 以后加 "service"、"scheduled"
    readonly owner: TaskOwner;
    readonly head?: boolean;             // 会话行：这个根会话自己的运行，画成组头（输出 26）
    readonly foreground?: boolean;       // 对话里正在进行的工作（会话行）：状态栏不数（决定 3）
    readonly startedAt: number;
    readonly endedAt?: number | null;
    readonly stoppable?: boolean;
    readonly open?: RowOpen;
}
type RowOpen = {readonly command: string; readonly args?: Readonly<Record<string, string>>};  // 命令必须是提供方插件自己的（id 以 <插件>. 开头）
```

不变量与理由：

- 提供方投影同步、有界、无 I/O（第二轮第 13 条）：合并器在一次推送里读各家，不等异步，一家慢不拖别家。
- 一行编码后至多 4 KiB、一家至多 200 行（第一轮第 12 条、第二轮第 12 条）：超出的行丢掉、记诊断 `provider-row-invalid`，多出 200 的不列、组尾写“另有 N 件没列出”。`open.args` 只放定位用的 id，值至多 200 个字符、至多 4 个键。
- 代次（第二轮第 11 条）：每次 `provide` 由清单生成新的代次；行在远程里的键是 `p:<插件>:<代次>:<行 id>`，操作带这个键，代次不符或行已不在得 `target-gone`，不会落到新一代的同名行上。
- 撤回（第二轮第 13 条）：先封住派发（之后的 `stop` 得 `target-gone`）、退订，再丢回调与行、推送一次。门面释放（插件入口停止）时自动撤回。

### 3.2 清单核心：`backend/core.ts`、新 `backend/providers.ts`

- `providers.ts`：提供方登记表。每家记 `{plugin, generation, provider, unsubscribe, rows: 上一次的合格快照, failed}`。`notify` 只标脏并触发清单的变化；读行在推送合并时做（每 250 毫秒至多一次），一次读一家，`rows()` 抛错时这家标 `failed`、行清空、记诊断 `provider-failed`（同一家连续失败只记一次），下次 `notify` 再试。
- 行的校验与截断在读入时做（同现有 `normalizeText`），不合格的行逐行丢掉；同 id 重复的留第一个。
- 核心的 `list` 拆成两份：`own()`（自己的任务，形状同 v1 的 `TaskItem` 加 `owner`）与 `rows(scope)`（自己的任务与提供方的行合在一起的行模型，见 3.3）。

### 3.3 远程合同 v2：`shared/contracts.ts`、`backend/remote.ts`

`nbook.tasks/tasks` 升到版本 2（旧窗口得 `version-changed`，同 [`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 的做法）。

- 事件 `own`（无过滤）：自己的全部任务，形状与规则同 v1 的 `changed`。窗口的“看过”与结束通知只看它（决定 3；第一轮第 28 条：存在性与基线按全局，不随视图筛选变）。
- 事件 `rows`（过滤 `{scope: {project: string} | "all"}`）：`{groups, more, background}`。`groups` 按 3.4 的顺序；`more` 是因上限没列出的件数；`background` 是全局的在跑的后台一次性工作（自己的在跑任务加提供方不是 `foreground` 的在跑行）的件数与前 20 件的标题与进度，状态栏用（决定 3）。整份编码后不超过 512 KiB：一家 200 行、一行 4 KiB 时最坏是各家的行加起来，超出时从结束得最早的起不列、计进 `more`。
- 方法：`own`、`rows` 各一个读（同事件的载荷）；自己任务的 `detail`、`cancel`、`retry`、`remove`、`clearFinished` 不变；新 `stop({key})` 写，结果 `{outcome: "accepted" | "rejected" | "unknown", reason?}`，失败码 `target-gone`、`not-stoppable`。`unknown` 不自动重试（第二轮第 15 条）。
- 推送：每个订阅一个 `PushThrottle`，同 v1。

### 3.4 分组：`backend/groups.ts`

纯函数 `groupRows(own, provided, scope, currentProjectTitle?)`：

- 范围：`{project}` 时留应用、这个项目与全部会话的行；`"all"` 时全部。
- 顺序：会话组（每个根会话一组，按组里最近的开始时刻新的在前，等你处理的组在前）、项目组（当前项目在前，其余按名字）、应用组。组内在跑与等你处理的在上、结束的在下，各按新到旧。
- 会话组的组头：组里有 `head` 行就用它（标题、状态、停止与打开都来自它）；没有时用 `owner` 的标题与 `open` 画一个没有停止的组头（根会话已空闲、只剩后台任务在跑时）。

### 3.5 Agent 作提供方：新 `agent/backend/task-rows.ts`

Agent 有 `tasksKey` 时在激活里 `provide`，没有就不交（照常运行；“在跑的工作”仍由 Agent 自己报，sessions.md 输出 20，不改）。

- 行（决定 1；第一轮第 5、19 条，第二轮第 17 条）：
  - 后台任务每件一行：`isLive` 的，以及结束了但回执还没进会话的（出口不是已受理或已取走的提醒）；种类 `shell`（“命令”）、`agent`（“子代理”）、插件登记的（显示它的 `label`）。归属是启动它的会话的根。
  - 根会话：`activityWithBackground()` 里在跑或等你处理、按根归并，根自己在跑或等你处理时出一行 `head`（`foreground: true`），状态 `running` 或 `waiting`，进展写它此刻在做什么（等你批准的是哪个工具、或“正在回复”），可停。
  - 在跑的子会话：不是任何在跑的子代理任务的 `target` 的，出一行“子会话”（`foreground: true`），可停、可打开。
  - 内部会话（起标题与说明）不出行。
- 变化：订阅 `table.onActivityChanged`、`jobs.onChanged` 与标题的变化，都只调 `notify`。
- 停止（第一轮第 21 条，第二轮第 15、18 条）：后台任务走 `jobs.kill(null, id)`（用户停：回执照送、不唤起，jobs.md）；会话行以用户身份 `abort({keepQueue: true, runId})`，`runId` 是出行时那次运行的，已不是它得 `rejected`（“已经结束”）。`kill` 的“已经结束”也是 `rejected`；抛错是 `unknown`。
- 打开（第一轮第 17 条，第二轮第 14 条）：会话与子会话行、子代理行的 `open` 是 `nbook.agent.focus-session {sessionId}`；命令行没有打开。`focus-session` 改成如实交回失败：视图或会话打不开时交回失败（现在总交回成功）。
- 套件：`SessionTable.activityWithBackground()` 每项加 `runId`（表在状态帧里记下当前运行的 id），给会话行定址。

### 3.6 窗口：`tasks/web/`

- 仓库拆两份：`own`（现有的看过、通知、详情、重试、移除，订阅改成 v2 的 `own`）与 `rows`（视图与状态栏，按本窗口的范围订阅 `rows`；范围变了重订）。
- 视图：每个会话一块浅底的圆角块，等你处理的那块浅警示色底，块里组头是会话自己、后台任务缩进在下面；项目与应用的组头是小标题加件数；组头都有收起箭头，默认展开，收起与展开按窗口记住（决定 5、6，草稿 `TaskGroupsDraft` 的 `blocks`）；行的列同现在，多一列淡色的种类；会话组头带“打开”“停止”；提供方的行只有“停止”“打开”，没有移除；`stop` 交回前按钮写“正在停止”，`rejected` 时弹一条提示写原因，`unknown` 写“不知道停没停下，看一下它的状态”。
- 范围开关：视图的标题动作只能是图标按钮（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 10），做成一个 `toggled` 的开关“显示全部项目”，按下是全部项目；按窗口记。草稿里画的是分段控件，实现按这个改。
- 打开：执行行上的命令，失败时弹一条提示写原因（第一轮第 17 条：不以命令发出代替打开成功）。
- 状态栏：数 `rows.background`（决定 3），悬停列出它给的前 20 件。
- 结束通知：只看 `own`（决定 3、第一轮第 24 条）。

### 3.7 子代理卡片读有界终态（t22 推来）：`agent/shared/remote.ts`、`agent/web/`

远程 `runOutcome({sessionId, runId})`：读那次运行的收口（`runEnded` 的收口方式与回复首句，至多 1 KiB），读不到得 `run-not-found`。卡片在任务已移出、`jobs` 里没有它时用它画终态，不读整份 `runResult`。同一运行回退后接着跑时读到最近一次，记已知限制（提案第四节第 3 小节第 11 条）。

## 4. Spec 与文档改动

- `workbench/background-tasks.md`：目标与非目标改写（收提供方的行、Agent 不再列为非目标）；输入加 `provide`、`TaskProvider`、`ProvidedRow`、`TaskOwner`、远程 v2；新输出：提供方登记、行的校验与上限、隔离、撤回与代次、归属与范围、分组与顺序、停止、打开、视图（决定 5、6）、状态栏、通知只给自己的；失败表加 `target-gone`、`not-stoppable`、`version-changed`；输出 17 随本 Task 晋升。都写成 planned。
- `agent/jobs.md`：新输出“清单的行”（后台任务的行、停止、打开）。
- `agent/sessions.md`：新输出“会话的行”（根会话与没有任务覆盖的子会话的行、停止绑定运行）；远程 `runOutcome`。
- `agent/conversation.md`：输出 33 子代理卡片读 `runOutcome`；输出 53 `focus-session` 如实交回失败。
- 套件的 `activityWithBackground` 带 `runId`：会话表没有单独的 Spec（只在 `agent/sessions.md` 的实现合同里提到），行为写在 sessions.md 输出 30（停止绑定出行时那次运行），实现合同补一句。
- 提案只追加决策记录（已追加决定 4）。

## 5. 切片

1. **提供方核心与远程 v2**（3.1–3.4）：`tasks/shared`、`tasks/backend`。验证：`tasks.test.ts` 加提供方的用例（真实入口、测试插件作提供方：登记、校验与上限、出错隔离、撤回与代次、停止三种结果、分组与范围、`rows` 的上限）；typecheck。
2. **窗口**（3.6）：仓库、视图、状态栏。验证：`store.test.ts`、`TasksView.dom.test.ts`、`background-tasks.e2e.ts` 加分组与提供方的行。
3. **Agent 作提供方**（3.5，含套件的 `runId`）：验证：Agent 的集成用例（真实服务：后台命令一行、子代理不另出会话行、根会话一行、等你处理、停会话行保留排队的话、停的运行已换得 rejected、`focus-session` 失败如实交回）；套件 `table` 的用例。
4. **子代理卡片的 `runOutcome`**（3.7）：远程与卡片；`subagents.test.ts`、`session-host.test.ts`、`agent-subagents.e2e.ts`。

每片单独提交；第 1、3 片后各开一次快速审查（Opus 先审，omp 后台），第 2、4 片收口时一起派 Sonnet 审前端。

## 6. 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| background-tasks 输出 18–22、24 | `tasks.test.ts` 新 describe“提供方”：真实入口，测试插件作提供方 |
| background-tasks 输出 23 | `tasks.test.ts`：`own`、`rows` 的读与事件、`more`、`background`、上限；`version-changed` 由远程层给 |
| background-tasks 输出 25、26 | `TasksView.dom.test.ts`（分组、块、组头、收起与记住、提供方的行的按钮、没列出的件数）；`background-tasks.e2e.ts`（两个窗口、范围开关、停止与打开） |
| background-tasks 输出 27、28 | `store.test.ts`（状态栏的件数、看过只算显示着的、切范围不撤通知）；`TasksHover` 的 dom 用例 |
| background-tasks 输出 17 | `tasks.test.ts` 已有用例核对后晋升 |
| jobs.md 输出 20 | 新 `task-rows.test.ts`（真实服务：命令一行、回执进会话后不再列、停止三种结果、子代理可打开） |
| sessions.md 输出 30 | `task-rows.test.ts`（根会话组头、等你处理的进展、子代理覆盖的子会话不另出、没覆盖的出一行、停会话行保留排队的话、运行已换交回被拒）；套件 `table` 的用例（`runId`） |
| sessions.md 输出 31、conversation 输出 33 的 `runOutcome` | `subagents.test.ts`、`session-host.test.ts`；`agent-subagents.e2e.ts` |
| conversation 输出 53 的失败交回 | Agent 浏览器入口覆盖 `focus-session` 的现有测试文件（开工时找）加失败的用例 |

## 7. 验证

- 合同测试：`tasks.test.ts`（核心与远程，真实入口）、Agent 的集成用例（真实会话表与任务中心）、套件的 `table` 用例。
- 浏览器：`background-tasks.e2e.ts` 两个窗口看分组、范围开关、提供方的行的停止与打开；`agent-subagents.e2e.ts` 看子代理卡片的终态。
- 未验证边界：服务与定时形态（没有提供方）；项目子进程登记（第一批不收，提案第三节）。

## 8. 不做与风险

- 不做：形态与种类的筛选（决定 4）；项目入口登记（`project` 只是归属标签，第一轮第 16 条）；提供方的行持久化。
- 风险：`rows` 的上限与 `more` 的取舍在提供方很多时会把结束的行挤出列表；`foreground` 由提供方自报，状态栏的口径靠提供方守约。
