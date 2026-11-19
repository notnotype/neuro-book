---
schema: nbook.spec/v1
kind: behavior
status: planned
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
- 界面（bot 视图、未读与最后看到的位置）不在这里。

## 术语与参与者

- **主对话**：一个 bot 的常驻会话，会话头 `owner` 是 `{plugin: "nbook.bots", id: <bot id>}`。
- **持有**：`nbook.bots` 经 `agentKey.hold` 拿着主对话的引用，会话因此不会空闲关闭（[`agent/sessions.md`](../agent/sessions.md) 输出 24）。

## 输入与前置条件

- 远程方法（服务 `nbook.bots/bots`，[`bots.md`](bots.md) 输出 7）：`ensureMain({botId})` → `{sessionId}`；`restoreProfile({botId})`。
- 依赖：`agentKey` 的 `create`（带 `owner`）、`hold`、`session`（[`agent/sessions.md`](../agent/sessions.md) 输出 21–26）。

## 输出与可观察行为

1. 主对话的 id 是 `bot-<bot id>`。`ensureMain({botId})` 幂等：
   - 会话不在时建它：Profile 是 bot 记录里的 `profile`，`owner` 的 `id` 是 bot id，没有主项目；
   - 建会话得 `session-exists`（建会话与上一次调用之间崩溃过）时打开核对会话头：`owner` 是这个 bot 时照常，不是时得 `owner-mismatch`，不改动那个会话；
   - 交回 `{sessionId}` 之前已经持有它（输出 2）。

   同一个 bot 的并发 `ensureMain` 串行，后到的交回同一个结果。
2. 持有：`nbook.bots` 激活完成之后，后台任务对每个主对话已经在会话库里的 bot 调 `hold`；还没有主对话的等 `ensureMain`。持有到 `nbook.bots` 停止。`hold` 得 `session-busy` 时每 5 秒重试；别的码记进主对话的状态（输出 3），下一次 `ensureMain` 再试。
3. 主对话的状态随 `list()` 交回、变了推 `botsChanged`：

   | 状态 | 含义 |
   |---|---|
   | `{state: "none"}` | 还没建 |
   | `{state: "opening"}` | 正在建或打开 |
   | `{state: "ready"}` | 已持有，能用 |
   | `{state: "read-only", code}` | 已持有但只读，例如 `unknown-profile`（Profile 解析不到） |
   | `{state: "failed", code}` | 打开失败，码同 `hold` |

4. Profile 解析不到：主对话照会话的规则以只读打开（[`harness/session.md`](../harness/session.md) 的 `unknown-profile`），状态 `read-only{code: "unknown-profile"}`。`restoreProfile({botId})` 以用户的身份把主对话换回 bot 记录里的 `profile`（`changeProfile`）；那个 Profile 也解析不到时得 `unknown-profile`，主对话不变。
5. 归属的后果按 [`agent/sessions.md`](../agent/sessions.md)：主对话不进会话列表，它派的子代理也不进（输出 25）；`rewind`、`switchBranch`、`archive` 得 `owned-session`（输出 26）；子代理与 fork 出来的会话没有归属。用户在主对话里发话照常走 `agentKey` 与远程合同的 `send`，可以带 `settlePending: "deny"`（输出 27）。
6. 长会话的指标：每次持有成功后写一条诊断 `bots.main-opened`（info），带事件数（日志最后一条的 `seq`）与打开耗时（从调 `hold` 到它交回，毫秒）；打开耗时超过 2,000 毫秒时另写 `bots.main-open-slow`（warning）。

## 状态与转换

主对话状态（输出 3）的转换：`none` →（`ensureMain`）→ `opening` → `ready` | `read-only` | `failed`；`failed` →（下一次 `ensureMain`）→ `opening`；`read-only` →（`restoreProfile` 成功）→ `ready`。

时序与寿命：

- `ensureMain` 交回时主对话已持有；之后浏览器订阅它的帧与发指令走 `nbook.agent/sessions`。
- `nbook.bots` 停止时先放掉全部持有，再由 `nbook.agent` 的停止关闭会话（[`agent/sessions.md`](../agent/sessions.md) 输出 14）；停止期间到的 `ensureMain` 得通道的 `unavailable`。
- 服务端重启后，被中断的运行在打开主对话时照会话的恢复以 `interrupted` 收口，不自动接着跑。

## 副作用与数据

主对话存在 `nbook.agent` 的会话库里：`<状态根>/agent/sessions/bot-<bot id>/`，会话头带 `owner`。`nbook.bots` 不另存主对话的数据。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `owner-mismatch` | 会话库里已有同 id 的会话，但不归这个 bot | 不自动处理；告诉用户，由用户决定 |
| `unknown-bot` | 没有这个 bot | 重新 `list()` |
| `unknown-profile` | `restoreProfile` 时预设的 Profile 也解析不到 | 查 `nbook.bots` 的安装 |
| `session-busy`、`log-broken` 等 | `hold` 的码（[`agent/sessions.md`](../agent/sessions.md) 输出 24） | 按状态里的码说明；`ensureMain` 再试 |

## 边界与兼容

- 公开接口：远程方法 `ensureMain`、`restoreProfile` 与主对话状态的形状；主对话的 id 规则 `bot-<bot id>`。
- 信任边界：浏览器是用户本人；主对话的 `owner` 只有 `nbook.bots` 建得出（[`agent/sessions.md`](../agent/sessions.md) 输出 23）。

## 验收与 Smoke

1. 首次启动后调 `ensureMain`：建出 `bot-lyra`，会话头 `owner` 是 `{plugin: "nbook.bots", id: "lyra"}`，Profile 是 `nbook.bots.companion`；并发两次交回同一个 id；不在会话列表里。重启服务端：后台任务重新持有它，状态 `ready`，`bots.main-opened` 有一条。
2. 用户在主对话里等审批时带 `settlePending: "deny"` 发一句：审批以 `deny` 结算，bot 接着处理这句话；远程 `rewind` 得 `owned-session`。
3. 把主对话的 Profile 换成一个之后被删掉的用户 Profile 再重启：状态 `read-only{unknown-profile}`；`restoreProfile` 之后 `ready`、能发话。

Smoke：`packages/neuro-book/src/plugins/bots/` 的插件测试（真实内核、真实 `nbook.agent`、本机假端点）。

## 证据

- 批准依据：[提案：NeuroBook 的 bot](../../proposals/neurobot.md)（2026-11-18 接受）第四节第 5、7 小节与 2026-11-19 的决策记录；[w00043 t06](../../../.agents/works/w00043-neurobot/tasks/t06-main-conversation/README.md) 的决定。
