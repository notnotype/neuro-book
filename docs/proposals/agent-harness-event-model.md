---
schema: nbook.proposal/v1
status: draft
created: 2026-10-28
decided: null
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# Agent harness 的事件模型：一台由日志驱动的状态机

本稿给 `nb-harness` 定一个基本模式：harness 是一台异步状态机，接受指令、向外吐事件；它的全部状态都由日志归约（reduce）而来，请求是状态的视图，调用模型与执行工具是副作用，结果写回日志。Profile 与插件都是“扩展”，只做四件事：归约、反应、视图、拦截；对话记录（`Message[]`）本身也是一个扩展。它取代 [w00032 t20](../../.agents/works/w00032-agent-integration/tasks/t20-hooks/README.md) 讨论中按钩子点逐个定义的做法，也改写 [w00032 t05](../../.agents/works/w00032-agent-integration/tasks/t05-profile/README.md) 里 Profile 的上下文机制。

## 问题

接入 Agent 的讨论（w00032 t05、t20，2026-10-28）走到钩子时暴露出几处别扭：

- **同一件事两套机制。** Profile 的 TSX 里有种子、`Appending`、`Reminder`、按请求刷新的数据源、`<Slot>`，钩子也能在同样的时刻往上下文里加东西。规则要写两遍，作者也不知道该用哪个。
- **`Appending` 一边排版一边写日志。** 它既决定消息排在哪，又在每次调用开始时把消息写进日志，Profile 的“组装”与“往历史里加东西”搅在一起。
- **钩子点越加越多，每个点各有一套合并规则。** 第二版方案有十几个点，拦下、改参数、追加内容、继续运行各有字段与合并方式，生命周期却没有说清。
- **输入的来源很杂。** 一次请求里除了用户的话，还有插件的数据（记忆、文件变更）与程序状态（阅读位置、字数）。它们哪些要写进历史、哪些只对这一次请求有效、摆在用户的话前面还是后面、回退之后应该是什么样，没有统一的回答。
- **回退、重启、预览、压缩要处处对。** 会话是树（t03），回退之后每个扩展的状态都要跟着回去；服务端重启之后要能照日志重建；压缩之后扩展不能丢状态。

## 目标与非目标

目标：

- 一个基本模式解释整个 harness：指令进、事件出；一次运行就是反复地“由状态算出请求 → 调用 → 把结果写回日志 → 归约出新状态”。
- Profile 与插件用同一套扩展接口，Profile 排在最后、地位最高；缺省的对话记录也是扩展，Profile 可以定它的样子。
- 所有会影响模型所见的状态都由日志归约而来，回退、fork、重启、压缩、预览自动正确。
- 请求在发出之前可以被任意修改，但谁改了什么查得到。
- 缓存稳定是结构上的结果：已经提交的轮不再变，进行中的这一轮只往后长。

非目标：

- 工具发现与 CodeAct（[t21](../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/README.md)）、后台任务与协作（[t22](../../.agents/works/w00032-agent-integration/tasks/t22-background-work/README.md)）。
- 安全加固（t12：第一版的挡板是只读命令白名单与审批模型）。
- 用户级的 shell 命令钩子（类似 Claude Code 的 `hooks.json`），以后再做。
- 多进程扩展：扩展在服务端实例的进程内运行。

## 当前行为与证据

