# t14 多 Agent：实施计划

## Context

t14 的设计在 2026-10-30 讨论定稿（[README](README.md) 第 1–33 条，两轮 omp 设计审查已处理），2026-11-09 开工：只做多 Agent，Workflow 在 t24；先定界面再前后端一起实施、一次合入；`shell` 的 `async` 也在本 Task（第 34、35 条）。界面经评审板四轮定稿（第 36–49 条，[`artifacts/review/`](artifacts/review/index.html)）。开发者 2026-11-10 确认计划初稿；设计审查（后端 Opus 22 条、前端 Sonnet 24 条，[`evidences/`](evidences/)）之后开发者又定了第 50–52 条，本稿按审查与这三条修订。

要交付的是：主创能派子代理分头干活、等结果或转后台，子代理的审批与提问有去处，用户在界面上看得到、管得到。另带上别的 Task 留给 t14 的事：adhoc Profile 与主创提示词（t18 决定 8）、子代理费用并入上限与 `wait` 豁免重复检测（t27）、可派白名单的形状（t05 计划“给 t14、t15 留的”）。

依据：内核 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)、[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)；Agent 插件 `docs/specs/agent/` 下的 `subagents.md`、`jobs.md`（本 Task 新建）与 `sessions.md`、`contributions.md`、`builtin-tools.md`、`resources.md`、`run-guards.md`、`profile-settings.md`、`conversation.md`、`builtin-profiles.md`、`modes.md`；对话视图 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)；调研 [各家的子代理设计](../../research/2026-10-30-subagent-survey.md)。

工作方式：主会话写代码，worktree `.worktree/w00032-t14-multi-agent`、分支 `feat/w00032-t14-multi-agent`；按切片提交；切片 0 的 Spec 草稿经设计审查定稿后再写代码；本会话的审查后端与计划派 Claude Opus、前端派 Sonnet（开发者 2026-11-10：不开 omp）；验证、审查处理完直接合入。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 子会话 id、任务 id | `node:crypto` 的 `randomUUID` | 已在用；确定性 id 由第 51 条否决 |
| 结构化结果的校验 | 内核 `yield` 现有的 schema 校验 | 不另做 |
| 后台命令 | 现有 `@oh-my-pi/pi-natives` 的 `executeShell` | `shell` 已用它 |
| 任务中心 | 手写的内存表 | 进程内、不持久化（第 28 条） |

## 关键设计

### 内核（`packages/nb-harness/src/kernel`）

四处，都是可选字段或新增的保证，旧日志照读：

1. **输入记下是谁发的。** `inputQueued` 与路径上的 `input`、`steer` 都加 `by?: Issuer`；`send`、`enqueue` 经 `as(issuer)` 以会话身份发出时写，用户发的不写。异步提问的回答进缓冲区时写回答者。路径事件带上它，重载后适配器照样分得出（前端审查第 10 条）。`by` 不进给模型的请求。
2. **索引带调用方与花费。** `SessionIndexEntry` 加 `caller?: {kind, id, callId}`（照抄会话头）与 `spend?: {cost, unpriced}`（随 `assistant`、`modelEnded` 累加，同 `ctx.spend` 的口径）；旧索引没有这两项时读作没有调用方、花费 0，打开会话时按日志补。用途：会话面板嵌套、`sessions://` 根、深度、费用按树算，都不用打开后代会话。
3. **拦截上下文带会话。** `InterceptCtx` 加 `session: ToolSessionContext`（与 `ReactCtx` 同一份），费用上限在模型拦截里要知道是哪棵树（后端审查第 5 条）。
4. **同一段 `shared` 调用按调用顺序进入实现。** 现在只保证按顺序启动，进入工具实现的 `execute` 的先后由各自的拦截、审批重判、建实现的 I/O 决定。改为：第 i+1 个调用在第 i 个进入 `execute` 之后才进入（只串进入，不串执行）。子代理工具的“对同一子会话按调用顺序生效”与上限的预占靠它（后端审查第 6 条）。

各补 `runtime.md`、`session.md`、`extensions.md` 一条与测试。

### 任务中心（`agent/backend/jobs/`）

进程内的一张表。**一个任务就是一次子代理运行（子会话的一个 `runId`）或一条后台命令。**

