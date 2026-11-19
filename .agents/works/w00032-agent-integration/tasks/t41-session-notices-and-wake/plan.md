# t41 实施计划：缓冲区的提醒级、唤起与会话级的门

第 2 稿（2026-11-19）：按设计审查（omp，19 条，见 [README](README.md) 的“设计审查”）改。和第 1 稿相比：提醒与插话改在压缩之后取；门的关、开与初值重写；唤起开的运行不先写 `turnStarted`，在第一个边界决定开什么样的一轮；`queue.order` 改为取走时的写入次序；远程快照只带提醒的摘要；`followups: "all"` 暂缓（待开发者确认）。

## Context

后台任务结束、子代理有话问父 Agent、eval 的内核被回收，这些要告诉模型的事现在没有入口；Agent 空闲时也没人唤起它。已接受的[提案“统一后台任务”](../../../../../docs/proposals/unified-background-tasks.md)与 [ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md) 定了方向：缓冲区多一级“提醒”，可以唤起，唤起的门挂在会话上。本 Task 只做 nb-harness 内核与 NeuroBook 的接线（远程、转录、对话视图）；谁来发提醒在 t22。

依据：[README](README.md) 的决定 1–5；提案第四节第 1 小节的 8 条规则；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 2–7、24、28–31、36、42、52、54、85、88、103–111；[`harness/profile.md`](../../../../../docs/specs/harness/profile.md) 输出 2、6、7、13、19；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 输出 7、15、18、24。

探针（[README](README.md) 的“探针”、[输出](evidences/probe-outputs.txt)）与设计审查的探针：边界现在的先后是“外部事实 → 工具集 → 取插话 → 解析模型 → 压缩 → 组请求”；位置章让一轮还没回复时写的事件排在新话前面；收口批只开一个后继运行；现在宿主在停止受理后的话会在收口后开一次运行；同一位置的边界压缩能把刚取的插话裁进摘要（审查第 2 条）；收口按推迟列表里有没有用户定 `by`，用户的话被取消了也一样（审查第 3 条）。

工作方式：主会话写；内核三片做完交 omp 实现审查，NeuroBook 一片交 Sonnet。

## 技术选型

无。

## 关键设计

### 内核的接口：`packages/nb-harness/src/kernel/api/`（`host.ts`、`events.ts`、`kernel-events.ts`、`codes.ts`）、`extension/profile.ts`、`helpers/content.ts`

- 指令 `notice({text, key?, wake?})` → `{noticeId, replaced?}`：列进 `hostOnlyCommands`（浏览器的远程不暴露，审查第 14 条）；内核里用户身份得 `not-allowed`。上限（审查第 1 条）：正文按 UTF-8 至多 32 KiB（`notice-too-large`）；`key` 至多 200 个字符；一个会话待发的至多 64 条、按编码后的整条记录（含来源）合计至多 128 KiB（`notice-budget`）；替换按扣掉旧的那条之后算。超出时什么都不写。
- 指令 `removeNotice({noticeId})`：用户能取消任何一条，会话与宿主只能撤回自己发的；不在待发里得 `notice-not-found`，取走了的得 `notice-taken`。
- 事件：会话级 `noticeQueued{id, by, key?, text, wake, commandId}`、`noticeRemoved{ids, by, reason: "replaced" | "withdrawn" | "cancelled"}`、`noticeTaken{ids, runId}`、`wakeGate{open, cause}`；路径级对话事件 `hostNotice{id, by, text, boundary}`；`steer` 加 `boundary`（同一个边界一起取走的提醒与插话带同一个 id）；`runStarted` 加 `wake: true`。新事件名让旧内核打开时得 `log-corrupt`。`helpers/content.ts` 给 `noticeQueued.text`、`hostNotice.text` 登记内容字段（出站过滤，审查第 16 条）。
- 快照加 `notices`（全文）与 `wakeGate`；同缓冲区里的输入，快照不经出站过滤。
- Profile 加 `queue?: {order?: ["notice", "steer"] | ["steer", "notice"]}`，缺省提醒在前。

### 状态：`state/kernel-state.ts`

