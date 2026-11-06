---
标签: [state:local, state:inject]
别名: ["轮次块", "Turn Block"]
---

# AgentTurnBlock

一轮里 Agent 一侧的一个块，由 `AgentConversationTurn` 按时间顺序排列。块的种类与含义见 `conversation-turns.ts` 的 `TurnBlock`，排列与三层规则见 `AgentConversationTurn` 的同名文档。本组件只负责把一个块画出来：

- 思维链（`chain`）：交给 `AgentChainBlock`，见其同名文档。每一次工具调用（单行、组内一项、出错单独露出的一项、卡片与通用控件卡片）都能点开，内容由 `AgentToolDetail` 画。
- Agent 说出的 content（`content`）：最终回复用完整气泡；运行中的中间 content 用轻一级的气泡。消息还在流式生成时正文末尾显示光标。消息带附注时，附注在正文下方、同一个气泡里（`AgentMessageAnnotations`）。
- 附注（`annotations`）：没有文字的助手消息带的附注单独成块，位置规则同信息条目。
- 人机交互控件（`node`）：渲染器登记了 `node` 组件时用它，否则用通用卡片；Workflow 运行中卡片副标题显示当前动作。
- 信息条目（`notice`）：淡色一行，写标签和正文第一行（经 `renderers.markdownPreview` 去掉 Markdown 标记）；整行是按钮，点开在下方显示全文（Markdown，淡色小字）。
- 分隔线（`divider`）：上下文压缩、分支摘要居中一条线；带摘要正文或压缩详情（`message.compaction`）时标签可点，点开在线下先显示压缩详情（[`AgentCompactionDetail`](AgentCompactionDetail.md)），再显示摘要全文。整理工具结果的压缩没有摘要，详情是它唯一的内容。
- steer：左侧强调色竖线的浅底条，“补充说明”标签后面是 `AgentUserContent`；还在发送时末尾一个小转圈，投递状态未知时下一行是 `AgentDeliveryNotice`。
- 错误：危险色气泡。

## 数据

```ts
import type {TurnBlock, TurnStatus} from "@notnotype/nb-agent-ui";
import type {ViewAction} from "@notnotype/nb-agent-ui/vue";

type AgentTurnBlockProps = {
    /** 要画的块，必填。 */
    block: TurnBlock;
    /** 对话视图的 ctx，必填；node 组件与 Workflow 进度从这里取。 */
    ctx: AgentConversationContext;
    /** 必填；回复里 Markdown 的图片经 resolveMarkdownAsset 换算，steer 的附件经 resolveAttachmentUrl 显示。 */
    services: AgentConversationServices;
    /** 必填；取工具名称等。 */
    registry: AgentViewRegistry;
    /** 所在轮次的状态，必填；决定卡片显示“运行中”还是“等待”。 */
    turnStatus: TurnStatus;
    /** 是否本轮最后一个块，必填；运行中的最后一条思维链即使没有工具在跑也显示转圈。 */
    last: boolean;
    /** 运行中逐步展开；交给思维链作为默认展开。默认 false。 */
    live?: boolean;
};

type AgentTurnBlockEmits = {
    /** 用户意图：steer 投递未知时的 message.resend 与 message.dismiss。 */
    (e: "action", action: ViewAction): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

`state:local`：通用控件卡片、信息条目与分隔线摘要的展开状态；思维链里各项的在 `AgentChainBlock` 与两种步骤行里。父组件以块 id 为 key 挂载，切换会话时随轮次一起重建。

## 样式变量

各块左缩进读 `--nb-agent-block-indent`，由 `AgentConversationTurn` 声明；单独挂载没有它时按 24px。
