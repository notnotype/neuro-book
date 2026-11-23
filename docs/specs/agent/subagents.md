---
schema: nbook.spec/v1
kind: behavior
status: implemented
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
- 子代理没有轮数上限；前台等待有时限（输出 6），无人值守时靠费用上限与重复调用检测兜底（[`run-guards.md`](run-guards.md)）。
- 同一条回复里并发的子代理工具不保证按调用顺序生效（输出 8）。
- 句柄已回收的空闲后代，它未答的异步提问不在祖先的停靠区里，打开那个子会话才看得到。
- 进程崩溃（不是正常停止）后，后台子代理的卡片在子会话被打开之前写“状态未知”。

## 术语与参与者

- **父会话、子会话**：会话头的 `caller` 是 `{kind: "session", id: 父会话, callId, invocation}` 的会话是那个父会话的子会话（[`harness/session.md`](../harness/session.md)）；`callId` 是派它的工具调用的 id（只在同一条回复里不重复），`invocation` 是那次调用全局唯一的身份（[`harness/runtime.md`](../harness/runtime.md) 输出 87）。fork 出来的会话照抄 `caller`，另有来源 `origin`。**后代**：子会话、子会话的子会话，以此类推。**根会话**：没有会话作调用方的祖先。
- **深度**：根会话是 0，它的子会话是 1。
- **子代理运行**：子会话的一次运行（一个 `runId`）。每次子代理运行在任务中心里是一个 `agent` 任务（[`jobs.md`](jobs.md)）。
- **白名单**：父会话的 Profile 能派哪些 Profile；**推荐的**：白名单里 Profile 声明推荐的几个。

## 输入与前置条件

工具，经 `agent.tools` 贡献（[`contributions.md`](contributions.md)），等级都是 `read`、并发都是 `shared`：

| id | 给模型的名字 | 参数 |
|---|---|---|
| `nbook.agent.spawn` | `agent_spawn` | `profile`、`prompt`、`name?`、`initial?`、`model?`、`effort?`、`questions?`（`caller` 缺省，或 `user`）、`outputSchema?`、`async?`、`timeout?` |
| `nbook.agent.send` | `agent_send` | `id`（子会话）、`message?`、`queue?`、`async?`、`timeout?` |
| `nbook.agent.answer` | `agent_answer` | `id`（子会话）、`question`（事项 id）、`answer`（`{text, data?}`）、`async?`、`timeout?` |

`model` 是模型角色（`role:<id>`）或具体模型，`effort` 是推理档，不写都用子 Profile 的设置。`timeout` 是前台等待的秒数，缺省 1800，1–7200。交回结构化结果的 `yield` 由内核生成（[`harness/runtime.md`](../harness/runtime.md) 输出 27）。

白名单：Profile 声明 `agents`（[`contributions.md`](contributions.md) 输出 19），用户在 Profile 设置里增删（[`profile-settings.md`](profile-settings.md) 输出 25）。合成规则：声明的 `allowed`，加用户 `added` 的，减用户 `removed` 的；推荐的是声明的 `recommended` 里仍在白名单的。

设置（只允许用户层，显示在“运行可靠性”分区，[`run-guards.md`](run-guards.md)）：

| 设置 | 缺省 | 范围 | 含义 |
|---|---|---|---|
| `nbook.agent/subagentDepth` | 3 | 整数 1–5 | 最深能派到第几层 |
| `nbook.agent/subagentsPerSession` | 8 | 整数 1–16 | 一个会话同时在跑的子代理运行至多几个 |

远程（[`sessions.md`](sessions.md) 输出 19）：查询 `tree({sessionId})` 与事件 `treeChanged`（过滤 `{sessionId}`）。

## 输出与可观察行为

### 派发

