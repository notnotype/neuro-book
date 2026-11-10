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

## 术语与参与者

- **任务**：任务中心里的一项：`{id, kind, owner, state, summary, startedAt}`。`kind` 是 `agent`（子代理运行）或 `shell`（后台命令）；`owner` 是启动它的会话；`summary` 是一行：子代理名，或命令。
- **前台任务**：启动它的工具调用正在等它；**后台任务**：带 `async: true` 启动的，或前台等待被插话打断后留下的。
- **取过**：`wait` 交回过它的结束结果。

## 输入与前置条件

工具，经 `agent.tools` 贡献，等级都是 `read`：

| id | 给模型的名字 | 参数 | 并发 |
|---|---|---|---|
| `nbook.agent.wait` | `wait` | `jobs?`（任务 id 数组）、`timeout?`（秒，缺省 300，1–1800） | shared |
| `nbook.agent.kill` | `kill` | `job` | exclusive |
| `nbook.agent.jobs` | `jobs` | 无 | shared |

`shell` 加参数 `async?`（[`builtin-tools.md`](builtin-tools.md) 输出 27）。

设置（只允许用户层，显示在“运行可靠性”分区，[`run-guards.md`](run-guards.md)）：`nbook.agent/backgroundJobs`，缺省 16，整数 1–32，任务中心里同时在跑的任务至多几个。

远程（[`sessions.md`](sessions.md)）：查询 `jobs({sessionId})`、事件 `jobsChanged`（过滤 `{sessionId}`）、查询 `jobTail({sessionId, jobId, lines?})`、指令 `killJob({sessionId, jobId})`。

## 输出与可观察行为

1. 子代理工具每让子会话跑一次、`shell` 每次带 `async` 启动，任务中心都登记一个任务；工具的结果里总有任务 id。任务 id 是 `job-` 加 8 位十六进制，进程重启后不会与之前的重名。
2. 全局上限数任务中心里所有在跑的任务（前台、后台都算）；到 `backgroundJobs` 时新的启动整体拒绝，得 `concurrency-limit`，什么都不开始。
3. `wait` 只看自己（调用它的会话）启动的任务；给了 `jobs` 就只看这些，没给就看全部。立即返回的情况：其中有已经结束、还没取过的。否则等到任一件事：某个任务结束；某个 `agent` 任务的子会话有交给调用方的提问（状态 `question`）；本会话的缓冲区来了插话；超时。交回最先有结果的那一个，带上其余任务的状态；超时与插话时交回各任务的当前状态（`running`），不改变任务。看的任务里有不是自己的或不存在的，得 `job-unknown`；一个在跑或没取过的都没有，得 `no-jobs`。
4. `kill` 只对自己启动的任务（否则 `job-unknown`）：在跑的停掉，交回“已停止”；已经结束的交回“已经结束”。停掉 `agent` 任务就是中止那次子代理运行，子会话还在，之后还能 `agent_send`；停掉 `shell` 任务取消那条命令。
5. `jobs` 列出自己启动、还在任务中心里的任务：id、种类、状态、开始时间、一行摘要。
6. 寿命：前台任务在启动它的工具返回结果时移出；后台任务结束后留到 `wait` 取过，或启动它的会话关闭（句柄关闭）。移出后 id 不再可查，`agent` 任务的结果仍在子会话的日志里。
7. 后台命令：`shell` 带 `async: true` 时登记任务就返回任务 id 与输出文件的地址 `sessions://<会话>/home/jobs/<任务 id>/output.log`；命令照常跑，输出边跑边追加到那个文件（Agent 只读，[`resources.md`](resources.md) 输出 12）。`timeout` 照常生效。结束时任务的结果是退出码、行数与输出的开头和结尾（同前台 `shell` 的截断规则）。审批与前台相同。
8. `nbook.agent` 停止时，在跑的任务全部停掉、记为 `interrupted`；后台命令没写完的输出文件留着。
9. 远程 `jobs({sessionId})` 交回这个会话启动、还在任务中心里的任务，每项 `{id, kind, state, summary, startedAt, endedAt?, lastLine?, exitCode?, lines?}`，`lastLine` 是后台命令输出的最后一行。`jobsChanged` 在任一项变化时推送整份，合并后至多每秒 4 次；先订阅再取，`onResync` 重取。
10. 远程 `jobTail({sessionId, jobId, lines?})` 读后台命令输出的最后 `lines` 行（缺省 50，至多 200），每行截到 768 字节。
11. 远程 `killJob({sessionId, jobId})` 以用户的身份停这个会话启动的任何任务，结果同输出 4。

## 状态与转换

| 状态 | 事件 | 下一状态 |
|---|---|---|
| `running` | 子代理运行结束、命令退出 | `completed` 或 `failed` |
| `running` | 子会话有交给调用方的提问 | `question` |
| `question` | 提问被应答、子代理接着跑 | `running` |
| `running`、`question` | `kill`、`killJob` | `aborted` |
| `running`、`question` | `nbook.agent` 停止 | `interrupted` |

`agent_answer`、`agent_send` 让同一个子会话再跑时登记的是新任务。

时序与寿命：

- 任务在启动它的工具调用开始时登记，同一条回复里排在后面的 `wait`、`jobs` 看得到它。
- 任务表只在内存里；进程重启后为空，之前的 id 都得 `job-unknown`。

## 副作用与数据

- 后台命令的输出在 `<状态根>/agent/sessions/<会话 id>/home/jobs/<任务 id>/output.log`，随会话目录保留，不自动清理。
- 任务表不落盘。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `concurrency-limit` | 同时在跑的任务到上限 | `wait` 等已有的结束 |
| `job-unknown` | 不是自己的、不存在或已移出 | 用 `jobs` 看还有哪些 |
| `no-jobs` | 没有可等的任务 | 不用等 |
| `unavailable` | `nbook.agent` 正在停止 | 无 |

## 边界与兼容

- 公开接口：三个工具与 `shell` 的 `async`、失败码；输出文件的位置；远程 `jobs`、`jobsChanged`、`jobTail`、`killJob`。
- 信任边界：Agent 只管自己启动的任务；用户经远程能停这个会话启动的任何任务。

## 验收与 Smoke

1. `shell` 带 `async`：立即交回任务 id，输出文件边跑边写；`wait` 取到退出码；另一条命令 `kill` 停掉，状态 `aborted`。
2. 两个后台子代理：`wait` 不给 `jobs` 时交回先结束的那个，再 `wait` 交回另一个；第三次得 `no-jobs`。
3. 用户在等待中插话：`wait` 提前以 `running` 返回，任务不变。
4. 进程重启：任务表为空，之前的任务 id 得 `job-unknown`；后台命令的输出文件还在。

Smoke：`packages/neuro-book/e2e/agent-subagents.e2e.ts`。

## 证据

- 批准依据：w00032 t14 的决定与开发者 2026-11-10 确认的计划（`.agents/works/w00032-agent-integration/tasks/t14-multi-agent/plan.md`）。