会话级归约多两样：待发的提醒（`noticeQueued` 加、`noticeRemoved` 与 `noticeTaken` 删）与门（`wakeGate`）。门的初值（审查第 4、18 条）：新建会话与 `fork` 出来的会话在建会话那一批写 `wakeGate{open: true, cause: "created"}`；没有任何门事件的旧日志按关着算（升级前停过的会话不会被独立插件唤起，第一次由用户开起运行时打开）。`fork` 不带来源会话的待发提醒。

### 取走：`run/loop.ts`、`session/preview.ts`

- **边界的新先后**（审查第 2 条）：外部事实 → 工具集 → 解析模型 → 压缩 → 取提醒与插话 → 交结果的提醒 → 组请求。取走仍在一个队列项里、停止受理之后不取；按 Profile 的 `queue.order` 先写一种再写另一种，每条提醒写 `noticeTaken` 与 `hostNotice`，同一边界的带同一个 `boundary`。于是边界压缩不会把这一次刚取的裁掉；插话也随之改在压缩之后取（与提醒一视同仁）。服务商报溢出后的压缩仍可能把它们压进摘要，那是溢出的处理，照旧。
- **没有进行中的一轮时**（循环顶部，`history.current === null`：唤起开的运行、在两轮之间接着跑的运行，审查第 5、6、10 条）：在一个队列项里依次看：有带唤起的待发提醒，开一轮没有输入的（`turnStarted{inputId: null}`）；否则有就绪的话，取第一条开一轮（同现在）；否则是用户接着跑、又有待发的提醒，开一轮没有输入的；都没有就收口、不发请求。唤起开的运行受理时只写 `runStarted{wake: true}`，不先写 `turnStarted`，所以发出者在那之前撤回或取消、只剩不带唤起的提醒时，这次运行不发请求就收口，提醒留着等下一次对话请求。
- **预览**（审查第 6 条）：只对当前叶子把待发提醒按同样的位置投影；当前没有进行中的一轮、只有提醒时，投影成一轮没有输入的；历史叶子不叠当前的待发。不写事件。
- 不做“取走后那次请求没发出去就放回”（开发者接受，裁历史的 Profile 自己注意）。

### 门与唤起：`run/settle.ts`、`run/commands.ts`、`run/interaction.ts`、`run/tree.ts`、`run/recover.ts`、`dispatch/core.ts`、`session/session.ts`

- **关门**（审查第 4、8 条）：对话运行的收口批里，有停止的受理、收口方式是 `aborted`（有没有停止记录都算）、`error` 或 `interrupted`、或会话正在关闭或进程正在收尾（这时即使收尾工具在宽限期里交卷、记成 `finished` 也关）时，写 `wakeGate{open: false, cause}`；打开会话时的恢复补写 `runEnded{interrupted}` 时同样。只压缩的运行不论怎样收口都不改门。
- **开门**（审查第 3 条）：开门看这一批里真的开起或接着跑的那次对话运行是谁的：用户发起、并且这一批确实开起或接着跑了对话运行时写 `wakeGate{open: true}`。收口批里由推迟的指令开的后继，`by` 改为按投影后真正被取走的第一条话或真正放行了条目的那条指令定（被取消的用户的话不算），这同时修掉现在“用户的话取消了仍记成用户开的”；只有它是用户时才开门。被拒、开不起、去向 `held` 或 `later` 的不开门；回退、换分支、压缩不动门。
- **唤起**：会话空闲、门开着、叶子上没有暂停的运行、开得起运行（不是只读、没有待做的重新装配、没在关闭、模型解析得到）、有带唤起的待发提醒时，开一次运行（`runStarted{by: 最早那条带唤起的发出者, wake: true}`）。判定点（审查第 9 条）：带唤起的提醒受理时；每个收口批在推迟的指令之后（推迟的话开了运行，提醒随它的第一次请求带上，不另开）；重新装配完成、会话回到可开运行时。暂时开不起时提醒照样待发、保留唤起资格，等下一个判定点；模型设置的变化本身不触发判定。一次至多开一次。
- **续跑后的恢复**（审查第 7 条）：叶子是回退设的、之后又受理了接着跑这次暂停的运行（有 `runResumed`），重开时按中断恢复（补写收口、关门），而不是当成从没续跑。

### Profile 的 `queue` 与辅助函数：`run/loop.ts`、`helpers/turns.ts`