```ts
type JobState = "starting" | "running" | "question" | "completed" | "failed" | "aborted" | "interrupted";
interface Job {
    readonly id: string;               // job-<uuid 前 12 位>：只在本进程内有效
    readonly kind: "agent" | "shell";
    readonly owner: string;            // 启动它的会话
    readonly target?: {sessionId: string; runId: string};   // agent
    foreground: boolean;               // 有工具调用正在前台等它
    state: JobState;
    fetched: boolean;                  // wait 取过它的结束结果
}
```

- **预占。** 子代理工具与 `shell{async}` 在 `execute` 的同步段（任何 await 之前）调 `reserve(owner, kind)`：同时检查每会话上限（只数 `agent`）与全局上限，过了就登记一个 `starting` 的任务，超了立即 `concurrency-limit{scope}`。之后的异步检查失败就撤销（`starting` 的任务不出现在 `jobs` 与远程里）。
- **前台与后台。** 前台调用以 `question`、插话、超时返回时任务转为后台（`foreground = false`），留在任务中心，之后 `wait`、`kill` 都认。前台调用以终态返回时任务移出。
- **寿命（后端审查第 8 条）。** 后台任务结束后留到 `wait` 取过；每个 owner 至多留 32 个结束了没取过的，多了丢最早的；不随句柄回收丢掉。插件停止时整张表丢掉。
- **`wait`。** 不给 `jobs` 时只看后台任务（前台的由它自己的调用交回，后端审查第 11 条），点名前台任务得 `job-foreground`。先订阅再查现状：已结束未取过的、状态为 `question` 的立即返回。超时缺省 1800 秒、至多 1800 秒（第 52 条）。被中止时只结束等待，不连带它等的任务。
- **停止（后端审查第 7 条）。** `stop()` 只取消 `shell` 任务；`agent` 任务由句柄表关闭子会话时按 `interrupted` 收口，任务中心在那之后记 `interrupted`。先后写在 `agent.ts` 的 `stop` 里：关门 → 停 Profile 监听 → 取消后台命令 → 句柄表按 `interrupted` 关会话 → 丢掉任务表。
- 时钟用注入的 `Clock`。

### 子代理（`agent/backend/subagents/`）

