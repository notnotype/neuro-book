# t14 Spec 晋升的逐句核对与处理（2026-11-19）

开发者 2026-11-19 批准晋升（“可以晋升”）。范围是本 Task 在已实现的 Spec 里加的“（planned）”标记：认法是对 master 上的标记行做 `git blame`，落在本 Task 改 Spec 的 9 个提交上的算（5cb584b1f 9fd301160 2c8d4c5db 2ab5738cb 8a8ce3bc7 003715971 2d16b6acf eb7a2a15e a5fd38728）。`sessions.md` 输出 20 的标记属于 w00046，不在范围内。`harness/runtime.md` 与 `harness/session.md` 本来就是整份 `planned`、多个 Task 逐步补齐，按计划不改成熟度；runtime 里“会话头 `owner`”的两处标记属于 t06，留着。

核对按句子列“实现 → 测试断言 → 能不能区分成立与否”，换了模型：

- 后端：sessions、subagents、jobs、builtin-profiles 共 13 处标记，交给 omp（默认模型）核对（[报告](promotion-check-backend-omp.txt)）。共 79 句：可去标记 33 句，留 43 句（缺断言 33 句、与实现字面不符 10 句），要改写 3 句。
- 前端：conversation、对话视图共 20 处标记，交给 Claude Sonnet 核对（[报告](promotion-check-frontend-sonnet.txt)）。共 96 句：可去标记 66 句，留 30 句（缺断言 29 句、不一致 1 句）。

## 补的测试（提交 8d457d74b，合并 5f91e2f7c）

| 文件 | 守住的句子 | 变异检查 |
|---|---|---|
| `session-host.test.ts`“留着的话与继续”加 6 例、改 1 例 | 恢复方式在点继续时现读；宿主排的话标出发出者与 `editable: false`；停止清空的条数算上宿主的话；合并时不把宿主的话并进来、宿主的话先跑，合成的一条写“前面还有 1 条”；没有用户留着的话时写字照常发；运行中插话不合并；中断时先 `start` 再合成发出，`input-stale` 时只重发合成的那条、不重做 `start`；继续进行中 `continuing` 为真；`start` 失败就停下并说明原因；第二步之前运行已收口就不再发；空着继续被拒时不把合成的文字放回输入框；结果未知时重发沿用 `commandId` 与 `replaces`；等你处理的活动与会话行 | 5 处（合并时连宿主的一起并、只数用户自己的条数、去掉 `runResult` 检查、被拒时放回合成的文字、去掉 stale 重试）都抓到 |
| `shared/settings.test.ts`（新） | 恢复方式只在用户层、缺省合并、只认三种值；分区与三项的文案 | — |
| nb-agent-ui：`kernel-transcript.test.ts`、`AgentConversationView.dom.test.ts`、`AgentConversationComposer.dom.test.ts`、`AgentQueuedMessages.dom.test.ts` | 按路径重建时按 `commandId` 清掉乐观消息；视图写“前面还有 N 条”与“发送中”；不允许发送时“继续”不可用；运行中有留着的话时占位文字照运行中写；菜单开着时 `stopClearing` 变空，之后箭头再出现时菜单不会自己打开；标签写“补充说明”“排队” | 菜单那条第一版没抓到：箭头卸掉时菜单本来就会关；改成断言“箭头再出现时菜单不会自己打开”后抓到 |
| `sessions.test.ts` 加 1 例 | 远程快照的 `state`、`by`、`cause`、`heldBy` 与 `input`；`send` 的 `placement`；远程 `resume{followups}`（插话改成排队）与 `release`（按条）的结果；`nothing-to-resume` 与 `nothing-to-release{ids}`；`activity` 与 `activityChanged` 列出 `held`，宿主自己能放行的留着的话不列 | — |
| `tasks.test.ts` | 来源 `at` 原样记下 | — |
| `subagents.test.ts` 加 2 例、补 1 句断言 | 父会话中止时以父会话的身份连带停前台子代理（`runEnded.stoppedBy` 与 `heldBy` 都是父会话）；父 Agent 停的子代理，再带话时先放行父会话自己排的话、再跑新话；`held-by-user` 的结果写明只有用户能放行 | — |
| `jobs.test.ts` 加 1 例 | 等待只认就绪的插话：别的宿主留着的插话不算；放行出来、仍是插话的算到达（真实内核与会话句柄表） | 2 处（快照不看状态、去掉放行的监听）都抓到 |