- `queue.order` 只决定同一个边界里提醒与插话的写入先后，不在渲染时重排已写下的块（审查第 13 条：重排会改写已发出的请求前缀）。缺省 `format` 按路径先后渲染，不变。
- `mergeSteers(turn)`：把同一个 `boundary` 的相邻插话的文字合成一块（第一条的来源，空一行分隔，附件保留），不跨边界合。
- `followups: "all"` 暂缓：审查第 11、12 条指出它会合掉用户“按排队顺序”放行的条目，结构化的 `payload` 与附件位置也没有合成规则；现在没有 Profile 要用它。等第一个需要它的 Profile 再做（待开发者确认）。

### 渲染：`view/format.ts`

`hostNotice` 的缺省文字是 `<system-reminder>` 包着一行来源说明 `[系统 · <label>]` 与正文；`label` 渲染前去掉换行与控制字符、`[`、`]`，截到 40 个字符，空的写插件 id（审查第 15 条）；正文里的 `<system-reminder>`、`</system-reminder>` 转义。来源行的格式与 bot 提案的宿主消息共用一处定义。Profile 的 `render` 能换它的文字。

### NeuroBook：`packages/neuro-book/src/plugins/agent/`（`shared/remote.ts`、`backend/remote.ts`）、`packages/nb-agent-ui/src/kernel-transcript.ts` 与对话视图

- 远程 `nbook.agent/sessions` 升到版本 2：快照的待发提醒只带摘要 `{id, by, key?, wake, queuedAt, summary, bytes}`（摘要至多 200 个字符，审查第 1 条），加上至多 64 条的上限，整份快照的增量有界；`wakeGate`；新写方法 `removeNotice({sessionId, noticeId})`（用户）；`notice` 不暴露。旧版本的窗口连上得 `version-changed`（审查第 17 条）。插件经 `agentKey` 拿到的会话视图有 `notice`、`removeNotice`，发出者照现在按调用方盖章。
- 转录：`noticeQueued`、`noticeRemoved`、`noticeTaken` 维护待发列表；`hostNotice` 是过程里的一行。
- 对话视图：排队区列出待发的提醒（来源与摘要，可取消）；取走后在消息流里是一行“提示 · <来源> · <摘要>”，点开看全文；门关着、有待发提醒时排队区头上写“你继续时一起送出”。Lab 加场景。

## Spec 与文档改动

先在 master 写成 planned：

- `harness/runtime.md`：新输出 112 发提醒（指令、发出者、上限、`key`、撤回与取消）、113 取走（边界的新先后、写入次序、停止后不取、溢出照旧）、114 没有进行中的一轮时开什么样的一轮、115 缺省的样子与来源行、116 唤起（条件、判定点、暂时开不起）、117 门（关、开、初值、只压缩不改、`fork`）、118 预览；输出 28（插话改在压缩之后取）与 104（后继运行的 `by` 按真正取走的话定）随之改写；术语加“提醒”“唤起”“门”；失败码加 `notice-too-large`、`notice-budget`、`notice-not-found`、`notice-taken`；“状态与转换”补门。
- `harness/session.md`：新输出 27 新事件与字段、门的初值、续跑后的恢复。
- `harness/profile.md`：输入表加 `queue.order`；新输出 21 `mergeSteers`。
- `agent/sessions.md`：快照的提醒摘要、`removeNotice`、合同版本 2。
- `agent/conversation.md`、`ui/agent-conversation-view.md`：排队区的提醒、取走后的那一行、门关时的说明。

## 切片

1. **Spec（planned）**：上一节，提交到 master。
2. **提醒的发与取**：接口、事件、状态、`notice`、`removeNotice`、边界的新先后、循环顶部、渲染、预览、快照、内容映射。验证：nb-harness 新合同测试 `run/notice.test.ts`，`bun test src/kernel`、typecheck。
3. **门与唤起**：收口批关门与后继的 `by`、各开运行入口开门、初值、恢复、唤起的判定点。验证：`run/wake.test.ts`。
4. **`queue.order` 与 `mergeSteers`**。验证：`run/loop` 与 `helpers` 的合同测试。第 2–4 片做完交 omp 实现审查。
5. **NeuroBook**：远程版本 2、转录、对话视图、Lab 场景。验证：`sessions.test.ts`、nb-agent-ui 转录测试、dom 测试、`e2e/agent-conversation.e2e.ts`。交 Sonnet 前端审查。

