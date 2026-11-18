---
标签: [state:local, state:inject]
别名: ["eval 详情", "运行代码的详情"]
验证入口: AgentConversationView
---

# EvalDetail

对话视图里 `eval` 卡片展开后的内容（[`agent/eval.md`](../../../../../../../docs/specs/agent/eval.md)，开发者定的注意力排序见 w00032 t21 决定 6）：代码在上、默认收起，输出在下。代码里调过的工具（子调用）由对话视图画在它下面，这个组件不画。

## 布局与交互

- 代码：一行可展开的“代码”，行尾是代码的第一行；展开后是带行号的代码块（不做语法高亮）。只重置内核的调用没有代码，不画这一行。
- 输出：代码块，标题“输出”，内容是这次调用交回模型的文字（打印的内容、最后一个表达式的值、出错说明、内核重置的说明；超出窗口时文字里写着全文的地址）。开始执行之后、结果到来之前写“正在运行…”；参数还在生成、在等批准时不写。
- 代码交出了图片时，输出下面一行淡色写附了几张图：图交给了模型，这里不显示。

## 数据

```ts
type EvalDetailProps = {
    /** 这次 eval 调用；读 `args.code`、`startedAt`、`result.text` 与 `result.details.images`（图片张数）。 */
    call: ToolCallView;
    /** 对话视图交给工具详情的其余几项，这里不用。 */
    ctx?: AgentConversationContext;
    services?: AgentConversationServices;
    locale?: string;
};

type EvalDetailEmits = {
    /** 宿主组件的事件形状；这个组件不发。 */
    action: [action: AgentViewAction];
};
```

没有插槽和 expose。

## 不支持

- 不画图片：视图数据里没有图片内容（适配器只带文字与 `details`）。
- 代码不做语法高亮：没有只读高亮部件。

## 隐藏通道理由

- `state:local`：代码那一行是否展开，随组件挂载与卸载。
- `state:inject`：界面文字经 `useAgentPageText()` 从翻译端口取。
