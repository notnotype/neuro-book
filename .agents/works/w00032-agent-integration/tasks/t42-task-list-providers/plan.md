# t42 计划：后台任务清单的提供方与分组视图

第 2 稿（2026-11-23）：处理 Opus 计划审查的 25 条（[`evidences/plan-review-opus.txt`](evidences/plan-review-opus.txt)，处理见 Task README），加决定 7（有归属的会话不出行）。omp `@review` 审的是第 1 稿，报告回来另行处理。

## 1. Context

`nbook.tasks` 现在只列插件经 `start()` 登记的任务；Agent 的后台命令、子代理、插件工具登记的任务和在跑的会话只在对话里看得到。已接受的[提案“统一后台任务”](../../../../../docs/proposals/unified-background-tasks.md)第四节第 2、3 小节与 [ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md) 定了方向：清单只汇总、状态归提供方。本 Task 把 `nbook.tasks` 改成能收提供方的行，Agent 作第一个提供方，视图按归属分组；顺带做 t22 推来的子代理卡片终态。

依据：

- 开发者的决定：本 Task README 决定 1–7（第一批的行、按归属分组会话在前、状态栏与通知只管后台的一次性工作、形态与种类筛选后移、每个会话一块、会话组默认展开、有归属的会话不出行），以及计划第 1 稿确认的取舍（远程 v2、提供方的行不能移除、上限与“另有 N 件没列出”、停止的三种结果、状态栏件数不分范围、`tasksKey` 可选、范围开关是面板头的开关按钮）。
- 输入：两轮提案审查里归本 Task 的条目（[第一轮](../t22-background-work/evidences/proposal-review-r1.txt) 5、7、8、11、12、16、17、18、19、21、24、27、28；[第二轮](../t22-background-work/evidences/proposal-review-r2.txt) 11、12、13、14、15、17）；t22 推来的子代理卡片终态。
- 合同：[`workbench/background-tasks.md`](../../../../../docs/specs/workbench/background-tasks.md)（主体）、[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)。

工作方式：代码在 Work 分支 `feat/w00032-agent-integration` 的 worktree；草稿在 `.worktree/w00032-t42-drafts`。审查：远程合同、跨插件的提供方隔离、停止的语义、会话索引格式属于高风险后端，实现走快速审查（Opus 先审，omp `@review` 后台）；视图另派 Sonnet。

## 2. 技术选型

无新的通用问题：推送沿用 `nbook/shared/push-throttle` 的 `PushThrottle`，校验沿用 TypeBox 的 `Value`（同现有 `core.ts`），视图沿用 nb-ui 的零件。

## 3. 关键设计

### 3.1 提供方合同：`packages/neuro-book/src/plugins/tasks/shared/contracts.ts`

```ts
interface BackgroundTasks {
    start(input: TaskInput): TaskHandle;
    /** 每个调用方同一时刻一个；已有在用的时同步抛 TypeError。交回撤回函数：只第一次起作用，登记表关闭之后调用是空操作。门面释放时自动撤回。 */
    provide(provider: TaskProvider): () => void;
}
interface TaskInput { /* 现有字段 */ readonly owner?: OwnTaskOwner }   // 缺省应用；不合格同步抛 TypeError

type OwnTaskOwner = {kind: "app"} | {kind: "project"; project: string; title: Text} | {kind: "session"; session: string; title: Text};
type RowOwner = OwnTaskOwner | {kind: "session"; session: string; title: Text; open?: RowOpen};   // 只有提供方的行能带 open

interface TaskProvider {
    /** 同步、有界、不做 I/O：此刻的全部行。抛错时这一家按“出错”处理，不影响别家。 */
    rows(): readonly ProvidedRow[];
    /** 行有变化时调 notify；交回退订。 */
    subscribe(notify: () => void): () => void;
    /** 用户停一行。signal 在撤回、服务停止或清单不再等（10 秒）时 abort。 */
    stop(rowId: string, signal: AbortSignal): Promise<StopOutcome>;
}
type StopOutcome = {kind: "accepted"} | {kind: "rejected"; reason: Text} | {kind: "unknown"};

interface ProvidedRow {
    id: string;              // 这家里唯一，至多 200 个字符；会话的行带运行（见 3.5），换了运行就是另一行
    title: Text; message?: Text | null; progress?: number | null;
    state: "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "interrupted";
    kind: string;            // 小写字母开头，只含小写字母、数字与 -，至多 40 个字符；清单盖成 <提供方插件>.<kind>
    kindLabel: Text;
    form: "once";
    owner: RowOwner;
    head?: boolean;          // 根会话自己的运行：画成会话块的组头
    foreground?: boolean;    // 前台的行：状态栏不数
    startedAt: number; endedAt?: number | null;
    stoppable?: boolean;
    open?: RowOpen;
}
type RowOpen = {command: string; args?: Readonly<Record<string, string>>};   // 命令 id 以提供方插件 id 加 "." 开头；至多 4 个参数，值至多 200 个字符
```

