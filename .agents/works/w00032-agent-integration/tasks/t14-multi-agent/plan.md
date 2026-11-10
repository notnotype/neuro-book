# t14 多 Agent：实施计划

## Context

t14 的设计在 2026-10-30 讨论定稿（[README](README.md) 第 1–33 条，两轮 omp 设计审查已处理），2026-11-09 开工：只做多 Agent，Workflow 在 t24；先定界面再前后端一起实施、一次合入；`shell` 的 `async` 也在本 Task（第 34、35 条）。界面经评审板四轮定稿（第 36–49 条，[`artifacts/review/`](artifacts/review/index.html)）。开发者 2026-11-10 确认计划初稿；之后两轮设计审查（第一轮后端 Opus 22 条、前端 Sonnet 24 条；第二轮后端 17 条、前端 19 条，报告与处理记录在 [`evidences/`](evidences/)），开发者在两轮之间定了第 50–54 条。本稿是第三版。

要交付的是：主创能派子代理分头干活、等结果或转后台，子代理的审批与提问有去处，用户在界面上看得到、管得到。另带上别的 Task 留给 t14 的事：adhoc Profile 与主创提示词（t18 决定 8）、子代理费用并入上限与 `wait` 豁免重复检测（t27）、可派白名单的形状（t05 计划“给 t14、t15 留的”）。

依据：内核 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)、[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)；Agent 插件 `docs/specs/agent/` 下的 `subagents.md`、`jobs.md`（本 Task 新建）与 `sessions.md`、`contributions.md`、`builtin-tools.md`、`resources.md`、`run-guards.md`、`profile-settings.md`、`conversation.md`、`builtin-profiles.md`、`modes.md`；对话视图 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)；调研 [各家的子代理设计](../../research/2026-10-30-subagent-survey.md)。

工作方式：主会话写代码，worktree `.worktree/w00032-t14-multi-agent`、分支 `feat/w00032-t14-multi-agent`；按切片提交；本会话的审查后端与计划派 Claude Opus、前端派 Sonnet（开发者 2026-11-10：不开 omp）；验证、审查处理完直接合入。

### 第三轮设计审查之后（开工前改完）

第三轮（后端 Opus 12 条、前端 Sonnet 11 条，都是阻断 0）结论都是“改完切片 0 就能开工”。这些已改进 Spec 与本稿：中止中的子会话续用得 `child-stopping`；`resolve` 有运行就交回 `runId`，回答排队而开不了运行时 `agent_answer` 以 `idle` 返回；父会话只读时续用同样先把子会话设为只读；`agent_send`、`agent_answer` 的卡片按参数 id 与 `runInvocation` 认；子代理卡片明确是 `node`；停靠区的 40% 以对话视图根节点为尺寸容器；会话面板的展开记录受控、由宿主持有；`jobs.md` 跟上第 53 条；验收的“第 9 个”改成“恰有一个”。按“窄场景选简单改法”记为已知限制的：句柄已回收的空闲后代的异步提问不进祖先停靠区、进程崩溃后后台子代理卡片写“状态未知”、fork 出来的父会话里复制的卡片找不到子会话、fork 的用量在树累计里重复计算。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 子会话 id、任务 id | `node:crypto` 的 `randomUUID` | 已在用；确定性 id 由第 51 条否决 |
| 结构化结果的校验 | 内核 `yield` 现有的 schema 校验 | 不另做 |
| 后台命令 | 现有 `@oh-my-pi/pi-natives` 的 `executeShell` | `shell` 已用它 |
| 任务中心 | 手写的内存表 | 进程内、不持久化（第 28 条） |

## 关键设计

### 内核（`packages/nb-harness/src/kernel`）

五处，都是可选字段或新交回的值，旧日志照读：