- **master 的 `nb-harness`**：Profile 用 `ProfilePrompt`、`System`、`HistorySet`、`<If tool>` 写成，每次请求前渲染一次；没有钩子（[`agent/harness.md`](../specs/agent/harness.md)）。
- **内核分支 `feat/w00002-harness-kernel`**（按 t02 的决定，代码以它为主体搬到 master）：Profile 宿主有 `Appending`、`Input`、`Reminder`、有状态的节点、种子、`<Slot>`；会话模块已经是事件溯源的一半（`fold(entries, defineProjection({initial, reduce}))`，`sessionStatus`、`sessionSettings` 由日志归约）；运行时有工具拦截器、宿主审批回调、运行时级订阅。
- **两条线的循环都套在 OMP 的 `Agent` 上**（`pi-agent-core`）。`Agent` 自己维护一份上下文，harness 经 `transformContext` 每次请求前按日志重新渲染；master 的模块头注释写了为此做的等待（上一批工具结果的 `message_end` 可能还没投递，渲染前要先等它们写进日志）。
- **omp**（[外部参照](../research/agent-runtime-references.md)的“钩子”一节）：事件钩子 `pi.on(事件, 处理函数)`，能改写用户输入、替换本次请求的消息、改原始请求体、拦下或改写工具调用与结果、取消或接管压缩；运行中的输入分 steer 与 followUp 两种队列。
- **Claude Code**（官方文档）：33 种钩子事件，只返回声明式的结果；注入的上下文以 `<system-reminder>` 附在用户消息里。
- **同类思路**：Elm 架构（Model、Update、View、Cmd）；LangGraph 的按通道 reducer 与检查点；Google ADK 把发给模型的上下文定义为“建在有状态系统之上的编译出来的视图”，会话是带类型的事件日志、上下文由一串有名字的处理器每次重算，并分稳定前缀与变化的后缀（[Google Developers Blog](https://developers.googleblog.com/en/architecting-efficient-context-aware-multi-agent-framework-for-production/)）；VS Code 的 prompt-tsx 与 Cursor 的 Priompt 用带优先级与 token 预算的组件树写提示词。

## 方案

本节是第四稿。第三稿经过一个原型（spike）与两位审查者两轮审查；第四稿按开发者 2026-10-29 提出的“异步状态机”重新组织，改了什么见下面第 0 节。spike 是第三稿的（`.agents/works/w00032-agent-integration/tasks/t20-hooks/spike/`），第四稿新增的部分只有类型（`spike/v4/api.ts`）与主创的例子（`spike/v4/leader.default.tsx`），过了 tsc，没有运行。

### 0. 第四稿改了什么

- **一台状态机**：指令进、事件出。新增**输入缓冲区**：用户提交的话先进缓冲区，可以改、可以删；运行中继续输入，按 steer 或 followup 处理（第 3 节）。
- **对话的形状**：`core.history` 不再给三段平铺的列表，而是已提交的轮与进行中的这一轮（第 5 节）。用户的话立刻进日志，一轮结束才提交进 `Message[]`。
- **Profile 的 `turn` 与 `commit`**：一轮给模型看的样子由 Profile 写一个函数决定，进行中与提交用同一个，缓存稳定由结构保证。记忆、通知这类附带内容缺省排在用户的话前面，用户的话留在这一轮最后（第 6 节）。
- **模板节点**从 `<History>`、`<Input>`、`<Transcript>`、`<Slot>` 改为 `<History>`、`<Turn>`、`<Slot>`。
- **事件只有两类**：`conv` 进这一轮、`ext` 不变成消息。开场（种子）不是一类事件，而是一片状态加一个稳定的槽（`opening()`，第 11 节）。
- **接口形状**按 2026-10-29 的讨论修订，见第 16 节（正文里的事件名与写法仍是修订前的，以第 16 节为准）。
- **压缩**按轮与步来切，进行中这一轮的输入总是原样保留（第 9 节）。
- **推迟**四项可选功能：`sample`、预览过去的请求可复现、一般的缓存比对诊断、工具的共享与独占并发（第 14 节）。

### 1. 一台异步状态机

```text
            指令（入队、改、删、开始、中止、回退、压缩、换设置……）
                │ 内核校验：不合法的直接拒绝，不写日志
                ▼
日志（事件） ──归约──▶ 状态 ──视图──▶ 请求 ──调用──▶ 响应 ──追加──▶ 日志
                ▲                                         │
                └────────────── 反应：新的事件 ◀────────────┘
                │
                ▼
            向外吐：写进日志的事件；另有不进日志的流式增量，只给界面
```

- **状态**全部由日志归约：各扩展的片、内核的缓冲区、运行到哪了。没有临时状态，也没有另存的状态文件（第 4 节）。
- **指令**相当于 Elm 的 Msg、CQRS 的 command：内核校验之后写成事件，事件才是事实。
- **运行**是 ReAct 循环，可能有好几轮：一轮从一条输入开始，结束时如果缓冲区里有 followup，同一次运行接着开下一轮。
- **向外吐**的东西只有两种：写进日志的事件（界面、订阅者、审计都看它），以及模型正在吐的字（流式增量，不进日志，不算状态）。

循环由内核自己写，不再套 OMP 的 `Agent`；与服务商通信只用 OMP 的 `streamSimple`，由 `nbook.models` 的模型适配器调用（t09，第 8 节）。理由：本稿要求“一条事件的反应全部完成后才算下一次请求”“模型调用可以重试与换模型”“日志是唯一的上下文”，`Agent` 自己的上下文与异步投递的事件和这几条都要对着干。代价是内核自己实现插话、中止与收口；spike 已把这几样做出最小版本。

一次运行：

```text
开始：写 run_started；从缓冲区取走第一条输入，写 turn_started 与 user（as: turn）
  └─ 全部扩展归约、反应（记忆检索、文件通知……写成这一轮的附带内容）
边界（每次模型请求之前）：
  缓冲区里的 steer 全部取走，写 user（as: steer）；运行中到达的外部事实、设置变化按到达顺序写入
  估算请求大小，超过阈值先压缩（第 9 节）
请求：视图算出请求，经模型拦截链；最里层先写 model_started，再发给服务商
回复：写 assistant，归约、反应
  有工具调用：写 tool_started，执行，按调用顺序写 tool_result，归约、反应，回到边界
  没有工具调用：有没取走的 steer，或扩展显式要求接着做（最多连续 3 次），回到边界
              否则写 turn_ended，core.history 提交这一轮
                缓冲区有 followup：取走一条，开新的一轮
                没有：写 run_ended
```

任何一步出错、被中止，都写 `turn_ended`、`run_ended`（`error`、`aborted`）收口；进程崩溃留下的半截运行，重新打开时由 `recover()` 结算（第 2 节）。

### 2. 日志与作用域

日志只追加（t03），已经写下的条目谁都不能改。日志记的是事实，模型看到什么由投影决定：日志里有的不一定进请求，请求里的也不一定原样来自日志。

**两种作用域**：path 事件挂在会话树的当前路径上，回退之后不在路径上的就不算；session 事件在树外，回退不影响。

**事件的种类**（`cls`）决定它在对话里的位置：

| 种类 | 例子 | 在对话里 |
|---|---|---|
| `conv` | 用户的话、助手回复、工具结果、扩展的通知、检索结果、提醒 | 进当前这一轮（第 5 节） |
| `ext` | 扩展的状态变化、外部事实（“第 3 章被改了”） | 不变成消息，只给扩展归约 |
| `ctrl` | 运行、轮、模型请求、工具开始、设置、叶子、Profile 变化、压缩 | 不变成消息，只有内核写 |

**内核事件**是固定的一组，导出为常量 `K`，每种的 `data` 有类型：

| 作用域 | 事件 |
|---|---|
| session | `input_queued`、`input_edited`、`input_removed`、`input_consumed`、`settings_changed`、`leaf_changed`、`profile_changed` |
| path | `session_created`、`run_started`、`run_ended`、`turn_started`、`turn_ended`、`user`、`assistant`、`tool_result`、`model_started`、`model_failed`、`tool_started`、`compaction`、`reaction_limit` |

“会话已打开”（`session_opened`）不进日志，只交给反应。

**扩展事件**由 `defineExtension` 的 `events` 声明（`conv()`、`ext({scope})`），类型自动带上扩展 id 前缀（`nbook.history/fileChanged`），带版本（缺省 1）。内核拒绝扩展写不以自己 id 开头的类型，未知来源一律拒绝。事件带 `cause`（引出它的那条事件）与 `depth`；可以带幂等键 `key`，同一来源同一个键只写一次，命中时反应也不再跑。一个扩展对一条事件的输出是一个整体：有一条不合规矩，这次的全部不写。

**什么时候写进日志**（由内核写，时间不开放）：

| 东西 | 写入时刻 | 作用域 |
|---|---|---|
| 缓冲区的入队、改、删 | 指令受理时 | session |
| 用户的话 | 从缓冲区取走时：开新的一轮时，或运行中的边界；经输入拦截链，改写过的原文记在 `original` | path（同时写 session 的 `input_consumed`） |
| 模型请求 | 发出之前写 `model_started`：序号、哈希、`now`、修改记录；失败写 `model_failed` | path |
| 助手回复 | 流结束时写完整回复 | path |
| 工具 | 执行之前写 `tool_started`；完成后写结果，拦截改过参数时记实际执行的 `args`，改过结果时记工具原本的 `raw` | path |
| 反应的输出（通知、检索结果、提醒） | 反应返回时 | 按声明 |
| 外部事实、设置变化 | 空闲时立刻；运行中到下一个边界 | 按声明 |
| 回退、切分支 | 指令受理时写 `leaf_changed` | session |
| 槽的内容 | 从不写 | — |
| 流式输出的增量 | 从不写；只推给界面 | — |

**单写者**：一个会话的写入只有一个顺序。所有写入口排进同一条队列，前一个连同它引出的全部反应做完，后一个才开始（spike 场景 48）。运行中到达的外部事实与设置变化进运行自己的收件箱，在下一个边界按到达顺序写入，不插进正在算的请求或正在执行的工具（spike 场景 33、34）。缓冲区的入队、改、删不受运行影响，随时写，因为它们是 session 事件、不改变正在进行的这一轮。

**打开与恢复**：`load()` 先校验日志（id 唯一、seq 递增、父节点在前、类别与作用域合法、类型要么是内核事件要么带扩展前缀、幂等键不重复），校验不过就拒绝打开、报损坏；再照日志归约，不跑反应；当前叶子取最后一个“path 事件或 `leaf_changed`”指向的节点。`recover()` 处理崩溃留下的半截运行：开始执行但没有结果的工具调用写成“结果未知”，发出但没有回复的模型请求写 `model_failed`，最后写 `turn_ended`、`run_ended`（`interrupted`）（spike 场景 24、28）。缓冲区里没取走的输入留着。

### 3. 输入缓冲区与指令

用户提交的话先进缓冲区，取走时才成为对话里的事实。缓冲区是内核的状态，在 session 作用域：回退对话时，提交了还没取走的话不会丢。

| 指令 | 什么时候能用 | 写什么 |
|---|---|---|
| `enqueue(input, mode)` | 随时；`mode` 是 `steer` 或 `followup`，由界面在入队时定 | `input_queued` |
| `edit(id, input)`、`remove(id)` | 取走之前 | `input_edited`、`input_removed` |
| `start()` | 空闲时；缓冲区空时是没有新输入的“继续”运行 | `run_started` 起的一次运行 |
| `send(input)` | 随时：`enqueue` 加上空闲时 `start`（对话框的发送按钮） | 同上 |
| `abort()` | 运行中 | 收口，`run_ended(aborted)`；缓冲区里没取走的留着 |
| `rewind(to)` | 空闲时；运行中先 `abort` | `leaf_changed` |
| `compact(要求?)` | 随时：空闲时开一次只压缩的运行，运行中到下一个边界 | `compaction` |
| `changeSettings(patch)` | 随时；运行中到下一个边界 | `settings_changed` |
| `reconfigure(profile, 插件清单)` | 空闲时 | `profile_changed`，照新清单重新归约（第 10 节） |
| `external(event)` | 随时（插件写外部事实）；运行中到下一个边界 | 扩展事件 |

不合法的指令直接返回错误，不写日志（例如运行中回退、改已经取走的输入）。

**取走的规则**：

- 开始运行时取走第一条，开一轮；它之后入队的 `steer` 在第一个边界取走，成为这一轮的附带内容。
- 运行中：`steer` 在每个边界全部取走，按入队顺序写成 `user（as: steer）`，进当前这一轮；模型给出最终回复时还有 `steer` 没取走，这一轮接着请求。
- 一轮结束时：`followup` 取走一条，同一次运行里开下一轮（多条 followup 是一条一轮还是合成一轮，待定项 17）。
- 取走时经输入拦截链；被拒绝的写 `input_consumed{rejected}`，不写 `user`；它是开新一轮的那条时，运行以 `input-rejected` 结束。

### 4. 扩展的状态与归约

为什么用“日志加 reduce”：扩展的状态必须跟着对话路径走（回退到第 3 次发言，提醒计数也回到 3），重启后要恢复，预览与运行要看到同一份，压缩之后不能丢。存在内存里，回退与重启都不对；另存状态文件，要给树上每个节点存一份才回得去（那就是又一份日志），日志写成了、状态没写成时两边还会对不上。由日志归约，只有一个真相源，换一片叶子重新归约就对。

**片**：一个扩展可以有多片状态，每片一个作用域：`path(initial)` 跟着对话路径走，`session(initial)` 在树外（人设、库结构、工作区焦点这类不随回退变的）。工作区焦点这样“值在树外、告诉过模型的是哪个跟路径走”的，一个扩展两片就够（spike 场景 15）。

```ts
export const fileNotice = defineExtension({
    id: "nbook.history",
    state: {pending: path<string[]>([])},
    events: {fileChanged: ext<{uri: string; by: string}>(), notice: conv(), delivered: ext()},
    reduce: {
        // 每片一个归约函数：自己那片、这条事件、自己的事件守卫、同一作用域的兄弟片；返回 undefined 表示不变
        pending: (p, e, ev) => (ev.fileChanged.is(e) ? [...p, e.data.uri] : ev.delivered.is(e) ? [] : undefined),
    },
    react(e, ctx) { /* 第 7 节 */ },
});
```

- **归约只看自己**：看得到自己那片与同一扩展里同一作用域的兄弟片，看不到别的扩展，也看不到另一个作用域。各扩展的归约互不依赖，谁先谁后结果都一样。
- **作用域决定收到哪些事件**：path 的片收 path 事件；session 的片只收 session 事件。要从 path 事件得到一个不随回退变的值，在反应里 `ctx.set` 写进 session 的片。
- **返回 undefined 表示不变**；**归约出错不挡日志**：叶子照样前进，出错的那一片保持原值并写诊断，重放时结果相同（spike 场景 41）。
- **简单的值用 `ctx.set(片, 值)`**：生成一条内核认识的设置事件，作者不写归约函数；值没变时内核不写。
- **默认私有，经选择器共享**：别的扩展只能读 `exports` 导出的选择器，插件经声明合并登记，读的一方得到类型；同一个 Profile 自带的扩展之间可以读原样（`own(id)`）。
- **只读、普通数据**：状态只能是普通数据，类型上是 `Readonly`，开发模式下冻结（spike 场景 30、53）。
- **能算出来的不存，不确定的才写成事件**：模型输出、工具结果、外部取来的数据、压缩摘要是事件；`Message[]`、计数、清单都是归约结果，不另存一份。存储层可以隔一段存一个状态快照让打开更快，快照是缓存，删了能重算（待定项 3）。

### 5. 对话的形状：已提交的轮、进行中的这一轮

对话记录由内置扩展 `core.history` 从日志归约而来，它的状态是一片 path：

```ts
interface HistoryState {
    summary: Entry | null;                // 最近一次压缩的摘要，排在已提交的轮前面
    committed: {turnId: string; turn: Turn; messages: Message[]}[];   // 已提交的轮：提交时按 Profile 的 commit 渲染一次
    current: Turn | null;                 // 进行中的这一轮
    waiting: Entry[];                     // 空闲时写的 conv 事件，等着成为下一轮的附带内容
}
interface Turn {
    id: string;
    input: Entry<"user"> | null;          // 没有新输入的“继续”运行为 null
    attachments: Entry[];                 // 输入之后、第一次模型调用之前写入的 conv 事件
    steps: {reply: Entry<"assistant">; results: Entry<"tool_result">[]; after: Entry[]}[];
}
```

**每条事件去哪**，按它写入时的位置决定，不按谁引出了它：

| 事件 | 去处 |
|---|---|
| `turn_started`、`user（as: turn）` | 开 `current` |
| `current` 里还没有回复时写的 `conv` 事件（记忆、通知、提醒、开头的 steer） | `current.attachments` |
| `assistant` | `current` 新的一步 |
| `tool_result` | 这一步的 `results` |
| 某一步之后写的 `conv` 事件（插话、对工具结果的提醒、“接着写”） | 这一步的 `after` |
| 空闲时写的 `conv` 事件 | `waiting`，下一轮开始时并进它的 `attachments` |
| `turn_ended` | 按 commit 渲染 `current`，并进 `committed` |
| `compaction` | 见第 9 节 |

所以“记忆检索结果排在用户的话后面”这个问题不存在了：日志里检索结果在用户的话之后写（事实就是这个顺序），但在对话的形状里它是这一轮的附带内容，摆在哪由 Profile 的 `turn` 决定。

**提交**：一轮结束时，`core.history` 用 Profile 的 `commit`（缺省与 `turn` 相同）把这一轮渲染成消息，并进 `committed`。提交后的消息不再变：下一次请求的历史就是已提交的消息原样拼接，不用重新渲染整段历史。

导出的选择器：`opening`、`committed`（消息）、`current`（进行中的这一轮）、`input`（这一轮的输入）。路由插件读 `read("core.history", "input")`，不用去请求的消息里猜（spike 场景 10）。

### 6. 视图：请求怎样算出来

“视图”指整个“状态 → 请求”这一步，只在要发请求和预览时算。它由三样东西一起完成：`core.history` 给出对话的形状，扩展的 `contribute` 往有名字的槽里交内容，Profile 的模板决定摆在哪。

**请求的形状**与服务商无关，内容是块：

```ts
interface ModelRequest {
    model: string;
    params: {temperature?: number; topP?: number; maxTokens?: number; stop?: string[]};
    headers: Record<string, string>;
    system: Block[];
    messages: {role: "user" | "assistant" | "tool"; content: Block[]; toolCalls?: ToolCall[]; callId?: string}[];
    tools: ToolInfo[];
}
interface Block {text: string; origin: string}   // origin：事件 id、`slot:<名字>@<扩展>` 或 `fixed`
```

块保留来源：模板写的固定文字、扩展交的槽、用户的原话分在不同的块里，相邻的 user 消息不在内核里拼接（服务商要求时由适配器合成一条多块消息），模型也分得清哪句是用户说的。

**模板的节点**：

| 节点 | 是什么 |
|---|---|
| `<System>`、`<User>`、`<Assistant>` | 容器：每个子节点一段，段与段空一行 |
| `<P>`、`<Tag>` | 行内：子节点直接相连 |
| `<If tool>` | 有这个工具时才出现 |
| `<History />` | 压缩摘要与已提交的轮，原样拼接 |
| `<Turn />` | 进行中的这一轮，按 Profile 的 `turn` 渲染；模板里必须恰好一个 |
| `<Slot name>` | 扩展交的内容，每次请求现算；`*` 必须写 `stable` 或 `volatile` |

不写 `prompt` 时用缺省布局：

```tsx
<System>{声明里的 system}<Slot name="*" stable /></System>
<User><Slot name="opening" /></User>
<History />
<Turn />
<Slot name="*" volatile />
```

**Profile 的 `turn`**：一轮给模型看的样子，是一个纯函数，拿到 `Turn` 与渲染工具：

```ts
// 缺省：附带内容在前、用户的话在最后，合成一条 user 消息；然后是各步（回复、工具结果、after 合成的一条 user 消息）
turn: (t, m) => [m.user(...t.attachments, t.input), ...m.steps(t.steps)]
```

- `m.user(...)` 把条目按 `render` 渲染成块、合成一条消息，空的不出；`m.steps` 是缺省的各步，自己写时也可以只改一部分。
- 单轮模板不需要别的节点：行内编辑把选区和要求排进同一条消息，`turn: (t, m) => [m.user("请改写下面这段：", selection(t), "要求：", t.input), ...m.steps(t.steps)]`，模板里只有 `<System>` 与 `<Turn />`。
- **`render`**：`{事件类型: (e) => 文字 | null}`，Profile 级，对历史与进行中的这一轮一律生效，覆盖扩展给的缺省渲染；键不是已知的事件类型时装配写诊断。扩展给自己的事件提供缺省渲染（检索结果在日志里存结构化数据，渲染成 `<memory>…</memory>`）；没有渲染的扩展 `conv` 事件缺省包成 `<system-reminder>`。

**缓存由结构保证**：服务商的提示词缓存按前缀命中。

- `<History />` 是已提交的消息，提交后不再变；新的一轮提交只在末尾追加。
- 进行中的这一轮按 `turn` 渲染；缺省的 `turn` 只往后长（新的一步接在后面，前面的不变）。
- 缺省的 `commit` 就是 `turn`：一轮提交后的样子与它最后一次请求里的样子相同，下一次运行时这一轮照样命中。

开发模式下内核检查两件事，违反时写诊断：同一轮相邻两次渲染，前一次必须是后一次的前缀（自己写的 `turn` 在前面放了会变的东西时会违反）；Profile 没写 `commit` 时，提交的样子必须等于最后一次渲染。Profile 写了 `commit`（例如历史只留最终回复），提交与进行中不同是它的明确选择，下一次运行从这一轮开头起缓存失效一次，不写诊断。

**扩展的 `contribute`** 声明槽与内容写在一起：

```ts
contribute: {
    "word-count": {volatile: true, value: (mine, view) => `本章当前字数：${mine.words}`},
    "sql-schema": {value: (mine) => `<sql_schema>${mine.schema}</sql_schema>`},   // 没写 volatile 是稳定的
}
```

- 同一个槽有几个扩展交内容时，各成一块、按扩展顺序排；有意共用一个槽名的都写 `shared: true`，否则写“槽撞名”的诊断（spike 场景 45）。Profile 没摆某个槽：内容丢弃并写诊断。
- `value` 是纯函数，读自己的片与 `view`（`now`、工具、模型能力、别人的选择器）。外部数据先由反应写成事件、归约进片，再交给槽。

**会变的内容放哪**，三种写法各有代价：

| 写法 | 用户的话在最后 | 缓存 |
|---|---|---|
| 每轮一次就够的（文件变更、焦点、记忆、模式）：反应写成附带内容 | 是 | 全部命中 |
| 每次请求都变的：会变的槽放在末尾（缺省布局） | 否 | 只丢末尾的槽 |
| 每次请求都变的：会变的槽放在 `<Turn />` 前面 | 是 | ReAct 中途每次请求从槽往后重算；没有扩展交内容时没有代价 |

会变的槽放进系统提示词时写诊断“整段缓存失效”（spike 场景 13）。

### 7. 反应：在事件之后追加新的事件

```ts
react?(e: Entry, ctx): Reaction | Promise<Reaction>;
type Reaction = EventOut[] | {events?: EventOut[]; continue?: boolean} | void;
```

- 反应可以做 I/O（读文件、检索记忆、调一次不进会话的模型），返回要追加的事件：自己的事件用 `ctx.ev.<名字>(data)` 生成，普通的注入消息用 `ctx.message(text)`，改自己的一片用 `ctx.set(片, 值)`。要影响重放的外部输入都经反应变成事件，重放与预览不用再去取。
- **同一条事件的反应看同一份状态**，可以并发执行；全部完成后，追加的事件按扩展顺序写入（spike 场景 3）。**反应全部完成后，才算下一次请求。**
- **“接着做”要显式写**：对最终回复的反应返回 `{events, continue: true}` 才会再请求一次；连续最多 3 次，每次写诊断（spike 场景 17）。
- **深度上限**：根事件是第 0 层，最多写到第 3 层；超出时留一条 `reaction_limit`（spike 场景 26）。

### 8. 副作用与拦截

有副作用的步骤只有这几样：接受用户输入、调用模型、执行工具、压缩。每样都可以被拦截，形状是包裹式的：

```ts
interface Interceptors<Ctx> {
    input?(input: UserInput, next: (i: UserInput) => Promise<void>, ctx: Ctx): Promise<void | {reject: string}>;
    model?(request: ModelRequest, next: (r: ModelRequest) => Promise<ModelResponse>, ctx: Ctx): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (c: ToolCall) => Promise<ToolResult>, ctx: Ctx): Promise<ToolResult>;
    compaction?(job: CompactionJob, next: (j: CompactionJob) => Promise<CompactionResult>, ctx: Ctx): Promise<CompactionResult>;
}
```

- **改**：调 `next` 之前改输入，之后改输出。改的是与服务商无关的请求对象，原始请求体不开放。请求对象是只读的，改要返回新对象；每次模型调用的 `model_started` 记下哪些扩展改了哪几项与最终请求的哈希。
- **拦**：不调 `next`。输入拦截返回 `{reject: 理由}`；工具被拦下时返回一个错误结果；模型调用被拦下时可以直接给出一条回复。
- **重试、换做法**：调两次 `next`，或换个参数再调；每一次真实的模型调用与工具执行都进日志。
- **审批**（t06）在工具拦截链的最里层、执行之前判定；扩展的放行盖不过用户配置的拒绝、工具按参数声明的拒绝与只读模式（spike 场景 8）。
- **顺序**：一层套一层，外层是插件，最里层是 Profile（待定项 2）。插件按 `dependsOn` 排序，同一层按 id；依赖缺失或成环在装配时拒绝（spike 场景 40）。最终顺序与清单哈希写进 `profile_changed`。这个顺序也决定反应追加事件的顺序与同一个槽的拼接顺序。
- **各入口读到的是哪一刻的状态**：`reduce` 读这条事件之前的自己那片；`react` 读这条事件写入之后的状态；`contribute`、`prompt`、`turn`、模型拦截读这次请求所在的叶子；工具拦截读发出这批调用的回复所在的叶子；输入拦截读取走这条输入时的叶子。
- **工具**：一个回复里的工具调用按顺序执行，结果按调用顺序写入，整批写完后对每条结果派发反应（并发分类推迟，第 14 节）。
- **失败**：每个入口出错都写带扩展 id 的诊断（spike 场景 19、41、43）：`reduce` 出错这一片保持原值；`react` 出错这次的输出丢弃；`contribute` 出错这个槽这次不交；`render` 出错用缺省渲染；`prompt`、`turn`、`commit` 出错这次请求算不出来，运行以 `error` 收口；输入拦截出错跳过这一层；模型拦截在 `next` 之前出错跳过这一层，之后出错用里层的回复；工具拦截出错缺省拒绝这次调用。反应有时限（缺省 30 秒）。
- **中止**：`ctx.signal` 贯穿反应、拦截、模型调用与工具。不合作的由内核接管：内核等的每一个 Promise 都和中止信号赛跑，中止后不再等它，模型请求写 `model_failed`，没完成的工具调用写“已中止，结果未知”，运行以 `aborted` 收口；之后迟到的结果不写日志，只写诊断（spike 场景 35、50）。
- **模型适配器**：模型拦截链的最里层是 `nbook.models` 的适配器，`ModelRequest` 与 OMP 之间唯一的转换点（spike 用假模型，实施的第一个切片接真实的 `streamSimple` 验证）：

  | 方向 | 内容 |
  |---|---|
  | 请求 → OMP | `system` 的块拼成 `systemPrompt`；相邻的 user 消息合成一条多块消息；工具用完整声明，名字的 `.` 换成 `__`（t04）；`params`、`headers`、推理档、`signal` 进 `SimpleStreamOptions` |
  | 事件流 → 界面 | 文字、思考、工具调用的增量推给界面，不写日志 |
  | `done` → 回复 | 文字块、思考块（连同服务商要求带回的签名）、工具调用、停止原因、用量、回复 id；写成 `assistant` |
  | `error`、中止 → 失败 | 带错误类别（额度、溢出、鉴权、网络、服务商）与已产生的部分内容；内核写 `model_failed`。溢出时压缩后把同一请求再发一次，最多一次 |
  | 重试 | OMP 内部的鉴权重试、推理循环算同一次逻辑请求：一条 `model_started`，每次尝试记进诊断（待定项 12） |

- **预览**：预览下一次请求也跑模型拦截链，最里层不发请求、只截下请求，所以预览看到的是最终请求；拦截前要做 I/O 的扩展用 `preview: "skip"` 跳过（spike 场景 11）。

### 9. 压缩

压缩的触发、方法与摘要格式照 [t11](../../.agents/works/w00032-agent-integration/tasks/t11-compaction/README.md) 的决定；本节写它在对话形状里怎样落地。

**触发**（t11 决定 4）：

- 边界的最后一步：算出请求后估算 token（上一次回复的用量加之后新增的内容），超过阈值就先压缩，再重算请求。阈值按 t11 决定 1。
- 服务商报溢出：按溢出的方法顺序压缩后把同一请求再发一次，最多一次。
- 手动 `compact(要求)`：空闲时开一次只压缩的运行（`run_started{kind: compact}`），运行中到下一个边界。
- 压缩是运行之中的一步，界面显示“正在压缩”，可以中止；中止时不写压缩事件。

**方法**：经压缩拦截链，最里层是方法（`shake`、就地 `inplace`、摘要模型 `summary`，t11 决定 2）；方法拿到压缩前的请求与要求（Profile 的、`/compact` 后面的、扩展加的，t11 决定 7）。顺序由 Profile 给（阈值与溢出各一个），结果不合格按失败换下一个。就地压缩在压缩前的请求末尾追加一条压缩请求，吃得到缓存。

**切点只在轮与步的边界**：`firstKeptEntryId` 是某一轮的 `turn_started`，或进行中这一轮里某一步的 `assistant`。切在一步中间会拆开工具调用与结果，不允许。

**结果**是一条 path 上的 `compaction` 事件：`{method, firstKeptEntryId, replacement, omitted, tokensBefore, tokensAfter, details}`（t11 决定 8 的形状加 `omitted`）。`core.history` 这样归约它：

- 切点之前的已提交的轮去掉，`replacement`（摘要）排在剩下的已提交轮前面；
- 切点落在进行中这一轮里时，这一轮的输入与附带内容原样保留，切点之前的步去掉（被摘要覆盖）；
- `omitted` 列出 shake 省略内容的条目：消息还在（工具调用与结果照样成对），文字换成可找回的占位（“已省略 read 的结果，需要时重新读取”），受影响的已提交轮重新渲染一次。

**之后的公共流程**（t11 决定 6）是对压缩事件的反应：开场（`opening()`）在压缩事件上重读，槽的内容随之更新；`core.compaction` 把最近读过的至多 5 个文件、`session://plan.md`、加载过的 Skill 与完整对话记录的地址写成 `conv` 事件，压缩发生在哪个边界就跟在那里（与 Claude Code 摘要后接放回的附件一致）。

压缩之后的样子：

```text
<System>…</System>
开场槽：[目录、参考文档（压缩后重读）]
历史：[摘要] [切点之后的已提交的轮]
进行中的这一轮：[附带内容] [用户的话] [切点之后的步] [放回的文件、计划、Skill]
```

**扩展的状态不受压缩影响**：片从事实归约，压缩不改事实，任务清单、计数、没送达的改动都还在。扩展要做的只有一件事：记着“告诉过模型什么”的片，在归约里遇到压缩事件就清空，下一轮重新告诉模型（主创例子里的工作区焦点）。

**回退与压缩**：回退到压缩事件之前，路径上没有它，归约得到压缩前的对话；旧的条目都在日志里，界面能看压缩前的原文（t11 决定 9）。

spike（第三稿）验证了替换与种子重写（场景 29）；按轮与步切、保留进行中这一轮的输入、`omitted`、触发与方法顺序都没有做。

### 10. 扩展的形状与生命周期

```ts
export const x = defineExtension({
    id: "nbook.history",                 // 小写字母、数字、点与连字符；装配时检查格式与重复
    tags: ["history"],                   // Profile 按标签排除
    dependsOn: [],
    state: {pending: path<string[]>([]), seen: session(0)},
    events: {fileChanged: ext<{uri: string}>(), notice: conv()},
    reduce: {pending: (p, e, ev, siblings) => undefined},
    exports: {pendingChanges: (m) => m.pending},
    react(e, ctx) { /* 返回事件，或 {events, continue} */ },
    contribute: {/* 槽名: {volatile?, shared?, value} */},
    render: {notice: (e) => e.data.text},
    intercept: {/* input、model、tool、compaction */},
    timeoutMs: 30_000,
    onFailure: {tool: "deny"},
    preview: "run",
    dispose() { /* 摘下时释放内存缓存、订阅 */ },
});
```

除了 `id`，其余都可选。类型从定义里推断：`ctx.mine` 是自己各片的值，`e.data` 在 `is(e, K.user)`、`ctx.ev.notice.is(e)` 之后收窄，别的扩展的事件用它导出的守卫（`fileNotice.ev.fileChanged.is(e)`），`ctx.read` 的选择器名与返回类型来自声明合并（spike `typetest.ts` 八处、`v4/typetest.ts` 五处写错都是编译错误）。

`ctx` 给：`mine`、`ev`、`set`、`message`、`read`、`own`、`setting(key, 缺省)`、`tools`、`run`、`preview`、`signal`、`file(uri)`（t08）；主动接口 `complete`、`invokeTool`、`ask`、`compact` 实现时定（待定项 8）。不给：改工具绑定（t04 归用户）、改会话设置（t09 归用户）、定时器与界面。

生命周期：

```text
扩展：插件激活 → 声明登记 → [每个会话] 装配 → 换 Profile 或插件停用时摘下
会话：创建（session_created 带 initial）→ 打开（加载、校验、归约、recover）⇄ 空闲 / 运行中 / 等用户 → 关闭
运行：开始 → 轮 [输入 → 边界 → 请求 → 回复 → 工具 → …] → 提交 → 下一轮或结束；出错、中止都收口
一条事件：写进日志 → 全部扩展归约 → 全部扩展反应（追加的事件各自再走一遍，最多 3 层）
```

“会话已创建”“会话已打开”“运行开始”“一轮结束”“压缩完成”“运行结束”都是事件，扩展在 `react` 里按类型处理，不另设钩子点。

**换 Profile 或插件清单**（t04 方案 D）：只在空闲时、排进写入队列做；内核摘下旧扩展（调 `dispose`），换上新的，照日志从头重新归约（已提交的轮按新 Profile 的 `commit` 重新渲染，缓存失效一次）；写 `profile_changed`：新的清单、最终顺序与内容哈希（spike 场景 31）。旧扩展写的事件留在日志里，没有扩展认它们就不起作用；扩展改了事件含义就升版本。

插件经 `agent.extensions` 贡献点登记（取代 t10 的 `agent.hooks`）。Profile 用 `globalExtensions: {exclude: [标签]}` 或 `"none"` 排除全局扩展，用户在 Profile 设置里还能单独开关；单轮模板式的 Profile 应写 `"none"`（spike 场景 5）。

**内核与内置扩展**：

| 内核（不可替换） | 为什么固定 |
|---|---|
| 把事实写进日志，单写者与边界 | 崩溃恢复、界面显示、回退与审查都要求事实在发生时、按确定的顺序落盘 |
| 输入缓冲区与指令 | 什么时候取走缓冲区就是循环的边界，要和运行控制一起原子地做 |
| 循环、运行控制（t07）、事件派发顺序、拦截链的机制 | 所有扩展共同依赖的时序 |
| 审批在工具链最里层，只读模式 | 用户的安全决定，Profile 与插件都不能绕过（t06） |
| 校验最终请求：工具调用与结果成对、角色顺序、工具名合乎服务商规则 | Profile 的 `turn`、`commit` 可以写错，校验兜底，指出是哪一条（spike 场景 7） |
| 上限：反应链深度、“接着做”的连续次数、时限 | 防循环、防卡死 |

| 内置扩展 | 做什么 | 怎样定制 |
|---|---|---|
| `core.history` | 对话的形状（第 5 节），提交与压缩的归约 | Profile 的 `turn`、`commit`、`render` |
| `core.compaction` | 压缩的触发、方法的顺序与失败换下一个、压缩后的公共流程（t11） | 方法经 `agent.compactionMethods` 贡献，要求与顺序经 Profile 的 `compaction`，单次经压缩拦截 |
| `core.title` | 用小模型生成会话标题 | 用户设置里关掉 |

第三稿允许 Profile 整个替换 `core.history`（`replaces`）；有了 `turn` 与 `commit`，第三稿里替换它的两个用途（总结者只看最近几轮、单轮模板）都能不替换做到（`commit` 丢掉旧轮的工具记录，或 `turn` 排单轮的样子），第四稿去掉 `replaces`。

### 11. Profile 在其中

```ts
export const writer = defineProfile({
    id: "writer",
    name: "写手",
    settings: {defaults: {...}},                      // 缺省值与类型；表单归 t05
    system: "你是本书的写手，只改正文目录。",           // 不写 prompt 时进缺省布局
    tools: {required: ["read", "edit"], optional: ["grep"]},
    globalExtensions: {exclude: []},
    prompt: undefined,                                // 可选：模板，见第 6 节
    turn: undefined,                                  // 可选：一轮的样子
    commit: undefined,                                // 可选：一轮进历史的样子，缺省同 turn
    render: {},
    compaction: {require: "…", onThreshold: ["shake", "inplace"], onOverflow: ["shake", "summary"]},
    extensions: [opening({...}), writerCore],         // 自带的扩展，排在全局扩展之后，拦截链里在最里层
});
```

旧节点的去处：

| 旧节点 | 新设计 |
|---|---|
| `System`、`<Slot>`、固定消息 | `prompt` 里 |
| `History`、`History as="text"` | `<History />`；样子由 `turn`、`commit`、`render` 定 |
| 种子（`HistorySet`） | `opening({id, load})`：会话创建时与压缩之后读一次，存进一片 path 状态，交给稳定的槽 `opening`；会话创建时能读调用方给的 `initial` |
| `Appending` | 不需要：输入前后的持久消息是对用户的话的反应，成为这一轮的附带内容 |
| `Input` | `Turn.input`；结构化数据随 `payload` 来，单轮模板在 `turn` 里摆 |
| `Reminder`（when、every、watch） | `reminder({every, watch, render})`，写成附带内容 |
| `ModelContext`（不落盘、插在本轮之前） | 稳定的放系统提示词里的槽；每轮变的写成附带内容；每次请求都变的用会变的槽 |
| 有状态的节点 | 扩展的片 |

### 12. 一次运行的数据流

以写手的会话为例：用户说“续写第三章”，写手编辑一次，中途用户插了一句“别写打斗”。数据形状是示意。

1. **浏览器**：对话框发出 `agent.send({sessionId, input: {text: "续写第三章"}, mode: "followup", clientId})`（远程服务，ADR 0024，t10）。
2. **指令**：写 `input_queued`；会话空闲，开始运行：写 `run_started`、`input_consumed`、`turn_started`、`user（as: turn）`。
3. **反应**：`nbook.history` 写通知（有两个文件被改过），`nb-memory` 写检索结果；它们是这一轮的附带内容。
4. **边界**、**视图**：

   ```text
   system: 你是本书的写手……  [slot:sql-schema]
   …已提交的轮…
   user:   [通知：用户改过这些文件……] [<memory>林舟左手有旧伤</memory>] [续写第三章]
   ```

   写 `model_started`，经拦截链发给服务商；增量推给界面。
5. **回复**：写 `assistant`（调用 `edit`）；执行前写 `tool_started`，完成后写 `tool_result`。这时界面里用户插话，写 `input_queued（steer）`。
6. **边界**：取走插话，写 `user（as: steer）`，进这一步的 `after`。下一次请求：

   ```text
   …同上，前缀不变…
   assistant: (edit 第3章.md)
   tool:      已写入
   user:      [别写打斗]
   ```

7. **结束**：回复里没有工具调用，写手的扩展字数够了，不要求接着做；写 `turn_ended`，`core.history` 按 `commit` 提交这一轮（和最后一次请求里的样子相同）；缓冲区没有 followup，写 `run_ended`。下一次用户发言时，这一轮在 `<History />` 里，缓存命中。

### 13. 验证：改写旧应用的 `leader.default`

用旧应用的默认主创 Profile（`packages/neuro-book-legacy/assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`）检验本稿。旧版的 `context(ctx)` 每次渲染都读人设文件，返回 `System`（置顶、人设、三项设置、主提示词）、`HistorySet`（只在历史为空时写入的 14 条）、`ModelContext`（库结构摘要，每次请求插在本轮之前）、`AppendingSet`（七种提醒，每轮写进日志）；另有每 16 次调用跑一次 summarizer。

第四稿的改写在 `spike/v4/leader.default.tsx`（过 tsc；提示词正文省略），附了两个全局扩展：文件变更感知与工作区焦点（后者演示压缩时要做的事）。

| 旧机制 | 第四稿 | 变化 |
|---|---|---|
| 七种提醒写在 `AppendingSet` 里，每个 Profile 各列一遍 | 各归拥有那份数据的插件，作为全局扩展，写成这一轮的附带内容 | Profile 里这部分是零行；插件不改 Profile 就能给它加上下文 |
| 提醒排在用户的话后面（`AppendingSet` 在 `CurrentUserInput` 前，实际顺序由 `prompt-order.ts` 定） | 附带内容在前、用户的话在最后，由 `turn` 决定，提交后不变 | 位置能改，缓存不受影响 |
| `ModelContext` 每次请求插在本轮之前，下一轮挪位置，上一轮那段缓存失效（从 `prompt-order.ts` 推断） | `nbook.sql` 交稳定的槽 `sql-schema` | 每轮不再丢一段缓存 |
| `context()` 每次渲染读人设文件 | 人设是 session 的片，会话打开、设置变化、人设文件被改时读一次 | `prompt` 是纯函数 |
| `HistorySet` 只在历史为空时写 | `opening()` 在会话创建与压缩后读，交给稳定的槽 | 压缩后目录与参考文档还在 |
| “写作任务必须交给 writer”只写在提示词里 | 自带的工具拦截挡住 | 能挡住 |
| `ModeReminder` 专用的 `ModeSlot` | Profile 级 `render` 覆盖任何扩展事件 | 一种机制 |
| `runtimeDefaults.summarizer` 每 16 次 | `nb-memory` 扩展数“运行结束”，到 16 次启动 summarizer（后台运行等 t22） | 记忆归记忆插件 |
| 没有压缩的设置 | `compaction: {require, onThreshold, onOverflow}` | 主创能说压缩时要保住什么 |

例子里另有两个变体：`leaderMarkedSteer` 只改 `render` 把插话标成 `<user_interjection>`；`leaderLean` 写 `commit` 让历史只留每轮的最终回复。

结论：

- **能力**：旧版能做的都能做；多出来的是规则能挡住、插件能给不认识的 Profile 加上下文、附带内容的位置能定且不伤缓存、回退与压缩之后状态自动正确、Profile 能定一轮进历史的样子。
- **写法**：例子从设置到 Profile 定义约 110 个非空非注释行，含设置的类型与缺省值、三组设置文字、14 条种子与压缩要求（第三稿 spike 的主创约 60 行，没有写全这些）；七种提醒不再出现。
- **代价**：主创收到的完整上下文分散在多个插件里，要靠预览看全（每块标了来源）；人设改了，系统提示词跟着变，缓存失效一次。

### 14. 推迟的功能

第三稿为堵审查发现的漏洞加的几项，第四稿移出第一版，需要时再加：

| 功能 | 为什么推迟 | 没有它时怎么办 |
|---|---|---|
| `sample`（每次请求前向外部取数，按内容寻址存） | 只有“剩余额度”一个例子 | 外部数据由反应写成事件，或插件用 `external()` 写进来 |
| 预览过去的请求可复现（把视图输入记进 `model_started`，用当时的设置与 session 状态） | 调试功能 | `model_started` 照样记哈希、`now` 与修改记录；需要原样时打开请求录制（待定项 5） |
| 一般的缓存比对诊断与 `cacheCost` | 开发工具；第四稿的缓存稳定由结构保证，只保留第 6 节的两项检查 | 预览里看块的来源 |
| 工具的共享与独占并发 | 第一版工具串行 | 工具声明里先留 `concurrency` 字段（t04） |

spike 里这几项的场景（12、36、42、44、46、52）保留作参照。

### 15. 原型与审查

第二稿写成后做了一个 spike（`spike/`，连同场景检查约 3,100 行），两位审查者审了两轮：omp（gpt-6.1-sol，架构、不变量与性能）与 Claude Opus（以插件作者的身份照 API 写扩展与 Profile，API 形状与好用程度）。第一轮 omp 32 条（阻断 9、重要 21、建议 2）、Opus 17 条（重要 8、建议 9）；第二轮 omp 新 9 条（阻断 3）、Opus 新 12 条（阻断 1）；成立的都已改进 spike 与第三稿，证据在 t20 的 `evidences/`。spike 现在 53 个场景检查全部通过，`typetest.ts` 八处写错都是编译错误。

审查改出来的、第四稿照样保留的：事实先落盘（`model_started`、`tool_started`）与崩溃后结算；单写者与边界；中止接管卡住的扩展调用；多片状态、只读、普通数据、归约出错不挡日志；扩展事件带前缀与版本、未知来源写不了事件、幂等命中不再派发；加载校验与 `leaf_changed`；换 Profile 照内容哈希重新归约；“接着做”要显式、深度上限与 `reaction_limit`；块保留来源；`render` 只在 Profile 与扩展上；各入口出错隔离；扩展 id 的格式；`ctx.set` 值没变不写；空输入不写用户事件。

**性能**（spike 第三版，假模型，本机，`evidences/spike-r3.txt`）：1,200 轮（16,806 条日志、最后一次请求约 39 万 token）打开 70–240 ms，算一次请求 6–15 ms，长会话上每条新事件 18–25 ms，快照约 12 MB；多次测量波动大。第三版每次请求都要重新投影、渲染整段历史；第四稿已提交的轮只在提交时渲染一次，每次请求只渲染进行中的这一轮再拼接，预计算请求降到与这一轮的长度相关（推断，没有测）。拼接与哈希仍是 O(历史长度)，产品里用增量哈希；性能预算见待定项 14。

**参照实现的机制在本稿里的对应**：

| 参照机制 | 本稿 |
|---|---|
| omp `before_provider_request`（改原始请求体） | 不开放；改与服务商无关的 `ModelRequest` |
| omp `after_provider_response`、`assistant_message`（改写回复） | 模型拦截在 `next` 之后改回复；原文与改后都进日志 |
| omp 的 steer、followUp 队列 | 输入缓冲区的两种 `mode`（第 3 节） |
| omp、OMP 的自动重试 | 适配器内的重试算一次逻辑请求；扩展要重试就在模型拦截里调两次 `next` |
| Claude Code `PostToolBatch`、`PostToolUseFailure` | 对工具结果的反应；失败是 `isError` 的工具结果 |
| Claude Code `PreCompact`、`PostCompact` | 压缩拦截；对 `K.compaction` 的反应 |
| Claude Code `<system-reminder>` 附在用户消息里 | 附带内容由 `turn` 排进用户消息 |
| Google ADK 的处理器管线与稳定前缀 | 视图（`core.history`、`contribute`、模板）与 `<History />` 的提交 |
| LangGraph checkpoint、interrupt、resume | 由日志归约的快照（待定项 3）；审批与提问的等待事件（t06） |
| 流式输出的观察 | 不给扩展，只推界面（待定项 11） |

### 16. 接口形状（2026-10-29 修订，待开发者确认）

开发者要求优化接口形状与开发体验：去掉 `is(e, K.x) || is(e, K.y)` 这类写法、精简 `ctx`、不用 `t`、`m`、`e`、`ev` 这类极简变量、讨论让 `defineProfile` 自己能写扩展的字段。修订后的接口在 `spike/v4/api.ts`，主创例子 `spike/v4/leader.default.tsx`，过 tsc，`v4/typetest.ts` 十一处写错都是编译错误。正文里的事件名与写法仍是修订前的，以本节为准。

1. **按事件名挂处理函数**：`react` 改为 `on: {事件名: (event, ctx) => …}`；`reduce` 改为“片 → 事件名 → 新值”的表。没挂的事件，片保持原值。
2. **事件名统一驼峰**，日志里的类型名就是处理函数的键（`sessionCreated`、`toolResult`）；去掉 `K` 与 `is`。内核事件与自己的事件用短名，别的扩展的事件用全名（`"nbook.history/fileChanged"`）。别人要监听的事件先单独定义成常量，再经 `EventsOf` 登记进 `ExtensionEvents`（从扩展本身推导会让类型循环引用）。
3. **用户的话拆成两种事件**：开新一轮的 `input`、插话 `steer`，取代 `user{as}`。
4. **`ctx` 按入口分档**：`reduce` 没有 ctx（纯函数，参数是旧值、事件、自己的全部片）；视图（`contribute`、`prompt`、`turn`）拿 `state`、`settings`、`read`、`session`、`now`，全部只读；处理函数 `on` 另加 `emit`、`set`、`continue`、`resources`、`signal`；拦截另加 `resources`、`signal`，不写事件。`exports` 只拿自己的片。
5. **写事件改为直接调用**：`ctx.emit(名字, data)`、`ctx.set(片, 值)`、`ctx.continue()`，处理函数结束时一起写入，中途抛错就都不写；处理函数里读到的 `ctx.state` 始终是这条事件之后的值。
6. **去掉的**：`ctx.mine`（改名 `state`）、`ctx.ev`、`ctx.message`、`ctx.own`、`ctx.setting(key, 缺省)`（扩展声明 `settings: {defaults}`，`ctx.settings` 有类型）、`ctx.run`、`ctx.preview`、`ctx.tools`（并进 `ctx.session`）、`ctx.file`（改为 `ctx.resources.read`）。`ctx.read(id)` 返回那个扩展导出的对象，直接点属性。
7. **变量名用完整的词**：`event`、`turn`、`format`（`turn` 函数的渲染工具），归约函数的参数用片名；只留 `ctx` 一个缩写。
8. **Profile 自己就是最里层的扩展**：`defineProfile` 能写扩展的全部字段，id 就是 Profile 的 id；`extensions` 只放可复用的扩展。Profile 级覆盖别人事件文字的 `render` 暂名 `renderAll`（与扩展自己的 `render` 区分），名字待定。

## 影响

- **`nb-harness`**：会话模块的 `fold` 与投影沿用分支并扩展为片；Profile 宿主重写，旧的节点改由扩展接口与辅助函数实现；运行时的循环与输入缓冲区由内核自己写，不再用 OMP 的 `Agent`。t02 定的“代码以分支为主体”在运行时这一层改为按语义参照；会话格式、工具登记、模型目录与凭据、压缩方法、Profile 渲染仍以分支为主体。
- **日志格式**：新增内核事件（缓冲区四种、`turn_started`、`turn_ended`、`model_started`、`model_failed`、`tool_started`、`leaf_changed`、`profile_changed`、`reaction_limit`）、`user` 的 `as`、压缩的 `omitted`，以及带前缀、带版本的扩展事件；新应用尚未发布，旧格式由 t03 定的一次性迁移脚本处理。
- **`nbook.models`**：模型适配器按第 8 节的合同消费 `streamSimple` 的事件流。
- **nb-story**：问答 Profile 只用了组装节点，迁移量小；它依赖的单轮调用、`TurnResult`、收尾工具、`complete()` 在新循环里保留（t02）。
- **nb-agent-ui**：对话框按缓冲区显示排队中的输入（可改、可删，标 steer 或 followup）；显示每块的来源、被改写的原文与改后、修改记录、结构化诊断；“结果未知”的工具调用与中断的运行有专门的样子。
- **SDK 与插件作者**：`defineExtension`、`defineProfile`、`K`、`path`/`session`/`conv`/`ext`、`Turn` 与渲染工具、辅助函数进 SDK；文档写清归约的纪律、反应与视图的分工、附带内容与会变的槽怎么选、各入口读到的状态、事件版本。
- **安全**：扩展是受信任代码（ADR 0022），本稿不引入新的安全边界；请求可被任意修改，靠修改记录追查。

## 对 Spec 的预期改动

- `harness.session`：内核事件与数据、扩展事件的种类、前缀与版本、片与作用域、归约规则、导出选择器、只读、加载校验、叶子、恢复、快照、输入缓冲区。
- `harness.profile`：`defineProfile`、模板节点与文字拼法、`turn`、`commit`、Profile 级 `render`、缺省布局、压缩声明、辅助函数。
- `harness.runtime`：指令与校验、内核循环（运行、轮、步）、边界与单写者、取走缓冲区的规则、模型适配器合同、工具、拦截链、失败与中止、反应的快照语义与上限、修改记录、预览、压缩的触发与切点。
- 新的 `harness.extensions`：`defineExtension`、`ctx`、各入口读到的状态、生命周期、换 Profile、按标签排除。
- `agent.*`（Agent 插件）：`agent.extensions` 贡献点取代 `agent.hooks`。
- 验收场景以 spike 的 53 个场景为起点，补第四稿的缓冲区、对话形状、提交、压缩切点，换成真实运行时（真实日志存储、真实 OMP 适配器、进程重启）。

## 待定项

1. **名字**：叫“扩展”（`agent.extensions`、`defineExtension`），还是保留“钩子”。推荐“扩展”。
2. **Profile 在拦截链里的位置**：最里层（推荐：改请求时最后拍板）还是最外层。
3. **归约的快照**：持久化的快照推荐“压缩点加稀疏检查点”；检查点的间隔、淘汰与分支命中策略实现时定。
4. **上限**：反应链最多 3 层、“接着做”连续最多 3 次、扩展时限缺省 30 秒。
5. **请求录制**：缺省关、需要时在设置里打开（推荐）。
6. **`reminder()` 的缺省方式**：写成附带内容（推荐）。
7. **工具拦截里附加的说明**：写进日志（推荐：模型看到了就要能重放）。
8. **反应的主动接口**：`complete`、`invokeTool`、`ask`、`compact` 这类会产生新事件的主动动作怎样进日志（推荐：每个动作写一条带来源的控制事件，结果作为事件回来），实现时定。
9. **很大的值**：整章正文这类大块内容（附带内容、工具结果）是否另存到日志之外、日志里只记哈希。
10. **流式输出给不给扩展看**：推荐不给，增量只推给界面；以后真有需要再加一个只读的观察接口。
11. **模型适配器的审计粒度**：推荐一次逻辑请求一条 `model_started`，每次服务商尝试记进诊断。
12. **请求的完整形状**：图片与附件块、思考块、工具的参数 schema 与 `tool_choice`、服务商专有选项；推荐块加 `kind`，`tools` 用完整的工具声明，服务商专有的放适配器选项，实现 t04、t05 时定。
13. **性能预算**：长会话的目标（例如 10 万条事件打开在 1 秒内、算一次请求在 50 毫秒内）与做法（已提交的轮只渲染一次、增量哈希、稀疏检查点）。
14. **审计与脱敏**：推荐扩展可以把一次修改标为敏感，日志只记哈希。
15. **多 Agent**（t14）：子 Agent 是独立的会话；父会话里写 `child_started`、`child_result`、`child_failed`，审批冒泡与中止连带走父会话的运行控制。t14 讨论时定。
16. **steer 与 followup 的缺省**：运行中在对话框里回车是 followup（排队，推荐），另一个操作是插话；空闲时两者没有区别。
17. **多条 followup**：一条一轮（推荐：每条都是一个独立的要求）还是一次取走全部、合成一轮。
18. **压缩后放回的内容放哪**：写成 `conv` 事件跟在压缩发生的边界（推荐），还是作为摘要的一部分。
19. **会变的槽的缺省位置**：缺省布局放在末尾（推荐：缓存最好）；要“用户的话在最后”的 Profile 自己放到 `<Turn />` 前面，或把每轮一次就够的内容改成附带内容。

## 第三、四稿改变了已定写法的地方（待开发者确认）

第三稿（按审查意见改）：

- 扩展从单片状态改为多片，`pathState`、`sessionState` 改为片的构造函数 `path`、`session` 与 `ctx.set`。
- 扩展事件改由 `events` 声明，类型自动带扩展 id 前缀。
- `render` 从 `<History>` 节点上移到 Profile 与扩展上。
- “接着做”改为要显式写 `continue`。
- 相邻的 user 消息不再在内核里拼接，内容改为块。

第四稿（按开发者的状态机设计改，以下几处是我在落地时定的）：

- 中途的记录不放 session 作用域：它们是 path 上的事实，只写一次；`Message[]` 是归约结果，不另存，所以不会翻倍。理由：放 session 的话，回退到运行中途、从某条工具结果分叉、崩溃恢复时会读到另一条分支的记录。
- 按“每轮结束时提交”，不是按“运行结束时”：一次运行可能有几轮（followup）。
- 附带内容按写入位置归入这一轮，不按因果链；缺省排在用户的话前面。
- 模板节点改为 `<History>`、`<Turn>`、`<Slot>`；`<Input>` 成了 `Turn.input`。
- 去掉 `replaces: "core.history"`，用 `turn`、`commit` 代替。
- 第 14 节的四项推迟。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-28 | 开发者 | t20 讨论中同意：管线为骨、Profile 为主；Profile 的上下文管理里 `Appending`、`Reminder` 改用钩子做，Profile 的长处是集中与组装；`assemble` 改名 `prompt`；允许改写用户的话；主动接口收窄（不给改工具绑定、会话设置、原始请求体）；请求阶段拿到最终请求、想怎么改都行 |
| 2026-10-28 | 开发者 | 同意以“日志 → 归约 → 状态 → 视图 → 请求 → 副作用 → 日志”为骨架、扩展只做归约、反应、视图、拦截四件事的方向；要求单独写成提案再讨论 |
| 2026-10-29 | 开发者 | 同意：`reduce` 只看自己那一片；同一条事件的反应看同一份状态快照、追加的事件按扩展顺序写入；视图只在发请求与预览时算；扩展的片默认私有、经导出的选择器共享；`pathState()` 与 `scope: "session"`；扩展事件带版本 |
| 2026-10-29 | 开发者 | 同意：`prompt` 能读状态、按模型能力写条件、`<History render filter>`；视图加 `attach`、扩展给自己的事件提供缺省渲染、没留槽时丢弃并写诊断；预览也跑模型拦截链、最里层截下请求（其中 `attach` 被下面“日志记事实、历史是投影”一行取代，并进槽） |
| 2026-10-29 | 开发者 | 循环由内核自己写，不再套 OMP 的 `Agent`，与服务商通信只用 `streamSimple`；t02 的“代码以分支为主体”在运行时这一层改为按语义参照 |
| 2026-10-29 | 开发者 | 扩展交片段的字段改名 `contribute`，“视图”只指“状态 → 请求”这一步；Profile 的 `prompt` 改为可选，不写用缺省布局 |
| 2026-10-29 | 开发者 | 日志记事实、历史是投影：`core.history` 是内置扩展，Profile 可以替换；模板四个节点 `<History>`、`<Input>`（本轮的用户输入，整轮有值）、`<Transcript>`（本轮其余记录）、`<Slot>`；去掉 `tail`、`attach`，并进槽，扩展声明槽稳定还是会变；缓存由预览比对相邻两次请求检查，不靠结构禁止；事实写进日志的时间由内核定、不开放；内核只留写日志、循环与运行控制、审批与只读、请求校验、上限，其余做成内置扩展，只有 Profile 能替换（模板节点与“Profile 能替换”被第四稿改写，见上一节） |
| 2026-10-29 | 开发者 | 提出把 harness 看成一台异步状态机：用户输入先进缓冲区，“开始运行”的指令启动机器；运行中继续输入仍进缓冲区，在这里处理 steer 与 followup；有从缓冲区删除的指令，也有回退等指令；运行是可能有多轮的 ReAct，中途不断向外吐事件。状态参考 Elm、一切由扩展组成，`Message[]` 也是扩展；用户输入立刻进日志，但一轮结束才进 `Message[]`；扩展的存储都持久化，只有跟随日志（回退时跟着回退）与 session 两种作用域，没有临时的。要求据此写第四稿，并注意压缩时的处理 |
| 2026-10-29 | 开发者 | 指出本轮的用户输入在很多情况下要位于请求的最后，记忆检索这类附带内容不能只能排在它后面 |
| 2026-10-29 | 开发者 | 同意去掉 `prelude`：开场改为一片状态加一个稳定的槽，事件只有 `conv`、`ext` 两类 |
| 2026-10-29 | 开发者 | 要求优化接口形状与开发体验（第 16 节的方向）；派几个 Sonnet、一个 Fable、一个 omp 做接口设计并兼做架构审查，汇总成第五版再看 |
