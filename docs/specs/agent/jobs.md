---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.jobs
owners:
  - nbook.agent
---

# 任务中心

## 目标与非目标

Agent 的工具启动的、要跑一阵的事——子代理运行（[`subagents.md`](subagents.md)）与转后台的 `shell` 命令——都登记成任务，放在同一个任务中心里。Agent 用 `wait`、`kill`、`jobs` 等待、停止与列出自己启动的任务；用户在对话界面看得到、停得了。

不承诺：

- `shell` 的输入（stdin）；把输出逐行当事件推给 Agent（结束时只有一条回执，输出 13）。
- 活动面板：只在对话里的卡片上看得到（[`conversation.md`](conversation.md) 输出 33、36）。
- 任务表不持久化：进程重启后为空，原来在跑的按“已中断”收口；还没交出回执的另记账本、重启后补发回执（输出 17）。
- 会话删除还没有；加的时候，删除前先停掉这个会话启动的全部任务。

## 术语与参与者

- **任务**：任务中心里的一项：`{id, kind, owner, state, summary, startedAt}`。`kind` 是 `agent`（一次子代理运行）或 `shell`（一条后台命令）；`owner` 是启动它的会话；`summary` 是一行：子代理名，或命令。
- **前台任务**：有工具调用正在前台等它（`agent_spawn`、`agent_send`、`agent_answer` 的等待）；**后台任务**：没有调用在前台等它的——带 `async: true` 启动的，或前台等待以 `question`、插话、超时返回后留下的。续用时 `agent_send`、`agent_answer` 可以再前台等一个后台任务。
- **取过**：`wait` 交回过它的结束结果。

## 输入与前置条件

工具，经 `agent.tools` 贡献，等级都是 `read`：

| id | 给模型的名字 | 参数 | 并发 |
|---|---|---|---|
| `nbook.agent.wait` | `wait` | `jobs?`（任务 id 数组）、`timeout?`（秒，缺省 1800，1–1800） | shared |
| `nbook.agent.kill` | `kill` | `job` | exclusive |
| `nbook.agent.jobs` | `jobs` | 无 | shared |

`shell` 加参数 `async?`（[`builtin-tools.md`](builtin-tools.md) 输出 27）。

设置（只允许用户层，显示在“运行可靠性”分区，[`run-guards.md`](run-guards.md)）：`nbook.agent/backgroundJobs`，缺省 16，整数 1–32，任务中心里同时在跑的任务至多几个。

远程（[`sessions.md`](sessions.md) 输出 19）：查询 `jobs({sessionId})`、事件 `jobsChanged`（过滤 `{sessionId}`）、查询 `jobTail({sessionId, jobId, lines?})`、指令 `killJob({sessionId, jobId})`。

## 输出与可观察行为