1. **输入记下是谁发的。** `inputQueued` 与路径上的 `input`、`steer` 都加 `by?: Issuer`；`send`、`enqueue` 经 `as(issuer)` 以会话身份发出时写，用户发的不写；异步提问的回答进缓冲区时写回答者。`by` 不进给模型的请求。
2. **调用的唯一身份。** `ToolContext` 加 `invocation`（就是 `toolStarted` 里已有的那个 id，内核生成、全局唯一）。会话头的 `caller` 加 `invocation`。调用 id 只在同一条回复里不重复（服务商可能跨回复给出 `call_0`），子会话、卡片与找回都按 `invocation` 认（第二轮后端第 4 条、前端第 10 条）。
3. **索引多四项。** `SessionIndexEntry` 加 `caller?: {kind, id, callId, invocation}`、`origin?: string`（fork 的来源会话）、`spend?: {cost, unpriced}`（同快照累计的口径：`assistant`、`modelEnded`、`modelFailed`）、`runs?: {runId, reason, endedAt}[]`（最近 20 次运行的收口）。旧索引没有这些读作没有，打开会话时按日志补。用途：会话面板、深度、费用按树算、卡片的终态，都不用打开后代会话。
4. **拦截上下文带会话。** `InterceptCtx` 加 `session`（与 `ReactCtx` 同一份），费用上限在模型拦截里要知道是哪棵树。
5. **指令交回运行。** `send`、`enqueue`、`resolve` 受理之后，会话有运行（在跑的、暂停的、这次开的或续的）就交回它的 `runId`，没有时不给（第二轮后端第 5 条、第三轮后端第 5 条）。

“同一段 `shared` 调用按顺序进入实现”不做（第 53 条）。各补 `runtime.md`、`session.md`、`extensions.md` 的条目与测试；nb-agent-ui 的 harness 适配器把 `toolStarted.invocation` 放进 `ToolCallView.invocation`。

### 任务中心（`agent/backend/jobs/`）

进程内的一张表。**一个任务就是一次子代理运行（子会话的一个 `runId`）或一条后台命令。**

```ts
interface Job {
    readonly id: string;               // job-<uuid 前 12 位>：只在本进程内有效
    readonly kind: "agent" | "shell";
    readonly owner: string;            // 启动它的会话
    readonly target?: {sessionId: string; runId: string};   // agent
    waiters: number;                   // 正在前台等它的调用数
    state: "starting" | "running" | "question" | "completed" | "failed" | "aborted" | "interrupted";
    outcome?: {reason: string; exitCode?: number; lines?: number};   // 只存身份与终态，结果文字交回时再读
    fetched: boolean;
    questionDelivered?: string;        // 已经交回过的提问事项 id
}
```

- **预占。** 工具一进来先做不需要 I/O 的检查（参数、Profile 存在、白名单、深度），再同步预占名额（每会话只数 `agent`，全局都数），超了得 `concurrency-limit{scope}`；之后的异步检查（结果 schema、初始输入、模式、模型）失败就退回名额。名额在异步检查期间占着，Spec 写明。`starting` 的任务不出现在 `jobs` 与远程里。
- **前台与后台。** 前台等它的调用数为 0 的就是后台任务。任何一个前台调用以终态交回时任务移出、视同取过。前台调用以 `question`、插话、超时返回时减一，留在任务中心。
- **寿命。** 后台任务结束后留到 `wait` 取过；每个 owner 至多 32 个结束了没取过的，全局至多 1,024 个，多了丢最早结束的；不随句柄回收。记录只存身份与终态，`wait` 交回时再读结果（子代理用 `waitRun(runId)` 从日志取，后台命令读 `status.json` 与输出文件）。
- **`wait`。** 不给 `jobs` 时只看后台任务；点名正被前台等着的得 `job-foreground`。先订阅再查现状：有已结束没取过的立即交回；停在 `question` 的，同一个提问事项只在第一次触发立即返回（记 `questionDelivered`），之后只列在“其余任务的状态”里（第二轮后端第 6 条）。超时缺省 1800 秒、至多 1800 秒。被中止时只结束等待。
- **停止。** 插件停止的第一步关门时同步记“正在停止”；`stop()` 取消后台命令（记 `interrupted`、写 `status.json`），子代理运行由句柄表关会话时按 `interrupted` 收口，最后丢掉任务表。子代理工具在信号触发时查“正在停止”，是就不发 `abort`（第二轮后端第 14 条，不用内核的 `interrupting`）。

