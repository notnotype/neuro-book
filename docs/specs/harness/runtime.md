---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.runtime
owners:
  - nb-harness
---

# Harness 运行：指令、循环与运行结果

## 目标与非目标

给宿主一台由日志驱动的状态机：指令进、事件与帧出。用户与别的发出者的话先进输入缓冲区，取走时才成为对话里的事实；缓冲区里每条话是就绪或留着，运行只取就绪的，留着的由能放行它的发出者放行；一次运行是可能有好几轮的 ReAct 循环，每次模型请求前由视图算出请求，回复与失败都写回日志。宿主能等一次运行结束、取它的结果。

日志与恢复见 [`harness/session.md`](session.md)，扩展见 [`harness/extensions.md`](extensions.md)，模型端口见 [`harness/models.md`](models.md)。

不承诺：

- 运行中途换模型：模型按每次请求时的核心设置解析。
- 换模型回退、等额度恢复：可重发的失败只在同一个模型上重发（输出 62–69）。
- 费用门：内核只累计（输出 70），告警与上限由扩展做（[`agent.run-guards`](../agent/run-guards.md)）。
- 等用户的事项没有期限：没人应答就一直等，直到应答、`settlePending`（输出 111）、中止或进程退出。
- 已知限制：受理批的写入结果不确定（写进文件、同步失败）时，等这个事项的调用以 `aborted` 叫醒，不交还。应答之外的指令在受理批写下、反应批写失败时交回 `log-broken`，同一个 `commandId` 重发却得到成功（输出 119）。
- 已知限制：Profile 找得到但缺扩展、以占位装配冷打开的会话，补上依赖之后的重新装配不重新解析原 Profile 就解除只读；回退到运行中途之后、扩展在 `on.leafChanged` 里写了路径事件时，重开会把这次暂停当成中断收口；回退后续跑复用原 run id 时，`waitRun` 可能取到旧分支的结果。

## 术语与参与者

- **输入缓冲区**：提交了还没取走的话，session 作用域；每条带 `steer` 或 `followup` 模式、发出者与状态。缓冲区另有提醒，见下一条。
- **提醒**：会话或宿主交给会话、下一次对话请求带上的一段文字（输出 112–118）。它不是用户的话，也不进输入的就绪与留着；会话作用域，取走之前一直待发。
- **唤起**：带唤起的提醒让空闲的会话开一次运行（输出 116）。
- **门**：会话级的开关，决定提醒能不能唤起这个会话（输出 117）。
- **就绪**、**留着**：缓冲区条目的两种状态。运行只取就绪的；留着的带原因（`cause`），停止时留下的另带停的人（`heldBy`），要经放行才再变成就绪（输出 103–109）。
- **发出者**：指令的身份，三种：用户、会话 `{kind: "session", id}`、宿主 `{kind: "host", source: {plugin, label, ref?, at?}}`（输出 45）。判等按种类与身份：会话按 `id`，宿主按 `source.plugin`。
- **放行**：把留着的话转回就绪，写 `inputReleased`（输出 105）。
- **暂停的运行**：回退到运行中途后，那条分支上没有收口、也没有循环在跑的运行（输出 36）；按空闲算。
- **运行不再取输入**：只压缩的运行、停止已受理的运行、已决定收口的运行。这时到达的 `send`、`enqueue`、`resume`、`release` 与异步回答按空闲处理放话与放行，开运行推迟到收口的写入批（输出 104）；其余指令照常按有运行在跑判断（`start` 得 `already-running`，`rewind` 等得 `running`）。
- **运行**：`runStarted` 到 `runEnded` 之间；**轮**：`turnStarted` 到 `turnEnded` 之间，从一条输入开始（没有新输入的“继续”运行除外）。
- **受理批**：指令受理时写下的写入批。
- **帧**：向外吐的东西：`log`（日志事件）、`delta`（流式增量）、`status`（运行状态）、`diagnostic`、`reset`。
- **嵌套调用**：工具在执行中经 `ToolContext.invoke` 发起的工具调用；发起它的那次调用是它的**父调用**（输出 90）。

## 输入与前置条件

指令的参数、成功值与失败码以 `@notnotype/nb-harness/kernel/contracts` 导出的 `CommandMap` 与 `commandErrors` 为准；每条指令带 `commandId`。会话由 `createSession(env, options)`、`openSession(env, id)` 得到，`closeSession(session)` 关闭；`SessionEnv` 由宿主注入（存储、Profile 解析、模型端口、工具、资源、时钟、审批钩子）。

## 输出与可观察行为

1. `send` 的输入为空（文字去掉空白后为空且没有附件）时失败 `empty-input`，不写日志。
2. 会话空闲时 `send` 的受理批依次是放行（输出 105，没有可放行的不写）、`inputQueued`、`runStarted{by}`、取走就绪的第一条开第一轮（`inputConsumed`、`turnStarted`、`input`；放行出来的排在新话前面，所以第一轮可能是放行出来的话）、`commandAccepted`，成功值带新输入与新运行的 id；有运行在取输入时只写放行、`inputQueued` 与 `commandAccepted`，成功值的 `runId` 为 null。成功值都带这条话的去向（输出 110）。叶子上有暂停的运行时见输出 36，运行不再取输入时见输出 104。
3. `enqueue` 在有运行取输入时写放行、`inputQueued` 与 `commandAccepted`，成功值带它在缓冲区里的位置。会话空闲时（含叶子上有暂停的运行、运行不再取输入时）：用户的 `enqueue` 等同 `send`，模式照传；会话、宿主的 `enqueue` 不放行、不开运行，写 `inputQueued{state: "held", cause: {queued: "idle"}}`。
4. `start` 接着跑叶子上可接着跑的运行，不取留着的话。可接着跑的运行：暂停的运行（输出 36）；或叶子上最后一次对话运行（只压缩的运行不算）没有正常结束、且它的最后一轮停在当中（中断、出错或停止时这一轮没有以 `completed` 结束）。有运行在进行时失败 `already-running`；暂停的照输出 36 接着跑；已收口的开一次没有新输入的“继续”运行（`runStarted{by}`，`turnStarted.inputId` 为 null），就绪的话按取的规则在边界与一轮结束时取走。缓冲区里有就绪的话、而叶子上没有可接着跑的运行时（只有升级前的旧日志会这样），取走就绪的第一条开一轮。都没有时失败 `nothing-to-continue`，留着的话不算。不是用户的发出者只能接着跑 `runStarted.by` 是它自己的那次运行（`runStarted` 没有 `by` 的旧日志一律按用户开的算），或会话头 `owner` 归它的会话里的运行（planned，`owner` 随 [bot 提案](../../proposals/neurobot.md) 加入会话头）；那次运行是用户停止的（`runEnded.stoppedBy` 是用户）时也不能；否则失败 `not-allowed`。
5. 会开始运行的指令在开始前就能判定的失败是指令失败、不写日志：会话只读得 `read-only`；模型端口解析失败时得它的码，原样交回（`no-model`、`no-credentials`、`unknown-model`、`role-unbound`，见 [`models.md`](models.md) 输出 16）。解析时带会话当前的 Profile（换 Profile 之后是新的）。
6. 每次模型请求之前写 `modelStarted{request, purpose: "turn", model, hash, now, invocation, modifiedBy}`；`request` 在一个会话里单调增加，可能有空洞（并发的请求各占一个，被拦下的回复也占一个）。回复写成 `assistant`（内容块、工具调用、停止原因、用量、作答的模型），失败写成 `modelFailed`。
7. 回复里没有工具调用：在单写者队列的同一项里看缓冲区并写下这一批（输出 104）：有就绪的 `steer` 时这一轮不结束，接着请求（同输出 28）；否则写 `turnEnded{completed}`，有就绪的 `followup` 时同一个写入批里取走最早的一条开下一轮（`inputConsumed`、`turnStarted`、`input`），同一次运行接着请求；都没有时同一个写入批里写 `runEnded{completed}`。文字收口（输出 27）的判断也在这一项里。
8. 模型失败：写 `modelFailed{kind}`（类别见 [`harness/models.md`](models.md) 输出 2），模型端口交回的部分内容与用量记在 `partial`、`usage`；不再重发时（输出 62）之后 `turnEnded{error}`、`runEnded{reason: "error", error: {kind, code?}}`。
9. `abort` 触发当前运行的中止；模型请求以 `modelFailed{kind: "aborted"}` 收口，之后 `turnEnded{aborted}`、`runEnded{aborted}`。中止之后在注入的时钟上等宽限期 `ABORT_GRACE_MS`（同输出 25）让模型端口交回，交回的半截回复与用量记在 `partial`、`usage`（界面已经推出去的文字刷新后还在）；宽限期过了仍没交回只写 `kind`。没有运行时成功值为 `{aborted: false}`，不写日志。
10. Profile 的 `prompt`、`system` 或 `turn` 抛错时这次请求算不出来：写 `extensionFailed{entry}`，运行以 `error`、码 `profile-failed` 收口。
11. 对话事件写入时，内核按当时的轮盖位置章：进行中的轮还没有回复时是这一轮的附带内容，有了回复是最后一步之后，没有进行中的轮是“等下一轮”。回复与工具结果不盖章。
12. 流式增量以 `delta` 帧推出，带请求序号、请求的用途（`purpose`）与从 1 起递增的编号，不进日志；只有对话请求（`turn`）让运行进入 `streaming` 阶段，压缩与审批模型的请求流式时运行仍在 `compacting`、`tools`。运行状态的变化（阶段、中止中、损坏）以 `status` 帧推出。
13. `waitRun(runId)` 在运行收口之后完成（收口批按输出 104 开了下一次运行时，完成时会话已在下一次运行里；其余情形会话已经空闲），结果同 `runResult(runId)`：结束原因、停止原因（运行以收尾工具结束时为 `finished`）、最后一条回复的文字、运行结果、错误、用量、这次运行写下的事件的 seq 范围。用量是这次运行全部回复与非对话请求的用量之和，有一条不完整总和就不完整。运行结束后（包括重开之后）`runResult` 照样能取。句柄进损坏状态时，已在等的与之后再来的 `waitRun` 一样：日志里已有这次运行的 `runEnded` 就交回它，否则立即以 `{reason: "error", error: {kind: "local", code: "log-broken"}}` 完成，不写日志、不挂住（包括受理批写下了、因反应批写失败没开起来的运行）。
14. 请求的样子由 Profile 定（规则见 [`harness/profile.md`](profile.md)）：不写模板时依次是系统提示词与稳定的槽、开场槽、已提交的轮、进行中的这一轮（附带内容在前、用户的话在最后）、会变的槽。

工具：

