---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: bots.view
owners:
  - nbook.bots
---

# bot 在消息视图里

## 目标与非目标

打开作品的窗口里，用户在右栏的“消息”视图（[`agent/conversation.md`](../agent/conversation.md) 输出 2）里和 bot 说话、批它要做的事；书房里点案头的看板娘，从右边滑出同一个聊天（同一份输出 54）。`nbook.bots` 给消息视图当归属插件（同一份输出 53）：bot 一页的联系人、打开主对话、记“看到”都经它；聊天区与会话是同一个，档位按会话的归属定（输出 52）。

不承诺：

- 第一版只有一个 bot（开发者 2026-11-19）。
- 不新建、不换、不分叉 bot 的会话；不改写历史（编辑、重试、从此处分支、分支树、归档）。
- 第二行不写 bot 具体在做什么，只写在跑、等你处理（开发者 2026-11-20 定，等后端有活动摘要再补）。
- 按天与未读的分隔线、日程不在这里。
- 人设不进提示词（另做）。

## 术语与参与者

- **主对话**、**持有**：见 [`main-conversation.md`](main-conversation.md)。
- **看到**：用户看过的位置，主对话日志的一个 seq，只进不退（[`main-conversation.md`](main-conversation.md) 输出 7）。
- **联系人**：bot 一页的一行，一个 bot 一个。

## 输入与前置条件

- `nbook.bots` 的浏览器入口（`onStartup` 激活）向 `agent.sessionOwners` 贡献一条 `nbook.bots.main`，实现 `SessionOwnerProvider`（`agent/shared/contracts.ts`）。
- 依赖：远程服务 `nbook.bots/bots`（[`bots.md`](bots.md) 输出 7）、头像路由（同一份输出 9）。

## 输出与可观察行为

1. 入口启动即订阅 `botsChanged` 再取 `list()`（`onResync` 重取），消息视图没打开时联系人与未读照样更新。订阅或 `list()` 失败时 `state` 是 `failed` 加码，bot 一页写原因与“重试”（调 `reload`：订阅还在只重读，订阅失败就重新订阅）。
2. 联系人：`list()` 的每一项一个，`{id, name, avatar, unread, last, sessionId}`；`avatar` 是头像路由的地址；`sessionId` 是主对话的 id（`bot-<id>`），主对话还是 `none` 时为 null。bot 一页一行写头像、名字、时间、第二行（在跑时蓝字“正在回复…”，等你处理时黄字“等你处理”，按会话树的根算：子代理在跑或在等也算；平时是最后一句话）、未读数。窄版头像列里联系人头像有未读时右上角一个点，有等你处理的事时点是黄色。
3. 点联系人：调 `open(id)`，即 `ensureMain`；取到后消息视图的聊天区打开主对话（bot 档：顶栏是名字与头像，等你处理的事在停靠区，发话会一并拒绝挂着的同步事项）。没有模型、取不到时的画面见 [`agent/conversation.md`](../agent/conversation.md) 输出 53。
4. 看到：消息视图交来的 seq 交给 `markSeen`；只在有未读、交的位置超过已存的“看到”时交；未读还没数完（`unread` 为 null）时先记下、等数完再交；联系人列表每次更新都按记下的位置重判一次，交失败了、或交的时候列表还没跟上，不用等下一条消息。几个窗口共用服务端的一份。
5. 计数：消息视图的计数（面板头标题后、入口角标）与状态栏的“N 条新消息”都是联系人未读的合计（[`agent/conversation.md`](../agent/conversation.md) 输出 2、53）；书房案头看板娘的角标是它代表的那个联系人的未读（同一份输出 54）。

## 状态与转换

联系人一段：读联系人中 → 加载中；读不到 → 原因与重试；读到了、一个都没有 → “还没有 bot”；读到了 → 联系人。

时序与寿命：订阅随浏览器入口，入口停止时释放。

## 副作用与数据

不另存数据：看到的位置存在服务端（[`main-conversation.md`](main-conversation.md)）。

## 失败与恢复

| 情况 | 界面怎样 | 用户怎么办 |
|---|---|---|
| 订阅或 `list()` 失败 | bot 一页写原因与“重试” | 重试 |
| `ensureMain` 失败（`owner-mismatch`、`session-busy`、`log-corrupt` 等） | 聊天区盖原因与“重试” | 按原因处理后重试 |
| `markSeen` 失败 | 不提示，计数照旧；下一次看到或联系人列表更新时再交 | 无 |

## 边界与兼容

公开接口只有贡献 `nbook.bots.main`（`agent.sessionOwners`）。阶段 ① 的 bot 视图（`nbook.bots.chat`）删掉：它没有随发布版本带出去，开发者本机布局里留着的标签按 [`workbench/views.md`](../workbench/views.md) 输出 7 的占位关掉。

## 验收与 Smoke

1. 开发服务、配好模型：右栏消息视图的头像列点星璃，面板头是“星璃”与头像；发一句得到回复；她要改文件时停靠区里有审批、输入框可用；这时再发一句，审批以拒绝结算、她接着处理这句。
2. 她等你批准时切到别的会话，点状态栏的活动条目，消息视图打开她的主对话、回到 bot 档。
3. 窗口没有焦点时到的回复记为未读：头像列的名称写“星璃，1 条未读”，状态栏写“1 条新消息”；窗口拿回焦点后清零。
4. （planned）书房：点案头的看板娘，右边滑出她的主对话，书房不压暗；看着时到的回复不算未读；窗口失焦时到一条回复，关上面板后看板娘右上角“1”、气泡写那句话；拿回焦点再打开，角标清零；在面板里拖选一句话，面板不动。

Smoke：`packages/neuro-book/e2e/bots-chat.e2e.ts`。

## 证据

- 批准依据：[提案：NeuroBook 的 bot](../../proposals/neurobot.md) 第四节第 11 小节；[w00043 t15](../../../.agents/works/w00043-neurobot/tasks/t15-messages-view/README.md) 的决定 1–7 与[阶段 ② 的计划](../../../.agents/works/w00043-neurobot/tasks/t15-messages-view/plan-2.md)。