1. 每次子代理运行与每条带 `async` 的 `shell` 命令都是一个任务；启动它的工具的结果里总有任务 id（`details.jobId`）。`jobs` 与远程的任务项带启动它的那次调用的 `invocation`。任务 id 只在本进程内有效。
2. 全局上限数任务中心里所有在跑的任务（前台、后台、停在 `question` 的都算）；到 `backgroundJobs` 时新的启动整体拒绝，得 `concurrency-limit{scope: "global"}`，什么都不开始。名额在派发的检查过程中占下，同一条回复里并发的几次启动不会一起越过上限；启动失败时名额退回。还在检查中的任务不出现在 `jobs` 与远程里。
3. `wait` 只看自己（调用它的会话）启动的后台任务：给了 `jobs` 就只看这些，没给就看全部后台任务；点名的任务不是自己的或不存在得 `job-unknown`，是正被前台等着的得 `job-foreground`。有已经结束、还没取过的，立即交回它；状态是 `question` 的，同一个提问只让 `wait` 立即返回一次（前台调用以 `question` 交回过的也算），之后只列在其余任务的状态里、照常等别的。否则等到任一件事：某个任务结束；某个 `agent` 任务的子会话有交给调用方的同步提问（模式切换请求不算，它等用户）；本会话的缓冲区里有插话；超时。交回最先有结果的那一个，带上其余任务的状态；超时与插话时交回各任务的当前状态，不改变任务。“缓冲区里有插话”只认就绪的插话（[`harness/runtime.md`](../harness/runtime.md) 输出 103），留着的不算，放行出来的插话算到达；前台等子代理时同样。一个可等的都没有得 `no-jobs`。`wait` 本身被中止时只结束等待，不停它等的任务。
4. `kill` 只对自己启动的任务（否则 `job-unknown`）：在跑的停掉，交回“已停止”；已经结束的交回“已经结束”。停掉 `agent` 任务就是中止那次子代理运行（缓冲区里的话留着），子会话还在，之后还能 `agent_send`；停掉 `shell` 任务取消那条命令。停 `agent` 任务时留着的话 `heldBy` 是调用 `kill` 的会话，它之后能放行。
5. `jobs` 列出自己启动、还在任务中心里的任务：id、种类、状态、开始时间、一行摘要、是否前台。
6. 寿命：任何一个前台等它的调用以终态交回时，任务移出（视同取过）；后台任务结束后留到 `wait` 取过。结束了、没取过的后台任务每个会话至多留 32 个、全部至多 1,024 个，多了先丢最早结束的，只丢回执已经进了会话缓冲区的，还没送出、只送了短回执的留着（输出 13）。会话闲置、句柄关闭不影响任务。移出后 id 不再可查，`agent` 任务的结果仍在子会话的日志里，后台命令的在输出文件与 `status.json` 里。
7. 后台命令：`shell` 带 `async: true` 时登记任务就返回任务 id 与输出文件的地址 `sessions://<会话>/home/jobs/<任务 id>/output.log`；命令照常跑，输出边跑边追加到那个文件（Agent 只读，[`resources.md`](resources.md) 输出 12）。不写 `timeout` 就不设超时，写了照用。父会话的运行被中止不影响它。输出文件至多 64 MiB，到了不再追加，结果里注明截断。结束时同一目录写 `status.json`：退出码、行数、结束时刻、是否截断；任务的结果是这些加输出的开头和结尾（同前台 `shell` 的截断规则）。审批与前台相同。
8. `nbook.agent` 停止时：先拒绝新的调用，再取消在跑的后台命令（记 `interrupted`，`status.json` 照写），再由会话的关闭把子代理运行按 `interrupted` 收口（这时不对子会话发中止），最后丢掉任务表。
9. 远程 `jobs({sessionId})` 交回这个会话启动、还在任务中心里的全部任务（前台在等的也列，卡片与“停止”要用），每项 `{id, kind, state, summary, invocation, foreground, startedAt, endedAt?, lastLine?, exitCode?, lines?, sessionId?, runId?}`：`invocation` 是启动它的那次工具调用，`foreground` 是正被前台的调用等着，`sessionId`、`runId` 是子代理任务的子会话与这次运行，`lastLine` 是后台命令输出的最后一行（至多每 250 毫秒更新一次）。`jobsChanged` 在任一项变化时推送整份，合并后至多每秒 4 次；先订阅再取，`onResync` 重取。
10. 远程 `jobTail({sessionId, jobId, lines?})` 读后台命令输出文件的最后 `lines` 行（缺省 50，0–200，每行截到 768 字节），有 `status.json` 时一并交回；按文件读，任务已移出或进程重启后照样读得到。没有这个文件得 `job-unknown`。远程 `jobStatuses({sessionId, jobIds})` 一次读多个后台命令的 `status.json`（至多 100 个），读不到的交回 null。
11. 远程 `killJob({sessionId, jobId})` 以用户的身份停这个会话启动的任何任务（前台、后台），结果同输出 4。停 `agent` 任务时子会话按用户停的记（`heldBy`、`runEnded.stoppedBy` 是用户），不换成父会话的身份；之后只有用户能放行那些话（[`subagents.md`](subagents.md) 输出 10）。
12. `wait` 交回的结果与上一次 `wait` 相同时照常计入重复调用检测（[`run-guards.md`](run-guards.md) 输出 14）。
13. **回执的约定。** Agent 发起的每件后台任务，不论怎样结束（完成、失败、被 Agent 或用户停掉、插件停止、服务重启），启动它的会话恰好收到一次回执，经三个出口之一：前台等着的调用、`wait`、一条提醒（[`harness/runtime.md`](../harness/runtime.md) 输出 112）。出口在任务中心的同一个同步段里写：两个并发的 `wait`、`wait` 与提醒都不会交回同一件。（planned）结果文字在任务收口时读下，`wait` 与提醒用同一份（子会话回退之后接着跑同一个运行，读到的仍是收口那一刻的）。
14. **送达。** 任务结束、没有前台在等时，给启动它的会话发一条 `senderOnly` 的提醒（用户删不掉，只有发送方能撤回），（planned）以宿主身份 `{plugin: "nbook.agent", label: "后台任务"}` 发，发送方不管会话开没开。根会话（会话头没有 `caller`）的带唤起，（planned）子会话的不带；只有被用户停掉的几件时不带（下一次请求必定带上）。每件一段，写种类、摘要、状态（被用户停的写“被用户停止”）与结果。（planned）正文开头说明这是回执、不用再 `wait`；每段至多 12 KiB，超长的留头留尾、段末写全文地址（后台命令的 `output.log`，子代理的全文存进父会话的 `artifacts/`）；一条至多 30 KiB，放不下的下一条再送；同时结束的几件合成一条。
15. **`wait` 与回执。** `wait` 要交回的一件已经经提醒送出、提醒还没取走时，先撤回那条提醒再自己交回；提醒已被取走，交回“回执已经在对话里”，不再给一次。不点名的 `wait` 不等送出时写入结果未知的那几件，（planned）点名的交回“可能已经在对话里”。（planned）`no-jobs` 写“回执都已经交给你了”。
16. （planned）**送达的失败。** 预算满（`notice-budget`）时改发一条“还有 N 件回执没放下：……，用 wait 取”的短回执，之后这几件只由 `wait` 交回；会话这会儿打不开、短回执也放不下时稍后重送：按退避（1 分钟起，每次翻倍，至多 30 分钟），或任务再有变化时。写入结果未知时，会话的句柄关闭后用同一个指令 id 与原样的参数重发：受理过的只交回原结果、不再写；再次未知就等下一次关闭。会话已不在、日志读不懂时记诊断，只留给 `wait`。
17. **账本。** 还没交出回执的后台任务记在 `<状态根>/agent/jobs/ledger.json`（身份、状态、结果地址，不存结果的正文；正在送出或送出时写入结果未知的那条回执另记它的指令 id 与原样的参数）：任务开始时加，回执有了出口时去掉，只送了短回执的留着。插件停止、服务重启之后再起时，每项给它的启动方补发一条不带唤起的回执（“服务停止前已……，回执没来得及送出”；（planned）进程没走停止就退出的写“服务重启时中断，没跑完”，带结果地址），记着在途那条的按原样重发，发完去掉，暂时送不了的留到下次；（planned）会话已不在的去掉。补发失败的除会话已不在外都留着，日志读不懂这类永久的失败每次启动都会再试一次（已知限制）。
18. `kill` 与远程 `killJob` 停子代理任务时点名它跟着的那次运行（[`harness/runtime.md`](../harness/runtime.md) 输出 120）；（planned）那次已经收口、用户又开了下一轮时交回“已经结束”，不停下一轮。
19. **工具里登记的任务。** 插件贡献的工具在一次调用的 `execute` 里经 `AgentToolServices.jobs.begin(call, {kind, label, summary, stop})` 把自己的长任务登记成后台任务：只认这一代工具实现里正在执行的调用，`execute` 结算之后或插件已停止时得 `unavailable`；`kind`（小写字母开头，只含小写字母、数字与 `-`，至多 40 个字符）盖成 `<贡献工具的插件>.<kind>`，`label` 不能是空白、至多 20 个字符、`summary` 至多 200 个字符，不合格得 `invalid`、不占名额；名额满得 `concurrency-limit`。`wait`、`kill`、`jobs`、回执与远程照常；`kill` 调插件的 `stop`。插件给的结果文字按 UTF-8 至多 12 KiB。`kill` 之后插件没有调 `end` 的，按 `aborted` 收口。贡献工具的插件停止时先封住登记，再对它在跑的任务调 `stop`（抛错只记诊断 `tool-job-stop-failed`）、按 `interrupted` 收口；`nbook.agent` 停止时它们与后台命令一起按 `interrupted` 停下。任何插件贡献的工具都能登记，名额与后台命令、子代理共用。