- **会话关系表（`relations.ts`）。** 内存里的父子表：启动时扫一次索引（`caller`），之后由派发与 `fork` 增量更新。深度、`tree`、`sessions://` 根、会话面板都查它，不再逐次扫全部索引（后端审查第 10 条）。
- **派发（`spawner.ts`）。** `execute` 同步段：校验参数、读白名单（设置是同步读的）、校验 `initial` 与 `outputSchema` 冲突、按关系表算深度，然后预占名额。异步段：解析 Profile 与模型；父会话不在 `normal` 模式而子 Profile 没装 `nbook.agent.modes` 时得 `mode-unsupported`（后端审查第 1 条，adhoc 装上它）；建子会话（随机 id，会话头 `caller {kind, id, callId}`、`questions`、`result`）；分组改设置（审批模式与只读一次，Agent 模式一次，各自校验）；改设置失败时派发失败、子会话留着但不 `send`，结果里带它的 id；以父会话身份 `send` `prompt`，记下 `runId` 填进任务。
- **对同一子会话按调用顺序（第 25 条）。** 每个子会话一条 promise 链，在 `execute` 的同步段挂上（内核第 4 条保证同步段按调用顺序进入），`send`、`enqueue`、`resolve` 依次在链上发。
- **等（`await-child.ts`，后端审查第 3 条）。** 用 `subscribeOpened`（接上之后才返回）订阅子会话与父会话，再查现状：子会话的运行用内核的 `waitRun(runId)`（已结束的从日志取结果）；子会话当前路径上已有交给调用方的同步提问就立即返回 `question`；父会话快照的缓冲区里已有 steer 就立即返回 `running`。之后任一条件成立就返回：运行结束、交给调用方的同步提问、父会话来了 steer、超时（缺省 1800 秒、至多 7200 秒，第 52 条）。子会话的异步提问不结束等待、不改任务状态，作为附加信息随结果交回（后端审查第 12 条）。
- **中止（后端审查第 7 条）。** 父会话中止：工具立即以 `aborted` 返回（带子会话 id 与任务 id），同时对子会话发 `abort`，不等它收口；任务在子会话收口后移出。信号原因是进程收尾（`interrupting(signal)`）时不发 `abort`，交给句柄表按 `interrupted` 关闭。
- **续用。** `agent_send` 让空闲的子会话开新运行时登记新任务；插进在跑的运行时关联这次运行的任务（用户在子会话里开的运行没有任务时登记一个归调用方的）；`queue: true` 立即以 `running` 返回。不带 `message` 的“继续”只对上一次运行不是正常完成的子会话有效，正常完成后得内核的 `nothing-to-continue`。`agent_answer` 应答同步提问时续用原任务；应答异步提问让空闲的子会话开新运行时登记新任务。都先查上限再动子会话。
- **结果（`result.ts`）。** 来源标记、状态与终止原因、结果、附带的提问；`details` 里有 `sessionId`、`jobId`、`runId`、状态、结果第一句，界面卡片的终态以它为准（前端审查第 15 条）。过长截断，全文进父会话的 `session://artifacts/`。
- **失败码（后端审查第 9 条）。** Spec 按工具分节列全：本插件的码，加原样交回的内核码（`send`、`enqueue`、`start`、`resolve` 的那些）。`agent_answer` 对审批事项得 `not-allowed`，文字写明审批只能由用户批。`concurrency-limit` 带 `scope: "session" | "global"`，全局满时文字提示自己做或稍后再试，不提示 `wait`（后端审查第 18 条）。
- **白名单（`shared/profile-agents.ts`）。** Profile 声明 `agents?: {allowed, recommended?}`，用户 `profileSettings[key].agents: {added, removed}`；合成同 `profileToolIds`，页面与服务端共用。
- **提示词（扩展 `nbook.agent.subagents`）。** 有 `agent_spawn` 且白名单不空时，系统提示词里一节“可派的子代理”；主创装上并升版本（t18 决定 8）。
- **adhoc（`builtin/profiles/adhoc.ts`）。** `nbook.agent.adhoc`：初始输入 `{role}`；工具 read、write、edit、grep、glob、shell；装 `nbook.agent.modes`；不进新建会话的菜单。主创的白名单声明并推荐它。
- **fork（后端审查第 13 条）。** 照内核：fork 子会话得到的仍是同一个父会话的子会话；fork 父会话得到的新会话不拥有原来的子会话。写进 Spec 与验收。

### 工具

| id | 名字 | 并发 | 等级 | 参数 |
|---|---|---|---|---|
| `nbook.agent.spawn` | `agent_spawn` | shared | `read` | `profile`、`prompt`、`name?`、`initial?`、`model?`、`effort?`、`questions?`、`outputSchema?`、`async?`、`timeout?` |
| `nbook.agent.send` | `agent_send` | shared | `read` | `id`、`message?`、`queue?`、`async?`、`timeout?` |
| `nbook.agent.answer` | `agent_answer` | shared | `read` | `id`、`question`、`answer`、`async?`、`timeout?` |
| `nbook.agent.wait` | `wait` | shared | `read` | `jobs?`、`timeout?` |
| `nbook.agent.kill` | `kill` | exclusive | `read` | `job` |
| `nbook.agent.jobs` | `jobs` | shared | `read` | 无 |

派发本身不审批（开发者确认）；子会话里每个调用照常审批，模式按上文继承。说明文字照 t14 实测的草稿。

### 已有工具与扩展

- **`shell` 的 `async`（后端审查第 16 条）。** 登记任务即返回任务 id 与输出地址 `sessions://<会话>/home/jobs/<任务 id>/output.log`；命令用任务自己的中止信号（不用调用的 `signal`），父会话中止不影响它；`async` 时不写 `timeout` 就不设超时，写了照用（至多 3600 秒）；输出文件上限 64 MiB，到了不再追加并在结果里注明，最后一行仍随时更新；结束时同目录写 `status.json`（退出码、行数、结束时刻、是否截断），重启后卡片与 `jobTail` 照样读得到终态。`home/jobs/` 由宿主写、Agent 只读。
- **`ask` 的 `async`。** 立即返回“问题已提出，回答会作为一条输入送来”。
- **`loop-guard`。** `wait` 不计重复调用。
- **`cost-guard`（后端审查第 5 条）。** 比的是整棵树（根会话与全部后代）的累计。插件维护按根会话 id 的内存表：启动与打开会话时从索引的 `spend` 汇总，之后每个会话的 `assistant`、`modelEnded` 反应把增量加上去；模型拦截用 `ctx.session` 找到根。告警仍按会话记“已告警到的线”（每个会话看到的是树的累计，过线时各写一次）；不承诺里写明软上限的超出量至多是同时在途的请求数。