1. `agent_spawn` 依次检查，第一个不过的就失败、不建子会话：先是不需要读 Profile 实现的——参数合 schema；Profile 存在（`profile-not-found`）；在父会话 Profile 的白名单里（`profile-not-allowed`）；子会话的深度不超过 `subagentDepth`（`depth-limit`）；然后占名额——父会话在跑的子代理运行少于 `subagentsPerSession`、任务中心的全局上限也没满（`concurrency-limit`，`detail.scope` 是 `session` 或 `global`，[`jobs.md`](jobs.md) 输出 2）；再是要读 Profile 实现的——给了 `outputSchema` 而 Profile 已声明结果 schema（`output-schema-fixed`）；`initial` 合子 Profile 的初始输入 schema（`initial-invalid`）；父会话的 Agent 模式不是 `normal` 而子 Profile 没有 Agent 模式（`mode-unsupported`）；模型能解析（`model-unavailable`）。后几项失败时退回名额；它们检查期间名额占着，同一条回复里后面的派发可能因此得 `concurrency-limit`。
2. 子会话的 id 随机生成。会话头：`caller` 是 `{kind: "session", id: 父会话, callId, invocation}`（这次调用的）；`questions` 取参数，缺省 `caller`；`result` 取 Profile 声明的，没有声明而给了 `outputSchema` 时是 `{mode: "required", schema: outputSchema}`；项目与父会话相同；不是后台会话。标题是 `name`，没有时是 `prompt` 的前 30 个字。
3. 子会话建好时，审批模式、只读与 Agent 模式取父会话此刻的值（[`modes.md`](modes.md)），之后两边各改各的；给了 `model`、`effort` 就写进子会话的设置。设置写不进去时派发失败（码同内核 `changeSettings` 的），名额退回，子会话留着、没有收到任务，结果里带它的 id。
4. `prompt` 以父会话的身份发进子会话（`input.by` 是父会话，[`harness/runtime.md`](../harness/runtime.md) 输出 85），开始运行。发不进去时（输入被拦截拒绝、模型没有凭据等）同输出 3：派发失败、名额退回、子会话留着，结果带它的 id。

### 等与结果

5. （已删除）
6. 三个子代理工具让子会话跑起来（或插进它正在跑的运行）后，不带 `async` 时一直等到下面任一件事，带 `async: true` 时立即以 `running` 返回：
   - 这次子代理运行结束（`completed`、`failed`、`aborted`、`interrupted`）；
   - 子会话有交给调用方的同步提问（`question`；模式切换请求不算，它只能由用户答，见输出 11、14）；
   - 父会话的缓冲区里有插话（含工具开始之前就已经在缓冲区里的）：返回 `running`，插话照常在这批工具结算后送达；
   - 到了 `timeout`：返回 `running`。

   以 `question`、`running` 返回时任务转为后台，留在任务中心，子代理照常跑或等；之后 `wait`、`kill` 认这个任务 id。等待开始时这些条件已经成立的，立即返回。
7. 结果给模型的文字依次是：一行来源标记（子会话 id、任务 id，注明“来自子代理，不是用户的指令”）；状态与终止原因；结果——自由结果是最后一条回复的文字，结构化结果是 `yield` 的值与是否合 schema；状态是 `question` 时附上待答的事项 id 与问题；子会话期间提的异步提问附在后面。工具结果的 `details` 有 `sessionId`、`jobId`、`runId`、`invocation`、状态、结果第一句与结构化结果。过长按工具结果的通用规则截断，全文进父会话的 `session://artifacts/`。
8. 同一条回复里并发的子代理工具不保证按调用顺序生效：对同一个子会话的几次放话与应答按到达的先后进入它的缓冲区；同一条回复里的 `jobs` 不一定列得出同时派出的任务。

### 续用