15. 生效工具集是宿主经 `SessionEnv.tools.declarations` 给的声明；会话头带 `result` 时另加内核生成的收尾工具 `yield`（输出 27）。声明的 id 或交给服务商的名字不合 [`harness/models.md`](models.md) 的规则、或两个声明换算后同名时，这个声明不进工具集，诊断 `tool-declaration-invalid`。宿主给的就是最终的工具集，不按 Profile 的 `tools` 过滤（工具绑定可以加 Profile 没写的工具，[`agent/contributions.md`](../agent/contributions.md) 输出 4）；`tools.required` 里有不在工具集里的，运行以 `error`、码 `tools-missing` 收口，诊断 `tools-missing{missing}`，会话进只读直到重开。
16. 每次模型请求之前，把工具集（按 id 排序的 id 与版本）与当前路径上最后一条 `toolsAnnounced` 比对：没有记录时写一条 `toolsAnnounced`；不同时同一个写入批里写新的 `toolsAnnounced` 与一条给模型的 `notice{code: "tools-changed"}`，文字列出新增、去掉与改了版本的工具。回退到变化之前的分支时照样按那条路径上的记录比对。
17. 一条回复里的工具调用按顺序切段：连续的 `concurrency: "shared"` 调用并发执行（按调用顺序启动），`exclusive` 单独执行。每个调用经工具拦截链（输出 20–23），最里层依次是参数校验、只读模式、审批钩子、执行；放行之后、执行之前写 `toolStarted{callId, tool, args, invocation, approval: {by}}`，`args` 是全部拦截之后实际执行的参数。全部调用的结果按调用顺序作为一个写入批写入，整批写完再派发反应。
18. 内核造的结果：工具不在工具集里得 `error`、码 `unknown-tool`；参数不合声明的 schema 得 `error`、码 `invalid-arguments`，文字列出不合格的位置；只读模式下等级为 `write` 或 `exec` 的调用得 `denied`、码 `read-only`、`by: "core"`，不调用审批钩子；审批钩子拒绝得 `denied`，码与 `by` 取自它的拒绝；执行抛错得 `error`、码 `tool-threw`。等级按参数求值的函数抛错时按 `exec` 算。
19. 工具实现每个会话每个工具在第一次调用时建一次；工具被移出工具集时在下一个运行边界 `dispose`，之后重新出现时重建；关闭会话时全部 `dispose`。`dispose` 抛错只写诊断。

拦截：

20. 拦截链从外到里是装配序（插件的扩展、Profile 的 `extensions`、Profile 自己）；`mount` 失败过的扩展不参与。每一层每次调用有自己的 `invocation` 与 `ctx.signal`，信号挂在运行的中止上。调用 `next` 之前、`next` 完成之后两段各有时限（扩展的 `timeoutMs`，缺省 30 秒；输入拦截缺省 5 秒）。一层出错或超时之后再调用它拿到的 `next` 得到拒绝，不再进里层。交给拦截层的请求、工具调用与工具结果是冻结的（请求的 `tools` 只冻结数组本身）：要改就返回新对象，原地修改抛错，按这一层出错处理。
21. 拦截出错或超时：输入拦截跳过这一层；模型拦截在 `next` 之前出错跳过这一层，之后出错用里层的回复；工具拦截缺省拒绝这次调用（`denied`、码 `intercept-failed`、`by` 为这个扩展），扩展写 `onFailure: {tool: "ignore"}` 时跳过这一层（`next` 之后出错用里层的结果）。每次都写 `extensionFailed{entry: "intercept.<链>", code}`，与这次的结果（回复、工具结果或受理批）同一个写入批，并诊断 `intercept-threw`。
22. 模型拦截：每一次真正发给模型端口的请求写一条 `modelStarted`（一层调两次 `next` 就有两条），`modifiedBy` 列出在它之前改过请求的层与改了的顶层字段，`hash` 是这次请求的哈希；写成 `assistant` 的是链最外层交回的回复，`request` 是最后一次真正发出的请求的序号。一层不调 `next` 直接交回回复时，内核为它分配新的请求序号，不写 `modelStarted`。模型端口在进链之前按设置解析好，拦截不能改 `model`：改了的那一层算出错、跳过（诊断 `intercept-threw`），请求按原来的模型发。
23. 工具拦截：一层不调 `next` 交回 `denied` 时结果记 `blocked`，`by` 为这一层的扩展；执行之后有层改了结果的文字时，原文记在 `toolResult.raw`，结果标了 `redacted` 时只记 `rawHash`（SHA-256），也不写 `details`。工具实现（`ToolContext.read`）与审批钩子（`ctx.read`）能读任何已装扩展的导出，读的是发出这批调用的那条回复所在叶子上的状态，与工具拦截看到的同一刻；没装的读到 undefined。
24. 输入拦截在 `send`、`enqueue` 受理时、受理批写下之前跑，读受理这一刻的叶子：一层返回 `{reject}` 时指令失败 `input-rejected{code, params, by}`、不写日志，诊断 `input-rejected`；有层改了输入时 `inputQueued.input` 是改过的，原文记在 `original`；有层返回 `redacted: true` 时只记 `originalHash`，文字没改也照记（[`harness/session.md`](session.md) 输出 10）。
25. 运行在执行工具时被中止：在注入的时钟上等宽限期 `ABORT_GRACE_MS`（2 秒），期内完成的调用照常写结果；中止时还没开始执行的调用（还在审批或建实现）不再开始，得 `denied`、码 `aborted`、`by: "core"`（肯定没执行）；开始了没完成的得 `unknown`、码 `aborted`；同一段并发的调用按各自是否在宽限期内完成判断，不按先后；运行以 `aborted` 收口。宽限期之后才到的结果不写日志，只诊断 `late-result-dropped`。

收尾：

26. 收尾工具（声明 `finish: true`）：一条回复里只调用了它一个、参数通过校验且执行结果是 `ok` 时，同一个写入批里写工具结果、`turnEnded{completed}`、`runEnded{reason: "finished", result: {via: "tool", tool, value: 参数, valid: true}}`，不再请求模型；执行结果不是 `ok` 时按普通工具处理，运行继续；与别的工具在同一条回复里、或一条回复里有两个收尾工具时，收尾工具都不执行，各得 `error`、码 `finish-not-alone`，别的工具照常执行。执行中被中止时，宽限期（输出 25）内完成的收尾结果照常写下、运行以 `finished` 结束；宽限期之后才到的只诊断 `late-result-dropped`，运行以 `aborted` 收口；结果写下之后的中止不改变 `finished`。
27. 会话头带 `result: {mode, schema}` 时，内核生成收尾工具 `yield`（参数就是 `schema`），并在会话的第一轮开头写一条 `notice{code: "result-requested"}` 告诉模型完成后调用它。模型停下而没有调用 `yield`：`optional` 以最后一条回复的文字作结果（`via: "text"`、`valid: false`），运行照常以 `completed` 收口；`required` 先写一条 `continued{by: "core"}` 催一次，仍没有就以最后一条回复作结果（`valid: false`），运行以 `error`、码 `result-missing` 收口。

缓冲区、设置与恢复：

28. 运行中，每个边界把缓冲区里全部就绪的 `steer` 按入队顺序取走：每条一个 `inputConsumed` 加一条 `steer`，同一个写入批，进当前这一轮（还没有回复时是附带内容，有了是最后一步之后）。（planned）取走在这个边界的压缩之后、组请求之前，与待发的提醒同一个写入批（输出 113），所以边界上的压缩不会把这一次刚取的插话压掉；服务商报溢出后的压缩（输出 50）照旧可能压进摘要。模型给出最终回复时缓冲区里还有就绪的 `steer`，这一轮不结束，接着请求；同时有扩展要 `continue` 时先写 `continued`，两者都进下一次请求。有带唤起的待发提醒时同样不结束这一轮；不带唤起的不延长这一轮，等下一次对话请求。
29. `edit`、`remove` 只对还在缓冲区里的输入（就绪或留着都行，状态不变），按发出者（输出 108）：`edit` 只能改自己排的，经输入拦截链（同输出 24）写 `inputEdited`，条目的发出者不变；`remove` 用户能取消任何一条，会话、宿主只能取消自己排的，写 `inputRemoved{by, reason: "cancelled"}`；不允许时得 `not-allowed`。不在缓冲区里时，入过队的（已取走或已删）得 `input-consumed`，从没入过队的得 `input-not-found`。
30. `abort` 只停发出者能停的运行（输出 108）：权限在触发信号之前同步判定，不允许时得 `not-allowed`，运行不受影响。允许时在同一个同步步骤里触发信号、读下范围、把受理排进队列，受理绑定这次运行；这一步早于这次运行的收口那一项时，收口批不论以什么方式收口（包括宽限期内交出结果的 `finished`）都按停止的范围处理，晚于它时交回 `{aborted: false}`、不动缓冲区，之后开的运行不受它影响。范围是这个同步步骤那一刻已在缓冲区里的话（就绪与留着的都算）：缺省清空其中停的人能取消的（用户能取消全部，会话、宿主只有自己排的，同输出 29），每条写 `inputRemoved{by: 停的人, reason: "aborted"}`；范围里其余就绪的话，以及 `keepQueue: true` 时全部就绪的话，写 `inputHeld{cause: {end: "aborted"}, heldBy: 停的人}`；已经留着的不改（输出 109）。这些与 `runEnded{aborted}`、`commandAccepted{name: "abort"}` 同一个写入批：重发同一个 `commandId`（中止进行中、运行收口后、重开之后）交回第一次的结果。停止受理之后才到的话不在范围里，按各自的发出者照输出 104 处理。两个发出者先后停同一次运行，以先受理的为准：清空与否、`heldBy`、`runEnded.stoppedBy` 都按它；后到的 `abort` 不改变它们，它的 `commandAccepted` 同样写进收口批，交回与第一个相同的 `{aborted: true}`。没有运行时缓冲区不动、不写日志。轮以 `error` 或 `aborted` 结束时不取 `followup`。句柄已坏时新的 `abort`（没有受理记录可重放）得 `log-broken`，不登记、不触发信号。
31. `changeSettings` 的补丁按扩展 id 分组（核心设置组是 `core`：`model`、`effort`、`approvalMode`、`readOnly`），整体校验：组不是装配里的扩展得 `unknown-extension`，键不在它的设置 schema 里得 `unknown-key{extension, key}`，值不合 schema 得 `invalid-value{extension, key, message}`，有一项不合法就都不改。受理时给每个值有变化的组写一条 `settingsChanged`（按生效值比：扩展的项先合并 schema 的缺省值，与缺省相同的不算变化；值没变的项不写），运行中受理的同样立刻写，下一次请求前生效（`scheduled: "next-boundary"`，空闲时 `"now"`）。`settingsChanged` 只派发给设置所属的扩展的处理函数。
32. `setTitle` 去掉首尾空白后为空得 `empty-title`，否则写 `titleChanged{by: "user"}`；`archive` 写 `archived`。快照的 `title`、`archived` 随之变化。
33. 输出 29–32 的指令与 `send` 一样按 `commandId` 幂等（[`harness/session.md`](session.md) 输出 17）。受理批写失败的那条指令得 `log-broken`（不抛错），之后的指令同样（`session.md` 输出 12）。
34. 打开会话时恢复没收口的运行（`session.md` 输出 15）：最后一条回复里没有结果的工具调用，写过 `toolStarted` 的得 `unknown`、码 `interrupted`，还没开始的得 `denied`、码 `interrupted-before-approval`、`by: "core"`；之后是发出没回复的模型请求（各种用途：对话、审批钩子与压缩方法发的）逐个 `modelFailed{interrupted}`、`turnEnded`、`runEnded{interrupted}`，同一个写入批，就绪的话也在这一批转成留着（`inputHeld{cause: {end: "interrupted"}}`）；不自动发出。

会话树与 Profile：