不变量与理由：

- **同步投影**（第二轮第 13 条）：一次推送读各家，不等异步。
- **大小**（第一轮第 12 条、第二轮第 12 条；审查 F7）：一行编码后至多 2 KiB，一家至多 100 行，单家交满 200 KiB，加自己的任务与信封仍在 512 KiB 内；整份上的修剪只在几家同时交满时发生（3.3）。超出的行丢掉、记诊断 `provider-row-invalid`；一家超过 100 行时先留全部在跑与 `waiting` 的（含组头），结束的按结束时刻新到旧补满。
- **代次**（第二轮第 11 条）：每次 `provide` 生成新的代次；行在远程里的键是 `p:<插件>:<代次>:<行 id>`，派发时按清单**最新的已读快照**查键，代次不符或行已不在得 `row-gone`。
- **撤回与关闭**（第二轮第 13 条；审查 F4、F21）：撤回时先封住派发；这一家在途的 `stop` 立即以 `unknown` 交回窗口并 abort 它们的 `signal`，提供方之后的结果丢弃；再退订、丢行与回调、推送一次。`nbook.tasks` 自己停止（`core.close()`）时对每家照做一遍。交给提供方的 `notify` 闭包绑定代次，不是当前代次的调用无效。
- **`stop` 的上限**（审查 F4）：清单等提供方至多 10 秒（注入时钟），到点以 `unknown` 交回、abort `signal`。
- **`start()` 的归属**（审查 F15）：按行的同样规则校验，不合格同步抛 `TypeError`；自己的任务不能带 `open`，会话块的“打开”只来自提供方。

### 3.2 清单核心：`backend/core.ts`、新 `backend/providers.ts`

- `providers.ts`：登记表维护一份全局的已读快照与版本号（审查 F16）。`notify` 只标脏并触发 `rows` 一类的变化；任一 `rows` 订阅的合并器要数据时调 `registry.snapshot()`：有脏的家先清标记再读（读期间来的 `notify` 留到下一轮），版本加一；没有脏的直接交回快照。所以 N 个窗口一次变化只读一次。
- `rows()` 抛错：这一家行清空、记诊断 `provider-failed`（连续失败只记一次），下次 `notify` 再读。
- 变化信号只有一个（`background` 随提供方的行变，`own` 一类订阅也要听提供方）；不重推靠每个订阅按内容的指纹去重，编码只做一次。Agent 的后台命令每出一行都会 `notify`，`own` 只在自己的任务或 `background` 变了时才推。（第 1 片实现审查 Opus 6：原写的“拆两个信号”与 3.3 矛盾，按这里实现。）

### 3.3 远程合同 v2：`shared/contracts.ts`、`backend/remote.ts`

`nbook.tasks/tasks` 升到版本 2（旧窗口得 `version-changed`）。方法与事件不能同名（`nb-runtime/remote/contract.ts`；审查 F19）：

- `own` 读、`ownChanged` 事件（无过滤）：`{tasks, background}`。`tasks` 是自己的全部任务（v1 的清单每项加 `owner`），规则同 v1，整份超 512 KiB 时跳过推送、读得 `too-large`。`background` 是不分范围的在跑后台一次性工作（自己在跑的任务加提供方不是前台的在跑行）的件数与前 20 件的标题、进展与进度：状态栏只订这一份（审查 F8）。`background` 随提供方的行变，所以 `ownChanged` 也听提供方的变化，但只在 `background` 变了时才重推。
- `rows` 读、`rowsChanged` 事件（过滤 `{project, all}`：窗口的当前项目与是否取全部项目；取全部时当前项目仍排在前面）：`{version, groups, more, elsewhere}`。先按范围过滤，再分组（3.4）；`more` 是范围内因上限没列出的件数；`elsewhere` 是范围外在跑的件数（审查 F25）。同一版本不重推。整份编码后超过 512 KiB 时依次删：提供方结束的行（最早结束的先）、自己结束但不是失败的任务（最早结束的先）、不是组头的在跑行（最早开始的先）、组头；自己失败的任务不删（审查 F7、F8）。
- 自己任务的 `detail`、`cancel`、`retry`、`remove`、`clearFinished` 不变；新 `stop({key})` 写，结果 `{outcome: "accepted" | "rejected" | "unknown", reason?}`，失败码 `row-gone`、`not-stoppable`。`unknown` 不自动重试。
- 推送：每个订阅一个 `PushThrottle`，`compute` 调 `registry.snapshot()` 与核心，按内容去重。

