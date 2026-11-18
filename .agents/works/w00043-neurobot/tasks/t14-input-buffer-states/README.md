---
schema: nbook.task/v2
taskId: t14-input-buffer-states
status: active
updated: 2026-11-18
---

# Agent 内核的输入缓冲区：每条带状态

## 目标与范围

按已接受的 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 改 nb-harness 内核与 NeuroBook，对所有会话生效：
- 缓冲区条目的就绪与留着、回到空闲时剩下的留着（与收口同批写 `inputHeld`）、决定收口与写下收口在同一步、暂停的运行与 `runResumed`；
- 放行跟着新话走（编辑重发除外）、用户本人空闲时排的等于发送、压缩期间用户发的话压完接着跑、`resume`、`release`、`send` 的 `replaces` 与 `release` 及交回的去向、失败码；
- 宿主发出者、指令按发出者的权限、`runStarted` 与 `inputEdited` 记发出者；
- NeuroBook：`agentKey` 按调用方盖章且不收自填身份、`startTask` 与任务中心停止的发出者、`jobs/steer.ts` 只认就绪的插话；
- 对话视图：排队区的“已暂停 · 原因 · 继续”、输入框的入口、停止的两个选项、乐观消息按 `commandId` 确认、恢复方式的用户设置。

提案第三轮审查的 11 条（[处理](../t01-direction/evidences/buffer-proposal-review-r3-disposition.md)）是必须落下的项。

合同：改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)；另写 [ADR 0055](../../../../../docs/adr/0055-input-buffer-entry-states.md)（补充 ADR 0035）。

依赖：无。宿主 `start` 的“在自己持有的会话里”要用 t06 加的会话头 `owner`，那一处随 t06 补。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（2026-11-18 按已接受的 [bot 提案](../../../../../docs/proposals/neurobot.md) 与 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 重排）。

## 当前状态

2026-11-18 经 nbdev 新建；同日开工。

开工前先用真实内核跑探针，列出全部路径（[清单](evidences/kernel-path-inventory.txt)、[探针 1](evidences/probe-p1-idle-paths.test.ts.txt)、[探针 2](evidences/probe-p2-entries.test.ts.txt)、[输出](evidences/probe-outputs.txt)）：会话从有运行变成空闲 14 条路径（写 `runEnded` 的 8 种、不写却空闲的 5 种、正常结束接着跑 1 种），读缓冲区内核 11 处、内核外 4 处，放话进缓冲区的指令 5 个、调用方 12 处，16 条指令里只有 3 条收发出者。

清单第 6 节与提案假设冲突的 6 条，写 Spec 时按下面的实现定义落（主 Agent 定，与提案的意思一致，开发者有异议再改）：

1. 空闲判断以写下 `runEnded` 的那个队列项为准：`control.idle` 与 `runEnded`、`inputHeld` 在同一个队列项里翻转，之后受理的话按空闲处理（提案说的窗口实际延到收口批的反应写完之后）。
2. 停止时，清空列表在停止受理的那个队列项里读，与收口同批写 `inputRemoved`，不在空闲之后另排一项。
3. 异步提问的回答在空闲又开不起运行时，回答照样结算、提问不卡；这句回答转成留着，原因是开不起来的码，不让 `resolve` 失败（NeuroBook 的 `agent_answer` 依赖它成功）。
4. “中断或失败的那一轮”指叶子上最后一次没有正常结束的运行（中断、出错或暂停）；`start`、用户的 `resume` 接着跑它，宿主只能接着跑 `runStarted.by` 是它自己的那次，或会话头 `owner` 归它的会话。
5. 任务中心停子代理（远程的 `killJob`）按用户停的记，`children.ts` 不再换成父会话的身份。
6. kit 的标题会话以宿主身份发话，它缓冲区里留着的由它自己取消，不提示用户；不带原因的 `closeSession` 按中断处理（留着，原因“关闭”）。

写 Spec 时另定的五处（主 Agent 提出，开发者 2026-11-18“确认”）：

7. 运行不再取输入时（只压缩、停止已受理、已决定收口）会话、宿主的 `enqueue` 按空闲处理：留着、不放行、不开运行；用户的照提案压完接着跑。
8. 叶子上有暂停的运行、发出者不能接着跑它时，`send` 的话留着（去向 `held`），不开运行。
9. `start`（“按回车继续”“重试”）只接着跑叶子上最后一次没有正常结束的运行，不取留着的话；只有升级前旧日志里的就绪的话仍取第一条。
10. `send` 交回去向 `taken`、`later`、`held`；`taken` 的话在那次运行以交出结果收口时仍会转成留着，`agent_send` 等运行结束后按这句话后来的状态告诉父 Agent。
11. 恢复方式是合并、又有中断的运行时，“继续”先 `start` 接着跑，再在这次运行里 `send{replaces}`。