## 状态与转换

| 状态 | 事件 | 下一状态 |
|---|---|---|
| `running` | 子代理运行结束、命令退出 | `completed` 或 `failed` |
| `running` | 子会话有交给调用方的同步提问（不含模式切换请求） | `question` |
| `question` | 提问被应答，同一次运行接着跑 | `running` |
| `running`、`question` | `kill`、`killJob`、父会话中止它正前台等的且由它启动的 | `aborted` |
| `running`、`question` | `nbook.agent` 停止 | `interrupted` |

一个任务对应一次运行：应答同步提问、插话进在跑的运行，仍是原来的任务；子会话开新一轮才是新任务。

时序与寿命：

- 任务在派发的检查过程中登记（占名额），检查过了才出现在 `jobs` 与远程里；同一条回复里的 `jobs` 不一定列得出同时启动的任务（[`subagents.md`](subagents.md) 输出 8）。
- 任务表只在内存里；进程重启后为空，之前的 id 在 `wait`、`kill` 里得 `job-unknown`。

## 副作用与数据

- 后台命令的输出与 `status.json` 在 `<状态根>/agent/sessions/<会话 id>/home/jobs/<任务 id>/`，随会话目录保留，不自动清理。
- 任务表不落盘。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `concurrency-limit` | 同时在跑的任务到上限（`scope`） | 见 [`subagents.md`](subagents.md) 的失败表 |
| `job-unknown` | 不是自己的、不存在或已移出 | 用 `jobs` 看还有哪些 |
| `job-foreground` | 这个任务正被前台调用等着 | 不用等，它自己的调用会交回 |
| `no-jobs` | 没有可等的任务 | 不用等 |
| `unavailable` | `nbook.agent` 正在停止；工具登记任务时那次调用已经结算、不是这一代工具实现的调用，或贡献工具的插件已停止（输出 19） | 无 |
| `invalid` | 工具登记任务时 `kind`、`label` 或 `summary` 不合格（输出 19），不占名额 | 改了再登记 |

