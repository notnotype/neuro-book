---
标签: [state:local, state:inject]
别名: ["子代理卡片"]
---

# SubagentCard

父会话里一次 `agent_spawn`、`agent_send`、`agent_answer` 调用的卡片（对话视图的节点，[`conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 33–39）。每次派发一张，上下排着，不合成一组。

## 布局与交互

- 卡头：Profile 图标、子代理名、“后台”（调用先返回了）、工具次数与用时、状态（运行中转圈，否则状态图标）、打开子会话（`session.select`；派发失败、找不到子会话时不可用）。
- 下面一行：运行中写正在做什么（最近一步的工具与对象），在问父 Agent 时写问题，结束后写结果第一句。只占一行，放不下截断；进度更新只改这一行的文字，高度不随文字与状态变化。
- 有结果全文时这一行能点开，全文区有最高高度、区内滚动；运行中、结束时都不自动展开。
- 出错时边框用危险色。

## 数据

属性同工具节点（`ToolComponentProps`：`call`、`ctx`、`services`、`locale`）；事件 `action`。状态按 `web/subagent-card.ts` 的 `cardModel` 推导。

## 隐藏通道理由

`state:local`：结果全文的展开。`state:inject`：卡片的数据（`subagent-store.ts`，宿主按会话提供：后代的进度、任务、每秒走的 `now`），与插件的界面文字。