### 3.4 分组：`backend/groups.ts`

纯函数 `groupRows(own, provided, scope)`：

- 范围：`{project}` 时留应用、这个项目与全部会话的行；`"all"` 时全部。
- 会话块：同一个根会话的行一块。组头取这块里的 `head` 行；没有时取块里提供方的行的 `owner`（标题与 `open`），只写标题、带“打开”、没有“停止”；只有自己的任务时用它的 `owner.title`、没有“打开”（审查 F15）。块里任何一行是 `waiting` 就算等你处理（审查 F12）。
- 顺序（审查 F17）：等你处理的块在前，其余按组头行的开始时刻、没有组头时按块里最早开始的一行，新的在前——起后台任务不让块跳位置。项目组：当前项目在前，其余的顺序由窗口按翻译后的标题排（服务端不排 `Text`）；应用组最后。组内在跑与等你处理的在上、结束的在下，各按新到旧。

### 3.5 Agent 作提供方：新 `agent/backend/task-rows.ts`

Agent 有 `tasksKey` 时在激活里 `provide`，没有就不交（“在跑的工作”仍由 Agent 自己报，sessions.md 输出 20，不改）。`nbook.tasks` 停了又起时 Agent 不会重新登记，记已知限制（审查 F21）。

**探针先行**（ADR 0056 后果第 1 条；审查 F23）：第 3 片开工时先用真实的 `SessionTable` 与 `JobCenter`（脚本模型）跑探针，记下：收口后排着的话开下一次运行时活动列表与变化事件的序列、`runId` 与开始时刻何时换；从清单停会话后缓冲区与活动的状态；前台子代理等审批时父子两层的状态；预算满走短回执时任务的出口。结果存 `evidences/probe-session-rows.txt`，按它核对 sessions.md 输出 30 与 jobs.md 输出 20 的 planned 句子，不符就先改 Spec 再写代码。

**套件**（审查 F1、F3、F24）：`SessionTable` 的表项另记当前运行的 `runId`、开始时刻（第一次在状态帧里看到这个 `runId` 时取表的时钟；打开句柄时已在跑的用打开时刻，已知限制）与等用户的事项种类（审批、提问），`activityWithBackground()` 交回 `{id, state: "running" | "waiting" | "held", runId?, startedAt?, pending?: "approval" | "question"}`；这几样变了也触发 `onActivityChanged`。现有用它的“在跑的工作”（`running-work.ts`）照旧只认 `running`、`waiting`。

**行**（决定 1、7；第一轮第 5、19 条，第二轮第 17 条；审查 F5、F6、F11、F12、F14）：

- 后台任务每件一行：在跑的，以及结束了、出口是“还没领”“正在送”“写入结果未知”的；出口是“提醒已受理”“只送了短回执”“已取走”的不列（永久送不到的走短回执，同样不列）。
  - 种类：`shell`（“命令”）、`agent`（“子代理”）、插件登记的一律 `plugin`、种类名用它登记时的 `label`。
  - 状态：`running` 的照 `running`；`question`（等父 Agent）照 `running`、进展写“在问：…”；子代理任务的子会话此刻在等你处理时 `waiting`，进展写“等你批准”或“等你回答”；结束的照终态。
  - 前台等着的（有前台调用在等它）标 `foreground`，不进状态栏；`attach` 也发变化。
  - 归属是启动它的会话的根会话；子代理的行可打开它的子会话。
- 根会话：在跑、等你处理或有留着的话的根会话出一行组头（`foreground`），行 id `session:<会话>:<运行>`。进展：等审批写“等你批准”，等提问写“等你回答”，有留着的话写“有留着的话等你放行”（不可停），其余“正在回复”。
- 子会话：在跑或等你处理、却没有一个在跑的子代理任务的 `target` 与它此刻的**会话与运行**都相同的，出一行“子会话”（`foreground`），行 id 同样带运行。
- 有归属的会话（会话树的根带 `owner`，bot 的主对话与它派的子会话）不出组头行与子会话行；它们起的后台任务照常出行，块的组头只有标题与“打开”（决定 7）。Agent 在内存里记有归属的根，`rows()` 同步判断。
- 程序自己开的会话（起标题与说明）不出行。
- 变化：订阅 `table.onActivityChanged`、`jobs.onChanged` 与标题的变化，都只调 `notify`。

