---
标签: [state:local]
别名: ["轮次块", "Turn Block"]
---

# Agent 轮次块

一轮里 Agent 一侧的一个块，由 `AgentConversationTurn` 按时间顺序排列。块的种类与含义见 `conversation-turns.ts` 的 `TurnBlock`，排列与三层规则见 `AgentConversationTurn` 的同名文档。本组件只负责把一个块画出来：

- 思维链（`chain`）：一行摘要（`AgentChainSummary`），默认折叠；开头图标有思考时是大脑、否则是扳手，概括如“思考 · 读了 2 个文件，改了 1 个 · 另有 1 次操作”；展开后步骤挂在从图标垂下的竖线上：工具组、单行工具、可展开卡片、并入的中间 content（Markdown 浅底小气泡）、思考（展开看 Markdown 全文）、系统提示词（点开看全文；思考与系统提示词展开后行内不再重复第一行），两条消息之间一道短虚线。每一次工具调用（单行、组内一项、出错单独露出的一项、卡片与通用控件卡片）都能点开，内容由 `AgentToolDetail` 画：有适配的工具显示文件内容、diff 或命令输出，没有适配的显示原始参数与结果。运行中摘要行的图标换成转圈，概括换成正在执行的那一步。
- Agent 说出的 content（`content`）：最终回复用完整气泡；运行中的中间 content 用轻一级的气泡。消息还在流式生成时正文末尾显示光标。
- 人机交互控件（`node`）：渲染器登记了 `node` 组件时用它，否则用通用卡片；Workflow 运行中卡片副标题显示当前动作。
- 信息条目（`notice`）：淡色一行，写标签和正文第一行；整行是按钮，点开在下方显示全文（Markdown，淡色小字）。
- 分隔线（`divider`）：上下文压缩、分支摘要居中一条线；带摘要正文时标签可点，点开在线下显示摘要全文。
- steer：左侧强调色竖线的浅底条，“补充说明”标签后面是 `AgentUserContent`；还在发送时末尾一个小转圈，投递状态未知时下一行是 `AgentDeliveryNotice`。
- 错误：危险色气泡。

## 数据

```ts
import type {TurnBlock, TurnStatus} from "./conversation-turns";

type AgentTurnBlockProps = {
    /** 要画的块，必填。 */
    block: TurnBlock;
    /** 对话视图的 ctx，必填；node 组件与 Workflow 进度从这里取。 */
    ctx: AgentConversationContext;
    /** 必填；用 sanitizeHtml 渲染 Markdown，用 resolveAttachmentUrl 显示 steer 的附件。 */
    services: AgentConversationServices;
    /** 必填；取工具名称等。 */
    registry: AgentViewRegistry;
    /** 所在轮次的状态，必填；决定卡片显示“运行中”还是“等待”。 */
    turnStatus: TurnStatus;
    /** 是否本轮最后一个块，必填；运行中的最后一条思维链即使没有工具在跑也显示转圈。 */
    last: boolean;
};

type AgentTurnBlockEmits = {
    /** 用户意图：steer 投递未知时的 message.resend 与 message.dismiss。 */
    (e: "action", action: AgentViewAction): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

`state:local`：思维链、工具组、单个工具、卡片、思考、系统提示词、信息条目与分隔线摘要的展开状态。父组件以块 id 为 key 挂载，切换会话时随轮次一起重建。