### 子代理（`agent/backend/subagents/`）

- **会话关系表（`relations.ts`）。** 内存父子表：插件启动时扫完全部索引才开门；之后由派发与 `fork` 增量登记；扫描与增量按会话 id 合并，不整体替换（第二轮后端第 17 条）。深度、`tree`、`sessions://` 根、费用、`ancestors` 都查它。fork 出来的会话（索引有 `origin`）在关系表里标出，卡片不认它。
- **派发（`spawner.ts`）。** 顺序：同步检查（参数、`profile-not-found`、`profile-not-allowed`、`depth-limit`）→ 同步预占（`concurrency-limit`）→ 异步检查（`output-schema-fixed`、`initial-invalid`、`mode-unsupported`、`model-unavailable`）→ 建子会话（随机 id；会话头 `caller {kind, id, callId, invocation}`、`questions`、`result`）→ 分组改设置 → 以父会话身份 `send`。改设置或 `send` 失败时派发失败、退回名额、子会话留着，结果带它的 id。
- **模式。** 父会话不在 `normal` 时：派发只允许有模式的子 Profile；`agent_send`、`agent_answer` 让子会话跑之前，先把子会话的模式收紧到父会话的（子会话没有模式的得 `mode-unsupported`），父会话切回 `normal` 后子会话不自动放宽（第二轮后端第 2 条）。子会话的模式切换请求（`mode-switch` 提问）只能由用户答：`agent_answer` 对它得 `not-allowed`，等待把它当“等用户”而不是 `question`，它进停靠区（第二轮后端第 1 条，推翻上一稿“后代的 mode-switch 不进停靠区”）。
- **对同一子会话的放话。** 每个子会话一条 promise 链，`send`、`enqueue`、`resolve` 按到达先后在链上发（第 53 条：不保证按调用顺序）。
- **等（`await-child.ts`）。** `subscribeOpened` 接上子会话与父会话之后再查现状：`waitRun(runId)`；子会话当前路径上已有交给调用方的同步提问；父会话快照的缓冲区里已有 steer。之后任一条件成立就返回：运行结束、交给调用方的同步提问、父会话来了 steer、超时（缺省 1800 秒、至多 7200 秒）。子会话的异步提问不结束等待，随结果交回。
- **中止。** 父会话中止：工具立即以 `aborted` 返回（带子会话 id 与任务 id），对子会话发 `abort{keepQueue: true}`（之后的放话不会被这次中止清掉），不等收口。只连带父会话自己启动的运行（派发或空闲时的续用登记的任务）；插话附着到用户自己开的运行时不连带（第二轮后端第 12 条）。
- **续用。** 按内核交回的 `runId` 判定：交回的运行就是任务正跟着的那一次，算原任务；是新运行就登记新任务；`send` 让暂停的旧运行接着跑而原任务已移出时，登记新任务、沿用旧 `runId`。用户在子会话里开的运行，父 Agent 插话时登记一个归调用方的任务。`queue: true` 立即以 `running` 返回。不带 `message` 的“继续”正常完成后得 `nothing-to-continue`。会让子会话开新运行的先查上限。
- **结果（`result.ts`）。** 来源标记、状态与终止原因、结果、附带的异步提问；`details` 有 `sessionId`、`jobId`、`runId`、`invocation`、状态、结果第一句与结构化结果。过长截断，全文进父会话的 `session://artifacts/`。
- **失败码。** Spec 按工具分节列全：本插件的码；原样交回的内核码（直接引用 `commandErrors` 里 `send`、`enqueue`、`start`、`resolve`、`changeSettings` 的全部码）；子会话打开与新建失败时原样交回的存储码。`not-allowed` 的文字按事项种类区分（审批、交给用户的提问、模式切换）。`concurrency-limit` 带 `scope`。
- **白名单、提示词、adhoc。** 同上一稿：`agents?: {allowed, recommended?}` 与 `profileSettings[key].agents`；扩展 `nbook.agent.subagents` 的提示词一节；`nbook.agent.adhoc` 装 `nbook.agent.modes`。
- **重启后找回。** 子会话的标题是 `name`，没写时是 `prompt` 的前 30 个字（模型自己写的，认得出）；`sessions://` 根列出它，另标调用 id 供界面与测试用（第二轮后端第 15 条、第三轮后端第 4 条）。

