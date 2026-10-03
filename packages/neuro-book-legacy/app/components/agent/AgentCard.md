---
标签: []
别名: ["工具卡片", "Card"]
---

# Agent 卡片

对话视图里所有“需要框住的单元”共用的外壳：提问、模式切换、任务清单、Workflow、命令与未登记工具都用它呈现。它统一了头部（图标、标题、对象摘要、状态）和可折叠的正文，工具渲染器只需要提供正文，不再各自画框。卡片最多嵌套一层。

外观取值来自对话视图的 `--acv-card-*` 变量，单独挂载时使用默认值。

## 数据

```ts
type AgentCardStatus = "running" | "waiting" | "success" | "error" | "neutral";

type AgentCardProps = {
    /** 图标 class，必填。 */
    icon: string;
    /** 动作名，例如“运行命令”，必填。 */
    title: string;
    /** 操作对象的单行摘要，例如命令文本；默认空串，为空时不显示。 */
    subtitle?: string;
    /** 默认 "neutral"。running 显示转圈，error 用危险色。 */
    status?: AgentCardStatus;
    /** 受控展开状态；不传表示正文常显、头部不可点击。 */
    expanded?: boolean;
};

type AgentCardEmits = {
    /** 点击可折叠卡片的头部时发出，携带期望的新状态。 */
    (e: "toggle", expanded: boolean): void;
};

type AgentCardSlots = {
    /** 正文；折叠时不渲染。 */
    default?: () => unknown;
    /** 头部右侧的操作，点击不会触发折叠。 */
    actions?: () => unknown;
};
```


没有 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