**停止**（第一轮第 21 条，第二轮第 15、18 条；审查 F2、F13）：

- 后台任务：`jobs.kill(null, id)`（用户停：回执照送、不唤起）。`JobDriver.kill` 的结果扩成 `void | "already-ended" | "failed"`，子代理驱动 `abort` 交回失败时交回 `failed`（不再吞掉），`JobCenter.kill` 透传；远程 `killJob` 同受益。映射：`killed` → accepted；`already-ended`、`job-unknown` → rejected（“已经结束”“已经不在”）；`failed` 里 `not-allowed` → rejected（写码），其余与抛错 → unknown。
- 会话与子会话：从行 id 取出运行，以用户身份 `abort({keepQueue: true, runId})`；`{aborted: false}` → rejected（“已经结束”）。运行已换时窗口多半先得 `row-gone`（新快照里没有旧行），两者都不停下一次运行。停下之后排着的话变成用户留着的、要用户在对话里放行（`harness/runtime.md` 输出 30），会话行随之变成“有留着的话等你放行”。回退到运行中途、同一 `runId` 接着跑时，旧行的停止会停到接着跑的那次：已知限制（同第一轮第 10 条）。

**打开**（第一轮第 17 条，第二轮第 14 条；审查 F10）：会话、子会话、子代理行与会话块的组头走 `nbook.agent.focus-session {sessionId}`；命令行没有打开。`focus-session` 交回失败的判据限定为打开前就能确定的：视图或页面命令交回失败，或读会话头得 `session-not-found`、`log-corrupt`、`needs-migration`；之后读快照的失败仍画在视图里（已知边界）。编辑区页面把有归属的会话转给 `focus-session` 时等它的结果。

### 3.6 窗口：`tasks/web/`

- 两个仓库：`own`（订 `ownChanged`：看过、结束通知、详情、重试、移除，以及状态栏的 `background`）与 `rows`（订 `rowsChanged`，视图可见时才订，范围变了重订）。
- 状态栏（审查 F8）：件数与悬停看 `own.background`；“清单为空”是自己的任务为空且 `background` 件数为 0。
- 看过（审查 F8）：视图可见、页面在前台时，自己的已结束任务里“显示着的”算看过：在当前范围、在 `rows` 的分组里、所在组展开、没被修剪。`rows` 每次更新、组展开或收起时重算。切换范围不撤回通知。
- 视图：每个会话一块浅底的圆角块，等你处理的那块浅警示色底；块里组头是会话自己、其余行缩进；项目与应用的组头是小标题加件数；组头都有收起箭头，默认展开，按窗口记住（决定 5、6，草稿 `TaskGroupsDraft` 的 `blocks`）。行的列同现在，标题前多一个淡色的种类名；提供方的行只有“停止”“打开”。列表末尾：有没列出的写“另有 N 件没列出”；当前项目范围下别的项目有在跑的写“别的项目还有 N 件在跑”（审查 F25）。
- 停止：结果回来之前按钮写“正在停止”；`rejected` 弹提示写原因，`unknown` 提示“不知道停没停下，看一下它的状态”，`row-gone` 提示“它已经不在了”并以下一份推送为准。
- 范围开关：视图的标题动作（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 10）。新命令 `nbook.tasks.toggle-all-projects`（不对 Agent 开放）加按窗口的公开状态键，`toggled` 时按下是全部项目；按窗口记。
- 打开：执行行上的命令，失败时弹提示写原因。
- 结束通知只看 `own`（决定 3、第一轮第 24 条）。

### 3.7 子代理卡片的终态（t22 推来）：会话索引带回复首句

审查 F9：卡片取终态时 `tree.runs` 几乎总能先找到这次运行，第 1 稿的 `runOutcome` 排在它后面、轮不到；而且它要重新打开子会话、整份重放日志。改法：会话索引的 `runs` 每项加 `line?`（那次运行最后一条回复的首句，至多 200 个字符），内核在收口写索引时顺手算（`kernel/run/results.ts` 的取法），`tree.runs` 带着它，卡片在现有的第三步用它写“完成：首句”。不加远程方法，不为取数打开会话；旧索引没有 `line` 时照旧写“已完成”。改的是会话索引的格式（可选字段，旧索引照读、打开时按日志补上）。