Spec 已按提案、实现定义与上面五处改好（`planned`）：`harness/runtime.md` 输出 103–110 等、`harness/session.md` 输出 24、`agent/sessions.md` 输出 21–22、`agent/conversation.md` 输出 47–48、`agent/subagents.md`、`agent/jobs.md`、`agent/builtin-profiles.md`、`ui/agent-conversation-view.md`；架构决定另写 [ADR 0055](../../../../../docs/adr/0055-input-buffer-entry-states.md)（补充 ADR 0035 决策 1；ADR 接受后正文不改）。

12. 插件经 `agentKey` 拿到的会话视图缺省以自己插件的宿主身份发话，可以明说代替用户发（`asUser`）；远程合同保持浏览器即用户（Spec 第一轮审查后端第 13 条，开发者 2026-11-18：“你这里权限没必要做这么死，我允许插件代替用户给 session 发送一条用户消息”）。
13. 新话是插话（补充说明）时照常在下一步插进当前这一轮，“留着的先跑”只指留着的排队先于新的排队（Spec 第一轮审查后端第 17 条，开发者 2026-11-18“同意按推荐”）。

14. 计划第一轮审查后主 Agent 定的四处（`resume` 只接着跑中断与暂停的运行；旧日志没有发出者的运行按用户算；恢复方式放进“运行可靠性”分区；只标打开着的会话里只有用户能放行的留着的话）与[计划](plan.md)，开发者 2026-11-18“可以，用 /autonomous-delivery 推进这六片”。

实施中发现：

- `runResumed` 写成路径事件会挂在叶子上，破坏“接着跑之后的请求与原来那次是兄弟”（重试与 swipe，runtime 输出 36）；改成会话级事件，`session.md` 输出 24 随之改。
- 现有缺口（不是本 Task 引入，master 上同样复现）：工具执行中调用 `preview()` 一直不交回。本 Task 不修，`preview` 的用例改在空闲时测；另建跟进。

- 收口批里推迟的话先随收口写 `inputHeld`、同一批里再被放行；`agent_send` 等去向时以 `inputFate` 为准，事件只作重查信号。
- 被停止的运行已经收口，之后别的发出者的新话照常开新运行；“受理时就留着”只出在回退出来的暂停运行上。

进展（分支 `feat/w00043-neurobot`，2026-11-18 合入 master）：

| 片 | 提交 | 审查 |
|---|---|---|
| 1 内核：条目状态与事件 | 52797139c | 内核实现审查（Opus，有效 11 条）已处理，修正 a1f22dd7f，[处理表](evidences/impl-review-kernel-disposition.md) |
| 2–3 内核：收口、停止、放行与去向 | bfaed9e53 | 同上 |
| 4 NeuroBook 后端 | d0f74ddf9 | 后端实现审查（Opus，11 条：阻断 1、重要 6、建议 4），修正 06e7d4526；修正的窄范围复审（Opus，7 条：重要 2、建议 5），修正 6239af5d9；[处理表](evidences/impl-review-backend-disposition.md) |
| 5 nb-agent-ui 与 nb-markdown | c4dbf6056 | 前端实现审查（Sonnet，14 条：重要 3、建议 11），修正 a867ae719 与之后两个测试提交；[处理表](evidences/impl-review-frontend-disposition.md) |
| 6 NeuroBook 界面 | 46d0612c3、629e598ad、a057c47fb | 同上 |

master 在实施期间改过转录器与内核的同一批文件，合并提交 1d7fe435e 把它并进分支（两处冲突，都是两边各加一段，保留两边）；合并后的验证：

- 类型检查：nb-harness、nb-agent-ui、neuro-book 都过。
- 单元与合同测试：nb-harness 全包 888 条，nb-agent-ui 284 条（bun）加 185 条（vitest），neuro-book `src/plugins/agent` 508 条，都过。
- e2e（合并后重建）：`agent-conversation`、`agent-subagents`、`lab-agent-ui` 共 77 条，76 条过；`agent-conversation` 的“按状态换场景”一次因测试端点连接被关（`fetch failed`）失败，单独重跑两次都过，归为环境。合并之前跑过的 `lab-scenes` 被已有的 ThemeEditor 404 挡在版面检查之前（分支起点上就有），新加的 8 个场景改用 `nbdev shot` 量，越界、焦点环与光晕都是 0；`agent-subagents` 验收 4 一次失败时另一位审查者正在同一个 worktree 跑测试，单独重跑两次都过。
- 截图（390 宽、亮色）：英文留着场景里原因先截断、Continue 完整；英文占位文字缩短到一行。

待开发者追认的决定见 Work 的[待确认清单](../../pending-confirmations.md)。

## 下一步

各 Spec 里本 Task 加的“（planned）”句子都有测试守着，晋升（去掉标记、`harness/runtime.md` 改 `implemented`、补实现合同与证据）按规则等开发者批准；批准后逐条核对再改。已知缺口：`agent.ts` 各入口接停止门的接线没有测试（测试世界从外面碰不到）；子代理“受理时就留着”“插话只认就绪”与 `afterLater` 的超时、插话、留着、取消几支按代码核对。
