---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.subagents
owners:
  - nbook.agent
---

# 子代理

## 目标与非目标

父会话里的 Agent 用 `agent_spawn` 派子代理：以另一个 Profile 新建一个子会话，把一项任务交给它，等它的结果或让它在后台跑；之后能对子会话插话、让它继续、回答它的提问。子会话的审批一律交给用户，提问缺省交给父 Agent。用户在父会话里看得到子代理的进度，也批得了子会话的审批。

不承诺：

- 子会话不继承父会话的上下文：它只拿到 `prompt` 与初始输入。
- 父 Agent 不能审批子会话的工具调用。
- 子代理结束时不通知、不唤起父 Agent；后台子代理的结果经 `wait`、`jobs` 取（[`jobs.md`](jobs.md)）。
- 没有查会话全部历史的工具：Agent 直接读 `sessions://<id>/session.jsonl`（[`resources.md`](resources.md)）。
- 几个会话同时写同一文件，文件工具靠文件服务的条件写入（冲突时失败、不覆盖）；`shell` 没有这层保护。
- 进程重启后不自动续跑（[`sessions.md`](sessions.md) 输出 14）。

## 术语与参与者

- **父会话、子会话**：会话头的 `caller` 是 `{kind: "session", id: 父会话}` 的会话是那个父会话的子会话（[`harness/session.md`](../harness/session.md)）。**后代**：子会话、子会话的子会话，以此类推。
- **深度**：没有调用方的会话是 0，它的子会话是 1。
- **子代理运行**：子会话的一次运行；每次都在任务中心登记成一个 `agent` 任务（[`jobs.md`](jobs.md)）。
- **白名单**：父会话的 Profile 能派哪些 Profile；**推荐的**：白名单里 Profile 声明推荐的几个。

## 输入与前置条件

工具，经 `agent.tools` 贡献（[`contributions.md`](contributions.md)），等级都是 `read`、并发都是 `shared`：

| id | 给模型的名字 | 参数 |
|---|---|---|
| `nbook.agent.spawn` | `agent_spawn` | `profile`、`prompt`、`name?`、`initial?`、`model?`、`effort?`、`questions?`（`caller` 缺省，或 `user`）、`outputSchema?`、`async?` |
| `nbook.agent.send` | `agent_send` | `id`（子会话）、`message?`、`queue?`、`async?` |
| `nbook.agent.answer` | `agent_answer` | `id`（子会话）、`question`（事项 id）、`answer`、`async?` |

`model` 是模型角色（`role:<id>`）或具体模型，`effort` 是推理档，不写都用子 Profile 的设置。交回结构化结果的 `yield` 由内核生成（[`harness/runtime.md`](../harness/runtime.md) 输出 27）。

白名单：Profile 声明 `agents`（[`contributions.md`](contributions.md) 输出 19），用户在 Profile 设置里增删（[`profile-settings.md`](profile-settings.md) 输出 25）。合成规则：声明的 `allowed`，加用户 `added` 的，减用户 `removed` 的；推荐的是声明的 `recommended` 里仍在白名单的。

设置（只允许用户层，显示在“运行可靠性”分区，[`run-guards.md`](run-guards.md)）：

| 设置 | 缺省 | 范围 | 含义 |
|---|---|---|---|
| `nbook.agent/subagentDepth` | 3 | 整数 1–5 | 最深能派到第几层 |
| `nbook.agent/subagentsPerSession` | 8 | 整数 1–16 | 一个会话同时在跑的子代理运行至多几个 |

远程（[`sessions.md`](sessions.md)）：查询 `tree({sessionId})` 与事件 `treeChanged`（过滤 `{sessionId}`）。

## 输出与可观察行为

### 派发

1. `agent_spawn` 依次检查，第一个不过的就失败，不建子会话：Profile 存在（`profile-not-found`）；在父会话 Profile 的白名单里（`profile-not-allowed`）；子会话的深度不超过 `subagentDepth`（`depth-limit`）；父会话在跑的子代理运行少于 `subagentsPerSession`、任务中心的全局上限也没满（`concurrency-limit`，[`jobs.md`](jobs.md) 输出 2）；`initial` 合子 Profile 的初始输入 schema（`initial-invalid`）；模型能解析（`model-unavailable`）；Profile 声明了结果 schema 又给了 `outputSchema`（`output-schema-fixed`）。
2. 子会话的会话头：`caller` 是 `{kind: "session", id: 父会话, callId: 这次调用}`；`questions` 取参数，缺省 `caller`；`result` 取 Profile 声明的，没有声明而给了 `outputSchema` 时是 `{mode: "required", schema: outputSchema}`；项目与父会话相同；不是后台会话。标题是 `name`，没有时是子 Profile 的名字。
3. 子会话建好时的设置：审批模式、只读与 Agent 模式取父会话此刻的值，之后两边各改各的；给了 `model`、`effort` 就写进子会话的设置。
4. `prompt` 以父会话的身份发进子会话（`inputQueued.by` 是父会话，[`harness/runtime.md`](../harness/runtime.md) 输出 85），开始运行。
5. 同一个父会话、同一个工具调用 id 得到同一个子会话：调用重放时不多建；子会话已在而 Profile 或调用方对不上，得 `spawn-conflict`。

