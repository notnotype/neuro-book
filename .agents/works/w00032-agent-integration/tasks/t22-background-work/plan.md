# t22 实施计划：后台任务结束通知、自动转后台、进工作台清单、任务种类开放

第 2 稿（2026-11-19）：按设计审查（omp，27 条，见 [README](README.md) 的“设计审查”）改。和第 1 稿相比：唤起与否改由内核在单写者里判；送达与 `wait` 改成同步领取；去掉“子代理等自己的后台工作”；自动转后台保留原时限、接手改成一次同步移交；任务种类开放改成只在工具调用里登记；后台会话进清单挪到 t24（待开发者确认）。

## Context

t14 做了任务中心（`wait`、`kill`、`jobs`，`shell` 与子代理的 `async`），t34 做了工作台的“后台任务”清单。还缺：后台任务结束时 Agent 不知道，只能自己 `wait`；`shell` 跑久了不会转后台；用户在别的对话里看不到某会话的后台任务；别的插件（t24 的 Workflow）没法把自己的长任务登记成 Agent 的任务。

依据：[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 18–31、[`agent/run-guards.md`](../../../../../docs/specs/agent/run-guards.md)、[`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 2–7、28–31、36、85、88、103–110、[`workbench/background-tasks.md`](../../../../../docs/specs/workbench/background-tasks.md)。

开发者已定：README 的“决定”1–6。第 2 稿改动了其中两处的范围，见文末“待开发者确认”。

工作方式：主会话写；内核与送达这一片做完先单独交 omp 实现审查（时序最难），其余后端片收口一次 omp，前端片一次 Sonnet。

## 技术选型

无通用问题：送达用内核的输入缓冲区，计时用注入的内核时钟，清单用 `nbook.tasks`。

## 关键设计

### nb-harness 内核：`kernel/run/commands.ts`、`run/settle.ts`、`state/kernel-state.ts`

三处小改，都在单写者的同一项里判定（审查第 1、18、19、23 条：在内核外先读状态再发话，挡不住用户的停止与收口窗口）。

1. **`send` 的 `wake: "after-completed"`**（只给会话与宿主身份）：会话有运行在取输入时同普通 `send`（`steer` 在下一个边界进这一轮）。空闲时，只有叶子上最后一次对话运行以 `completed` 收口（或还没有对话运行）才开运行；否则不开运行，这条话留着，原因 `{queued: "awaiting-user", end: 那次运行的收口方式}`。运行不再取输入时（停止已受理、已决定收口、只压缩），开不开推迟到收口批里按同样的规则判：刚收口的这次不是 `completed`（或只压缩时叶子上最后一次对话运行不是）就留着。`aborted`、`error`（含运行守卫的循环保护与费用上限）、`interrupted`、暂停都算“不是 `completed`”，所以用户停过、守卫停过、进程中断过的会话都不会被后台结果唤起。
2. **“等用户”的留着只有用户能放行**：`cause.queued` 为 `awaiting-user` 的条目在输出 105 的表里同 `heldBy` 为用户的条目，会话、宿主放行不了。回退、换分支不放行它；用户下一句话放行全部留着的话（现有规则），它们先于新话进去。
3. **`abort` 的 `runId`**：给了时只停这次运行，它已经收口（或在跑的不是它）得 `{aborted: false}`、不动缓冲区。任务的 `kill`、远程 `killJob` 与工作台的取消都带上任务的 `runId`，不会停到用户刚开的下一轮（审查第 18 条；这是 base 上就有的竞态，清单多了一个入口才更容易撞上）。

`runtime.md` 补这三条（planned），探针先跑：用真实内核列出下面每条路径的结果再写 Spec：在跑取输入、等审批、暂停、只压缩在跑、停止已受理未收口、决定收口那一项、正常收口、`error` 收口、守卫停、`interrupted` 后重开、开不起运行、会话关闭中。

### `packages/neuro-book/src/plugins/agent/backend/jobs/center.ts`

- `JobKind` 改为字符串：自己的两种仍叫 `agent`、`shell`；插件登记的是 `<插件 id>.<名字>`。`Job` 加 `label`（“子代理”“命令”“Workflow”），`jobLine` 与 `wait` 的文字用它。
- **同步领取**（审查第 2 条）：`claim(owner)` 在同一个同步段里挑出可送的任务并把它们标成 `claimed`：已结束没取过、`waiters` 为 0、`watched` 为 0 的，以及停在一个还没交过的提问上的。`wait` 不把 `claimed` 的当候选；点名等一个 `claimed` 的，交回“它的结果已经送进对话”并视同取过。`deliveryCommitted(jobs)` 同 `wait` 交回（结束的移出，提问记 `questionDelivered`）；`deliveryAbandoned(jobs)` 只在确定没写进缓冲区时退回，并记 `deliveryFailed`，之后只留给 `wait`、不再自动送，免得反复重试。
- **发布时带上前台归属**（审查第 24 条）：前台的 `agent_send`、`agent_answer` 登记新任务时先 `attach` 再发布（`start`），镜像与送达看到的第一个 `running` 就带着真实的 `waiters`。
- **`watched` 计数**（审查第 13 条）：每次 `wait` 开始时给它的每个候选加一、返回时各减一；几个并发的 `wait` 各管各的。

### `backend/jobs/delivery.ts`（新）

`JobDelivery` 跟着 `center.onChanged(owner)`，每个会话一条串行队列。只送给根会话（会话头没有 `caller`）：子会话自己的后台任务照旧等子会话里的 `wait`（审查第 3、4 条，见“待开发者确认”2）。

一次送达：

1. `claim(owner)`；没有就结束。
2. 文字：开头一句“以下是你启动的后台任务的结果，不是用户说的话；不用再 wait 它们”。每个任务一段，用驱动的结果：命令是 `wait` 交回的同一段，子代理是 `ChildRuns.report` 的全文（已带子会话 id、提问 id 与 `agent_answer` 的写法，结束与在问分开写，审查第 12 条）。预算（审查第 11 条）：每段至多 12,000 字符，超出的留开头并写全文地址（命令是 `output.log`，子代理是已存进 `artifacts/` 的全文）；一条至多 8 段、按 UTF-8 至多 64 KiB，多的留到下一条。整段包在 `<system-reminder>` 里，段内出现的 `<system-reminder>`、`</system-reminder>` 转义。
3. 发出者 `{kind: "host", source: {plugin: "nbook.agent", label: "后台任务", ref: "jobs:<id>,…"}}`，`commandId` 由任务 id 定（重试同一个），`send({mode: "steer", wake: "after-completed"})`。
4. 成功（插话、开了运行、留着等用户都算）：`deliveryCommitted`。确定没写（会话打不开、`input-rejected`、`session-closed` 等受理前的失败码）：`deliveryAbandoned`，诊断 `job-delivery-failed`。结果未知（抛错、`unknown-outcome`）：同一个 `commandId` 重发一次，仍未知就当作已送（宁可少送也不送两次），诊断。
5. 插件停止时，`delivery.close()` 是停止的第一步：之后不再领取。已经发出的那一次若在会话关闭前受理并开了运行，随会话按 `interrupted` 收口，与那一刻用户发的话一样（审查第 14 条，接受取舍）。

`jobs/steer.ts` 的 `watchSteer`（订阅与开头那次快照两处）不把这类插话算作插话：`wait([A])` 期间 B 的结果进缓冲区，等 `wait` 返回后的边界再进；前台等子代理同样。

### `packages/nb-harness/src/kit/tools/shell.ts`、`output-capture.ts`：自动转后台

`ShellBackground`（`async: true` 的那个函数）不变；另加一个可选的 `ShellAutoBackground`，`shellTool(dialects, background?, auto?)` 多一个参数，不给就和现在一样（审查第 26 条：套件按源码发布、允许别的宿主单独用，不做破坏性改动）：

```ts
export interface ShellAutoBackground {
    /** 前台跑到它完成就开始接手；null 表示这次不自动转（设置为 0、子会话）。用宿主的时钟计。 */
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
    /** 已有的输出：同一个记录里的字节、总字节数、行数、最后一行、是否已到 64 MiB、读写出错（审查第 6 条）。 */
    readonly output: CapturedOutput;
    readonly done: Promise<ShellResult>;
    abort(): void;
}
```

- 时限不变（审查第 5 条，同 omp）：命令照原样把 `timeout`（缺省 300 秒）交给 `executeShell`，转后台后仍按它；门槛不短于时限时不转。
- 命令用自己的 `AbortController` 起，接手前跟着 `call.signal`；输出回调经一个可换的出口，接手前进 `OutputCapture`。
- 门槛到了：先 `await prepare()`，这期间输出照常进 capture。然后一个同步步骤：命令已结束或调用已中止就 `discard()`、照前台交回；否则 `take()`，在同一步里把出口换成 `sink`、断开 `call.signal`，工具交回 `result`。`take` 抛错（到上限、正在停止、拷贝失败）就 `discard()`、留在前台。
- `OutputCapture` 加行数、最后一行，与 `copyTo(fd)`：没溢出时写内存里的全部，溢出后同步拷暂存文件（至多 64 MiB，一次性的同步拷贝）；暂存文件出过错时 `take` 失败、留在前台。
- 代码里调的不转；子会话里不转（宿主的 `threshold` 交回 null，见“待开发者确认”2）。

### `backend/builtin/shell-background.ts`

`startBackgroundCommand` 拆出“输出记录”（`CommandOutput`：文件、字节与行数、最后一行、截断、出错，收口时写 `status.json` 与 `jobs.end`），`async` 从零开始用它，接手时从 `Handover.output` 接上统计再用它。接手交回：“跑了 60 秒还没结束，已转到后台：任务 job-x，时限照旧（300 秒）。到目前为止的最后几行：……全文写进 <地址>。结束时结果会自动送来，不用 wait 轮询”；`details` 同 `async` 再加 `autoBackground: true`。

设置 `nbook.agent/shellAutoBackground`：秒，缺省 60，整数 0–3600，0 为不自动转；只允许用户层，在“运行可靠性”分区。`shell` 的说明加“跑过 N 秒还没结束会转到后台、结果会自动送来（子代理里不转）”；`wait` 的说明改成“后台任务的结果会自动送来，只在接下来的事要等它时用”。

### 任务种类开放：`shared/points.ts` 的 `AgentToolServices`

只在工具调用里登记（审查第 7、10、15 条）：`AgentToolServices` 加 `jobs`，插件的工具实现在 `execute` 里调。

```ts
interface ToolJobs {
    /** 只能在这次调用的 `execute` 结算之前调；会话与 `invocation` 取自 `call`，调用方给不了别的。 */
    begin(call: ToolContext, input: {kind: string; label: string; summary: string}): {ok: true; job: ToolJob} | {ok: false; code: "concurrency-limit" | "unavailable" | "invalid"};
}
interface ToolJob {
    readonly id: string;
    progress(line: string): void;
    /** 结束时把交给模型的文字一并给出（至多 12,000 字符，超出截断并注明），之后不再向插件取任何东西。 */
    end(state: "completed" | "failed" | "aborted", text: string): void;
    /** 用户或 Agent 停它：插件在这里停掉自己的工作，再 `end`。 */
    onKill(handler: (byUser: boolean) => void | Promise<void>): void;
}
```

- 一份核心：`JobCenter` 的登记、占名额、收口与送达规则只有一套；`agent`、`shell` 直接用核心（它们要的前台跟随、提问、子会话目标不对外），`ToolJobs` 是核心上限权的一层，`kind` 盖成 `<贡献这个工具的插件>.<kind>`、`label` 与 `summary` 校验长度（不合格得 `invalid`，不占名额）。
- 插件停止（它的 `agent.tools` 贡献被撤回）时：它登记的在跑任务按 `interrupted` 收口，`ToolJob` 句柄封住，之后的调用不起作用。
- 不进插件 SDK：现在只给内置插件（t24 的 Workflow），要给第三方时再从 SDK 的 `/agent` 导出。

### `backend/jobs/mirror.ts`（新）：Agent 的后台任务进工作台清单

- 任务第一次成为后台任务（在跑、`waiters` 为 0）时 `tasks.start`：标题“<label>：<summary>”（文字引用参数按编码后的预算截，审查第 17 条），进展是最后一行，可取消，`notify: false`，`open` 指向打开对话（子代理是子会话，其余是启动它的会话）。之后又被前台等着不撤；结束时按状态 `succeed`、`fail`、`cancelled`、`interrupted`。用户取消即以用户身份 `kill`（带 `runId`）。一直在前台等着的任务不进清单。
- 镜像出错（校验失败、推送失败）只记诊断，不影响任务的状态转换：镜像跟在 `onChanged` 之后，异常不传回任务中心。
- 进了清单的任务由 `nbook.tasks` 向宿主报“在跑的工作”，Agent 的报告不再列它们（审查第 17 条）；前台的仍由 Agent 报。
- 打开对话的命令 `nbook.agent.focus-session` 在布局没就绪时要报不可用，而不是报成功（审查第 22 条）。

### `packages/neuro-book/src/plugins/tasks/`：清单补三样

- `TaskInput.notify?: boolean`（缺省 true）：false 时结束不弹通知。
- `TaskInput.open?: {command: string; args?: JsonValue}`：命令 id 与参数过远程合同校验，参数序列化后至多 1 KiB；视图的行上有“打开”按钮，这个窗口里命令不可用时按钮不可用，执行失败时在窗口提示。只在视图里，不进通知。
- `TaskHandle.interrupted(message?)`：发起方自己把一件在跑的任务记成已中断（审查第 16 条），同发起方入口停止时的已中断。
- 远程 `nbook.tasks/tasks` 合同版本 1 → 2（`TaskItemSchema` 不收额外字段，审查第 9 条），清单每项加 `notify`、`open`。

### 前端：`packages/neuro-book/src/plugins/agent/web/`、`packages/nb-agent-ui/`

- 送达的话在对话里画成过程里的一行（不是用户气泡）：“后台任务有结果：<label> <摘要> <状态>”，几个时写个数，点开看全文；按发出者的 `plugin` 与 `ref` 认，标签按界面语言翻。留着等用户的照“排队的消息”现有画法显示，原因写“你下一句话时一起送出”。
- 子代理卡片（conversation.md 输出 33）在没有 `wait` 交回的终态时，按自己的 `runId` 经远程读子会话的 `runResult` 取终态与首句（审查第 25 条：送达把任务取走之后，卡片不能再靠后来的 `wait` 结果，`tree.runs` 只有收口方式、旧运行还会被挤出）。
- 自动转后台的 `shell` 调用：结果带 `details.jobId` 与 `autoBackground` 时画成后台命令卡片（conversation.md 输出 36），卡头注明“自动转到后台”。
- 后台任务视图：“打开”按钮。

## Spec 与文档改动

先跑内核探针，再在 master 上把下列条目写成 planned：

- `harness/runtime.md`：`send` 的 `wake`、`awaiting-user` 的留着与放行（输出 105 的表）、`abort` 的 `runId`（新输出接在末尾）。
- `harness/host-kit.md`：可选的 `ShellAutoBackground` 与一次同步移交（新输出 12）。
- `agent/jobs.md`：“不承诺”去掉通知与自动转后台，加“子会话的后台任务不送达”“后台会话不进清单（t24）”；新输出 13 送达（何时、只送根会话、发出者、`wake`、成功失败与未知、预算）、14 与 `wait` 和前台等待的关系（领取、`watched`、点名等已领取的、`watchSteer`）、15 工具里登记的任务种类、16 进工作台清单（含“在跑的工作”只报一次）、17 `kill`、`killJob` 带 `runId`；状态表与“时序与寿命”补领取与送达；验收 4（闲置后 `wait` 仍取得到）改写：句柄空闲关闭之后任务结束，会话被重开、结果进了实际的模型请求、之后 `wait` 不再交回它；另补“空闲时唤起”“停过、守卫停过不唤起、下一句话放行”“回退不放行”（审查第 27 条）。
- `agent/builtin-tools.md`：新输出 31 自动转后台；设置表加 `shellAutoBackground`；输出 27 链到它。
- `workbench/background-tasks.md`：“不承诺”去掉“Agent 自己的后台工作”；新输出 18 `notify`、19 `open`、20 `interrupted()`；远程合同版本 2。
- `agent/conversation.md`：新输出 51 送达的话的画法；输出 36 补自动转后台的卡片。
- `agent/sessions.md` 输出 20（在跑的工作）：进了清单的任务不再由 Agent 报。

## 切片

1. **内核**：探针（结果存 `evidences/kernel-probe.txt`），`runtime.md` planned，`wake`、`awaiting-user`、`abort` 的 `runId`。验证：nb-harness `bun test src/kernel`（缓冲区与运行控制的合同测试）、typecheck。
2. **领取与送达**：`center.ts`、`delivery.ts`、`steer.ts`、`children.ts` 的 `kill` 带 `runId`、装配；`jobs.md` planned。验证：`jobs.test.ts`、`subagents.test.ts`、typecheck。做完单独交一次 omp 实现审查（与第 3 片并行）。
3. **自动转后台**：kit `shell.ts`、`output-capture.ts`，`shell-background.ts`、设置；`host-kit.md`、`builtin-tools.md` planned。验证：nb-harness `src/kit/tools/shell.test.ts`，neuro-book `jobs.test.ts`、`builtin-tools.test.ts`。
4. **工具里登记任务**：`points.ts`、工具盒给 `jobs`、撤回时收口。验证：`jobs.test.ts` 用真实插件装配的测试工具。
5. **工作台清单**：`plugins/tasks` 三样与版本 2、`mirror.ts`、running-work；`background-tasks.md` planned。验证：`tasks.test.ts`、`store.test.ts`、`running-work.test.ts`、`jobs.test.ts`、`e2e/background-tasks.e2e.ts`。
6. **对话界面**：送达的行、留着的原因、自动转后台的卡片、清单的“打开”。验证：dom 测试、`e2e/agent-subagents.e2e.ts`、Lab 场景。

每片跑 `bun run test:affected` 与 typecheck、单独提交。第 3–5 片收口一次 omp 实现审查，第 5、6 片的浏览器端一次 Sonnet。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| runtime.md 新输出（`wake`、`awaiting-user`、`abort` 的 `runId`） | nb-harness 内核合同测试：探针列的每条路径一例；停止已受理时到达、只压缩时到达、守卫停后、回退后再来一条、用户下一句放行两条 |
| jobs.md 输出 13 | `jobs.test.ts`“送达”：在跑时插话、空闲时唤起（含句柄空闲关闭之后）、停过留着并随下一句放行、送达失败留给 `wait`、超预算的写地址、子会话不送；断言结果进了实际的模型请求且只一次，不靠预写的模型回复 |
| jobs.md 输出 14 | `jobs.test.ts`：`wait()` 期间结束的由 `wait` 交回；两个重叠的 `wait` 一个先超时；`wait([A])` 期间 B 结束不让它返回；读结果期间点名 `wait` 同一个只交回一次 |
| jobs.md 输出 15 | `jobs.test.ts`：测试插件的工具登记一种任务，`wait`、`kill`、送达照常；`kind` 盖成插件前缀；`execute` 结算后再登记无效；插件停止后它的任务为 `interrupted`、句柄封住 |
| jobs.md 输出 16、sessions.md 输出 20 | `jobs.test.ts`、`tasks.test.ts`、`running-work.test.ts`：后台任务进清单、前台派发与前台续用都不进、前台超时转后台只建一次、取消即带 `runId` 的 `kill`、宿主只报一项、超长标题不打断收口 |
| jobs.md 输出 17 | `subagents.test.ts`：子代理一轮结束、用户开下一轮之后，用旧任务的 `kill` 不停新一轮 |
| builtin-tools.md 输出 31、host-kit.md 输出 12 | nb-harness `shell.test.ts`（注入时钟推过门槛；`prepare` 期间命令结束、调用中止；`take` 失败留前台；转后台后照原时限超时；超 64 MiB 后不再输出时 `truncated` 与行数对）；`jobs.test.ts`（接手后输出完整、父会话中止不影响） |
| background-tasks.md 输出 18–20 | `tasks.test.ts`、`store.test.ts`、`background-tasks.e2e.ts`（“打开”、命令不可用时按钮不可用、`notify: false` 不弹、`interrupted()`、v1 调用方得版本不符） |
| conversation.md 输出 51、36、33 | dom 测试与 `agent-subagents.e2e.ts`（送达之后重开父对话，子代理卡片仍显示终态） |

## 验证

- 后端都用真实内核、本机端点与真实 brush，计时走注入时钟，不按固定时长等。
- 端到端：e2e 里父会话转后台一条命令后结束这一轮，命令结束后对话自己接着走、出现送达的行；停止后再结束的命令只出现在排队的消息里。
- 未验证边界：真实模型下被唤起的运行怎样处理结果（提示词效果）；64 MiB 同步拷贝的耗时只在本机测一次。

## 不做与风险

- 不做：Monitor、stdin、eval 单元自动转后台、任务表持久化、重启后补送；子会话的送达与自动转后台；后台会话进清单（t24）；`ToolJobs` 进插件 SDK。
- 风险：自动唤起会在用户不在时调模型，费用上限缺省关；只在上一次运行正常结束后唤起，守卫与停止都会挡住。
- 风险：接手时一次性同步拷贝至多 64 MiB 的暂存文件，会让服务端在这一刻停顿（本机估计几十毫秒）。
- 风险：送达与用户同时打字时两条话的先后由缓冲区定。

## 待开发者确认

1. **后台会话进清单挪到 t24**（改决定 4 的一半）：现在没有产品代码起后台会话（`startTask` 的 `background` 只有测试在用）；内置 `ask` 在后台会话里直接不可用，只有审批会等用户；按运行建清单项、“等你处理”的提醒与重连对账都要另做（审查第 8、20、21 条）。t24 本来就要定 Workflow 起的会话里提问交给谁，清单怎样显示跟着那个决定做更合适。代价：t22 做完后，后台会话等审批时用户在别处看不到，直到 t24。
2. **子会话不送达、不自动转后台**（收窄决定 1；取消第 1 稿的“子代理等自己的后台工作”）：第 1 稿让父会话的任务跨子会话的几次运行，审查指出这会破坏“一个任务一次运行”在卡片、续用、中止上的身份约束（第 3、4 条）。现在子会话照旧：它的后台任务等它自己的 `wait`，命令不自动转后台。代价：子代理用 `async` 起了命令又结束这一轮，结果仍要父 Agent 续用它时它自己去取，与现在相同。
3. **唤起只在上一次运行正常结束之后**（比决定 1 的“用户停的不唤起”更严）：出错、守卫停、进程中断之后也不唤起，结果留着、随用户下一句话送出（第 19 条：否则后台结果会绕过循环保护）。
4. **自动转后台照原时限**（取消第 1 稿的“转后台后不设时限”）：没写 `timeout` 的命令转后台后仍在 300 秒到时停，同 omp（第 5 条）。要跑更久的，模型写 `timeout` 或用 `async`。
