---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: bots.main-conversation
owners:
  - nbook.bots
---

# bot 的主对话

## 目标与非目标

每个 bot 有一条常驻的主对话：用户不开、不切，`nbook.bots` 在服务端建它、持有它，浏览器只经远程方法拿到它的会话 id。主对话是一个普通的 Agent 会话，会话头带归属，靠压缩维持长度。

不承诺：

- 服务端重启后不自动接着跑被中断的那一轮，等用户点继续。
- 等用户的事项没有期限，到点不会自己结算。
- 主对话不绑作品，`project://` 不可用。
- 第一版只量打开耗时，不做检查点快照与按窗口取历史；重新装配的耗时不量。
- 主对话能不能写（只读、日志损坏）以会话自己的快照为准，bot 服务不另报；只读解除时没有推送，要重取快照才知道。持有中日志写失败（`log-broken`）后，要重启服务端才能恢复。
- 界面（bot 视图、头像、未读与最后看到的位置）不在这里。

## 术语与参与者

- **主对话**：一个 bot 的常驻会话，会话头 `owner` 是 `{plugin: "nbook.bots", id: <bot id>}`。
- **持有**：`nbook.bots` 经 `agentKey.hold` 拿着主对话的引用，会话因此不会空闲关闭（[`agent/sessions.md`](../agent/sessions.md) 输出 24）。

## 输入与前置条件

- 远程方法 `ensureMain({botId})` → `{sessionId}`（服务 `nbook.bots/bots`，[`bots.md`](bots.md) 输出 7）。
- 依赖：`agentKey` 的 `header`、`create`（带 `owner`）、`hold`（[`agent/sessions.md`](../agent/sessions.md) 输出 23–28）。

## 输出与可观察行为

1. 主对话的 id 是 `bot-<bot id>`。`ensureMain({botId})` 幂等，按顺序：
   1. 已持有就直接交回；
   2. 读会话头（不打开会话）：会话在、`owner` 是这个 bot 时去持有（输出 2）；会话在、`owner` 不是这个 bot 时得 `owner-mismatch`，不打开、不改动那个会话；
   3. 会话不在时建它：Profile 是 bot 记录里的 `profile`，`owner` 的 `id` 是 bot id，没有主项目；建时得 `session-exists`（别处刚建了）就回到第 2 步。

   交回 `{sessionId}` 时已经持有它。同一个 bot 的并发 `ensureMain` 串行，后到的交回同一个结果。会话头读不懂（`log-corrupt` 等）时交回那个码，不当成会话不在。
2. 持有：后台任务（[`bots.md`](bots.md) 的“时序与寿命”）对每个已建的 bot 先读会话头，主对话在、归属对时调 `hold`；还没有主对话的等 `ensureMain`；归属不对的记 `failed{code: "owner-mismatch"}`。持有到 `nbook.bots` 停止。`hold` 得 `session-busy` 时每 5 秒重试；别的码记进状态（输出 3），下一次 `ensureMain` 再试。
3. 主对话的持有状态随 `list()` 交回、变了推 `botsChanged`：

   | 状态 | 含义 |
   |---|---|
   | `{state: "none"}` | 还没建 |
   | `{state: "opening"}` | 正在建或打开 |
   | `{state: "held"}` | 已持有 |
   | `{state: "failed", code}` | 没能持有：`header`、`create`、`hold` 交回的码，或 `owner-mismatch` |

   `held` 只说明会话开着、被持有；会话是不是只读（例如 Profile 解析不到）、日志有没有损坏，看会话的快照与状态帧（[`agent/sessions.md`](../agent/sessions.md)）。