每片跑 `bun run test:affected` 与 typecheck，各自提交；合入 master 后 t22 才开始用提醒。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| runtime.md 输出 112 | `notice.test.ts`：会话与宿主能发、用户得 `not-allowed`；四种上限含多字节与转义；同 `key` 替换按扣掉旧的算；撤回与用户取消；取走后撤回得 `notice-taken` |
| runtime.md 输出 113 | `notice.test.ts`：空闲时发、下一次请求排在新话前面；运行中发、与同一刻的插话一起进下一次请求，`order` 决定先后；工具后越过阈值的边界压缩不裁掉刚取的提醒与插话（审查第 2 条的探针改写成用例）；只压缩的运行不取；停止受理后不取；回退、换分支后待发的照样在；工具后重发、空回复重发时已发出的块不变（无 `prefix-unstable`） |
| runtime.md 输出 114 | `wake.test.ts`：唤起后发出者撤回、改成不带唤起，或用户取消，只剩不带唤起的提醒时不发请求；有用户排的话时开一轮取它；用户在两轮之间接着跑、只有提醒时开一轮没有输入的 |
| runtime.md 输出 115 | `notice.test.ts`：缺省文字带来源行、恶意 `label`（换行、`]`）仍是一行、正文转义；Profile 的 `render` 能换 |
| runtime.md 输出 116 | `wake.test.ts`：空闲时带唤起开运行、`by` 是发出者；最后一条回复生成时到达、收口后开；压缩期间用户发话又有唤起时只开一次、记成用户；重新装配挡住、装好后开；模型不可用时不开、恢复模型不开 |
| runtime.md 输出 117 | `wake.test.ts`：用户停止（含宽限期交卷）、出错、直接关闭句柄、进程收尾时交卷、重开恢复后门关、不唤起，提醒随用户下一句话进请求；只回退、换分支、压缩（成功、失败、被停）不动门；`start`、`resume`、`release`、用户异步回答、`rewind{resend}` 开门；用户的话被取消后宿主的话开的后继不开门、`by` 是宿主；旧日志门关、新会话与 `fork` 门开；续跑后断尾重开按中断恢复 |
| runtime.md 输出 118 | `notice.test.ts`：当前叶子只有提醒时预览出一轮没有输入的、不写事件、不改门；历史叶子不叠 |
| session.md 输出 27 | 重开后待发提醒与门一致；`fork` 不带提醒、门开 |
| profile.md 输出 21 | `helpers` 测试：同一边界的插话合成一块、跨边界不合 |
| sessions.md、conversation.md 的新条目 | `sessions.test.ts`（快照摘要有界、`removeNotice`、浏览器没有 `notice`、v1 窗口得 `version-changed`）、转录与 dom 测试、`agent-conversation.e2e.ts`（宿主发提醒后在排队区出现、发话后成为过程里的一行；用户取消） |

## 验证

- 内核用真实内核与假模型，按 outline 断言请求里块的先后；计时走注入时钟。
- NeuroBook：真实服务端与浏览器跑 `agent-conversation.e2e.ts` 里新增的场景；Lab 场景截图（亮色）。
- 未验证边界：真实模型对 `<system-reminder>` 的反应（提示词效果）。

## 不做与风险

- 不做：取走后请求没发出去就放回（开发者接受）；提醒的过期（发出方自己撤回）；把扩展的外部事实改成提醒（两者并存）；`followups: "all"`（待确认）。
- 风险：插话改在压缩之后取，边界压缩不再把它压进摘要；溢出时仍会。
- 风险：门让“停过之后后台结果不再唤起”成为常态，用户不发话时结果一直等着；排队区要让用户看得见待发的提醒。
- 风险：旧日志的门按关算，升级前的会话第一次要用户开起运行之后才能被唤起。
- 依赖：插件经 `agentKey` 拿到的会话视图现在不随插件停用作废（`agent/sessions.md` 输出 21 只写了门面作废；提案第二轮审查第 16 条，分在 t22）；在那之前，停用的插件仍能经事先拿到的视图发提醒，与它现在能经旧视图 `send` 相同。
