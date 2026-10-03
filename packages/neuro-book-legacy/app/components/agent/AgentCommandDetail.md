---
标签: []
别名: ["命令详情", "Command Detail"]
---

# Agent 命令详情

命令类工具展开后的内容：上面“命令”代码块是 `bash` 的 `command` 或 `execute_sql` 的 `sql`，下面“输出”代码块是结果正文。结果只公开了预览时末尾提示；还没有结果时显示“还没有结果”。

由 `AgentToolDetail` 按注册表挂载，接收 `ToolDetailProps`。

## 数据

```ts
type AgentCommandDetailProps = {
    /** bash 或 execute_sql 调用，必填；读 args.command 或 args.sql 与 result。 */
    call: ToolCallView;
    /** 对话视图的 ctx，必填；本组件不使用。 */
    ctx: AgentConversationContext;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
