# t41 实施计划：缓冲区的提醒级、唤起与会话级的门

## Context

后台任务结束、子代理有话问父 Agent、eval 的内核被回收，这些要告诉模型的事现在没有入口；Agent 空闲时也没人唤起它。已接受的[提案“统一后台任务”](../../../../../docs/proposals/unified-background-tasks.md)与 [ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md) 定了方向：缓冲区多一级“提醒”，可以唤起，唤起的门挂在会话上。本 Task 只做 nb-harness 内核与 NeuroBook 的接线（远程、转录、对话视图）；谁来发提醒（结果送达、eval、子代理提问）在 t22。

依据：开发者在 [README](README.md) 的决定 1–5（缓冲区三级、用户发话、followup 批量、Profile 的 `queue`、取消与恢复）；提案第四节第 1 小节的 8 条规则；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 2–7、24、28–31、36、42、85、88、103–111；[`harness/profile.md`](../../../../../docs/specs/harness/profile.md) 输出 6、7、13；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 输出 7、24。

探针（[README](README.md) 的“探针”、[输出](evidences/probe-outputs.txt)）：边界的先后是“外部事实 → 工具集 → 取插话 → 解析模型 → 压缩 → 组请求”；内核按状态给对话事件盖位置章，一轮还没回复时是附带内容（请求里排在这一轮的新话前面），有回复后是“最后一步之后”；收口批只开一个后继运行、有用户时记成用户的（E5）；现在宿主在停止受理后的话会在收口后开一次运行（E4）。

工作方式：主会话写；计划交 omp 设计审查（阻塞）；内核三片做完交 omp 实现审查，NeuroBook 一片交 Sonnet。

## 技术选型

无。

## 关键设计

### 内核的接口：`packages/nb-harness/src/kernel/api/`（`host.ts`、`events.ts`、`kernel-events.ts`）、`extension/profile.ts`

- 指令：
  - `notice({text, key?, wake?})` → `{noticeId, replaced?}`。只收会话与宿主（用户得 `not-allowed`：用户的话本来就是新话）。正文按 UTF-8 至多 32 KiB（`notice-too-large`）；会话里待发的提醒合计至多 128 KiB（`notice-budget`）。同一发出者带同一个 `key` 的替换还没取走的那条。
  - `removeNotice({noticeId})`：用户能取消任何一条，会话与宿主只能撤回自己发的；不在待发里得 `notice-not-found`（取走了的另给 `notice-taken`）。
- 事件：会话级 `noticeQueued{id, by, key?, text, wake, commandId}`、`noticeRemoved{ids, by, reason: "replaced" | "withdrawn" | "cancelled"}`、`noticeTaken{ids, runId}`、`wakeGate{open, cause?}`；路径级对话事件 `hostNotice{id, by, text}`；`runStarted` 加 `wake: true`（唤起开的）。新事件名让旧内核打开时得 `log-corrupt`（[`harness/session.md`](../../../../../docs/specs/harness/session.md) 输出 7，第二轮审查已实测）。
- 快照加 `notices: [{id, by, key?, text, wake, queuedAt}]` 与 `wakeGate`。
- Profile 加 `queue?: {order?: ["notice", "steer"] | ["steer", "notice"]; followups?: "one" | "all"}`，缺省 `["notice", "steer"]`、`"one"`。

### 状态：`state/kernel-state.ts`

会话级归约多两样：待发的提醒（`noticeQueued` 加、`noticeRemoved` 与 `noticeTaken` 删）与门（`wakeGate`，没有事件时是开的：新会话与旧日志都按开处理——旧日志里的会话之后要被唤起，先得有后台任务属于它，而任务表随进程清空、重启后的新任务要用户先发话，开门是安全的）。都只由会话级事件归约，不读路径事件（同缓冲区提案）。

### 发提醒与取走：`run/commands.ts`、`run/loop.ts`、`session/preview.ts`

- `notice` 在单写者里受理：写 `noticeQueued`（替换时同批 `noticeRemoved{replaced}`）。带 `wake`、会话空闲时按下面“唤起”的规则判，开得起就同一批开运行。
- 取走在边界第 3 步、与取插话同一个队列项：先把全部待发的提醒按发出先后写成 `noticeTaken` 加每条一个 `hostNotice`，再写插话。于是一轮还没回复时它们是附带内容、排在新话前面，有回复后在插话前面；压缩、回退、fork 对它们与对插话一样。只压缩的运行不到这一步，不取。停止受理之后到这一项的不取（同插话，输出 30）。
- 预览把待发的提醒按同样的位置投影进去，不写事件。
- 不做“取走后那次请求没发出去就放回”：插话也没有，开发者接受这个限制，裁历史的 Profile 自己注意。