### 工具

| id | 名字 | 并发 | 等级 | 参数 |
|---|---|---|---|---|
| `nbook.agent.spawn` | `agent_spawn` | shared | `read` | `profile`、`prompt`、`name?`、`initial?`、`model?`、`effort?`、`questions?`、`outputSchema?`、`async?`、`timeout?` |
| `nbook.agent.send` | `agent_send` | shared | `read` | `id`、`message?`、`queue?`、`async?`、`timeout?` |
| `nbook.agent.answer` | `agent_answer` | shared | `read` | `id`、`question`、`answer`（`{text, data?}`）、`async?`、`timeout?` |
| `nbook.agent.wait` | `wait` | shared | `read` | `jobs?`、`timeout?` |
| `nbook.agent.kill` | `kill` | exclusive | `read` | `job` |
| `nbook.agent.jobs` | `jobs` | shared | `read` | 无 |

### 已有工具与扩展

- **`shell` 的 `async`。** 同上一稿：任务自己的信号、`async` 时不写 `timeout` 不设超时、输出 64 MiB 上限、`status.json`、`home/jobs/` 宿主写。
- **`ask` 的 `async`。** 立即返回“问题已提出，回答会作为一条输入送来”。
- **`loop-guard`。** `wait` 交回的结果与上一次不同时才豁免重复检测（第二轮后端第 6 条），相同的照常计数。
- **`cost-guard`（第二轮后端第 7 条）。** 不用增量：插件按会话 id 存绝对值——打开着的会话取自己最近一次反应里的 `ctx.spend`，关着的取索引的 `spend`；树累计 = 关系表里这棵树各会话的值之和；fork 出来的会话照常计入，复制来的用量重复计算，偏紧不扣除（第三轮后端第 2 条：按 `origin` 排除会把用户 `/fork` 出来的根会话也排除掉）。模型拦截用 `ctx.session` 找到根。告警按会话记。

### 资源地址、设置

- `sessions://` 根：先列有关的会话（父、子、兄弟，带状态；子会话带调用 id，它的标题是 `name`，没写时是 `prompt` 的前 30 个字），再按最近使用。状态从句柄表的 `activity()` 与任务中心取。
- `profiles://` 根：每项标“可派”或“不可派”。
- 设置：可靠性分区加 `subagentDepth`（3，1–5）、`subagentsPerSession`（8，1–16）、`backgroundJobs`（16，1–32）。

### 远程合同（`shared/remote.ts`、`backend/remote.ts`）

- `list` 的条目带 `parent?`（只在调用方是会话时）。
- `ancestors({sessionId})`：按关系表逐级交回祖先 `[{id, title, profile, icon, archived}]`，不受归档与作品范围过滤（顶栏路径用，第二轮前端第 18 条）。
- `tree({sessionId})`、`treeChanged`：后代每项 `{id, parent, callId, invocation, forked, profile, name, profileIcon, state, runs}`，`runs` 来自索引（最近 20 次的 `{runId, reason, endedAt}`）；在跑、等用户、等父 Agent 的另有 `runId`、`startedAt`、`tools`、`step`（`{tool, target}`，`target` 至多 120 字）；句柄打开着的后代有等用户的事项时带 `pending`（`{id, kind, callId, request}`，含模式切换）；句柄已回收的空闲后代的未答异步提问不给，记为已知限制（第三轮后端第 3 条）。非 `idle` 的项带 `runInvocation`，`question` 的带 `question: {id, text}`，`step.target` 依次取参数的 `path`、`pattern`、`command`、`query`、`url`（第三轮前端第 1、5 条）。`step`、`tools` 至多给 16 个在跑的后代，有 `pending` 的一律给全（第二轮前端第 11 条）。合并后至多每秒 4 次推整份。
- `jobs`、`jobsChanged`（任务项带 `invocation`）、`jobTail`（读文件，与任务表无关，`lines: 0` 只读状态）、`jobStatuses`（一次读多个 `status.json`）、`killJob`（用户身份）。`wait`、`kill` 结果的 `details` 形状写进 `jobs.md`，宿主按 `runId`、`jobId` 建索引（第三轮前端第 3、4 条）。
- `activity` 的条目加 `root`（根会话 id，服务端按关系表算）。