35. `rewindTargets()` 列出当前路径上的回退目标，按路径顺序：`before-turn`（一次运行的第一轮回到 `runStarted` 之前，后面的轮回到上一轮结束处）、`after-step`（这一轮某次模型请求之前，第一次就是用户的话之后）、`after-turn`（这一轮结束处；也是运行的最后一轮时落在 `runEnded` 上）。`rewind(to)` 只接受这些目标：有运行在跑得 `running`，`to` 不是会话里的节点得 `unknown-node`，不是目标（或为 null）得 `invalid-target`；受理时写 `leafChanged`。回退之后路径上的事件、path 片与对话回到目标处，session 片、缓冲区与设置不变。
36. 回退到运行中途时（`after-step`，或运行中某一轮之前），那条分支上的运行暂停：没有循环在跑，快照的运行状态是 `idle`，按空闲算（暂停期间排进来的话照输出 3 处理）。能接着跑它的发出者（用户；别的发出者只能接着跑自己开的，同输出 4）`start`、`resume`、`send` 时让它接着跑，写 `runResumed{runId, by}`（停在两轮之间时先取就绪的第一条开一轮）；不能接着跑它的发出者：`send` 的话按空闲时排的留着（`cause: {queued: "idle"}`），去向 `held`，不放行、不开运行；`resume`、`release` 得 `not-allowed`；异步回答留着（`cause: {queued: "idle", code: "not-allowed"}`）。接着跑之后的模型请求（`modelStarted`）与原来那次是兄弟节点，新旧回复各挂在自己那次请求下面，这就是重试与 swipe。重试之后 `runResult`、`waitRun` 取这次运行最后写下的 `runEnded`，只算它所在路径上的回复与用量。叶子由 `leafChanged` 定时重开会话不当作崩溃恢复。`rewind{resend}` 回退后把这条话以发出者的身份入队：目标在运行外就开新的运行，在运行中途就让暂停的运行接着跑（先取这条话，写 `runResumed{by}`；权限同接着跑暂停的运行，输出 108）。它不放行留着的话：留着的是在别的上下文里排的，继续留着。
37. `switchBranch(node)` 落到 `node` 所在子树里最近写入的末端；`siblings(node)` 给出与它同一个父节点的节点，各带所在分支的末端。`fork({leaf?})` 把到 `leaf`（缺省当前叶子）为止的路径复制成新会话，会话头的 `origin` 记来源、`profile` 是当前的 Profile、`caller` 与 `questions` 照抄（复制过去的待处理提问仍归同一个父会话应答），带上设置，不带缓冲区与标题；原会话不变。新会话的 id 由来源会话与 `commandId` 定：原会话的受理没写下就失败或崩溃时，重发同一个 `commandId` 交回同一个新会话，不多建。三者在有运行在跑时得 `running`。
38. `changeProfile(profile)` 只在没有运行在跑时（否则 `running`）：解析不到得 `unknown-profile`，装配缺依赖得 `dependency-missing{extension, dependency}`、成环得 `dependency-cycle`，其余装配错误得 `profile-invalid`。新装配的 Profile 哈希与当前相同时 `changed: false`、不写日志；不同时写 `profileChanged{reason: "user"}`；写下之后才摘下旧扩展、按新装配从日志重新归约全部状态（`mount` 失败的标记清空）、装上新扩展，并等装上写的外部事实落盘再返回；写失败时得 `log-broken`，内存里的装配不变。之后交给宿主的上下文（建资源、建工具实现）是新 Profile，已建的工具实现释放后按新上下文重建；已提交的轮按新 Profile 重新渲染（[`harness/profile.md`](profile.md) 输出 11）。重开会话按最后一条 `profileChanged` 解析 Profile。

等用户：

39. 审批钩子判定 `ask` 时，写 `interactionRequested{kind: "approval", callId, request: {tool, args, effect, reason?, remember?}, async: false}`，这次调用停下等应答（这条回复的调用先都问完再执行，见输出 79），运行状态是 `waiting{pending}`。应答 `allow`、`allow-session` 时照常执行，`toolStarted.approval.by` 为 `user`；`allow-session` 同一个写入批里写 `approvalRemembered{tool, scope, rules?, by}`：钩子的 `ask` 结论带 `remember` 时它进请求，这里是 `scope: "rule"`、`rules` 为它（内核不解释）；`remember` 是 `false` 时应答 `allow-session` 得 `invalid-answer`；没有时 `scope: "tool"`，记整个工具。它是 session 事件，回退与重开都不撤销，审批钩子从 `info.remembered`、`info.rememberedRules` 读到。钩子的 `ctx.context` 是工具拿到的同一份会话上下文；拒绝的 `rejection.params.reason` 拼进给模型的结果。应答 `deny` 时调用得 `denied`、码 `user-denied`、`by: "user"`，应答的 `note` 附在给模型的文字里。没有等用户的通道时（例如没有界面的单次请求）判定 `ask` 的调用得 `denied`、码 `approval-unavailable`。
40. 工具的 `ctx.ask(request, {async?})`：同步提问写 `interactionRequested{kind: "question"}` 并等，应答 `answer` 交回 `{kind: "answer", text, data?, by}`（`by` 是应答者：用户，或 `questions: "caller"` 时的父会话），`deny` 交回 `{kind: "unavailable", code: "declined"}`，运行被中止交回 `code: "aborted"`。异步提问写下事项（`async: true`）就交回 `{kind: "unavailable", code: "async"}`，不进 `waiting`。
41. `resolve({id, decision, answer?, note?})`：事项不在当前路径的待处理里时，路径上已经结算过的得 `already-answered{by, decision}`，其余（含被回退掉的分支上的）得 `unknown-interaction`。审批只收用户的应答；提问用户都能答，会话头 `questions: "caller"` 时也收 `caller` 那个父会话的；其余得 `not-allowed`。`decision` 不合事项的种类（审批：`allow`、`allow-session`、`deny`；提问：`answer`、`deny`），或 `answer` 缺少、文字为空，得 `invalid-answer`。会话只读时得 `read-only`。受理时写 `interactionResolved{id, decision, by, data?, note?}`，`by` 是发出者。同一事项的几次应答由单写者裁决：先到的生效，后到的得 `already-answered`。
42. 异步提问的回答：同一个写入批里写 `interactionResolved`、按输出 105 放行应答者能放行的，并把回答的文字作为一条输入放进缓冲区（经输入拦截链，拒绝时得 `input-rejected`、不写日志）；运行中是就绪的 `steer`，空闲时开新的运行（或让应答者能接着跑的暂停的运行接着跑；不能接着跑时见输出 36）。空闲而开不起运行时（只读、模型解析失败等），回答照样结算、`resolve` 成功，不放行，这句回答留着，`cause` 是 `{queued: "idle", code: 开不起来的码}`。
43. 运行被中止时，等待中的同步事项写 `interactionResolved{decision: "aborted", by: {kind: "kernel"}, code: "aborted"}`，等审批的调用得 `denied`、码 `aborted`；中止之后才到的应答得 `already-answered{by: "kernel", decision: "aborted"}`。进程重启后打开会话时，同步事项写 `interrupted`（审批码 `interrupted-before-approval`，提问码 `interrupted`），调用按输出 34 结算。异步提问不随中止、关闭会话、重启结算，重开后照样能应答。
44. 同一条回复里几个调用的事项可以同时待处理、任意顺序应答；`waiting.pending` 列出全部（`{id, callId, kind}`，请求原文只在经出站过滤的 `interactionRequested` 里），都应答之后运行状态回到 `running`。
45. 发出者由宿主注入：`session.as(issuer)` 交回带这个发出者的会话视图，指令里没有发出者参数；不经 `as` 的视图是用户。内核相信宿主给的发出者，宿主要按调用方如实盖章（NeuroBook 的规则见 [`agent/sessions.md`](../agent/sessions.md)），权限（输出 108）以此为前提。

压缩（压缩方法与放回的内容由宿主经 `SessionEnv.compaction` 交进来）：

46. 每个边界在取走 steer 之后估算上下文：上一次回复的用量（服务商给了 `totalTokens` 用它，否则 `input + cacheRead + cacheWrite + output`；它之后压缩过的，取压缩的 `tokensAfter`）加之后路径上新增的对话事件（按 UTF-8 字节数每 3 字节一个 token 估算，被省略的条目按占位算）。超过触发点（模型端口给了 `compactAt` 用它，否则模型窗口 − max(窗口的 15%, 16,384)（预留量最多取窗口的一半，小窗口的模型不会算出负数）；两者都没有时不按阈值压缩）时先压缩再算请求；Profile 写 `compaction: false` 时不压缩。压缩失败只诊断 `compaction-failed`，请求照发。
47. 方法按 Profile 的 `compaction.onThreshold` 或 `onOverflow` 依次调用，没写时取 `SessionEnv.compaction.order`，都没有时这次压缩失败；内核不认识任何方法名，实现取自 `SessionEnv.compaction.methods`，没有的算失败。手动压缩用 `onThreshold`。每个方法经压缩拦截链（出错时跳过这一层）；它拿到的 `CompactionJob` 带原因（`threshold`、`overflow`、`manual`）、压缩前的请求（`purpose: "compaction"`，和对话请求同一算法：会话的模型与推理档，跳过本次运行已撤回的扩展）、合法切点（对话里还在的每一轮的 `turnStarted`，与进行中这一轮每一步的回复，各带保留下来的 token 估算）、压缩前的 token 估算、要求（Profile 的 `compaction.require` 加 `compact` 的要求）、`model`（发出的请求 `purpose: "compaction"`，经模型拦截链，写 `modelStarted`、`modelEnded`；选项 `sessionModel: true` 时按对话请求解析模型，记录的用途不变）与 `modelInfo`（同样的选项，交回这次会用的模型的窗口与输出上限，解析不到是 null）。方法交回 `{failed}`，或结果不合格（不是对象、缺字段、`method` 不是真正调用的那个、切点不在合法切点里、省略的条目不在对话里或占位为空、token 不是有限的非负数、`details` 不是 JSON，诊断 `compaction-invalid`）时换下一个；全部失败时不写压缩事件。压缩前的请求算不出来时（Profile 出错、请求不合格）这次压缩直接失败，不拿空请求去压缩。切点的保留量与压缩前的估算里，被省略的条目按占位算。
48. 有一个方法成功时，同一个写入批里写 `compaction{method, firstKeptEntryId, replacement, omitted, tokensBefore, tokensAfter, details?, restored?}` 与放回的内容：`SessionEnv.compaction.restore(context, {signal, method, replacement, path, contextWindow})` 交回 `{notices, restored?}`，`notices` 的每一段写一条 `notice{code: "restored"}`（位置章按写入时的轮），`restored` 进压缩事件，不进请求。`path` 是压缩前的路径。放回参数另有 `kept(entryId)`：这条事件在压缩之后是否仍在上下文里，宿主用它跳过仍在上下文里的内容、不放第二份（[`agent/skills.md`](../agent/skills.md) 输出 16）。
49. 压缩之后的对话：切点之前的已提交轮去掉，摘要（来源 `{kind: "summary", compactionId}`）排在剩下的已提交轮前面（`<History last>` 只要最近几轮时不放摘要）；切点在进行中这一轮里时，这一轮的输入与附带内容留着，切点之前的步去掉；`firstKeptEntryId` 为 null 时已提交的轮与进行中这一轮的步都去掉；`replacement` 为 null 时留着上一次的摘要。`omitted` 的条目渲染成占位（消息与工具调用照样在），含有它们的已提交轮重新渲染一次。写了 `resetOnCompaction` 的片回到初始值，`opening()` 重读开场。回退到压缩之前时路径上没有它，对话就是压缩前的。
50. 模型失败、类别是 `context_overflow` 时：写下这次的 `modelFailed`，按溢出的顺序压缩，成功就把请求再发一次（新的 `modelStarted`）；每次请求最多重发一次，压缩失败或再次溢出时运行以 `error{kind: "context_overflow"}` 收口。
51. 压缩中被中止（方法返回前后、写入之前）不写压缩事件，运行以 `aborted` 收口；方法、压缩拦截或放回内容的回调不理会中止信号时内核不再等它们，之后它们的写入被拒绝。
52. `compact({requirement?})`：会话只读得 `read-only`，压缩用的模型解析不到得 `no-compaction-model`。空闲时开一次只压缩的运行（`runStarted{kind: "compact"}`，成功值 `scheduled: "now"` 与 `runId`）：对话里没有可切的地方得 `nothing-to-compact`，全部方法失败时运行以 `error`、码 `compaction-failed` 收口。只压缩的运行不取输入：期间到达的话按输出 104 处理，用户的话压完接着跑。有运行在跑（或叶子上有暂停的运行）时成功值 `scheduled: "next-boundary"`，这次运行的下一个边界以 `manual` 压缩（几次的要求合在一起）；要求只属于受理时的那次运行，它没到下一个边界就结束时丢掉，别的运行不会拿到；这个要求不进日志，进程中断就丢，重发同一个 `commandId` 得到第一次受理的值。只压缩的运行受理时查压缩的模型，对话模型不可用时照样能跑：压缩前的请求按压缩的模型算，要会话模型的方法解析不到而失败，换下一个。