## 边界与兼容

- 公开接口：三个工具与 `shell` 的 `async`、失败码；输出文件与 `status.json` 的位置与字段；远程 `jobs`、`jobsChanged`、`jobTail`、`killJob`。
- 信任边界：Agent 只管自己启动的任务；用户经远程能停这个会话启动的任何任务。
- `wait` 结果的 `details` 是 `{jobs: [{jobId, kind, invocation, state, sessionId?, runId?, line?, exitCode?, lines?}]}`，先列交回的那一个；`kill` 结果的 `details` 是 `{jobId, outcome}`。界面按 `runId`、`jobId` 从它们取终态。

## 验收与 Smoke

1. `shell` 带 `async`：立即交回任务 id，输出文件边跑边写；父会话中止后命令仍在跑；`wait` 取到退出码；另一条命令 `kill` 停掉，状态 `aborted`。
2. 两个后台子代理：`wait` 不给 `jobs` 时交回先结束的那个，再 `wait` 交回另一个；第三次得 `no-jobs`。
3. 用户在等待中插话：`wait` 提前返回，任务不变。
4. 父 Agent `async` 派出子代理后结束这一轮，会话闲置超过 30 秒，子代理完成；之后 `wait` 仍取得到结果。
5. 进程重启：任务表为空，之前的任务 id 得 `job-unknown`；`jobTail` 照样读得到后台命令的输出与 `status.json`。
6. 同一条回复派 9 个子代理：恰有一个得 `concurrency-limit{scope: "session"}`。

