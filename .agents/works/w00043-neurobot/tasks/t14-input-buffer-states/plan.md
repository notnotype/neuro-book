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

无（全部是内核与应用内部的规则，没有通用问题）。

## 关键设计

### `packages/nb-harness/src/kernel/api/`：合同与事件

- `basics.ts`：`Issuer` 加 `{kind: "host"; source: {plugin; label; ref?; at?}}`；新增 `sameIssuer(a, b)`（会话按 `id`、宿主按 `source.plugin`）与 `isUser(issuer)`。所有比较发出者的地方只用它们。
- `kernel-events.ts`：新增 `inputHeld{ids, cause, heldBy?}`、`inputReleased{ids, by, mode}`（会话级）、`runResumed{runId, by}`（路径级）；`inputQueued` 加 `commandId`、`state?`、`cause?`；`input`、`steer` 加 `commandId`；`inputEdited`、`inputRemoved` 加 `by`，`inputRemoved.reason` 加 `cancelled`、`replaced`（带 `replacedBy`）；`runStarted` 加 `by`。`cause` 的类型 `{end: RunEndReason; code?} | {queued: "idle"; code?}`。`heldBy` 是用户时写 `{kind: "user"}`（session.md 输出 24），其余 `by` 照旧“用户不写”。
- `contract.ts`、`codes.ts`：`CommandMap` 加 `resume({mode?})`、`release({inputIds})`；`send` 加 `release?: "keep" | "followups"`、`replaces?: {id; edits}[]`，成功值加 `placement`；`abort` 不变（发出者来自视图）。失败码加 `not-allowed`、`nothing-to-resume`、`held-by-user`、`nothing-to-release`、`input-stale`，进 `commandErrors`。
- `host.ts`：`BufferedInput` 加 `state`、`cause?`、`heldBy?`、`commandId`；快照照此暴露。

### `src/kernel/state/kernel-state.ts`：缓冲区的归约

- 条目状态只由会话级的五种事件归约（runtime 输出 103）；旧日志 `inputRemoved.reason: "user"` 读作 `cancelled`。
- 新增 `readyEntries(buffer)`、`heldEntries(buffer)`；内核里读缓冲区的 11 处（清单第 2 节 2.1–2.10）全部改走它们，不再直接遍历 `buffer`。
- 不变量：留着的话不会被任何取输入的路径看到；已经留着的话不改 `cause` 与 `heldBy`（输出 109）。

### `src/kernel/run/control.ts`、`run/loop.ts`、`run/writes.ts`：回到空闲只在一处

- 新增收口函数 `settleRun`（放在 `run/settle.ts`）：在单写者队列的一项里完成“看缓冲区—决定—写批—翻转空闲”：
  1. 读就绪的条目；回复没有工具调用时，有就绪的 `steer` 就接着请求、有就绪的 `followup` 就开下一轮（输出 7），文字收口也在这里判断，都不收口；
  2. 否则组收口批：这次的收尾事件（`turnEnded`、`modelFailed` 等，由调用方给）、`runEnded`、剩下就绪的 `inputHeld{cause: {end, code?}}`；停止受理时记下的范围按 `keepQueue` 写 `inputHeld{heldBy}` 或 `inputRemoved{aborted}`（输出 30，实现定义 2）；
  3. 有挂起的放行（运行不再取输入期间受理的 `send`、用户 `enqueue`、`resume`、异步回答，输出 104）时，先查三种不开的情形：有待做的重新装配（`pendingReassembly` 非空）、会话已开始关闭、开不起运行（同 `startProblem`）；都不是时按受理先后写 `inputReleased`，同一批写下一次运行的 `runStarted{by}`（有用户记用户，否则最先受理的）与第一轮，推迟的 `resume` 不接着跑刚收口的这次；是其中一种时不放行，这期间到达的话另成一条带 `code` 的 `inputHeld`，写诊断 `deferred-start-skipped`；
  4. 写批、在这一项里把 `control` 置为空闲或换成下一次运行（实现定义 1），结算这次运行的 `waitRun`；运行尾部（状态帧、`onIdle`、结算）整体搬进这一项：先推这次的 `idle` 帧，开了下一次运行再推它的 `running`，旧运行的 `finally` 不再推帧。
- `loop.ts` 的 25 处 `end()`、362（finished）、394（completed）与“看缓冲区决定接着跑还是收口”（378、393）都改为调用它；`recover.ts:84` 用同一个批的组装函数（没有 `control`）。收口的分支只剩一个，新加的收口方式也走它。
- `control` 加 `takesInput`：只压缩的运行、停止已受理、`settleRun` 已开始组批时为假；`send` 等指令据此判断“推迟到收口”，挂起的放行记在 `control` 上，只由 `settleRun` 消费。进程在受理与收口之间被杀时，挂起的放行丢掉，话按恢复留着（与重启留着一致）。
- `abort`：在同一个同步步骤里先按输出 108 判权限（不允许就不触发），再触发信号、把受理排进队列并绑定这次运行的 id；受理轮到时那次运行已收口的交回 `{aborted: false}`。受理记下范围（此刻缓冲区的条目 id）、停的人与 `keepQueue`；缺省清空只清停的人能取消的，其余就绪的留着；第二个 `abort` 不改它们（输出 30，提案审查第 8 条）。

