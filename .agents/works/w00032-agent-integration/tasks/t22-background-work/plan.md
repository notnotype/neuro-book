# t22 实施计划：Agent 的结果送回会话、`shell` 自动转后台、eval 的提醒、工具登记任务

第 3 稿（2026-11-19，2026-11-23 按开发者的决定改）：按已接受的提案[统一后台任务](../../../../../docs/proposals/unified-background-tasks.md)第四节第 3 小节重写。和第 2 稿相比：送达不再用宿主的 `send{wake}`，改用 t41 做好的缓冲区提醒（唤起与门由内核管）；进工作台清单的行挪到 t42（提供方）；子会话的结果也送（提醒不带唤起）；加子代理提问的提醒、eval 的提醒、写入结果未知时的“送达未确认”。第 2 稿里仍成立的设计（自动转后台的同步移交、工具登记任务的接口、送达的预算、`abort` 的 `runId`）搬过来。

## Context

t14 做了任务中心（`wait`、`kill`、`jobs`，`shell` 与子代理的 `async`）。现在后台任务结束时 Agent 不知道，只能自己 `wait`；`shell` 跑久了不会转后台；eval 的内核被回收或意外退出，模型要到下一次调 eval 才知道；别的插件（t24 的 Workflow）没法把自己的长任务登记成 Agent 的任务。t41 已给内核的缓冲区加了提醒：会话或宿主发 `notice({text, key?, wake?})`，下一次对话请求带上；带唤起的在门开着、会话空闲时开一次运行；门在用户停止、运行不是正常结束时关。

