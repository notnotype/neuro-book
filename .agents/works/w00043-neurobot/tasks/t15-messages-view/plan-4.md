# t15 计划：阶段 ④ 按天与未读的分隔线、首屏指标、固定会话档的文案（草稿 2）

## Context

t15 决定 1 的第 ④ 段：消息视图与书房面板里的 bot 聊天补上 IM 式的按天分隔线与未读分隔线，记主对话的首屏渲染耗时（长会话指标在界面上的那一半，后端那一半是 [`bots/main-conversation.md`](../../../../../docs/specs/bots/main-conversation.md) 输出 6），并把阶段 ① 留下的“bot 档里出现‘开一个新会话’”收掉（[plan.md](plan.md) 的接受取舍、t07 的“固定会话档的文案变体”）。

依据：[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 11 小节（“按天的分隔线由视图按消息时间与注入的时区算，不进适配器；一轮跨零点时线画在轮前”“打开 bot 视图那一刻的‘最后看到’固定为这次的基线”“文案：bot 档的变体，经文案覆盖，不复制语言包”“字段缺省时现在的行为不变”）、第 1 小节的“长会话先量”；[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“分轮视图”“历史与滚动”“用法档”；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 52–54；[`bots/view.md`](../../../../../docs/specs/bots/view.md) 输出 2、4；t03 决定 1（打开时先看最新的对话与输入框）；t15 决定 9（本计划草稿 1 的六处待确认）。

设计审查：[第一轮（Sonnet）](evidences/design-review-6-sonnet.txt)，9 条，处理见 [evidences/design-review-6-disposition.md](evidences/design-review-6-disposition.md)。草稿 2 改了未读线的算法（锁存）、重拍的情形、计数消息的标记与文案变体的位置。

开工调研与审查确认的事实：

- 视图按轮渲染：`AgentConversationView.vue` 里 `splitIntoTurnGroups` 切好的轮次逐个交给 `AgentConversationTurn`，轮次之间没有别的东西；每条消息带 `timestamp`。新一轮只在普通的用户消息处开始，宿主以自己身份发的话（日程）也是用户消息、自成一轮。压缩分隔线是 `AgentTurnBlock.vue` 里 scoped 的 `.acv-divider`（居中文字、两边细线），dom 测试以 `[data-divider]` 选它。
- 应用用的适配器是 `createKernelTranscript`：消息 id 取内核事件的 `id`，事件的 `seq` 只用来去重，不落到消息上；`harness.ts` 的 `logSeqOf` 只对旧适配器（nb-story 在用）有效。同一份适配器里“不带工具调用的助手消息”还来自模型失败的半截文字、停止时补的空回复与正在生成的临时消息，后端都不计数；所以计数要按事件类型标，不能按消息形状判。
- 未读的计数消息是 `assistant` 事件里不带工具调用的（`bots/backend/unread.ts` 的 `countsAsMessage`）。
- “看到”：`contact-opener.ts` 的 `watchSeen` 是 `immediate` 的，快照一到就按 `shownSeq` 交 `provider.seen`；bots 的 store 在列表项更新的同一同步段里交 `markSeen`（未读没数完时不交），联系人的 `seenSeq` 要等服务端往返、`botsChanged` 回来才变。所以基线要同步读、拍下就不再读。`OwnerContact`（`agent/shared/contracts.ts`）现在没有 `seenSeq`。
- 宿主为一个聊天建立订阅都走 `openHere`：换会话、启动时恢复、可用性条上的“重试”；借用数归零满 30 秒放开订阅，再借用时 `reattach`。不到 30 秒再借用不重开。书房面板每次打开都调 `openContact`；它已经开着这个主对话时直接返回。
- NeuroBook 的宿主一次读完整条路径（ctx 的 `history` 缺省没有更早的），历史分页只在 Lab 与手造 ctx 里走得到。
- 文案：bot 档里说不通的只有 `kernel.error.compactionFailed`（中英两份都写“或者开一个新会话”），由适配器生成，出现在系统条目的 `label` 与运行出错的 `message` 两处；`command.new` 已被 `commands` 白名单挡掉，`createFailed`、`noSession` 只在新建时出现。
- 诊断：agent 浏览器入口的 `report` 写 `warn`，指标要 `info`；e2e 没有读诊断记录的通道。

## 技术选型

无新依赖。日子的计算沿用 `format.ts` 的本地时区日序号（`localDayIndex`，改成导出）与 `Intl`。

## 关键设计

### nb-agent-ui：适配器标出计数消息、出固定会话的文案（`src/kernel-transcript.ts`）

- transcript 加 `countedSeq(messageId) → number | null`：由 `assistant` 事件（不带工具调用）合成的消息给事件的 `seq`，其余（半截文字、补的空回复、临时消息、带工具调用的）为 null。按事件类型判，与后端 `countsAsMessage` 同一口径；之后被改成 `stopped` 的那条仍算。
- 选项加 `pinned?: () => boolean`：为真时压缩失败产出 `kernel.error.compactionFailedPinned`（“压缩没有成功，对话没有改动。可以换一个压缩模型再试。”，英文同义），系统条目与运行出错两处都换。在合成那一刻读；宿主还不知道归属时出的是普通档那句（已知限制：归属读到之前就压缩失败的极少见）。视图与翻译端口都不动。

### nb-agent-ui：`ctx.dividers`（`src/types.ts`、新 `src/stream-dividers.ts`）

```ts
type DividersView = {
    /** 轮次之间画按天的分隔线。缺省不画。 */
    day?: boolean;
    /** 未读从这条消息起：线画在含它的那一轮之前；不在已加载的消息里时不画。缺省不画。 */
    unreadFrom?: string | null;
};
// AgentConversationContext 加 `dividers?: DividersView`，按会话给；不给时与现在相同（缺省回归）。
```

`stream-dividers.ts` 是纯函数：`dividersBefore(groups, dividers, today) → Map<首条消息 id, Divider[]>`，`Divider = {kind: "day"; at: number} | {kind: "unread"}`，`today` 是 `now` 的日序号。

- 按天：一轮的日子取它第一条 `timestamp > 0` 的消息（缺时间的跳过，整轮都缺就不画）；一轮跨零点时线画在轮前；第一轮上面总画一条；与上一轮同一天不画。轮可能跨几天（用户隔天才回、日程隔天发的话落在下一轮），线只在轮前，不进轮内（已知限制）。
- 同一轮前两条都有时，日子在上、未读在下。
- 文字：日序号不晚于 `today` 一天以内写“今天”（晚于 `today` 的，多机时钟差，也写今天，同 `formatListTime`），前一天“昨天”，同一年“11月18日”，否则“2025年11月18日”（英文 Today、Yesterday、Nov 18、Nov 18, 2025）。
- 视图只把 `now` 的日序号交进来，宿主每秒换 `now` 时日序号不变，计算属性值相同，不触发重算与下游。
- 时区：浏览器的本地时区，同会话列表的时间列（决定 9）。测试用本地构造的时间，不写死 UTC 毫秒。

### nb-agent-ui：视图（`AgentConversationView.vue`、新 `stream/AgentStreamDivider.vue` 与 `.md`）

- 分轮视图的轮次循环改成 `<template v-for :key>`，每轮之前画 `dividersBefore` 给的线；原始视图不画。线的根元素是 `.acv-stream__content` 的直接子元素（吃到那里的封顶宽度与居中），上下间距按 `.acv-turn` 的底边距定。
- 画法照 `.acv-divider`（居中文字、两边细线；scoped 样式复制一份，不抽共享）：未读那条写“以下是新消息”，文字与线用强调色；按天那条用次级色。`role="separator"`，读屏名就是文字；属性 `data-day-divider`、`data-unread-divider`，不用压缩分隔线的 `data-divider`。
- “更早的内容”那一行仍在最上面；翻上一页后第一轮换了，线跟着挪，视口不动（现有的锚定；只有 Lab 与 dom 测试走得到）。
- 不改滚动：打开时照旧到最新（t03 决定 1），不滚到未读线。

### NeuroBook：联系人带 `seenSeq`（`agent/shared/contracts.ts`、`bots/web/plugin.ts`、`owner-providers.ts`）

`OwnerContact` 加 `seenSeq: number | null`：“看到”的位置，未读还没数完（`unread` 为 null）时为 null。bots 的入口按 `list()` 项给；`owner-providers.ts` 加 `seenOf(owner) → number | null`。

### NeuroBook：宿主算未读线（`agent/web/session-host.ts`）

线只标“这次打开时就已经未读”的回复，定下来就不再挪（决定 9 的第 4 条）：

- **这次打开**：宿主打开另一个会话（换联系人、启动时恢复、从活动条转来），或书房面板打开（`openContact` 在已经开着同一个主对话时也让宿主重开一次未读线，见下）。重试与 `reattach`（视图收起再展开、书房面板 30 秒内外重开都一样）沿用这次的线，不另算：重开订阅只是资源回收，不该让线随一个释放定时器出现或消失。
- **基线**：这次打开之后，归属已知、`seenOf` 第一次不是 null 时同步拍下（`watch(..., {flush: "sync"})`，拍到就停）。自己交的“看到”要等服务端往返才改 `seenSeq`，同步读到的是交之前的值。`unread` 一直是 null（补数失败）时拍不到，不画线，这时角标也是空的。
- **锁存**：基线拍到、第一页路径读完之后，算一次：已加载的消息里第一条 `countedSeq > 基线` 的 id；之后不再算，聊天开着时到的回复（看着时到的、失焦时到的）都不画线。算出 null 就这次都没有线。
- 书房面板打开时调宿主的 `markOpened()`：已经开着这个会话时重拍基线、马上锁存（消息都在）；还没开时由接着的 `openHere` 照上面做。
- `ctx.dividers = {day: owner !== null, unreadFrom}`：只给有归属的会话；普通会话不给，画面不变。
- 消息视图与书房面板各有一个宿主、各自一条线；一处看过以后，另一处已经锁存的线不收（预期）。

### NeuroBook：首屏指标（`agent/web/ConversationHost.vue`、新 `agent/web/paint-metric.ts`、`plugin.ts`）

- 口径：起点是这次 `openHere` 开始（宿主交出 `attachedAt`，含重试与 `reattach`），终点是快照与整条路径应用完、`loading` 变假之后，视图下一帧画出来（`nextTick` 后两次 `requestAnimationFrame`）。不含点联系人之后的 `ensureMain`（那段是后端 `bots.main-opened` 量的）。
- 只记有归属的会话。起点与终点页面都可见、期间没有变成隐藏才记（后台页不跑动画帧）；换了会话或宿主关掉作废。
- 诊断 `agent.conversation-painted`（info），带 `sessionId`、`owner`（插件）、`position`（`view`、`page`、`desk`）、`reattach`、`events`（快照的 `head`，与后端的事件数对得上）、`messages`（画出的消息条数）、`ms`。超过 2,000 毫秒另写 `agent.conversation-paint-slow`（warning）。
- 量的代码只在 `.vue` 与 `paint-metric.ts`（浏览器侧，不在后端 tsc 范围）里碰 DOM；`plugin.ts` 只交出 `info` 级的诊断出口，不引入它。时钟、“下一帧”与可见性注入，测试替身即刻完成。

## Spec 与文档改动（master，planned，编号末尾追加）

- `ui/agent-conversation-view.md`：“ctx 的组成”加 `dividers` 一行；“分轮视图”加按天与未读两条；“用法档”表加“分隔线”“文案”两行（会话档不画；bot 档两种都画；压缩失败那句是固定会话的说法，由适配器的 `pinned` 给）；验收 43（按天：跨零点、同一天、第一轮、缺时间、晚于 `now`、原始视图不画；未读：线在含那条消息的轮前、不在已加载的消息里不画；缺省回归）、44（`pinned` 时压缩失败的系统条目与运行出错都是固定会话的说法）。
- `agent/conversation.md`：输出 55（未读线：这次打开、基线、锁存、只给有归属的会话；有归属的会话画按天的线）、56（首屏指标的口径与字段）；`OwnerContact` 的 `seenSeq`。
- `bots/view.md`：目标与非目标里删掉“按天与未读的分隔线……不在这里”的前半；输出 2 联系人加 `seenSeq`。
- 组件同名 `.md`：`AgentConversationView.md`（`ctx.dividers`）、新 `AgentStreamDivider.md`；`kernel-transcript.ts` 的模块头（`countedSeq`、`pinned`）。

## 切片

1. **nb-agent-ui**：适配器的 `countedSeq` 与 `pinned`；`stream-dividers.ts`；`AgentStreamDivider`；视图接线；Lab 的 `bot` 场景带两种线（跨天的样本消息、一个未读起点），另加一个英文场景；单测与 dom 测试。验证：`bun run --cwd packages/nb-agent-ui test`、`typecheck`。
2. **NeuroBook**：`OwnerContact.seenSeq`；宿主的基线、锁存、`markOpened` 与 `ctx.dividers`；`pinned` 接线；首屏指标；单测；e2e `bots-chat.e2e.ts` 三条。验证：应用 agent 与 bots 的 bun 测试、`typecheck`、e2e `bots-chat`、`lab-agent-ui`。

每片单独提交。第 1 片交 Sonnet 做前端实现审查（后台，不阻塞第 2 片）；第 2 片做完后对第 2 片再交一次 Sonnet（宿主那部分是应用的 `web/`，按前端审）。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| `ui/agent-conversation-view.md` 验收 43 | `stream-dividers.test.ts`（日子、文字、缺时间、晚于 `now`、`now` 换了不换结果）、`AgentConversationView.dom.test.ts`（线的位置、原始视图不画、缺省回归） |
| 同上验收 44 | `kernel-transcript.test.ts`（`pinned` 真假两态下压缩失败的系统条目与运行出错） |
| `agent/conversation.md` 输出 55 | `kernel-transcript.test.ts`（`countedSeq`：最终回复、带工具调用的、半截文字、补的空回复、被改成停止的）；`session-host.test.ts`（基线同步拍、`seenSeq` 前进的第二次推送不改基线、锁存后到的回复不画线、找不到计数消息为 null、重试与 `reattach` 沿用、`markOpened` 重拍、普通会话不给）；e2e `bots-chat`：切走时到一条回复，切回来有线、拿回焦点后角标清零线还在；看着时到的回复没有线；书房面板关了再开、看过的线没了 |
| 同上输出 56 | `paint-metric` 的单测（有归属才记、隐藏过不记、换了会话作废、字段、超过 2,000 毫秒另写警告）；e2e 读不到诊断，不覆盖 |
| `bots/view.md` 输出 2 | `owner-providers.test.ts`（`seenSeq` 随联系人） |

## 验证

- 合入前的 e2e：`bots-chat`、`lab-agent-ui`、`agent-conversation`（视图接线改到普通会话的渲染路径，确认缺省回归）、`bookshelf`（书房面板的聊天同一套），4 个文件。
- 实施中改动后只重跑覆盖改动的文件。
- 否定断言先变异：去掉锁存（每次重算），“看着时到的回复没有线”要失败；基线改成读活的 `seenSeq`，“拿回焦点后线还在”要失败；去掉“不在已加载的消息里不画”，dom 测试要失败。
- Lab 截图（亮色、390 宽与 1440 宽）随汇报给开发者看线的样子。
- 未验证的边界：真实的长会话首屏耗时（要 t11 跑出长日志）；跨夏令时那天的日子只在单测里按本地时区构造；历史分页时线的挪动只在 Lab 与 dom 测试里。

## 不做与风险

- 不做：打开时滚到未读线（t03 决定 1）；原始视图里的分隔线；轮内的按天线；会话档的按天线（决定 9）；主对话只读解除的实时推送（决定 9，记为后续）。
- 风险：锁存的时机依赖“第一页路径读完”与“基线拍到”两件事的先后，由 `session-host.test.ts` 两种先后各一条兜底，用真实的 `createKernelTranscript`。