### 对话视图（`packages/nb-agent-ui`）

- **工具名。** 宿主的 `displayToolName` 对 `nbook.agent.*` 显式映射到唯一的键（`agent_spawn`、`agent_send`、`agent_answer`、`agent.wait`、`agent.kill`、`agent.jobs`），别的插件的 `x.wait` 不会被画成任务中心的行（第二轮前端第 19 条）；合同测试锁住。
- **后台命令卡片（第二轮前端第 4 条）。** 内置 `bash` 条目加 `presentationOf(call)`：参数生成完且 `async` 为真时是 `node`，否则 `card`；`node` 画宿主注入的渲染组件 `renderers.backgroundCommand`（没注入时画通用卡片）。读呈现层级的位置（`conversation-turns`、`AgentChainBlock`、步骤行）一并改成按调用取。
- **进行中的轮次不自动收起（第二轮前端第 2、3 条）。** `ctx.activeCalls?: readonly string[]`（进行中的调用的 `invocation`，宿主从 `tree`、`jobs` 算，集合没变就不换引用）；含这些调用的轮次不自动收起，用户手动收起照常（卡片随过程收起，不搬位置）。不加 `pinned`。
- **停靠区（第 44、48、50、54 条，第二轮前端第 5–8 条）。** 视图级的一块，在消息流与输入框之间；自带 `container-type`，最高为视图高度的 40%，内容区滚动；与排队条、可用性提示的上下顺序写进 Spec。`pendingInputs` 按 `source`/`async` 分成“阻塞”与“停靠”两组，现有使用者（替换输入框的判断、向导、状态栏）只看阻塞的。停靠区是单独的组件（单事项壳：上一个/下一个、事项的按钮集，没有“全部拒绝”“终止本轮”），不调 `focusRoot`；播报经视图层常驻的、视觉隐藏的 `role="status"` 区，文字带来源。状态：`ctx.wizardState`（同步）与新的 `ctx.dockState`（停靠），动作 `wizard.state` 与新的 `dock.state`。同步向导出现时停靠区收成一条，排在向导下面。`AgentWizardFrame` 加 `docked`（轻阴影、圆角同输入框）。向导标题可收缩、省略号截断。
- **事项字段。** `PendingInputView` 公共字段加 `source?`、`async?`；模式切换事项也可以带 `source`（它进停靠区）；提交动作带 `sessionId`。
- **作者。** `UserMessageView.author?`；适配器选项 `authorOf(by)`。
- **顶栏路径。** `ctx.session.path?`；面包屑，最后一段仍是会话下拉的触发；中间段多于两层收成“…”；取不到写“未知会话”，归档的照写标题。
- **会话面板（第二轮前端第 12、13 条）。** 改 `AgentSessionPanel`：条目加 `parentId?`、`childCount?`、`childWaiting?`、`dimmed?`（宿主按未过滤的列表算好交进来）；展开是三态（手动展开、手动收起、自动），自动规则只在条目集合或当前会话变化时生效一次，之后手动的优先；`dimmed` 的行带读屏说明。父会话的 `updatedAt` 由宿主取自身与后代中最新的。`AgentSessionList` 不改。
- 新文字进 `locales` 中英文；改到的组件同步同名 `.md`。

