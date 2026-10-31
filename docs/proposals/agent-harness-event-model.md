---
schema: nbook.proposal/v1
status: accepted
created: 2026-10-28
decided: 2026-10-31
supersedes: []
superseded-by: null
specs:
  - docs/specs/harness/session.md
  - docs/specs/harness/extensions.md
  - docs/specs/harness/runtime.md
  - docs/specs/harness/models.md
adrs:
  - docs/adr/0035-harness-log-driven-kernel.md
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
- Profile 与插件用同一套扩展接口，Profile 排在最后、地位最高；缺省的对话记录也是扩展，Profile 定它的样子。
- 所有会影响模型所见的状态都由日志归约而来，回退、fork、重启、压缩、预览自动正确。
- 请求在发出之前可以被任意修改，但谁改了什么查得到。
- 缓存稳定是结构上的结果：已经提交的轮不再变，进行中的这一轮只往后长。
- 写错的地方尽量是编译错误：事件名、数据形状、作用域、依赖、设置都有类型。

非目标：

- 工具发现与 CodeAct（[t21](../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/README.md)）、后台任务与协作（[t22](../../.agents/works/w00032-agent-integration/tasks/t22-background-work/README.md)）。
- 安全加固（t12：第一版的挡板是只读命令白名单与审批模型）。
- 用户级的 shell 命令钩子（类似 Claude Code 的 `hooks.json`），以后再做。
- 多进程扩展：扩展在服务端实例的进程内运行。

## 当前行为与证据