9. `agent_send` 与 `agent_answer` 只对自己派出的子会话（会话头 `caller.id` 是自己）：别人的得 `not-owner`，不存在得 `session-not-found`。
10. `agent_send` 带 `message`：子会话空闲时开新一轮；在跑时缺省插话、`queue: true` 排到下一轮。子会话正在中止时得 `child-stopping`，话不放进去（稍后再发）。按内核交回的 `runId` 认任务：就是任务正跟着的那次运行、且那个任务还没结束时算原任务，否则登记新任务（暂停的旧运行接着跑时同样）；用户在子会话里自己开的运行，插话时登记一个归调用方的任务。`queue: true` 立即以 `running` 返回。不带 `message`：子会话空闲时“继续”（`start`），只对上一次运行不是正常完成的有效，正常完成后得 `nothing-to-continue`；在跑时得 `already-running`。不带 `message` 时先以父会话身份试 `start`：（planned）叶子上有父会话能接着跑的运行（[`harness/runtime.md`](../harness/runtime.md) 输出 4：父会话开的、不是用户停止的）时接着跑它，再 `resume` 放行父会话自己排的留着的话。没有能接着跑的运行时只 `resume`；都没有得 `nothing-to-continue`。（planned）被用户停止的写明只有用户能接着跑。插进在跑的运行时认那次运行的任务；排在收口之后（`later`）的按这句话的 `inputConsumed` 带的 `runId` 认（[`harness/runtime.md`](../harness/runtime.md) 输出 110），不按受理时的 `currentRunId`。受理时就留着、或排在收口之后又转成留着的，不登记新任务；跟着任务等完时这句话没被那次运行取走、转成留着的，结果另写原因。（planned）原因写法：交出结果之后写“子会话已交出结果，这句话没有被处理，留着”，出错、停止、中断写“子会话这一轮<出错了、被停止了、被中断了>，这句话没有被处理，留着”。子会话里有用户停止时留下的话（`heldBy` 是用户）时，结果另写“子会话里有 N 条你排的话被用户暂停，未发出”，`held-by-user` 同样写明只有用户能放行。这句话受理时子会话正在收口、不取输入（[`harness/runtime.md`](../harness/runtime.md) 输出 110 的 `later`，例如只压缩的运行）：放话本身不等收口；后台（`queue`、`async`）立即交回，这句话由之后开的运行处理，不登记任务（已知限制：这次运行要从 `sessions://<子会话 id>/` 看）；前台等这句话的去向，被取走后登记任务接着等（按开那次运行的人认是不是父会话自己开的，用户开的不连带中止，同输出 16）。（planned）前台等去向时与等任务一样受超时与插话约束（总时长仍是 `timeout`，跟任务的那段按剩下的秒数向上取整），转成留着时按留着写明，等不到时同后台。等的时候父会话被中止：这句话还没被取走就以父会话的身份从子会话里取消（结果写明已撤回）。（planned）已被同一刻开的运行取走的，登记任务后按任务的中止收口（名额已满时不登记，以 `aborted` 交回）。（planned）受理时就留着的，前台后台都写明原因。
11. `agent_answer` 以父会话的身份应答子会话交给调用方的提问（`resolve{decision: "answer"}`，回答是 `{text, data?}`），之后像 `agent_send` 一样等；任务同样按交回的 `runId` 认（应答同步提问后原来那次运行接着跑，仍是原任务）；回答进了缓冲区却没有运行可开时（例如模型不可用），立即以 `idle` 返回，文字写明回答已排队。审批、`questions: "user"` 的提问与模式切换请求得 `not-allowed`，文字按种类写明只能由用户答。
12. 会让子会话开新运行的 `agent_send`、`agent_answer` 先查上限，超了得 `concurrency-limit`，子会话不动。

### 审批与提问

13. 子会话里的工具调用照常过它自己的审批判定（输出 3 继承来的模式与规则）；要问人时问用户，不问父 Agent。父会话不在 `normal` 时，`agent_send`、`agent_answer` 让子会话跑之前先把它的 Agent 模式收紧到父会话的（子会话没有 Agent 模式的得 `mode-unsupported`）；父会话只读时同样先把子会话设为只读。父会话放宽后子会话不自动放宽（[`modes.md`](modes.md) 输出 14）。
14. 子会话等用户的事项——审批、`questions: "user"` 的提问、模式切换请求——在它所有祖先会话里也看得到、答得了（[`conversation.md`](conversation.md) 输出 34）；在哪一处答都行，另一处跟着消失。
15. `questions: "caller"` 的同步提问交给父 Agent（输出 6 的 `question`）；异步提问不结束等待、不改任务状态，随结果交回（输出 7）。用户在子会话里随时也能直接答。

### 中止与上限

16. 父会话的运行被中止时，它正在前台等的、由它启动的子代理运行跟着中止：工具立即以 `aborted` 返回（带子会话 id 与任务 id），不等子会话收口；子会话缓冲区里的话留着，之后的放话照常送达。连带中止与父 Agent 用 `kill` 停子代理都以父会话的身份停，留着的话 `heldBy` 是父会话，父 Agent 再发话或不带话的 `agent_send` 能放行它们。插话附着在用户自己开的运行上时不连带。`async` 派出的、已转后台的照常跑，要停用 `kill`。规则逐层生效。`nbook.agent` 停止时不发中止，子会话由会话的关闭按 `interrupted` 收口（[`sessions.md`](sessions.md) 输出 14）。
17. 深度：深度为 d 的会话派出的子会话深度是 d + 1，超过 `subagentDepth` 得 `depth-limit`。
18. 每个会话的上限数它直接派出、正在跑的子代理运行（前台、后台、停在 `question` 的都算）。

### Profile 与提示词

