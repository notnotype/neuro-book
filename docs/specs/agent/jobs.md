---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.jobs
owners:
  - nbook.agent
---

# 任务中心

## 目标与非目标

Agent 的工具启动的、要跑一阵的事——子代理运行（[`subagents.md`](subagents.md)）与转后台的 `shell` 命令——都登记成任务，放在同一个任务中心里。Agent 用 `wait`、`kill`、`jobs` 等待、停止与列出自己启动的任务；用户在对话界面看得到、停得了。

不承诺：

- 任务结束时不通知，也不唤起空闲的 Agent；结果等 Agent 调 `wait` 或 `jobs` 时取得。
- 跑久了自动转后台；`shell` 的输入（stdin）；把输出逐行当事件推给 Agent。
- 活动面板：只在对话里的卡片上看得到（[`conversation.md`](conversation.md) 输出 33、36）。
- 任务表不持久化：进程重启后为空，原来在跑的按“已中断”收口。
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

1. 每次子代理运行与每条带 `async` 的 `shell` 命令都是一个任务；启动它的工具的结果里总有任务 id。任务 id 只在本进程内有效。
2. 全局上限数任务中心里所有在跑的任务（前台、后台、停在 `question` 的都算）；到 `backgroundJobs` 时新的启动整体拒绝，得 `concurrency-limit{scope: "global"}`，什么都不开始。名额在派发的检查过程中占下，同一条回复里并发的几次启动不会一起越过上限；启动失败时名额退回。还在检查中的任务不出现在 `jobs` 与远程里。
3. `wait` 只看自己（调用它的会话）启动的后台任务：给了 `jobs` 就只看这些，没给就看全部后台任务；点名的任务不是自己的或不存在得 `job-unknown`，是正被前台等着的得 `job-foreground`。有已经结束、还没取过的，立即交回它；状态是 `question` 的，同一个提问只在第一次让 `wait` 立即返回，之后只列在其余任务的状态里、照常等别的。否则等到任一件事：某个任务结束；某个 `agent` 任务的子会话有交给调用方的同步提问；本会话的缓冲区里有插话；超时。交回最先有结果的那一个，带上其余任务的状态；超时与插话时交回各任务的当前状态，不改变任务。一个可等的都没有得 `no-jobs`。`wait` 本身被中止时只结束等待，不停它等的任务。
4. `kill` 只对自己启动的任务（否则 `job-unknown`）：在跑的停掉，交回“已停止”；已经结束的交回“已经结束”。停掉 `agent` 任务就是中止那次子代理运行，子会话还在，之后还能 `agent_send`；停掉 `shell` 任务取消那条命令。
5. `jobs` 列出自己启动、还在任务中心里的任务：id、种类、状态、开始时间、一行摘要、是否前台。
6. 寿命：任何一个前台等它的调用以终态交回时，任务移出（视同取过）；后台任务结束后留到 `wait` 取过。结束了、没取过的后台任务每个会话至多留 32 个、全部至多 1,024 个，多了先丢最早结束的。会话闲置、句柄关闭不影响任务。移出后 id 不再可查，`agent` 任务的结果仍在子会话的日志里，后台命令的在输出文件与 `status.json` 里。
7. 后台命令：`shell` 带 `async: true` 时登记任务就返回任务 id 与输出文件的地址 `sessions://<会话>/home/jobs/<任务 id>/output.log`；命令照常跑，输出边跑边追加到那个文件（Agent 只读，[`resources.md`](resources.md) 输出 12）。不写 `timeout` 就不设超时，写了照用。父会话的运行被中止不影响它。输出文件至多 64 MiB，到了不再追加，结果里注明截断。结束时同一目录写 `status.json`：退出码、行数、结束时刻、是否截断；任务的结果是这些加输出的开头和结尾（同前台 `shell` 的截断规则）。审批与前台相同。
8. `nbook.agent` 停止时：先拒绝新的调用，再取消在跑的后台命令（记 `interrupted`，`status.json` 照写），再由会话的关闭把子代理运行按 `interrupted` 收口（这时不对子会话发中止），最后丢掉任务表。
9. 远程 `jobs({sessionId})` 交回这个会话启动、还在任务中心里的后台任务，每项 `{id, kind, state, summary, startedAt, endedAt?, lastLine?, exitCode?, lines?}`，`lastLine` 是后台命令输出的最后一行。`jobsChanged` 在任一项变化时推送整份，合并后至多每秒 4 次；先订阅再取，`onResync` 重取。
10. 远程 `jobTail({sessionId, jobId, lines?})` 读后台命令输出文件的最后 `lines` 行（缺省 50，至多 200，每行截到 768 字节），有 `status.json` 时一并交回；按文件读，任务已移出或进程重启后照样读得到。没有这个文件得 `job-unknown`。
11. 远程 `killJob({sessionId, jobId})` 以用户的身份停这个会话启动的任何任务（前台、后台），结果同输出 4。
12. `wait` 交回的结果与上一次 `wait` 相同时照常计入重复调用检测（[`run-guards.md`](run-guards.md) 输出 14）。

## 状态与转换

| 状态 | 事件 | 下一状态 |
|---|---|---|
| `running` | 子代理运行结束、命令退出 | `completed` 或 `failed` |
| `running` | 子会话有交给调用方的同步提问 | `question` |
| `question` | 提问被应答，同一次运行接着跑 | `running` |
| `running`、`question` | `kill`、`killJob`、父会话中止它正前台等的 | `aborted` |
| `running`、`question` | `nbook.agent` 停止 | `interrupted` |

一个任务对应一次运行：应答同步提问、插话进在跑的运行，仍是原来的任务；子会话开新一轮才是新任务。

时序与寿命：

- 任务在启动它的工具开始时就登记（占名额）；同一条回复里排在后面的 `jobs` 列得出前面以 `async` 登记的任务。
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
| `unavailable` | `nbook.agent` 正在停止 | 无 |

## 边界与兼容

- 公开接口：三个工具与 `shell` 的 `async`、失败码；输出文件与 `status.json` 的位置与字段；远程 `jobs`、`jobsChanged`、`jobTail`、`killJob`。
- 信任边界：Agent 只管自己启动的任务；用户经远程能停这个会话启动的任何任务。

## 验收与 Smoke

1. `shell` 带 `async`：立即交回任务 id，输出文件边跑边写；父会话中止后命令仍在跑；`wait` 取到退出码；另一条命令 `kill` 停掉，状态 `aborted`。
2. 两个后台子代理：`wait` 不给 `jobs` 时交回先结束的那个，再 `wait` 交回另一个；第三次得 `no-jobs`。
3. 用户在等待中插话：`wait` 提前返回，任务不变。
4. 父 Agent `async` 派出子代理后结束这一轮，会话闲置超过 30 秒，子代理完成；之后 `wait` 仍取得到结果。
5. 进程重启：任务表为空，之前的任务 id 得 `job-unknown`；`jobTail` 照样读得到后台命令的输出与 `status.json`。

Smoke：`packages/neuro-book/e2e/agent-subagents.e2e.ts`。

## 证据

- 批准依据：w00032 t14 的决定与开发者 2026-11-10 确认的计划（`.agents/works/w00032-agent-integration/tasks/t14-multi-agent/plan.md`）。