宿主面：

53. `closeSession(session)` 依次：之后的指令得 `session-closed` → 中止在跑的运行并等收口 → 等队列清空 → 按装配序的逆序调用 `mount` 的清理并等待 → 释放工具实现 → 清空订阅 → 关闭日志与锁。关闭开始时还在受理的指令（例如输入拦截还没返回）得 `session-closed`，不写日志、不开运行；进行中的重新装配先做完，它装上的扩展随后一起摘下。重复与并发的调用等同一次关闭完成。关闭之后（或扩展摘下之后）`mount` 里再写的外部事实不进日志，只诊断 `late-result-dropped`。`closeSession(session, {reason: "interrupted"})` 是进程收尾：在跑的运行按 `interrupted` 收口（轮、运行、发出没回复的模型请求、写过 `toolStarted` 没完成的工具 `unknown{interrupted}`、还没开始的工具与等审批的事项 `denied{interrupted-before-approval}`），与重开时的恢复一致（[`harness/session.md`](session.md) 输出 16）；宿主经 `onProcessInterrupt`、`onProcessTermination` 在退出前调用它。两种关闭时缓冲区都按输出 104 处理：就绪的话随收口转成留着，不清空（不带原因时 `cause` 是 `{end: "aborted", code: "session-closed"}`）；推迟到收口的指令不开运行。
54. `SessionEnv.outbound` 在推帧与日志查询之前调用：`log` 帧与 `log()`、`path()` 查询的事件经 `outbound.event(event, reader, context)`，`delta` 帧经 `outbound.delta(frame, reader, context)`，`reader` 是这个会话视图的发出者（`session.as(issuer)`）；返回 null 的不给这个读者。`context` 带会话 id 与 `toolCall(callId)`（这次调用实际执行的参数，从中途读起也查得到）；增量的 `context.before` 是这个订阅者此前收到的同一次请求、同一部分的原文，一个词拆在两块里时拼起来查。`mapEventContent(event, {text, args?, data?})` 按字段走遍内核事件里带内容的地方（用户的话与原文、回复与半截回复、工具参数与结果、收尾结果、提问与回答、压缩摘要、标题），扩展事件整份交给 `data`。过滤可以是异步的（返回 Promise，例如要查书库判断一个词读者读到过没有）：日志查询按日志顺序逐条等，订阅的帧按到达顺序排成一条队列、过滤完再交给订阅者，先后不变；过滤函数抛错或 Promise 失败时不给看，诊断 `outbound-filter-threw`。取消订阅或会话关闭之后，已排进队列的帧不再交出；订阅者抛错（有没有出站过滤都一样）只诊断 `subscriber-threw`，不打断这一批的提交，后面的订阅者与帧照常。被过滤掉的事件在订阅里推 `progress{through}` 帧，界面等指令的 `seq` 时 log 帧的 seq 或它追到就算追上；增量按订阅者重新编号，过滤掉的不占号。`log({afterSeq, limit})` 的 `head`、`more` 按读取开始的那一刻算（过滤期间新写下的事件不算这一页），`through` 是这一页扫描到的最后一条 seq（被过滤掉的也算），下一页从它接着读；整页被过滤时 `events` 为空、`through` 照样前进。`limit` 缺省 500，取整后夹在 1 到 2000 之间。出站过滤只管日志事件与流式增量：运行结果、预览、诊断、快照与 `rewindTargets()`、`siblings()` 不经过它，宿主给不同读者暴露这些时自己投影（运行状态里等用户的事项不带请求原文）。
55. `preview()` 算下一次请求（`fidelity: "next"`）：跑视图与模型拦截链（`ctx.phase` 为 `preview`），最里层截下请求，不发给模型、不写日志。预览当前叶子时，把下一个边界确定会取走的就绪的输入投影进去（两轮之间取就绪的第一条开新的一轮，一轮进行中取全部就绪的 steer）；留着的不投影；在跑的工具的结果、边界上可能触发的压缩不投影。请求的冻结、拦截返回值的校验与失败策略同真实请求：一层原地改请求按这一层失败、跳过，失败与超时交在结果的 `diagnostics` 里（不写日志）。结果有拦截之前与之后的请求、每一层改了什么（`changes`，按每层交出与收到的比较：系统块、消息的插入与删除（按两边相同的前后缀对齐）、消息的内容块与其余字段、参数、头、工具与顶层字段）、每个槽的贡献有没有摆进请求、没参与的扩展（`mount` 失败、运行中被撤回）、各区（系统、开场、历史、这一轮、工具）的 token 估算（含工具调用的参数）与触发点。`preview({atRequest})`（过去的请求）与算不出请求时抛 `PreviewUnavailable`（带码）。
56. `complete(env, {profile, input, initial?, signal?})` 不经会话、不读写日志：Profile 声明了工具得 `profile-has-tools`，解析不到得 `unknown-profile`，模型端口解析失败得它的码（同输出 5）；请求只有 Profile 的系统提示词与输入这一条用户消息，`purpose: "background"`；结果同运行结果（没有 `runId` 与条目范围），模型失败按 [`harness/models.md`](models.md) 的类别交回。
57. 插件宿主 `createAgentHost(env)` 接收 `agent.extensions` 贡献：`prepare` 否决 id 不合规则或前缀与所属插件不符（`bad-extension-id`）、重名（`duplicate-extension-id`）、声明的依赖成环（`dependency-cycle`），抛 `ExtensionRejected` 并记进宿主的诊断；`published` 之后新开的会话装上它（声明了 `install: "on-request"` 的只装到引用它的 Profile，[`extensions.md`](extensions.md) 输出 32），已打开的空闲会话立刻重新装配；重新装配（含装上扩展）做完之前不受理指令，运行中排下的重新装配从这次运行收口那一刻起算（之后到达的指令都等它），`pendingReassembly` 在做完之前一直列出这次的变化；推迟到收口的指令在有待做的重新装配时不开运行（输出 104）。`revoke` 幂等，只撤回传入的这个句柄的贡献：旧代次的句柄重复撤回不影响同 id 的新代次；交回的 Promise 在各会话摘下它（清理函数跑完，运行中的等这次运行结束）或关闭之后完成，平台在这之后释放插件自己的资源。运行中撤回时，这次运行里跳过它的处理函数、拦截与槽（快照里状态 `revoked`，诊断 `extension-revoked`），已经在链里、还没走到它那一层的拦截也跳过，进行中的处理函数的输出丢掉（诊断 `late-result-dropped`），它在 `mount` 里拿着的 `ctx.signal` 立刻触发，之后的外部写入与回调不再生效；`pendingReassembly` 列出待装配的变化，运行结束后重新装配。重新装配的结果哈希变了写 `profileChanged{reason: "plugin-added" | "plugin-removed" | "plugin-updated"}`；装配失败（例如依赖被撤回）时会话进只读，码 `dependency-missing`；依赖补回、重新装配整个做完（写下 `profileChanged`、装上扩展）后解除，中途写失败不解除（别的原因的只读留到重开）。宿主在重新装配中途失败（建资源、建工具上下文）时会话进只读，码 `reassembly-failed`，诊断同名，重开以日志为准。`profilesChanged(keys)`：用这些 key 的打开着的会话按当前的 key 重新调 `profiles.resolve`、重新装配，时机与等待同上（运行中的等这次运行结束，与扩展变化攒在一起做，`pendingReassembly` 带 `profile: true`）；哈希变了写 `profileChanged`：Profile 自己的 `version` 变了是 `reason: "code-updated"`，否则按扩展的增减；没变也换上新的 Profile 对象、不写日志。解析不到时会话进只读 `unknown-profile`、保留当前装配，这批扩展增减照样处理；之后的每次重新装配（不论是否带 `profile`）都重新解析，解析成功并装配完才解除，回到丢之前的只读原因（例如 `tools-missing` 仍只读）。解析时宿主抛错进只读 `reassembly-failed`。等解析期间用户 `changeProfile` 换了 Profile 时，这次结果作废、按新的 Profile 重来。打开时就解析不到 Profile 的会话（占位装配）不受它影响，要重开。打开时解析得到、只是依赖缺失（或引用缺失）的会话也先装着占位、进只读 `dependency-missing`；提供方晚到后的重新装配先重新解析出真的 Profile 再装配，跟日志里最后记的哈希比，相同不写日志、不同写 `code-updated`，不会拿占位解除只读；这期间 Profile 又解析不到时留在只读、不写日志。开着的会话重新解析出的新版 Profile 装不上（例如新引用了还没提供的扩展）时进只读 `dependency-missing`，之后的重新装配先重新解析、装上新版才解除，不拿旧版解除。打开时宿主解析或装配抛错：打开失败、放掉日志句柄与会话锁，修好后能重开。会话还在建或在打开时到达的扩展发布与撤回、`profilesChanged`，在它建好或打开之后补做一次。
58. 工具结果可以带图片：`ToolResult` 与 `toolResult` 事件有可选的 `images`（`{data: base64, mime, width?, height?}` 的列表），重开与 fork 后一致；组请求时工具消息在文字后附图片块。条目被压缩省略时只发占位、不附图；Profile 的自定义渲染只换文字，图片照附。
59. 工具拦截与图片：结果标了 `redacted` 时图片不写进日志；判断结果被改写时文字与图片都比（图片按 `data` 的哈希）；改写未脱敏时原图记在 `rawImages`，脱敏时 `rawHash` 把图片算进去，没有图片的结果 `rawHash` 算法不变。出站过滤不改图片的字节，只能整块保留或去掉。
60. 图片的 token 估算（输出 46 与 `preview()`）：每张按 宽 × 高 / 750、至多 1,600 计，没有尺寸时 1,600，不按 base64 的长度算。
61. 模型不支持图片输入时，适配器把用户消息与工具消息的图片换成一行文字（格式、尺寸、“当前模型不能看图”）。本地推理后端（Ollama、llama.cpp、LM Studio 与本机回环地址上的服务）解不了 WebP，适配器发送前转成 PNG（PNG 超过 4 MiB 时转 JPEG），转不了时同样换成一行文字。