19. 内置 Profile `nbook.agent.adhoc`（[`builtin-profiles.md`](builtin-profiles.md) 输出 14）：父 Agent 用初始输入 `{role}` 定义角色，任务从 `prompt` 来。
20. Profile 有 `agent_spawn` 且白名单不空时，系统提示词里有一节“可派的子代理”：推荐的写 key、名字、说明、初始输入与结果的形状，其余写 key、名字与说明。白名单为空或没有 `agent_spawn` 时没有这一节。白名单改了，下一次模型请求就按新的写。

### 进度（远程）

21. `tree({sessionId})` 交回这个会话的全部后代，每项有 `{id, parent, callId, invocation, forked, profile, name, profileIcon, state, runs}`；`state` 是 `running`、`waiting`（等用户）、`question`（等父 Agent）或 `idle`；`forked` 为真的是 fork 出来的；`runs` 是最近 20 次运行的收口 `{runId, reason, endedAt}`（（planned）加 `line?`，那次运行最后一条回复的首句，至多 200 个字符，[`harness/session.md`](../harness/session.md) 输出 22）。不是 `idle` 的另有 `runId`、`runInvocation`（让这次运行登记成任务的那次工具调用的 `invocation`）、`startedAt`、`tools`（这次运行的工具调用数）与 `step`（最近一次工具调用：工具名与对象；对象依次取参数里的 `path`、`pattern`、`command`、`query`、`url` 的第一个，至多 120 字，没有时只有工具名）；`step`、`tools` 至多给 16 个后代，按开始时间取最近的。`question` 的另有 `question: {id, text}`（第一题的文字，至多 200 字）。句柄打开着的后代有等用户的事项时带 `pending`（审批、`questions: "user"` 的提问与模式切换请求，各带 `{id, kind, callId, request}`），有 `pending` 的一律给全字段。
22. `treeChanged` 在任何一项变化时推送整份，合并后至多每秒 4 次；调用方先订阅再取，`onResync` 重取。不打开不在跑的后代会话就能交回。

### 会话关系

23. `fork` 一个子会话得到的新会话仍是同一个父会话的子会话（会话头照抄 `caller`），在 `tree` 里 `forked` 为真；派它的那次调用的卡片不跟它。`fork` 一个父会话得到的新会话不拥有原来的子会话，对它们 `agent_send` 得 `not-owner`。
24. 父 Agent 在进程重启后找回子会话：`sessions://` 的根里，本会话的子会话列出标题（`name` 或 `prompt` 的开头，输出 2）与派它的调用 id（[`resources.md`](resources.md) 输出 13）。
25. 远程 `ancestors({sessionId})` 交回这个会话的祖先链 `[{id, title, profile, icon, archived, owner?}]`，从父会话起，不受归档与作品范围过滤。`owner` 是那个祖先会话头的归属（planned，只有树根可能有，[`sessions.md`](sessions.md) 输出 23）：浏览器据此知道一个子会话属于谁的树（[`conversation.md`](conversation.md) 输出 53）。
26. **提问的提醒。** 后台的子代理停在一个交给调用方的同步提问上、没有前台在等时，任务中心把提问作为一条回执提醒送给父会话（[`jobs.md`](jobs.md) 输出 14），写明子会话 id、提问 id、题干与 `agent_answer` 的写法；已经送出的提问，前台的 `agent_send`、`agent_answer` 不再交一次。（planned）不论父会话是不是根会话都带唤起（子代理停在提问上等着，没人答就一直等）；同一个提问只送一次；提醒取走之前提问被答了、任务停了，提醒撤回。

## 状态与转换

子会话按内核的运行状态走（[`harness/runtime.md`](../harness/runtime.md)）；对父会话可见的是输出 21 的 `state`。

时序与寿命：

- 子会话在 `agent_spawn` 返回之前建好，之后就能在 `list`、`tree` 与 `sessions://` 里看到。
- 子会话的寿命与父会话无关：父会话关闭、归档，子会话照样在。
- 父 Agent 与用户同时插话、同时应答同一事项：先到的生效，后到的应答得 `already-answered`。
- `nbook.agent` 停止时所有子代理运行按 `interrupted` 收口；重开父会话，正在等它的那个工具调用按内核的恢复结算（[`harness/runtime.md`](../harness/runtime.md) 输出 34），不再等。

## 副作用与数据