4. Profile 解析不到：主对话照会话的规则以只读打开（[`harness/session.md`](../harness/session.md) 的 `unknown-profile`），持有照样成功。用户经会话的 `changeProfile`（远程合同带 `commandId`）换成能用的 Profile。
5. 归属的后果按 [`agent/sessions.md`](../agent/sessions.md)：主对话不进会话列表，它派的子代理也不进（输出 25）；`rewind`、`switchBranch`、`archive` 得 `owned-session`（输出 26）；子代理与 fork 出来的会话没有归属。用户在主对话里发话照常走 `send`，可以带 `settlePending: "deny"`（输出 27）。
6. 长会话的指标：`hold` 实际打开了会话（不是复用已开的）时写一条诊断 `bots.main-opened`（info），带事件数（快照的 `head`）与打开耗时（会话表执行这次打开的时长，毫秒）；超过 2,000 毫秒时另写 `bots.main-open-slow`（warning）。重试的等待不算进耗时；刚由 `ensureMain` 建出来的会话已经开着，不记。
7. **未读与看到。** 计数消息是主对话里一次模型回复的最终那一条（`assistant` 事件里不带工具调用的；中间调工具的几条不算）。“看到”是一个日志 seq，每个 bot 一份，存在 `nbook.bots` 的插件存储（`bots-seen`，应用级），几个窗口共用，只进不退：
   - `list()` 的项带 `unread`（“看到”之后的计数消息数）、`latestSeq`（最新一条计数消息的 seq，没有未读时等于 `seenSeq`）、`seenSeq`；持有主对话、数完之前 `unread` 为 null；
   - 持有之后先订阅日志帧、再从“看到”之后读日志补数，按 seq 去重；之后每来一条计数消息推一次 `botsChanged`；补数失败写诊断 `bots.unread-failed`，`unread` 留在 null；
   - 远程方法 `markSeen({botId, through})` → `{seenSeq}`：`through` 截到 `latestSeq`，比已存的小时不动；`unknown-bot`；存储写不了得 `storage-failed`，记录读不懂时重写它；
   - 按 seq 算：有归属的会话不改写历史（[`agent/sessions.md`](../agent/sessions.md) 输出 26），seq 在当前路径上只增不减。

## 状态与转换

持有状态（输出 3）的转换：`none` →（`ensureMain`）→ `opening` → `held` | `failed`；`failed` →（下一次 `ensureMain`）→ `opening`。启动时后台任务把已有主对话的 bot 从 `none` 带到 `opening`。

时序与寿命：

- `ensureMain` 交回时主对话已持有；之后浏览器订阅它的帧与发指令走 `nbook.agent/sessions`。
- `nbook.bots` 停止时放掉全部持有（[`bots.md`](bots.md) 的“时序与寿命”）。服务端停止时 `nbook.agent` 同时在停，照 [`agent/sessions.md`](../agent/sessions.md) 输出 14 按 `interrupted` 关闭会话，持有不推迟关闭，之后的 `release()` 什么都不做（输出 24）。停止期间到的 `ensureMain` 得通道的 `unavailable`；已经在途的，封住之后得 `provider-error`。
- 服务端重启后，被中断的运行在打开主对话时照会话的恢复以 `interrupted` 收口，不自动接着跑。

## 副作用与数据

主对话存在 `nbook.agent` 的会话库里：`<状态根>/agent/sessions/bot-<bot id>/`，会话头带 `owner`。`nbook.bots` 不另存主对话的数据。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `owner-mismatch` | 会话库里已有同 id 的会话，但不归这个 bot | 不自动处理；告诉用户，由用户决定 |
| `unknown-bot` | 没有这个 bot | 重新 `list()` |
| `session-busy`、`log-corrupt`、`log-broken` 等 | `header`、`create`、`hold` 的码（[`agent/sessions.md`](../agent/sessions.md)） | 按状态里的码说明；`ensureMain` 再试，`log-broken` 要重启服务端 |

## 边界与兼容

- 公开接口：远程方法 `ensureMain` 与持有状态的形状；主对话的 id 规则 `bot-<bot id>`。
- 信任边界：浏览器是用户本人；主对话的 `owner` 只有 `nbook.bots` 建得出（[`agent/sessions.md`](../agent/sessions.md) 输出 23）。

## 验收与 Smoke

1. 全新的状态根启动：`list()` 里 `lyra` 的主对话是 `none`，没有 `bots.main-opened`。经远程调 `ensureMain`：建出 `bot-lyra`，会话头 `owner` 是 `{plugin: "nbook.bots", id: "lyra"}`，Profile 是 `nbook.bots.companion`，状态 `held`；并发两次交回同一个 id；不在会话列表里。同一个状态根重启、不调 `ensureMain`：后台任务重新持有它，状态 `held`，有一条 `bots.main-opened`。
2. 会话库里预先有一个 id 为 `bot-lyra`、不归它的会话（带没收口的运行）：后台任务与 `ensureMain` 都得 `owner-mismatch`，那个会话的日志字节不变。
3. 用户在主对话里等审批时带 `settlePending: "deny"` 发一句：审批以 `deny` 结算，bot 接着处理这句话；远程 `rewind` 得 `owned-session`。
4. 重启后冷打开的耗时（注入时钟）恰好超过 2,000 毫秒：有 `bots.main-open-slow`，事件数是快照的 `head`；另一个调用方先打开、`hold` 复用时不记。