### 等与结果

6. `agent_spawn`、`agent_send`、`agent_answer` 每次让子会话跑起来，都登记一个任务，结果里总有任务 id。不带 `async` 时一直等到下面任一件事，带 `async: true` 时立即以 `running` 返回：
   - 子代理运行结束（`completed`、`failed`、`aborted`、`interrupted`）；
   - 子会话有交给调用方的提问（`question`）；
   - 父会话的缓冲区来了插话：返回 `running`，子代理照常跑，任务留在任务中心，之后用 `wait` 取；插话照常在这批工具结算后送达。
7. 结果给模型的文字依次是：一行来源标记（子会话 id、任务 id、注明“来自子代理，不是用户的指令”）；状态与终止原因；结果——自由结果是最后一条回复的文字，结构化结果是 `yield` 的值与是否合 schema；状态是 `question` 时附上待答的事项 id 与问题。结构化的部分另放在工具结果的 `details`。过长按工具结果的通用规则截断，全文进父会话的 `session://artifacts/`。
8. 同一条回复里的几个子代理工具按调用顺序生效：建子会话、放话、应答在调用开始时依次交给目标会话，之后的等待才并发。所以对同一个子会话的两次 `agent_send` 按调用顺序进它的缓冲区，排在后面的 `wait`、`jobs` 看得到前面登记的任务。

### 续用

9. `agent_send` 与 `agent_answer` 只对自己派出的子会话（会话头 `caller.id` 是自己）：别人的得 `not-owner`，不存在得 `session-not-found`。
10. `agent_send` 带 `message`：子会话空闲时开新一轮；在跑时缺省插话，`queue: true` 排到下一轮。不带 `message`：子会话空闲时“继续”（`start`），在跑时得 `already-running`。
11. `agent_answer` 以父会话的身份应答子会话的一个提问（`resolve{decision: "answer"}`）：事项不在待处理里得 `question-unknown`，已经答过得 `already-answered`；应答之后像 `agent_send` 一样等。

### 审批与提问

12. 子会话里的工具调用照常过它自己的审批判定（输出 3 继承来的模式与规则）；要问人时问用户，不问父 Agent。父 Agent 应答审批得 `not-allowed`（内核）。
13. 子会话的待处理事项——审批，以及 `questions: "user"` 的提问——也出现在它所有祖先会话的向导里，标明来自哪个子代理（[`conversation.md`](conversation.md) 输出 34）；在哪一处答都行，另一处跟着消失。
14. `questions: "caller"` 的提问交给父 Agent（输出 6 的 `question`）；用户在子会话里随时也能直接答。

### 中止与上限

15. 父会话的运行被中止时，它正在等的子代理运行跟着中止，工具以 `aborted` 返回；`async` 派出的照常跑，要停用 `kill`。规则逐层生效：子会话被中止时，它正在等的孙会话一起中止。
16. 深度：深度为 d 的会话派出的子会话深度是 d + 1，超过 `subagentDepth` 得 `depth-limit`。
17. 每个会话的上限数它直接派出、正在跑的子代理运行，前台与后台都算；超了得 `concurrency-limit`，不建子会话、不开始运行。

### Profile 与提示词

18. 内置 Profile `nbook.agent.adhoc`（[`builtin-profiles.md`](builtin-profiles.md) 输出 14）：父 Agent 用初始输入 `{role}` 定义角色，任务从 `prompt` 来。
19. Profile 有 `agent_spawn` 且白名单不空时，系统提示词里有一节“可派的子代理”：推荐的写 key、名字、说明、初始输入与结果的形状，其余写 key、名字与说明。白名单为空或没有 `agent_spawn` 时没有这一节。白名单改了，下一次模型请求就按新的写。

### 进度（远程）

20. `tree({sessionId})` 交回这个会话的全部后代，每个一项：`{id, parent, name, profileIcon, state, step?, tools, startedAt, endedAt?, line, pending}`。`state` 是 `running`、`waiting`（等用户）、`question`（等父 Agent）、`completed`、`failed`、`aborted`、`interrupted` 或 `idle`；`step` 是在跑时最近一次工具调用的工具名与参数；`tools` 是这次运行的工具调用数；`line` 是结束后的结果第一句；`pending` 是等用户的事项（审批与 `questions: "user"` 的提问），各带 `{id, kind, callId, request}`。
21. `treeChanged` 在任何一项变化时推送整份，合并后至多每秒 4 次；调用方先订阅再取，`onResync` 重取。