- 子会话是普通的会话目录（[`sessions.md`](sessions.md)），会话头记着调用方与调用 id；关系不另存。
- 截断的全文进父会话的 `session://artifacts/`。
- `tree` 的推送在内存里，不落盘。

## 失败与恢复

本插件的码：

| 码 | 工具 | 含义 | 调用方怎么办 |
|---|---|---|---|
| `profile-not-found` | spawn | 没有这个 Profile | 读 `profiles://` 换一个 |
| `profile-not-allowed` | spawn | 不在白名单里 | 换白名单里的；用户可在设置里加 |
| `output-schema-fixed` | spawn | Profile 已声明结果 schema | 不给 `outputSchema` |
| `initial-invalid` | spawn | 初始输入不合 schema | 照 schema 改 |
| `depth-limit` | spawn | 层数超了 | 自己做，或让用户调高 `subagentDepth` |
| `concurrency-limit` | spawn、send、answer | 同时在跑的超了；`scope: "session"` 时 `wait` 等自己的结束，`global` 时自己做或稍后再试 | 见左 |
| `mode-unsupported` | spawn、send、answer | 父会话不在普通模式，子 Profile 没有 Agent 模式 | 换有模式的 Profile，或等用户切回普通模式 |
| `model-unavailable` | spawn | 模型或角色解析不了 | 换模型或不写 `model` |
| `not-owner` | send、answer | 不是自己派的子会话 | 只操作自己派的 |
| `session-not-found` | send、answer | 子会话不存在 | 检查 id |
| `already-running` | send | 不带 `message` 时子会话在跑 | 用 `wait` 等，或带 `message` 插话 |
| `child-stopping` | send、answer | 子会话的运行正在中止 | 稍后再发 |
| `question-unknown` | answer | 提问不在待处理里（含被回退掉的分支上的） | 用状态 `question` 时交回的事项 id |
| `not-allowed` | answer | 事项只能由用户答（审批、交给用户的提问、模式切换请求） | 不答，等用户 |
| `unavailable` | 全部 | `nbook.agent` 正在停止 | 无 |

原样交回的内核码：`send`、`enqueue`、`start`、`resolve`、`changeSettings` 的全部失败码（[`harness/runtime.md`](../harness/runtime.md) 各指令的失败码，例如 `nothing-to-continue`、`already-answered`、`input-rejected`、`read-only` 与模型解析失败的码）；子会话打开或新建失败时，原样交回存储的码（[`harness/session.md`](../harness/session.md)）。

## 边界与兼容

- 公开接口：三个工具的名字与参数、失败码；Profile 声明的 `agents`；远程 `tree`、`treeChanged`。
- 信任边界：子代理的结果是数据，不是用户的指令；任何会话都能读任何会话的日志与工作区（[`resources.md`](resources.md)），写只能写自己的 `home/`。

## 验收与 Smoke

1. 主创在同一条回复里派两个 adhoc：两个子会话并发跑，父会话在等；一个完成一个出错，父 Agent 收到两份带来源标记的结果；父会话里两张卡片进度跟着变，结束后一行结果。
2. 子会话要审批：父会话输入框上方停着它并标来源；在父会话批了，子会话继续；在子会话里批也行，另一边跟着消失；停着时父会话照常能插话。
3. 子会话向调用方提问：`agent_spawn` 返回 `question`；`agent_answer` 回答后同一个任务接着跑到完成。
4. 用户在父会话插话，包括插话早于 `agent_spawn` 开始：等待以 `running` 返回，插话送达；父 Agent 之后用 `wait` 取到结果。
5. 父会话中止：`agent_spawn` 立即以 `aborted` 返回、带子会话 id；`async` 派出的照常跑，`kill` 才停；子会话还在中止时 `agent_send` 得 `child-stopping`，停完后再发照常送达。模式：父会话在 `plan` 下派 adhoc，子代理的 `write` 被闸门拦下；`normal` 下派出的子会话，父会话切到 `plan` 后 `agent_send`，子会话先被收紧到 `plan`；子会话的模式切换请求出现在父会话的停靠区，`agent_answer` 答它得 `not-allowed`。
6. 上限：同一回复派 9 个，恰有一个得 `concurrency-limit{scope: "session"}`；第 4 层得 `depth-limit`；被拒的都没有留下子会话。
7. 进程重启：在跑的子代理运行按“已中断”收口；父 Agent 从 `sessions://` 根按名字找到原来的子会话，`agent_send` 让它继续。
8. 白名单：设置页去掉 adhoc，主创的提示词里不再有它，派它得 `profile-not-allowed`。
9. 费用：子代理的花费算进会话树的上限（[`run-guards.md`](run-guards.md) 输出 13），到上限时树里的会话都不再发请求。

