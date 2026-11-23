# t22 实施计划：后台任务的回执送回会话、`shell` 自动转后台、eval 的提醒、工具登记任务

第 4 稿（2026-11-23）：按 Opus 设计审查（21 条，见 [README](README.md) 的“计划第 3 稿的设计审查”）与开发者当天的决定改。和第 3 稿相比：定下“回执”的约定（每件后台任务不论怎样结束，启动它的会话恰好收到一次）；领取改成一个“出口”字段，`wait` 能撤回还没取走的回执自己交回；每次领取一个新指令 id、正文冻结；暂时的失败稍后重送；回执只有发送方能撤回；用户停的与重启中断的回执不唤起；重启前在跑的任务记在小账本里、启动后补发回执；自动转后台改名接过暂存文件、不同步拷贝；提醒与门的事件不算会话活动。

## Context

t14 做了任务中心（`wait`、`kill`、`jobs`，`shell` 与子代理的 `async`）。现在后台任务结束时 Agent 不知道，只能自己 `wait`；`shell` 跑久了不会转后台；eval 的内核被回收或意外退出，模型要到下一次调 eval 才知道；别的插件（t24 的 Workflow）没法把自己的长任务登记成 Agent 的任务。t41 已给内核的缓冲区加了提醒：会话或宿主发 `notice({text, key?, wake?})`，下一次对话请求带上；带唤起的在门开着、会话空闲时开一次运行。

**回执的约定**（开发者 2026-11-23）：Agent 发起的每件后台任务，不论怎样结束（完成、失败、被 Agent 或用户停掉、插件停止、服务重启），启动它的会话恰好收到一次回执；系统不能不守信。回执有三个出口：前台等着的调用、`wait`、一条提醒，只经其中一个。

