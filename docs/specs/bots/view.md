---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: bots.view
owners:
  - nbook.bots
---

# bot 视图

## 目标与非目标

打开作品的窗口里，左侧栏的一个视图放 bot 的聊天：用户在这里和 bot 说话、批它要做的事，关着时活动栏图标上看得到未读。之后会并进两个标签的“消息”视图（开发者 2026-11-19 定先做这一个视图，见“证据”）。

不承诺：

- 第一版只有一个 bot，视图里直接是它的聊天，没有联系人列表（开发者 2026-11-19）。
- 不新建、不换、不分叉会话；不改写历史（编辑、重试、从此处分支、分支树、归档）。
- 按天与未读的分隔线、书房入口、日程不在这里。
- 人设不进提示词（另做）。

## 术语与参与者

- **主对话**、**持有**：见 [`main-conversation.md`](main-conversation.md)。
- **看到**：用户看过的位置，主对话日志的一个 seq，只进不退（[`main-conversation.md`](main-conversation.md) 的未读一节）。

## 输入与前置条件

- 视图 `nbook.bots.chat`，`nbook.bots` 的浏览器入口贡献；入口 `onStartup` 激活。
- 依赖：远程服务 `nbook.bots/bots`（[`bots.md`](bots.md) 输出 7）、`nbook.agent` 浏览器入口的固定会话对话组件（[`agent/conversation.md`](../agent/conversation.md)）、模型服务的“有没有可用的模型”。

## 输出与可观察行为

1. 视图在左侧栏，有自己的活动栏图标，标题“bot”。`badge()` 是缺省 bot 的未读数（`list()` 的 `unread`）；为 0 或 null 时不显示计数。入口启动即订阅 `botsChanged`，视图没打开时计数照样更新。
2. 打开视图：
   1. 没有可用的模型：显示引导卡（照对话视图现有的“没有模型”引导，去模型设置），不调 `ensureMain`；
   2. 否则调 `ensureMain` 取主对话，期间显示加载中；失败时显示原因与“重试”，打字与加附件都不建会话；
   3. 取到后画固定会话的对话：顶栏是 bot 的名字与头像（头像经 [`bots.md`](bots.md) 的头像地址），待处理事项在停靠区（[`ui/agent-conversation-view.md`](../ui/agent-conversation-view.md) 的 bot 档）。
3. 发话与停止照固定会话的对话（[`agent/conversation.md`](../agent/conversation.md)）：运行中是插话；有挂着的同步事项时输入框上方写“发出会拒绝 N 项”（N 不含异步提问与后代会话的事项），发出时这些事项以拒绝结算，停靠区里填了一半的作废。
4. 看到：视图可见、窗口有焦点时，把对话已经画出的最后一条计数消息的 seq 交给 `markSeen`；不可见或没有焦点时不前进。几个窗口共用服务端的一份。
5. 有归属的会话（会话头 `owner.plugin` 是 `nbook.bots`）从活动条、子代理卡片、请求页等处打开时，揭示这个视图，不在通用的对话视图里打开（[`agent/conversation.md`](../agent/conversation.md) 的转交）。

## 状态与转换

视图的内容：没有模型 → 引导卡；取会话中 → 加载中；取会话失败 → 原因与重试；已取到 → 对话。模型配好、点重试会重新走第 2 条。

时序与寿命：视图卸载时对话组件放掉订阅；再打开重新取会话（`ensureMain` 已持有时直接交回）。

## 副作用与数据

不另存数据：看到的位置存在服务端（[`main-conversation.md`](main-conversation.md)）。

## 失败与恢复

| 情况 | 视图怎样 | 用户怎么办 |
|---|---|---|
| `ensureMain` 失败（`owner-mismatch`、`session-busy`、`log-corrupt` 等） | 原因与“重试” | 按原因处理后重试 |
| `markSeen` 失败 | 不提示，计数照旧；下一次看到时再交 | 无 |

## 边界与兼容

公开接口只有视图 id `nbook.bots.chat`。阶段 ② 并进“消息”视图时这个视图 id 会换掉。

## 验收与 Smoke

1. 开发服务、配好模型：点活动栏的 bot 图标，顶栏是“星璃”与头像；发一句得到回复；她要改文件时停靠区里有审批、输入框可用；这时再发一句，审批以拒绝结算、她接着处理这句。
2. 有未读时关着视图，图标上有计数；打开视图、窗口有焦点后计数清零。从状态栏的活动条目点主对话，揭示的是 bot 视图。

Smoke：`packages/neuro-book/e2e/bots-chat.e2e.ts`。

## 证据

- 批准依据：[提案：NeuroBook 的 bot](../../proposals/neurobot.md) 第四节第 11 小节；[w00043 t15](../../../.agents/works/w00043-neurobot/tasks/t15-messages-view/README.md) 的决定 1、3 与[计划](../../../.agents/works/w00043-neurobot/tasks/t15-messages-view/plan.md)。