### Agent 插件的浏览器端（`agent/web/`）

- **卡片数据（第二轮前端第 1、9、15 条）。** 宿主为每个打开的会话建一个单独的响应式源（`provide`，不进 `ctx`）：按子会话 id 存 `tree` 的项、按任务 id 存 `jobs` 的项，推送时只替换变了的项；另有一个每秒走的 `now`，只在有进行中的项时走，卡片自己算用时（不推动整个 `ctx`）。节点组件按 `invocation` 找子会话（不认 fork 出来的）；终态按这个顺序找：调用自己的结果是终态 → 父会话日志里后来任何一个工具结果的 `details` 里同 `runId` 的终态（`wait`、`agent_send` 交回的）→ `tree` 项 `runs` 里同 `runId` 的收口原因（没有结果句时写“已完成”等）→ 在跑的 `tree` 项。卡片行文是“调用状态 × 子代理状态”的矩阵，含派发失败（图标与名字从参数的 `profile` 在 Profile 目录里取，打开按钮不可用）、参数还在生成、被拒、`unknown`、等模式切换；没数据时占位，高度不变。只有 `pending` 集合变了才重建 `ctx`。
- **停靠区接线（第二轮前端第 8 条）。** 事项抽成 `{sessionId, id, kind, request}`；应答、预览、规则都按事项自己的会话；界面状态只在确认已答时回收（应答成功、收到这个后代的 `interactionResolved`、或完整的 `tree` 快照里这个后代在而事项不在），订阅未就绪、重取中时保留。
- **后台命令卡片。** 宿主注入 `renderers.backgroundCommand`；展开时才取 `jobTail`，运行中合并成至多每秒一次。
- **顶栏路径、切到子会话。** 用 `ancestors`。
- **状态栏（第二轮前端第 14 条）。** “运行中”= 有会话在跑的根会话数（根自己或任一后代在跑），“等你处理”= 在等用户的会话数（含子会话），按 `activity` 的 `root` 算。
- **Profile 设置页。** 同上一稿：通用的“绑定列表一节”与“选择对话框”、警告行、自引用不拦。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `agent/subagents.md`、`agent/jobs.md`（planned） | 按本稿 |
| `harness/runtime.md`、`session.md`、`extensions.md` | 内核五处 |
| `agent/conversation.md`、`ui/agent-conversation-view.md` | 卡片矩阵、停靠区、进行中的轮次、会话面板、状态栏、顶栏路径 |
| `agent/modes.md` | 派发与续用时的模式规则、子会话的模式切换只由用户答 |
| `agent/sessions.md` | `ancestors`、`activity` 的 `root` |
| 其余已加 planned 条目的 | 按本稿对齐 |

## 切片

| # | 内容 | 自跑验证 |
|---|---|---|
| 0 | Spec 定稿（第三轮设计审查） | `bun run docs:check` |
| 1 | 内核五处与适配器的 `invocation` | nb-harness、nb-agent-ui 受影响测试 |
| 2 | 测试支持：插件级假端点按请求内容分派脚本 | 它自己的测试 |
| 3 | 白名单、adhoc、设置、提示词扩展、关系表 | agent 插件测试 |
| 4 | 任务中心与 `wait`、`kill`、`jobs` | 同上 |
| 5 | 三个子代理工具 | 同上，真实内核多会话 |
| 6 | `shell`、`ask` 的 `async`，`loop-guard`、`cost-guard`，资源地址的根 | 同上 |
| 7 | 远程：`list`、`ancestors`、`tree`、`jobs`、`jobTail`、`killJob`、`activity` | 远程合同测试 |
| 8 | 对话视图 | nb-agent-ui DOM 测试、Lab |
| 9 | Agent 浏览器端 | agent web DOM 测试、宿主集成测试、Lab |
| 10 | e2e、Spec 证据 | 受影响的 e2e |

## 验收场景