### 唤起与门：`run/settle.ts`、`run/commands.ts`、`run/interaction.ts`、`run/tree.ts`、`session/recover.ts`、`run/loop.ts`

- **关门**：收口批里，有停止的受理（`stop !== null`，不论之后怎样收口，含宽限期里交卷的 `finished`）或收口方式是 `error`、`interrupted` 时写 `wakeGate{open: false, cause}`；打开会话时的恢复写 `runEnded{interrupted}` 时同样。正常收口（`completed`、`finished` 且没有停止）不动门。
- **开门**：用户发起、并且真的开起或接着跑一次对话运行的那个受理批里写 `wakeGate{open: true}`：空闲时的 `send` 与用户的 `enqueue`、在暂停的叶子上接着跑、`start`、`resume`、`release`、用户的异步回答、`rewind{resend}`；推迟到收口的用户的话在收口批里真正开起运行时。被拒、开不起运行、只放进缓冲区的不开门。回退、换分支、压缩不动门。
- **唤起**：会话空闲、门开着、叶子上没有暂停的运行、开得起运行（不是只读、没有待做的重新装配、没在关闭）、有带 `wake` 的待发提醒时，开一次运行：`runStarted{by: 最早那条带 wake 的发出者, wake: true}` 与 `turnStarted{inputId: null}`。判定在两处：`notice` 受理时；每个收口批在推迟的指令之后——推迟的话开了运行就由它开、提醒随它的第一次请求带上，没有才由唤起开。一次收口至多开一次。
- **空的唤起不发请求**：唤起开的运行到第一个边界取完之后，这一轮既没有提醒、也没有插话与新话（发出者在这之前撤回了、用户取消了），就以 `completed` 收口，不发模型请求。

### Profile 的 `queue`：`view/format.ts`、`helpers/turns.ts`、`run/loop.ts`

- `order`：缺省的 `format.turn`、`format.step` 在附带内容与每一步之后的事件里，把 `hostNotice` 与 `steer` 按声明的先后排，其它事件保持原位、在它们前面（它们在边界的第 1、2 步就写了）。Profile 自己写 `turn`、`commit` 时自己排。
- `followups: "all"`：一轮正常结束取排队时，取最早的一条和紧接着的、同一发出者的就绪排队，合成一条输入（各条按入队顺序、之间空一行，附件随各自的文字），每条各写一个 `inputConsumed`，`input` 记 `merged: [ids]`；不同发出者的不合在一起（审批材料按发出者区分）。缺省 `"one"` 同现在。
- 辅助函数 `mergeSteers(turn)`：把每一步之后、附带内容里相邻的 `steer` 的文字合成一块（第一条的来源，空一行分隔，附件保留），给 `turn`、`commit` 用。

### 渲染：`view/format.ts`

`hostNotice` 的缺省文字是 `<system-reminder>` 包着一行来源说明 `[系统 · <label>]` 与正文；正文里的 `<system-reminder>`、`</system-reminder>` 转义。来源行的格式与 bot 提案的宿主消息共用一处定义（[`neurobot.md`](../../../../../docs/proposals/neurobot.md) 第四节第 6 小节，w00043 t10 未做时以本处为准）。Profile 的 `render` 能换它的文字。

### NeuroBook：`packages/neuro-book/src/plugins/agent/`（`shared/remote.ts`、`backend/remote.ts`）、`packages/nb-agent-ui/src/kernel-transcript.ts` 与对话视图

