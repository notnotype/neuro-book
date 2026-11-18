# t14 实施计划：输入缓冲区的每条话带状态

## Context

周期任务与 bot 要往会话的输入缓冲区发话，而现在缓冲区里的话没有状态：只压缩的运行、交出结果、文字收口、收口前的一瞬间、停止进行中，都有话卡在空闲的会话里，或被下一次不管谁开的运行顺手带走（[清单](evidences/kernel-path-inventory.txt) 第 1、2 节，14 条回到空闲的路径、15 处读缓冲区）。开发者 2026-11-18 选了改内核，提案三稿三轮审查后接受。

依据：
- 提案：[输入缓冲区](../../../../../docs/proposals/agent-input-buffer-states.md)（2026-11-18 接受）；[ADR 0055](../../../../../docs/adr/0055-input-buffer-entry-states.md)。
- Spec（planned，提交 5cb584b1f 与随后的 ADR 修正）：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 2–4、7、28–30、34、36、42、45、52、53、55、85、88、103–110 与验收 2、8–11；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 输出 15、18、24；[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 输出 10、15、21、22；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 6、9、47、48；[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md) 输出 10、16；[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md) 输出 3、4、11；[`agent/builtin-profiles.md`](../../../../../docs/specs/agent/builtin-profiles.md) 输出 9；[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的排队区、停止的第二个选项与乐观消息。
- 开发者已确认：提案的决策记录；t14 README 的实现定义 1–6 与第 7–11 项；界面外观见 [t03 决定](../t03-web-design/README.md) 第 20、21 项。
- 提案第三轮审查的 11 条（[处理](../t01-direction/evidences/buffer-proposal-review-r3-disposition.md)）在下面各节标注落点。

工作方式：主会话写代码，在 worktree `.worktree/w00043-t14`（分支 `w00043-t14/buffer-states`）里做；内核、NeuroBook 后端、界面三段各审一次（内核与后端派后端审查者，界面派前端审查者）；Spec 与 Task 记录只在主工作区改。

## 技术选型

- 合并留着的话时 `#N` 的重新编号：复用 nb-markdown 的提示词文字解析（`parsePromptText`、`renumberInsertion`、`promptNodeText`），在它的纯 TS 子路径 `prompt-text` 加一个公开导出“按顺序拼接几段文字并整体换号”；不手写正则（文字写法见 [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)）。
- 其余是内核与应用内部的规则，没有通用问题。

## 关键设计

### `packages/nb-harness/src/kernel/api/`：合同与事件

- `basics.ts`：`Issuer` 加 `{kind: "host"; source: {plugin; label; ref?; at?}}`；新增 `sameIssuer(a, b)`（会话按 `id`、宿主按 `source.plugin`）与 `isUser(issuer)`。所有比较发出者的地方只用它们；现有按“不是用户就读 `issuer.id`”写的地方（例如 `interaction.ts:97-98` 的提问应答）同一片改掉。
- `kernel-events.ts`：新增 `inputHeld{ids, cause, heldBy?}`、`inputReleased{ids, by, mode}`（会话级）、`runResumed{runId, by}`（路径级）；`inputQueued` 加 `commandId`、`state?`、`cause?`；`input`、`steer` 加 `commandId`；`inputRemoved` 加 `by`，`inputRemoved.reason` 加 `cancelled`、`replaced`（带 `replacedBy`）；`inputConsumed` 加 `runId`；`runStarted`（含只压缩的运行）加 `by`；`runEnded{aborted}` 加 `stoppedBy`。`cause` 的类型 `{end: RunEndReason; code?} | {queued: "idle"; code?}`。`heldBy` 是用户时写 `{kind: "user"}`（session.md 输出 24），其余 `by` 照旧“用户不写”。
- `contract.ts`、`codes.ts`（第 3 片才加，见“切片”）：`CommandMap` 加 `resume({mode?})`、`release({inputIds})`；`send` 加 `release?: "keep" | "followups"`、`replaces?: {id; edits}[]`，成功值加 `placement`；`abort` 不变（发出者来自视图）。失败码加 `not-allowed`、`nothing-to-resume`、`held-by-user`、`nothing-to-release`、`input-stale`，进 `commandErrors`。
- `host.ts`：`BufferedInput` 加 `state`、`cause?`、`heldBy?`、`commandId`；快照照此暴露。

### `src/kernel/state/kernel-state.ts`：缓冲区的归约

- 条目状态只由会话级的五种事件归约（runtime 输出 103）；旧日志 `inputRemoved.reason: "user"` 读作 `cancelled`。
- 新增 `readyEntries(buffer)`、`heldEntries(buffer)`；内核里读缓冲区的 11 处（清单第 2 节 2.1–2.10）全部改走它们，不再直接遍历 `buffer`。
- 路径归约记每次运行的 `by`、收口方式与 `stoppedBy`，以及叶子上“最后一次对话运行”的 `{runId, by, end, stoppedBy, lastTurnCompleted}`，`start`、`resume`、`abort` 的判定都读它（每条事件 O(1)，不沿路径回扫）；旧日志的 `runStarted` 没有 `by` 一律按用户。
- 不变量：留着的话不会被任何取输入的路径看到；已经留着的话不改 `cause` 与 `heldBy`（输出 109）。

### `src/kernel/run/control.ts`、`run/loop.ts`、`run/writes.ts`：回到空闲只在一处

- 新增收口函数 `settleRun`（放在 `run/settle.ts`）：在单写者队列的一项里完成“看缓冲区—决定—写批—翻转空闲”：
  1. 读就绪的条目；回复没有工具调用时，有就绪的 `steer` 就接着请求、有就绪的 `followup` 就开下一轮（输出 7），文字收口也在这里判断，都不收口；
  2. 否则组收口批：这次的收尾事件（`turnEnded`、`modelFailed` 等，由调用方给）、`runEnded`、剩下就绪的 `inputHeld{cause: {end, code?}}`；停止受理时记下的范围按 `keepQueue` 写 `inputHeld{heldBy}` 或 `inputRemoved{aborted}`（输出 30，实现定义 2）；
  3. 有挂起的放行（运行不再取输入期间受理的 `send`、用户 `enqueue`、`resume`、异步回答，输出 104）时，先查三种不开的情形：有待做的重新装配（`pendingReassembly` 非空）、会话已开始关闭、开不起运行（同 `startProblem`）；都不是时按受理先后写 `inputReleased`，同一批写下一次运行的 `runStarted{by}`（有用户记用户，否则最先受理的）与第一轮，推迟的 `resume` 不接着跑刚收口的这次；是其中一种时不放行，这期间到达的话另成一条带 `code` 的 `inputHeld`，写诊断 `deferred-start-skipped`；
  4. 写批、在这一项里把 `control` 置为空闲或换成下一次运行（实现定义 1），结算这次运行的 `waitRun`；运行尾部（状态帧、`onIdle`、结算）整体搬进这一项：先推这次的 `idle` 帧，开了下一次运行再推它的 `running`，旧运行的 `finally` 不再推帧。写批与反应放在 `try` 里，翻转、推帧、`onIdle`、结算放在 `finally` 里：写批抛 `LogBrokenError` 时状态保持 `broken`，反应抛错时照样回到空闲（`control.test.ts:306` 的场景），查模型时抛错按开不起运行、`code: "internal"`。
  5. 重新装配：收口时 `pendingReassembly` 非空的，在这一项里同步排下重新装配（置 `state.reassembling`），不再等 `onIdle`；`accept()` 在队列项里、判定之前再看一次 `reassembling`，非空就等它做完再判定（已过 `closedGuard`、排在队列里的指令也等），不让收口之后到达的指令抢在重新装配之前开运行（审查探针 N1）。
  6. 关闭：`accept()` 与 `settleRun` 共用一个“写下之后、开运行之前”的检查，会话已开始关闭就不开运行，已写下的 `runStarted` 留给重开时的恢复（审查探针 N3 的未处理错误随之消失）。
- `loop.ts` 的 25 处 `end()`、362（finished）、394（completed）与“看缓冲区决定接着跑还是收口”（378、393）都改为调用它；`recover.ts:84` 用同一个批的组装函数（没有 `control`）。收口的分支只剩一个，新加的收口方式也走它。
- `control` 加 `takesInput`：只压缩的运行、停止已受理、`settleRun` 已开始组批时为假；`send` 等指令据此判断“推迟到收口”，挂起的放行记在 `control` 上，只由 `settleRun` 消费。进程在受理与收口之间被杀时，挂起的放行丢掉，话按恢复留着（与重启留着一致）。
- `abort`：在同一个同步步骤里按输出 108 判权限（不允许就不触发）、触发信号、读下范围（这一刻缓冲区的条目 id，就绪与留着）、把受理排进队列并绑定这次运行的 id，停止记录挂在 `control` 上；收口那一项早于它时交回 `{aborted: false}`，晚于它时收口批不论收口方式都按范围处理、写 `runEnded.stoppedBy`。缺省清空只清停的人能取消的，其余就绪的留着；每个在收口前受理的 `abort` 都在收口批里写自己的 `commandAccepted`，后到的交回同样的 `{aborted: true}`、不改范围（输出 30，提案审查第 8 条）。

### `src/kernel/run/commands.ts`、`run/permissions.ts`（新）、`run/interaction.ts`、`run/tree.ts`：指令

- `permissions.ts`：一个函数按输出 108 的表判定 `edit`、`remove`、`replaces`、`release`、`resume`、`abort`、`start` 与接着跑暂停的运行；指令里不再各写各的判断。`abort` 的“会话只能停 `caller` 是它的会话”读会话头。
- 放行：`releasable(issuer, buffer)` 按输出 105 的表；`send`、用户 `enqueue`、异步回答先写 `inputReleased` 再写新输入；会话、宿主空闲时的 `enqueue` 写 `inputQueued{state: "held", cause: {queued: "idle"}}`（第 7 项）。
- `send`：成功值的 `placement` 在受理时定（输出 110）；`replaces` 的条件写入在受理项里一次校验（存在、`edits`、可移除），不合整条 `input-stale`（输出 107）。
- `start`：改为接着跑叶子上可接着跑的运行（读路径归约的“最后一次对话运行”）：暂停的运行，或最后一次对话运行（只压缩的不算）的最后一轮停在当中；不取留着的（第 9 项）。非用户只能接着跑 `runStarted.by` 是自己的、且 `stoppedBy` 不是用户的（提案审查第 2 条 (c)，计划审查探针 R2c）。会话头 `owner` 的放宽随 t06。`resume` 只接着跑中断（`interrupted`）与暂停的，被停止与出错的不接（交给 `start`）。
- `resume`、`release`：新指令，规则见输出 106、107；用户的 `resume` 先接着跑可接着跑的运行。
- 暂停的运行：接着跑时写 `runResumed{runId, by}`；不能接着跑它的发出者 `send` 时话留着、`placement: "held"`（第 8 项），`resume`、`release` 得 `not-allowed`，异步回答留着带码。
- `interaction.ts`：异步回答先放行应答者的，再放进回答；开不起运行时回答留着、`cause: {queued: "idle", code}`，`resolve` 照常成功（实现定义 3）。
- `tree.ts`：`rewind{resend}` 的 `inputQueued` 写视图的发出者，不放行（开发者 2026-11-18）；落在运行中途时按接着跑暂停的运行判权限、写 `runResumed{by}`。
- 输出 85：`input`、`steer` 带 `commandId`；`inputConsumed` 带取走它的 `runId`；`runStarted.by` 是开它的发出者（放行开的记放行者）；去掉 `inputEdited` 的 `by`。

### `src/kernel/session/`：会话面

- `session.ts`：只压缩的运行 `takesInput` 为假（输出 52、104），`compact` 的 `runStarted` 写视图的发出者；`closeSession` 两种关闭都走 `settleRun`，不带原因时 `cause: {end: "aborted", code: "session-closed"}`（实现定义 6），关闭开始后推迟的指令不开运行；`scheduleReassembly` 的 `pendingReassembly` 供 `settleRun` 判断；快照的 `buffer` 带新字段。
- `preview.ts`：只投影就绪的（输出 55）。

### `src/kit/sessions/`：宿主套件

- `meta.ts`：标题会话以宿主身份发话（`source.plugin` 由套件的使用方给），一次生成没开起运行时取消自己留下的话（实现定义 6，builtin-profiles 输出 9）。
- `table.ts`：`view(id)` 缺省仍是用户（远程合同用），`view(id, issuer)` 照旧供 `nbook.agent` 内部用（子代理、任务中心）；表的 `COMMANDS` 由 `commandErrors` 派生，第 3 片加指令时随之暴露。

### `packages/neuro-book/src/plugins/agent/backend/`：NeuroBook 后端

- `agent.ts`：`agentKey` 改为 `perConsumer` 提供（照 `src/server/running-work.ts` 的写法）：别的插件拿到的门面 `session(id, options?)`、`create` 缺省的发出者是 `{kind: "host", source: {plugin: 调用方插件（没有插件的宿主实例取实例 id）, ...source}}`，`{asUser: true}` 时是用户（开发者 2026-11-18 允许插件代替用户发），`startTask` 同样。不另做“指定会话身份”的门面：子代理与任务中心照旧直接用句柄表的 `view(id, issuer)`。测试世界（`testing/world.ts`）的 `service` 包一层 `asUser: true`，现有 28 个测试文件、85 处取视图的写法不变；另加一组用别的插件门面的测试（宿主身份、不能冒充、`asUser`），见 sessions 输出 21。
- `remote.ts`、`frames.ts`：远程合同仍是用户（开发者 2026-11-18）；远程方法加 `resume`、`release`，`send` 透传新选项与 `placement`；缓冲区条目的投影带新字段（sessions 输出 22）；`activity` 加 `held`（输出 15）。
- `jobs/steer.ts`：只认就绪的插话，`inputReleased` 里放行出来的插话算到达（jobs 输出 3）。
- `subagents/tools.ts`（`agent_send`、`runOnChild`）：送话后按 `placement` 分支：`taken`、`later` 等这条输入的结局（内核加一个会话视图上的查询 `inputFate(inputId)`，交回 `{taken: runId} | {held: cause} | {pending}`，配一个按 `inputConsumed`、`inputHeld` 推进的等待），拿到 `runId` 再 adopt 任务或写“留着”的结果；`held` 直接写结果。不带话：父会话能 `start` 就先 `start`，再 `resume`（subagents 输出 10）。不按 `currentRunId` 认任务（提案审查第 1 条）。
- `jobs/center.ts`、`subagents/children.ts`、`jobs/tools.ts`、`remote.ts`：`JobDriver.kill(by)` 带发出者，`center.kill(owner, id, by)`；远程 `killJob` 传用户，`kill` 工具与连带中止传父会话（jobs 输出 4、11，实现定义 5，提案审查第 3 条）。

### `packages/nb-agent-ui/`：适配器与组件

- `src/kernel-transcript.ts`：`queue` 的条目带 `by`、`state`、`cause`、`heldBy`、`edits` 与完整输入，归约新事件；`KernelIssuer` 扩成会话与宿主，`authorOf` 随之（宿主取 `source.label`）；乐观消息按 `commandId` 确认（`input`、`steer` 的 `commandId`），实时的 `applyEvent` 与重建的 `applyPath` 一样清，`commandAccepted` 按 `placement` 判撤销（不再看 `runId === null`），不再“撤掉最早一条”（清单 2.13）；`ahead` 由转录器按“这个 `commandId` 放行出来、还没取走的条数”现算。
- `src/types.ts`：`composer.queued` 的条目加 `author?: {label: Text; icon: string}`、`editable?`（缺省可编辑）、`held?: {reason: Text}`；`interaction.stopClearing: {count} | null`；`composer.stop` 加 `clearQueue?`；`MessageView` 的 `user` 加 `ahead?: number`。
- `src/vue/composer/AgentQueuedMessages.vue`（与 `.md`、dom 测试）：照 t03 决定 20 加“已暂停 N 条”头行与“继续”、别的发出者的来源标签、虚线框；留着的行不受 3 条限制，“还有 N 条”可点开；读屏与 status 区播报；`AgentConversationComposer.vue`（与 `.md`）：停止键旁的下拉箭头（独立按钮、nb-ui `DropdownMenu` 受控 `open`，触发器自己带 `aria-disabled` 而不用 `DropdownMenu` 的原生 `disabled`，选中后经 `contentProps` 的 `onCloseAutoFocus` 把焦点交回编辑器；这个用法记进 `DropdownMenu.md`），占位文字的新顺序与继续键（决定 21），停止中“继续”不可用。新文字进 `locales/`。
- Lab：`composer.scenes.ts` 加“留着”“停止的下拉”两个场景；英文场景放在对话视图的夹具（输入框夹具没有 `locale`），按 ui-development 的第 5 条看 390 宽；对话视图夹具的 `flushQueued` 跳过留着的条目，加一个“停止后留着”的模拟动作。

### `packages/neuro-book/src/plugins/agent/web/`、`shared/settings.ts`：NeuroBook 界面

- `session-host.ts`：把快照与转录器的缓冲区条目映射成 `composer.queued`（发出者显示名：会话取它的标题，宿主取 `source.label`；原因文案按 conversation 输出 48，`cause.code` 到说明的一张表，未知码回退）；`run.continue` 照 conversation 输出 50 的表选指令（第 11 项），“中断”用 `transcript.interrupted()`；继续是一个操作，照现有 `rewriteHistory` 的 `rewriting` 标志与 `commandIdOf(key)` 做进行中保护与固定的 `commandId`，第二步前确认运行仍是自己刚开的；`PendingSend` 加 `replaces` 与 `typed`，被拒只还原 `typed`，结果未知重发沿用 `replaces`；`composer.stop{clearQueue}` 走不带 `keepQueue` 的 `abort`；`input-stale` 只重读快照、重拼、再发一次 `send`。
- 新增 `web/resume-merge.ts`：纯函数，把用户留着的条目与新话拼成一条（按入队顺序、空一行、附件随文字），配单元测试。
- 设置：`shared/settings.ts` 声明 `nbook.agent/resumeMode`（用户层，缺省 `merge`），放进现有的“运行可靠性”分区（`RUN_GUARDS_SECTION`，conversation 输出 47）；后端 `plugin.ts` 照现有设置项登记；`web/plugin.ts` 给两个对话位置的 `SessionHostDeps` 加读设置的通道，点继续时现读；文案进 `locales/` 的 zh-CN 与 en-US。
- `session-list.ts`、`activity.ts`：状态栏活动与会话行只标只有用户能放行的留着的话（activity 的 `held`，只看打开着的会话，输出 48 的已知限制）。

## Spec 与文档改动

- 已改：见 Context 的 Spec 列表与 ADR 0055。
- 实施中：按实现补各 Spec 的实现合同与证据；`implemented` 的 Spec 里这次加的“（planned）”句子，有测试守住后去掉标记；`harness/runtime.md` 整份 `planned`，验收映射写进证据。
- 组件同名 `.md`：`AgentQueuedMessages.md`、`AgentConversationComposer.md` 随改。
- nb-markdown 的 `prompt-text` 新导出写进 [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 的公开接口；`DropdownMenu.md` 记受控打开加 `aria-disabled` 触发器的用法。
- 计划审查的处理见 [evidences/plan-review-r1-disposition.md](evidences/plan-review-r1-disposition.md)。

## 切片

| 片 | 内容（关键设计的节） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 1 | 事件与可选字段、归约（含路径归约的运行信息）、`Issuer` 的宿主种类（api、state）；`CommandMap` 与码表不动 | 只加事件、字段与读法，行为不变 | `bun run test:affected` 加 typecheck（会选到 kit 与 neuro-book 的 agent 测试） |
| 2 | `settleRun`、`takesInput`、全部收口点、恢复、关闭、重新装配的先后、停止的范围、`start` 的新语义（control、loop、recover、session） | 回到空闲只在一处 | 同上，加新的 `run/buffer.test.ts` |
| 3 | 新指令与码（`resume`、`release`、失败码进 `CommandMap` 与 `commandErrors`）、放行、`replaces`、去向、权限、暂停的运行、异步回答、`rewind{resend}`、`inputFate`（commands、permissions、interaction、tree）；kit 与 neuro-book 远程层随码表暴露 | 指令按发出者 | 同上 |
| — | 内核的实现审查（后端） | | |
| 4 | 宿主套件与 NeuroBook 后端（kit、agent backend、jobs） | 发出者如实盖章 | 同上 |
| — | 后端的实现审查 | | |
| 5 | nb-markdown 的拼接导出、nb-agent-ui 适配器、组件、Lab 场景 | 视图能画新状态 | 同上，加组件 dom 测试 |
| 6 | NeuroBook 界面接线、设置、会话行与活动 | 用户能停、能继续 | 同上，加 e2e |
| — | 界面的实现审查（前端） | | |

实施中的调整（2026-11-18）：
- 第 2、3 片合成一次提交：第 2 片让收口时剩下的话转成留着，放行在第 3 片，单独提交时现有用例与真实行为都停在“话卡住”的中间状态。
- 每片的验证：`bun run test:affected --with-consumers` 会跑 neuro-book 全量，改为本包 `bun run test` 加 nb-agent-ui、nb-story、neuro-book 的 `typecheck` 与 neuro-book 的 `bun test src/plugins/agent`；第 4 片起再加 `test:affected`。负载高时超时的用例先单独重跑，再在主工作区（不带改动）对照。

第 2 片之前先把清单里的探针改成正式测试（放 `src/kernel/run/buffer.test.ts`，按 Spec 编号命名），先看它们按旧行为失败，再实现。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| runtime 输出 103、109；session 输出 24 | `run/buffer.test.ts` 的归约与旧日志用例；`log/store.test.ts` 的旧内核读新事件 |
| runtime 输出 104、7、34、53；验收 9、10 | `run/buffer.test.ts`：清单 1.1–1.14 每条一例（真实内核，用 `createTestSession` 与扩展卡住反应造时间窗，同探针 p1；1.10 用会写失败的存储，1.11 用真实的扩展撤回；1.12、1.14 不是收口路径，断言缓冲区不变） |
| runtime 输出 30；验收 8、13 | `run/control.test.ts` 改写：权限先于信号、绑定的运行已收口、停止的范围与非用户只清自己的、`keepQueue`、两次停止、停止进行中的话 |
| runtime 输出 104 的三种不开、收口失败的分支；验收 14、15 | `run/buffer.test.ts`：待做的重新装配（真实的扩展撤回，含计划审查探针 N1 的“反应期间到达的 send”）、受理批反应期间关闭（探针 N3）、`closeSession{interrupted}`、开不起运行、收口批的反应抛错 |
| runtime 输出 4、36、106；验收 11、15 | `run/buffer.test.ts` 与 `run/tree.test.ts`：中断、出错、停止、暂停四种叶子上的 `start`、`resume`、`send`；用户停掉父会话开的运行后父会话 `start` 得 `not-allowed`（探针 R2c） |
| runtime 输出 105、107、108、110 与新失败码；验收 12 | `run/buffer.test.ts` 的权限表逐格一例、`replaces` 的 `input-stale` 与 `not-allowed`、`inputConsumed.runId` |
| runtime 输出 42 | `run/interaction.test.ts`：开不起运行时回答留着、`resolve` 成功 |
| runtime 输出 55 | `session/preview` 的现有用例加留着的条目 |
| runtime 输出 85、88 | `run/buffer.test.ts`：`commandId`、`runStarted.by`、宿主的 `by` |
| runtime 验收 2、5、11 | `session/session.test.ts` 改写验收 2；验收 5、11 的子进程 `kill -9` 用例照现有验收 5 的写法 |
| 按旧行为写的现有用例 | 空闲时用户 `enqueue` 作前置的约 10 处（`session.test.ts:122、132`、`control.test.ts:136`、`tree.test.ts:76、129`、`host.test.ts:388、406、533`、`attachments.test.ts:82`）逐个按新合同改：要“只入队”的改成运行中排或会话身份排后留着；输出 55 的预览用例改成运行中排的插话与旧日志两种 |
| sessions 输出 21、22、15 | `agent.test.ts`（别的插件的门面以宿主身份发、不能自填身份）、`sessions.test.ts`（远程 `resume`、`release`、条目字段、`activity` 的 `held`） |
| subagents 输出 10、16；jobs 输出 3、4、11 | `subagents.test.ts`、`jobs.test.ts` |
| builtin-profiles 输出 9 | `kit/sessions/meta.test.ts` |
| conversation 输出 6、9、47–50；验收 5、8、9 | `session-host.test.ts`（输出 50 的表逐行一例）、`web/resume-merge.test.ts`（重新编号、少于两条）；e2e `agent-conversation.e2e.ts` 走验收 8 |
| ui 排队区、占位文字、停止的第二个选项、乐观消息；ui 验收 38、39 | dom 测试管读屏属性、事件、禁用与焦点（`AgentQueuedMessages.dom.test.ts`、`AgentConversationComposer.dom.test.ts`）；`kernel-transcript.test.ts` 管宿主的 `author`、按 `commandId` 清乐观消息（实时与重建）、`ahead` 现算；`lab-agent-ui.e2e.ts` 量 390 宽英文场景的截断 |
| conversation 输出 48、50 的文案与选指令 | 原因文案的单元测试逐 `end` 与 `heldBy` 组合一例、未知码回退；`session-host.test.ts` 逐行覆盖输出 50 的表、进行中保护、被拒只还原 `typed`、结果未知重发带 `replaces`；验收 5 由 `agent-conversation.e2e.ts` 扩写，验收 9 在 `session-host.test.ts` |

## 验证

- 每片：上表的单元与合同测试；第 4 片起 `bun run test:affected`。
- 合入前 e2e（3 个文件）：`agent-conversation.e2e.ts`、`agent-subagents.e2e.ts`、`lab-agent-ui.e2e.ts`。改动后只重跑覆盖改动的文件与失败项。
- 真实运行时：第 6 片在开发服务上手工走一遍“排两条、停止、发新话（合并）”“停止并清空排队”“重启后继续”，截图（亮色）放 Task 证据。
- 真实模型：`packages/nb-harness/tests/kernel/kernel.llm.test.ts` 跑一次（`bun run test:llm`），确认普通对话路径没变。
- 未验证的边界：多进程同时写一个会话不在范围（单写者前提，ADR 0035）。

## 不做与风险

- 不做：降级（旧内核读新事件得 `log-corrupt`）；旧日志补算状态；缓冲区条目过期；日历式提醒；会话头 `owner` 的放宽（随 t06）。
- 风险：`settleRun` 把 28 处收口收成一处，改动面最大。由第 2 片之前写好的路径用例兜底（清单 1.1–1.14 每条一例，用真实内核与扩展造的时间窗）；实现审查专门查“有没有收口点没走它”：写 `runEnded` 的地方（`grep -n 'ctrl("runEnded"\|type: "runEnded"' src/kernel`）只剩 settle 的批组装函数与恢复。
- 风险：`agentKey` 改成按调用方门面后，别的插件经它拿到的身份变成宿主。现在的调用方只有测试世界（包一层 `asUser`）与本插件；`agent.test.ts` 用真实的门面装配测宿主身份。
- 风险：乐观消息改按 `commandId` 确认后，结果未知时的重发（同一 `commandId`）要仍能对上；`kernel-transcript.test.ts` 加重发用例。

## 附：第 2、3 片的实现细节（2026-11-18，开工时补）

收口（`run/settle.ts`）：
- `settleInQueue` 只在单写者队列的一项里调用。组批：调用方给的收尾事件（`settleOpen`、`turnEnded` 等）→ `runEnded`（中止时带停止记录的 `stoppedBy`）→ 停止的范围（不保留时清空停的人能取消的、其余与 `keepQueue` 时的就绪的 `inputHeld{heldBy}`）→ 剩下就绪的 `inputHeld{cause: {end, code?}}`（不在“这期间到达的”集合里的）→ 每个停止的 `commandAccepted{aborted: true}` → 推迟的放行。
- 推迟的放行：先查三种不开（`host.closed()`、待做的重新装配、`startProblem` 或它抛错记 `internal`）；不开时“这期间到达的”另成一条带 `code` 的 `inputHeld`、写诊断 `deferred-start-skipped`。开时把前面的草稿用 `reduceSessionKernel` 叠在当前状态上投影出缓冲区，按每条推迟指令的发出者算能放行的（`releasable`），写 `inputReleased`，再写 `runStarted{by}`（有用户记用户，否则最先的）与取走投影里就绪的第一条。
- 写批放在 `try`；`finally` 里调 `control.settled(runId, next)`：清当前运行、推 `idle` 帧（`broken` 不改），开了下一次运行就换成它、推 `running`，否则调 `onIdle`；结算 `waitRun`。`launch` 的 `.finally` 对已经 `settled` 的运行什么都不做。
- 回复没有工具调用的那一步整个在一个队列项里判断：就绪的插话→接着请求；会话要结果→催或收口；就绪的排队→写 `turnEnded` 与取走、接着；都没有→`settleInQueue`。其余收口点（出错、中止、只压缩、交出结果、文字收口）先 `queue.drain()`，再在一项里 `settleInQueue`。

停止（`commands.ts` 的 `abortCommand`，收 `issuer`）：同步判权限（用户；会话要会话头 `caller.id` 是它；宿主要路径归约的 `runBy` 与它同一插件）→ `control.recordStop({runId, by, keep, scope: 缓冲区全部 id, commandId})`：已有记录就只追加 `commandId`；`control` 在 `settleInQueue` 开始组批时置 `#settling`，之后到的 `abort` 交回 `{aborted: false}` → 触发信号 → 等收口批写下，交回其中自己的 `commandAccepted` 的 seq。`closeSession` 不带原因的关闭在 `control` 上记 `closing`，留着的 `cause.code` 是 `session-closed`。

指令（`commands.ts`、`permissions.ts`、`interaction.ts`、`tree.ts`）：
- `control.takesInput`：有当前运行、不是只压缩的、不在中止中、没开始组收口批。`send`、用户的 `enqueue`、`resume`、`release`、异步回答在 `active && !takesInput` 时写下自己的话（就绪），受理成功后 `control.defer({issuer, mode, inputIds})`，交回去向 `later`；会话、宿主的 `enqueue` 这时写 `inputQueued{state: "held", cause: {queued: "idle"}}`。
- `send`：`replaces` 先校验（`input-stale`、`not-allowed`），写 `inputRemoved{replaced}`；再写放行（`releasable`，模式取 `release` 选项缺省 `keep`），再写 `inputQueued{commandId}`。空闲时：叶子上有暂停的运行，发出者能接着跑就 `runResumed{by}` 并接着跑，不能就把话写成留着（去向 `held`）；否则 `runStarted{by}`，取投影缓冲区里就绪的第一条开第一轮。
- `start`、`resume`、`release`：按“附”之前的“关键设计”与 Spec 输出 4、106、107；能不能接着跑读路径归约的 `lastChat` 与 `runBy`。
- `takeInputDrafts`、`takeSteerDrafts` 带上条目的 `commandId` 与 `inputConsumed.runId`，只取就绪的。
- 异步回答：放行应答者的，再放回答；开不起来时回答写成留着带码，`resolve` 照常成功。
- `rewind{resend}`：以视图的发出者入队；落在运行中途时同 `start` 的权限，受理批里直接取走这条（不靠循环取第一条）。
- NeuroBook 的远程合同从 `commandErrors` 派生方法：新指令进码表的同一次提交里补 `shared/remote.ts` 的参数表，保持 neuro-book 的类型检查通过。
