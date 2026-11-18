---
标签: [state:local, state:inject]
别名: ["思维链块"]
验证入口: AgentTurnBlock
---

# AgentChainBlock

`AgentTurnBlock` 里思维链那一种块：一行摘要（`AgentChainSummary`），默认折叠；开头图标有思考时是大脑、否则是扳手，概括如“思考 · 读了 2 个文件，改了 1 个 · 另有 1 次操作”。展开后步骤挂在从图标垂下的竖线上：

- 工具组：一行合并摘要，点开逐项；组收起时出错的项单独露出。
- 一行呈现的工具：`AgentToolStepRow`；卡片呈现的工具：可展开卡片，内容是 `AgentToolDetail`。运行中、已经开始执行的卡片在副标题里、工具摘要后面写已用时（`ctx.now` 减 `call.startedAt`，含等审批的时间），跑完不写；不放在头部右侧，跑完时右侧的状态图标与箭头不挪位置。
- 有子调用的卡片（eval 这类经代码调别的工具的）：副标题再接子调用的计数（“调用了 30 次工具 · 读了 28 个文件，改了 2 个”），运行中写已调用几次与正在调的那一个（最近受理、还没有结果的）。卡片收起时，改了文件、出错、被拒、结果未知的子调用作为卡片下方紧随的缩进行列出；展开后正文下面列出全部子调用。子调用一律是一行（`AgentToolStepRow`），点开是它自己的详情，展开状态按子调用的 id 记。结果工具（`outcome`）被退回的那几次也是一行，行内文字由渲染器的 `summary` 写出原因，不画宿主的节点组件。
- 并入的中间 content：Markdown 浅底小气泡，正文色；消息带附注时附注在气泡下方。
- 思考与系统提示词：`AgentTextStepRow`。
- 两条 assistant 消息之间一道短虚线。

运行中摘要行的图标换成转圈，概括换成正在执行的那一步；是这一轮最后一块时，即使没有工具在跑也转圈。

## 数据

```ts
type AgentChainBlockProps = {
    chain: ChainBlock;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    /** 所在轮次的状态；决定卡片显示“运行中”还是“等待”。 */
    turnStatus: TurnStatus;
    /** 是否本轮最后一个块。 */
    last: boolean;
    /** 运行中逐步展开：思维链与工具组默认展开，用户点过的以用户为准；卡片与思考仍折叠。 */
    live: boolean;
};

type AgentChainBlockEmits = {
    (e: "action", action: ViewAction): void;
};
```

没有插槽和 expose。

## 隐藏通道理由

- `state:local`：思维链、工具组、卡片与各步骤行的展开状态，按 id 记（`useOpenSet`），思维链重新分组时不丢，随块挂载与卸载。
- `state:inject`：经 `useAgentText()` 取语言与界面文字。
