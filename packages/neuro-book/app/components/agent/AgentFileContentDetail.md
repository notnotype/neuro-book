---
标签: []
别名: ["文件内容详情", "File Content Detail"]
---

# Agent 文件内容详情

`read` 工具展开后的内容：一个带行号的代码块，标题是文件路径，正文是读到的内容。调用带 `offset` 参数时行号从该行开始。结果只公开了预览时末尾提示；还没有结果时显示“还没有结果”。

由 `AgentToolDetail` 按注册表挂载，接收 `ToolDetailProps`。

## 数据

```ts
type AgentFileContentDetailProps = {
    /** read 调用，必填；读 args.path、args.offset 与 result。 */
    call: ToolCallView;
    /** 对话视图的 ctx，必填；本组件不使用。 */
    ctx: AgentConversationContext;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