1. 主创同一条回复派两个 adhoc：并发跑，父会话在等；一个完成一个出错，父 Agent 收到两份带来源标记的结果；两张卡片进度跟着变，结束后一行结果。
2. 子会话要审批：父会话输入框上方停着它，标题写来源；在父会话批了子会话继续；在子会话里批也行，另一边跟着消失；停着时父会话照常能插话。
3. 子会话向调用方提问：`agent_spawn` 返回 `question`；`agent_answer` 后同一个任务接着跑到完成。
4. 用户在父会话插话（含插话早于工具开始）：等待以 `running` 返回，插话送达，之后 `wait` 取到结果。
5. 模式：父会话在 `plan` 下派 adhoc，子代理的 `write` 被闸门拦下；`normal` 下派出的子会话，父会话切到 `plan` 后 `agent_send`，子会话先被收紧到 `plan`；子会话的模式切换请求出现在父会话的停靠区，`agent_answer` 答它得 `not-allowed`。
6. 中止：父会话中止，`agent_spawn` 立即以 `aborted` 返回、带子会话 id；`async` 派出的照常跑；紧接着的 `agent_send` 送达。
7. 上限：第 9 个 `agent_spawn` 得 `concurrency-limit{scope: "session"}`，第 4 层得 `depth-limit`，都没有子会话。
8. 重启：在跑的子代理按“已中断”收口；父 Agent 从 `sessions://` 根按名字找到原来的子会话，`agent_send` 让它继续；`async` 派出的卡片画出“已中断”。
9. `shell` 带 `async`：立即交回任务 id；父会话中止后命令仍在跑；`wait` 取到退出码；重启后卡片从 `status.json` 画出终态。
10. 白名单：设置页去掉 adhoc，提示词里不再有它，派它得 `profile-not-allowed`。
11. 费用：子代理的花费算进树的上限，到上限时树里的会话都不再发请求。
12. `async` 派出、父会话回复完结束这一轮、子代理完成：这一轮在子代理完成前不自动收起，卡片用时在走；完成后卡片写结果第一句（父 Agent `wait` 取过之后）或“已完成”。

## 验证

- 单元与合同测试用真实内核与真实会话存储（临时目录）；模型用切片 2 的按内容分派的假端点，各子代理给不同的 `prompt`；不用 mock、不按固定时长等。
- 宿主集成测试（真实 remote 与假端点）：停靠区的事项按会话应答、预览、“以后都允许”、单个事项提交失败时的原因与所选保留、订阅重建时状态保留；卡片终态的四个来源。
- DOM 测试（固定 `now`）：进度更新只改那一行文字；停靠区出现与事项变化时焦点不动；当前会话的父会话能手动收起。
- e2e：新增 `agent-subagents.e2e.ts`（场景 1、2、4）；卡片的 Lab 场景放 `lab/web/fixtures/agent-scene/`，加 e2e 断言卡片高度不随文字与状态变（含 390px）；`lab-agent-ui.e2e.ts` 加停靠区的计算样式（亮暗两色、收起与展开）、限高、与同步向导并存的顺序、输入框可用、长来源标题不溢出；停靠区用 `data-agent-dock`，现有用 `[data-agent-wizard]` 的 e2e 不受影响。再跑受影响的 `agent-conversation`、`agent-profiles`、`settings`。
- 未验证边界：真实模型下主创会不会恰当地派子代理、能不能凭名字找回子会话（t18 决定 5）。

## 不做与风险

- 不做：结束通知与空闲时唤起、自动转后台、活动面板（t22）；查会话全部历史的工具（t23）；Workflow（t24）；子代理继承父会话上下文；会话删除；异步提问在会话列表与状态栏的提示；并发子代理工具的调用顺序（第 53 条）。
- 风险：派得多时 `tree` 推送与订阅数上升，靠合并、限频、只给在跑的后代动态字段兜住；跨会话写同一文件靠文件服务的条件写入，`shell` 没有保护（第 26 条）；fork 出来的会话复制来的用量在树累计里重复计算，上限对它偏紧。