重发：

62. 宿主给了 `SessionEnv.retry` 时，失败的模型请求可以重发。回复的 `error.retryable` 为真、这次运行里连续重发的次数没到 `maxRetries` 时重发；否则按输出 8 收口。不给 `retry` 或 `maxRetries` 是 0 时不重发。策略每次失败时现读。连续重发的次数在写下一条回复后清零，不随重开保留。
63. 等待时间：退避从 500 毫秒翻倍、至多 8 秒；服务商要求了等待时间（`error.retryAfterMs`）时取两者较大的；服务商要求超过 5 分钟时不重发。在注入的时钟上等。
64. 每次重发前写 `modelFailed{..., retry: {attempt, max, delayMs}}`。带 `retry` 的失败表示这次运行还要接着发，它的半截内容不进请求；`runResult` 累加它的用量，但错误文字不取它。
65. 等待期间运行状态是 `running`，带 `retry: {attempt, max, resumeAt}`（`resumeAt` 是注入时钟上的毫秒），下一次请求开始后去掉。压缩与审批请求重发时 `phase` 不变。
66. 对话请求的重发回到运行循环的边界：等待结束后取走等待期间到达的 steer、处理受理的 `compact`、按当前设置解析模型、重新算请求、走完整的模型拦截链。等待不提前结束。
67. 压缩与审批的请求（`ctx.model`）同样重发，每次重新进模型拦截链；重发用完后才把失败回复交给调用方。调用方可以传自己的 `signal`：它只中止这一次请求（含重发的等待），运行继续。`complete()` 同样重发，不写事件。
68. 等待时中止：不再发，按输出 9 收口；那次失败只有一条 `modelFailed`。
69. 空回复：对话请求的回复没有工具调用、没有非空白文字，且停止原因是 `stop`、`tool`，或是 `length` 而内容完全为空时算空回复（只有思考块也算）。不写 `assistant`，写 `modelFailed{kind: "provider", code: "empty-reply", usage, partial, retry}` 与一条 `continued{by: "core"}` 的提醒，按输出 63 的退避再发，至多 3 次、也不超过 `maxRetries`；用完后运行以 `error`、码 `empty-reply` 收口。不重发时（没给 `retry` 或 `maxRetries` 是 0）按普通回复写下。

累计：

70. `SessionCore` 按日志里全部 `assistant`、`modelEnded`、`modelFailed` 的 `usage` 累计会话的费用，不分分支：`cost` 是数字就累加，是 null 就给 `unpriced` 加一。回退不减，重开后还在，日志更早的会话打开时一样算出来；fork 把复制来的路径上的用量算进新会话。快照的 `usage` 是 `{cost, unpriced}`，处理函数与拦截经 `ctx.spend` 读（[`harness/extensions.md`](extensions.md) 输出 30）。
71. 一层多次调用 `next`（可以并发）：整条链结束后，给最后发出的那次之外的每次请求写 `modelEnded` 或 `modelFailed`，它们的用量不丢。
72. `setGeneratedMeta({title?, description?})` 给宿主写自动生成的标题与说明。两项去掉首尾空白后都没有内容得 `empty-meta`。有 `title` 时：最近一次 `titleChanged` 是 `by: "user"` 就不写标题，否则写 `titleChanged{by: "auto"}`；结果 `titleApplied` 说明写没写。判断与写入在同一个受理里，`setTitle` 不会被晚到的自动结果盖掉。这条指令只给宿主，不进远程合同（内核的 `hostOnlyCommands`）。
73. 有 `description` 时写 `descriptionChanged{description}`（会话级控制事件，经出站过滤的文字映射）；快照的 `description` 随之变化，没写过时为 null。
74. `fork` 出的新会话不带说明，也不带“用户改过标题”的记录。
75. 模型端口的 `resolve` 在算视图与反应的环境时抛错（宿主正在停止、服务已撤回）：环境里按未知模型算，写诊断 `model-resolve-threw`（每个会话一次），运行照常收口。`closeSession` 的任何一步抛错，日志与锁都照样关闭，错误之后再交给调用方。
76. 帧 `{type: "tool", callId, status}`：工具调用执行完时推，不进日志；权威仍是这批调用的 `toolResult`。中止宽限期过后才完成的调用不推（输出 25）。`toolArgs` 增量的第一块带 `tool`（工具 id），同一 `callId` 的片段按 `n` 连接就是参数的 JSON 文本。
77. 快照带 `model`：`{ok: true, id, contextWindow, efforts}`（端口给了推理能力时另带 `reasoning`、夹取后的 `effectiveEffort` 与它的来源 `effortSource`，以及这次解析走的角色 `role` 与它的默认档 `defaultEffort`（界面“用默认”回到哪里按它们定，不自己推），规则见 [`models.md`](models.md) 输出 12）或 `{ok: false, code}`，由 `models.resolve` 按当前设置算；失败时端口给了的 `role`、`provider` 原样带上（[`models.md`](models.md) 的 `ModelResolution`）；`usage` 除费用外累计 `input`、`output`、`cacheRead`、`cacheWrite`，口径同输出 70。
78. `ToolSessionContext` 带 `background`；会话头有 `owner` 时也带 `owner`（同会话头，[`session.md`](session.md) 输出 25）。
79. 同一条回复的调用先过审批阶段再执行：切段之前按调用顺序逐个判定，判定 `ask` 的都写 `interactionRequested`（运行状态 `waiting{pending}` 列出全部），等全部应答；之后才执行，这条回复里不用审批的调用也等这个阶段结束，执行顺序不变。应答 `deny` 的调用轮到时得 `denied`，别的调用照常。拦截层改了工具或参数、和判定时不同时，这个调用按现在的重新判定，要问就按输出 39 再问一次。放行之后、轮到它之前只读或审批模式变了，也按现在的设置重新判定；已经拒绝的不重新判定。
80. `treeNodes({afterSeq?, limit?})` 按 seq 分页读所有 path 事件的结构 `{id, parent, type, seq, label?}`，不读全文，所以再大的事件也不会让树断开；一页至多 2,000 个。`label` 是用户的话、回复文字或工具名的前 80 字，经出站过滤，过滤掉的节点还在，只是没有 `label`。
81. `branchPoints()` 交回有多于一个孩子的节点 `{parent, children: [{node, latestLeaf}]}`，一次查询就能知道所有分叉。
82. 用户附件：`UserInput.attachments` 的每项是 `{kind, uri, name?, mime?, width?, height?, from?, to?}`。`from`、`to` 是它的标签在文字里的范围，由宿主算，内核不解析 Markdown，只核对范围里确实有这个 `uri`。组请求时，图片在范围处切开文字、放一个 `imageRef` 块，标签不进请求；没有范围、范围对不上、Profile 的 `render` 改写过文字的放这个事件的末尾；`render` 返回 null 时连图一起隐藏。文件有范围时留在文字里，没有时加一行地址。真发给模型之前才经 `SessionEnv.attachments.read(uri, {signal})` 把 `imageRef` 换成 `image`（拦截层与提交缓存看到的都是引用，`preview` 交回的也是，估算按尺寸）。读不到（`missing`）、发不了（`unusable`）、没给端口时换一行文字并写诊断 `attachment-unreadable`，这一轮照常。读到的图按地址缓存，保留至多 64 MB；只存完成的结果；中止时这个请求不再等，读完的结果仍进缓存；关会话时放掉。出站过滤把文字里的地址去掉时，附件一起去掉；文字改过时去掉范围。
83. 摘要（`replacement` 不是 null 的压缩）之前写下的用户消息，图片换成一行文字（名字、尺寸、地址，要看可以 `read`），当前这一轮的输入也算：不然同一轮的图撑爆窗口时，摘要写好了，重发还是原来那些图。事件没变，回退到压缩之前恢复原样。
84. 一次请求的图片（`imageRef` 与 `image`）超过 100 张时，从最旧的起换成一行文字。在拦截链的最里面做，拦截层加的图也算，`modelCaller` 的请求也走；`preview` 同样处理。不按服务商分。超过之后每多一张新图，请求从被换掉的那张起变化，那之后的提示词缓存失效（接受）；只聊文字时集合不变，不失效。

