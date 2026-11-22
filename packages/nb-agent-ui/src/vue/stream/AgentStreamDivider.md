---
标签: [state:inject]
别名: ["消息流分隔线", "Stream divider"]
---

# AgentStreamDivider

消息流里轮与轮之间的一条线（docs/specs/ui/agent-conversation-view.md 的“分轮视图”）：居中一行小字，两边细线，画法同压缩分隔线。两种：

- 按天：写这一轮的日子，次级色。与 `today` 同一天（晚于它的也算）写“今天”，前一天“昨天”，同一年写月日（“11月18日”），否则加上年。
- 未读：写“以下是新消息”，文字与线用强调色。

放在哪一轮之前由对话视图按 `ctx.dividers` 算，它只画一条。读屏是分隔符（`role="separator"`），名字就是那行字。

## 数据

```ts
type AgentStreamDividerProps = {
    kind: "day" | "unread";
    /** 按天的线：这一轮的日子（毫秒）。未读线不用。 */
    at?: number;
    /** `now` 的本地日序号：今天、昨天按它算。宿主每秒换 `now` 时它不变，线不重画。 */
    today: number;
};
```

没有事件、插槽与 expose。根元素带 `data-day-divider` 或 `data-unread-divider`（不用压缩分隔线的 `data-divider`）。

## 隐藏通道理由

`state:inject`：翻译端口（界面语言与“今天”“昨天”“以下是新消息”的字）。