依据：提案第四节第 3 小节（第 1–11 条，第 2 条“交给清单的行”除外，归 t42）与决策记录；[ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md)；[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`agent/eval.md`](../../../../../docs/specs/agent/eval.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 18–31、[`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 30、85、112–118。两轮提案审查里归 t22 的条目（[第一轮](evidences/proposal-review-r1.txt)、[第二轮](evidences/proposal-review-r2.txt)，例如第二轮第 30 条脱敏）作为输入。

开发者已定：README 的“决定”1–17 与提案的决策记录；本稿新提出的四处取舍开发者 2026-11-23 已定（文末“开发者已定的取舍”）。

工作方式：主会话写；审查按 reviewing 的“派给谁”（2026-11-23）：第 1、2 片碰单写者与“只交一次”，用快速审查（Opus 先审，omp `@review` 在后台）；第 3–5 片收口一次 Sonnet；前端一次 Sonnet。

## 技术选型

无通用问题：送达用内核的提醒，计时用注入的时钟，输出记录沿用现有的文件写法。

## 关键设计

### nb-harness 内核：`kernel/run/commands.ts`

提醒不另过拦截（开发者 2026-11-23，见文末取舍 1）：对服务商的遮盖统一在请求拦截（`intercept.model`）做，提醒在请求里只是一段文字，同样拦得到；落盘的原文本来就在任务的输出文件与子会话日志里。

**`abort` 的 `runId`**（提案第 8 条；第 2 稿第 18 条，base 上就有的竞态）：`abort` 加可选 `runId`；给了时只停这次运行，在跑的不是它（已收口、或已是下一次）得 `{aborted: false}`、不动缓冲区、不关门。任务的 `kill`、远程 `killJob` 停子代理时带上任务的 `runId`，不会停到用户在子会话里刚开的下一轮。

### `kit/sessions/table.ts`

加 `onOpened(listener: (sessionId) => void): () => void`：会话被打开（建会话、重开、空闲关闭后再开）时调用。送达用它重试“送达未确认”的那几条。

### `backend/jobs/center.ts`

- **种类开放**：`JobKind` 改成字符串，自己的两种仍叫 `agent`、`shell`，插件登记的是 `<插件 id>.<名字>`；`Job` 加 `label`（“子代理”“命令”“Workflow”），`jobLine`、`wait` 与送达的文字用它。
- **同步领取**（提案第 3 条）：`claim(owner)` 在同一个同步段里挑出能送的并标 `delivery: "claimed"`：已结束、没取过、没有前台在等（`waiters` 为 0）、没有 `wait` 正看着（`watched` 为 0）、没在送的。`wait` 不把 `claimed`、`unconfirmed` 的当候选；点名等一个这样的，交回“它的结果已经（或可能已经）送进对话，不用再等”并视同取过。
- **结算**：`delivered(jobs)` 同 `wait` 交回（结束的移出，提问记 `questionDelivered`）；`returned(jobs)` 只在确定没写时退回，标 `deliveryFailed`，之后只留给 `wait`、不再自动送；`unconfirmed(jobs, commandId)` 标“送达未确认”，记下指令 id。
- **`watched`**：每次 `wait` 开始时给它的每个候选加一、返回时减一；几个并发的 `wait` 各管各的。
- **发布带上前台归属**（第 2 稿第 24 条）：前台的 `agent_send`、`agent_answer` 登记新任务时先 `attach` 再 `start`，送达看到的第一个 `running` 就带着真实的 `waiters`。

### `backend/jobs/delivery.ts`（新）

`JobDelivery` 跟着 `center.onChanged(owner)`，每个会话一条串行队列；以宿主身份 `{kind: "host", source: {plugin: "nbook.agent", label: "后台任务", ref: "jobs:<id>,…"}}` 经会话表的视图发提醒。

一次送达：

1. `claim(owner)`；没有就结束。
2. 正文：开头一句“以下是你启动的后台任务的结果，不是用户说的话；已经交给你了，不用再 wait 它们”。每件一段，用驱动交回的那段文字（命令是 `commandResult`，子代理是 `ChildRuns.report`，插件的任务是它 `end` 时给的）。预算：每段按 UTF-8 至多 12 KiB，超出的留开头并写全文地址（命令是 `output.log`，子代理是存进 `artifacts/` 的全文）；一条提醒至多 30 KiB（内核单条上限 32 KiB），放不下的下一条再送。一件读结果失败只写一行“结果读不出来，用 wait 再取”，不拖住别的。
3. `notice({commandId: "jobs:" + 这批任务 id 的哈希, text, wake: 根会话})`：根会话（会话头没有 `caller`）带唤起，子会话不带。
4. 成功：`delivered`。确定没写（会话打不开、只读、`notice-budget`、`session-closed` 这类受理前的码）：`returned`，诊断 `job-delivery-failed`。结果未知（抛错、`unknown-outcome`、写日志失败）：`unconfirmed`，诊断；会话下次被打开时（`table.onOpened`）用同一个指令 id 重发一次：内核按指令 id 交回第一次的结果（受理过的照原样交回、不再写），没受理过的这次真的写——于是绝不交两次（提案第 4 条；开发者定的“下次打开按提示的 id 查日志再定”用指令 id 落实，见“待开发者确认”3）。
5. 插件停止时 `delivery.close()` 是停止的第一步：之后不再领取。

提醒不是插话：`wait` 与前台等子代理的 `watchSteer` 不因它提前返回（不用改，`watchSteer` 只看 `inputQueued`）。

### 子代理有话问父 Agent：`backend/subagents/children.ts`

任务停在一个还没交过的同步提问上、没有前台在等、没有 `wait` 看着时，送达把它当一件送：段落用 `resultOf` 的提问写法（子会话 id、提问 id、题干、`agent_answer` 的写法），`key: "question:<jobId>"`，根会话带唤起。提醒取走之前提问被答了、任务停了或提问过期（`#follow` 看到 `interactionResolved`、运行收口）：`removeNotice` 撤回，`questionDelivered` 清掉，之后照现在的规则由 `wait` 交回新的状态。

### eval：`backend/eval/tool.ts`

`SessionKernel` 在“空闲”“被回收”“意外退出（两次调用之间发现）”这三种当场知道的重置时，以宿主身份 `{plugin: "nbook.agent", label: "eval"}` 给这个会话发一条不带唤起的提醒：“eval 的内核已重置（空闲 30 分钟回收），之前的变量没了”，`key: "eval-kernel"`（同一会话同一时刻只留一条）。每一代内核只发一次；新内核起来、能用之后（下一次 eval 开始执行），还没取走的撤回。下一次 eval 的结果第一行照旧写“内核已重置”（开发者定：说两遍）。执行中崩溃的那次结果已经说了，不另发；回退、换 Profile、换目录、主动重置是调用时才发现的，只写在结果里（决定 9）。持有者给 `SessionKernel` 一个 `notify(text) / withdraw()` 的小接口，由 `evalTool` 用会话表实现，eval 自己不碰会话。

### `shell` 自动转后台：`packages/nb-harness/src/kit/tools/shell.ts`、`output-capture.ts`

沿用第 2 稿：`ShellBackground` 不变，另加可选的 `ShellAutoBackground`，`shellTool(dialects, background?, auto?)` 不给第三个参数时和现在一样。

```ts
export interface ShellAutoBackground {
    /** 前台跑到它完成就开始接手；null 表示这次不自动转（设置为 0、子会话、代码里调）。用宿主的时钟计。 */
    threshold(request: ShellRequest, signal: AbortSignal): Promise<void> | null;
    /** 接手的第一步（异步）：建好输出位置。交回 null 表示接不了，命令留在前台。 */
    prepare(request: ShellRequest): Promise<BackgroundTarget | null>;
}
export interface BackgroundTarget {
    /** 同步：登记任务、写下已有的输出与统计、交回从此接收输出的出口与给模型的结果。失败时抛错，命令留在前台。 */
    take(handover: Handover): {readonly sink: (error: Error | null, chunk: string) => void; readonly result: ToolResult};
    /** 没用上（命令已结束、调用已中止、`take` 失败）：删掉建好的文件。 */
    discard(): void;
}
export interface Handover {
    readonly prepared: PreparedCommand;
    /** 已有的输出：同一份记录里的字节、总字节数、行数、最后一行、是否已到 64 MiB、读写出错。 */
    readonly output: CapturedOutput;
    readonly done: Promise<ShellResult>;
    abort(): void;
}
```

- 时限不变（开发者定）：命令照原样把 `timeout`（缺省 300 秒）交给 `executeShell`，转后台后仍按它；门槛不短于时限时不转。
- 命令用自己的 `AbortController` 起，接手前跟着 `call.signal`；输出回调经一个可换的出口，接手前进 `OutputCapture`。
- 门槛到了：先 `await prepare()`，这期间输出照常进 capture。然后一个同步步骤：命令已结束或调用已中止就 `discard()`、照前台交回；否则 `take()`，在同一步里把出口换成 `sink`、断开 `call.signal`，工具交回 `result`。`take` 抛错（到上限、正在停止、拷贝失败）就 `discard()`、留在前台。
- `OutputCapture` 加行数、最后一行与 `copyTo(fd)`：没溢出时写内存里的全部，溢出后同步拷暂存文件（至多 64 MiB）；暂存文件出过错时 `take` 失败、留在前台。
- 只对顶层会话：子会话（会话头有 `caller`）与代码里调的 `threshold` 交回 null（提案第 9 条）。

`backend/builtin/shell-background.ts`：`startBackgroundCommand` 拆出“输出记录”（文件、字节与行数、最后一行、截断、出错，收口时写 `status.json` 与 `jobs.end`），`async` 从零开始用它，接手时从 `Handover.output` 接上统计。接手交回：“跑了 60 秒还没结束，已转到后台：任务 job-x，时限照旧（300 秒）。到目前为止的最后几行：……全文写进 <地址>。结束时结果会自动送来，不用 wait 轮询”；`details` 同 `async` 再加 `autoBackground: true`。设置 `nbook.agent/shellAutoBackground`：秒，缺省 60，整数 0–3600，0 为不自动转；只允许用户层，在“运行可靠性”分区。`shell` 与 `wait` 的说明改成结果会自动送来。

### 工具里登记任务：`shared/resources.ts` 的 `AgentToolServices`

沿用第 2 稿的接口，`AgentToolServices` 加 `jobs`：

```ts
interface ToolJobs {
    /** 只能在这次调用的 `execute` 结算之前调；会话与 `invocation` 取自 `call`。 */
    begin(call: ToolContext, input: {kind: string; label: string; summary: string}): {ok: true; job: ToolJob} | {ok: false; code: "concurrency-limit" | "unavailable" | "invalid"};
}
interface ToolJob {
    readonly id: string;
    progress(line: string): void;
    /** 结束时把交给模型的文字一并给出（按 UTF-8 至多 12 KiB，超出截断并注明），之后不再向插件取任何东西。 */
    end(state: "completed" | "failed" | "aborted", text: string): void;
    /** 用户或 Agent 停它：插件在这里停掉自己的工作，再 `end`。 */
    onKill(handler: (byUser: boolean) => void | Promise<void>): void;
}
```

- 登记权绑定真实调用（提案第 7 条）：Agent 包工具实现的那一层（`backend/tools.ts`）在 `execute` 进行期间把 `call.invocation` 记进在跑的调用表，`begin` 只认表里的、并且是贡献这个工具的插件这一代的；`kind` 盖成 `<插件 id>.<kind>`，`label`、`summary` 校验长度（不合格得 `invalid`，不占名额）。
- 插件的 `agent.tools` 贡献撤回时：封住这一代（之后的 `begin` 得 `unavailable`，句柄的调用不起作用），它登记的在跑任务按 `interrupted` 收口，没开始的名额退回。
- 外部种类在 `jobs`、`wait`、远程 `jobs` 里照常列出，`kind` 带插件前缀可辨认。不进插件 SDK（要给第三方时再从 SDK 的 `/agent` 导出）。

### 在跑的工作：`backend/running-work.ts`

提案第 1 条“同一个子代理执行报两次”：子会话在跑时已经归到根会话报一项，`agent` 任务不再另报；`shell` 与插件登记的任务照旧每件一项。手动压缩照旧算会话在跑（核对 `activityWithBackground` 已含，不含就补）。

### 前端：`packages/neuro-book/src/plugins/agent/web/`、`packages/nb-agent-ui/`

- 送达的提醒在 t41 已经能显示：排队区是“提醒 · 后台任务”的行，取走后是消息流里的一条提醒，不用新画法。
- 子代理卡片（conversation.md 输出 33）：结果经提醒送达后任务已从表里移出，卡片没有 `wait` 交回的终态时，按自己的子会话 id 与 `runId` 经远程读那次运行的 `runResult` 取终态与首句（提案第 11 条；同一运行回退后接着跑时读到最近一次，记已知限制）。
- 自动转后台的 `shell`：结果带 `details.jobId` 与 `autoBackground` 时画成后台命令卡片（conversation.md 输出 36），卡头注明“自动转到后台”。

## Spec 与文档改动

先在 master 上写成 planned：

- `harness/runtime.md`：新输出 119 `abort` 的 `runId`。
- `harness/host-kit.md`：可选的 `ShellAutoBackground` 与一次同步移交；会话表的 `onOpened`。
- `agent/jobs.md`：“不承诺”去掉通知与自动转后台；新输出：送达（何时、根会话唤起子会话不唤起、发出者、预算、成功失败与送达未确认）、与 `wait` 和前台等待的关系（领取、`watched`、点名等已领取的）、工具里登记的任务种类、`kill` 与 `killJob` 带 `runId`；状态表与“时序与寿命”补领取与送达；验收 4 改写（闲置后结束，会话被重开、结果进了实际的模型请求、之后 `wait` 不再交回它）。
- `agent/subagents.md`：同步提问送提醒、答了或停了就撤回。
- `agent/eval.md`：三种当场知道的重置发提醒、新内核起来撤回、结果里照旧写。
- `agent/builtin-tools.md`：新输出自动转后台；设置表加 `shellAutoBackground`。
- `agent/sessions.md` 输出 20：子代理的执行只报一项。
- `agent/conversation.md`：输出 33 子代理卡片读 `runResult`；输出 36 自动转后台的卡头。

## 切片

1. **内核**：`abort` 的 `runId`；`runtime.md` planned。验证：nb-harness `bun test src/kernel`、typecheck。
2. **领取与送达**：`center.ts`、`delivery.ts`、`table.onOpened`、子代理的提问提醒与撤回、`kill` 带 `runId`；`jobs.md`、`subagents.md`、`host-kit.md`（`onOpened`）planned。验证：`jobs.test.ts`、`subagents.test.ts`、nb-harness `kit/sessions` 测试、typecheck。做完单独交一次 omp 实现审查（与第 3 片并行）。
3. **eval 的提醒**：`eval/tool.ts`；`eval.md` planned。验证：`eval.test.ts`（注入时钟推过空闲时限、登记表回收、杀掉内核进程）。
4. **自动转后台**：kit `shell.ts`、`output-capture.ts`，`shell-background.ts`、设置；`host-kit.md`、`builtin-tools.md` planned。验证：nb-harness `kit/tools/shell.test.ts`，neuro-book `jobs.test.ts`、`builtin-tools.test.ts`。
5. **工具里登记任务**与在跑的工作：`resources.ts`、`tools.ts` 的在跑调用表、撤回时收口；`running-work.ts`。验证：`jobs.test.ts` 用真实插件装配的测试工具、`running-work.test.ts`。
6. **对话界面**：子代理卡片读 `runResult`、自动转后台的卡头。验证：dom 测试、`e2e/agent-subagents.e2e.ts`。

每片跑受影响的测试与 typecheck、单独提交。第 1、2 片做完一次快速审查（Opus 加后台 omp），第 3–5 片收口一次 Sonnet，第 6 片一次 Sonnet。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| runtime.md 输出 119 | nb-harness 内核合同测试：`abort{runId}` 对已收口的、下一次运行得 `aborted: false`、不动缓冲区、不关门 |
| jobs.md 送达 | `jobs.test.ts`：根会话空闲时唤起（含句柄空闲关闭之后）、在跑时随下一次请求带上、子会话不唤起、用户停过之后不唤起而随下一句话带上、送达失败留给 `wait`、超预算写地址、几件同时结束合成一条；断言结果进了实际的模型请求且只一次，不靠预写的模型回复 |
| jobs.md 送达未确认 | `jobs.test.ts`：模拟写日志失败的会话存储（真实存储加故障注入，同 nb-harness 现有的写失败测试）：结果未确认、`wait` 不交回，重开后同一个指令 id 重发，日志里只有一条 |
| jobs.md 与 `wait` 的关系 | `jobs.test.ts`：`wait()` 期间结束的由 `wait` 交回；两个重叠的 `wait` 一个先超时；读结果期间点名 `wait` 同一个只交回一次；点名等已送的得“已送进对话” |
| jobs.md 工具登记的种类 | `jobs.test.ts`：测试插件的工具登记一种任务，`wait`、`kill`、送达照常；`kind` 盖成插件前缀；`execute` 结算后再登记无效；插件停止后它的任务为 `interrupted`、句柄封住 |
| jobs.md `kill` 带 `runId` | `subagents.test.ts`：子代理一轮结束、用户开下一轮之后，用旧任务的 `kill` 不停新一轮 |
| subagents.md 提问的提醒 | `subagents.test.ts`：子代理同步提问、父会话空闲时被唤起并用 `agent_answer` 回答；提醒取走前用户在子会话里答了，提醒撤回、父会话不被唤起 |
| eval.md 重置的提醒 | `eval.test.ts`：空闲回收后会话里有一条提醒、下一次 eval 结果仍写“内核已重置”；新内核起来后还没取走的撤回；执行中崩溃不另发 |
| builtin-tools.md 自动转后台、host-kit.md | nb-harness `shell.test.ts`（注入时钟推过门槛；`prepare` 期间命令结束、调用中止；`take` 失败留前台；转后台后照原时限超时；超 64 MiB 后 `truncated` 与行数对）；`jobs.test.ts`（接手后输出完整、子会话不转、父会话中止不影响、结束后结果送回） |
| sessions.md 输出 20 | `running-work.test.ts`：子代理在跑时只有一项 |
| conversation.md 输出 33、36 | dom 测试与 `agent-subagents.e2e.ts`（送达之后重开父对话，子代理卡片仍显示终态） |

## 验证

- 后端都用真实内核、本机端点与真实 brush，计时走注入时钟，不按固定时长等。
- 端到端：e2e 里父会话 `async` 派出子代理后结束这一轮，子代理结束后父对话自己接着走、出现“提醒 · 后台任务”的一条；停止后再结束的只留在排队区、写“你继续时一起送出”。
- 未验证边界：真实模型下被唤起的运行怎样处理结果（提示词效果）；64 MiB 同步拷贝的耗时只在本机测一次。

## 不做与风险

- 不做：交给工作台清单的行（t42）；Monitor、stdin、eval 单元自动转后台、任务表持久化、重启后补送；`ToolJobs` 进插件 SDK。
- 风险：自动唤起会在用户不在时调模型；只在门开着时唤起（用户停过、出错、中断之后都不唤起），费用上限缺省关。
- 风险：接手时一次性同步拷贝至多 64 MiB 的暂存文件，会让服务端在这一刻停顿（估计几十毫秒）。
- 风险：送达未确认的结果要等会话下次被打开才定；这之间 `wait` 不交回它（宁可晚，不交两次）。

## 开发者已定的取舍（2026-11-23）

1. **提醒不另过拦截**：提案第 3 小节第 5 条“与 `wait` 一样的脱敏”改为：对服务商的遮盖统一在请求拦截做（提醒在请求里同样拦得到）；落盘的原文本来就在任务的输出文件与子会话日志里，提醒再存一份不多暴露（开发者：脱敏不是在请求发给服务商时做吗，为什么搞这么麻烦）。提案追加决策记录。
2. **子会话也送**：照提案，子会话的后台结果作为不带唤起的提醒，随子代理下一次请求带上；不唤起，免得在父 Agent 不知情时开新的子代理运行。
3. **送达未确认用指令 id 落实**：写入结果未知时拿不到提醒 id，改用发提醒的指令 id；会话下次被打开时同一个指令 id 重发一次，受理过的只交回原结果、不再写。任务中心与内核在同一个进程里，这只在写日志出错时出现。
4. **eval 提醒的 `key`**：同一会话一个 `key: "eval-kernel"`，只留最新的一条（实际很难叠起来：新内核起来时还没取走的就撤回了）。