依据：提案第四节第 3 小节（第 1–11 条，第 2 条“交给清单的行”归 t42）与决策记录；[ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md)；[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`agent/eval.md`](../../../../../docs/specs/agent/eval.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 18–31、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 30、85、112–118、[`harness/session.md`](../../../../../docs/specs/harness/session.md)。两轮提案审查里归 t22 的条目作为输入。

开发者已定：README 的“决定”1–18。

工作方式：主会话写；审查按 reviewing 的“派给谁”（2026-11-23）：第 1、2 片碰单写者与“只交一次”，快速审查（Opus 先审，omp `@review` 在后台）；第 3–5 片收口一次 Sonnet；前端一次 Sonnet。

## 技术选型

无通用问题：送达用内核的提醒，计时用注入的时钟，输出记录与账本沿用现有的文件写法（`nb-file-lock` 的加锁替换写账本）。

## 关键设计

### nb-harness 内核

- **`abort` 的 `runId`**（提案第 8 条）：`abort` 加可选 `runId`；给了时只停这次运行，在跑的不是它（已收口、或已是下一次）得 `{aborted: false}`、不动缓冲区、不关门。`kill`、远程 `killJob` 停子代理时带上任务的 `runId`；得 `aborted: false` 时 `kill` 交回“已经结束”，不说“已停止”（审查第 19 条）。
- **只有发送方能撤回的提醒**（开发者定）：`notice` 加 `senderOnly?: true`，记进 `noticeQueued` 与 `PendingNotice`；这样的提醒用户身份撤回得 `not-allowed`，发出者自己照常撤回。快照的提醒（含远程摘要）带上它，排队区据此不画“取消”。
- **提醒与门不算会话活动**（开发者定）：会话索引的 `lastActivityAt` 不因 `noticeQueued`、`noticeRemoved`、`noticeTaken`、`wakeGate` 前移，后台发来的提醒不把会话顶到列表最前面（`log/index-file.ts` 的 `advanceIndex`）。

提醒不另过拦截（决定 17）：对服务商的遮盖统一在请求拦截（`intercept.model`）做。

### `backend/jobs/center.ts`：一个“出口”字段

任务上的 `fetched`、`questionDelivered` 与第 3 稿要加的 `claimed`、`unconfirmed`、`deliveryFailed`、`watched` 合成一个字段（审查第 12 条）：

```ts
type Exit =
    | null                                   // 还没有出口：结束了就等领取
    | {readonly kind: "foreground"}           // 前台的调用等着（`waiters > 0` 时）
    | {readonly kind: "wait"}                 // 已由 `wait` 交回
    | {readonly kind: "notice"; readonly commandId: string; readonly args: NoticeArgs; state: "sending" | "pending" | "unconfirmed"; noticeId?: string};
```

- `wait`、前台、送达都在同一个同步段里看并写它，于是两个并发的 `wait` 不会交回同一件（审查第 5 条，base 上就有的问题）。`wait` 交回时写 `{kind: "wait"}`。
- **`wait` 接过还没取走的回执**（审查第 1 条）：`wait` 的候选包括出口是 `notice` 的。`pending` 的先 `removeNotice` 撤回：撤回成功由 `wait` 交回（提醒没进过请求）；得 `notice-taken` 就说明已在上下文里，交回“它的回执已在对话里”。`sending` 的等这次发送结算再判。`unconfirmed` 的交回“回执可能已在对话里”。不再需要 `watched`：`wait` 在跑时会话一定在跑，回执不会唤起，`wait` 交回前撤回它不会撞上边界。
- 提问另有一个同样形状的出口，按提问 id 记（取代 `questionDelivered`）。
- **任何变化都触发领取**（审查第 4 条）：`wait` 返回、超时、`detach` 都经 `#changed`，送达据此再看一遍。
- **结果在收口时定下**（提案第 8 条、审查第 8 条）：任务结束时驱动把有界的回执段落拼好存在任务上（子代理在 `#follow` 的 `waitRun(runId)` 交回时，用那次的 `RunResult`）；`wait` 与送达都用这一份，不再现读。子会话的异步提问是“当前状态”，照旧现读、不进冻结的段落。
- 发布带上前台归属：前台的 `agent_send`、`agent_answer` 登记新任务时先 `attach` 再 `start`。
- 种类开放：`JobKind` 改成字符串，插件登记的是 `<插件 id>.<名字>`；`Job` 加 `label`。

### 回执的正文：`backend/jobs/receipt.ts`（新）

- 开头一句“以下是你启动的后台任务的回执，不是用户说的话；已经交给你了，不用再 wait 它们”。每件一段，写种类、摘要、状态（完成、失败、被你停止、被用户停止、插件停止时中断、服务重启时中断）与结果。
- 每段按 UTF-8 至多 12 KiB，**留头留尾**、中间写省略与全文地址，地址放在段末不被切掉（审查第 7 条）：命令的全文是 `output.log`；子代理的报告超过 12 KiB 时把全文存进 `artifacts/` 再写地址。一条提醒至多 30 KiB（内核单条 32 KiB），放不下的下一条再送。

### `backend/jobs/delivery.ts`（新）：送达

`JobDelivery` 跟着 `center.onChanged(owner)`，每个会话一条串行队列（发送、撤回、重发都排在这条队列里，审查第 20 条）；以宿主身份 `{kind: "host", source: {plugin: "nbook.agent", label: "后台任务", ref: "jobs:<id>,…"}}` 经会话表的视图发提醒。发送方不管会话开没开：视图按需打开，空闲 30 秒后会话表自己关（开发者定）。

一次送达：

1. 同步领取：出口为 null 的已结束任务（与停在一个还没交过的同步提问上的），写 `{kind: "notice", commandId: 新 id, args: 冻结的参数, state: "sending"}`（审查第 2、3 条：每次领取一个新指令 id，正文冻结后重发原样用）。
2. `notice({...args, senderOnly: true, wake})`：根会话（会话头没有 `caller`）带唤起；子会话不带；**被用户停掉的、服务重启中断的不带**（开发者定：回执进了缓冲区，下一次请求必定带上）。
3. 结算：
   - 受理：`pending`，记下提醒 id；会话日志里出现它的 `noticeTaken` 时任务移出（订阅这个会话的日志帧，取走前一直挂着）。
   - 暂时送不了（`notice-budget`、`session-busy`、打开失败这类）：出口回到 null，诊断；这个会话下一次 `noticeTaken`（预算腾出）或句柄关闭再打开时再领取（审查第 6 条）。放不下全文时改发一条很短的回执“还有 N 件后台任务的回执没放下：job-a、job-b，用 wait 取”，它几乎总能放下。
   - 永久送不了（会话已删、会话日志读不懂）：出口回到 null 并记诊断，只留给 `wait`。
   - 结果未知（抛错、写日志失败）：`unconfirmed`；会话表的 `closed(sessionId)` 回调触发时（句柄因损坏或空闲关闭），用同一个指令 id 与冻结的参数重发：受理过的只交回原结果、不再写；没受理过的这次才写。重发再次未知、或打不开，保持 `unconfirmed` 等下一次关闭（审查第 16 条）。
4. 插件停止时 `delivery.close()` 是停止的第一步：之后不再领取。

### 重启时在跑的任务：`backend/jobs/ledger.ts`（新）

开发者定：任务表仍不持久化，另记一本小账本 `<状态根>/agent/jobs/ledger.json`，每件还没结束的后台任务一项 `{id, owner, kind, label, summary, startedAt, output?}`；任务开始时加、结束（回执有了出口）时删，加锁替换写。服务端启动时读账本：每件留下来的按“服务重启时中断”给它的启动方发一条不带唤起的回执（地址指向输出文件或子会话），发完删掉；会话已不在的记诊断后删掉。

### 子代理有话问父 Agent：`backend/subagents/children.ts`

任务停在一个还没交过的同步提问上、没有前台在等时，送达把它当一件送：段落用 `resultOf` 的提问写法（子会话 id、提问 id、题干、`agent_answer` 的写法），`key: "question:<jobId>"`，根会话带唤起。提醒取走之前提问被答了、任务停了或提问过期：在同一条串行队列里撤回；正在发送的等它结算再撤（审查第 20 条）。

### eval：`backend/eval/tool.ts`、`kernels.ts`

- 每一代内核编号；`SessionKernel` 监听 `Kernel.exited`，两次调用之间的意外退出当场知道（审查第 13 条）；“空闲”“被回收”也是当场知道的。
- 这三种重置，只在这条路径上跑过 eval（`ranOnPath`）时，以宿主身份 `{plugin: "nbook.agent", label: "eval"}` 给会话发一条不带唤起的提醒，`key: "eval-kernel"`，带这一代的编号；会话关着也照发（开发者定：发送方不管会话活没活着）。新一代内核起来、能用之后，在发送的同一条串行队列里撤回还没取走的旧一代提醒，免得旧提醒晚于新内核受理。
- 下一次 eval 的结果第一行照旧写“内核已重置”；执行中崩溃的那次结果已经说了，不另发；回退、换 Profile、换目录、主动重置只写在结果里（决定 9）。

### `shell` 自动转后台：`packages/nb-harness/src/kit/tools/shell.ts`、`output-capture.ts`

`ShellBackground` 不变，另加可选的 `ShellAutoBackground`，`shellTool(dialects, background?, auto?)` 不给第三个参数时和现在一样。

```ts
export interface ShellAutoBackground {
    /** 前台跑到它完成就开始接手；null 表示这次不自动转（设置为 0、子会话、代码里调）。用宿主的时钟计。 */
    threshold(request: ShellRequest, signal: AbortSignal): Promise<void> | null;
    /** 接手的第一步（异步）：占下任务 id 与名额、建好输出目录。交回 null 表示接不了，命令留在前台。 */
    prepare(request: ShellRequest): Promise<BackgroundTarget | null>;
}
export interface BackgroundTarget {
    /** 同步：把暂存的输出接成任务的输出记录、交回从此接收输出的出口与给模型的结果。失败时抛错，命令留在前台。 */
    take(handover: Handover): {readonly sink: (error: Error | null, chunk: string) => void; readonly result: ToolResult};
    /** 没用上（命令已结束、调用已中止、`take` 失败）：退回名额、删掉建好的目录。 */
    discard(): void;
}
```

- 时限不变：命令照原样把 `timeout`（缺省 300 秒）交给 `executeShell`，转后台后仍按它；门槛不短于时限时不转。
- 移交不同步拷贝大文件（提案第 9 条、审查第 11 条）：`OutputCapture` 从一开始就把输出写进同一个文件系统上的暂存文件（内存里只留尾部与统计）；`take` 在一个同步步骤里把暂存文件改名成 `jobs/<任务 id>/output.log`、把出口换成追加写这个文件，并断开 `call.signal`。改名失败就留在前台。任务 id 在 `prepare` 里占下，目录用它建（审查第 17 条）。
- 只对顶层会话：子会话与代码里调的 `threshold` 交回 null。

`backend/builtin/shell-background.ts`：`startBackgroundCommand` 拆出“输出记录”，`async` 从零开始用它，接手时接上暂存的统计。接手交回“跑了 60 秒还没结束，已转到后台：任务 job-x，时限照旧。到目前为止的最后几行：……全文写进 <地址>。结束时回执会自动送来，不用 wait 轮询”；`details` 加 `autoBackground: true`。设置 `nbook.agent/shellAutoBackground`：秒，缺省 60，0–3600，0 为不自动转；只允许用户层。

### 工具里登记任务：`shared/resources.ts` 的 `AgentToolServices`

```ts
interface ToolJobs {
    /** 只能在这次调用的 `execute` 结算之前调；会话与 `invocation` 取自 `call`。`stop` 必给：用户、Agent 停它，或插件撤回时调用。 */
    begin(call: ToolContext, input: {kind: string; label: string; summary: string; stop(byUser: boolean): void | Promise<void>}): {ok: true; job: ToolJob} | {ok: false; code: "concurrency-limit" | "unavailable" | "invalid"};
}
interface ToolJob {
    readonly id: string;
    progress(line: string): void;
    /** 结束时给出回执的结果文字（按 UTF-8 至多 12 KiB，超出截断并注明），之后不再向插件取任何东西。 */
    end(state: "completed" | "failed" | "aborted", text: string): void;
}
```

- 登记权绑定真实调用：`backend/tools.ts` 包工具实现的那一层在 `execute` 进行期间把 `call.invocation` 记进在跑的调用表，`begin` 只认表里的、并且是贡献这个工具的插件这一代的；`kind` 盖成 `<插件 id>.<kind>`，`label`、`summary` 校验长度。
- `stop` 必给（审查第 18 条）：`kill` 调它，交回“已停止”要等插件 `end`；插件撤回 `agent.tools` 时先封住这一代（之后的 `begin` 得 `unavailable`），再对它在跑的任务调 `stop`，按 `interrupted` 收口。不进插件 SDK。

### 在跑的工作：`backend/running-work.ts`

子会话在跑时已经归到根会话报一项，`agent` 任务不再另报；`shell` 与插件登记的任务照旧每件一项。

### 前端：`packages/neuro-book/src/plugins/agent/web/`、`packages/nb-agent-ui/`

- 回执在 t41 已经能显示（排队区“提醒 · 后台任务”的行，取走后是消息流里的一条提醒）；`senderOnly` 的行不画“取消”：排队区条目加 `removable?: false`（视图 Spec 写成 planned），宿主按快照与帧里的 `senderOnly` 填。
- 子代理卡片：任务移出之后，按子会话 id 与 `runId` 经远程新方法 `runOutcome({sessionId, runId})` 读有界的终态（收口方式与回复首句，至多 1 KiB），不读整份 `runResult`（审查第 15 条）。
- 自动转后台的 `shell`：结果带 `details.autoBackground` 时卡头注明“自动转到后台”。

## Spec 与文档改动

先在 master 上写成 planned：

- `harness/runtime.md`：输出 112 加 `senderOnly`；新输出 119 `abort` 的 `runId`。
- `harness/session.md`：`noticeQueued` 带 `senderOnly`；会话索引的 `lastActivityAt` 不因提醒与门的事件前移。
- `harness/host-kit.md`：可选的 `ShellAutoBackground`、暂存文件改名移交。
- `agent/jobs.md`：“不承诺”去掉通知、自动转后台与“重启后为空”的说法；新输出：回执的约定与三个出口、出口字段与 `wait` 接过回执、送达（何时、唤起与否、发出者、预算、暂时与永久失败、送达未确认）、账本与重启后的回执、工具里登记的任务种类、`kill` 与 `killJob` 带 `runId`；失败表补送达的几类；验收 4 改写，补审查第 21 条要的时序。
- `agent/subagents.md`：同步提问送提醒、答了或停了就撤回。
- `agent/eval.md`：三种当场知道的重置发提醒、新一代起来撤回、结果里照旧写。
- `agent/builtin-tools.md`：自动转后台；设置表加 `shellAutoBackground`。
- `agent/sessions.md`：输出 20 子代理的执行只报一项；输出 29 快照的提醒带 `senderOnly`；远程 `runOutcome`。
- `agent/conversation.md`：输出 33 子代理卡片读 `runOutcome`；输出 36 自动转后台的卡头；输出 51 `senderOnly` 的提醒没有“取消”。
- `ui/agent-conversation-view.md`：排队区条目的 `removable?: false`。

## 切片

1. **内核**：`abort{runId}`、`senderOnly`、提醒与门不算会话活动；`runtime.md`、`session.md` planned。验证：nb-harness `bun test src/kernel`、typecheck。
2. **出口、回执与送达**：`center.ts` 的出口字段、`wait` 接过回执、`receipt.ts`、`delivery.ts`、`ledger.ts`、子代理的提问提醒与撤回、`kill` 带 `runId`；`jobs.md`、`subagents.md` planned。验证：`jobs.test.ts`、`subagents.test.ts`、typecheck。做完快速审查（Opus 加后台 omp）。
3. **eval 的提醒**：`eval/tool.ts`、`kernels.ts`；`eval.md` planned。验证：`eval.test.ts`。
4. **自动转后台**：kit `shell.ts`、`output-capture.ts`，`shell-background.ts`、设置；`host-kit.md`、`builtin-tools.md` planned。验证：nb-harness `kit/tools/shell.test.ts`，neuro-book `jobs.test.ts`、`builtin-tools.test.ts`。
5. **工具里登记任务**与在跑的工作：`resources.ts`、`tools.ts` 的在跑调用表、撤回时收口；`running-work.ts`。验证：`jobs.test.ts`、`running-work.test.ts`。
6. **对话界面**：`removable`、子代理卡片读 `runOutcome`、自动转后台的卡头。验证：dom 测试、`session-host.test.ts`、`e2e/agent-subagents.e2e.ts`。

每片跑受影响的测试与 typecheck、单独提交。第 3–5 片收口一次 Sonnet，第 6 片一次 Sonnet。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| runtime.md 输出 112（`senderOnly`）、119 | 内核合同测试：用户撤回 `senderOnly` 的提醒得 `not-allowed`、发出者能撤；`abort{runId}` 对已收口的、下一次运行得 `aborted: false`、不动缓冲区、不关门 |
| session.md 会话活动 | 内核合同测试：发提醒、取走、门开关之后索引的 `lastActivityAt` 不变 |
| jobs.md 回执的约定 | `jobs.test.ts`：完成、失败、被 Agent 停、被用户停、插件停止各一件，启动方都恰好收到一次回执；被用户停的不唤起 |
| jobs.md 出口与 `wait` | `jobs.test.ts`：模型生成回复期间任务结束、同一条回复里 `wait` 立即交回它且提醒被撤回（审查第 1 条）；同一件任务第二次送达（第二个提问）照常送达（第 2 条）；`wait` 返回时另一件结束照样送达（第 4 条）；两个并发的 `wait` 不交回同一件（第 5 条）；点名等已在对话里的得“已在对话里” |
| jobs.md 送达 | `jobs.test.ts`：根会话空闲时唤起（含句柄空闲关闭之后）、子会话不唤起、门关着时随下一句话带上、超预算时发短回执且取走后补送其余、超长结果留头留尾有地址；断言结果进了实际的模型请求且只一次 |
| jobs.md 送达未确认 | `jobs.test.ts`：真实存储加故障注入，两处注入写失败（受理批之前、之后）：结果未知、`wait` 交回“可能已在对话里”；句柄关闭后用同一个指令 id 重发，日志里只有一条 |
| jobs.md 账本 | `jobs.test.ts`：起一条后台命令后停掉插件、同一个状态根再起，启动方收到“服务重启时中断”的回执，不唤起，账本清空 |
| jobs.md 工具登记的种类 | `jobs.test.ts`：测试插件的工具登记一种任务，`wait`、`kill`（等插件 `end`）、送达照常；`execute` 结算后再登记无效；插件停止后它的任务为 `interrupted`、`stop` 被调用 |
| jobs.md `kill` 带 `runId` | `subagents.test.ts`：子代理一轮结束、用户开下一轮之后，用旧任务的 `kill` 不停新一轮，交回“已经结束” |
| subagents.md 提问的提醒 | `subagents.test.ts`：子代理同步提问、父会话空闲时被唤起并回答；父会话在生成回复时子代理提问，同一条回复里的 `wait` 立即交回提问；提醒取走前用户在子会话里答了，提醒撤回、父会话不被唤起 |
| eval.md 重置的提醒 | `eval.test.ts`：空闲回收后会话里有一条提醒（会话关着也有）、下一次 eval 结果仍写“内核已重置”；空闲期间杀掉内核进程，当场有提醒；新内核起来后还没取走的撤回；路径上没跑过 eval 的不发 |
| builtin-tools.md 自动转后台、host-kit.md | nb-harness `shell.test.ts`（注入时钟推过门槛；`prepare` 期间命令结束、调用中止；改名失败留前台；转后台后照原时限超时）；`jobs.test.ts`（接手后输出完整、子会话不转、结束后回执送回） |
| sessions.md 输出 20、29、`runOutcome` | `running-work.test.ts`；`sessions.test.ts`（快照带 `senderOnly`；`runOutcome` 有界） |
| conversation.md 输出 33、36、51 | dom 测试、`session-host.test.ts`（回执没有取消）、`agent-subagents.e2e.ts`（送达之后重开父对话，子代理卡片仍显示终态） |

## 验证

- 后端都用真实内核、本机端点与真实 brush，计时走注入时钟，不按固定时长等。
- 端到端：e2e 里父会话 `async` 派出子代理后结束这一轮，子代理结束后父对话自己接着走、出现“提醒 · 后台任务”的一条，排队区里没有“取消”；停止后再结束的只留在排队区、写“你继续时一起送出”。
- 未验证边界：真实模型下被唤起的运行怎样处理回执（提示词效果）。

## 不做与风险

- 不做：交给工作台清单的行（t42）；Monitor、stdin、eval 单元自动转后台；任务表本身持久化（只记账本）；`ToolJobs` 进插件 SDK。
- 风险：自动唤起会在用户不在时调模型；只在门开着时唤起，被用户停的与重启中断的不唤起，费用上限缺省关。
- 风险：送达未确认的回执要等句柄关闭后重发才定；这之间 `wait` 只能说“可能已在对话里”。
- 风险：账本在任务开始、结束时各写一次；高频起停的后台命令会多一些小文件写。