### 资源地址（`backend/schemes.ts`）

- `sessions://` 的根：先列有关的会话（父、子、兄弟，带状态），子会话标出派它的调用 id；再按最近使用。状态从句柄表的 `activity()` 与任务中心取，不打开会话。
- `profiles://` 的根：每项标“可派”或“不可派”。

### 设置（`shared/settings.ts`）

可靠性分区加 `nbook.agent/subagentDepth`（3，1–5）、`subagentsPerSession`（8，1–16）、`backgroundJobs`（16，1–32）。

### 远程合同（`shared/remote.ts`、`backend/remote.ts`）

- `list` 的条目带 `parent?`（只在调用方是会话时）。
- `tree({sessionId})` 与事件 `treeChanged`：这个会话的后代，每项 `{id, parent, callId, profile, name, profileIcon, state, runId?, step?, tools?, startedAt?, pending}`。在跑、等用户、等父 Agent 的后代才有 `runId`、`step`、`tools`、`startedAt` 与 `pending`；其余只有身份与 `state: "idle"`。`step` 是服务端折好的短摘要 `{tool, target}`（`target` 至多 120 字），不带完整参数；`pending` 是等用户的审批与 `questions: "user"` 的提问（含请求与预览所需的事项 id）。合并后至多每秒 4 次推整份；载荷受上限约束（在跑的至多 16 个），加一条载荷大小的合同测试（前端审查第 14 条）。
- `jobs({sessionId})`、`jobsChanged`：这个会话的后台任务（在跑与没取过的）。`jobTail({sessionId, jobId, lines?})`：直接读输出文件与 `status.json`，不要求任务还在任务中心。`killJob({sessionId, jobId})`：用户身份停这个会话启动的任何任务。

### 对话视图（`packages/nb-agent-ui`）

- **工具名（前端审查第 2 条）。** 宿主的 `displayToolName` 对 `nbook.agent.*` 用显式映射到给模型的名字（`agent_spawn`、`wait` 等），不再取 id 最后一段；注册表按这些名字登记；一条合同测试锁住 id → 名字 → 渲染器。
- **按调用定层级（前端审查第 3 条）。** 渲染器加 `presentationOf?(call)`：参数还在流式生成时按缺省层级，参数完整后才定；`shell` 带 `async` 的画成常显的后台命令卡片。
- **仍在进行的卡片不随整轮收起（前端审查第 16 条）。** 渲染器加 `pinned?(call, ctx)`：为真的节点在整轮收起后仍显示，进行完才随过程收起。
- **停靠区（第 44、48、50 条，前端审查第 6–9、17 条）。** 视图在输入框上方加一块停靠区：放异步提问与后代的待处理事项（审批、交给用户的提问），用同一套审批与提问的内容组件，`AgentWizardFrame` 加 `docked` 变体（轻阴影、圆角同输入框，与收起的小条共用一个类）；不替换输入框、不抢焦点，出现时只经 `aria-live` 报（带来源）；几个事项时翻看，每个单独提交；能收起成一条；最高 40% 视图高度，区内滚动。本会话自己的同步事项照旧用替换输入框的向导，两者并存时停靠区收成一条。停靠区没有“终止本轮”，提交说明“回答后 Agent 会接着做”。向导标题可收缩、省略号截断，计数与按钮固定在右边。
- **状态（前端审查第 7 条）。** 同步向导与停靠区各一份界面状态，按会话存在宿主里，切走再回来还在，事项消失时回收。
- **适配器（前端审查第 8 条）。** `kernel-transcript` 保留 `async` 的交互事项并带标记，不再丢掉。
- **事项字段。** `PendingInputView` 公共字段加 `source?: {sessionId, name, icon}` 与 `async?: true`；提交动作带 `sessionId`。
- **作者（前端审查第 10 条）。** `UserMessageView.author?`；适配器选项 `authorOf(by)` 由宿主给。
- **顶栏路径（前端审查第 20 条）。** `ctx.session.path?`；顶栏用面包屑（`nav`、`ol`），祖先段可点，最后一段仍是会话下拉的触发；超过两段时中间段收成“…”菜单；取不到的祖先写“未知会话”。
- **会话面板（第 47 条，前端审查第 11–13 条）。** 改的是 `AgentSessionPanel`：父会话行里“N 个子代理”是与打开按钮并列的兄弟按钮（`aria-expanded`、`aria-controls`），子会话列表是嵌在父行下的 `ul`；展开集合 = 手动展开 ∪ `expandFor` ∪ 当前会话的全部祖先 ∪ 有子会话等用户的父会话；搜索与 Profile 过滤保留命中项的祖先（祖先弱化显示）；父会话被归档或过滤掉时它的子会话不在顶层列出；子会话跟父会话在同一个日期组。不是当前会话的子会话行只显示说明与状态，“正在做什么”只在当前会话的子代理卡片上有。`AgentSessionList` 不改。
- 新文字进 `locales` 的中英文；改到的组件同步同名 `.md`。

