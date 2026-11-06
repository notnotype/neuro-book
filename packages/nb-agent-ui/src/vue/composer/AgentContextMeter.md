---
标签: [state:inject, env:portal]
别名: ["上下文大小", "上下文用量", "Context Meter"]
验证入口: AgentConversationComposer
---

# AgentContextMeter

输入框工具栏里的一个小圆环加百分比，说这次对话用掉了模型上下文窗口的多少：圆环按比例填满，70% 起变黄，90% 起变红，超过窗口时满格并写出实际百分比。数字（已用、窗口、百分比）在提示里，悬停、键盘聚焦或点按圆环都能看到。它不自己算用量：宿主按 `ctx.usage` 给出 `contextTokens` 与 `contextLimit`，口径见 [ui/agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md) 的输入框一节。

## 数据

```ts
interface AgentContextMeterProps {
    /** 必填：已用的 token（上一次请求的输入，含缓存读写）。 */
    used: number;
    /** 必填：上下文窗口；大于 0。 */
    limit: number;
    /** 能点（宿主能给上下文详情时）：渲染成按钮，点了发出 `inspect`。缺省只是显示。 */
    interactive?: boolean;
}
```

事件：`inspect`（`interactive` 时点击）。

## 状态

- 低于 70%：圆环用次要文字色。70% 到 90%：警告色。90% 起：危险色。超过 100%：满格危险色，提示写实际百分比（例如 112%）。
- 圆环 16px，右边写百分比（只有圆环时像加载中的转圈），与工具栏的图标按钮同高居中；百分比占固定宽度，数字变化不推动相邻控件。

## 不支持

- 不显示“没有用量”：`used` 为 0 或宿主不知道窗口时由输入框不渲染它。
- 不点开上下文详情。

## 隐藏通道理由

`state:inject` 读视图的语言（`useAgentText`）。`env:portal` 来自 nb-ui 的 Tooltip：提示渲染到 body。
