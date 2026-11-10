# t14 多 Agent：实施计划

## Context

t14 的设计在 2026-10-30 讨论定稿（[README](README.md) 第 1–33 条，两轮 omp 设计审查已处理），2026-11-09 开工：只做多 Agent，Workflow 在 t24；先定界面再前后端一起实施、一次合入；`shell` 的 `async` 也在本 Task（第 34、35 条）。界面经评审板四轮定稿（第 36–49 条，[`artifacts/review/`](artifacts/review/index.html)）。

要交付的是：主创能派子代理分头干活、等结果或转后台，子代理的审批与提问有去处，用户在界面上看得到、管得到。另带上别的 Task 留给 t14 的事：adhoc Profile 与主创提示词（t18 决定 8）、子代理费用并入上限与 `wait` 豁免重复检测（t27）、可派白名单的形状（t05 计划“给 t14、t15 留的”）。

依据：

- 内核：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 27（`yield` 与结果 schema）、39–43（交互通道、`resolve`、异步提问），[`harness/session.md`](../../../../../docs/specs/harness/session.md) 会话头的 `caller`、`questions`、`result`。这些在 t20 已实现，本 Task 只在内核加两处（见“内核”）。
- Agent 插件：[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md)、[`resources.md`](../../../../../docs/specs/agent/resources.md)、[`run-guards.md`](../../../../../docs/specs/agent/run-guards.md)、[`profile-settings.md`](../../../../../docs/specs/agent/profile-settings.md)、[`conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`builtin-profiles.md`](../../../../../docs/specs/agent/builtin-profiles.md)；对话视图 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。
- 调研：[各家的子代理设计](../../research/2026-10-30-subagent-survey.md)。

工作方式：主会话写代码，一个 worktree `.worktree/w00032-t14-multi-agent`、分支 `feat/w00032-t14-multi-agent`；按切片提交；切片 0 先写 Spec 草稿（`planned`），设计审查处理完再写代码；设计审查后端派 omp、前端派 Sonnet；实现审查同样分两份；验证、审查处理完直接合入。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 子会话 id 的确定性 | `node:crypto` 的 SHA-256 | 已在用；不引 uuid v5 之类的库 |
| 结构化结果的校验 | 内核 `yield` 现有的 schema 校验 | 不另做 |
| 后台命令 | 现有 `@oh-my-pi/pi-natives` 的 `executeShell` | `shell` 已用它；不另起子进程管理 |
| 任务中心 | 手写的内存表 | 进程内、不持久化（第 28 条），没有合适的库，也不需要 |

## 关键设计

### 内核（`packages/nb-harness/src/kernel`）

两处小改，都是加可选字段，旧日志照读：

1. **输入记下是谁发的。** `inputQueued` 加 `by?: Issuer`：`send`、`enqueue` 经 `as(issuer)` 发出时写发出者；用户发的不写（旧日志也没有，读作用户）。异步提问的回答经 `resolve` 进缓冲区时同样写回答者。对话视图凭它把父 Agent 发来的话标成父会话的 Profile 名（第 43 条）。
2. **索引带上调用方。** `SessionIndexEntry` 加 `caller?: {kind, id}`，从会话头抄；`list` 不开日志就能知道父子关系（会话面板嵌套、`sessions://` 根、算深度）。t14 之前没有子会话，旧索引不用重建。

`harness/runtime.md`、`harness/session.md` 各补一条；`api/events.ts`、`api/storage.ts`、`log/index-file.ts` 与对应测试。

### 任务中心（`agent/backend/jobs/`）

新目录，进程内的一张表（第 19、28、29 条）：

```ts
type JobKind = "agent" | "shell";
type JobState = "running" | "question" | "completed" | "failed" | "aborted" | "interrupted";
interface Job {
    readonly id: string;            // job-<8 位随机十六进制>：重启后序号会重来，日志里的旧 id 不能撞上新任务
    readonly kind: JobKind;
    readonly owner: string;         // 启动它的会话
    readonly startedAt: number;
    state: JobState;
    summary: string;                // 一行：子代理名或命令
    readonly settled: Promise<JobOutcome>;
    kill(): Promise<"killed" | "already-ended">;
}
class JobCenter {
    start(owner, kind, summary, run: (signal) => Promise<JobOutcome>, options: {foreground: boolean}): Job | {code: "concurrency-limit"};
    wait(owner, {ids?, timeoutMs?, signal, interrupt}): Promise<WaitOutcome>;
    kill(owner, id): Promise<KillOutcome>;      // 只管自己启动的，否则 job-unknown
    list(owner): readonly JobSummary[];
    forgetOwner(owner): void;                    // 父会话关闭：丢掉它的已结束任务
    stop(): Promise<void>;                       // 插件停止：全部 kill，记 interrupted
}
```

- 上限（第 27 条）：全局数所有在跑的任务（前台也算），每会话数它直接派出、在跑的子代理运行；检查在建子会话之前，超了整体拒绝。设置见“设置”。
- 寿命（第 28 条）：前台任务在工具返回结果时移出；`async` 任务结束后留到 `wait` 取过或父会话关闭（句柄表的 `closed` 回调）。
- `wait` 任一条件返回：某个任务结束、子代理有交给调用方的提问、`interrupt` 触发（父会话缓冲区来了插话，见下）、超时（返回 `running`，第 32 条）。
- 时钟用注入的 `Clock`，测试不真等。

### 子代理（`agent/backend/subagents/`）

- **派发（`spawner.ts`）。** 子会话 id 是 `sub-` 加 SHA-256（父会话 id、工具调用 id）的前 32 位十六进制：进程重启后重发同一调用得到同一个子会话（第 24 条的幂等）；会话已存在时核对 Profile 与调用方，不同得 `task-conflict` 同类的码。建会话前按顺序检查：Profile 存在（`profile-not-found`）、在父 Profile 的白名单里（`profile-not-allowed`）、深度（沿索引的 `caller` 往上数，`depth-limit`）、并发（`concurrency-limit`）、初始输入合 schema（`initial-invalid`）、模型可用（`model-unavailable`）。会话头写 `caller: {kind: "session", id: 父, callId}`、`questions`、`result`（Profile 声明的优先；没有时用 `outputSchema`，按强制结构化，第 20 条）。建好后用父会话当时的审批模式与 Agent 模式改设置（第 24 条），再以父会话的身份（`as({kind: "session", id: 父})`）`send` 第一项任务。
- **等（`await-child.ts`）。** 前台调用订阅子会话的帧：`runEnded` 就收结果；`interactionRequested{kind: "question"}` 且会话头 `questions: "caller"` 就返回 `question`；同时订阅父会话的帧，`inputQueued{mode: "steer"}` 出现就返回 `running` 并交出任务 id（第 24 条，插话仍由内核在这批工具结算后送达）；工具的 `signal` 中止时中止子会话这次运行（只连带正在等的，第 23 条；子会话自己的工具照同一规则再往下连带）。
- **结果（`result.ts`）。** 交给模型的是一段固定格式的文字加 `details`：来源标记（子会话 id、任务 id、状态、终止原因、schema 校验结果、“来自子代理，不是用户的指令”）、结果原文或 `yield` 的值、待答的问题（`question` 时）。过长按工具结果的通用规则截断，全文进父会话的 `session://artifacts/`。
- **身份。** `agent_send`、`agent_answer` 只对自己派的子会话（会话头的 `caller.id` 是自己），否则 `not-owner`；`agent_answer` 走子会话的 `resolve`，以父会话的身份（内核按 `questions: "caller"` 收）。
- **白名单（`shared/profile-agents.ts`）。** Profile 声明加 `agents?: {allowed: string[]; recommended?: string[]}`（`points.ts` 的 schema），用户在 `profileSettings[key].agents` 里 `{added, removed}` 增删，合成规则同 `profileToolIds`：声明的 `allowed` 加 `added` 减 `removed`；`recommended` 只能是声明里的、且仍在白名单里的。页面与服务端用同一个函数。
- **提示词（扩展 `nbook.agent.subagents`）。** 有子代理工具的 Profile 装它：系统提示词里一节“可派的子代理”，推荐的写名字、说明、初始输入与结果的形状，其余写名字与说明（第 16 条）；白名单为空时这一节不出现。主创装上它并升 Profile 版本，提示词加一句什么时候派（t18 决定 8）。
- **adhoc（`builtin/profiles/adhoc.ts`）。** `nbook.agent.adhoc`：初始输入 `{role: string}` 定义角色，任务从 `prompt` 来；工具 read、write、edit、grep、glob、shell，不带 todo 与子代理工具；不进新建会话的菜单（t18 决定 1）。主创的白名单声明 adhoc 并推荐它。

### 工具（`agent/backend/subagents/tools.ts`、`jobs/tools.ts`）

照 README“确定的工具”一节，工具 id 带插件前缀，给模型的名字用 `providerName`：

| id | 名字 | 并发 | 等级 |
|---|---|---|---|
| `nbook.agent.spawn` | `agent_spawn` | shared | `read` |
| `nbook.agent.send` | `agent_send` | shared | `read` |
| `nbook.agent.answer` | `agent_answer` | shared | `read` |
| `nbook.agent.wait` | `wait` | shared | `read` |
| `nbook.agent.kill` | `kill` | exclusive | `read` |
| `nbook.agent.jobs` | `jobs` | shared | `read` |

等级都是 `read`：派发本身不改任何东西，子会话里的每个调用照常过它自己的审批（继承父会话的审批模式与 Agent 模式，第 24 条），`discuss`、`plan` 下派出的子代理同样写不了。三个子代理工具的副作用（建会话、放话、应答）在 `execute` 的同步段按调用顺序交给目标会话（第 25 条），之后才等。失败码表在 Spec 里定全，至少有 README 第 24 条列的那些。说明文字照 t14 实测的草稿（[`experiments/tool-descriptions.py`](experiments/tool-descriptions.py)）。

### 已有工具的改动

- **`shell` 的 `async`（第 35 条）。** 带 `async: true` 时登记一个 `shell` 任务就返回任务 id；命令照常跑，输出边跑边追加到 `sessions://<会话>/home/jobs/<任务 id>/output.log`（宿主写，Agent 只读，同 `artifacts/`）；结束时任务结果是退出码、行数、开头与结尾。超时照 `timeout`。`kill` 与插件停止时取消命令；进程重启后任务表为空，没写完的输出文件留着。`async` 的调用仍要过审批（等级不变）。
- **`ask` 的 `async`（第 18、30 条）。** 带 `async: true` 时用 `ctx.ask(…, {async: true})`，工具立即返回“问题已提出，回答会作为一条输入送来”。
- **`loop-guard`。** `wait` 不计重复调用（t27 留下的事）。
- **`cost-guard`。** 累计按整棵会话树算：自己的 `ctx.spend` 加上所有后代的累计（从任务中心与子会话快照取，子会话运行结束与每次回复时更新缓存）；告警与上限照旧只在发请求前判断。

### 资源地址（`backend/schemes.ts`）

- `sessions://` 的根：先列与本会话有关的会话（父、子、兄弟，带状态），再按最近使用；仍不列后台会话。
- `profiles://` 的根：每项多一列“可派”或“不可派”（按读它的会话的 Profile 的白名单）。

### 设置（`shared/settings.ts`）

可靠性分区（`nbook.agent.reliability`）加三项，界面由表单自动生成：`subagentDepth`（缺省 3，1–5）、`subagentsPerSession`（缺省 8，1–16）、`backgroundJobs`（全局，缺省 16，1–32）。

### 远程合同（`shared/remote.ts`、`backend/remote.ts`）

- `list` 的条目带 `parent?`（会话面板嵌套）。
- 新查询 `tree({sessionId})` 与事件 `treeChanged`（过滤 `{sessionId}`）：这个会话的后代，每个一项 `{id, parent, name, profileIcon, state, step?, tools, startedAt, endedAt?, line, pending: [{id, kind, callId, request}]}`。`step` 是最近一次工具调用的名字与参数（界面按注册表的摘要画成“正在读取 …”）；`line` 是结束后的结果第一句。服务端订阅在跑的后代、合并之后最多每秒推 4 次；先订阅后取，`onResync` 重取。卡片的进度、父会话向导里后代的审批、会话面板的状态都从这里来。
- `resolve` 已经带 `sessionId`：父会话向导里批子会话的审批，直接发给子会话。
- 新查询 `jobs({sessionId})` 与事件 `jobsChanged`：这个会话启动的任务（两种），每个 `{id, kind, state, summary, startedAt, endedAt?, lastLine?, exitCode?, lines?}`；`jobTail({sessionId, jobId, lines})` 读后台命令输出的最后若干行（展开卡片时取，运行中随 `jobsChanged` 重取）；`killJob({sessionId, jobId})` 是卡片上的“停止”，以用户的身份，不受“只管自己启动的”限制（那条管的是 Agent）。

### 对话视图（`packages/nb-agent-ui`）

纯受控视图加几个可选字段，宿主不给就是现在的样子：

- `UserMessageView.author?: {label: Text; icon: string}`：父 Agent 发来的话标父会话的 Profile 名（第 43 条）。
- `ctx.session.path?: {id, title, icon}[]`：顶栏画成路径，前面的段点了发 `session.select`（第 43 条）。
- 审批的 `PendingInputView` 加 `source?: {sessionId, name, icon}`：向导标题写“子代理「名字」要……”，图标换成子代理的，标题行加打开子会话的按钮（第 42 条）。提交时动作带上 `sessionId`，宿主发给对应的会话。
- 异步提问（第 44、48 条）：与 `ask` 同一条通道、同一个界面。提问的 `PendingInputView` 加 `async?: true`；视图用同一个提问向导（多题、单选多选、“其它”、nb-form 表单）画在输入框上方，不替换输入框，几个时“1 / 2”翻看；能收起成一条（收起状态由宿主持有，同向导）；提交仍是 `input.submit`，宿主走 `resolve`。同时有要停下等的审批或提问时，同步的照旧替换输入框，异步的收成一条停在它上面。停靠面的阴影与圆角照 nb-ui design-language“停靠的面不用浮层的阴影档”，与向导收起的小条共用一个类。
- 会话面板（第 47 条）：`AgentSessionListItem` 加 `parentId?`，列表按它嵌套：父会话第二行右边“N 个子代理”是折叠开关，左边不留空槽；子会话每个一行（名字、正在做什么、状态），挂在父会话标题下面；收起时有子代理等你处理，父会话行写出来。展开状态由列表组件持有，缺省收起；宿主给 `expandFor?: string[]` 让搜索命中的子会话展开父会话。

### Agent 插件的浏览器端（`agent/web/`）

- **卡片。** 注册表加三项（宿主登记，同 Lab 的领域工具）：`agent_spawn`、`agent_send`、`agent_answer` 画子代理卡片（第 40、41 条：卡头名字与状态、一行进度、打开子会话；高度固定，结果点开后限高滚动）；`shell` 带 `async` 的画后台命令卡片（第 46 条：卡头命令、任务号与用时、停止，第二行最后一行输出或退出码与输出文件；点开看输出的最后若干行，限高滚动，第 49 条）；`wait`、`kill`、`jobs` 是一行。进度只改那一行的文字，不引起别处重排。卡片的数据放在 `ctx.extensions["nbook.agent"]`（视图现成的“按插件 id 分区的数据，供插件登记的渲染器读取”），由宿主从 `tree`、`jobs` 合成；`nb-agent-ui` 不认识它的形状。
- **向导。** 宿主把 `tree` 里后代的待批审批并进当前会话的向导，排在自己的审批之后，带 `source`。
- **切到子会话。** 卡片与向导的“打开子会话”在当前位置切过去；顶栏路径来自会话头的 `caller` 链。
- **会话面板。** 用 `list` 的 `parent` 嵌套，默认收起；搜索命中子会话时展开父会话（第 38 条）。
- **Profile 设置页。** 工具一节下面加“可派的子代理”一节（第 46 条：同工具一节的样子，标“推荐”与“我加的”，“添加”用同样的对话框，“恢复默认”），写入走 `createSettingWriter` 的 `edit`，与工具绑定同一套。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| 新 `docs/specs/agent/subagents.md`（planned） | 子代理：三个工具、白名单与披露、会话关系与身份、审批与提问的去处、中止连带、上限、幂等、结果格式、失败码、`tree` 远程、adhoc 的派发 |
| 新 `docs/specs/agent/jobs.md`（planned） | 任务中心：`wait`、`kill`、`jobs`，`shell` 的 `async` 与输出文件，寿命、归属、上限；通知与自动转后台写进“不承诺”（t22） |
| `harness/runtime.md`、`harness/session.md` | `inputQueued.by`、索引的 `caller` |
| `agent/contributions.md` | Profile 声明的 `agents` |
| `agent/builtin-tools.md` | `ask` 的 `async`；`shell` 的 `async` 链到 `jobs.md` |
| `agent/resources.md` | 两个根的列法、`home/jobs/` 只读 |
| `agent/run-guards.md` | 费用按会话树算、`wait` 豁免；去掉“子代理的费用不并入” |
| `agent/sessions.md` | `list` 的 `parent`、`tree` 与 `treeChanged`；不承诺里去掉子会话相关的 |
| `agent/profile-settings.md` | “可派的子代理”一节 |
| `agent/builtin-profiles.md` | adhoc；主创装 `nbook.agent.subagents` |
| `agent/conversation.md` | 卡片、向导里的后代审批、子会话顶栏与作者、会话面板嵌套、异步提问；去掉不承诺里的“子代理的卡片”“异步提问” |
| `ui/agent-conversation-view.md` | `author`、`path`、`source` 与第 3 轮定的部分 |

## 切片

| # | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| 0 | Spec 草稿（上表），交设计审查 | 全部 | `bun run docs:check` |
| 1 | 内核两处 | 内核 | nb-harness 的受影响测试 |
| 2 | 白名单、adhoc、设置三项、提示词扩展 | 子代理的白名单、提示词、adhoc；设置 | agent 插件测试 |
| 3 | 任务中心与 `wait`、`kill`、`jobs` | 任务中心 | 同上 |
| 4 | 三个子代理工具（前台与 `async`）、中止连带、结果、身份 | 子代理、工具 | 同上，加真实内核的多会话测试 |
| 5 | `shell`、`ask` 的 `async`，`loop-guard`、`cost-guard`，资源地址的根 | 已有工具、资源地址 | 同上 |
| 6 | 远程：`list` 的 `parent`、`tree` | 远程合同 | 远程合同测试 |
| 7 | 对话视图的可选字段与第 3 轮的部分 | 对话视图 | nb-agent-ui 的 DOM 测试，Lab 场景 |
| 8 | Agent 浏览器端：卡片、向导、切换、面板、设置页 | Agent 插件的浏览器端 | agent web 的 DOM 测试，Lab 场景 |
| 9 | e2e、Spec 证据 | — | 受影响的 e2e |

每片单独提交；4 与 8 最大，内部可以再拆提交。实现审查在 9 之后一次（前后端分开派）。

## 验收场景

单条行为由 Spec 的输出条目验收，这里只列组合场景，Spec 写好后换成编号：

1. 主创派两个 adhoc（同一条回复）：两个子会话并发跑，父会话在等；一个完成一个出错，父 Agent 收到两份带来源标记的结果；卡片各自显示进度、结束后一行结果。
2. 子会话要审批：父会话的向导里出现，标题写来源；在父会话批了，子会话继续；在子会话里批也行，另一边跟着消失。
3. 子会话向调用方提问：父 Agent 的 `agent_spawn` 返回 `question`，`agent_answer` 回答后继续等到完成。
4. 用户在父会话插话：正在等子会话的调用返回任务 id，插话送达，父 Agent 之后用 `wait` 取结果。
5. 父会话中止：正在等的子会话运行一起中止；`async` 派出的照常跑，`kill` 才停。
6. 上限：第 9 个子代理得 `concurrency-limit`、第 4 层得 `depth-limit`，都不留下子会话。
7. 进程重启：在跑的子会话按“已中断”收口；重发同一个工具调用得到同一个子会话。
8. `shell` 带 `async`：任务 id 立即返回，输出文件边跑边写，`wait` 取到退出码；`kill` 停掉。
9. 白名单：设置页去掉 adhoc，主创的提示词里不再有它，`agent_spawn` 派它得 `profile-not-allowed`。
10. 费用：子代理的费用算进父会话树的上限，到上限时子会话与父会话都不再发请求。

## 验证

- 单元与合同测试用真实内核与真实的会话存储（临时目录），模型用内核测试支持里的脚本化模型（`kernel/testing/model.ts`），多会话时按会话分脚本；不用 mock。
- DOM 测试覆盖视图字段与 Agent 浏览器端；Lab 场景覆盖卡片、向导来源、顶栏路径、面板嵌套、设置一节。
- e2e：新增 `agent-subagents.e2e.ts`（真实浏览器、真实服务端、本机假端点）跑场景 1、2、4；再跑受影响的 `agent-conversation`、`agent-profiles`、`settings`。
- 未验证边界：真实模型下主创会不会恰当地派子代理（提示词效果），本 Task 不评测（t18 决定 5）。

## 不做与风险

- 不做：结束通知与空闲时唤起 Agent、跑久了自动转后台、活动面板（t22）；查会话全部历史的工具（t23）；Workflow（t24）；子代理继承父会话的上下文（fork 式派发）。
- 风险：`tree` 订阅所有在跑的后代，派得多时服务端的订阅数与推送量上升，靠合并与限频兜住，上限本身也限住了数量；子会话与父会话同时写同一文件靠文件服务的条件写入，`shell` 没有这层保护（第 26 条，t12 已接受）。