Smoke：`packages/neuro-book/src/plugins/bots/` 的插件测试（真实内核、真实 `nbook.agent`、本机假端点）。

## 实现合同

- **公开入口**：`nbook/plugins/bots/shared/contracts`（远程合同 `botsContract` 的 `ensureMain`、`markSeen`、`list` 与 `MainState`、`BotItem`，`mainSessionId`）。
- **owner 与依赖方向**：`nbook.bots` 的服务端入口持有主对话的持有与未读；经 `agentKey` 的 `header`、`create`、`hold` 用 `nbook.agent`（[`agent/sessions.md`](../agent/sessions.md) 输出 23–28）；`nbook.agent` 与 nb-harness 内核不认识 bot，只提供会话头的 `owner` 与持有。
- **关键不变量**：
  - 同一个 bot 的 `ensureMain` 与后台持有排成一条链：并发的依次跑，后到的看到已持有就交回同一个结果，只 `hold` 一次（输出 1，`backend/main.test.ts`）。
  - 先读会话头再决定建还是持有：会话在而 `owner` 不是这个 bot 时得 `owner-mismatch`，不打开、不改动；读不懂的会话头不当成会话不在（输出 1、2，`bots.test.ts`“主对话验收 2”、`backend/main.test.ts`）。
  - 持有到 `nbook.bots` 停止：`session-busy` 每 5 秒重试，别的码记进状态、不排重试，停止信号之后不再重试、迟到的持有立即放掉（输出 2，`backend/main.test.ts`）。
  - 打开耗时只算实际打开的那一次，复用已开的与重试的等待不记（输出 6，`backend/main.test.ts`）。
  - 未读只数最终回复、按 seq 算，“看到”只进不退，存在插件存储里、重启后照样数出来（输出 7，`bots.test.ts`“主对话的未读”）。

## 证据

- 批准依据：[提案：NeuroBook 的 bot](../../proposals/neurobot.md)（2026-11-18 接受）第四节第 5、7 小节与 2026-11-19 的决策记录；[w00043 t06](../../../.agents/works/w00043-neurobot/tasks/t06-main-conversation/README.md) 的决定与设计审查的处理；未读与看到（输出 7）见 [w00043 t15](../../../.agents/works/w00043-neurobot/tasks/t15-messages-view/README.md)；开发者 2026-11-20 批准晋升为 `implemented`，逐句核对后晋升（[核对处理](../../../.agents/works/w00043-neurobot/tasks/t06-main-conversation/evidences/promotion-check-disposition.md)）。
- 实现入口：[`backend/main.ts`](../../../packages/neuro-book/src/plugins/bots/backend/main.ts)（`ensureMain`、持有、指标）、[`backend/unread.ts`](../../../packages/neuro-book/src/plugins/bots/backend/unread.ts)（未读与看到）、[`backend/plugin.ts`](../../../packages/neuro-book/src/plugins/bots/backend/plugin.ts)（远程服务）、[`shared/contracts.ts`](../../../packages/neuro-book/src/plugins/bots/shared/contracts.ts)；会话头归属与持有在 [`agent/backend/agent.ts`](../../../packages/neuro-book/src/plugins/agent/backend/agent.ts) 与 nb-harness 的 [`kit/sessions/table.ts`](../../../packages/nb-harness/src/kit/sessions/table.ts)
- 合同测试：[`bots.test.ts`](../../../packages/neuro-book/src/plugins/bots/bots.test.ts)（输出 1–7 与验收 1–3；输出 7 是“主对话的未读”）、[`backend/main.test.ts`](../../../packages/neuro-book/src/plugins/bots/backend/main.test.ts)（输出 1–3、6 与时序与寿命）、[`backend/service.test.ts`](../../../packages/neuro-book/src/plugins/bots/backend/service.test.ts)（启动先后）；验收 3 的 `owned-session` 在 `bots.test.ts`，`settlePending` 的结算由 [`agent/sessions.test.ts`](../../../packages/neuro-book/src/plugins/agent/sessions.test.ts)（输出 27）与 nb-harness 的 [`kernel/run/interaction.test.ts`](../../../packages/nb-harness/src/kernel/run/interaction.test.ts)（验收 16）守住；验收 4 的耗时口径在 `backend/main.test.ts`（输出 6）
- Smoke：[`bots.test.ts`](../../../packages/neuro-book/src/plugins/bots/bots.test.ts)（真实内核、真实 `nbook.agent`、本机假端点）