### Agent 插件的浏览器端（`agent/web/`）

- **卡片数据（前端审查第 1、15、18 条）。** 宿主为每个打开的会话建一个单独的响应式源（`provide`，不进 `ctx`，免得每次推送重建整个上下文）：按子会话 id 存 `tree` 的项、按任务 id 存 `jobs` 的项，推送时只替换变了的那一项。节点组件按调用找自己：`agent_spawn` 按（父会话、`callId`），`agent_send`、`agent_answer` 按参数 `id` 与结果 `details.runId`；有结果且对应的运行已结束时用结果的 `details`，否则用 `tree`。后台命令卡片用 `jobs`，没有时用 `jobTail` 的 `status.json`。每种状态的那一行写什么、没数据时的占位都写进 Spec，高度不变。用时用等宽数字。
- **停靠区与向导（前端审查第 4 条）。** 宿主把事项抽成 `{sessionId, id, kind, request}`：应答、预览、“以后都允许”取规则都按事项自己的会话；后代的 `mode-switch` 不进停靠区；`unknown-interaction` 只在事项已不在列表时当成别处先答了，否则报出来。
- **切到子会话、顶栏路径。** 打开会话时按关系取一次祖先链（`list` 的 `parent`），列表变了刷新。
- **会话面板。** 用 `list` 的 `parent` 与 `activity`。状态栏的“运行中”只数顶层会话，“等你处理”含子会话（`conversation.md` 输出 19 一并改）。
- **Profile 设置页（前端审查第 21 条）。** 抽通用的“绑定列表一节”与“选择对话框”（行是 `{id, title, subtitle, badges, warning?}`，文字由调用方给），工具与子代理各自把视图模型转成它；白名单里已删除或不可用的 Profile 显示警告行；自己派自己、互相派不拦，由深度上限兜底；Profile 没有 `agent_spawn` 时不显示这一节。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `agent/subagents.md`（planned） | 按本稿重写：派发检查与预占、模式、随机 id、等与返回条件、任务与运行、续用、中止、结果与失败码表、fork、`tree` |
| `agent/jobs.md`（planned） | 按本稿重写：任务即运行、预占、前台与后台、寿命与 owner 上限、`wait` 的范围与超时、停止的先后、后台命令的超时、上限与 `status.json`、远程 |
| `harness/runtime.md`、`session.md`、`extensions.md` | 内核四处 |
| `agent/conversation.md` | 卡片各状态的行文与占位、停靠区、状态栏计数口径、会话面板 |
| `ui/agent-conversation-view.md` | 停靠区、`presentationOf`、`pinned`、`source`、`async`、`author`、顶栏路径、`AgentSessionPanel` 的嵌套 |
| `agent/modes.md` | 子会话继承模式的规则与 `mode-unsupported` |
| 其余已加 planned 条目的 | 按本稿对齐 |
| nb-agent-ui 组件同名 `.md`、`locales` | 随实现 |

## 切片