### `src/kernel/run/commands.ts`、`run/permissions.ts`（新）、`run/interaction.ts`、`run/tree.ts`：指令

- `permissions.ts`：一个函数按输出 108 的表判定 `edit`、`remove`、`replaces`、`release`、`resume`、`abort`、`start` 与接着跑暂停的运行；指令里不再各写各的判断。`abort` 的“会话只能停 `caller` 是它的会话”读会话头。
- 放行：`releasable(issuer, buffer)` 按输出 105 的表；`send`、用户 `enqueue`、异步回答先写 `inputReleased` 再写新输入；会话、宿主空闲时的 `enqueue` 写 `inputQueued{state: "held", cause: {queued: "idle"}}`（第 7 项）。
- `send`：成功值的 `placement` 在受理时定（输出 110）；`replaces` 的条件写入在受理项里一次校验（存在、`edits`、可移除），不合整条 `input-stale`（输出 107）。
- `start`：改为接着跑叶子上可接着跑的运行（新增 `history` 的 `continuableRun(leaf)`，交回 `{runId, by, paused}`）：暂停的运行，或最后一次对话运行（只压缩的不算）的最后一轮停在当中；不取留着的（第 9 项）。非用户只能接着跑 `runStarted.by` 是自己的，旧日志没有 `by` 时按那次运行第一条 `input` 的 `by` 认（提案审查第 2 条）。会话头 `owner` 的放宽随 t06。
- `resume`、`release`：新指令，规则见输出 106、107；用户的 `resume` 先接着跑可接着跑的运行。
- 暂停的运行：接着跑时写 `runResumed{runId, by}`；不能接着跑它的发出者 `send` 时话留着、`placement: "held"`（第 8 项），`resume`、`release` 得 `not-allowed`，异步回答留着带码。
- `interaction.ts`：异步回答先放行应答者的，再放进回答；开不起运行时回答留着、`cause: {queued: "idle", code}`，`resolve` 照常成功（实现定义 3）。
- `tree.ts`：`rewind{resend}` 的 `inputQueued` 写视图的发出者，不放行（开发者 2026-11-18）；落在运行中途时按接着跑暂停的运行判权限、写 `runResumed{by}`。
- 输出 85：`input`、`steer` 带 `commandId`；`inputConsumed` 带取走它的 `runId`；`runStarted.by` 是开它的发出者（放行开的记放行者）；去掉 `inputEdited` 的 `by`。

### `src/kernel/session/`：会话面

- `session.ts`：只压缩的运行 `takesInput` 为假（输出 52、104）；`closeSession` 两种关闭都走 `settleRun`，不带原因时 `cause: {end: "aborted", code: "session-closed"}`（实现定义 6），关闭开始后推迟的指令不开运行；`scheduleReassembly` 的 `pendingReassembly` 供 `settleRun` 判断；快照的 `buffer` 带新字段。
- `preview.ts`：只投影就绪的（输出 55）。

### `src/kit/sessions/`：宿主套件

- `meta.ts`：标题会话以宿主身份发话（`source.plugin` 由套件的使用方给），一次生成没开起运行时取消自己留下的话（实现定义 6，builtin-profiles 输出 9）。
- `table.ts`：`view(id)` 缺省仍是用户（远程合同用）；新增 `view(id, issuer)` 的调用方只剩 `nbook.agent` 自己的门面。

### `packages/neuro-book/src/plugins/agent/backend/`：NeuroBook 后端

- `agent.ts`：`agentKey` 改为 `perConsumer` 提供（照 `src/server/running-work.ts` 的写法）：别的插件拿到的门面 `session(id, options?)`、`create` 缺省的发出者是 `{kind: "host", source: {plugin: 调用方插件, ...source}}`，`{asUser: true}` 时是用户（开发者 2026-11-18 允许插件代替用户发），`startTask` 同样；`nbook.agent` 自己的门面另能指定会话的身份（子代理）。先搜 `agentKey` 的全部调用方（清单 3.12：本插件与测试）改到新形状（sessions 输出 21，审查第 4 条）。
- `remote.ts`、`frames.ts`：远程合同仍是用户（开发者 2026-11-18）；远程方法加 `resume`、`release`，`send` 透传新选项与 `placement`；缓冲区条目的投影带新字段（sessions 输出 22）；`activity` 加 `held`（输出 15）。
- `jobs/steer.ts`：只认就绪的插话，`inputReleased` 里放行出来的插话算到达（jobs 输出 3）。
- `subagents/tools.ts`、`children.ts`：`agent_send` 不带话改走 `resume`；按 `placement` 与之后的 `inputConsumed`、`inputHeld` 写结果文字（被交出结果留着、被用户暂停的条数），不按 `currentRunId` 认任务（subagents 输出 10，审查第 1 条）；连带中止与父 Agent 的 `kill` 以父会话身份，远程 `killJob` 以用户身份（jobs 输出 4、11，实现定义 5，审查第 3 条）。