## 4. Spec 与文档改动

- `workbench/background-tasks.md`：planned 改成第 2 稿：行与上限（2 KiB、100 行）、修剪顺序、撤回与关闭时在途的 `stop`、`stop` 的 10 秒上限、`own` 与 `rows` 的事件名与载荷（`background` 挪进 `own`、`elsewhere`）、看过的“显示着的”、会话块的组头来源与顺序、`start()` 的 `owner` 校验、新命令与“别的项目还有 N 件在跑”；非目标加“分页”；验收加 7–10（代次与迟到的点击、坏提供方隔离、停止的三种结果含驱动拒绝、切换范围不撤通知），Smoke 写明覆盖哪几条。
- `agent/jobs.md` 输出 20：出口的判据、状态映射、`foreground`、种类、停止的映射与驱动的 `failed`；输出 11 的 `killJob` 停不下时如实交回。
- `agent/sessions.md` 输出 30：组头与子会话行的判据（含留着的话、有归属的不出、覆盖按会话与运行）、进展的写法、行带运行、停止之后变成留着的话；删掉第 1 稿的输出 31（`runOutcome`）。
- `agent/conversation.md` 输出 33：终态的第三步用 `runs` 的首句；输出 53：`focus-session` 失败的判据。
- `agent/subagents.md` 输出 21：`runs` 每项加 `line?`。
- `harness/session.md` 输出 22：索引的 `runs` 加 `line?`。
- 提案：追加决策记录（不分页，上限加“另有 N 件没列出”，截掉的行没有入口；有归属的会话不出行）；Task README 范围改掉“分页”。

## 5. 切片

1. **提供方核心与远程 v2**（3.1–3.4）：`tasks/shared`、`tasks/backend`。验证：`tasks.test.ts` 加 describe“提供方”（真实入口，测试插件作提供方：登记与 `TypeError`、校验与上限、修剪顺序、出错隔离、撤回时在途的 `stop` 得 `unknown`、`stop` 10 秒上限、代次与迟到的键、`close()` 释放、`own` 不随提供方的行重推、分组与范围）；typecheck。
2. **窗口**（3.6）：仓库、视图、状态栏、范围开关命令。验证：`store.test.ts`、`TasksView.dom.test.ts`、`TasksHover` 的 dom 用例；`background-tasks.e2e.ts` 的测试插件同时作提供方（服务端）并贡献两个打开命令（一个必然失败），看两个窗口的分组、范围开关、停止与打开的提示。
3. **Agent 作提供方**（3.5）：先跑探针、核对 Spec；套件表项与 `activityWithBackground`；驱动的 `failed`；`focus-session`；`task-rows.ts`。验证：套件 `table` 用例；新 `task-rows.test.ts`（真实服务）；`jobs.test.ts`（`killJob` 停不下如实交回）；Agent 浏览器入口覆盖 `focus-session` 的测试。
4. **会话索引的首句与子代理卡片**（3.7）：内核写索引、`tree.runs`、卡片。验证：内核索引的用例、`subagents.test.ts`、`agent-subagents.e2e.ts`。

每片单独提交；第 1、3、4 片各开一次快速审查（Opus 先审，omp 后台），第 2 片派 Sonnet 审前端。

## 6. 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| background-tasks 输出 18–22、24 与验收 7–9 | `tasks.test.ts` describe“提供方” |
| background-tasks 输出 23 | `tasks.test.ts`：`own`、`rows` 的读与事件、`background`、`more`、`elsewhere`、修剪顺序、去重；`version-changed` 由远程层给 |
| background-tasks 输出 25、26 | `TasksView.dom.test.ts`；`background-tasks.e2e.ts` |
| background-tasks 输出 27、28 与验收 10 | `store.test.ts`、`TasksHover` 的 dom 用例 |
| background-tasks 输出 17 | `tasks.test.ts` 已有用例核对后晋升 |
| jobs.md 输出 20、输出 11 的停不下 | `task-rows.test.ts`（命令、插件登记的、前台的不进状态栏、短回执后不列、子代理等审批时 `waiting`、停止的映射含驱动拒绝）；`jobs.test.ts` |
| sessions.md 输出 30 | `task-rows.test.ts`（组头、留着的话、有归属的不出、覆盖按会话与运行、运行已换不停下一次）；套件 `table` 用例 |
| conversation 输出 33、subagents 输出 21、session.md 输出 22 的首句 | 内核索引用例、`subagents.test.ts`、`agent-subagents.e2e.ts` |
| conversation 输出 53 的失败交回 | Agent 浏览器入口覆盖 `focus-session` 的测试文件（开工时找） |