- **master 的 `nb-harness`**：Profile 用 `ProfilePrompt`、`System`、`HistorySet`、`<If tool>` 写成，每次请求前渲染一次；没有钩子（[`agent/harness.md`](../specs/agent/harness.md)）。
- **内核分支 `feat/w00002-harness-kernel`**（按 t02 的决定，代码以它为主体搬到 master）：Profile 宿主有 `Appending`、`Input`、`Reminder`、有状态的节点、种子、`<Slot>`；会话模块已经是事件溯源的一半（`fold(entries, defineProjection({initial, reduce}))`）；运行时有工具拦截器、宿主审批回调、运行时级订阅。
- **两条线的循环都套在 OMP 的 `Agent` 上**（`pi-agent-core`）。`Agent` 自己维护一份上下文，harness 经 `transformContext` 每次请求前按日志重新渲染；master 的模块头注释写了为此做的等待。
- **omp**（[外部参照](../research/agent-runtime-references.md)的“钩子”一节）：事件钩子 `pi.on(事件, 处理函数)`，能改写用户输入、替换本次请求的消息、改原始请求体、拦下或改写工具调用与结果、取消或接管压缩；运行中的输入分 steer 与 followUp 两种队列。
- **Claude Code**（官方文档）：33 种钩子事件，只返回声明式的结果；注入的上下文以 `<system-reminder>` 附在用户消息里。
- **同类思路**：Elm 架构（Model、Update、View、Cmd）；LangGraph 的按通道 reducer 与检查点；Google ADK 把发给模型的上下文定义为“建在有状态系统之上的编译出来的视图”，会话是带类型的事件日志、上下文由一串有名字的处理器每次重算，并分稳定前缀与变化的后缀（[Google Developers Blog](https://developers.googleblog.com/en/architecting-efficient-context-aware-multi-agent-framework-for-production/)）；VS Code 的 prompt-tsx 与 Cursor 的 Priompt 用带优先级与 token 预算的组件树写提示词。

## 方案

本节是第五稿。第四稿按开发者提出的“异步状态机”重组；第五稿汇总了五位设计者（三个 Claude Sonnet、一个 Claude Fable、一个 omp）各自从插件作者、Profile 作者、宿主与工具链、独立设计、架构与不变量五个视角做的接口设计与架构审查，取舍见第 20 节，报告在 t20 的 `evidences/api-design-*.txt`。

第五稿的接口原型在 `.agents/works/w00032-agent-integration/tasks/t20-hooks/spike/v5/`：`api.ts`（扩展与 Profile）、`host.ts`（宿主：指令、帧、预览、诊断、插件宿主）、`testing.ts`（测试工具），例子 `plugins.ts`、`profiles.tsx`、`tests.example.ts`，`typetest.ts` 里 29 处写错都是编译错误。实施计划（t20 `plan.md` 第二版）把它改成定稿类型，放在 `packages/nb-harness/src/kernel/api/`；第五稿到定稿改了什么见文末“第五稿到定稿的差异”，当前行为以 [`harness/session.md`](../specs/harness/session.md)、[`harness/extensions.md`](../specs/harness/extensions.md) 与随实施新建的 harness Spec 为准。

### 0. 第五稿改了什么

相对第四稿：

- **跨扩展引用用对象**：插件导出契约（`defineContract`），使用方写进 `dependsOn`，事件名与 `read` 的类型都从对象推出；去掉两张全局登记表。只能读、只能监听写进 `dependsOn` 的。
- **作用域进类型**：`slice.path`、`slice.session`；`reduce` 改为“事件名 → 同作用域片的补丁”，挂错作用域是编译错误；状态深只读。
- **外部事实经 `mount` 进来**：每个会话装上时调用，返回清理函数；去掉 `sessionOpened` 与 `dispose`。外部世界的事实放 session，“告诉过模型”放 path。
- **设置、`initial`、`payload` 用 TypeBox schema 声明**。
- **`render` 只剩一个**，去掉 `renderAll`；**`continue`** 只在 `assistant` 的处理函数里有，带文字与上限，按这一轮数次数。
- **便利写法做成 helper，不做成字段**（第 4 节“核心字段与 helper”）：`reminder()`、`opening()`、`standardLayout()`、`finalOnly()`、`withoutEvents()`、`format.withRender()`、`deriveProfile()`。
- **Profile**：管提示词的字段只有 `system` 与 `prompt`（不写就是 `standardLayout()`）；`initial`、`payload`、`description` 字段。
- **内核**：写入批（几条事件原子写入）；`conv` 事件的位置由内核盖章；边界的顺序写死；提交绑定 Profile 内容哈希；压缩切点是半开区间、`omitted` 带占位、放回的内容与压缩同批；等用户的事件占位。
- **日志字段机器可读**：`toolResult.status` 与 `details`、`assistant.request` 与内容块（含思考与签名）、拒绝原因是码、块的来源结构化、模型请求带用途。
- **宿主**：每个指令带 `commandId`（幂等）、按指令分的失败码；向外吐的帧；预览报告保真度；改变了结果的扩展失败写进日志；测试工具。

### 1. 一台异步状态机

```text
            指令（入队、改、删、开始、中止、回退、压缩、换设置……），每个带 commandId
                │ 内核校验：不合法的返回失败码，不写日志
                ▼
日志（事件） ──归约──▶ 状态 ──视图──▶ 请求 ──调用──▶ 响应 ──追加──▶ 日志
                ▲                                         │
                └────────────── 反应：新的事件 ◀────────────┘
                │
                ▼
            向外吐：写进日志的事件；另有不进日志的流式增量与运行状态，只给界面
```

- **状态**全部由日志归约：各扩展的片、内核的缓冲区、运行到哪了。没有临时状态，也没有另存的状态文件。
- **指令**相当于 Elm 的 Msg、CQRS 的 command：内核校验之后写成事件，事件才是事实。
- **运行**是 ReAct 循环，可能有好几轮：一轮从一条输入开始，结束时缓冲区里有 followup，同一次运行接着开下一轮。
- **向外吐**的东西：写进日志的事件（界面、订阅者、审计都看它），以及模型正在吐的字与运行状态（不进日志，不算状态）。

循环由内核自己写，不再套 OMP 的 `Agent`；与服务商通信只用 OMP 的 `streamSimple`，由 `nbook.models` 的模型适配器调用（t09，第 9 节）。理由：本稿要求“一条事件的反应全部完成后才算下一次请求”“模型调用可以重试与换模型”“日志是唯一的上下文”，`Agent` 自己的上下文与异步投递的事件和这几条都要对着干。

一次运行：

```text
开始：写 runStarted；从缓冲区取走第一条输入，同一个写入批里写 inputConsumed、turnStarted、input
  └─ 全部扩展归约、反应（记忆检索、文件通知……成为这一轮的附带内容）
边界（每次模型请求之前，按这个顺序）：
  1. 运行中到达的外部事实、设置变化，按到达顺序写入
  2. 缓冲区里的 steer 全部取走，按入队顺序写 steer（各自与 inputConsumed 同批）
  3. 估算请求大小，超过阈值先压缩（第 10 节）
  4. 视图算出请求，经模型拦截链；最里层先写 modelStarted，再发给服务商
回复：写 assistant，归约、反应
  有工具调用：执行前写 toolStarted；按调用顺序执行，结果作为一个写入批写入，整批写完再派发反应；回到边界
  没有工具调用：turnEnded 写入之前到达的 steer、或扩展调用了 continue，回到边界
              否则写 turnEnded，core.history 提交这一轮
                缓冲区有 followup：取走一条，开新的一轮
                没有：写 runEnded
```

任何一步出错、被中止，都写 `turnEnded`、`runEnded`（`error`、`aborted`）收口；进程崩溃留下的半截运行，重新打开时由 `recover()` 结算（第 2 节）。

### 2. 日志、作用域与写入批

日志只追加（t03），已经写下的条目谁都不能改。日志记的是事实，模型看到什么由投影决定。

**两种作用域**：path 事件挂在会话树的当前路径上，回退之后不在路径上的就不算；session 事件在树外，回退不影响。**外部世界的事实放 session**（文件被改、库结构变了：回退对话不会让文件变回去），“告诉过模型什么”放 path（回退到通知之前，改动自动回到未送达）。插件作者用第三稿内核做的实验证实了反过来写的后果：`fileChanged` 放 path 时，回退到它之前，“文件被改过”就从路径上消失，模型不再被告知（`evidences/api-design-sonnet-plugin.txt` 的 A2）。

**事件的种类**：扩展只能声明两种，`conv`（进当前这一轮，永远在 path）与 `ext`（不变成消息，只给扩展归约；`ext.session` 在树外）。内核事件另有 `ctrl` 一类，不变成消息。

**内核事件**（驼峰，日志里的类型名就是处理函数的键）：

| 作用域 | 事件 |
|---|---|
| session | `inputQueued`、`inputEdited`、`inputRemoved`、`inputConsumed`、`settingsChanged`、`leafChanged`、`profileChanged`、`commandAccepted`、`approvalRemembered`、`titleChanged`、`archived` |
| path | `sessionCreated`、`runStarted`、`runEnded`、`turnStarted`、`turnEnded`、`input`、`steer`、`assistant`、`continued`、`toolStarted`、`toolResult`、`toolsAnnounced`、`modelStarted`、`modelEnded`、`modelFailed`、`interactionRequested`、`interactionResolved`、`compaction`、`extensionFailed`、`reactionLimit` |

其中 `input`、`steer`、`assistant`、`continued`、`toolResult` 是对话事件，进这一轮。`ctx.set` 写的 `<扩展 id>/stateSet` 由内核自己归约，不派发给处理函数。

**扩展事件**的类型自动带扩展 id 前缀（`nbook.history/fileChanged`），带版本。内核拒绝扩展写不以自己 id 开头的类型，未知来源一律拒绝。事件带 `cause` 与 `depth`；可以带幂等键 `key`（`ctx.emit(名字, 数据, {key})`，宿主指令的 `commandId`），同一来源同一个键只写一次，命中时反应也不再跑。

**写入批**：几条事件作为一个整体写入，要么都可见、要么都不可见。日志是 JSONL，每行带 `batch: {id, n, of}`，一批一次写入后同步到盘；文件里完整的批就是已提交的批，只有文件尾可能不完整，重开时截掉。写或同步失败对调用方是“结果不确定”：句柄进损坏状态、进程内不重试，重开时以文件为准。下面这些各是一个写入批：

- 取走一条输入：`inputConsumed` 加 `turnStarted`、`input`（或加 `steer`）；分开写的话，崩溃窗口会让缓冲区删掉而对话里没有这句话（omp 审查的阻断项）。
- 一次工具调用的结果：同一个回复里的全部 `toolResult`。
- 一个扩展对一条事件的输出：它 `emit` 与 `set` 的全部。
- 一次压缩：`compaction` 加它放回的内容。

**位置章**：每条 `conv` 事件写入时，内核盖上它在对话里的位置：某一轮的附带内容、某一步之后、或“等下一轮”（空闲时写的）。投影照章归入，不靠推断；恢复与压缩时写的事件也有明确的位置。

**什么时候写进日志**（由内核写，时间不开放）：

| 东西 | 写入时刻 | 作用域 |
|---|---|---|
| 缓冲区的入队、改、删 | 指令受理时 | session |
| 用户的话 | 入队、改时经输入拦截链，`inputQueued`、`inputEdited` 存拦截后的文字，改写过的原文记在 `original`（标了 `redacted` 时只记哈希）；从缓冲区取走时与 `inputConsumed` 同批写 `input` 或 `steer`，只引用缓冲区的 id | session、path |
| 模型请求 | 发出之前写 `modelStarted`：序号、用途、哈希、`now`、调用 id、修改记录；失败写 `modelFailed`；非对话的请求（审批、压缩、后台）成功时写 `modelEnded` | path |
| 助手回复 | 流结束时写完整回复：内容块（文字、思考与签名）、工具调用、用量、请求序号 | path |
| 工具 | 执行之前写 `toolStarted`（带参数与调用 id）；完成后整批写结果：状态、给模型的文字、给程序的 `details`，拦截改过参数时记实际执行的 `args`，改过结果时记原本的 `raw`（`redacted` 时只记哈希） | path |
| 反应的输出 | 处理函数完成时，作为一个写入批 | 按声明 |
| 外部事实（`mount` 里写的）、设置变化 | 空闲时立刻；运行中到下一个边界 | 按声明、session |
| 回退、切分支 | 指令受理时写 `leafChanged` | session |
| 指令受理 | 与它立即写的事件同批写 `commandAccepted`（幂等的依据） | session |
| 超过 16 KB 的字符串 | 写入批之前另存为会话目录里按内容寻址的文件，事件里只记哈希与长度 | — |
| 槽的内容 | 从不写 | — |
| 流式输出的增量、运行状态 | 从不写；只推给界面 | — |

**单写者**：一个会话的写入只有一个顺序。所有写入口排进同一条队列，队列的一项是“一个写入批连同它引出的反应”；运行循环在队列之外，每次写日志时把写入交给队列并等它完成，所以运行中的插话、改、删、应答、中止不必等运行结束（spike 场景 48）。打开会话时在会话目录取锁，同一会话同时只能被一个进程打开一次。

**打开与恢复**：`load()` 先校验日志（id 唯一、seq 递增、父节点在前、类别与作用域合法、类型要么是内核事件要么带扩展前缀、幂等键不重复、写入批完整），校验不过就拒绝打开、报损坏；再照日志归约，不跑反应；当前叶子取最后一个“path 事件或 `leafChanged`”指向的节点。不完整的写入批丢弃。`recover()` 处理崩溃或停服留下的半截运行：开始执行但没有结果的工具调用写成 `status: "unknown"`，等审批的调用结算为拒绝（码 `interrupted-before-approval`，它还没执行），让运行停下的提问结算为 `interrupted`（重开后由界面提示重新问），发出但没有回复的模型请求写 `modelFailed`，最后写 `turnEnded`、`runEnded`（`interrupted`）。缓冲区里没取走的输入留着；异步提问不属于运行，不结算。

### 3. 输入缓冲区与指令

用户提交的话先进缓冲区，取走时才成为对话里的事实。缓冲区是内核的状态，在 session 作用域：回退对话时，提交了还没取走的话不会丢。

指令的完整形状在 `v5/host.ts`。每个指令带 `commandId`（客户端生成，重发同一个）：远程服务的写请求在帧发出后链路断了会得到“结果未知”（ADR 0024），界面必然重发；被受理的指令在受理批里写一条 `commandAccepted{commandId, name, value}`，重发查它、得到第一次的结果（`replayed: true`），重启之后照样有效。`value` 引用的 id 都在同一批写出：空闲时会开始运行的指令，受理批就包含 `runStarted`。失败是按指令分的封闭码表（`commandErrors`），也是远程方法 `errors` 的来源；界面按码分支，不解析文字（ADR 0034）。

| 指令 | 什么时候能用 | 写什么 | 失败码（节选） |
|---|---|---|---|
| `send(input, mode?)` | 随时：入队，空闲时同时开始（对话框的发送按钮）；`mode` 缺省 `followup` | `inputQueued` 起 | `empty-input`、`input-rejected`、`no-model`、`no-credentials`、`profile-invalid` |
| `enqueue(input, mode)` | 随时，只入队 | `inputQueued` | `empty-input`、`input-rejected` |
| `edit(id, input)`、`remove(id)` | 取走之前 | `inputEdited`、`inputRemoved` | `input-not-found`、`input-consumed` |
| `resolve({id, decision, answer?})` | 有待处理的审批或提问时 | `interactionResolved` | `unknown-interaction`、`already-answered`、`not-allowed` |
| `start()` | 空闲时；缓冲区空时是没有新输入的“继续”运行 | `runStarted` | `already-running` |
| `abort()` | 随时；幂等，没有运行时返回 `aborted: false` | 收口，`runEnded(aborted)` | — |
| `rewind(to, {resend?})` | 空闲时；目标只能是轮或步的边界（`rewindTargets()`，与压缩切点同一条规则）；运行中先 `abort` | `leafChanged` | `running`、`invalid-target` |
| `switchBranch(node)`、`fork(leaf)` | 空闲时；切到那条分支最近写入的末端；复制当前路径成新会话 | `leafChanged`；新会话 | `running`、`invalid-target` |
| `setTitle(title)`、`archive(archived)` | 随时 | `titleChanged`、`archived` | — |
| `compact(要求?)` | 随时：空闲时开一次只压缩的运行，运行中到下一个边界 | `compaction` | `nothing-to-compact` |
| `changeSettings(patch)` | 随时，按扩展 id 分组、整体校验；运行中到下一个边界 | `settingsChanged`（每个扩展一条） | `unknown-key`、`invalid-value` |
| `changeProfile(profile)` | 空闲时 | `profileChanged` | `running`、`unknown-profile` |

运行前就能判定的失败（没有模型、没有凭据、Profile 不合法）是指令失败、不写日志；运行到服务商才发现的鉴权失败是日志里的 `modelFailed{kind: "auth"}`。外部事实不是界面的指令，由扩展在 `mount` 里写（第 4 节）。

**取走的规则**：

- 开始运行时取走第一条，开一轮；它之后入队的 `steer` 在第一个边界取走，成为这一轮的附带内容。
- 运行中：`steer` 在每个边界全部取走，按入队顺序写成 `steer` 事件，进当前这一轮；`turnEnded` 写入之前到达的 `steer` 都算这一轮，模型给出最终回复时还有没取走的，这一轮接着请求。
- 一轮结束时：`followup` 取走一条，同一次运行里开下一轮（一条一轮，待定项 17）。
- 输入拦截链在受理时（入队、改）就跑，取走时不再拦截；被拒绝时指令失败 `input-rejected{code, params, by}`、不写日志，拒绝署名进诊断。

### 4. 扩展的形状

```ts
// 契约：放在插件不拖实现的 shared 模块里，别人 import 它写进 dependsOn
export const historyContract = defineContract("nbook.history", {
    events: {fileChanged: ext.session<{uri: string; by: string}>(), notice: conv<{text: string; through: number}>()},
    exports: shape<{pendingChanges: string[]}>(),
});

// 实现契约的扩展：id 与事件从契约来；服务经工厂函数的闭包进来
export const fileNotice = (watcher: FileWatcher) =>
    implement(historyContract, {
        tags: ["history"],
        settings: Type.Object({mode: Type.Union([Type.Literal("off"), Type.Literal("minimal"), Type.Literal("full")], {default: "full", title: "文件变更提醒"})}),
        state: {changes: slice.session<Change[]>([]), deliveredThrough: slice.path(0)},
        reduce: {
            fileChanged: (event, state) => ({changes: [...state.changes, {uri: event.data.uri, seq: event.seq}].slice(-200)}),
            notice: (event) => ({deliveredThrough: event.data.through}),
        },
        exports: {pendingChanges: (state) => [...new Set(pendingOf(state).map((change) => change.uri))]},
        mount: (ctx) => watcher.onChange(ctx.callback((change) => ctx.emit("fileChanged", change))),
        on: {
            turnStarted(_event, ctx) {
                const pending = pendingOf(ctx.state);
                if (pending.length === 0 || ctx.settings.mode === "off") return;
                ctx.emit("notice", {text: `用户改过这些文件：${list(pending)}。续写前先重读。`, through: pending.at(-1)!.seq});
            },
        },
    });
```

字段一览（除了 `id` 都可选；有契约时用 `implement(契约, …)`，id、事件与导出的形状从契约来）：

| 字段 | 回答的问题 | 要点 |
|---|---|---|
| `id`、`tags`、`dependsOn` | 我是谁、Profile 怎样成批排除我、我依赖谁 | `dependsOn` 写契约或扩展对象：决定装配顺序、能监听谁的事件、能 `read` 谁；可能没装的写 `optional(契约)` |
| `settings` | 用户能配什么 | TypeBox schema，缺省值写在 schema 里（每项都要有，装配时检查）；插件的设置有全局缺省，用户可以按 Profile 覆盖 |
| `state` | 我要记住什么 | `slice.path(初值, {resetOnCompaction?})`、`slice.session(初值)` |
| `events` | 我会往日志里写哪几种东西 | `conv<D>()`、`ext<D>()`、`ext.session<D>()`；不许与内核事件同名 |
| `reduce` | 看到一条事件，我记的东西变成什么 | 第 5 节 |
| `on` | 发生了某件事之后，我要补记什么 | 第 6 节 |
| `mount` | 外部世界怎样进来 | 第 6 节 |
| `exports` | 别人能问我什么 | `(state, settings) => 值`，只取决于自己 |
| `contribute` | 这一刻，我的状态给模型看是什么样 | 第 8 节 |
| `render` | 我写的对话事件给模型看是什么文字 | 只能写自己的 `conv` 事件；没写的：`{text}` 取 `text`，其余包成 `<system-reminder>` |
| `intercept` | 某个动作执行之前或之后，要不要改它、挡下它 | 第 9 节 |
| `onFailure`、`timeoutMs` | 出错与超时 | 工具拦截出错缺省拒绝这次调用；处理函数缺省 30 秒 |

**跨扩展引用**：监听依赖的事件写全名（`"nbook.history/fileChanged"`），读依赖的导出写 `ctx.read(historyContract).pendingChanges`，类型都从 `dependsOn` 里的对象推出。没写进 `dependsOn` 的读不了、监听不了（编译错误）；`optional` 的依赖 `read` 返回 `undefined`。内置的 `coreHistory` 不写进 `dependsOn` 也能读（本轮输入、进行中的这一轮、单调增加的 `turns` 与 `runs` 计数）。契约放在不拖实现的模块里，所以带服务的工厂扩展（`memory(search)`）的使用方只 import 契约。

**核心字段与 helper**：扩展只有 10 个核心字段（`id`、`dependsOn`、`settings`、`state`、`events`、`reduce`、`on`、`mount`、`contribute`、`intercept`），加上 `render`、`exports`、`tags`。常见写法不做成字段，做成 helper：

| helper | 返回 | 展开成什么 |
|---|---|---|
| `reminder({id, dependsOn?, every?, watch?, text})` | 一个扩展 | 一片记“告诉过的值与轮数”的 path 片（压缩时清空）、一个 `conv` 事件 `reminder`、`turnStarted` 上的处理函数 |
| `opening({id, initial?, dependsOn?, load})` | 一个扩展 | 一片 path 片存开场，`sessionCreated` 与 `compaction` 上读一次，交给共用的稳定槽 `opening` |
| `standardLayout({volatile?, history?})` | 模板函数，给 `prompt` | 缺省布局（第 8 节） |
| `finalOnly(turn)`、`withoutEvents(turn, 依赖, 事件名…)` | 改写过的一轮，给 `commit` | 去掉工具记录与中间的步；去掉某个依赖的几种对话事件（名字有类型） |
| `format.withRender({…})` | 换了文字覆盖的渲染工具，给 `commit` | 只在进历史时换文字 |
| `deriveProfile(base, patch)` | 一个 Profile | 第 13 节 |

判断：能独立成一个扩展、或能写成一个纯函数的做成 helper；要和这个扩展自己的状态、设置、类型紧密结合的，或是内核语义的，才留字段。helper 只用公开接口写成，行为与手写版本一致，内核不为它们开特例。代价是返回扩展的 helper 要多起一个 id，跨扩展读要写 `dependsOn`。

**装配**：扩展 id 全局唯一，Profile 的 id 也算在内；同一个扩展装两次、依赖缺失或成环在装配时拒绝并列出来源。插件经 `agent.extensions` 贡献点登记（取代 t10 的 `agent.hooks`）；扩展 id 与插件 id 的关系见待定项 20。

### 5. 状态与归约

为什么用“日志加 reduce”：扩展的状态必须跟着对话路径走（回退到第 3 次发言，计数也回到 3），重启后要恢复，预览与运行要看到同一份，压缩之后不能丢。存在内存里，回退与重启都不对；另存状态文件，要给树上每个节点存一份才回得去。由日志归约，只有一个真相源。

```ts
reduce: {
    // 事件名 → 同作用域片的补丁；返回 undefined 表示不变
    fileChanged: (event, state) => ({changes: [...state.changes, {uri: event.data.uri, seq: event.seq}]}),
    notice: (event) => ({deliveredThrough: event.data.through}),
}
```

- **按事件名写**：与 `on` 同一个形状（键是事件名，事件在前）；一条事件改几片只写一个函数；不看旧值的归约直接写 `(event) => …`。
- **作用域进类型**：path 事件的归约只拿到、只能改 path 的片，session 事件同理；挂错是编译错误。理由：session 的片若归约 path 事件，回退后再走一遍就会重复计数；path 的片若依赖 session 的值，回退时会用到“现在”的值。要从 path 事件得到一个不随回退变的值，在处理函数里 `ctx.set` 写进 session 的片。
- **归约只看自己**：看不到别的扩展；各扩展的归约互不依赖，谁先谁后结果都一样。
- **归约出错不挡日志**：叶子照样前进，这个扩展这次的补丁不用，写诊断；重放时结果相同（spike 场景 41）。
- **`resetOnCompaction`**：压缩时这片回到初值，用于“告诉过模型什么”（压缩后摘要未必还记得）。
- **深只读、普通数据**：状态的类型递归只读，开发模式下冻结（spike 场景 30、53）。
- **能算出来的不存，不确定的才写成事件**：模型输出、工具结果、外部取来的数据、压缩摘要是事件；`Message[]`、计数、清单都是归约结果。存储层可以隔一段存一个状态快照让打开更快，快照是缓存（待定项 3）。

### 6. 处理函数、装上与提醒

**`on`**：事件写入并归约之后调用，可以做 I/O；重放时不调用。

```ts
on: {
    async input(event, ctx) {                          // 要读输入文字的挂 input
        const hits = await search(event.data.text, {limit: 3, signal: ctx.signal});
        if (hits.length > 0) ctx.emit("retrieved", {hits});
    },
    turnStarted(_event, ctx) { … },                    // 每轮一次的提醒挂 turnStarted：没有新输入的“继续”运行也收得到
    "nbook.history/fileChanged"(event, ctx) { … },     // 依赖的事件写全名
    assistant(event, ctx) {                            // 只有这里有 continue
        if (event.data.toolCalls.length === 0 && ctx.state.words < 3000) ctx.continue("请接着写。", {max: 3});
    },
}
```

**`ctx` 按入口分档**，越往后能力越多，越界是编译错误：

| 入口 | 拿到什么 |
|---|---|
| `reduce` | 没有 ctx：`(event, 同作用域的片)` |
| 视图：`contribute`、`prompt`、`system`、`turn`、`commit` | `state`、`settings`、`read`、`tools`（带 `effect`）、`model`、`now`、`initial`，全部只读 |
| 处理函数 `on` | 视图那些，加 `emit`、`set`、`resources`（`read`、`resolve`）、`signal`；`assistant` 的处理函数另有 `continue` |
| 装上 `mount` | `state`、`settings`、`read`、`tools`、`model`、`emit`、`set`、`resources`、`signal`、`callback` |
| 拦截 `intercept` | 视图那些，加 `resources`、`signal`、`phase`（`run` 或 `preview`）、`invocation`；不写事件 |

**`emit` 与 `set` 的语义**：先收集，处理函数的 Promise 完成时作为一个写入批写入；抛错或超时就都不写，写 `extensionFailed`（带丢弃了几条 emit、几条 set）；完成之后再调用（例如漏了 `await` 的回调里）是 `emit-after-settle` 错误，不写；同一片 `set` 多次取最后一次；值没变不写。处理函数里读到的 `ctx.state` 始终是这条事件之后的值，不含自己这次 `set` 的。同一条事件的各个处理函数看同一份状态，可以并发执行，输出按扩展顺序写入（spike 场景 3）；全部完成后才算下一次请求。

**`continue(text, {max})`**：写一条 `continued` 对话事件并再请求一次；内核按“这一轮、这个扩展”数次数，超过 `max`（缺省 3）返回 `false`、不写。第三稿内核的计数在每次工具批之后清零，写手“接着写、调一次 edit、再接着写”的循环永远碰不到上限（Profile 作者审查第 4 节第 2 条），所以改成按轮数。

**深度上限**：根事件是第 0 层，最多写到第 3 层；超出时留一条 `reactionLimit`（spike 场景 26）。

**`mount(ctx)`**：会话打开、换 Profile 之后新装上时调用，内核等它完成才受理指令；返回清理函数，摘下时调用，`ctx.signal` 同时触发。外部事实从这里进来：订阅文件监听、库结构变化，用 `ctx.emit` 写自己声明的事件，写入排进单写者队列，运行中到下一个边界。`ctx.callback(fn)` 包住外部回调：出错带扩展 id 写诊断，不成为没人接的 Promise 拒绝，摘下之后不再调用。打开时读一次外部数据（人设文件）也写在这里，换 Profile 之后照样会读，第四稿靠 `sessionOpened` 时换 Profile 后不会初始化的问题随之消失。

**提醒用 `reminder()`**：隔几轮、或某个值变了的那一轮，在这一轮开头写一条附带内容。它返回一个独立的扩展，要读别的扩展的值就写 `dependsOn` 再 `read`：

```ts
export const modeReminder = reminder({
    id: "nbook.agent.mode.reminder",
    dependsOn: [modeContract],
    watch: ({read}) => read(modeContract).mode,
    text: ({value, first}) => (value === "plan" ? "现在是计划模式……" : first ? null : "已退出计划模式。"),
});
export const tasksReminder = reminder({id: "nbook.tasks.reminder", dependsOn: [tasksContract], every: 8, text: ({view}) => …});
// 插件贡献 [mode, modeReminder]；Profile 想换措辞：dependsOn: [modeReminder]，render 写 "nbook.agent.mode.reminder/reminder"
```

“告诉过模型什么”记在它自己的 path 片里，压缩时清空，回退跟着回去。模式、工作区焦点、任务提醒都是这个形状，手写要写片、事件、归约与处理函数，最容易漏的是压缩时清空。

### 7. 对话的形状：已提交的轮、进行中的这一轮

对话记录由内置扩展 `core.history` 从日志归约而来：

```ts
interface ConversationTurn<P> {
    id: string;
    input: LogEvent<"input", {text: string; payload: P}> | null;   // 没有新输入的“继续”运行为 null
    attachments: LogEvent[];     // 输入之后、第一次模型调用之前写入的对话事件
    steps: Step[];               // {reply, results, after}
    status: "running" | "completed" | "error" | "interrupted" | "aborted";
}
```

- **每条事件去哪**：按内核盖的位置章（第 2 节）。附带内容、某一步之后的事件、空闲时写的（下一轮开始时并进它的附带内容）。日志里检索结果在用户的话之后写（事实就是这个顺序），但在对话的形状里它是这一轮的附带内容，摆在哪由 Profile 的 `turn` 决定。
- **提交**：`turnEnded` 时，用 Profile 的 `commit`（缺省与 `turn` 相同）把这一轮渲染成消息，并进已提交的轮。`commit` 只拿这一轮与渲染工具 `(turn, format) => 消息[]`，是纯函数：重开或回退时用它重算，结果确定；`turn` 仍能读视图。提交时就校验（工具调用与结果成对、角色顺序），不合格用缺省的提交并写诊断，不让一个写错的 `commit` 让会话之后每次请求都失败。
- **提交绑定 Profile 内容哈希**：同一个 Profile 版本下，已提交的消息不再变，下一次请求原样拼接。`profileChanged` 之后按新 Profile 重新渲染全部已提交的轮（缓存整段失效一次；换 Profile 时系统提示词本来也变了）。
- 导出（`coreHistory`）：本轮输入、进行中的这一轮、单调增加的 `turns` 与 `runs`（不受压缩影响）。

### 8. 视图：请求怎样算出来

“视图”指整个“状态 → 请求”这一步，只在要发请求和预览时算。

**请求的形状**与服务商无关：

```ts
interface ModelRequest {
    purpose: "turn" | "approval" | "compaction" | "background";
    model: string;
    effort?: string;
    params: {maxTokens?: number; temperature?: number};
    headers: Record<string, string>;
    system: Block[];
    messages: {role: "user" | "assistant" | "tool"; content: Block[]; toolCalls?: ToolCall[]; callId?: string}[];
    tools: ToolDeclaration[];                 // 完整工具声明
    toolChoice?: "auto" | "none" | {tool: string};
    providerOptions?: Record<string, unknown>; // 适配器专用、原样透传
}
// 内容块：文字；思考（带签名与服务商要求带回的元数据）；图片（一律是大块内容）。请求里的块另带 origin
type Block = ({kind: "text"; text: string} | {kind: "thinking"; text: string; signature?: string; redacted?: boolean; provider?: unknown} | {kind: "image"; blob: string; mime: string}) & {origin: Origin};
type Origin = {kind: "fixed"; by} | {kind: "event"; eventId; type; extension} | {kind: "slot"; name; extension} | {kind: "summary"; compactionId} | {kind: "intercept"; extension};
```

块保留结构化的来源：预览、修改记录、诊断与测试都按它定位，不解析字符串；相邻的 user 消息不在内核里拼接（服务商要求时由适配器合成一条多块消息）。

**Profile 写提示词**：`system` 是系统提示词的内容（文字、TSX 或按视图算的函数）；`prompt` 是整张模板，不写就是 `standardLayout()`：

```tsx
<System>{system}<Slot name="*" stable /></System>
<User><Slot name="opening" /></User>      // 没有扩展交开场时什么也不渲染
<History />                               // history：true、false 或 {last: n}
<Turn />
<Slot name="*" volatile />                // volatile："end"（缺省）或 "before-turn"（移到 <Turn /> 前）
```

常见的变化用选项：`prompt: standardLayout({volatile: "before-turn"})`（用户的话在最后）、`standardLayout({history: false})`（单轮模板）、`standardLayout({history: {last: 2}})`（只看最近两轮）。特殊布局（例如在历史前插一组示例对话）自己写模板：节点 `<System>`、`<User>`、`<Assistant>`、`<P>`、`<Tag>`、`<If tool>`、`<History last?>`、`<Turn />`、`<Slot>`；自闭合的 `<System />` 放 `system` 的内容，系统提示词只写一处。容器里每个子节点一段，段与段空一行；行内 `<P>`、`<Tag>` 里直接相连。`<Turn />` 必须恰好一个。

**`turn`**：一轮给模型看的样子，纯函数 `(turn, format, view) => 消息[]`。不写用 `format.turn(turn)`：附带内容在前、用户的话在最后，合成一条 user 消息；然后是各步。单轮模板在这里摆：行内编辑把选区（`turn.input.data.payload.selection`，类型来自 Profile 的 `payload` schema）与要求排进同一条消息，不写模板。

**`commit`**：一轮以什么样子进历史，纯函数 `(turn, format) => 消息[]`，不读视图；不写与 `turn` 相同（缓存最好）。常见需求用 helper，各一行：

```ts
commit: (turn, format) => format.turn(finalOnly(turn)),                                   // 只留最终回复（不会留下没有结果的工具调用）
commit: (turn, format) => format.turn(withoutEvents(turn, memory, "retrieved")),          // 提交时丢掉记忆结果；名字有类型
commit: (turn, format) => format.withRender({toolResult: (event) => firstLine(event.data.text)}).turn(turn),   // 只在进历史时换文字
```

提交与进行中不同是 Profile 的明确选择，下一次运行从这一轮开头起缓存失效一次。

**`render`**：Profile 的 `render` 能覆盖任何 `conv` 事件的文字（键与 `on` 同一套名字，`data` 有类型），回复与工具结果必须给出文字（返回 `null` 会留下孤立的工具调用）。优先级：`commit` 里 `format.withRender` 给的（只在提交时）、Profile 的 `render`、扩展的 `render`。

**`contribute`**：

```ts
contribute: {
    "word-count": {volatile: true, value: ({state}) => `本章当前字数：${state.words}`},
    "sql-schema": {value: ({state}) => `<sql_schema>${state.schema}</sql_schema>`},   // 没写 volatile 是稳定的
}
```

`value` 是纯函数，读视图。同一个槽有几个扩展交内容时各成一块、按扩展顺序排；有意共用的都写 `shared: true`，否则写“槽撞名”的诊断（spike 场景 45）。`<Slot name="*" stable|volatile />` 收没有按名字摆的槽；Profile 没摆的槽内容丢弃并写诊断；会变的槽放进系统提示词写“整段缓存失效”的诊断（spike 场景 13）。

**会变的内容放哪**：

| 写法 | 用户的话在最后 | 缓存 |
|---|---|---|
| 每轮一次就够的（文件变更、焦点、记忆、模式）：处理函数或 `reminder()` 写成附带内容 | 是 | 全部命中 |
| 每次请求都变的：会变的槽放在末尾（缺省布局） | 否 | 只丢末尾的槽 |
| 每次请求都变的：`standardLayout({volatile: "before-turn"})` | 是 | ReAct 中途每次请求从槽往后重算；没有扩展交内容时没有代价 |

**缓存由结构保证**：已提交的消息在同一个 Profile 版本下不再变；进行中的这一轮按 `turn` 渲染，缺省只往后长；缺省 `commit` 就是 `turn`。开发模式下内核检查：同一轮相邻两次渲染，前一次必须是后一次的前缀（按块的来源与哈希比，不比拼接后的字符串）；没写 `commit` 时，提交的样子必须等于最后一次渲染。

### 9. 副作用与拦截

有副作用的步骤只有这几样：接受用户输入、调用模型、执行工具、压缩。每样都可以被拦截，形状是包裹式的：

```ts
intercept: {
    input?(input, next, ctx): Promise<void | {reject: Rejection; redacted?: boolean}>;
    model?(request, next, ctx): Promise<ModelResponse>;
    tool?(call, next, ctx): Promise<ToolResult>;            // ToolResult: {text, status?, details?, redacted?}
    compaction?(job, next, ctx): Promise<CompactionResult>;
}
```

- **改**：调 `next` 之前改输入，之后改输出。改的是与服务商无关的请求对象，原始请求体不开放。请求对象只读，改要返回新对象；`modelStarted` 记下哪些扩展改了哪几项与最终请求的哈希。
- **拦**：不调 `next`。输入拦截返回 `{reject: {code, params}}`；工具拦截返回 `status: "denied"` 的结果（没调 `next` 时内核记 `blocked`，并记下是谁）；模型调用被拦下时可以直接给出一条回复。
- **重试**：调两次 `next`；每一次真实的调用都进日志，带这一层的调用 id。
- **用途**：模型拦截按 `request.purpose` 区别对待：压缩与后台请求也经过模型拦截链（用量、脱敏要看到），路由类插件不该降级它们。
- **脱敏**：改写后的输入或结果标 `redacted: true`，内核在日志里只记原文的哈希。插件作者用第三稿内核的实验证实了不标的后果：改写之后原文仍留在 `original` 与 `raw` 里（`evidences/api-design-sonnet-plugin.txt` 的 A3）。
- **审批**（t06）在工具拦截链的最里层、执行之前判定；扩展的放行盖不过用户配置的拒绝、工具按参数声明的拒绝与只读模式（spike 场景 8）。
- **路径限制**：“写手只改正文目录”这类规则真正的限制放在工具绑定或审批的路径范围里（t04、t06）；拦截只负责给出友好的拒绝文字，判断前用 `ctx.resources.resolve` 规范化路径（`project://正文/../设定/x.md` 这类写法能绕过字符串前缀）。
- **顺序**：从外到里：插件的扩展（按 `dependsOn` 排序，同一层按 id）、Profile 的 `extensions`、Profile 自己的字段、审批（内核）。最终顺序与清单哈希写进 `profileChanged`。这个顺序也决定反应追加事件的顺序与同一个槽的拼接顺序。
- **各入口读到的是哪一刻的状态**：`reduce` 读这条事件之前；`on` 读这条事件写入之后；`contribute`、`prompt`、`turn`、模型拦截读这次请求所在的叶子；工具拦截读发出这批调用的回复所在的叶子；输入拦截读受理这条指令时的叶子。
- **主动调模型**：压缩方法与审批钩子经 `ctx.model(request, {purpose, role?})` 调模型，内核写 `modelStarted`、过模型拦截链、计用量、接中止；`purpose` 取 `turn`、`approval`、`compaction`、`background`。
- **工具**：一个回复里的工具调用按顺序切成连续的段：声明为 `shared` 的连续调用并发执行，`exclusive`（缺省）单独执行（t14 定）。同一段的 `shared` 调用按调用顺序启动，工具要在启动时就把有顺序要求的副作用交出去（例如子代理工具把话放进子会话的缓冲区），之后的等待才并发；`concurrency` 只是回复内的调度属性，不是资源锁。工具声明的 `concurrency` 字段取这两个值；内置写文件工具与 `shell` 是 `exclusive`，子代理与任务中心的工具是 `shared`。结果仍按调用顺序作为一个写入批写入，整批写完后对每条结果派发反应；日志的形状与串行时一样。拦截不写事件、读同一份快照，并发调用也安全。
- **失败**：

  | 入口 | 出错时 | 记在哪 |
  |---|---|---|
  | `reduce` | 这次的补丁不用，叶子照样前进 | 诊断（重放会得到同样结果） |
  | `on`、`mount` 里的写入 | 这次的输出整批丢弃 | `extensionFailed` |
  | `contribute` | 这个槽这次不交 | 诊断 |
  | `render` | 用缺省渲染 | 诊断 |
  | Profile 的 `prompt`、`system`、`turn` | 这次请求算不出来，运行以 `error` 收口 | `extensionFailed` |
  | `commit` | 用缺省的提交 | `extensionFailed` |
  | 输入拦截 | 跳过这一层 | `extensionFailed` |
  | 模型拦截 | `next` 之前出错跳过这一层；之后出错用里层的回复（模型已经回复、花了钱，不丢） | `extensionFailed` |
  | 工具拦截 | 缺省拒绝这次调用；`onFailure.tool: "ignore"` 改为跳过这一层 | `extensionFailed` |

  处理函数有时限（缺省 30 秒）；每次调用有自己的中止控制器，超时就中止它的 `ctx.signal`，它的 I/O 才会停。内核的计时器都走注入的时钟，测试不用真等（第三稿内核超时只 reject、不中止，宿主审查第 4 节第 12 条）。
- **中止**：`ctx.signal` 贯穿处理函数、拦截、模型调用与工具。不合作的由内核接管：内核等的每一个 Promise 都和中止信号赛跑，中止后不再等它，模型请求写 `modelFailed`，没完成的工具调用写 `status: "unknown"`，运行以 `aborted` 收口；迟到的结果不写日志，只写诊断（spike 场景 35、50）。
- **模型适配器**：模型拦截链的最里层是 `nbook.models` 的适配器，`ModelRequest` 与 OMP 之间唯一的转换点（实施的第一个切片接真实的 `streamSimple` 验证）：

  | 方向 | 内容 |
  |---|---|
  | 请求 → OMP | `system` 的块拼成 `systemPrompt`；相邻的 user 消息合成一条多块消息；思考块连同签名原样带回；工具用完整声明，名字的 `.` 换成 `__`（t04）；`params`、`headers`、推理档、`signal` 进 `SimpleStreamOptions` |
  | 事件流 → 界面 | 文字、思考、工具调用的增量带请求序号推给界面，不写日志 |
  | `done` → 回复 | 内容块（文字、思考与签名）、工具调用、停止原因、用量、回复 id；写成 `assistant` |
  | `error`、中止 → 失败 | 带错误类别（额度、溢出、鉴权、网络、服务商）与已产生的部分内容；内核写 `modelFailed`。溢出时压缩后把同一请求再发一次，最多一次 |
  | 重试 | OMP 内部的鉴权重试、推理循环算同一次逻辑请求：一条 `modelStarted`，每次尝试记进诊断（待定项 11） |

### 10. 压缩

压缩的触发、方法与摘要格式照 [t11](../../.agents/works/w00032-agent-integration/tasks/t11-compaction/README.md) 的决定；本节写它在对话形状里怎样落地。

- **触发**（t11 决定 4）：边界的第 3 步估算 token（上一次回复的用量加之后新增的内容），超过阈值就先压缩再算请求；服务商报溢出时按溢出的方法顺序压缩后把同一请求再发一次，最多一次；手动 `compact(要求)`。压缩是运行之中的一步，界面显示“正在压缩”，可以中止；中止时不写压缩事件。
- **方法**：经压缩拦截链，最里层是方法（`shake`、就地 `inplace`、摘要模型 `summary`，t11 决定 2）；方法拿到压缩前的请求（`purpose: "compaction"`）与要求（Profile 的、`/compact` 后面的、扩展加的，t11 决定 7）。顺序由 Profile 的 `compaction` 给，结果不合格按失败换下一个。单轮模板写 `compaction: false`。
- **切点是半开区间**：`firstKeptEntryId` 自身及其后的保留；它是某一轮的 `turnStarted`，或进行中这一轮里某一步的 `assistant`（连同这一步的工具结果）。切在一步中间会拆开工具调用与结果，不允许。
- **结果**：`{method, firstKeptEntryId, replacement, omitted, restoreBatch, tokensBefore, tokensAfter, details}`（t11 决定 8 的形状加 `omitted`、`restoreBatch`）。`core.history` 这样归约：
  - 切点之前的已提交的轮去掉，摘要排在剩下的已提交轮前面；
  - 切点落在进行中这一轮里时，这一轮的输入与附带内容原样保留，切点之前的步去掉；
  - `omitted` 是 `{entryId, placeholder}`：消息还在（工具调用与结果照样成对），文字换成占位（“已省略 read 的结果，需要时重新读取”），受影响的已提交轮重新渲染一次；回退到压缩之前，完全不应用。
- **之后的公共流程**（t11 决定 6）：开场在压缩事件上重读（`opening()`）；`core.compaction` 把最近读过的至多 5 个文件、`session://plan.md`、加载过的 Skill 与完整对话记录的地址写成 `conv` 事件，与压缩事件同一个写入批，盖“这一轮的附带内容”的位置章（空闲时的只压缩运行，盖“等下一轮”）；重试同一请求时不重复写。
- **扩展的状态不受压缩影响**：片从事实归约，压缩不改事实。记着“告诉过模型什么”的片写 `resetOnCompaction`（`reminder()` 自己的片就是这样）。
- **回退与压缩**：回退到压缩事件之前，路径上没有它，归约得到压缩前的对话；界面能看压缩前的原文（t11 决定 9）。

压缩之后的请求：

```text
<System>…</System>
开场槽：[目录、参考文档（压缩后重读）]
历史：[摘要] [切点之后的已提交的轮]
进行中的这一轮：[附带内容] [用户的话] [切点之后的步] [放回的文件、计划、Skill]
```

### 11. 等用户

审批（t06）与提问（`ask`）是同一条通道（照分支的 `interaction`，t14 定）：

- 事件：`interactionRequested{id, callId, kind: "approval" | "question", request, async}`、`interactionResolved{id, decision, by, code?, data?, note?}`，`decision` 取 `allow`、`allow-session`、`deny`、`answer`、`interrupted`、`aborted`、`unavailable`，运行状态加 `waiting`。`allow-session` 时同批写 session 事件 `approvalRemembered`，批准记忆只从它归约。同一批工具调用里的几个事项可以同时待处理、任意顺序应答，全部处理完才回到运行。扩展可以归约它们（例如“问过的问题不再问”）。服务重启时让运行停下的事项按第 2 节的 `recover()` 结算，不从日志续等。
- 指令：`resolve({id, decision, answer?, note?})`；发出者（用户，或派这个会话的父会话）由服务端按调用来源注入，不是参数。同一事项的并发应答由会话日志的单写者裁决，后到的得到 `already-answered`。审批只收用户的应答；提问在会话设为“交给调用方”时也收父会话的应答；用户任何时候都能直接应答。失败码 `unknown-interaction`、`already-answered`、`not-allowed`。
- 异步提问：`ask` 带 `async` 时不进入等待，问题照样写成 `interactionRequested`、工具立即返回。回答同样走 `resolve`：内核在同一个写入批里写 `interactionResolved`，并把回答作为一条输入放进缓冲区（运行中当插话，空闲时开新一轮）；问题所在的分支被回退后，应答得到 `unknown-interaction`。
- 结算：中止时写拒绝并注明 `aborted`；被回退掉的分支上的事项结算为 `unavailable`；工具被卸载按 `tool-unavailable`。异步提问不随运行中止、关闭会话、停服结算，重开后照样能应答。
- 审批钩子的判定与规则表在 t06，`ask` 工具在 t14；内核的事件与指令形状以定稿类型为准。

### 12. 诊断

诊断是给开发者看的：稳定的码（封闭表 `diagnosticCodes`，每个码带缺省级别）、结构化参数、英文的说明与下一步（`hint`），界面按“拥有者 + 码”本地化（ADR 0034）；同一个（码、扩展、入口、事件类型）合并计数，不刷屏。槽没摆、事件名拼错这类在装配时报一次，不等第一次请求（TypeScript 作者的拼错在编译期就是错；装配期检查给 JavaScript 作者与第三方插件）。改变了结果的失败另写 `extensionFailed` 进日志（第 9 节的表），因为重放不跑处理函数，重启之后只有日志里还有痕迹。诊断与 `nb-runtime` 现有的诊断存储对接。

### 13. Profile

```ts
export const writer = defineProfile({
    id: "builtin.writer",
    name: "写手",
    description: "按给定章节续写或改写正文，只改正文目录；章节不到 3000 字会接着写。",
    initial: WriterInitial,           // Type.Object({chapterId: Type.String(), files: Type.Array(Type.String(), {default: []})})
    tools: {required: ["read", "edit"], optional: ["grep"]},
    system: "你是本书的写手，只改正文目录。",
    extensions: [opening({id: "builtin.writer.opening", initial: WriterInitial, load: async ({initial, resources}) => [`本章是 ${initial.chapterId}。`, ...(await Promise.all(initial.files.map((uri) => resources.read(uri))))]})],
    state: {words: slice.path(0)},
    on: {
        turnStarted: async (_event, ctx) => ctx.set("words", await countWords(ctx.resources, ctx.initial.chapterId)),
        toolResult: async (event, ctx) => { if (event.data.tool === "edit") ctx.set("words", await countWords(ctx.resources, ctx.initial.chapterId)); },
        assistant: (event, ctx) => { if (event.data.toolCalls.length === 0 && ctx.state.words < 3000) ctx.continue(`本章现在 ${ctx.state.words} 字，请接着写。`, {max: 3}); },
    },
    contribute: {"word-count": {volatile: true, value: ({state}) => `本章当前字数：${state.words}`}},
});
```

- **Profile 自己就是最里层的扩展**：能写扩展的 `settings`、`state`、`events`、`reduce`、`on`、`mount`、`contribute`、`intercept`，id 就是 Profile 的 id；不写 `tags`、`exports`（对 Profile 没有意义）。
- **分界**：只给这个 Profile 用的逻辑直接写在 Profile 上；几个 Profile 共用的写成共用函数（只接收具体能力，例如 `resources`，类型就简单）；要有自己的事件或导出的、helper 返回的（`opening()`、`reminder()`）、或别人写的现成扩展，放进 `extensions`。
- **Profile 级的字段**：`name`、`description`（必填，目录与 `agent.invoke` 靠它）、`initial`（调用方给的初始输入，内核按它校验，`ctx.initial` 有类型）、`payload`（输入带的结构化数据）、`modelNeeds`（t05）、`tools`（只声明，t04；可省）、`pluginExtensions`（按标签排除插件的扩展，或 `"none"`）、`extensions`、`system`、`prompt`、`turn`、`commit`、`render`、`compaction`。
- **开场用 `opening()`**：会话创建时与每次压缩之后读一次，存进它自己的 path 片，交给共用的稳定槽 `opening`（`standardLayout` 放在历史前面）；`initial` 传 Profile 的同一个 schema 常量，`load` 里就有类型。插件要往开场里加东西，也交到这个共用槽。
- **`deriveProfile(base, patch)`**：派生变体必须给新 id；`render`、`tools`、`extensions` 逐项合并；只能改 Profile 级的字段，逻辑继承。用 `{...base}` 展开时，忘了展开 `render` 会让基础的覆盖悄悄丢掉、忘了改 `id` 要到装配时才发现（Profile 作者审查的 `spread.ts`）。派生出来的 Profile 的 id 是它自己的设置命名空间，不继承基础 Profile 的用户设置。

旧节点的去处：

| 旧节点 | 第五稿 |
|---|---|
| `System`、固定消息 | `system`；特殊布局写 `prompt` |
| `History`、`History as="text"` | 缺省布局或 `<History last?>`；样子由 `turn`、`commit`、`render` 定 |
| 种子（`HistorySet`） | `opening()`；会话创建时能读 `initial` |
| `Appending` | 不需要：输入前后的持久消息是对用户的话的反应，成为这一轮的附带内容 |
| `Input` | `Turn.input`；结构化数据随 `payload` 来，单轮模板在 `turn` 里摆 |
| `Reminder`（when、every、watch） | `reminder()` |
| `ModelContext`（不落盘、插在本轮之前） | 稳定的槽；每轮变的写成附带内容；每次请求都变的用会变的槽 |
| 有状态的节点 | 扩展的片 |

### 14. 宿主接口

完整形状在 `v5/host.ts`：

- **指令**：第 3 节的表；每个带 `commandId`，返回 `{ok: true, value, seq, replayed?}` 或 `{ok: false, code, detail?}`。成功结果带 `seq`：界面等订阅追到它再画，读得到自己刚写的。
- **订阅的帧**：`log`（日志事件，seq 严格递增，权威）、`delta`（流式增量，带请求序号与连续编号，不进日志，丢了无妨）、`status`（运行状态，例如 `aborting`、`compacting`）、`diagnostic`、`reset`（服务端丢过帧：丢掉临时内容，按 seq 补日志）。重连与首次加载是同一段代码：先订阅并暂存，再取快照，按 seq 分页补日志，最后放行暂存的帧。
- **`SessionMirror`**：由帧算出缓冲区、运行状态与“需要注意”的清单（结果未知的工具调用、中断的运行、被拒的输入、模型失败、扩展失败），nb-agent-ui 与 nb-story 共用；消息视图仍由 transcript 适配器出，两者吃同一条帧流。
- **预览**：`preview({leaf?, atRequest?})` 返回最终请求与视图直接算出的请求（`original`）、由内核比较两者得到的改动（不要求拦截自己报）、每个槽的情况、被跳过的扩展、按区域的 token 估算。预览过去的请求报保真度：有录制是 `exact`，没有就由日志重建并用 `modelStarted.hash` 比对，对不上时界面标“与当时发出的不完全相同”。
- **插件宿主**：插件在 `activate` 里拿服务、建扩展（工厂闭包），经 `agent.extensions` 贡献；清单里的声明只放可序列化的部分（id、标签、依赖）。插件撤回时，正在运行的会话先跑完这次运行（期间调它的入口得到 `extension-revoked` 诊断并跳过，归约照常），空闲时自动重新装配并写 `profileChanged{reason: "plugin-removed"}`；新装的插件同理。在这之前快照里的 `pendingReassembly` 列出差异。

### 15. 测试工具

插件作者给扩展写测试用 `createTestSession`（`v5/testing.ts`，例子 `v5/tests.example.ts`）：**内核是真的**（日志、归约、视图、拦截链、单写者、请求校验），**假的只有四样**：模型、工具、时钟、资源。

```ts
await using session = await createTestSession({extensions: [memory(async () => [{id: "m1", text: "林舟左手有旧伤"}])]});
session.model.script("好的");
await session.say("续写第三章");
expect(session.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:nb-memory/retrieved | event:input"]);
```

- `say`、`mark`、`rewind`、`state(扩展)`（类型从扩展推出）、`eventsOf`、`requests[n].outline()`、`clock.advance`、手动模式（模型与工具调用都能停住，测运行中途插话、中止）。
- **严格模式**（缺省开）在关闭时检查两件事：没有被认领的 error 诊断；把日志从头归约一遍，状态必须与现场一致（抓“归约里读了时钟或随机数”）。
- 前提：内核的计时器都走注入的时钟，处理函数超时要中止它的信号（第 9 节）。

### 16. 一次运行的数据流

以写手的会话为例：用户说“续写第三章”，写手编辑一次，中途用户插了一句“别写打斗”。

1. **浏览器**：对话框发出 `send({commandId, input: {text: "续写第三章"}})`（远程服务，ADR 0024，t10）。
2. **指令**：写 `inputQueued`；会话空闲，开始运行：写 `runStarted`；同一个写入批写 `inputConsumed`、`turnStarted`、`input`。
3. **反应**：`nbook.history` 在 `turnStarted` 上写通知（有两个文件被改过），`nb-memory` 在 `input` 上写检索结果；内核给它们盖“这一轮的附带内容”的章。
4. **边界**、**视图**：

   ```text
   system: 你是本书的写手……  [slot:sql-schema]
   user:   [开场：本章是第 3 章……]
   …已提交的轮…
   user:   [通知：用户改过这些文件……] [<memory>林舟左手有旧伤</memory>] [续写第三章]
   ```

   写 `modelStarted`（`purpose: "turn"`），经拦截链发给服务商；增量带请求序号推给界面。
5. **回复**：写 `assistant`（调用 `edit`）；执行前写 `toolStarted`，完成后写 `toolResult`。这时界面里用户插话：`enqueue({commandId, input: {text: "别写打斗"}, mode: "steer"})`，写 `inputQueued`。
6. **边界**：取走插话，与 `inputConsumed` 同批写 `steer`，盖“这一步之后”的章。下一次请求前缀不变，末尾多了 `assistant`、`tool`、`user: [别写打斗]`。
7. **结束**：回复里没有工具调用，字数够了，写手不调用 `continue`；写 `turnEnded`，`core.history` 按 `commit` 提交这一轮（与最后一次请求里的样子相同）；缓冲区没有 followup，写 `runEnded`。下一次用户发言时，这一轮在历史里，缓存命中。

### 17. 验证：改写旧应用的 `leader.default`

用旧应用的默认主创 Profile（`packages/neuro-book-legacy/assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`）检验本稿，改写在 `spike/v5/profiles.tsx`（过 tsc；提示词正文省略），同一文件里还有写手、行内编辑、总结者、一个整张模板的例子与两个派生变体。

| 旧机制 | 第五稿 | 变化 |
|---|---|---|
| 七种提醒写在 `AppendingSet` 里，每个 Profile 各列一遍 | 各归拥有那份数据的插件，作为全局扩展，写成这一轮的附带内容 | Profile 里这部分是零行；插件不改 Profile 就能给它加上下文 |
| 提醒排在用户的话后面 | 附带内容在前、用户的话在最后，由 `turn` 决定，提交后不变 | 位置能改，缓存不受影响 |
| `TaskReminder` 靠 `stateKey` 字符串读 `customState` | 任务插件的 `reminder()` 读自己导出的清单（`dependsOn: [tasksContract]`） | 没有跨模块的字符串约定，名字拼错是编译错误 |
| `ModelContext` 每次插在本轮之前，下一轮挪位置，上一轮那段缓存失效（从 `prompt-order.ts` 推断） | `nbook.sql` 交稳定的槽 `sql-schema`，库结构变化经 `mount` 进来 | 每轮不再丢一段缓存 |
| `context()` 每次渲染读人设文件 | 人设是 session 的片，`mount`、设置变化、人设文件被改时读一次 | `system` 是纯函数；换 Profile 之后也会读 |
| `HistorySet` 只在历史为空时写 | `opening()` 在会话创建与压缩后读 | 压缩后目录与参考文档还在 |
| “写作任务必须交给 writer”只写在提示词里 | 工具拦截给出拒绝；真正的限制在工具绑定的路径范围里 | 能挡住 |
| 设置的 TypeBox 加另写的 `fields` 列表 | 设置的 TypeBox 一份，标题写在 schema 里 | 表单照它画 |
| `runtimeDefaults.summarizer` 每 16 次 | `nb-memory` 在 `runEnded` 上读 `coreHistory.runs`，到 16 次触发（后台运行等 t22） | 记忆归记忆插件 |
| 没有压缩的设置 | `compaction: {require, onThreshold, onOverflow}` | 主创能说压缩时要保住什么 |

结论：

- **能力**：旧版能做的都能做；多出来的是规则能挡住、插件能给不认识的 Profile 加上下文、附带内容的位置能定且不伤缓存、回退与压缩之后状态自动正确、Profile 能定一轮进历史的样子、依赖与设置有类型。
- **写法**：主创的 `defineProfile` 本体 61 个非空非注释行，与第四稿相同（开场改用 `opening()` 多了几行包装），但系统提示词不用写整张模板、依赖与设置都有类型；写手 Profile 作者用相近的写法实测从第四稿的 48 行降到 40 行；总结者第四稿写不出来（“只看最近 2 轮”没有入口），第五稿 13 行。
- **代价**：主创收到的完整上下文分散在多个插件里，要靠预览看全（每块标了来源）；人设改了，系统提示词跟着变，缓存失效一次。

### 18. 推迟的功能

| 功能 | 为什么推迟 | 没有它时怎么办 |
|---|---|---|
| `sample`（每次请求前向外部取数，按内容寻址存） | 只有“剩余额度”一个例子 | 外部数据由 `mount` 或处理函数写成事件 |
| 预览过去的请求原样复现 | 调试功能 | 预览报保真度（第 14 节）；需要原样时打开请求录制（待定项 5） |
| 一般的缓存比对诊断与 `cacheCost` | 开发工具；缓存稳定由结构保证，只保留第 8 节的两项检查 | 预览里看块的来源 |
| 后台任务（`spawn`） | t22 | 处理函数写一条触发事件（带幂等键），t22 定谁来执行 |

### 19. 原型与审查

- **第二稿 → 第三稿**：spike（连同场景检查约 3,100 行）与两轮审查。第一轮 omp 32 条（阻断 9、重要 21、建议 2）、Opus 17 条（重要 8、建议 9）；第二轮 omp 新 9 条（阻断 3）、Opus 新 12 条（阻断 1）；都已处理，证据 `evidences/design-review-r*.txt`。spike 53 个场景检查全部通过。
- **第四稿 → 第五稿**：五位设计者各自做接口设计并兼做架构审查（2026-10-29），报告 `evidences/api-design-*.txt`：

  | 设计者 | 视角 | 架构审查 | 类型检查用例 |
  |---|---|---|---|
  | omp（默认模型） | 架构、不变量、接口合同 | 阻断 1、重要 10、建议 2 | 12 处 |
  | Claude Sonnet | 插件作者：七个插件两种接口对照，两个运行实验 | 阻断 1、重要 10、建议 6（另记自己设计的代价 1 条） | 25 处 |
  | Claude Sonnet | Profile 作者：五个 Profile | 重要 7、建议 7 | 20 处 |
  | Claude Sonnet | 宿主与工具链：指令、帧、预览、插件宿主、测试工具、诊断 | 重要 13、建议 5 | 26 处 |
  | Claude Fable | 独立设计，再与第四稿对照 | 重要 9、建议 7 | 16 处 |

  取舍见第 20 节。

**性能**（spike 第三版，假模型，本机，`evidences/spike-r3.txt`）：1,200 轮（16,806 条日志、最后一次请求约 39 万 token）打开 70–240 ms，算一次请求 6–15 ms，每条新事件 18–25 ms。第三版每次请求都重新投影、渲染整段历史；第五稿已提交的轮只在提交时渲染一次，每次请求只渲染进行中的这一轮再拼接，预计算请求的代价与这一轮的长度相关（推断，没有测）。拼接与哈希仍是 O(历史长度)，产品里请求按“已提交的前缀、进行中的这一轮、会变的后缀”三段各存增量哈希。实现第五稿的 spike 时，按六项分别测：打开与恢复、单条事件的归约、提交渲染、预览、普通请求、换 Profile 与压缩后的一次性重渲染（待定项 13）。

**参照实现的机制在本稿里的对应**：

| 参照机制 | 本稿 |
|---|---|
| omp `before_provider_request`（改原始请求体） | 不开放；改与服务商无关的 `ModelRequest` |
| omp `after_provider_response`、`assistant_message`（改写回复） | 模型拦截在 `next` 之后改回复；原文与改后都进日志 |
| omp 的 steer、followUp 队列 | 输入缓冲区的两种 `mode` |
| omp、OMP 的自动重试 | 适配器内的重试算一次逻辑请求；扩展要重试就在模型拦截里调两次 `next` |
| Claude Code `PostToolBatch`、`PostToolUseFailure` | 对 `toolResult` 的处理函数；失败是 `status` 不为 `ok` 的工具结果 |
| Claude Code `PreCompact`、`PostCompact` | 压缩拦截；对 `compaction` 的处理函数 |
| Claude Code `<system-reminder>` 附在用户消息里 | 附带内容由 `turn` 排进用户消息 |
| Google ADK 的处理器管线与稳定前缀 | 视图（`core.history`、`contribute`、模板）与已提交的轮 |
| LangGraph checkpoint、interrupt、resume | 由日志归约的快照（待定项 3）；等用户的事件（第 11 节） |
| 流式输出的观察 | 不给扩展，只推界面（待定项 10） |

### 20. 第五版：五位设计者的意见与取舍

按“采纳 / 部分采纳 / 不采纳 / 待定”归类。几位都提的优先核实，只有一位提的同样核实，不按票数取舍。

**采纳**：

| 意见 | 谁提的 | 落在 |
|---|---|---|
| 跨扩展引用用对象，去掉两张全局登记表；只能读、只能监听写进 `dependsOn` 的 | Fable（`dependsOn: [扩展对象]`）、插件作者（契约对象）、Profile 作者（`read` 只给依赖）、宿主（登记是学习曲线最陡处） | 第 4 节：契约 `defineContract` 加 `dependsOn`；键用全名，与日志一致 |
| 片的作用域进类型，`reduce` 挂错作用域是编译错误 | Fable、插件作者（两人都指出第二轮审查发现的静默不生效在第四稿类型上仍放过） | 第 5 节 |
| `reduce` 改为“事件名 → 补丁”，事件在前 | Fable（补丁）、插件作者（事件在前） | 第 5 节 |
| 状态深只读 | omp、Fable | 第 5 节 |
| 外部事实经 `mount` 进来，去掉 `sessionOpened` 与 `dispose` | 插件作者（判为阻断：文件监听写不出来）、宿主 | 第 6 节；同时解决 Profile 作者指出的“换 Profile 后人设不初始化” |
| 外部世界的事实放 session，“告诉过”放 path | 插件作者（运行证据） | 第 2 节；例子改正 |
| 取走输入与开轮、用户的话原子写入；工具结果整批写入 | omp（阻断） | 第 2 节“写入批” |
| `conv` 事件的位置由内核盖章 | omp | 第 2、7 节 |
| 边界的顺序写死；`turnEnded` 之前到达的 steer 算这一轮 | omp | 第 1、3 节 |
| 提交绑定 Profile 内容哈希 | omp | 第 7 节 |
| 压缩切点半开区间、`omitted` 带占位、放回的内容与压缩同批 | omp | 第 10 节 |
| id 全局唯一（含 Profile）、重复安装拒绝 | omp | 第 4 节 |
| 指令带 `commandId`、按指令分的失败码、帧、`SessionMirror`、预览保真度、插件撤回的语义 | 宿主 | 第 3、14 节 |
| 改变了结果的失败写 `extensionFailed`；诊断有码、英文、合并计数 | 宿主、Fable（诊断要能重启后看到） | 第 9、12 节 |
| 计时器走注入的时钟，超时中止处理函数的信号 | 宿主 | 第 9 节 |
| 测试工具：真内核，只假四样，严格模式 | 宿主、插件作者 | 第 15 节 |
| `toolResult.status` 与 `details`、`toolStarted.args`、`assistant` 的内容块（含思考与签名）与请求序号、`Rejection` 码、结构化的块来源、`ToolInfo.effect`、`ModelRequest.purpose`、`emit` 的幂等键、`redacted` | 宿主、Fable、插件作者 | 第 2、8、9 节 |
| 等用户的事件占位 | Fable | 第 11 节 |
| 设置、`initial`、`payload` 用 TypeBox schema | 宿主、Profile 作者 | 第 4、13 节；缺省值写在 schema 里（宿主的写法），装配时检查每项都有 |
| 设置按扩展分开、`settingsChanged` 只派发给自己；插件设置可按 Profile 覆盖 | 插件作者、Fable | 第 4 节 |
| `render` 只剩一个，去掉 `renderAll`；回复与工具结果不许返回 `null` | 五位都提 | 第 4、8 节 |
| 提醒的现成写法；`resetOnCompaction` | 插件作者、Profile 作者（主张做成字段）、Fable（`resetOnCompaction`） | 第 5、6 节；定稿时按开发者的意见做成 helper `reminder()` |
| `continue(text, {max})` 只在 `assistant` 的处理函数里，按轮数次数 | Profile 作者（内核计数的缺陷）、Fable（类型上只在这里有） | 第 6 节 |
| 每轮一次的提醒挂 `turnStarted` | Fable（“继续”运行收不到提醒） | 第 6 节 |
| Profile 不必写整张模板；`<System />` 自闭合放 `system` | Profile 作者（主张 `layout` 字段）、Fable | 第 8 节；定稿时 `layout` 改为 helper `standardLayout()` |
| `commit` 的常见写法、`format.turn`、`format.assistantText`、`turn.status`、`turn` 拿到视图、`<History last>` | Profile 作者（主张声明式写法） | 第 7、8 节；定稿时声明式写法改为 `finalOnly()`、`withoutEvents()`、`format.withRender()`；实施计划定 `commit` 不拿视图、是纯函数（重开与回退时重算结果确定） |
| 提交时就校验 | Profile 作者 | 第 7 节 |
| 开场的现成写法、`description`、`modelNeeds` 字段；`deriveProfile`；Profile 不写 `tags`、`exports` | Profile 作者（主张 `opening` 字段） | 第 13 节；定稿时开场改为 helper `opening()` |
| 路径限制放在工具绑定里，拦截只给友好的拒绝，`resources.resolve` | Profile 作者 | 第 9 节 |
| `ctx.session` 摊平成 `tools`、`model`；`globalExtensions` 改名 `pluginExtensions`；`slice.path`、`slice.session`；`tools.required` 可省 | 宿主、Fable | 第 4、6、13 节 |
| `preview: "skip"` 改为拦截里的 `ctx.phase` | 插件作者（名字误导） | 第 6 节 |
| `exports` 能读设置 | 插件作者、Fable | 第 4 节 |
| `coreHistory` 导出 `turns`、`runs` | 插件作者 | 第 7 节 |
| `NoInfer` 护栏（否则类型会从处理函数的键反推） | Fable、Profile 作者 | `v5/api.ts` |

**不采纳**：

| 意见 | 谁提的 | 理由 |
|---|---|---|
| `emit`、`set` 改为返回值，由处理函数交出一批 | omp（Fable 倾向，不强求） | 插件作者与宿主两位实测直接调用好写，返回值在条件分支里别扭；omp 担心的原子性、抛错、多次 `set` 由写入批与第 6 节的语义写死（完成时整批写、抛错整批丢、完成后调用报错、同片取最后一次） |
| 依赖用本地别名（`uses: {history: …}`，键写 `"history/fileChanged"`） | 插件作者 | 多一个概念；全名与日志、诊断、Profile 的 `render` 键一致，读日志时不用换算 |
| 渲染写进事件声明（`conv({render})`） | Fable | `render` 保持字段，键规则与 `on`、`reduce` 一致；Profile 的覆盖也是同一个字段 |
| 设置写成 `{schema, defaults}` 两份 | Profile 作者 | 缺省值写在 schema 里只有一处来源（TypeBox 与 nb-form 的惯例）；“每项都有缺省”改在装配时检查，不靠类型 |
| 设置用 `setting.choice/text/number/flag` 辅助函数 | 插件作者 | 与 TypeBox 重复；平台的远程合同已全是 TypeBox |

**待定**（进下面的待定项；接受时都已定，见“待定项”一节）：拦截给安全类插件一个外层位置（插件作者 A16，待定项 21）；扩展 id 与插件 id 的关系（宿主，待定项 20）；`input` 一词多义要不要改名（宿主，待定项 22）；处理函数告诉界面“正在检索”的 `ctx.status`（插件作者 A12，待定项 23）；后台任务 `spawn`（插件作者，t22）。

## 影响

- **`nb-harness`**：会话模块的 `fold` 与投影沿用分支并扩展为片；Profile 宿主重写，旧的节点改由扩展接口与辅助函数实现；运行时的循环、输入缓冲区与写入批由内核自己写，不再用 OMP 的 `Agent`。t02 定的“代码以分支为主体”在运行时这一层改为按语义参照；会话格式、工具登记、模型目录与凭据、压缩方法、Profile 渲染仍以分支为主体。
- **日志格式**：新增内核事件（缓冲区四种、`turnStarted`、`turnEnded`、`continued`、`modelStarted`、`modelFailed`、`toolStarted`、等用户四种、`leafChanged`、`profileChanged`、`extensionFailed`、`reactionLimit`），写入批与位置章，带前缀、带版本的扩展事件；新应用尚未发布，旧格式由 t03 定的一次性迁移脚本处理。
- **`nbook.models`**：模型适配器按第 9 节的合同消费 `streamSimple` 的事件流，保存思考块与签名。
- **nb-story**：问答 Profile 只用了组装节点，迁移量小；它依赖的单轮调用、`TurnResult`、收尾工具、`complete()` 在新循环里保留（t02）。
- **nb-agent-ui**：按帧与 `SessionMirror` 显示缓冲区（可改、可删，标 steer 或 followup）、运行状态与“需要注意”的清单；显示每块的来源、被改写的原文与改后、修改记录、结构化诊断；`createHarnessTranscript` 适配器按新日志重写。
- **SDK 与插件作者**：`defineExtension`、`implement`、`defineContract`、`defineProfile`、`deriveProfile`、`slice`、`conv`、`ext`、模板节点、helper（`reminder`、`opening`、`standardLayout`、`finalOnly`、`withoutEvents`）、`createTestSession` 进 SDK。文档分两级：第一级只教 `system`、`tools` 与 helper；第二级讲 `on`、`state`、`reduce`、`contribute`、`mount`，并给出每个 helper 用核心字段写的展开版本。写清归约的纪律、作用域规则（外部事实放 session）、附带内容与会变的槽怎么选、`emit` 之后 `ctx.state` 仍是旧值、闭包里不放会话状态（扩展对象被所有会话共享）。
- **安全**：扩展是受信任代码（ADR 0022），本稿不引入新的安全边界；请求可被任意修改，靠修改记录追查；脱敏经 `redacted` 只记哈希。

## 对 Spec 的预期改动

- `harness.session`：内核事件与数据、扩展事件的种类、前缀与版本、写入批与位置章、片与作用域、归约规则、契约与依赖、深只读、加载校验、叶子、恢复、快照、输入缓冲区。
- `harness.profile`：`defineProfile`、`system` 与 `prompt`、`standardLayout`、模板节点与文字拼法、`turn`、`commit` 与 `finalOnly`、`withoutEvents`、`format.withRender`、`render`、`opening()`、`initial`、`payload`、压缩声明、`deriveProfile`。
- `harness.runtime`：指令与失败码、内核循环（运行、轮、步、边界的顺序）、取走缓冲区的规则、模型适配器合同、工具、拦截链与顺序、失败与中止、处理函数的语义与上限、修改记录、预览、压缩的触发与切点、等用户。
- 新的 `harness.extensions`：`defineExtension`、`implement`、`defineContract`、`ctx` 各档、`mount`、`reminder()`、生命周期、换 Profile、按标签排除、诊断码。
- `agent.*`（Agent 插件）：`agent.extensions` 贡献点取代 `agent.hooks`；插件撤回与新装对已打开会话的语义。
- 验收场景以 spike 的 53 个场景为起点，补第五稿的缓冲区与写入批、位置章、提交与 Profile 哈希、压缩切点、`mount`、`continue` 计数、测试工具的严格模式，换成真实运行时（真实日志存储、真实 OMP 适配器、进程重启）。

## 待定项

接受时（2026-10-31）各项都已定，结论加粗写在各条末尾，依据见决策记录。

1. **名字**：叫“扩展”（`agent.extensions`、`defineExtension`），还是保留“钩子”。推荐“扩展”。 **定：叫“扩展”。**
2. **Profile 在拦截链里的位置**：最里层（推荐：改请求时最后拍板）还是最外层。 **定：最里层。**
3. **归约的快照**：持久化的快照推荐“压缩点加稀疏检查点”；检查点的间隔、淘汰与分支命中策略实现时定。 **定：第一版不做检查点快照；以后要做时快照是缓存、不改日志格式。**
4. **上限**：反应链最多 3 层、`continue` 每轮缺省最多 3 次、处理函数时限缺省 30 秒。 **定：照推荐。**
5. **请求录制**：缺省关、需要时在设置里打开（推荐）。 **定：缺省关；录制与预览过去请求的重建挪到主线之后的可选片。**
6. **工具拦截里附加的说明**：写进日志（推荐：模型看到了就要能重放）。 **定：写进日志。**
7. **反应的主动接口**：`complete`、`invokeTool`、`ask`、`compact` 这类会产生新事件的主动动作怎样进日志（推荐：每个动作写一条带来源的控制事件，结果作为事件回来），实现时定。 **定最小形状：压缩方法与审批钩子经 `ctx.model(request, {purpose, role?})` 调模型，内核写 `modelStarted`、过模型拦截链、计用量、接中止；其余主动动作以后再加。**
8. **很大的值**：整章正文、开场的参考文档这类大块内容（附带内容、工具结果、`opening()` 的片）是否另存到日志之外、日志里只记哈希（Fable 估算主创每次压缩后重读开场要多写几十 KB，推断）。 **定：超过 16 KB（UTF-8 字节）的字符串另存为会话目录里按内容寻址的文件，日志只记哈希与长度；第一版打开时全量读回。**
9. **流式输出给不给扩展看**：推荐不给，增量只推给界面；以后真有需要再加一个只读的观察接口。 **定：不给。**
10. **模型适配器的审计粒度**：推荐一次逻辑请求一条 `modelStarted`，每次服务商尝试记进诊断。 **定：照推荐。**
11. **请求的完整形状**：图片与附件块、工具的参数 schema 与 `tool_choice`、服务商专有选项；推荐 `tools` 用完整的工具声明，服务商专有的放适配器选项，实现 t04、t05 时定。 **定：见第 8 节的 `ModelRequest`（完整工具声明、`toolChoice`、`providerOptions`、思考签名与图片块）。**
12. **性能预算**：长会话的目标（例如 10 万条事件打开在 1 秒内、算一次请求在 50 毫秒内）与第 19 节的六项测法。 **定：典型 2 万条事件打开 1 秒内、算一次请求 50 毫秒内、打开后常驻不超过 200 MB；10 万条只作压力测试。**
13. **审计与脱敏**：`redacted` 之外，要不要给日志导出与会话分享另加一层过滤。 **定最小形状：宿主可给一个出站过滤，日志查询与推帧之前调用。**
14. **多 Agent**（t14 已定，见 [t14](../../.agents/works/w00032-agent-integration/tasks/t14-multi-agent/README.md)）：子 Agent 是独立的会话，会话头记调用方；父会话里不加新事件，派生与发话就是工具调用；审批交给用户，提问缺省交给调用方；后台运行走任务中心（t22）。
15. **steer 与 followup 的缺省**：运行中在对话框里回车是 followup（推荐，五位设计者都同意），另一个操作是插话。 **定：照推荐。**
16. **多条 followup**：一条一轮（推荐，五位设计者都同意）。 **定：照推荐。**
17. **压缩后放回的内容放哪**：写成 `conv` 事件、与压缩同批、盖这一轮的位置章（推荐，五位设计者都同意）。 **定：照推荐。**
18. **会变的槽的缺省位置**：缺省布局放在末尾（推荐，五位设计者都同意）；要“用户的话在最后”的 Profile 写 `prompt: standardLayout({volatile: "before-turn"})`。 **定：照推荐。**
19. **`<Slot name="*">` 与有意不摆的槽**：写明 `*` 只收没被单独摆放的槽；有意不要某个槽时加一个“我知道”的标记（例如 `<Slot name="word-count" drop />`），免得每次请求一条诊断。推荐加。 **定：加 `<Slot drop>`。**
20. **扩展 id 与插件 id**：平台的贡献点可以要求贡献 id 以“插件 id 加点”开头；推荐扩展 id 写成“插件 id”或“插件 id 加点加名字”，日志里的事件类型名自带来源；现在定，晚改会牵动日志里的类型名。 **定：插件贡献的扩展 id 是“所属插件 id”或“所属插件 id.名字”，内核按宿主传入的所属插件校验前缀；Profile 的 id 是 t05 的 key `<来源>.<名字>`，与所有扩展 id 不重复。**
21. **安全类插件的拦截位置**：脱敏、审计要最先看到输入、最后看到结果，按 `dependsOn` 与 id 排序表达不了；推荐拦截加一个粗粒度的层（`layer: "outer" | "inner"`，缺省 inner），或者把脱敏写进内核。 **定：加 `layer`，挪到主线之后的可选片。**
22. **`input` 一词多义**：事件 `input`、拦截 `intercept.input`、类型 `UserInput`、`Turn.input` 同名；推荐保持（类型上分得清），文档里写清 `intercept.input` 在取走时、`on.input` 在写入之后。 **定：保持；输入拦截改为在受理时跑（第 3 节）。**
23. **处理函数告诉界面进度**：慢的处理函数（远端检索）挡住这一轮的第一次请求，界面只看到“没反应”；推荐给 `on` 的 ctx 加一个不进日志、只推给界面的 `ctx.status(文字)`，并在超时时显示是哪个扩展拖慢了。 **定：加 `ctx.status`，挪到主线之后的可选片。**

## 第三至五稿改变了已定写法的地方（开发者 2026-10-29 认可）

第三稿（按审查意见改）：

- 扩展从单片状态改为多片，`pathState`、`sessionState` 改为片与 `ctx.set`。
- 扩展事件改由 `events` 声明，类型自动带扩展 id 前缀。
- `render` 从 `<History>` 节点上移到 Profile 与扩展上。
- “接着做”改为要显式写。
- 相邻的 user 消息不再在内核里拼接，内容改为块。

第四稿（按开发者的状态机设计改，以下几处是落地时定的）：

- 中途的记录不放 session 作用域：它们是 path 上的事实，只写一次；`Message[]` 是归约结果，不另存。
- 按“每轮结束时提交”，不是按“运行结束时”。
- 附带内容按写入位置归入这一轮，不按因果链；缺省排在用户的话前面。
- 去掉 `replaces: "core.history"`，用 `turn`、`commit` 代替。
- 第 18 节的推迟。

第五稿（按五位设计者的意见改，第 20 节）：

- 第四稿第 16 节的接口修订（按事件名挂处理函数、驼峰事件名并去掉 `K` 与 `is`、`input` 与 `steer` 分开、`ctx` 分档、`emit`/`set` 直接调用、完整变量名、Profile 就是最里层的扩展）全部保留。
- 跨扩展引用改为契约对象加 `dependsOn`；`reduce` 改为“事件名 → 补丁”；外部事实经 `mount`；设置用 TypeBox；提醒、开场、缺省布局与常见的提交写法做成 helper；`deriveProfile`。
- 内核加写入批、位置章、提交绑定 Profile 哈希、指令带 `commandId`、`extensionFailed`。

## 第五稿到定稿的差异（实施计划第二版，2026-10-30）

t20 实施计划第二版把 `spike/v5/` 改成定稿类型（`packages/nb-harness/src/kernel/api/`）。下面是改动，依据见决策记录 2026-10-30 与 2026-10-31 的几行；正文的第 2、3、7、8、9、11、20 节已按它们改写。

| 方面 | 第五稿 | 定稿 |
|---|---|---|
| 写入批的落盘 | 事务或提交标记 | JSONL 每行带 `batch: {id, n, of}`；文件里完整的批就是已提交的批；写失败句柄进损坏状态、不重试，重开时截掉不完整的尾部 |
| 会话目录 | 未定 | `<根>/<会话 id>/` 下 `session.jsonl`、`blobs/`、`session.lock`、`index.json`；第一行是会话头，带格式版本 |
| 大块内容 | 待定项 8 | 超过 16 KB 的字符串存为 `blobs/<sha256>`，事件里记 `{$blob, size}` |
| 会话互斥 | 单写者只在进程内 | 打开会话取目录锁；第二次打开得 `session-busy` |
| 幂等 | `commandId` 是事件的幂等键 | 受理批里写 `commandAccepted{commandId, name, value}`；会开始运行的指令受理批含 `runStarted` |
| 输入拦截 | 取走时跑，拒绝写 `inputConsumed.rejected`、运行以 `input-rejected` 结束 | 受理时跑，拒绝是指令失败、不写日志；`inputQueued`、`inputEdited` 存拦截后的文字，`input`、`steer` 只引用缓冲区的 id |
| 等用户 | 四个占位事件 | `interactionRequested`、`interactionResolved{decision, code?}`、`approvalRemembered`；指令 `resolve` |
| 重启时的等待事项 | 照日志接着等 | 让运行停下的事项收口为中断：审批结算为拒绝（`interrupted-before-approval`），提问 `interrupted`；异步提问不结算 |
| 新的内核事件 | — | `commandAccepted`、`approvalRemembered`、`titleChanged`、`archived`（session）；`toolsAnnounced`、`modelEnded`（path） |
| `assistant` | 内容块、工具调用、用量 | 加 `stopReason`（`stop`、`length`、`tool`、`error`、`aborted`）、OMP 用量的全部计数、`model`、`effort` |
| 运行结束 | `runEnded.reason` 无 `finished` | 加 `finished` 与 `result{via, value, valid}`（收尾工具或最后一条回复） |
| `modelFailed.kind` | 额度、溢出、鉴权、网络、服务商 | `network`、`rate_limit`、`auth`、`quota`、`context_overflow`、`provider`、`local`、`aborted`、`interrupted` |
| 工具 | `ToolInfo` 带 `effect` | 以 master 的 `ToolDeclaration` 为底加 `effect`；日志与审批一律用 id，`providerName?` 可选；`toolResult` 加 `code` |
| `commit` | `(turn, format, view)` | `(turn, format)`，纯函数 |
| 主动调模型 | 待定项 7 | `ctx.model(request, {purpose, role?})`；`purpose` 加 `approval` |
| 指令 | `rewind` 带 `abort` | `rewind` 去掉 `abort`（运行中先 `abort`）；加 `switchBranch`、`fork`、`setTitle`、`archive`；查询加 `path`、`siblings`、`runResult` |
| 运行状态 | — | 加 `waiting{pending}`、`broken` |
| 类型名 | `Event`、模板 `Node`、对话 `Turn` | `LogEvent`、`PromptNode`、`ConversationTurn`（模板组件仍叫 `<Turn />`） |
| 压缩结果 | 带 `restoreBatch` | `{method, firstKeptEntryId, replacement, omitted, tokensBefore, tokensAfter, details}`；放回的内容由内核的公共流程写；方法失败以 `{failed: code}` 交回，换下一个 |
| 定义 | 无版本 | Profile 与扩展加 `version` |
| 审批 | 内核的最里层 | 宿主注入的钩子 `approve(call, info, ctx)`，必填、没有缺省；“全部放行”只给测试用 |
| 挪到主线之后 | — | 预览过去请求的重建与请求录制、`ctx.status`、拦截的 `layer`；`SessionMirror` 随迁移 Task |

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
| 2026-10-29 | 开发者 | 同意把能独立成扩展或写成纯函数的便利写法做成 helper，不做成字段：`remind` 改为 `reminder()`、`opening` 改为 `opening()`、`layout` 改为 `standardLayout()`、声明式 `commit` 改为 `finalOnly()`、`withoutEvents()`、`format.withRender()`；理由是便利字段太多会加重开发者的心智负担 |
| 2026-10-29 | 开发者 | 认可第五稿（含第三至五稿改变已定写法的地方），结束 t20 的讨论；实现时再做一次审查；t20 改了内核，优先级提高 |
| 2026-10-30 | 开发者 | t14 讨论中定了三处内核修正：审批与提问合成一条通道（`interactionRequested`、`interactionResolved` 与指令 `resolve`，取代四个占位事件）；声明为 `shared` 的工具在同一个回复里并发执行（从推迟的功能移入）；用户输入加 `replyTo` 支持异步提问（同日审查后改为异步回答也走 `resolve`，不加 `replyTo`） |
| 2026-10-30 | 开发者 | t20 实施计划第一版：新内核作为 `nb-harness` 的新实现，以第三稿 spike 为起点按定稿类型重写；只做包内内核；待定项 1、2、4、5、6、9、10、19、21、22、23 照推荐；计划走快速审查，实现做一次深入审查 |
| 2026-10-30 | 开发者 | 实施计划第一轮审查之后全部按推荐：重启时等待中的事项收口为中断（审批结算为 `interrupted-before-approval` 的拒绝）；输入拦截在受理时跑；`commit` 是纯函数；nb-story 依赖的语义（收尾工具、运行结果、`complete()`、停止原因、错误归类、密钥遮盖、进程收尾、相邻 user 合并、只用指定的密钥变量）放进 t20；性能预算 2 万条打开 1 秒、算一次请求 50 毫秒、常驻 200 MB，不做检查点，超过 16 KB 的字符串另存；预览过去请求的重建、请求录制、`ctx.status`、`layer` 挪到可选片，`SessionMirror` 并入迁移 Task |
| 2026-10-30 | 主 Agent（开发者知悉） | 照审查意见订正与补定：扩展 id 与 Profile id 的两条规则（待定项 20）；会话目录锁与 `session-busy`；主动接口 `ctx.model` 与 `approval` 用途（待定项 7）；出站过滤（待定项 13）；请求的完整形状（待定项 11） |
| 2026-10-31 | 开发者 | 接受本提案，按“第五稿到定稿的差异”与实施计划第二版实施；架构取舍记入 [ADR 0035](../adr/0035-harness-log-driven-kernel.md) |
| 2026-10-31 | 主 Agent（开发者知悉） | 实现第 5 片时订正两处定稿类型：输入拦截的返回值改为 `void \| {reject} \| {redacted: true}`（原写法让 `redacted` 只能跟着拒绝出现，第 9 节“改写后的输入标 `redacted`”做不到）；新增内核对话事件 `notice{code: "tools-changed" \| "result-requested"}`，承载第 9 节与 t04 决定 6 的“工具集变了给模型一条提醒”和实施计划第 3.6 节“会话要交回结果时第一轮开头的固定提醒”（原来没有事件名）。行为写在 `harness/runtime.md` 输出 16、24、27 |
| 2026-10-31 | 开发者 | 按 t20 第 4 片实现审查的推荐：Profile 的 `turn` 改为纯函数 `(turn, format)`，不再读视图；不写 `commit` 时一轮按 `turn` 提交，重开或回退后确定。会变的内容用槽或 `reminder()`；单轮模板要的结构化数据来自输入的 `payload`。第 8 节“`turn` 仍能读视图”与第 13 节的签名以此为准，写进 `harness/profile.md` |
