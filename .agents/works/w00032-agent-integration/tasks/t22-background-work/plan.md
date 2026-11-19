# t22 实施计划：后台任务结束通知、自动转后台、进工作台清单、任务种类开放

## Context

t14 做了任务中心（`wait`、`kill`、`jobs`，`shell` 与子代理的 `async`），t34 做了工作台的“后台任务”清单。还缺：后台任务结束时 Agent 不知道，只能自己 `wait`；`shell` 跑久了不会转后台；用户在别的对话里看不到某会话的后台任务；别的插件（t24 的 Workflow）没法把自己的长任务登记成 Agent 的任务。

依据：[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)（“不承诺”里的几项）、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 18–30、[`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md)、[`workbench/background-tasks.md`](../../../../../docs/specs/workbench/background-tasks.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 3、28、85、103–107。

开发者已定（2026-11-19，[README](README.md) 的“决定”1–6）：结果送回启动它的会话，空闲时以宿主身份开运行，上一次是用户停的不唤起；`shell` 前台过 60 秒自动转后台；不做 Monitor 与 stdin；Agent 的后台任务与后台会话进工作台清单，命令与子代理结束不弹通知、后台会话等你处理时弹；任务中心对别的服务端插件开放登记；任务表照旧不存盘。

工作方式：主会话写；设计审查交 omp（阻塞），实现审查每片收口后一次（后端 omp、前端 Sonnet）。

## 技术选型

无通用问题：送达用内核现成的输入缓冲区（宿主身份的 `send`、`enqueue`），计时用注入的内核时钟，清单用 `nbook.tasks`。

## 关键设计

### `packages/neuro-book/src/plugins/agent/backend/jobs/center.ts`

- `JobKind` 改为字符串：自己的两种仍叫 `agent`、`shell`；别的插件登记的是 `<插件 id>.<名字>`（门面盖章，见下文“任务种类开放”）。`Job` 加 `label`（给模型与界面的一个词：“子代理”“命令”“Workflow”），`jobLine` 与 `wait` 的文字用它。
- 加 `watched`：正在被某个 `wait` 当作候选的次数，`wait` 开始时给候选加一、返回时减一。送达跳过它们（`wait` 自己交回）。
- 加 `deliverable(owner)`：这个会话启动的、没人在前台等（`waiters` 为 0）、没被 `wait` 看着的任务里，已结束没取过的，和停在一个还没交过的提问上的。加 `markDelivered(jobs)`，与 `wait` 交回时的处理相同（结束的视同取过并移出；提问记 `questionDelivered`）。

### `backend/jobs/delivery.ts`（新）

`JobDelivery` 跟着 `center.onChanged(owner)`，每个会话一条串行队列，同一时间只有一次送达在做，做完再看一遍 `deliverable`，这期间结束的合成下一条。

一次送达：

1. 取 `deliverable(owner)`；空就结束。
2. 文字：每个任务一段，结束的用 `driver.result()`（与 `wait` 交回的完全相同），提问写“在问你（提问 id）……用 agent_answer 回答”；开头一句“后台任务有结果了，不用再 wait 它们”。
3. 发出者 `{kind: "host", source: {plugin: "nbook.agent", label: "后台任务", ref: "jobs:<id>,<id>"}}`，经句柄表打开会话的视图（会话已空闲关闭时照常打开）。
4. 读路径上最后一次对话运行：空闲且它以 `aborted` 收口、`stoppedBy` 是用户时，用 `enqueue`（空闲时留着，用户下一句话放行它、先于新话进去，runtime 输出 3、105）；否则用 `send({mode: "steer"})`：在跑时是插话、下一个边界进这一轮，空闲时开一次运行（`runStarted.by` 是宿主）。`send` 因开不起运行失败（只读、模型解析失败等）时改用 `enqueue`。
5. 写进缓冲区成功才 `markDelivered`；会话打不开、两种写法都失败时记诊断 `job-delivery-failed`，任务留着等 `wait`。
6. 插件停止时（任务中心 `close` 之后）不再送达。

`jobs/steer.ts` 的 `watchSteer` 不把这类插话（宿主、`plugin` 为 `nbook.agent`、`ref` 以 `jobs:` 开头）算作插话：`wait([A])` 期间 B 结束，B 的结果进缓冲区、等 `wait` 返回后的边界再进，不让 `wait` 以“用户插话了”提前返回。

### `backend/subagents/children.ts`：子代理等自己的后台工作

子会话自己转后台的任务结束时同样送回子会话、唤起它。父会话的那个 `agent` 任务在子会话的运行收口后先看子会话还有没有后台工作（它启动的在跑任务，或排着、在做的送达）：有就不结束，跟着送达开的下一次运行（更新 `job.target.runId`，算调用方自己开的运行，父会话中止时一样连带）；没有才按这次运行的结果结束（omp 同样：子代理的运行要等它的后台任务都送达才算结束）。这期间父会话 `kill` 它：中止子会话在跑的运行，并停掉子会话启动的在跑任务。子会话的运行被用户停了：照现在的规则结束父会话的任务，不再等。

### `packages/nb-harness/src/kit/tools/shell.ts`：自动转后台

`ShellBackground` 从一个函数改成宿主给的对象：

```ts
export interface ShellBackground {
    /** `async: true`：同现在。 */
    start(prepared: PreparedCommand, request: ShellRequest): ToolResult | Promise<ToolResult>;
    /** 前台跑到这个 Promise 完成就转后台；交回 null 表示这次不自动转（设置为 0）。用宿主的时钟计。 */
    threshold(signal: AbortSignal): Promise<void> | null;
    /** 门槛到了，接手这条在跑的命令；交回 null 表示接不了（到上限、正在停止），命令留在前台照常跑完。 */
    adopt(running: RunningCommand, request: ShellRequest): Promise<ToolResult | null>;
}
export interface RunningCommand {
    readonly prepared: PreparedCommand;
    /** 到此刻为止的全部输出（至多 64 MiB，与全文保存同一份），按先后写给 `write`。 */
    copyOutput(write: (chunk: Buffer) => void): void;
    /** 之后的输出改送到这里。 */
    redirect(sink: (error: Error | null, chunk: string) => void): void;
    readonly done: Promise<ShellResult>;
    abort(): void;
}
```

前台在这些情形下才会自动转：宿主给了 `threshold`、不在代码里调（`call.within` 为空）、`timeout` 没写或长过门槛。这时命令用自己的取消信号起（接手前跟着 `call.signal`，接手后断开），不写 `timeout` 时不把 300 秒交给 `executeShell`，由套件自己计前台时限：接手失败、留在前台时到 300 秒照样以 `timeout` 收口；写了 `timeout` 的照传，转后台后仍按它。输出回调经一个可换的出口：接手前进 `OutputCapture`，接手时先 `copyOutput` 再 `redirect`。`OutputCapture` 加 `copyTo(write)`：没溢出时写内存里的全部，溢出后写暂存文件。

### `backend/builtin/shell-background.ts`

`startBackgroundCommand` 拆成两段：建目录与输出文件、写入、收口时写 `status.json` 与 `jobs.end` 的一段（`openCommandOutput`），与起命令的一段；`async` 与 `adopt` 共用前一段。`adopt` 登记 `shell` 任务，把已有输出拷进 `output.log`，交回：“跑了 60 秒还没结束，已转到后台：任务 job-x。到目前为止的最后几行：……全文写进 <地址>。结束时结果会自动送来，不用 wait 轮询”；`details` 同 `async` 再加 `autoBackground: true`。

设置 `nbook.agent/shellAutoBackground`：秒，缺省 60，整数 0–3600，0 为不自动转；只允许用户层，在“运行可靠性”分区（`shared/settings.ts`）。`threshold` 每次调用现读，用 `runtime.kernelClock`。

`shell`、`wait` 的说明改：`shell` 写“跑过 N 秒自动转后台、结果会自动送来”；`wait` 写“后台任务的结果会自动送来，只在接下来的事要等它时用”。

### 任务种类开放：`shared/contracts.ts`、`backend/agent.ts`

`AgentService` 加 `jobs`：

```ts
interface AgentJobs {
    /** 在工具 `execute` 的同步段里调：占名额并登记（jobs.md 输出 2）。`owner` 是调用工具的会话，`invocation` 是这次调用。 */
    begin(input: {owner: string; invocation: string; kind: string; label: string; summary: string}): {ok: true; slot: JobSlot} | {ok: false; code: "concurrency-limit" | "unavailable"};
}
interface JobSlot {
    readonly id: string;
    /** 检查过了、真的开始：怎样停（用户经远程停时 `byUser`）、结束后交给模型的文字。 */
    start(driver: {kill(byUser: boolean): Promise<void>; result(): Promise<string>}): JobControl;
    /** 没开始：退回名额，任务从未出现过。 */
    release(): void;
}
interface JobControl {
    progress(line: string): void;
    end(state: "completed" | "failed" | "aborted", outcome?: {line?: string}): void;
}
```

门面把 `kind` 盖成 `<调用方插件>.<kind>`，冒充不了 `agent`、`shell`。调用方的门面作废（它的插件停止）时，它登记的在跑任务按 `interrupted` 收口，不再调它的驱动；`nbook.agent` 停止时同现在，先关门再停在跑的。这些任务照样能 `wait`、`kill`、`jobs`、送达、进工作台清单。自己的 `shell` 与子代理仍直接用 `JobCenter`（同一张表、同一套规则，门面只是给外部的那一层）。

### `backend/jobs/mirror.ts`（新）：进工作台的“后台任务”清单

- 任务第一次成为后台任务（还在跑、`waiters` 为 0）时 `tasks.start`：标题“<label>：<summary>”（文字引用，`agent` 目录），进展是最后一行或“在问它的调用方”，可取消，`notify: false`，`open` 指向 `nbook.agent.focus-session`（子代理是子会话，其余是启动它的会话）。之后又被前台等着不撤，结束时按状态 `succeed`、`fail`、`cancelled`；`interrupted` 由 `nbook.tasks` 随 `nbook.agent` 停止转成。用户取消：以用户身份 `kill`（同远程 `killJob`）。一直在前台等着的任务不进清单。
- 后台会话（会话头 `background: true`，不含程序自己开的起标题会话）的每次对话运行进清单：标题“Agent 会话：<标题或 Profile 名>”，进展“正在运行”；有等用户的审批或提问时 `report({attention: "等你处理"})`，答了清掉；可取消（以用户身份中止这次运行），`open` 同上；运行收口时按收口方式结束。数据来自句柄表的 `activityWithBackground` 与日志帧。

### `packages/neuro-book/src/plugins/tasks/`：清单补三样

- `TaskInput.notify?: boolean`（缺省 true）：false 时结束不弹通知。
- `TaskInput.open?: {command: string; args?: JsonValue}`：行上有“打开”按钮，执行这条命令；通知也带“打开”。
- `TaskHandle.report` 加 `attention?: Text | null`：在跑的任务要用户处理。行的状态图标换成提醒图标、进展写它；每个连着的窗口在它从无到有时发一条常驻通知（警告色调，带“打开”），清掉或任务离开清单时撤回；状态栏条目在有要处理的任务时用提醒图标。
- 清单每项加 `notify`、`open`、`attention`；远程合同版本不变（只加字段）。

### 前端：`packages/neuro-book/src/plugins/agent/web/`、`packages/nb-agent-ui/`

- 送达的话在对话里画成过程里的一行（不是用户气泡）：“后台任务有结果：<label> <摘要> <状态>”，几个时写个数，点开看全文；按发出者的 `plugin` 与 `ref` 认，标签按界面语言翻。
- 自动转后台的 `shell` 调用：结果带 `details.jobId` 与 `autoBackground` 时画成后台命令卡片（conversation.md 输出 36），卡头注明“自动转到后台”。
- 后台任务视图：“打开”按钮、要处理的提醒图标与通知。

## Spec 与文档改动

先在 master 上把下列条目写成 planned，再实施：

- `agent/jobs.md`：“不承诺”去掉通知与自动转后台；新输出 13 送达（何时、发出者、在跑与空闲两种写法、用户停过时留着、失败时留给 `wait`）、14 与 `wait` 和前台等待的关系（`watched`、`watchSteer` 不算插话）、15 任务种类开放（`agent.jobs` 的形状、盖章、门面作废时 `interrupted`）、16 进工作台清单；状态表与“时序与寿命”补送达；验收补“空闲时唤起”“用户停过不唤起”。
- `agent/subagents.md`：新输出 26 子代理等自己的后台工作；`kill` 那条补“等后台工作期间停掉子会话启动的任务”。
- `agent/builtin-tools.md`：新输出 31 自动转后台（门槛、条件、时限、交回的文字），设置表加 `shellAutoBackground`；输出 27 链到它。
- `harness/host-kit.md`：`ShellBackground` 的新形状与 `RunningCommand`（新输出 12）。
- `workbench/background-tasks.md`：“不承诺”去掉“Agent 自己的后台工作”；新输出 18 `notify`、19 `open`、20 `attention`。
- `agent/conversation.md`：新输出 51 送达的话的画法；输出 36 补自动转后台的卡片。
- `agent/sessions.md`：输出 12（后台）补“每次对话运行进工作台清单，见 jobs.md 输出 16”。

主工作区里 `jobs.md`、`subagents.md`、`sessions.md`、`conversation.md` 现在有别的会话没提交的改动，写 Spec 前先看它们提交了没有；还没提交时只改不与它们重叠的段落，用 `git update-index` 只提交自己的那几处。

## 切片

1. **Spec（planned）**：上面一节，单独提交到 master。
2. **送达**：`center.ts`、`delivery.ts`、`steer.ts`、`children.ts`、`plugin.ts` 装配。验证：`bun test src/plugins/agent/jobs.test.ts src/plugins/agent/subagents.test.ts`、`bun run typecheck`。
3. **自动转后台**：nb-harness `kit/tools/shell.ts`、`output-capture.ts`，`shell-background.ts`、设置。验证：nb-harness `bun test src/kit/tools/shell.test.ts`，neuro-book `jobs.test.ts`、`builtin-tools.test.ts`。
4. **任务种类开放**：`contracts.ts`、`agent.ts` 门面。验证：`jobs.test.ts` 加测试插件。
5. **工作台清单**：`plugins/tasks` 三样（后端与浏览器端）、`mirror.ts`。验证：`src/plugins/tasks/tasks.test.ts`、`store.test.ts`、`jobs.test.ts`、`e2e/background-tasks.e2e.ts`。
6. **对话界面**：送达的行、自动转后台的卡片。验证：相关 dom 测试、`e2e/agent-subagents.e2e.ts`、Lab 场景。

每片收口跑 `bun run test:affected` 与 typecheck，各自提交；2–5 后端合起来一次 omp 实现审查，6 与第 5 片的浏览器端一次 Sonnet 审查。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| jobs.md 输出 13（在跑时插话、空闲时唤起、用户停过留着并随下一句放行、送达失败留给 `wait`） | `jobs.test.ts` 新增“送达”（真实内核、本机端点、真实 brush） |
| jobs.md 输出 14 | `jobs.test.ts`：`wait()` 期间结束的由 `wait` 交回、不另送；`wait([A])` 期间 B 结束不让它提前返回，返回后进下一个边界；前台等着的不送 |
| jobs.md 输出 15 | `jobs.test.ts`：测试插件登记一种任务，`wait`、`kill`、送达都照常；冒充 `shell` 被盖成插件前缀；插件停止后它的任务为 `interrupted` |
| jobs.md 输出 16、sessions.md 输出 12 | `jobs.test.ts` 与 `tasks.test.ts`：后台任务进清单、前台的不进、取消即 `kill`；后台会话的提问让清单项有 `attention` |
| subagents.md 输出 26 | `subagents.test.ts`：子代理转后台一条命令后结束这一轮，父会话的任务等到子会话被唤起、再收口才结束 |
| builtin-tools.md 输出 31、host-kit.md 输出 12 | nb-harness `shell.test.ts`（注入时钟推过门槛、接手失败留前台到时限、写了短 `timeout` 不转、代码里调的不转）；`jobs.test.ts`（接手后输出完整、父会话中止不影响） |
| background-tasks.md 输出 18–20 | `tasks.test.ts`、`store.test.ts`、`background-tasks.e2e.ts`（“打开”、提醒通知与撤回、`notify: false` 不弹） |
| conversation.md 输出 51、36 | dom 测试与 `agent-subagents.e2e.ts` |

## 验证

- 后端都用真实内核、本机端点与真实 brush，计时走注入时钟，不按固定时长等。
- 送达的端到端：e2e 里父会话转后台一条命令后结束这一轮，命令结束后对话自己接着走、出现送达的行。
- 未验证边界：真实模型下被唤起的运行怎样处理结果（属提示词效果，不在合同里）；长时间挂着的子代理（几小时）只测到机制。

## 不做与风险

- 不做：Monitor、后台命令的 stdin、eval 单元自动转后台、任务表持久化、重启后补送通知、子代理前台等待自动转后台（已有超时返回）。
- 风险：自动唤起会在用户不在时调模型，费用上限缺省关；送达与用户同时打字时两条话的先后由缓冲区定，可能先进的是送达。
- 风险：子代理等后台工作可能让父会话的任务挂很久；父会话可以 `kill`，用户可以在清单里取消。
- 风险：`ShellBackground` 换形状是 nb-harness 套件的公开接口变化，套件现在只有 NeuroBook 用。