补测里核对出一处 Spec 写错：父会话不能放行用户排的话，即使这句话是父会话停下时留下的（`harness/runtime.md` 输出 105 的表），原来打算断言的“父会话再发话时放行它们”只对父会话自己排的成立，用例按这一点拆成两条。

## 改 Spec 贴实现（字面不符的）

- `conversation.md` 输出 50：
  - 原写“两步各用按这次操作固定的 `commandId`”，改成实现的做法：只有合成的那一条结果未知时，重新发送沿用原 `commandId` 与参数；`start` 结果未知按失败处理。
  - 补一句 Spec 漏写的：中断且写了字时，合并方式同样先 `start`。
- `sessions.md`：
  - 输出 21：“会话的身份只给 `nbook.agent` 自己”写明子代理在内部取句柄、不经 `agentKey`；“冒充不了别的插件”收窄为“门面不接受自填的插件身份”。
  - 输出 22：用户的条目不带 `by`；只有因停止留着的条目带 `heldBy`。
  - 第 52、71、127 行的行内改写提示，按输出 21 写成当前行为。
- `subagents.md` 输出 10：
  - 不带话时先试 `start`、接不着就只 `resume`。
  - 插进在跑的运行时，认那次运行的任务；排在收口之后的，按 `inputConsumed.runId` 认。
  - “不登记新任务”限定为“受理时就留着，或排在收口之后又转成留着”的话。
  - 总时长写明剩下的秒数向上取整。
  - 同一刻被取走时，名额已满就不登记。
- `builtin-profiles.md` 输出 9：取消条件写成 `runId` 为空、取消失败记诊断。
- 对话视图：颜色、宽度、虚线框这类画法挪进组件说明（`AgentQueuedMessages.md`、`AgentConversationComposer.md`），Spec 只留行为。

## 按分层测过、不另补的

- `sessions.md` 输出 22 的 `not-allowed`、`held-by-user` 经远程交回：浏览器总是用户，走不到这两个码。内核有逐格的权限用例，远程层原样转交结果（`backend/remote.ts` 的指令表）。
- `sessions.md` 输出 22 的“完整的输入（含附件）”：远程快照整份透传，新用例断言了 `input` 原样；附件随条目进转录器、合并时随文字保留，这两处由 `resume-merge.test.ts` 与 `kernel-transcript.test.ts` 守住。
- `subagents.md` 输出 10 的 `async`：和 `queue` 走同一个前台判断（`foreground = !queue && async !== true`），`queue` 那支有用例。
- `subagents.md` 输出 10 按 `inputConsumed.runId` 认任务：“只压缩时前台等到被取走再登记”那例里，认错运行时任务跟不到完成，用例会失败。

## 仍标“（planned）”的句子（实现在，没有能区分的断言；造这些时序的代价高，留作后续）

- `sessions.md` 输出 21：门面还在、服务正在停止时得 `unavailable`。`agent.ts` 接停止门的接线从测试世界碰不到，是已知缺口。
- `subagents.md` 输出 10 共 6 处：
  - 叶子上有父会话能接着跑的运行时，接着跑它；
  - 被用户停止的写明只有用户能接着跑；
  - 留着原因的四种写法；
  - 前台等去向时受超时与插话约束、转成留着时写明、等不到时同后台；
  - 同一刻被取走的登记任务后中止；
  - 受理时就留着的写明原因。
- `builtin-profiles.md` 输出 9：标题会话有运行在跑时不发；没开起运行时取消、不提示用户。

## 结果

| Spec | 本 Task 的标记 | 去掉 | 留下 |
|---|---|---|---|
| `agent/conversation.md` | 9 | 9 | 0 |
| `ui/agent-conversation-view.md` | 11 | 11 | 0 |
| `agent/sessions.md` | 7 | 7（另拆出 1 句留着） | 1 |
| `agent/subagents.md` | 2 处、跨多句 | 输出 16 整句与输出 10 的大部分 | 6 句 |
| `agent/jobs.md` | 3 | 3 | 0 |
| `agent/builtin-profiles.md` | 1 | 第一句 | 2 句 |

各 Spec 的证据节补了本 Task 的批准依据与新测试。
