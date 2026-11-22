# t15 计划：阶段 ④ 按天与未读的分隔线、首屏指标、固定会话档的文案（草稿 1）

## Context

t15 决定 1 的第 ④ 段：消息视图与书房面板里的 bot 聊天补上 IM 式的按天分隔线与未读分隔线，记主对话的首屏渲染耗时（长会话指标在界面上的那一半，后端那一半是 [`bots/main-conversation.md`](../../../../../docs/specs/bots/main-conversation.md) 输出 6），并把阶段 ① 留下的“bot 档里出现‘开一个新会话’”收掉（[plan.md](plan.md) 的接受取舍、t07 的“固定会话档的文案变体”）。

依据：[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 11 小节（“按天的分隔线由视图按消息时间与注入的时区算，不进适配器；一轮跨零点时线画在轮前”“打开 bot 视图那一刻的‘最后看到’固定为这次的基线”“文案：bot 档的变体，经文案覆盖，不复制语言包”“字段缺省时现在的行为不变”）、第 1 小节的“长会话先量”；[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“分轮视图”“历史与滚动”“用法档”；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 52–54；[`bots/view.md`](../../../../../docs/specs/bots/view.md) 输出 2、4；t03 决定 1（打开时先看最新的对话与输入框）。

开工调研确认的事实：

- 视图按轮渲染：`AgentConversationView.vue` 里 `splitIntoTurnGroups` 切好的轮次逐个交给 `AgentConversationTurn`，轮次之间没有别的东西；每条消息带 `timestamp`。压缩分隔线是 `AgentTurnBlock.vue` 的 `.acv-divider`（居中文字、两边细线）。
- 适配器给日志合成的消息 id 是 `h<seq>`，`logSeqOf(message)`（`nb-agent-ui/src/harness.ts`）能反推日志 seq；正在生成的临时消息为 null。
- “看到”：`contact-opener.ts` 的 `watchSeen` 是 `immediate` 的，快照一到就按 `shownSeq` 交 `provider.seen`；bots 的 store 把它截到 `latestSeq` 交 `markSeen`，往返之后联系人的 `seenSeq` 就追上。所以基线不能读活的值，要在这次挂上时拍下来。`OwnerContact`（`agent/shared/contracts.ts`）现在没有 `seenSeq`，bots 的 `list()` 项有。
- 未读的计数消息是一次模型回复的最终那一条：`assistant` 事件里不带工具调用的（`bots/backend/unread.ts` 的 `countsAsMessage`）。
- 宿主每次为一个聊天建立订阅都走 `openHere`：换联系人、启动时恢复是打开；视图收起超过 30 秒再展开、书房面板关了再开是 `reattach`（`borrow()` 重新订阅）。窗口失焦再回来不重开。
- 界面上说不通的文案：bot 档里只有 `kernel.error.compactionFailed`（中英两份都写“或者开一个新会话”）；`command.new` 已被 `commands` 白名单挡掉，`createFailed`、`noSession` 只在新建时出现，bot 档不会新建。
- 诊断：agent 浏览器入口的 `report` 写 `warn`，指标要 `info`，另开一个出口。

## 技术选型

无新依赖。日子的计算沿用 `format.ts` 的本地时区日序号（`localDayIndex`）与 `Intl`。

## 关键设计

### nb-agent-ui：`ctx.dividers`（`src/types.ts`、新 `src/stream-dividers.ts`）

```ts
type DividersView = {
    /** 轮次之间画按天的分隔线。缺省不画。 */
    day?: boolean;
    /** 未读从这条消息起：线画在含它的那一轮之前；不在已加载的消息里时不画。缺省不画。 */
    unreadFrom?: string | null;
};
// AgentConversationContext 加 `dividers?: DividersView`，按会话给；不给时与现在逐像素相同（缺省回归）。
```

`stream-dividers.ts` 是纯函数：`dividersBefore(groups, dividers, now) → Map<首条消息 id, Divider[]>`，`Divider = {kind: "day"; at: number} | {kind: "unread"}`。

- 按天：一轮的日子取它第一条消息的 `timestamp`（一轮跨零点时线画在轮前）；第一轮上面总画一条；与上一轮同一天不画。
- 同一轮前两条都有时，日子在上、未读在下。
- 文字：与 `now` 同一天写“今天”，前一天“昨天”，同一年“11月18日”，否则“2025年11月18日”（英文 Today、Yesterday、Nov 18、Nov 18, 2025）。只用 `now` 的日序号，宿主每秒换 `now` 不打掉轮次的沿用：日序号没变时结果不换引用。
- 时区：用浏览器的本地时区，同会话列表的时间列。提案写的“注入的时区”这里落成“视图所在环境的时区”，不另加参数；测试用本地构造的时间（`new Date(年, 月, 日, 时)`），不写死 UTC 毫秒。

### nb-agent-ui：视图（`AgentConversationView.vue`、新 `stream/AgentStreamDivider.vue` 与 `.md`）

- 分轮视图的轮次循环里，每轮之前画 `dividersBefore` 给的线；原始视图不画。
- 画法沿用 `.acv-divider`：居中文字、两边细线。未读那条写“以下是新消息”，文字与线用强调色；按天那条用次级色。`role="separator"`，读屏名就是文字。
- “更早的内容”那一行仍在最上面；开头不完整的第一轮照样在它上面画日子；翻上一页后第一轮换了，线跟着挪，视口不动（现有的锚定）。
- 不改滚动：打开时照旧到最新（t03 决定 1），不滚到未读线。

### nb-agent-ui：固定会话档的文案（`src/text.ts`、两份语言包）

- 语言包加 `kernel.error.compactionFailedPinned`：“压缩没有成功，对话没有改动。可以换一个压缩模型再试。”（英文同义）。
- 视图在 `ctx.interaction.canCreate === false` 时，把带固定会话变体的键换成变体再翻译。变体表是一张键到键的小表，放在语言包旁，现在只有这一条；不复制语言包，宿主的翻译端口照常生效（变体键不在宿主的包里时退回内置的）。

### NeuroBook：联系人带 `seenSeq`（`agent/shared/contracts.ts`、`bots/web/plugin.ts`）

`OwnerContact` 加 `seenSeq: number | null`：“看到”的位置，未读还没数完（`unread` 为 null）时为 null。bots 的入口按 `list()` 项给。

### NeuroBook：宿主算分隔线（`agent/web/session-host.ts`、`owner-providers.ts`）

- `deps.owners` 加 `seenOf(owner) → number | null`（按归属找到联系人，读它的 `seenSeq`）。
- 基线：每个 `Current`（一次 `openHere`，含 `reattach`）一份。会话有归属、`seenOf` 第一次不是 null 时拍下，之后不变。拍的时机早于自己交的“看到”生效：`watchSeen` 交出去要等服务端往返、`botsChanged` 回来才改 `seenSeq`；联系人还没数完时 store 不交（`bots/view.md` 输出 4），拍的那一刻读到的仍是交之前的值。拍不到（没有归属、联系人一直没读到）就不画未读线。
- 未读线的位置：已加载的消息里第一条“日志 seq 大于基线、是不带工具调用的助手消息”的 id，与后端的计数同一口径，所以有线就有未读、角标为 0 时没有线；找不到为 null。
- 算“这次”的情形：换联系人、启动时恢复、视图收起再展开（`reattach`）、书房面板关了再开都重拍；窗口失焦再回来、视图一直开着时不重拍（提案原话：基线在打开那一刻固定）。
- `ctx.dividers = {day: owner !== null, unreadFrom}`：只给有归属的会话；普通会话不给，画面不变。

### NeuroBook：首屏指标（`agent/web/ConversationHost.vue`、新 `agent/web/paint-metric.ts`、`plugin.ts`）

- 口径：起点是这次 `openHere` 开始（宿主交出 `attachedAt`），终点是快照与第一页路径应用完、`loading` 变假之后，视图下一帧画出来（`nextTick` 后两次 `requestAnimationFrame`）。含 `reattach`，数据里带 `reattach: true`。
- 只记有归属的会话（主对话；提案第 1 小节的指标对象）。页面不可见（`document.visibilityState` 为 hidden）时不记：后台页不跑动画帧，量出来的是等待切回来的时间。
- 诊断 `agent.conversation-painted`（info），带 `sessionId`、`owner`（插件）、`events`（快照的 `head`，与后端 `bots.main-opened` 的事件数对得上）、`messages`（画出的消息条数）、`ms`。预算这版不定（同后端），超过 2,000 毫秒另写 `agent.conversation-paint-slow`（warning，待确认 5）。
- 量的代码碰 DOM，放在 `.vue` 与它用的 `paint-metric.ts`（浏览器侧，不在后端 tsc 范围）；时钟与“下一帧”注入，测试替身即刻完成。
- `plugin.ts` 的诊断另开 `info` 出口给它。

## Spec 与文档改动（master，planned，编号末尾追加）

- `ui/agent-conversation-view.md`：“ctx 的组成”加 `dividers` 一行；“分轮视图”加按天与未读两条；“用法档”表加“分隔线”与“文案”两行（会话档不画、bot 档两种都画，变体键）；验收 43（按天：跨零点、同一天、第一轮、原始视图不画；未读：线在含那条消息的轮前、不在已加载的消息里不画；缺省回归：不给 `dividers` 时与现在相同）、44（`canCreate` 为假时压缩失败那句换成变体）。
- `agent/conversation.md`：输出 55（未读线的基线、位置、哪些情形重拍；有归属的会话画按天的线）、56（首屏指标）；`OwnerContact` 的 `seenSeq`。
- `bots/view.md`：目标与非目标里删掉“按天与未读的分隔线……不在这里”的前半；输出 2 联系人加 `seenSeq`。
- 组件同名 `.md`：`AgentConversationView.md`（`ctx.dividers`、变体）、新 `AgentStreamDivider.md`。

## 切片

1. **nb-agent-ui**：`stream-dividers.ts` 与单测；`AgentStreamDivider`；视图接线；文案变体；Lab 的 `bot` 场景带两种线（跨天的样本消息、一个未读起点），另加一个英文场景；dom 测试。验证：`bun run --cwd packages/nb-agent-ui test`、`typecheck`。
2. **NeuroBook**：`OwnerContact.seenSeq`；宿主的基线与 `ctx.dividers`；首屏指标；`session-host.test.ts` 与 `owner-providers.test.ts` 补用例；e2e `bots-chat.e2e.ts` 两条。验证：应用 agent 与 bots 的 bun 测试、`typecheck`、e2e `bots-chat`、`lab-agent-ui`。

每片单独提交。第 1 片交 Sonnet 做前端实现审查（后台，不阻塞第 2 片）；第 2 片做完后对全部提交再交一次 Sonnet（宿主那部分是应用的 `web/`，按前端审）。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| `ui/agent-conversation-view.md` 验收 43 | `stream-dividers.test.ts`（日子、文字、`now` 换了不换引用）、`AgentConversationView.dom.test.ts`（线的位置、原始视图不画、缺省回归） |
| 同上验收 44 | `AgentConversationView.dom.test.ts`（`canCreate` 真假两态的压缩失败条目） |
| `agent/conversation.md` 输出 55 | `session-host.test.ts`（拍一次不随“看到”前进而变、`reattach` 重拍、找不到计数消息时为 null、普通会话不给）；e2e `bots-chat`：失焦时到一条回复，拿回焦点后角标清零、线还在；重开聊天后线没了 |
| 同上输出 56 | `paint-metric` 的单测（有归属才记、页面隐藏不记、换了会话作废、超过 2,000 毫秒另写警告）；e2e 只断言事件与字段在，不断言时长（测试场地的时钟是手动的） |
| `bots/view.md` 输出 2 | `owner-providers.test.ts`（`seenSeq` 随联系人） |

## 验证

- 合入前的 e2e：`bots-chat`、`lab-agent-ui`、`agent-conversation`（视图接线改到普通会话的渲染路径，确认缺省回归）、`bookshelf`（书房面板的聊天同一套），4 个文件。
- 实施中改动后只重跑覆盖改动的文件。
- 否定断言先变异：把基线改成读活的 `seenSeq`，“角标清零后线还在”那条 e2e 要失败；去掉“不在已加载的消息里不画”，dom 测试要失败。
- Lab 截图（亮色、390 宽与 1440 宽）随汇报给开发者看线的样子。
- 未验证的边界：真实的长会话首屏耗时（要 t11 跑出长日志）；跨夏令时那天的日子只在单测里按本地时区构造。

## 不做与风险

- 不做：打开时滚到未读线（t03 决定 1）；原始视图里的分隔线；按消息的说话者；会话档的按天线（待确认 2）；主对话只读解除的实时推送（开工时的待定项，见待确认 6）。
- 风险：每秒换 `now` 让分隔线重算。`dividersBefore` 按日序号缓存，由 `stream-dividers.test.ts` 的“`now` 换了不换引用”兜底。

## 待确认

1. **未读线画在哪**：推荐画在含第一条未读回复的那一轮之前。用户自己发完话离开、回复后到的情形，线在用户自己那句的上面。另一个做法是画在那一轮里、回复的正上方：要拆进 `AgentConversationTurn`，整轮收起时还要处理线在摘要行的哪一边。
2. **按天的线只在 bot 档画**：推荐只给有归属的会话。普通会话（写作、编码）不画，现在的画面不变。
3. **两种线的样子**：推荐沿用压缩分隔线（居中文字加两边细线）。未读线写“以下是新消息”、用强调色；日子写今天、昨天、11月18日、2025年11月18日。
4. **基线只在打开时拍**：推荐照提案。聊天开着、窗口失焦期间来的话，回来后角标会清零，但不画线（视图开着就算“这次”）；视图收起再展开、书房面板重开会重拍。另一个做法是窗口拿回焦点时，有未读就重拍。
5. **首屏指标只记主对话**：推荐只记有归属的会话，并且页面隐藏时不记；超过 2,000 毫秒另写一条警告，阈值与后端的打开耗时相同。
6. **主对话只读解除**：开工时的待定项（Profile 换回、同哈希恢复后界面不知道）。推荐这次不做实时推送：界面在重开、重连时重取，记为 t15 的后续。