85. 输入记下发出者：`send`、`enqueue` 经 `as(issuer)` 以会话或宿主的身份发出时，`inputQueued` 与之后路径上的 `input`、`steer` 都写 `by`（会话 `{kind: "session", id}`，宿主 `{kind: "host", source}`）；用户发的不写 `by`，读作用户（旧日志同样）。异步提问的回答进缓冲区时，`by` 是应答者，用户应答同样不写。`inputQueued`、`input`、`steer` 另记受理它的 `commandId`；`inputConsumed` 记取走它的运行 `runId`。`rewind{resend}` 入队的话同样写发出者。`runStarted`（含只压缩的运行）、`runResumed` 记开或接着跑这次运行的发出者 `by`（规则同上，用户不写；放行开的运行记放行者）；`runEnded{aborted}` 记停的人 `stoppedBy`（用户写 `{kind: "user"}`，没有停的人的中止不写）。`by` 不进给模型的请求；给模型的来源说明由宿主的 Profile 渲染。
86. （已删除）
87. 调用的唯一身份：工具拿到的 `ToolContext` 有 `invocation`，即这次调用 `toolStarted` 的 `invocation`，全局唯一（调用 id 只在同一条回复里不重复）。会话头的 `caller` 可以带 `invocation`（[`session.md`](session.md)）。
88. 指令交回运行：`send` 的 `runId` 仍是这次开始或接着跑的运行；入队进在跑的运行时 `runId` 为 null，另交回 `currentRunId`（那次运行）。`enqueue` 在会话有在跑或暂停的运行时交回 `currentRunId`。话最后由哪次运行取走以去向（输出 110）与缓冲区事件为准，不按 `currentRunId` 认。`resolve` 交回受理后接着跑的运行 `runId`（被叫醒的、回答插进的、开或续的），没有时不给；运行不再取输入时的异步回答推迟到收口，也不给。
89. 内核调模型端口的 `call` 时另给这次调用的说明：会话 id、请求序号与请求哈希（与这次的 `modelStarted` 的 `request`、`hash` 相同）、所在的轮（轮 id、这一轮在当前路径上的序号；开这一轮的是用户的话时还有那段话；轮外不给）、改过这次请求的扩展（只算这一次 `next` 经过的那几层，一层调两次 `next` 时两次各算各的；`modelStarted.modifiedBy` 同样按此）；`complete()` 的调用没有说明。说明里还可以带一个观察者，由宿主包在端口外面时传进去，适配器把它拿得到的线上事实交给它（[`models.md`](models.md) 输出 20）。不认识说明的端口照常工作。（planned）
90. 代码调用的入口：声明 `invokes: true` 的工具执行时，`ToolContext` 有 `invoke(tool, args, {signal?, onWaiting?})`，交回这次调用的结局 `NestedOutcome{status, text, code?, details?, images?}`，`status` 必填，是 `ok`、`error`、`denied`、`blocked`、`unknown` 之一；`invoke` 不抛，受理不了的也以结局交回。`onWaiting(true)` 在这个嵌套调用开始等用户应答（输出 94 的审批或同步提问）时调，`onWaiting(false)` 在应答到了时调。没声明的工具拿不到 `invoke`。经 `invoke` 发起的调用（嵌套调用）拿到的 `ToolContext` 没有 `invoke`，另有 `within: {tool, invocation}`（父调用的工具 id 与 `invocation`）。嵌套调用的 `ToolContext` 另有 `waitingForUser(promise)`：promise 未结算期间这个嵌套调用算在等用户，调 `onWaiting(true)`，promise 结算或这次调用被取消时调 `onWaiting(false)`；这次嵌套调用结算时还没收回的等待一并收回，同一个嵌套调用的 `onWaiting(true)` 与 `onWaiting(false)` 总是成对（planned）。
91. 嵌套调用的身份：每个嵌套调用受理时得到一个全局唯一的 id，与任何调用的 `callId` 都不同；它的 `ToolContext.callId` 与 `invocation` 都是这个 id，事件、审批与提问的事项、恢复都按它关联。
92. 准入：按调用这一刻的生效工具集判，审批等到之后、执行之前再判一遍（等的时候工具可能被移出）；放行之后在排队等执行（输出 98）时只读或审批模式变了，按现在的设置重新判定，要问就再问，已经拒绝的不重新判定（同输出 79）。目标不在生效工具集得 `error`、码 `unknown-tool`；是收尾工具、声明了 `invokes`、或声明 `codeCallable: false` 的工具得 `error`、码 `invoke-not-allowed`；参数不是能如实写进日志的 JSON（[`session.md`](session.md)“事件”一节的“值”）得 `error`、码 `invalid-arguments`。之后照输出 18 校验参数、只读模式、调审批钩子，钩子的 `ApprovalCtx` 多一个 `within`。
93. 只走代码的工具：声明带 `global: {object, method}` 的工具不进请求的工具清单与 Profile 看到的工具列表，也不进 `notice{tools-changed}` 的文字（只有这类工具变了时只写 `toolsAnnounced`、不写提醒），照样进 `toolsAnnounced`（条目标 `code: true`）；模型直接发起的调用指向它得 `error`、码 `code-only`。
94. 嵌套的询问与提问：审批钩子判 `ask` 时立即写 `interactionRequested{kind: "approval"}`，事项带 `within` 与嵌套调用的 id，等应答后才往下走，不并进输出 79 的批量阶段；运行状态 `waiting{pending}` 列出它。嵌套工具经 `ctx.ask` 提问时事项同样带 `within`。应答的规则同顶层（输出 39、40）。
95. 改派之后：拦截层把嵌套调用改成别的工具或参数时，对最终的调用再判一遍输出 92 的准入与参数；改成 `concurrency` 与原工具不同的工具得 `error`、码 `invoke-not-allowed`。顶层调用被改派到输出 93 的工具得 `code-only`。
96. 嵌套调用的事件：开始执行时写 `nestedToolStarted{id, within, tool, args, approval: {by}}`。每个嵌套调用（包括没开始的）有且只有一条 `nestedToolResult{id, within, tool, args, status, code?, by?, preview, size, imageCount?}`：`args` 是实际执行的参数，没开始的是调用方传入的，其中超过 2 KB 的字符串截成前 2 KB 并注明总字节数，截过时两种事件都带 `argsClipped: true`（界面据此不按参数算增删行数）；`preview` 是结果文字的前 2 KB（按 UTF-8 字节，不切断字符），`size` 是全文的字节数，`imageCount` 是图片张数（没有不写）；全文、`details` 与图片不写进日志。两种事件都是 path 的 ctrl 事件，各自单独成一个写入批。
97. 嵌套调用不进请求：组请求不投影输出 96 的事件；`toolStarted`、`toolResult` 里没有嵌套调用，按它们归约的扩展看不到嵌套调用（要看的扩展按事件名订输出 96 的事件）；压缩时放回最近文件把嵌套调用成功读写的文件算在内；父调用的 `toolResult` 照常。出站过滤（输出 54）对这两种事件，`args` 按工具参数、`preview` 按工具结果交给 `mapEventContent`。
98. 嵌套调用的并发：同一个父调用的嵌套调用里，`shared` 的并发执行；`exclusive` 的等这个父调用在途的嵌套调用都结束才开始，执行期间不开始别的。排队时被取消（调用方给的 `signal`、父调用收口）的调用当场出队，不挡排在它后面的。经 `waitingForUser` 等用户期间仍算在执行：之后的 `exclusive` 调用等它结束（planned）。
99. 嵌套调用的上限：一个父调用至多 2,000 个嵌套调用，之后的得 `error`、码 `invoke-limit`。
100. 嵌套调用的收口：嵌套调用的中止信号是运行的信号与 `invoke` 传入的 `signal` 合并。信号触发后按输出 25 的宽限期结算这个父调用在途的嵌套调用（没开始的 `denied`、码 `aborted`；开始了没完成的 `unknown`、码 `aborted`；宽限期之后到的只诊断 `late-result-dropped`），结算写完 `invoke` 才交回。父调用的执行交回时还有在途的嵌套调用，同样结算之后才写父调用的结果；之后再调 `invoke` 得 `error`、码 `parent-finished`。
101. 嵌套调用的恢复：打开会话结算上次没收口的运行时（[`session.md`](session.md) 输出 15），嵌套调用在同一批结算：等审批的事项结算为 `interrupted`，写 `nestedToolResult{status: "denied", code: "interrupted-before-approval"}`；开始执行没有结果的写 `unknown`、码 `interrupted`；嵌套的同步提问结算为 `interrupted`。
102. 叶子移动的计数：`ToolContext.leafMoves` 是这一批调用开始时会话里 `leafChanged` 的条数；同一条回复里的调用与它们的嵌套调用拿到同一个值，回退、切分支之后的下一批变大。跨调用保留状态的工具据此判断两次调用之间叶子有没有被移动过。

缓冲区条目的状态与放行（[提案：输入缓冲区](../../proposals/agent-input-buffer-states.md)）：

103. 缓冲区的每条话是就绪或留着，状态只由会话级事件决定：`inputQueued`（缺省就绪，带 `state: "held"` 时留着）、`inputHeld`、`inputReleased`、`inputRemoved` 与取走它的 `inputConsumed`。旧日志没有这些状态，条目都是就绪的，打开时不补算。运行只取就绪的：边界取插话（输出 28）、一轮结束取排队（输出 7）、`start` 与接着跑暂停的运行（输出 4、36）、预览的投影（输出 55）都跳过留着的。快照的 `buffer` 每条带 `id`、`mode`、完整的输入（含附件）、`by`、`edits`、`state`，留着的另带 `cause` 与 `heldBy`。
104. 回到空闲：一次运行收口时（正常结束、只压缩、交出结果、文字收口、出错、停止、进程内中断、打开会话时的恢复，任何 `runEnded`），缓冲区里还就绪的话在 `runEnded` 的同一个写入批里全部转成留着：`inputHeld{ids, cause: {end: 收口方式, code?}}`，没有就绪的不写。决定收口与写下收口在单写者队列的同一项里：在它之前受理的话由这次运行取走，在它之后受理的按空闲处理，不会有话卡在空闲的会话里还是就绪的。运行不再取输入时（术语）到达的 `send`、用户的 `enqueue`、`resume` 与异步回答，开运行推迟到收口：收口的同一个写入批里依次写 `runEnded`、`inputHeld`（剩下的就绪的话，含这期间到达的），再按这些指令的受理先后写放行（`inputReleased`）并开下一次运行（`runStarted` 与第一轮；`by` 是其中的用户，没有用户时是最先受理的那条的发出者；推迟的 `resume` 不接着跑刚收口的这次运行）。（planned）送进来的话到收口时都已被取消的指令整条不生效：不放行别的话，也不算谁开的；`by` 只从真正起作用的指令里选：送进来的话还在缓冲区里、或真的放行了条目的（`resume`、`release` 这类不带话的照常），放行落空的不算。下列情形不写放行、不开运行，这期间到达的话另成一条 `inputHeld{ids, cause: {end: 收口方式, code}}`，并写诊断 `deferred-start-skipped`：开不起运行（只读、模型解析失败、解析时抛错等，`code` 是它的码，抛错时是 `internal`）；会话有待做的重新装配（`code: "reassembly-pending"`）；会话已开始关闭（`code: "session-closing"`，输出 53）。指令本身已经受理成功，不受影响。收口时有待做的重新装配，它先于之后受理的指令做完：收口那一刻之后到达的指令等它做完再受理（输出 57）。受理批或收口批写下之后、开运行之前会话已开始关闭的，不开运行，已写下的 `runStarted` 由重开时的恢复收口（同崩溃）。收口那一项写批或反应失败时，会话照样回到空闲（句柄损坏时状态保持 `broken`），`waitRun` 照样完成。
105. 放行跟着新话走：以某个发出者的身份送进一条新输入（`send`、用户的 `enqueue`、异步提问的回答）时，同一个受理批里先放行这个发出者能放行的留着的话（下表），写 `inputReleased{ids, by, mode}`，再写新输入。`rewind{resend}` 与会话、宿主空闲时的 `enqueue` 不放行。

    | 发出者 | 能放行的 |
    |---|---|
    | 用户 | 全部留着的 |
    | 会话、宿主 | 自己排的，且 `heldBy` 不是用户 |

    放行出来的排队在新话之前取（留着的先跑）；新话是插话时，它照输出 28 在下一个边界进当前这一轮，可能早于放行出来的排队。`mode` 是 `send` 的 `release` 选项（输出 107），缺省 `keep`：`keep` 各保持原模式；`followups` 都转成排队，一条一轮。放行时会话空闲就开运行（输出 2），在跑就转成就绪，按取的规则在之后的边界或一轮结束时取。