| # | 内容 | 自跑验证 |
|---|---|---|
| 0 | Spec 定稿（第二轮设计审查） | `bun run docs:check` |
| 1 | 内核四处 | nb-harness 受影响测试 |
| 2 | 测试支持：插件级假端点按请求内容分派脚本（后端审查第 21 条） | 它自己的测试 |
| 3 | 白名单、adhoc、设置、提示词扩展、关系表 | agent 插件测试 |
| 4 | 任务中心与 `wait`、`kill`、`jobs` | 同上 |
| 5 | 三个子代理工具：派发、等、续用、中止、结果 | 同上，真实内核多会话 |
| 6 | `shell`、`ask` 的 `async`，`loop-guard`、`cost-guard`，资源地址的根 | 同上 |
| 7 | 远程：`list` 的 `parent`、`tree`、`jobs`、`jobTail`、`killJob` | 远程合同测试 |
| 8 | 对话视图：工具名映射、`presentationOf`、`pinned`、停靠区、作者、顶栏路径、会话面板 | nb-agent-ui DOM 测试、Lab |
| 9 | Agent 浏览器端：卡片、停靠区接线、切换、面板、设置页 | agent web DOM 测试、宿主集成测试、Lab |
| 10 | e2e、Spec 证据 | 受影响的 e2e |

## 验收场景

单条行为由 Spec 的输出条目验收，组合场景（Spec 定稿后换成编号）：

1. 主创同一条回复派两个 adhoc：并发跑，父会话在等；一个完成一个出错，父 Agent 收到两份带来源标记的结果；两张卡片进度跟着变，结束后一行结果。
2. 子会话要审批：父会话输入框上方停着它，标题写来源；在父会话批了子会话继续；在子会话里批也行，另一边跟着消失；停着时父会话照常能插话。
3. 子会话向调用方提问：`agent_spawn` 返回 `question`；`agent_answer` 后同一个任务接着跑到完成。
4. 用户在父会话插话（含插话早于工具开始的情况）：等待以 `running` 返回，插话送达，之后 `wait` 取到结果。
5. 父会话中止：`agent_spawn` 立即以 `aborted` 返回、带子会话 id；`async` 派出的照常跑；`plan` 模式下派 adhoc，子代理的 `write` 被闸门拦下。
6. 上限：同一回复第 9 个 `agent_spawn` 得 `concurrency-limit{scope: "session"}`，第 4 层得 `depth-limit`，都没有子会话。
7. 重启：在跑的子代理按“已中断”收口；父 Agent 从 `sessions://` 根按调用 id 找到原来的子会话，`agent_send` 让它继续。
8. `shell` 带 `async`：立即交回任务 id；父会话中止后命令仍在跑；`wait` 取到退出码；重启后卡片从 `status.json` 画出终态。
9. 白名单：设置页去掉 adhoc，提示词里不再有它，派它得 `profile-not-allowed`。
10. 费用：子代理的花费算进树的上限，到上限时树里的会话都不再发请求。

## 验证

- 单元与合同测试用真实内核与真实会话存储（临时目录）；模型用切片 2 的按内容分派的假端点，两个子代理给不同的 `prompt`，脚本按它分派；不用 mock、不按固定时长等。
- 宿主集成测试（真实 remote 与假端点）：停靠区的事项按会话应答、预览、“以后都允许”、部分失败。
- DOM 测试：进度更新只改那一行文字（数渲染次数或观察 DOM 变化）。
- e2e：新增 `agent-subagents.e2e.ts`（场景 1、2、4）；`lab-agent-ui.e2e.ts` 加三条真实浏览器断言：卡片高度不随文字变（含 390px）、停靠区的计算样式（阴影不是浮层档、圆角同输入框，收起与展开两态）、长来源标题不溢出；再跑受影响的 `agent-conversation`、`agent-profiles`、`settings`。
- 未验证边界：真实模型下主创会不会恰当地派子代理（t18 决定 5）。

## 不做与风险

- 不做：结束通知与空闲时唤起、自动转后台、活动面板（t22）；查会话全部历史的工具（t23）；Workflow（t24）；子代理继承父会话上下文；会话删除（还没有这个功能，加的时候先停掉它启动的任务）；异步提问在会话列表与状态栏的提示。
- 风险：派得多时 `tree` 推送与订阅数上升，靠合并、限频、只推在跑的后代兜住；跨会话写同一文件靠文件服务的条件写入，`shell` 没有保护（第 26 条）；内核第 4 处改了 `shared` 段的进入时序，要回归现有的并发测试。