### `packages/nb-agent-ui/`：适配器与组件

- `src/kernel-transcript.ts`：`queue` 的条目带 `by`、`state`、`cause`、`heldBy`、`edits` 与完整输入，归约新事件；乐观消息按 `commandId` 确认（`input`、`steer` 的 `commandId`），不再“撤掉最早一条”（清单 2.13）；合并发出的那条乐观消息带“前面还有 N 条”。
- `src/types.ts`：`composer.queued` 的条目加 `author?: {label: Text; icon: string}`、`editable`、`held?: {reason: Text}`；`interaction.stopClearing: {count} | null`；`composer.stop` 加 `clearQueue?`；`MessageView` 的 `user` 加 `ahead?: number`。
- `src/vue/composer/AgentQueuedMessages.vue`（与 `.md`、dom 测试）：照 t03 决定 20 加“已暂停 N 条”头行与“继续”、别的发出者的来源标签、虚线框；留着的行不受 3 条限制，“还有 N 条”可点开；读屏与 status 区播报；`AgentConversationComposer.vue`（与 `.md`）：停止键旁的下拉箭头（独立按钮、nb-ui `DropdownMenu`、选中后焦点回编辑器），占位文字的新顺序与继续键（决定 21）。新文字进 `locales/`。
- Lab：`packages/neuro-book/src/plugins/lab/web/fixtures/nb-agent-ui/composer.scenes.ts` 加“留着”“停止的下拉”两个场景（含英文场景，按 ui-development 的第 5 条看 390 宽）。

### `packages/neuro-book/src/plugins/agent/web/`、`shared/settings.ts`：NeuroBook 界面

- `session-host.ts`：把快照与转录器的缓冲区条目映射成 `composer.queued`（发出者显示名：会话取它的标题，宿主取 `source.label`；原因文案按 conversation 输出 48）；`run.continue` 照 conversation 输出 50 的表选指令（第 11 项）；`composer.stop{clearQueue}` 走不带 `keepQueue` 的 `abort`；`input-stale` 只重读快照、重拼、再发一次 `send`；合并的那条结果未知时重发沿用原参数。
- 新增 `web/resume-merge.ts`：纯函数，把用户留着的条目与新话拼成一条（按入队顺序、空一行、附件随文字），配单元测试。
- `shared/settings.ts`：`nbook.agent/resumeMode`（用户层，缺省 `merge`），放进“Agent 对话”分区（conversation 输出 47）。
- `session-list.ts`、`activity.ts`：会话行轻标“有暂停的话”；状态栏活动只算只有用户能放行的（输出 48）。

## Spec 与文档改动

- 已改：见 Context 的 Spec 列表与 ADR 0055。
- 实施中：按实现补各 Spec 的实现合同与证据；`implemented` 的 Spec 里这次加的“（planned）”句子，有测试守住后去掉标记；`harness/runtime.md` 整份 `planned`，验收映射写进证据。
- 组件同名 `.md`：`AgentQueuedMessages.md`、`AgentConversationComposer.md` 随改。

## 切片

| 片 | 内容（关键设计的节） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 1 | 合同、事件、归约、`Issuer` 的宿主种类（api、state） | 只加字段与读法，行为不变 | `bun test src/kernel` |
| 2 | `settleRun`、`takesInput`、全部收口点、恢复、关闭、停止的范围、`start` 的新语义（control、loop、recover、session） | 回到空闲只在一处 | 同上，加新的 `run/buffer.test.ts` |
| 3 | 放行、`resume`、`release`、`replaces`、去向、权限、暂停的运行、异步回答、`rewind{resend}`（commands、permissions、interaction、tree） | 指令按发出者 | 同上 |
| — | 内核的实现审查（后端） | | |
| 4 | 宿主套件与 NeuroBook 后端（kit、agent backend） | 发出者如实盖章 | `bun run test:affected` |
| — | 后端的实现审查 | | |
| 5 | nb-agent-ui 适配器、组件、Lab 场景 | 视图能画新状态 | `bun run test:affected`、组件 dom 测试 |
| 6 | NeuroBook 界面接线、设置、会话行与活动 | 用户能停、能继续 | 同上，加 e2e |
| — | 界面的实现审查（前端） | | |