106. `resume({mode?})` 只放行、不送新话，范围同输出 105 的表，`mode` 同 `send` 的 `release`。会话空闲时：叶子上有被中断（`interrupted`）或暂停、且发出者能接着跑（输出 4、108）的运行时，先接着跑它（暂停的写 `runResumed`，中断的开“继续”运行；被停止与出错的运行不接着跑，要接着跑用 `start`），放行出来的随后按取的规则取；否则用放行出来的开新运行，第一条开第一轮。会话、宿主的 `resume` 不接着跑别人开的运行；叶子上有它不能接着跑的暂停的运行时得 `not-allowed`（输出 36）。没有能放行的、也没有可接着跑的得 `nothing-to-resume`；放行不了任何一条、而留着的话里有 `heldBy` 为用户的、发出者又不是用户时得 `held-by-user`。在跑时只放行。运行不再取输入时受理成功、放行推迟到收口（输出 104），交回的 `released` 为空、`runId` 为 null；`held-by-user` 在受理时就判。开不起运行时照输出 5 失败，话仍留着。
107. `release({inputIds})` 按条放行，权限同输出 105 的表：有一条不在缓冲区或不是留着的得 `nothing-to-release`（`detail` 带这些 id），有一条 `heldBy` 是用户而发出者不是用户得 `held-by-user`，有一条不是这个发出者排的而发出者不是用户得 `not-allowed`；有一项不合格就都不放行。空闲时放行后开运行同输出 106。`send` 另有两个选项：`release: "keep" | "followups"` 定放行出来的怎么跑（输出 105）；`replaces: [{id, edits}]` 是条件写入：每项是一条留着的话与它被改过的次数，同一个受理批里先把它们移除（`inputRemoved{by, reason: "replaced", replacedBy: 新输入的 id}`），再放行其余能放行的，再写新输入；任一项已不在缓冲区或 `edits` 对不上时，整条以 `input-stale` 失败、什么都不写；不是这个发出者能移除的（同输出 29）得 `not-allowed`。拼新输入是宿主的事，内核不看被替换的内容。
108. 指令按发出者的权限，不允许时得 `not-allowed`，不写日志：

    | 指令 | 用户 | 会话、宿主 |
    |---|---|---|
    | `edit` | 只能改用户自己排的 | 只能改自己排的 |
    | `remove`、`send` 的 `replaces` | 任何一条 | 只能移除自己排的 |
    | `release`、`resume` | 全部 | 输出 105 的表 |
    | `abort` | 能 | 会话只能停会话头 `caller` 是它的会话；宿主只能停 `runStarted.by` 是它的运行 |
    | `start`、接着跑暂停的运行、落在运行中途的 `rewind{resend}` | 能 | 只能接着跑 `runStarted.by` 是它的、且不是用户停止的运行，或会话头 `owner` 归它的会话里的（planned，同输出 4） |

    表里没有的指令不按发出者区分。应答审批与提问的规则不变（输出 41）。
109. 已经留着的话，之后再有运行收口或停止时不改它的 `cause` 与 `heldBy`；放行后再留着时按那一次重新记。
110. `send` 的成功值带这条话的去向 `placement`：`taken`（交给这次开的、接着跑的或正在取输入的运行）、`later`（运行不再取输入，收口后随放行开的下一次运行跑，输出 104）、`held`（留着：不能接着跑叶子上暂停的运行，输出 36）。这是受理时的去向：`taken` 的话在那次运行以任何方式收口而还没取走时，`later` 的话在收口批没开起运行时，都转成留着。调用方要知道最后的去向，看这条话的 `inputConsumed`（带取走它的运行 `runId`）或 `inputHeld`，或用会话视图的查询 `inputFate(inputId)`：交回 `{taken: runId}`、`{held: cause}`、`{removed: reason}`、`{pending}`（还在缓冲区里、就绪），不是这个会话里入过队的交回 null；不经出站过滤（同 `runResult`）。
111. `send` 带 `settlePending: "deny"` 时，同一个受理批里先把当前路径上全部待处理的同步事项（审批、同步提问，含嵌套调用里的；不含异步提问）以 `deny` 结算（`interactionResolved{decision: "deny", by: 用户, note: "用户发了新消息"}`，等它们的调用照输出 39、40 得 `denied`、`unavailable{declined}`），再照常受理这条话（运行中按它的模式进缓冲区，空闲时照输出 2）。只收用户发的，别的发出者得 `not-allowed`；没有待处理的同步事项时等于不带这个选项。结算与这条话同批写下，指令失败（例如 `empty-input`、`input-rejected`）时事项都不结算。重发同一个 `commandId` 照 [`session.md`](session.md) 输出 17 交回第一次的结果、不再结算（重放不比较发出者：用户受理过的，换了发出者重发也交回原来的结果）。


缓冲区的提醒与唤起（planned，[提案：统一后台任务](../../proposals/unified-background-tasks.md)、[ADR 0056](../../adr/0056-background-work-providers-and-session-notices.md)）：

112. **发提醒。** `notice({text, key?, wake?})` 只给会话与宿主：它在 `hostOnlyCommands` 里，宿主应用的远程合同不把它交给用户；用户身份发得 `not-allowed`。受理批写 `noticeQueued{id, by, key?, text, wake, commandId}`，成功值 `{noticeId, replaced?}`。正文按 UTF-8 至多 32 KiB，否则 `notice-too-large`；`key` 至多 200 个字符，否则同样 `notice-too-large`；一个会话待发的提醒至多 64 条、按编码后的整条记录（含发出者）合计至多 128 KiB，否则 `notice-budget`。同一个发出者带同一个 `key` 的新提醒替换还没取走的那条：同一个受理批里先写 `noticeRemoved{ids, by, reason: "replaced"}`，上限按扣掉旧的那条之后算。任何一项不合格都什么都不写。`removeNotice({noticeId})`：用户能取消任何一条（`reason: "cancelled"`），会话与宿主只能撤回自己发的（`reason: "withdrawn"`，别人的得 `not-allowed`）；不在待发里得 `notice-not-found`，已经取走的得 `notice-taken`。提醒不过期，过时的由发出者自己撤回。`notice` 带 `senderOnly: true` 时只有发出者能撤回，用户身份撤回得 `not-allowed`，`noticeQueued` 与快照的待发提醒带上它（后台任务的回执用，[`agent/jobs.md`](../agent/jobs.md)）。
113. **取走。** 对话运行的每个边界，在压缩之后、组请求之前，把全部待发的提醒按发出的先后取走，与取插话（输出 28）在同一个队列项、同一个写入批：写一条 `noticeTaken{ids, runId}`，每条提醒一个路径事件 `hostNotice{queued, by, text, boundary}`（`queued` 是 `noticeQueued` 的 id），同一边界一起取走的提醒与插话带同一个 `boundary`；两种的先后按 Profile 的 `queue.order`（[`harness/profile.md`](profile.md)，缺省提醒在前）。于是一轮还没回复时它们是附带内容、请求里排在这一轮的新话前面，有回复之后在最后一步之后。停止受理之后到这一项的不取（同输出 30）；只压缩的运行不取；回退、换分支不改变待发的提醒。已写下的块之后不再重排。
114. **没有进行中的一轮时开什么样的一轮。** 运行进入循环时叶子上没有进行中的一轮（唤起开的运行、在两轮之间接着跑的运行），在一个队列项里依次看：有就绪的话，取第一条开一轮（同输出 4），待发的提醒在第一个边界随它带上、排在它前面；否则有带唤起的待发提醒，或这次运行是用户开或接着跑的、又有待发的提醒，开一轮没有输入的（`turnStarted{inputId: null}`），这一轮的第一个边界取走提醒；都没有就以 `completed` 收口、不发模型请求，不带唤起的提醒留着。唤起开的运行受理时只写 `runStarted`，不先写 `turnStarted`。用户的 `resume`（输出 106）没有能放行的话、也没有可接着跑的运行，但有待发的提醒时，不得 `nothing-to-resume`，开一次运行、按本条开一轮没有输入的（门按输出 117 打开）。
115. **样子。** `hostNotice` 缺省渲染成 `<system-reminder>` 包着的一行来源说明加正文：会话发的写 `[会话 <id>]`，宿主发的写 `[系统 · <label>]`（`label` 里的换行、控制字符、`[` 与 `]` 换成空格、连续的空白合成一个，截到 40 个字符，空的写插件 id），正文里的 `<system-reminder>`、`</system-reminder>` 转义。Profile 的 `render` 能换它的文字（[`harness/profile.md`](profile.md) 输出 7）。提醒不是用户的话：不算授权依据，不解除运行守卫的停止（[`agent/run-guards.md`](../agent/run-guards.md)）。
116. **唤起。** 会话空闲、门开着（输出 117）、叶子上没有暂停的运行、开得起运行（不是只读、没有待做的重新装配、没在关闭、模型解析得到），并且有带唤起的待发提醒时，开一次运行：`runStarted{by: 最早那条带唤起的提醒的发出者, wake: true}`，按输出 114 开一轮。判定在三处：带唤起的提醒受理时；每个收口批在推迟的指令之后——推迟的指令开了运行，提醒随它的第一次请求带上，不另开；重新装配做完、会话回到能开运行时。一次至多开一次。暂时开不起时提醒照样待发、保留唤起，等下一个判定点；模型设置的变化本身不触发判定。
117. **门。** 会话级事件 `wakeGate{open, cause}` 记门的开关，回退、换分支、压缩都不改它。关：对话运行的收口批里，有停止的受理、或以 `aborted`、`error`、`interrupted` 收口、或会话正在关闭或进程正在收尾（这时以 `finished` 收口也算）；打开会话时的恢复补写 `runEnded{interrupted}` 时；回退之后已受理接着跑那次暂停的运行（`runResumed`）、又在第一条路径事件写下之前中断的，重开时按中断恢复并关门。开：用户发起、并且这一批真的开起或接着跑了一次对话运行（空闲时的 `send` 与用户的 `enqueue`、在暂停的叶子上接着跑、`start`、`resume`（含只有待发提醒时的，输出 114）、`release`、用户的异步回答、`rewind{resend}`，以及收口批里按输出 104 记成用户开的后继）。被拒、开不起、去向是 `held` 或 `later` 的不开；只压缩的运行不论怎样收口都不改门。初值：新建的会话与 `fork` 出来的会话在建会话那一批写 `wakeGate{open: true, cause: "created"}`；没有门事件的旧日志按关着算。`fork` 不带来源会话的待发提醒。
118. **预览与快照。** 预览（输出 55）把当前叶子上待发的提醒按输出 113、114 的位置投影进去，不写事件、不改门；叶子上没有进行中的一轮、只有提醒时投影成一轮没有输入的；预览历史叶子时不叠当前的待发。快照带 `notices`（待发的全部提醒，含正文）与 `wakeGate`；快照里的提醒同缓冲区的输入，不经出站过滤。`noticeQueued.text` 与 `hostNotice.text` 是内容字段，日志与帧经出站过滤（输出 54）。
119. **应答的受理批写下、反应批写失败。** 应答（`resolve`、带 `settlePending` 的 `send`）的受理批写下了、它引出的反应批写失败时：回执成功（同一个 `commandId` 重发、重开之后都是这个结果）；等这个事项的调用在反应阶段结束之后按日志里的结算叫醒（健康时也是反应写下之后才叫醒，反应还在跑时它不往下走）；句柄进损坏状态（[session.md](session.md) 输出 12）。任何指令在这种情况下都不开运行，也不做要健康会话的收尾（例如换 Profile 不卸载旧扩展、不装新扩展、不清只读），重开以文件为准。
120. **停指定的那次运行。** `abort({keepQueue?, runId?})` 给了 `runId` 时只停这次运行：权限照输出 30 先判（无权停在跑的那次得 `not-allowed`）；在跑的不是它（已经收口，或已是下一次运行）得 `{aborted: false}`，不写日志、不动缓冲区、不改门；是它时同输出 30。没给时照旧停在跑的那次。任务中心停一次子代理运行时带上它，免得停到用户在子会话里刚开的下一轮（[`agent/jobs.md`](../agent/jobs.md)）。
## 状态与转换

| 运行状态 | 事件 | 下一状态 |
|---|---|---|
| `idle` | 开始运行的指令被受理 | `running` |
| `running` | `abort` | `aborting` |
| `running`、`aborting` | `runEnded` 写下、循环结束 | `idle` |
| 任意 | 写日志失败 | `broken` |

时序与寿命：

