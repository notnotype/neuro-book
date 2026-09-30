---
标签: [state:local]
别名: ["原始视图", "Raw View"]
---

# Agent 原始视图

对话视图的调试视图：消息按时间顺序逐条显示，每条消息一个块，不分轮、不折叠整轮、不合并工具，系统条目全部展开。开发者用它对照分轮视图，确认界面上的每一样东西都能在 `ctx.messages` 里找到来源。

## 布局

块与块之间用分隔线隔开，没有卡片外框。每块上面一行是消息的原始字段：

- `kind`（系统消息附上 `source`），按种类着色：用户为强调色，错误为危险色，系统为淡色；
- 时间；
- 非默认的状态字段：`intent: steer`、`delivery`、`status`、`contentOmitted`、`retryable` 等；
- 消息 id（等宽、过长截断，完整 id 在悬停提示里）；
- 最右端的“JSON”按钮：切换为这条消息的完整 JSON。

下面是正文：

- 用户：`AgentUserContent`；投递状态未知时带 `AgentDeliveryNotice`。
- assistant：思考为一行可展开的“思考”（展开看全文）、正文按原文显示（不渲染 Markdown，保留原始标记）、每个工具调用一行（与分轮视图相同，可点开看详情）、错误说明，最后一行是用量明细。
- 系统：标签与全文。
- 错误：说明文字。

## 数据

```ts
import type {AgentConversationContext, AgentConversationServices, AgentViewAction, MessageView} from "./agent-view.types";
import type {AgentViewRegistry} from "./agent-view-registry";

type AgentRawViewProps = {
    /** 要显示的消息，必填，按时间顺序。 */
    messages: MessageView[];
    /** 对话视图的 ctx，必填；工具详情与用量币种从这里取。 */
    ctx: AgentConversationContext;
    /** 必填；附件地址从这里取。 */
    services: AgentConversationServices;
    /** 必填；工具的图标、名称与详情组件从这里取。 */
    registry: AgentViewRegistry;
};

type AgentRawViewEmits = {
    /** 用户意图：投递未知时的 message.resend 与 message.dismiss。 */
    (e: "action", action: AgentViewAction): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

`state:local`：每条消息是否切到 JSON、思考与工具调用是否展开。纯界面状态，切换视图模式时随组件重建。