第 2 片之前先把清单里的探针改成正式测试（放 `src/kernel/run/buffer.test.ts`，按 Spec 编号命名），先看它们按旧行为失败，再实现。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| runtime 输出 103、109；session 输出 24 | `run/buffer.test.ts` 的归约与旧日志用例；`log/store.test.ts` 的旧内核读新事件 |
| runtime 输出 104、7、34、53；验收 9、10 | `run/buffer.test.ts`：清单 1.1–1.9 的每条路径各一例（真实内核，用 `createTestSession` 与扩展卡住反应造时间窗，同探针 p1） |
| runtime 输出 30；验收 8、13 | `run/control.test.ts` 改写：权限先于信号、绑定的运行已收口、停止的范围与非用户只清自己的、`keepQueue`、两次停止、停止进行中的话 |
| runtime 输出 104 的三种不开；验收 14 | `run/buffer.test.ts`：待做的重新装配（真实的扩展撤回）、`closeSession{interrupted}`、开不起运行 |
| runtime 输出 4、36、106；验收 11 | `run/buffer.test.ts` 与 `run/tree.test.ts`：中断、出错、停止、暂停四种叶子上的 `start`、`resume`、`send` |
| runtime 输出 105、107、108、110 与新失败码；验收 12 | `run/buffer.test.ts` 的权限表逐格一例、`replaces` 的 `input-stale` 与 `not-allowed`、`inputConsumed.runId` |
| runtime 输出 42 | `run/interaction.test.ts`：开不起运行时回答留着、`resolve` 成功 |
| runtime 输出 55 | `session/preview` 的现有用例加留着的条目 |
| runtime 输出 85、88 | `run/buffer.test.ts`：`commandId`、`runStarted.by`、宿主的 `by` |
| runtime 验收 2、5、11 | `session/session.test.ts` 改写验收 2；验收 5、11 的子进程 `kill -9` 用例照现有验收 5 的写法 |
| sessions 输出 21、22、15 | `agent.test.ts`（别的插件的门面以宿主身份发、不能自填身份）、`sessions.test.ts`（远程 `resume`、`release`、条目字段、`activity` 的 `held`） |
| subagents 输出 10、16；jobs 输出 3、4、11 | `subagents.test.ts`、`jobs.test.ts` |
| builtin-profiles 输出 9 | `kit/sessions/meta.test.ts` |
| conversation 输出 6、9、47–50；验收 5、8、9 | `session-host.test.ts`（输出 50 的表逐行一例）、`web/resume-merge.test.ts`（重新编号、少于两条）；e2e `agent-conversation.e2e.ts` 走验收 8 |
| ui 排队区、占位文字、停止的第二个选项、乐观消息；ui 验收 38、39 | `AgentQueuedMessages.dom.test.ts`、`AgentConversationComposer.dom.test.ts`、`kernel-transcript.test.ts`；`lab-agent-ui.e2e.ts` 的新场景（含 390 宽英文） |

## 验证

- 每片：上表的单元与合同测试；第 4 片起 `bun run test:affected`。
- 合入前 e2e（3 个文件）：`agent-conversation.e2e.ts`、`agent-subagents.e2e.ts`、`lab-agent-ui.e2e.ts`。改动后只重跑覆盖改动的文件与失败项。
- 真实运行时：第 6 片在开发服务上手工走一遍“排两条、停止、发新话（合并）”“停止并清空排队”“重启后继续”，截图（亮色）放 Task 证据。
- 真实模型：`packages/nb-harness/tests/kernel/kernel.llm.test.ts` 跑一次（`bun run test:llm`），确认普通对话路径没变。
- 未验证的边界：多进程同时写一个会话不在范围（单写者前提，ADR 0035）。

## 不做与风险

- 不做：降级（旧内核读新事件得 `log-corrupt`）；旧日志补算状态；缓冲区条目过期；日历式提醒；会话头 `owner` 的放宽（随 t06）。
- 风险：`settleRun` 把 28 处收口收成一处，改动面最大。由第 2 片之前写好的路径用例兜底（清单 1.1–1.14 每条一例，用真实内核与扩展造的时间窗）；实现审查专门查“有没有收口点没走它”（`grep -n "runEnded" src/kernel` 只剩它与恢复的组装函数）。
- 风险：`agentKey` 改成按调用方门面后，别的插件经它拿到的身份变成宿主，可能有依赖“缺省是用户”的调用方。第 4 片先搜全部调用方，`agent.test.ts` 用真实的门面装配测。
- 风险：乐观消息改按 `commandId` 确认后，结果未知时的重发（同一 `commandId`）要仍能对上；`kernel-transcript.test.ts` 加重发用例。