## 7. 验证

- 合同测试：`tasks.test.ts`（核心与远程，真实入口）、Agent 的集成用例（真实会话表与任务中心）、套件的 `table` 用例、内核的索引用例。
- 浏览器：`background-tasks.e2e.ts`、`agent-subagents.e2e.ts`。
- 未验证边界：服务与定时形态（没有提供方）；项目子进程登记（第一批不收）。

## 7a. omp 审查（第 1 稿）带来的补充

omp（`@review`）审第 1 稿 22 条（[`evidences/plan-review-omp.txt`](evidences/plan-review-omp.txt)），大半与 Opus 的重合、第 2 稿已改；另加：

- 第 1 片：几家交了同一个根会话的组头时只认最早登记的那家，记诊断（omp 17）；提供方在同一代里不复用已消失的行 id（omp 6，写进输出 19）；`rows` 的过滤带窗口的当前项目，取全部时当前项目仍在前（omp 12）。
- 第 2 片：“打开”在窗口按命令注册表核对命令确实是那家提供方贡献的，不只看前缀（omp 11）；范围每变一次有世代，迟到的读与订阅丢弃；“看过”只认当前世代 `rows` 里已经画成终态的自己的任务（omp 14）；窄屏两行、组的收起开关有名称与展开状态、按钮的 `aria-describedby`、悬停保留进展（omp 22）。
- 第 3 片：标题有初值与变化通知，压缩时进展写“正在压缩”（omp 3）；Agent 停止的第一步撤回提供方，门面释放兜底（omp 4）；任务中心的 `claim`、`unclaim` 发变化（omp 8）；不出 `starting` 的占位（omp 15）；组合验收：装与不装 `tasksKey`、手动压缩、后台根、只剩后代，“在跑的工作”不重报（omp 21）。
- 已知限制照旧：被截掉的行没有入口（omp 1，开发者已定不分页）；回退后同一 `runId` 接着跑（omp 6）；`focus-session` 打开之后的失败只画在视图里（omp 9）；`own` 超过上限时照 v1 跳过推送（omp 13）。

## 7b. 第 3 片开工前的探针带来的细化

探针结果与核对见 [`evidences/probe-session-rows.txt`](evidences/probe-session-rows.txt)，sessions.md 输出 30、jobs.md 输出 20 的句子都对得上；实现按下面三处细化：

- **任务中心另给清单一个变化信号**：`JobCenter.onListChanged(listener)`，凡是改变清单可见的东西都发：登记开始、结束、提问、进展、`attach`、`detach`、`claim`、`unclaim`、`announce`、`receiptTaken`、`receiptSettled`、移出。`claim`、`unclaim` 不发现有的 `onChanged`：送达订着它，每次都重排一轮，暂时送不了时 `unclaim` 再发就绕过退避连续重送。计划 7a 里“`claim`、`unclaim` 发变化”按这个信号实现。
- **有留着的话的行**：它没有在跑的运行，行 id 是 `session:<会话>:held`；开始时刻取会话表看到留着的话的时刻（打开句柄时就有的，取打开的时刻）。Spec 同改（sessions.md 输出 30）。
- **会话表交回的形状**：`activityWithBackground()` 交回 `{id, state: "running" | "waiting" | "held", runId?, startedAt?, pending?}`；`held` 只在空闲且有只有用户能放行的话时出现，后台会话也算；`runId`、`startedAt` 只在跑与等你时有，`pending` 只在等你时有。`onActivityChanged` 另在等你的事项种类变了时发（换运行一定先经过空闲，已经会发）。`running-work.ts` 跳过 `held`。
- 前台子代理等你批准时父会话算在跑：组头写“正在回复”，块里任务那一行是等你处理（“等你批准”），块按等你处理排在前面。

## 8. 不做与风险

- 不做：形态与种类的筛选（决定 4）；分页（被截掉的行没有入口，已知限制）；项目入口登记；提供方的行持久化。
- 已知限制：`nbook.tasks` 停了又起时 Agent 不重新登记；打开句柄时已在跑的会话的开始时刻取打开时刻；回退后同一 `runId` 接着跑时旧行的停止停到接着跑的那次；`focus-session` 打开之后的读快照失败只画在视图里。
- 风险：`foreground` 由提供方自报，状态栏口径靠提供方守约（Agent 按前台等待与会话行写死）。