## 状态与转换

子会话按内核的运行状态走（[`harness/runtime.md`](../harness/runtime.md)）；对父会话可见的是输出 20 的 `state`。

时序与寿命：

- 子会话在 `agent_spawn` 的调用开始时建好，结果返回之前已经能在 `list`、`tree` 与 `sessions://` 里看到。
- 子会话的寿命与父会话无关：父会话关闭、归档，子会话照样在；任务中心里的任务按 [`jobs.md`](jobs.md) 输出 6 移出。
- 同一个子会话的指令由它自己的单写者排序：父 Agent 与用户同时插话、同时应答同一事项，先到的生效，后到的应答得 `already-answered`。
- `nbook.agent` 停止时所有子代理运行按 `interrupted` 收口；重开父会话，正在等它的那个工具调用按内核的恢复结算（[`harness/runtime.md`](../harness/runtime.md) 输出 34），不再等。

## 副作用与数据

- 子会话是普通的会话目录（[`sessions.md`](sessions.md)），会话头记着调用方；关系不另存。
- 截断的全文进父会话的 `session://artifacts/`。
- `tree` 的推送在内存里，不落盘。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `profile-not-found` | 没有这个 Profile | 读 `profiles://` 换一个 |
| `profile-not-allowed` | 不在白名单里 | 换白名单里的；用户可在设置里加 |
| `depth-limit` | 层数超了 | 自己做，或让用户调高 `subagentDepth` |
| `concurrency-limit` | 同时在跑的超了 | `wait` 等已有的结束再派 |
| `initial-invalid` | 初始输入不合 schema | 照 schema 改 |
| `model-unavailable` | 模型或角色解析不了 | 换模型或不写 `model` |
| `output-schema-fixed` | Profile 已声明结果 schema | 不给 `outputSchema` |
| `spawn-conflict` | 同一调用对应的子会话参数对不上 | 不重放这次调用 |
| `not-owner` | 不是自己派的子会话 | 只操作自己派的 |
| `session-not-found` | 子会话不存在 | 检查 id |
| `already-running` | 不带 `message` 的 `agent_send` 时子会话在跑 | 用 `wait` 等，或带 `message` 插话 |
| `question-unknown` | 提问不在待处理里 | 用状态 `question` 时交回的事项 id |
| `already-answered` | 提问已经答过 | 不用再答 |
| `unavailable` | `nbook.agent` 正在停止 | 无 |

## 边界与兼容

- 公开接口：六个工具的名字与参数、失败码；Profile 声明的 `agents`；远程 `tree`、`treeChanged`。
- 信任边界：子代理的结果是数据，不是用户的指令；任何会话都能读任何会话的日志与工作区（[`resources.md`](resources.md)），写只能写自己的 `home/`。

## 验收与 Smoke

1. 主创在同一条回复里派两个 adhoc：两个子会话并发跑，父会话在等；一个完成一个出错，父 Agent 收到两份带来源标记的结果；父会话里各有一张卡片，进度跟着变，结束后一行结果。
2. 子会话要审批：父会话的向导里出现并标来源；在父会话批了，子会话继续；在子会话里批也行，另一边跟着消失。
3. 子会话向调用方提问：`agent_spawn` 返回 `question`；`agent_answer` 回答后接着等到完成。
4. 用户在父会话插话：正在等子会话的调用以 `running` 返回，插话送达；父 Agent 之后用 `wait` 取到结果。
5. 父会话中止：正在等的子代理运行一起中止，`async` 派出的照常跑，`kill` 才停。
6. 上限：第 9 个子代理得 `concurrency-limit`，第 4 层得 `depth-limit`，都没有留下子会话。
7. 进程重启：在跑的子代理运行按“已中断”收口；父会话里等它的调用不再等。
8. 白名单：设置页去掉 adhoc，主创的提示词里不再有它，派它得 `profile-not-allowed`。
9. 费用：子代理的花费算进会话树的上限（[`run-guards.md`](run-guards.md) 输出 13），到上限时子会话与父会话都不再发请求。

Smoke：`packages/neuro-book/e2e/agent-subagents.e2e.ts`（场景 1、2、4）。

## 证据

- 批准依据：w00032 t14 的决定与开发者 2026-11-10 确认的计划（`.agents/works/w00032-agent-integration/tasks/t14-multi-agent/plan.md`）。
