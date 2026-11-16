---
标签: [state:inject, env:portal]
别名: ["子代理入口", "Subagents Entry"]
---

# SubagentsEntry

对话顶栏右列的子代理入口与浮层（[`agent/conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 43）。子代理卡片只在派它的那一轮里，轮次收起、翻过几屏后就找不到；入口把当前会话的全部后代收在一处：有几个、哪个在跑、哪个等你、哪个出错没看，点一行进去，在跑的能就地停掉。参照旧应用的 `AgentLinkedAgentPanel`。

由 `ConversationHost` 放进视图的 `head-trailing` 插槽，属于视图的组件树。

## 布局

- **入口**：机器人图标加个数，22px 高的小按钮；有等你处理的、或有没看过的出错时，右上角一个危险色小圆点。没有后代时整个不画。
- **浮层**（`Popover`，从入口下方、右对齐展开，宽 340px，窄屏不超过视口减 32px）：
  - 标题行：“子代理”与汇总“N 个 · M 个在跑 · K 个等你处理”，为 0 的两项不写。
  - 列表，最高 320px、区内滚动。每个后代一行，按派生关系缩进（每层 16px）：Profile 图标、名字（Profile 名）与任务（子会话的标题，单行截断），下面淡色的第二行；右边是状态（运行中是转圈，其余是图标）与文字。等你处理的行第二行与状态用警告色，出错的用危险色，完成的图标用成功色。
  - 底部一行提示：“点一行进入子会话；运行中的悬停可停止。”
- 运行中的行在悬停或键盘进到这一行时，停止按钮压在状态的位置上；平时不占位。

## 交互

- 点入口开关浮层；`Esc` 或点外面关掉。
- 点一行发 `select`（子会话 id），浮层关掉。宿主把它当成 `session.select`。
- 点停止调注入的 `stopRun(会话 id)`：只停那个会话这次的运行，子会话与排队的消息留着；孙代理也一样。停不成的原因由宿主写在会话的提示里。
- 浮层开着时：列出的出错算看过（`seen.markRows`），收口了的行去取这次运行的结果（`results.load`）；开着期间新出现的行也一样。

## 数据

```ts
type SubagentsEntryProps = {
    /** Profile 目录：按行的 `profile` 查名字，查不到写“子代理”。 */
    profiles: readonly ProfileEntry[];
    /** 插件作用域的出错看过没有（subagents-panel.ts），右栏与编辑区页面共用。 */
    seen: SeenErrors;
    /** 插件作用域的收口结果缓存：同一次运行只取一次。 */
    results: RunResults;
};

type SubagentsEntryEmits = {
    (e: "select", sessionId: string): void;
};

// v-model:open：浮层开着没有，缺省关着（Lab 的场景开着摆）。
```

后代的数据、每秒走的 `now`、`stopRun` 与 `runResult` 从注入的 `subagentStoreKey` 取，动作名从 `toolActionKey` 取，与 [`SubagentCard`](SubagentCard.md) 相同。没有插槽、没有 expose；attrs 落在包着入口的 `span` 上。

## 状态

- 行的状态与子代理卡片同一套文字：运行中、等你处理、在问父 Agent、已完成、出错、已停止、已中断；还没运行过的写状态未知。
- 第二行：等你处理写“等你批准：动作”或提问；在问父 Agent 写问的话；运行中写“N 次 · 用时 · 当前一步”（动作名加对象的最后一段），子树太大、服务端截掉动态字段的不写；完成写回复的第一行，出错写按错误类别的那句话，结果取到之前不写。
- 汇总与个数按全部后代算，含 fork 出来的。

## 不支持

- 不显示后台命令（`shell` 的 `async`）：它们在命令卡片与任务中心里。
- 不排序、不过滤：按派生关系与服务端给的顺序列。
- 停止之外的操作（重发、归档子会话）要进子会话做。

## 隐藏通道理由

- `state:inject`：后代数据与动作名经注入取（不进视图的 ctx，同子代理卡片）；界面文字经翻译端口。
- `env:portal`：浮层经 `Popover` 渲染到 `body`。