Smoke：`packages/neuro-book/e2e/agent-subagents.e2e.ts`（场景 1、2、4）。

## 实现合同

- **公开入口**：工具 id `nbook.agent.spawn`、`nbook.agent.send`、`nbook.agent.answer`（经 `agent.tools` 贡献，给模型的名字是 `agent_spawn`、`agent_send`、`agent_answer`）；Profile 声明的 `agents`（`agent.profiles`）；提示词里“可派的子代理”一节是扩展 `nbook.agent.subagents`；远程 `tree`、`treeChanged`、`ancestors`（`agentSessionsContract`）。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口持有会话关系表、子代理的运行跟踪与 `tree`；子会话经同一个会话句柄表建与打开，以会话的身份发话（nb-harness 内核的 `as(issuer)`、会话头的 `caller`、调用的 `invocation`）；每次运行登记成任务中心的任务（[`jobs.md`](jobs.md)）。父会话里的卡片与停靠区在 nb-agent-ui 与 Agent 插件的浏览器端（[`conversation.md`](conversation.md) 输出 33–39）。
- **关键不变量**：
  - 派发的检查（白名单、深度、名额、模型）都在建子会话之前，被拒的不留下子会话（`subagents.test.ts`“输出 1、9”“场景 6”）。
  - 名额先同步占位再建子会话，建不成或收紧失败时退回；续用的 `agent_send`、`agent_answer` 同样先占后用（`jobs.test.ts`“上限”，`subagents.test.ts`“场景 6”）。
  - 前台等待在插话、超时、提问、结束任一条件下返回，返回时放开对任务的等待（`subagents.test.ts`“场景 4”“输出 6”“场景 3”）。
  - 会话关系表启动时扫一次索引，之后派发与 fork 增量登记；深度、`tree` 与费用的会话树都读它（`subagents.test.ts`“会话关系”“输出 23”）。
  - `tree` 的推送合并限频、没变不推，单条放不下时不推并写诊断（`subagents.test.ts`“输出 21、22、25”）。

## 证据

- 批准依据：[w00032 t14](../../../.agents/works/w00032-agent-integration/tasks/t14-multi-agent/README.md) 的决定与[计划](../../../.agents/works/w00032-agent-integration/tasks/t14-multi-agent/plan.md)；开发者 2026-11-10 确认计划，同日批准晋升为 `implemented`；缓冲区条目的就绪与留着、放行、继续与停止的两个选项（本 Task 加的条目）依据 [提案：输入缓冲区](../../proposals/agent-input-buffer-states.md)（2026-11-18 接受）与 [w00043 t14](../../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/README.md)，逐句核对后晋升（[核对处理](../../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/evidences/promotion-check-disposition.md)）。
- 实现入口：[`backend/subagents/tools.ts`](../../../packages/neuro-book/src/plugins/agent/backend/subagents/tools.ts)、[`children.ts`](../../../packages/neuro-book/src/plugins/agent/backend/subagents/children.ts)、[`relations.ts`](../../../packages/neuro-book/src/plugins/agent/backend/subagents/relations.ts)、[`tree.ts`](../../../packages/neuro-book/src/plugins/agent/backend/subagents/tree.ts)、[`prompt.ts`](../../../packages/neuro-book/src/plugins/agent/backend/subagents/prompt.ts)、[`shared/profile-agents.ts`](../../../packages/neuro-book/src/plugins/agent/shared/profile-agents.ts)、[`shared/subagents.ts`](../../../packages/neuro-book/src/plugins/agent/shared/subagents.ts)
- 合同测试：[`subagents.test.ts`](../../../packages/neuro-book/src/plugins/agent/subagents.test.ts)（真实内核与会话存储、本机假端点）、[`subagent-card.test.ts`](../../../packages/neuro-book/src/plugins/agent/subagent-card.test.ts)、[`session-host.test.ts`](../../../packages/neuro-book/src/plugins/agent/session-host.test.ts)（“子代理”一组）；输出 10、16 的去向、撤回与留着：`subagents.test.ts`（“话的去向”）
- Smoke：[`agent-subagents.e2e.ts`](../../../packages/neuro-book/e2e/agent-subagents.e2e.ts)