- 远程 `nbook.agent/sessions` 升到版本 2：快照带 `notices` 与 `wakeGate`；新写方法 `removeNotice({sessionId, noticeId})`（用户）。插件经 `agentKey` 拿到的会话视图自动有 `notice`、`removeNotice`，发出者照现在按调用方盖章（[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 输出 21）。
- 转录：`noticeQueued`、`noticeRemoved`、`noticeTaken` 维护待发列表；`hostNotice` 是过程里的一行。
- 对话视图：排队区列出待发的提醒（来源与一行摘要，可取消，取消走 `removeNotice`）；取走后在消息流里是一行“提示 · <来源> · <摘要>”，点开看全文；门关着、有待发提醒时排队区头上写“你继续时一起送出”。Lab 加场景。

## Spec 与文档改动

先在 master 写成 planned：

- `harness/runtime.md`：新输出 112 发提醒（指令、发出者、上限、`key`、撤回与取消）、113 取走（位置、先后、只对话请求、停止后不取、预览）、114 缺省的样子、115 唤起（条件、两处判定、收口时一次、空的不发请求）、116 门（关、开、初值）、117 `followups: "all"`；术语加“提醒”“唤起”“门”；失败码表加 `notice-too-large`、`notice-budget`、`notice-not-found`、`notice-taken`；“状态与转换”补门的状态。
- `harness/session.md`：新输出 27 新事件与字段（同输出 24 的写法）。
- `harness/profile.md`：新输出 21 `queue.order` 对缺省 `format` 的作用、22 `mergeSteers`；输入表加 `queue`。
- `agent/sessions.md`：快照与 `removeNotice`、合同版本 2。
- `agent/conversation.md`、`ui/agent-conversation-view.md`：排队区的提醒、取走后的那一行、门关时的说明。

## 切片

1. **Spec（planned）**：上一节，提交到 master。
2. **提醒的发与取**：接口、事件、状态、`notice`、`removeNotice`、第 3 步取走、渲染、预览、快照。验证：nb-harness 新合同测试 `run/notice.test.ts`（真实内核、假模型），`bun test src/kernel`、typecheck。
3. **门与唤起**：收口批关门与仲裁、各开运行入口开门、恢复关门、唤起与空运行。验证：`run/wake.test.ts`，探针 E4、E5 的情形写成用例。
4. **Profile 的 `queue`**：`order`、`followups: "all"`、`mergeSteers`。验证：`view/format` 与 `run/loop` 的合同测试。第 2–4 片做完交 omp 实现审查。
5. **NeuroBook**：远程版本 2、转录、对话视图、Lab 场景。验证：`sessions.test.ts`、nb-agent-ui 转录测试、dom 测试、`e2e/agent-conversation.e2e.ts` 覆盖的文件。交 Sonnet 前端审查。

每片跑 `bun run test:affected` 与 typecheck，各自提交；合入 master 后 t22 才开始用提醒。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| runtime.md 输出 112 | `notice.test.ts`：会话与宿主能发、用户得 `not-allowed`；两种上限；同 `key` 替换；撤回与用户取消；取走后撤回得 `notice-taken` |
| runtime.md 输出 113 | `notice.test.ts`：空闲时发、下一次请求排在新话前面（outline 断言）；运行中发、与同一刻的插话一起进下一次请求且在前；只压缩的运行不取；停止受理后不取；回退、换分支后待发的照样在；预览显示、不写事件 |
| runtime.md 输出 114 | `notice.test.ts`：缺省文字带来源行、转义；Profile 的 `render` 能换 |
| runtime.md 输出 115 | `wake.test.ts`：空闲时带 `wake` 开运行、`runStarted.by` 是发出者；不带 `wake` 不开；最后一条回复生成时到达、收口后开；压缩期间用户发话又有唤起时只开一次、记成用户；唤起后发出者撤回则不发请求；只读、暂停的叶子不开 |
| runtime.md 输出 116 | `wake.test.ts`：停止（含宽限期交卷）、出错（含循环保护、费用上限）、中断、重开恢复后门关、不唤起，提醒随用户下一句话进请求；只回退、换分支、压缩不开门；`start`、`resume`、`release`、用户异步回答、`rewind{resend}` 开门；被拒的发话不开门 |
| runtime.md 输出 117、profile.md 输出 21、22 | `format` 与 `loop` 的测试：`order` 反过来时插话在前；`"all"` 合同一发出者的连续排队、不同发出者分开；`mergeSteers` 合成一块 |
| session.md 输出 27 | 重开后状态一致（待发提醒、门）；旧内核读新事件拒读（在审查里实测过，写成用例：用旧格式的读者不可得，改为断言事件名登记与校验） |
| sessions.md 与 conversation.md 的新条目 | `sessions.test.ts`（快照、`removeNotice`、版本 2）、转录与 dom 测试、`agent-conversation.e2e.ts`（宿主发提醒后在排队区出现、发话后成为过程里的一行；用户取消） |

## 验证

- 内核用真实内核与假模型，按 outline 断言请求里块的先后；计时走注入时钟。
- NeuroBook：真实服务端与浏览器跑 `agent-conversation.e2e.ts` 里新增的场景；Lab 场景截图（亮色）。
- 未验证边界：真实模型对 `<system-reminder>` 的反应（提示词效果）。

## 不做与风险

- 不做：取走后请求没发出去就放回（开发者接受）；提醒的过期（发出方自己撤回）；把扩展的外部事实改成提醒（两者并存：外部事实随路径，提醒随会话）。
- 风险：门让“停过之后后台结果不再唤起”成为常态，用户不发话时结果一直等着；对话视图的排队区要让用户看得见待发的提醒。
- 风险：`followups: "all"` 合成的输入改变了“一轮一句话”的回退目标文字（回退目标显示合成后的那条）。
- 依赖：插件经 `agentKey` 拿到的会话视图现在不随插件停用作废（`agent/sessions.md` 输出 21 只写了门面作废；提案第二轮审查第 16 条，分在 t22）；在那之前，停用的插件仍能经事先拿到的视图发提醒，与它现在能经旧视图 `send` 相同。