- 指令的受理（校验与写受理批）在单写者队列的一项里做；两条指令的校验看到的状态不会交错。
- 运行循环在队列之外：它每次写日志都排进队列并等写完；等模型的时候不占队列，所以运行中的入队不必等运行结束。
- 中止立刻触发信号；受理在队列里占一项，记下此刻缓冲区里的条目与停的人（输出 30 的范围），收口作为队列里的一项写入，清空或留着与 `runEnded` 同一个写入批。
- 决定收口与写下收口在同一个队列项里：运行循环看缓冲区“没有可取的了”、写 `runEnded` 与 `inputHeld`、会话变成空闲（`waitRun` 可结算、之后受理的指令按空闲判断）在这一项里一起发生（输出 104）。这一项先推这次运行的 `idle` 状态帧，收口批开了下一次运行时再推它的 `running`；这次运行之后不再推它的状态帧。
- `abort` 的权限判定、触发信号与排进受理在同一个同步步骤里（输出 30）。
- `waitRun` 完成时这次运行已经收口：没有推迟到收口的指令时会话已经空闲，紧接着 `start` 不会得到 `already-running`；收口批按输出 104 开了下一次运行时，会话已在那次运行里，它另有自己的 `runId`。
- `invoke` 从父调用开始执行起可用，到父调用的执行交回为止；嵌套调用的结果都写在父调用的 `toolResult` 之前（输出 100）。
- （planned）门只在单写者的受理批、收口批、建会话的那一批与打开会话时的恢复批里改（输出 117）：停止受理到收口之间到达的带唤起的提醒，由收口批先关门再判唤起，不会开运行；用户的话在收口批里真的开起运行才开门。
- （planned）提醒从受理到取走一直待发，取走与这一边界的插话同一批；`removeNotice` 与取走在同一个队列里排，先到的生效。

## 副作用与数据

只写日志（[`harness/session.md`](session.md)）与推帧。模型请求经模型端口发出。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `empty-input` | 输入为空 | 不发 |
| `already-running` | 有运行在进行 | 等它结束，或先 `abort` |
| `nothing-to-continue` | 没有可继续的 | 发一条新的话 |
| `read-only` | 会话只读 | 换一个能用的 Profile 或新建会话 |
| `no-model`、`no-credentials`、`unknown-model`、`role-unbound` | 模型、凭据或角色没配 | 去设置里配 |
| `log-broken` | 日志写失败过 | 关闭后重开 |
| `session-closed` | 会话已关闭 | 重新打开 |
| `command-id-conflict` | 同一个 `commandId` 带了别的指令或参数（[`harness/session.md`](session.md) 输出 17） | 每条指令用新的 `commandId`；重发才用原来的 |
| `input-rejected` | 输入拦截拒绝了这条输入；`detail` 带 `code`、`params` 与拒绝者 `by` | 按拒绝的码提示用户 |
| `not-allowed` | 这个发出者不能做这件事（输出 108） | 换有权限的发出者，或不做 |
| `nothing-to-resume` | 没有能放行的留着的话，也没有可接着跑的运行 | 发一条新的话 |
| `held-by-user` | 要放行的是用户停止时留下的，只有用户能放行 | 等用户继续；或告诉用户有话被暂停 |
| `nothing-to-release` | 指定的条目不在缓冲区或不是留着的；`detail` 带这些 id | 重新读快照 |
| `input-stale` | `replaces` 里的条目已不在或被改过 | 重新读快照、重新拼再发 |
| `notice-too-large` | 提醒正文或 `key` 超过上限 | 正文存成文件，提醒里写地址 |
| `notice-budget` | 会话待发的提醒到了条数或合计上限 | 自己留着内容（例如交给 `wait`），或撤回过时的 |
| `notice-not-found` | 要撤回或取消的提醒不在待发里 | 重新读快照 |
| `notice-taken` | 这条提醒已经随一次请求取走 | 不用再撤 |

运行以 `error` 结束时 `runEnded.error.code` 的内核码见 `runErrorCodes`（`profile-failed`、`tools-missing`、`result-missing`、`no-model`、`empty-reply`、`internal` 等）；内核造的工具结果的码见 `toolResultCodes`。

## 边界与兼容

- 公开接口：`createSession`、`openSession`、`closeSession`、`SessionApi`（`/kernel`），指令与帧的类型和码表（`/kernel/contracts`）。
- 指令与失败码只加不改；远程服务把它们逐个暴露成方法与错误码。

## 验收与 Smoke

1. 内存存储与会话目录上的 JSONL 存储各跑一遍：一轮对话的受理批与收口；第二轮的请求带上第一轮；重开之后接着聊；重发同一个 `commandId` 只生效一次（重启之后同样）。
2. 运行中入队的 followup 在这一轮结束后开下一轮，同一次运行，用量是两次回复的和；空闲时用户 `enqueue` 一条等于发送，开新运行。
3. 一条回复里两个 `shared` 工具与一个 `exclusive` 工具：两个 `shared` 同时在跑、`exclusive` 在它们都完成后才开始；结果按调用顺序写成一个批；一个扩展改了参数、审批规则据改过的参数拒绝另一个调用。
4. 一个扩展把输入脱敏、另一个把超过 16 KB 的工具结果脱敏：重开后事件一致，会话目录全文（含 `blobs/`）搜不到原文。
5. 子进程在工具执行中被 `kill -9`：重开后执行中的调用 `unknown`、没开始的 `denied{interrupted-before-approval}`、运行 `interrupted`，缓冲区里排着的 followup 还在；子进程在受理批写下、运行循环开始之前被杀：重开后运行 `interrupted`，用同一个 `commandId` 重发得到第一次的值与 `replayed: true`。
6. 子进程在等审批时被 `kill -9`：重开后这次审批结算为 `interrupted`、调用 `denied{interrupted-before-approval}`；同一次运行里先提的异步提问还待处理，应答后作为输入开新的运行。
7. 嵌套调用：一个声明 `invokes` 的测试工具在一次调用里并发调两个 `shared` 工具、再调一个要审批的写工具；拒绝之后它照样交回，日志里三条 `nestedToolResult` 都在父调用的 `toolResult` 之前，请求里只有父调用的结果；在等这次审批时 `kill -9`，重开后它结算为 `denied{interrupted-before-approval}`。
8. 停止留着、留着的先跑：运行中排了两条话，`abort{keepQueue}`，停止进行中用户又 `send` 一条：收口批里两条转成留着（`heldBy` 是用户），随后放行、开下一次运行，先跑留着的两条，再跑新话；会话身份在这次停止之后发的话开新运行时不取用户留着的两条。
9. 收口窗口：在回复批的反应期间与 `runEnded` 批的反应期间各发一条话，两条都由这次运行取走或在收口批里留着并按发出者放行，没有一条以就绪的状态留在空闲的会话里；只压缩的运行期间用户发的话，压完自动开下一次运行跑它。
10. 交出结果：子会话调用收尾工具的那一轮里，会话身份插的话 `send` 交回 `taken`，运行以 `finished` 收口后这条话留着（`cause.end` 是 `finished`），不自动开运行；会话身份再 `send` 一条时放行它、开新运行。
11. 重启：缓冲区里有就绪的话时 `kill -9`，重开后恢复批把它们转成留着；用户 `resume` 先接着跑中断的那次运行，再跑留着的；宿主身份的 `start` 对用户开的运行得 `not-allowed`。
12. 权限与条件写入：宿主与会话 `edit`、`remove` 别人排的话、宿主 `abort` 用户开的运行，都得 `not-allowed`，日志不变、运行不停；`send{replaces}` 在条目被取走、被改过时得 `input-stale`、什么都不写，替换别人的话得 `not-allowed`；成功时受理批依次是 `inputRemoved{replaced}`、`inputReleased`、新输入。
13. 停止的范围：宿主停自己开的运行（缺省清空）只删自己排的，用户排的转成留着、`heldBy` 是宿主；用户随后 `abort{keepQueue}` 同一次运行不改变它；之后再收口时已留着的 `cause` 不变；`closeSession` 两种关闭下就绪的话都转成留着。
14. 推迟的指令：只压缩的运行期间，插件撤回触发重新装配，同时用户 `send` 一条：收口批不开运行，这条话留着、`cause.code` 是 `reassembly-pending`，重新装配做完之后才受理别的指令；只压缩期间 `send` 后立刻 `closeSession{interrupted}`，重开后话留着，没有多出来的运行。
15. 停止与接着跑：用户停掉父会话开的子会话运行后，父会话身份的 `start` 得 `not-allowed`，`resume` 只放行它自己的话；用户 `abort` 后运行在宽限期内以 `finished` 收口，停止的范围照样执行；`runEnded` 批的反应期间到达的 `send` 遇上待做的重新装配，等重新装配做完才受理；受理批的反应期间开始关闭，不开运行、不留下未处理的错误。
16. 发话一并结算：一条回复里两个调用都在等审批、一个嵌套调用在等同步提问，用户带 `settlePending: "deny"` 发一条插话：同一个受理批里三个事项都以 `deny` 结算、插话进缓冲区；两个调用得 `denied{user-denied}`、嵌套提问得 `unavailable{declined}`，这一轮在边界取走插话接着请求；同一个 `commandId` 重发得到第一次的结果、日志不变。
17. （planned）提醒与门：空闲时宿主发一条不带唤起的提醒，不开运行；用户发话，请求里提醒排在新话前面；工具跑完、越过压缩阈值的那个边界，同时到达的提醒与插话都原文进下一次请求；用户停止后宿主发带唤起的提醒，不开运行，用户下一句话把它带上并开门；宿主在模型给出最终回复的过程中发带唤起的提醒，这一轮接着请求；唤起开的运行在第一个边界之前提醒被撤回，不发请求就收口；重开之后待发的提醒与门不变。

Smoke：`packages/nb-harness/tests/kernel/kernel.llm.test.ts`（`bun run test:llm`）：一轮对话、重开、再一轮；带工具调用；流式中途中止；回退后重发。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)；缓冲区条目的状态与放行（输出 103–110 及相关改动）见 [提案：输入缓冲区](../../proposals/agent-input-buffer-states.md)（2026-11-18 接受）与 [ADR 0055](../../adr/0055-input-buffer-entry-states.md)；提醒、唤起与门（输出 112–118 及相关改动）见 [提案：统一后台任务](../../proposals/unified-background-tasks.md)（2026-11-19 接受）与 [ADR 0056](../../adr/0056-background-work-providers-and-session-notices.md)；重发、费用累计与适配器的传输见 [w00032 t27](../../../.agents/works/w00032-agent-integration/tasks/t27-run-reliability/README.md)（已实现，开发者 2026-11-04 批准） 说明、`setGeneratedMeta` 与关闭时放掉日志见 [w00032 t18](../../../.agents/works/w00032-agent-integration/tasks/t18-builtin-profiles/README.md)。解析失败带 `role`、`provider`：[w00032 t36 计划](../../../.agents/works/w00032-agent-integration/tasks/t36-conversation-panel-redesign/plan.md)的“模型不可用的提示卡”，开发者 2026-11-16 确认（t36 决定 1、9）。；嵌套调用的 `waitingForUser`（输出 90、98 的 planned 部分）依据 [w00033 t03 计划](../../../.agents/works/w00033-page-agent/tasks/t03-ui-guide/plan.md)（开发者 2026-11-26 确认）