Smoke：`packages/neuro-book/e2e/agent-subagents.e2e.ts`。

## 实现合同

- **公开入口**：工具 id `nbook.agent.wait`、`nbook.agent.kill`、`nbook.agent.jobs`（给模型的名字是 `wait`、`kill`、`jobs`）与 `nbook.agent.shell` 的 `async`；输出文件 `sessions://<会话>/home/jobs/<任务 id>/output.log` 与同目录的 `status.json`；远程 `jobs`、`jobsChanged`、`jobTail`、`jobStatuses`、`killJob`。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口持有任务中心（只在内存）；后台命令经 nb-harness 宿主套件 `shell` 的 `ShellBackground` 钩子接进来，输出窗口的截法与前台 `shell` 共用套件的那一份（[`builtin-tools.md`](builtin-tools.md)）。
- **关键不变量**：
  - 登记是同步占位；插件停止时任务中心先关门，之后一律 `unavailable`，再把在跑的后台命令按 `interrupted` 收口（`jobs.test.ts`“停止与提前交回”“输出 8”）。
  - 前台以中止交回的任务视同取过，收口后直接移出，`wait` 不再交回它（`jobs.test.ts`“输出 6”）。
  - 已结束、没取过的任务每个会话至多留 32 个，先丢最早结束的（`jobs.test.ts`“kill 与寿命”）。
  - 后台命令的输出边跑边写文件，内存只留最后一段，结果等 `wait` 时才从文件读（`jobs.test.ts`“后台命令”）。

## 证据

- 批准依据：[w00032 t14](../../../.agents/works/w00032-agent-integration/tasks/t14-multi-agent/README.md) 的决定与[计划](../../../.agents/works/w00032-agent-integration/tasks/t14-multi-agent/plan.md)；开发者 2026-11-10 确认计划，同日批准晋升为 `implemented`；缓冲区条目的就绪与留着、放行、继续与停止的两个选项（本 Task 加的条目）依据 [提案：输入缓冲区](../../proposals/agent-input-buffer-states.md)（2026-11-18 接受）与 [w00043 t14](../../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/README.md)，逐句核对后晋升（[核对处理](../../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/evidences/promotion-check-disposition.md)）。
- 实现入口：[`backend/jobs/center.ts`](../../../packages/neuro-book/src/plugins/agent/backend/jobs/center.ts)、[`tools.ts`](../../../packages/neuro-book/src/plugins/agent/backend/jobs/tools.ts)、[`steer.ts`](../../../packages/neuro-book/src/plugins/agent/backend/jobs/steer.ts)、[`backend/builtin/shell-background.ts`](../../../packages/neuro-book/src/plugins/agent/backend/builtin/shell-background.ts)
- 合同测试：[`jobs.test.ts`](../../../packages/neuro-book/src/plugins/agent/jobs.test.ts)（真实内核、真实 brush）、[`subagents.test.ts`](../../../packages/neuro-book/src/plugins/agent/subagents.test.ts)（“jobs.md 输出 9–11”）；输出 3 只认就绪的插话：`jobs.test.ts`（“插话的到达”）；输出 4、11：`subagents.test.ts`（“话的去向”）
- Smoke：[`agent-subagents.e2e.ts`](../../../packages/neuro-book/e2e/agent-subagents.e2e.ts)
